/**
 * A voz do paciente: um ponto de entrada para tudo que o app fala EM NOME
 * DELE (teclado, frases, pictogramas, respostas ao cuidador).
 *
 *   falar(texto) → voz clonada local, se estiver pronta e liberada;
 *                  senão, voz do sistema. Nunca lança; sempre fala com
 *                  alguma voz ou explica por que não falou.
 *
 * Alarmes (emergência) e a leitura das mensagens do CUIDADOR não passam por
 * aqui de propósito: não são a fala do paciente e não devem sair na voz dele
 * — chamam `falarComVozDoSistema` direto.
 *
 * O estado do motor (voz importada? ativa? modelo baixado?) vem do processo
 * principal e é espelhado aqui para as telas, com um hook.
 */

import { useEffect, useState } from 'react';
import type { EstadoDoMotorDeVoz } from '@tracker/voz/protocolo';
import { LICENSE_KEY } from '../../context/LicenseContext';
import type { Plan } from '../license/types';
import { pararVozClonada, ponteDaVoz, tocarWav, type PonteDaVoz } from './local';
import { falarComVozDoSistema, pararVozDoSistema, type OpcoesDaVozDoSistema } from './sistema';

export type OrigemDaVoz = 'clonada' | 'sistema' | 'nenhuma';

export interface OpcoesDeFala extends OpcoesDaVozDoSistema {
  /** Força a voz do sistema mesmo com a clonada pronta. */
  sistema?: boolean;
}

export interface ResultadoDaFala {
  origem: OrigemDaVoz;
  /** Por que a clonada não foi usada, quando havia intenção de usá-la. */
  motivo?: string;
}

// ---------------------------------------------------------------------------
// Estado do motor, espelhado do main.
// ---------------------------------------------------------------------------

let estadoAtual: EstadoDoMotorDeVoz | null = null;
let cancelarAssinatura: (() => void) | null = null;
let carregando: Promise<void> | null = null;
const ouvintes = new Set<(e: EstadoDoMotorDeVoz | null) => void>();

function notificar(): void {
  for (const cb of ouvintes) {
    try { cb(estadoAtual); } catch (e) { console.error('[voz] ouvinte lançou', e); }
  }
}

/** Garante a assinatura do estado e a primeira leitura. Idempotente. */
export function acompanharEstadoDaVoz(ponte: PonteDaVoz | null = ponteDaVoz()): Promise<void> {
  if (!ponte) return Promise.resolve();
  if (!cancelarAssinatura) {
    cancelarAssinatura = ponte.onEstado((e) => { estadoAtual = e; notificar(); });
  }
  if (!carregando) {
    carregando = ponte.estado().then((e) => { estadoAtual = e; notificar(); }).catch(() => undefined);
  }
  return carregando;
}

export function estadoDaVoz(): EstadoDoMotorDeVoz | null {
  return estadoAtual;
}

export function assinarEstadoDaVoz(cb: (e: EstadoDoMotorDeVoz | null) => void): () => void {
  ouvintes.add(cb);
  void acompanharEstadoDaVoz();
  return () => { ouvintes.delete(cb); };
}

/** Hook para telas: `null` até a primeira resposta do main (ou fora do Electron). */
export function useEstadoDaVoz(): EstadoDoMotorDeVoz | null {
  const [estado, setEstado] = useState<EstadoDoMotorDeVoz | null>(estadoAtual);
  useEffect(() => assinarEstadoDaVoz(setEstado), []);
  return estado;
}

// ---------------------------------------------------------------------------
// Licença.
// ---------------------------------------------------------------------------

/**
 * O plano inclui voz clonada? Lê a licença gravada pelo `LicenseContext`.
 * Sem `features` (mock, cache antigo) trata como liberado — é o cache de uma
 * licença válida, e negar um recurso por falta de metadado puniria o paciente.
 */
export function vozClonadaLiberadaPelaLicenca(): boolean {
  try {
    const raw = localStorage.getItem(LICENSE_KEY);
    if (!raw) return true;
    const plan = (JSON.parse(raw) as { plan?: Plan }).plan;
    const voz = plan?.features?.voz;
    return voz === undefined ? true : voz === true;
  } catch {
    return true;
  }
}

/** Voz clonada pronta para falar agora. */
export function vozClonadaPronta(e: EstadoDoMotorDeVoz | null = estadoAtual): boolean {
  return !!e && e.disponivel && e.voz.importada && e.ativa && e.motor !== 'erro' && vozClonadaLiberadaPelaLicenca();
}

// ---------------------------------------------------------------------------
// Falar.
// ---------------------------------------------------------------------------

