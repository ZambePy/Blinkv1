/**
 * Voz clonada local — lado do processo principal.
 *
 * Guarda tudo em `userData/voz/`:
 *   referencia.wav        áudio de referência já preparado (24 kHz mono)
 *   referencia.json       duração, qualidade, avisos, nome do arquivo original,
 *                         consentimento (texto aceito, quando, por qual perfil)
 *   estado.json           { ativa }
 *   cache/<sha256>.wav    frases já sintetizadas (chave = voz + texto)
 *   modelos/              pesos do Hugging Face (HF_HOME)
 *
 * O arquivo original escolhido pelo cuidador NÃO é copiado: só a versão
 * preparada fica no app, e apagar a voz apaga referência, metadados e cache.
 *
 * Fluxo de uma fala: renderer pede `sintetizar(texto)` → cache? devolve o WAV
 * → senão manda `falar` ao sidecar, grava no cache e devolve. O renderer toca
 * com Web Audio. Emergência e mensagens do cuidador não passam por aqui (voz
 * do sistema, de propósito).
 */

import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CANAIS_VOZ,
  classificarReferencia,
  normalizarTextoParaFala,
  type EstadoDoMotorDeVoz,
  type EventoDoMotor,
  type OpcoesDeSintese,
  type QualidadeDaReferencia,
  type ResultadoDaImportacao,
  type ResultadoDaSintese,
} from '../../src/voz/protocolo';
import { localizarMotor, Sidecar } from './sidecar';

interface MetaDaReferencia {
  duracaoS: number;
  qualidade: QualidadeDaReferencia;
  avisos: string[];
  snrDb: number | null;
  importadaEm: string;
  nomeDoArquivo: string;
  consentimento: { texto: string; hash: string; aceitoEm: string; perfilId: string | null };
  /** Identidade da voz para a chave de cache: muda a cada importação. */
  vozId: string;
}

const CACHE_MAX_MB = 300;
const TIMEOUTS = { status: 60_000, baixar: 60 * 60_000, preparar: 180_000, falar: 240_000 } as const;

