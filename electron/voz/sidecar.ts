/**
 * Processo auxiliar do motor de voz: início, RPC por linha JSON, reinício.
 *
 * O Electron é o único cliente do sidecar. Um pedido por vez (o modelo não
 * ganha nada com concorrência em CPU, e serializar evita dois textos
 * disputando a mesma referência). Se o processo cair no meio, todos os
 * pedidos pendentes falham com erro claro e o próximo pedido o sobe de novo —
 * até três quedas seguidas; depois disso fica em `erro` até o app reabrir.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ehEvento,
  ehResposta,
  separarLinhasJson,
  type EventoDoMotor,
  type PedidoSemId,
  type RespostaDoMotor,
} from '../../src/voz/protocolo';

export interface LocalizacaoDoMotor {
  comando: string;
  args: string[];
  cwd?: string;
  /** Como o motor foi achado, para o log e para a tela. */
  origem: 'executavel' | 'python';
}

/**
 * Onde está o motor neste build.
 *
 *  - Empacotado: `resources/voice-engine/irisflow-voz(.exe)`, gerado por
 *    `voice-engine/build-voice-engine.ps1`.
 *  - Em desenvolvimento: `python -m irisflow_voz` dentro de `voice-engine/`,
 *    de preferência o `.venv` da pasta; `IRISFLOW_PYTHON` sobrepõe.
 */
export function localizarMotor(opcoes: { empacotado: boolean; resourcesPath: string; raizDoProjeto: string }): LocalizacaoDoMotor | null {
  const exe = process.platform === 'win32' ? 'irisflow-voz.exe' : 'irisflow-voz';
  const candidatosExe = [
    path.join(opcoes.resourcesPath, 'voice-engine', exe),
    path.join(opcoes.raizDoProjeto, 'voice-engine', 'dist', 'irisflow-voz', exe),
  ];
  for (const c of candidatosExe) {
    if (fs.existsSync(c)) return { comando: c, args: [], cwd: path.dirname(c), origem: 'executavel' };
  }
  if (opcoes.empacotado) return null;

  const pasta = path.join(opcoes.raizDoProjeto, 'voice-engine');
  if (!fs.existsSync(path.join(pasta, 'irisflow_voz', '__main__.py'))) return null;
  const venvPy = process.platform === 'win32'
    ? path.join(pasta, '.venv', 'Scripts', 'python.exe')
    : path.join(pasta, '.venv', 'bin', 'python');
  const python = process.env.IRISFLOW_PYTHON || (fs.existsSync(venvPy) ? venvPy : process.platform === 'win32' ? 'python' : 'python3');
  return { comando: python, args: ['-m', 'irisflow_voz'], cwd: pasta, origem: 'python' };
}