export function pararFala(): void {
  pararVozClonada();
  pararVozDoSistema();
}

/**
 * Quanto o paciente espera pela voz clonada antes de o app falar com a voz do
 * sistema. Frases já ditas saem do cache na hora; uma frase nova em CPU pode
 * levar 3–8 s (mais a carga do modelo na primeira vez), e ficar mudo esse
 * tempo é pior do que falar com a outra voz. A geração continua em segundo
 * plano: na próxima vez a frase sai clonada.
 */
export const ORCAMENTO_DA_VOZ_CLONADA_MS = 2_500;

/** Contador de falas: uma fala nova invalida a anterior (a última vence). */
let turno = 0;

const esperar = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms));

export async function falar(texto: string, opcoes: OpcoesDeFala = {}): Promise<ResultadoDaFala> {
  const t = texto.trim();
  if (!t) return { origem: 'nenhuma', motivo: 'texto vazio' };
  const meuTurno = ++turno;
  pararFala();
  // Primeira fala do app: o espelho do estado pode ainda não ter chegado.
  if (!opcoes.sistema && estadoAtual === null) await acompanharEstadoDaVoz();
  const ponte = ponteDaVoz();

  if (!opcoes.sistema && ponte && vozClonadaPronta()) {
    // 1. Já está no cache? Toca na hora.
    const emCache = await ponte.sintetizar(t, { soCache: true });
    if (turno !== meuTurno) return { origem: 'nenhuma', motivo: 'substituida' };
    if (emCache.ok) {
      try {
        await tocarWav(emCache.wav);
        return { origem: 'clonada' };
      } catch (e) {
        console.warn('[voz] falha ao tocar o cache, usando a voz do sistema:', e);
      }
    } else if (emCache.motivo === 'nao_em_cache') {
      // 2. Gera com prazo. Dentro do prazo, toca clonada; fora dele, fala com
      //    o sistema agora e deixa a geração terminar para o cache.
      const geracao = ponte.sintetizar(t);
      const vencedor = await Promise.race([geracao.then((r) => ({ r })), esperar(ORCAMENTO_DA_VOZ_CLONADA_MS)]);
      if (turno !== meuTurno) {
        geracao.catch(() => undefined);
        return { origem: 'nenhuma', motivo: 'substituida' };
      }
      if (vencedor && vencedor.r.ok) {
        try {
          await tocarWav(vencedor.r.wav);
          return { origem: 'clonada' };
        } catch (e) {
          console.warn('[voz] falha ao tocar, usando a voz do sistema:', e);
        }
      } else if (vencedor && !vencedor.r.ok) {
        const falha = vencedor.r;
        console.warn('[voz] clonada indisponível, usando a voz do sistema:', falha.motivo, falha.erro ?? '');
        await falarComVozDoSistema(t, opcoes);
        return { origem: 'sistema', motivo: falha.motivo };
      } else if (!vencedor) {
        geracao.catch(() => undefined);
        await falarComVozDoSistema(t, opcoes);
        return { origem: 'sistema', motivo: 'demorou' };
      }
    } else {
      console.warn('[voz] clonada indisponível, usando a voz do sistema:', emCache.motivo, emCache.erro ?? '');
      await falarComVozDoSistema(t, opcoes);
      return { origem: 'sistema', motivo: emCache.motivo };
    }
  }

  if (turno !== meuTurno) return { origem: 'nenhuma', motivo: 'substituida' };
  await falarComVozDoSistema(t, opcoes);
  return { origem: 'sistema' };
}

/**
 * Sintetiza frases em segundo plano, sem tocar, para o cache: frases rápidas
 * e pictogramas saem instantâneos na primeira vez que o paciente as usa.
 * Uma por vez, e para de tentar no primeiro erro do motor.
 */
export async function aquecerCache(textos: string[], ponte: PonteDaVoz | null = ponteDaVoz()): Promise<number> {
  if (!ponte || !vozClonadaPronta()) return 0;
  let feitas = 0;
  for (const texto of textos) {
    const t = texto.trim();
    if (!t) continue;
    const r = await ponte.sintetizar(t);
    if (!r.ok) {
      if (r.motivo === 'motor' || r.motivo === 'sem_modelo' || r.motivo === 'indisponivel') break;
      continue;
    }
    feitas++;
  }
  return feitas;
}

/** Só para testes: zera o espelho do estado. */
export function _redefinirVoz(): void {
  estadoAtual = null;
  cancelarAssinatura?.();
  cancelarAssinatura = null;
  carregando = null;
  ouvintes.clear();
}