export function registrarVoz(opcoes: { raizDoProjeto: string; janelaPrincipal: () => BrowserWindow | null }): { encerrar: () => void } {
  const pasta = path.join(app.getPath('userData'), 'voz');
  const caminhos = {
    referencia: path.join(pasta, 'referencia.wav'),
    meta: path.join(pasta, 'referencia.json'),
    estado: path.join(pasta, 'estado.json'),
    cache: path.join(pasta, 'cache'),
    modelos: path.join(pasta, 'modelos'),
    temp: path.join(pasta, 'tmp'),
  };
  for (const p of [pasta, caminhos.cache, caminhos.modelos, caminhos.temp]) fs.mkdirSync(p, { recursive: true });

  const onde = localizarMotor({ empacotado: app.isPackaged, resourcesPath: process.resourcesPath, raizDoProjeto: opcoes.raizDoProjeto });

  let estado: EstadoDoMotorDeVoz = {
    disponivel: onde !== null,
    indisponivelPorque: onde
      ? undefined
      : app.isPackaged
        ? 'Este instalador veio sem o motor de voz. Gere-o com voice-engine/build-voice-engine.ps1 e reempacote o app.'
        : 'Motor de voz não encontrado: instale o Python 3.11 e rode `pip install -r voice-engine/requirements.txt` (ver README).',
    motor: 'parado',
    modelo: { baixado: false, baixando: false, progresso: null },
    dispositivo: null,
    voz: { importada: false },
    ativa: false,
    cache: { itens: 0, mb: 0 },
    sintetizando: false,
  };

  const lerJson = <T,>(arquivo: string): T | null => {
    try {
      return JSON.parse(fs.readFileSync(arquivo, 'utf-8')) as T;
    } catch {
      return null;
    }
  };
  const gravarJson = (arquivo: string, v: unknown) => fs.writeFileSync(arquivo, JSON.stringify(v, null, 2), 'utf-8');

  const medirCache = (): { itens: number; mb: number } => {
    try {
      const nomes = fs.readdirSync(caminhos.cache).filter((n) => n.endsWith('.wav'));
      let bytes = 0;
      for (const n of nomes) bytes += fs.statSync(path.join(caminhos.cache, n)).size;
      return { itens: nomes.length, mb: Math.round((bytes / 1_048_576) * 10) / 10 };
    } catch {
      return { itens: 0, mb: 0 };
    }
  };

  const podarCache = () => {
    try {
      const itens = fs.readdirSync(caminhos.cache)
        .filter((n) => n.endsWith('.wav'))
        .map((n) => { const p = path.join(caminhos.cache, n); const s = fs.statSync(p); return { p, mtime: s.mtimeMs, size: s.size }; })
        .sort((a, b) => a.mtime - b.mtime);
      let total = itens.reduce((acc, i) => acc + i.size, 0);
      for (const i of itens) {
        if (total <= CACHE_MAX_MB * 1_048_576) break;
        fs.rmSync(i.p, { force: true });
        total -= i.size;
      }
    } catch { /* cache é descartável */ }
  };

  const meta = (): MetaDaReferencia | null => (fs.existsSync(caminhos.referencia) ? lerJson<MetaDaReferencia>(caminhos.meta) : null);

  const recarregarDoDisco = () => {
    const m = meta();
    const est = lerJson<{ ativa?: boolean }>(caminhos.estado);
    estado = {
      ...estado,
      voz: m
        ? { importada: true, duracaoS: m.duracaoS, qualidade: m.qualidade, avisos: m.avisos, importadaEm: m.importadaEm, nomeDoArquivo: m.nomeDoArquivo, consentimentoEm: m.consentimento?.aceitoEm }
        : { importada: false },
      ativa: !!m && est?.ativa === true,
      cache: medirCache(),
    };
  };
  recarregarDoDisco();

  const avisar = () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(CANAIS_VOZ.estadoMudou, estado);
    }
  };
  const patch = (p: Partial<EstadoDoMotorDeVoz>) => {
    estado = { ...estado, ...p };
    avisar();
  };

  const aoEvento = (e: EventoDoMotor) => {
    if (e.evento === 'progresso') {
      if (estado.modelo.baixando) {
        patch({ modelo: { ...estado.modelo, progresso: typeof e.pct === 'number' ? Math.round(e.pct) : null, etapa: e.etapa } });
      } else if (e.etapa) {
        patch({ modelo: { ...estado.modelo, etapa: e.etapa } });
      }
    }
  };

  const sidecar = onde
    ? new Sidecar(onde, { HF_HOME: caminhos.modelos, IRISFLOW_VOZ_DIR: pasta }, aoEvento, () => {
        patch({ motor: sidecar!.emErro ? 'erro' : sidecar!.vivo ? (estado.motor === 'pronto' ? 'pronto' : 'iniciando') : 'parado', erro: sidecar!.ultimoErro ?? undefined });
      })
    : null;

  async function consultarStatus(): Promise<void> {
    if (!sidecar) return;
    try {
      patch({ motor: 'iniciando' });
      const r = await sidecar.pedir({ cmd: 'status' }, TIMEOUTS.status);
      if (!r.ok) throw new Error(r.erro ?? 'status falhou');
      const mq = r.maquina as { memoria_total_gb?: number; memoria_livre_gb?: number; nucleos?: number } | undefined;
      patch({
        motor: 'pronto',
        erro: undefined,
        dispositivo: r.dispositivo === 'cuda' ? 'cuda' : r.dispositivo === 'cpu' ? 'cpu' : estado.dispositivo,
        modelo: { ...estado.modelo, baixado: r.modelo_baixado === true },
        maquina: mq && typeof mq.memoria_total_gb === 'number'
          ? { memoriaTotalGb: mq.memoria_total_gb, memoriaLivreGb: mq.memoria_livre_gb ?? 0, nucleos: mq.nucleos ?? 0 }
          : estado.maquina,
      });
    } catch (e) {
      patch({ motor: 'erro', erro: e instanceof Error ? e.message : String(e) });
    }
  }

  const hashDeTexto = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');

  async function sintetizar(texto: unknown, opcoesDeSintese: unknown): Promise<ResultadoDaSintese> {
    if (typeof texto !== 'string') return { ok: false, motivo: 'texto' };
    const soCache = !!opcoesDeSintese && typeof opcoesDeSintese === 'object' && (opcoesDeSintese as OpcoesDeSintese).soCache === true;
    const t = normalizarTextoParaFala(texto);
    if (!t) return { ok: false, motivo: 'texto' };
    if (!sidecar) return { ok: false, motivo: 'indisponivel', erro: estado.indisponivelPorque };
    const m = meta();
    if (!m) return { ok: false, motivo: 'sem_voz' };
    if (!estado.ativa) return { ok: false, motivo: 'inativa' };

    const chave = hashDeTexto(`${m.vozId}|${t}`);
    const arquivo = path.join(caminhos.cache, `${chave}.wav`);
    if (fs.existsSync(arquivo)) {
      const agora = new Date();
      try { fs.utimesSync(arquivo, agora, agora); } catch { /* só para o LRU */ }
      const buf = fs.readFileSync(arquivo);
      return { ok: true, wav: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), deCache: true, ms: 0 };
    }
    // Só o cache: o renderer decide se vale esperar a geração ou falar com a
    // voz do sistema agora e deixar esta frase pronta para a próxima vez.
    if (soCache) return { ok: false, motivo: 'nao_em_cache' };

    if (!estado.modelo.baixado) {
      await consultarStatus();
      if (!estado.modelo.baixado) return { ok: false, motivo: 'sem_modelo' };
    }

    patch({ sintetizando: true });
    const inicio = Date.now();
    const temp = path.join(caminhos.temp, `${chave}.part.wav`);
    try {
      const r = await sidecar.pedir({ cmd: 'falar', texto: t, referencia: caminhos.referencia, saida: temp, idioma: 'pt' }, TIMEOUTS.falar);
      if (!r.ok) return { ok: false, motivo: 'motor', erro: r.erro };
      fs.renameSync(temp, arquivo);
      podarCache();
      patch({ motor: 'pronto', erro: undefined, cache: medirCache(), dispositivo: r.dispositivo === 'cuda' ? 'cuda' : r.dispositivo === 'cpu' ? 'cpu' : estado.dispositivo });
      const buf = fs.readFileSync(arquivo);
      return { ok: true, wav: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), deCache: false, ms: Date.now() - inicio };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patch({ motor: sidecar.emErro ? 'erro' : estado.motor, erro: msg });
      return { ok: false, motivo: 'motor', erro: msg };
    } finally {
      patch({ sintetizando: false });
      fs.rmSync(temp, { force: true });
    }
  }

  async function importar(evento: IpcMainInvokeEvent, consentimento: unknown): Promise<ResultadoDaImportacao> {
    if (!sidecar) return { ok: false, erro: estado.indisponivelPorque ?? 'Motor de voz indisponível.' };
    const c = consentimento as { texto?: unknown; aceitoEm?: unknown; perfilId?: unknown } | null;
    if (!c || typeof c.texto !== 'string' || c.texto.length < 40 || typeof c.aceitoEm !== 'string') {
      return { ok: false, erro: 'A importação exige o termo de consentimento aceito.' };
    }
    const janela = BrowserWindow.fromWebContents(evento.sender) ?? undefined;
    const escolha = await dialog.showOpenDialog(janela!, {
      title: 'Escolher o áudio com a voz do paciente',
      properties: ['openFile'],
      filters: [
        { name: 'Áudio e vídeo', extensions: ['wav', 'mp3', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'mp4', 'webm', 'mkv', 'mov', '3gp', 'amr', 'wma'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    });
    if (escolha.canceled || escolha.filePaths.length === 0) return { ok: false, erro: 'Nenhum arquivo escolhido.', cancelado: true };
    const origem = escolha.filePaths[0];

    const temp = path.join(caminhos.temp, 'referencia.part.wav');
    try {
      patch({ motor: estado.motor === 'pronto' ? 'pronto' : 'iniciando' });
      const r = await sidecar.pedir({ cmd: 'preparar_referencia', entrada: origem, saida: temp }, TIMEOUTS.preparar);
      if (!r.ok) return { ok: false, erro: r.erro ?? 'O preparo do áudio falhou.' };
      const duracaoS = Number(r.duracao_util_s ?? 0);
      const snrDb = typeof r.snr_db === 'number' ? r.snr_db : null;
      const qualidade = classificarReferencia(duracaoS, snrDb);
      const avisos = Array.isArray(r.avisos) ? r.avisos.map(String) : [];

      // Troca atômica: a referência antiga só some quando a nova está pronta.
      fs.renameSync(temp, caminhos.referencia);
      const m: MetaDaReferencia = {
        duracaoS,
        qualidade,
        avisos,
        snrDb,
        importadaEm: new Date().toISOString(),
        nomeDoArquivo: path.basename(origem),
        consentimento: { texto: c.texto, hash: hashDeTexto(c.texto), aceitoEm: c.aceitoEm, perfilId: typeof c.perfilId === 'string' ? c.perfilId : null },
        vozId: createHash('sha256').update(fs.readFileSync(caminhos.referencia)).digest('hex').slice(0, 16),
      };
      gravarJson(caminhos.meta, m);
      // Voz nova: o cache da anterior não serve mais.
      fs.rmSync(caminhos.cache, { recursive: true, force: true });
      fs.mkdirSync(caminhos.cache, { recursive: true });
      gravarJson(caminhos.estado, { ativa: true });
      recarregarDoDisco();
      patch({ motor: 'pronto', erro: undefined });
      return { ok: true, duracaoS, qualidade, avisos };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patch({ erro: msg });
      return { ok: false, erro: msg };
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  async function baixarModelo(): Promise<{ ok: boolean; erro?: string }> {
    if (!sidecar) return { ok: false, erro: estado.indisponivelPorque };
    if (estado.modelo.baixando) return { ok: true };
    patch({ modelo: { ...estado.modelo, baixando: true, progresso: 0, etapa: 'iniciando' } });
    try {
      const r = await sidecar.pedir({ cmd: 'baixar_modelo' }, TIMEOUTS.baixar);
      if (!r.ok) throw new Error(r.erro ?? 'download falhou');
      patch({ modelo: { baixado: true, baixando: false, progresso: null }, motor: 'pronto', erro: undefined });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patch({ modelo: { ...estado.modelo, baixando: false, progresso: null }, erro: msg });
      return { ok: false, erro: msg };
    }
  }

  function remover(): void {
    for (const p of [caminhos.referencia, caminhos.meta, caminhos.estado]) fs.rmSync(p, { force: true });
    fs.rmSync(caminhos.cache, { recursive: true, force: true });
    fs.mkdirSync(caminhos.cache, { recursive: true });
    recarregarDoDisco();
    avisar();
  }

  // Só a janela do app fala com o motor. A sobreposição do Modo Computador
  // tem preload próprio sem esta ponte, mas a checagem de remetente vale para
  // qualquer janela que venha a existir.
  const daJanelaPrincipal = (e: IpcMainInvokeEvent): boolean => {
    const j = opcoes.janelaPrincipal();
    return !!j && !j.isDestroyed() && e.sender === j.webContents;
  };
  const protegido = <A extends unknown[], R>(fn: (e: IpcMainInvokeEvent, ...args: A) => R, recusa: R) =>
    (e: IpcMainInvokeEvent, ...args: A): R => (daJanelaPrincipal(e) ? fn(e, ...args) : recusa);

  // `estado` NÃO acorda o motor: subir um processo Python com o torch a cada
  // abertura do app, só para dizer "nenhuma voz importada", custaria centenas
  // de MB e CPU durante a calibração. O motor só é sondado quando há voz
  // importada e ativa (vai ser usada) ou quando a tela de Voz pede (`sondar`).
  ipcMain.handle(CANAIS_VOZ.estado, protegido(async () => {
    if (sidecar && estado.motor === 'parado' && estado.voz.importada && estado.ativa) void consultarStatus();
    return estado;
  }, Promise.resolve(estado)));
  ipcMain.handle(CANAIS_VOZ.sondar, protegido(async () => {
    if (sidecar && (estado.motor === 'parado' || estado.motor === 'erro')) await consultarStatus();
    return estado;
  }, Promise.resolve(estado)));
  ipcMain.handle(CANAIS_VOZ.importar, protegido(importar, Promise.resolve({ ok: false, erro: 'Origem não autorizada.' } as ResultadoDaImportacao)));
  ipcMain.handle(CANAIS_VOZ.remover, protegido(() => remover(), undefined));
  ipcMain.handle(CANAIS_VOZ.baixarModelo, protegido(() => baixarModelo(), Promise.resolve({ ok: false, erro: 'Origem não autorizada.' })));
  ipcMain.handle(CANAIS_VOZ.sintetizar, protegido((_e, texto: unknown, o: unknown) => sintetizar(texto, o), Promise.resolve({ ok: false, motivo: 'indisponivel' } as ResultadoDaSintese)));
  ipcMain.handle(CANAIS_VOZ.ativar, protegido((_e, ligado: unknown) => {
    if (!meta()) return;
    gravarJson(caminhos.estado, { ativa: ligado === true });
    recarregarDoDisco();
    avisar();
  }, undefined));

  return { encerrar: () => sidecar?.encerrar() };
}
