/**
 * Cliente da Edge Function `desktop-sync` — o canal de ESCRITA do desktop.
 *
 * Por que uma função e não escrever direto nas tabelas? Porque o mesmo usuário
 * (a conta da família) é o cuidador no celular e o paciente no computador. O
 * banco não tem como saber quem está falando pela sessão; a chave do
 * computador (`x-device-key`, obtida em `pair_device()`) é o que identifica
 * "isto veio do desktop do paciente". A função força `sender = 'paciente'`,
 * amarra a sessão ao `device_id` e dispara o push do cuidador.
 *
 * Contrato (espelho de irisflow-cuidador/supabase/functions/desktop-sync/index.ts):
 *   heartbeat, session.upsert, session.end, calibration.result, message.send,
 *   message.spoken, messages.pending, help.create, settings.get, device.info
 *
 * Fila offline: o que não puder ser enviado (sem rede, função fora) fica em
 * `irisflow.fila` e é reenviado na ordem quando a conexão volta. Pedidos de
 * socorro e mensagens nunca são descartados; heartbeat não entra na fila
 * (o próximo substitui).
 */
import { cloudConfig } from './config';
import { cofre, CHAVES } from './armazenamento';
import type { Message, PatientSettings, QuickPhrase, SessaoRemota, HelpKind, MessageKind } from './types';

export type AcaoSync =
  | { action: 'heartbeat'; app_version: string; camera_ok: boolean; tracker_ok: boolean; calibrated: boolean }
  | { action: 'session.upsert'; session: SessaoRemota }
  | { action: 'session.end'; session_id: string; utterances?: number; chars_typed?: number; modules_used?: string[] }
  | { action: 'calibration.result'; session_id?: string; calibration: SessaoRemota; report: SessaoRemota['accuracy_report'] }
  | { action: 'message.send'; text: string; kind: MessageKind }
  | { action: 'message.spoken'; message_id: string }
  | { action: 'messages.pending' }
  | { action: 'help.create'; kind: HelpKind; message: string; session_id?: string | null }
  | { action: 'settings.get' }
  /** Rótulo da voz em uso, para o app do cuidador mostrar em Ajustes → Voz. */
  | { action: 'voice.status'; voice: string }
  | { action: 'device.info' };

export interface RespostaSync {
  ok?: boolean;
  id?: string;
  error?: string;
  pending_messages?: number;
  messages?: Message[];
  settings?: PatientSettings | null;
  phrases?: QuickPhrase[];
  device?: { id: string; name: string; os: string; app_version: string };
  beneficiary?: { id: string; user_name: string } | null;
}

export class ErroDeSync extends Error {
  readonly status: number;
  readonly codigo?: string;
  constructor(status: number, message: string, codigo?: string) {
    super(message);
    this.name = 'ErroDeSync';
    this.status = status;
    this.codigo = codigo;
  }
  /**
   * A chave não vale mais (revogada ou apagada) — não adianta reenviar. Só os
   * códigos que a PRÓPRIA função devolve contam: um 401 do gateway do Supabase
   * ("Missing authorization header", função publicada com verify_jwt) é
   * problema de implantação, não de credencial, e vai para a fila.
   */
  get credencialInvalida(): boolean {
    return (this.status === 401 || this.status === 403)
      && (this.codigo === 'unauthorized' || this.codigo === 'device_revoked');
  }
  /** Erro do nosso payload (400, 404, 413…): reenviar igual não resolve. 401/403/429 não são definitivos. */
  get definitivo(): boolean {
    return this.status >= 400 && this.status < 500
      && this.status !== 401 && this.status !== 403 && this.status !== 429;
  }
}

interface ItemDaFila {
  acao: AcaoSync;
  criadoEm: string;
  tentativas: number;
}

/**
 * Ações que valem a pena guardar para depois. `session.upsert` fica de fora:
 * a resposta (o id da sessão) é o que importa, e uma abertura reenviada horas
 * depois só criaria uma sessão órfã — quem reabre é o CloudProvider quando a
 * rede volta.
 */
const ENFILEIRAVEIS = new Set<AcaoSync['action']>([
  'session.end', 'calibration.result', 'message.send', 'message.spoken', 'help.create', 'voice.status',
]);
const MAX_FILA = 200;

export interface OpcoesSync {
  url?: string;
  chave: () => string | null;
  /** Chave anônima do projeto: o gateway do Supabase exige um JWT válido antes de entregar à função. */
  anonKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Chamado quando a chave é recusada (dispositivo revogado). */
  aoPerderCredencial?: () => void;
}

export class DesktopSync {
  private fila: ItemDaFila[] = [];
  private filaCarregada = false;
  private drenando = false;
  private readonly op: OpcoesSync;
  private readonly url: string;
  private readonly anonKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(op: OpcoesSync) {
    this.op = op;
    this.url = op.url ?? cloudConfig.desktopSyncUrl;
    this.anonKey = op.anonKey ?? cloudConfig.anonKey;
    this.fetchImpl = op.fetchImpl ?? ((...a) => fetch(...a));
    this.timeoutMs = op.timeoutMs ?? 10_000;
  }