interface Pendente {
  resolver: (r: RespostaDoMotor) => void;
  rejeitar: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class Sidecar {
  private processo: ChildProcessWithoutNullStreams | null = null;
  private pendentes = new Map<number, Pendente>();
  private proximoId = 1;
  private resto = '';
  private quedas = 0;
  private fila: Promise<unknown> = Promise.resolve();
  private ocioso: NodeJS.Timeout | null = null;
  ultimoErro: string | null = null;

  /**
   * Depois deste tempo sem pedidos o processo é encerrado e o modelo sai da
   * memória (1–3 GB em CPU). O próximo pedido o sobe de novo — paga a carga
   * outra vez, mas o computador do paciente não fica com 3 GB presos por um
   * módulo que ele usou de manhã.
   */
  static readonly OCIOSO_MS = 15 * 60_000;

  constructor(
    private readonly onde: LocalizacaoDoMotor,
    private readonly ambiente: Record<string, string>,
    private readonly aoEvento: (e: EventoDoMotor) => void,
    private readonly aoMudar: () => void,
  ) {}

  get vivo(): boolean {
    return this.processo !== null && this.processo.exitCode === null;
  }

  get emErro(): boolean {
    return this.quedas >= 3;
  }

  private subir(): void {
    if (this.vivo) return;
    if (this.emErro) throw new Error(this.ultimoErro ?? 'O motor de voz caiu repetidamente.');
    const p = spawn(this.onde.comando, this.onde.args, {
      cwd: this.onde.cwd,
      // PYTHONUTF8: no Windows o stdin/stdout de um processo com pipes usa a
      // página de código ANSI; "ção" chegaria como lixo e "Á" derrubaria o
      // leitor. O motor também reconfigura o stdin, mas cinto e suspensório.
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...this.ambiente },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.processo = p;
    this.resto = '';
    // Prioridade abaixo do normal (o motor também se rebaixa por dentro):
    // a síntese pode esperar; o rastreamento ocular e a interface, não. Sem
    // isto, carregar o modelo num computador de poucos núcleos congelava o
    // cursor de olhar por dezenas de segundos.
    if (p.pid) {
      try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sem permissão: segue */ }
    }
    // EPIPE entre a morte do filho e o `exit`: sem ouvinte, vira exceção não
    // tratada no processo principal.
    p.stdin.on('error', (e) => console.warn('[voz] stdin do motor:', e.message));
    p.stdout.setEncoding('utf-8');
    p.stdout.on('data', (chunk: string) => this.aoReceber(chunk));
    p.stderr.setEncoding('utf-8');
    p.stderr.on('data', (chunk: string) => {
      const linhas = chunk.split(/\r?\n/).filter((l) => l.trim());
      for (const l of linhas) console.log(`[voz:py] ${l.slice(0, 400)}`);
    });
    p.on('error', (e) => {
      this.ultimoErro = `Não foi possível iniciar o motor de voz (${e.message}).`;
      console.error('[voz]', this.ultimoErro);
      this.derrubarPendentes(new Error(this.ultimoErro));
      this.processo = null;
      this.quedas++;
      this.aoMudar();
    });
    p.on('exit', (code, signal) => {
      if (this.processo === p) this.processo = null;
      const msg = `O motor de voz encerrou (código ${code ?? signal ?? '?'}).`;
      if (this.pendentes.size > 0) {
        this.ultimoErro = msg;
        this.quedas++;
      }
      this.derrubarPendentes(new Error(msg));
      this.aoMudar();
    });
    console.log(`[voz] motor iniciado via ${this.onde.origem}: ${this.onde.comando} ${this.onde.args.join(' ')}`);
    this.aoMudar();
  }

  private aoReceber(chunk: string): void {
    const { mensagens, resto } = separarLinhasJson(this.resto + chunk);
    this.resto = resto;
    for (const m of mensagens) {
      if (ehResposta(m)) {
        const pend = this.pendentes.get(m.id);
        if (!pend) continue;
        clearTimeout(pend.timer);
        this.pendentes.delete(m.id);
        this.quedas = 0;
        pend.resolver(m);
      } else if (ehEvento(m)) {
        this.aoEvento(m);
      }
    }
  }

  private derrubarPendentes(erro: Error): void {
    for (const [, pend] of this.pendentes) {
      clearTimeout(pend.timer);
      pend.rejeitar(erro);
    }
    this.pendentes.clear();
  }

  private rearmarOcioso(): void {
    if (this.ocioso) clearTimeout(this.ocioso);
    this.ocioso = setTimeout(() => {
      if (this.pendentes.size === 0) {
        console.log('[voz] motor ocioso: encerrando para liberar memória');
        this.encerrar();
      }
    }, Sidecar.OCIOSO_MS);
    this.ocioso.unref();
  }

  /** Enfileira um pedido (um por vez) e devolve a resposta. */
  pedir(pedido: PedidoSemId, timeoutMs: number): Promise<RespostaDoMotor> {
    const executar = () => new Promise<RespostaDoMotor>((resolver, rejeitar) => {
      try {
        this.subir();
        this.rearmarOcioso();
      } catch (e) {
        rejeitar(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const p = this.processo!;
      const id = this.proximoId++;
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        rejeitar(new Error(`O motor de voz não respondeu em ${Math.round(timeoutMs / 1000)} s (${pedido.cmd}).`));
        // Um pedido que não responde deixa o processo em estado desconhecido.
        this.encerrar();
      }, timeoutMs);
      this.pendentes.set(id, { resolver, rejeitar, timer });
      p.stdin.write(JSON.stringify({ id, ...pedido }) + '\n', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendentes.delete(id);
          rejeitar(err);
        }
      });
    });
    const proximo = this.fila.then(executar, executar);
    this.fila = proximo.catch(() => undefined);
    return proximo;
  }

  encerrar(): void {
    if (this.ocioso) { clearTimeout(this.ocioso); this.ocioso = null; }
    const p = this.processo;
    if (!p) return;
    this.processo = null;
    try {
      p.stdin.write(JSON.stringify({ id: 0, cmd: 'sair' }) + '\n');
      p.stdin.end();
    } catch { /* já morreu */ }
    setTimeout(() => { if (p.exitCode === null) p.kill(); }, 1500).unref();
  }
}
