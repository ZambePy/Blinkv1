/**
 * Voz CLONADA local: pede o WAV ao processo principal (que fala com o motor
 * Python) e toca com Web Audio.
 *
 * O renderer nunca vê o modelo nem o áudio de referência — só o WAV da frase
 * pedida. Tocar com `AudioContext` em vez de `<audio src=blob:>` evita criar
 * URLs de blob que ficariam vivas até o `revokeObjectURL`, e dá um `stop()`
 * imediato quando o paciente manda outra frase no meio da anterior.
 */

import type { EstadoDoMotorDeVoz, MotivoSemVoz, OpcoesDeSintese, ResultadoDaImportacao, ResultadoDaSintese } from '@tracker/voz/protocolo';

export interface PonteDaVoz {
  estado: () => Promise<EstadoDoMotorDeVoz>;
  onEstado: (cb: (e: EstadoDoMotorDeVoz) => void) => () => void;
  importar: (consentimento: { texto: string; aceitoEm: string; perfilId: string | null }) => Promise<ResultadoDaImportacao>;
  remover: () => Promise<void>;
  baixarModelo: () => Promise<{ ok: boolean; erro?: string }>;
  sintetizar: (texto: string, opcoes?: OpcoesDeSintese) => Promise<ResultadoDaSintese>;
  sondar: () => Promise<EstadoDoMotorDeVoz>;
  ativar: (ligado: boolean) => Promise<void>;
}

/** `null` fora do Electron. */
export function ponteDaVoz(w: Window | undefined = typeof window === 'undefined' ? undefined : window): PonteDaVoz | null {
  if (!w) return null;
  return (w as unknown as { irisflowVoz?: PonteDaVoz }).irisflowVoz ?? null;
}

let contexto: AudioContext | null = null;
let tocando: AudioBufferSourceNode | null = null;
/** Resolve a promessa da fala em curso quando ela é interrompida. */
let encerrarTocando: (() => void) | null = null;

function contextoDeAudio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!contexto) contexto = new AudioContext();
  return contexto;
}

export function pararVozClonada(): void {
  const fim = encerrarTocando;
  encerrarTocando = null;
  if (tocando) {
    try {
      tocando.onended = null;
      tocando.stop();
    } catch { /* já parou */ }
    tocando = null;
  }
  // Quem estava esperando a fala terminar não pode ficar pendurado: uma
  // interrupção é um fim como outro qualquer para o chamador.
  fim?.();
}

/** Toca um WAV (ArrayBuffer) e resolve quando termina. */
export function tocarWav(wav: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ctx = contextoDeAudio();
    if (!ctx) { reject(new Error('Web Audio indisponível.')); return; }
    pararVozClonada();
    const retomar = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    void retomar
      .then(() => ctx.decodeAudioData(wav.slice(0)))
      .then((buffer) => {
        const fonte = ctx.createBufferSource();
        fonte.buffer = buffer;
        fonte.connect(ctx.destination);
        const terminar = () => {
          if (tocando === fonte) tocando = null;
          if (encerrarTocando === terminar) encerrarTocando = null;
          resolve();
        };
        fonte.onended = terminar;
        tocando = fonte;
        encerrarTocando = terminar;
        fonte.start();
      })
      .catch(reject);
  });
}

export type FalaClonada =
  | { ok: true; deCache: boolean; ms: number }
  | { ok: false; motivo: MotivoSemVoz; erro?: string };

/** Sintetiza e toca. Não cai para a voz do sistema: quem decide isso é `index.ts`. */
export async function falarComVozClonada(texto: string, ponte: PonteDaVoz | null = ponteDaVoz()): Promise<FalaClonada> {
  if (!ponte) return { ok: false, motivo: 'indisponivel' };
  const r = await ponte.sintetizar(texto);
  if (!r.ok) return { ok: false, motivo: r.motivo, erro: r.erro };
  try {
    await tocarWav(r.wav);
    return { ok: true, deCache: r.deCache, ms: r.ms };
  } catch (e) {
    return { ok: false, motivo: 'motor', erro: e instanceof Error ? e.message : String(e) };
  }
}