  get tamanhoDaFila(): number {
    return this.fila.length;
  }

  /**
   * Envia agora. Se falhar por rede/servidor e a ação for enfileirável, guarda
   * e resolve com `{ ok: false, error }` em vez de lançar: a tela do paciente
   * não deve saber que a internet caiu.
   */
  async enviar(acao: AcaoSync): Promise<RespostaSync> {
    const chave = this.op.chave();
    if (!chave || !this.url) {
      if (ENFILEIRAVEIS.has(acao.action)) await this.enfileirar(acao).catch(() => undefined);
      return { ok: false, error: 'sem_vinculo' };
    }
    try {
      const resposta = await this.chamar(acao, chave);
      // conexão está boa: aproveita para drenar o que ficou pendente
      if (this.fila.length) void this.drenar();
      return resposta;
    } catch (e) {
      if (e instanceof ErroDeSync && e.credencialInvalida) {
        this.op.aoPerderCredencial?.();
        return { ok: false, error: e.codigo ?? 'unauthorized' };
      }
      if (e instanceof ErroDeSync && e.definitivo) {
        // erro de payload: reenviar não resolve
        console.warn(`[cloud] ${acao.action} rejeitada: ${e.message}`);
        return { ok: false, error: e.message };
      }
      // rede, servidor fora, gateway sem JWT, limite de taxa: tenta depois
      if (ENFILEIRAVEIS.has(acao.action)) await this.enfileirar(acao).catch(() => undefined);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Esvazia a fila (ao sair da conta: o que ficou não pode ir parar em outra). */
  async limparFila(): Promise<void> {
    this.fila = [];
    this.filaCarregada = true;
    await cofre.remover(CHAVES.filaDeEnvio);
  }

  /** Cabeçalhos de toda chamada: JWT anônimo para o gateway + chave do computador para a função. */
  cabecalhos(chave: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-device-key': chave,
      ...(this.anonKey ? { apikey: this.anonKey, authorization: `Bearer ${this.anonKey}` } : {}),
    };
  }

  /** Reenvia a fila na ordem. Para na primeira falha de rede. */
  async drenar(): Promise<number> {
    if (this.drenando) return 0;
    this.drenando = true;
    let enviados = 0;
    try {
      await this.carregarFila();
      const chave = this.op.chave();
      if (!chave || !this.url) return 0;
      while (this.fila.length) {
        const item = this.fila[0];
        try {
          await this.chamar(item.acao, chave);
          this.fila.shift();
          enviados++;
        } catch (e) {
          if (e instanceof ErroDeSync && e.credencialInvalida) {
            this.op.aoPerderCredencial?.();
            break;
          }
          if (e instanceof ErroDeSync && e.definitivo) {
            // payload inválido: descarta para não travar a fila inteira
            console.warn(`[cloud] descartando ${item.acao.action} da fila: ${e.message}`);
            this.fila.shift();
            continue;
          }
          item.tentativas++;
          break;
        }
      }
      await this.persistirFila();
      return enviados;
    } finally {
      this.drenando = false;
    }
  }

  private async chamar(acao: AcaoSync, chave: string): Promise<RespostaSync> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: this.cabecalhos(chave),
        body: JSON.stringify(acao),
        signal: controller.signal,
      });
      let corpo: RespostaSync = {};
      try { corpo = (await res.json()) as RespostaSync; } catch { /* sem corpo */ }
      if (!res.ok) throw new ErroDeSync(res.status, corpo.error ?? `HTTP ${res.status}`, corpo.error);
      return corpo;
    } finally {
      clearTimeout(timer);
    }
  }

  private async enfileirar(acao: AcaoSync): Promise<void> {
    await this.carregarFila();
    this.fila.push({ acao, criadoEm: new Date().toISOString(), tentativas: 0 });
    if (this.fila.length > MAX_FILA) {
      // nunca descarta socorro nem mensagens: tira o item mais antigo que não seja um deles
      const i = this.fila.findIndex((it) => it.acao.action !== 'help.create' && it.acao.action !== 'message.send');
      this.fila.splice(i >= 0 ? i : 0, 1);
    }
    await this.persistirFila();
  }

  private async carregarFila(): Promise<void> {
    if (this.filaCarregada) return;
    this.filaCarregada = true;
    const salva = await cofre.lerJson<ItemDaFila[]>(CHAVES.filaDeEnvio);
    if (Array.isArray(salva)) this.fila = [...salva, ...this.fila];
  }

  private async persistirFila(): Promise<void> {
    if (this.fila.length) await cofre.gravarJson(CHAVES.filaDeEnvio, this.fila);
    else await cofre.remover(CHAVES.filaDeEnvio);
  }

  /** Só para testes. */
  _fila(): readonly ItemDaFila[] {
    return this.fila;
  }
}
