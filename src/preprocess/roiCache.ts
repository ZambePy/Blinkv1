// P4.8 — ROI dinâmico: reutilizar o crop quando a cabeça não mexeu.
//
// ── A economia é uma HIPÓTESE a medir, não um resultado ──────────────────────
//
// A especificação promete 40%. O crop custa ~1–2 ms; o L2CS custa 300+ ms. Se o
// reuso do crop não reduzir o número de INFERÊNCIAS, o ganho relativo no
// pipeline é da ordem de 0,5%. Quem responde é `T0.5` com a flag ligada e
// desligada, em runtime real. Este módulo decide; ele não afirma ganho.
//
// ── Por que três guardas e não só o ângulo ───────────────────────────────────
//
// Reutilizar por "pose parada" sozinho é uma armadilha, e ela é específica
// deste produto:
//
//   • TRANSLAÇÃO não é rotação. O paciente escorrega na cadeira, ou a cadeira
//     anda. A pose (yaw/pitch) não muda, o crop reusado passa a enquadrar outra
//     região, e o L2CS infere sobre o lugar errado — devolvendo um gaze que o
//     resto do sistema aceita como válido. Falha silenciosa, a categoria que
//     este repositório já pagou caro várias vezes.
//
//   • TEMPO. O público-alvo é ELA/ALS: cabeça parada por longos períodos é o
//     regime NORMAL, não a exceção. Sem teto de idade, um crop de 30 s atrás
//     continuaria alimentando o modelo enquanto a iluminação, a exposição
//     automática e o próprio paciente mudam.
//
//   • SKIP RATE. Mesmo com tudo parado, no máximo 2 reusos seguidos. É o piso
//     de frescor que a especificação pede (2 frames em 3) e o que impede que
//     um erro nas outras duas guardas se propague indefinidamente.
//
// A translação é medida em CENTÍMETROS, não em pixels, usando a mesma álgebra
// de `translationCompensation.ts` (onde o FOV cancela). Um limiar em px trataria
// como iguais um deslocamento com o rosto pequeno e outro com o rosto grande no
// frame — e invalidaria demais justamente quando o `cameraTuner` conseguisse
// aproximar a imagem.

import { deslocamentoCm } from '../translationCompensation';

const GRAUS = Math.PI / 180;

/** Giro máximo tolerado antes de recomputar. 2°, como a especificação. */
export const ROI_MAX_ANGLE_RAD = 2 * GRAUS;

/**
 * Idade máxima do ROI. 300 ms ≈ 9 frames a 30 fps, e é da ordem de uma cadência
 * do L2CS — reusar por mais que isso significaria alimentar o modelo com uma
 * geometria mais velha que a própria inferência.
 */
export const ROI_MAX_AGE_MS = 300;

/**
 * Deslocamento físico máximo do rosto antes de recomputar, em cm.
 *
 * 0,8 cm é ~9% da distância cantal (9,0 cm), que é aproximadamente o quanto o
 * bbox pode escorregar sem que a região de interesse mude de forma relevante
 * dentro de um crop expandido por `EXPAND_FACTOR = 1,4`.
 */
export const ROI_MAX_TRANSLATION_CM = 0.8;

/** Reusos seguidos permitidos. 2 → o 3º frame sempre recomputa (2 em 3). */
export const ROI_MAX_CONSECUTIVE_REUSES = 2;

export interface RoiPose {
  /** Radianos. */
  yaw: number;
  pitch: number;
  /** Não participa da decisão — ver `roll` nos testes. */
  roll?: number;
}

export interface RoiObservation {
  nowMs: number;
  pose: RoiPose;
  /** Centro facial normalizado (o landmark 1, ponta do nariz, como no engine). */
  faceCenter: { x: number; y: number };
  /** Distância cantal em px de vídeo (landmarks 33↔263). */
  iodPx: number;
  videoWidth: number;
  videoHeight: number;
}

export type RoiReason =
  | 'primeiro-frame'
  | 'reuso'
  | 'pose'
  | 'tempo'
  | 'translacao'
  | 'skip-esgotado'
  | 'dados-invalidos'
  | 'sem-roi';

export interface RoiDecision {
  reuse: boolean;
  reason: RoiReason;
  /** Reusos consecutivos ATÉ AQUI, já contando esta decisão. */
  consecutiveReuses: number;
  /** Idade do ROI vigente em ms, para o diagnóstico. */
  ageMs: number;
}

export interface RoiStats {
  decisions: number;
  reuses: number;
  refreshes: number;
  /** Fração de decisões que reusaram. */
  reuseRate: number;
  refreshByReason: Record<RoiReason, number>;
}

export interface RoiCacheOptions {
  maxAngleRad?: number;
  maxAgeMs?: number;
  maxTranslationCm?: number;
  maxConsecutiveReuses?: number;
  /**
   * Quando true, `decide` só devolve `reuse: true` se `store()` tiver sido
   * chamado. Existe porque anunciar reuso sem ter o que reusar faria o
   * chamador pular o crop e usar `null` como tensor.
   */
  requireStored?: boolean;
}

function reasonCounters(): Record<RoiReason, number> {
  return {
    'primeiro-frame': 0, reuso: 0, pose: 0, tempo: 0,
    translacao: 0, 'skip-esgotado': 0, 'dados-invalidos': 0, 'sem-roi': 0,
  };
}

export class RoiCache<T = unknown> {
  private readonly maxAngleRad: number;
  private readonly maxAgeMs: number;
  private readonly maxTranslationCm: number;
  private readonly maxConsecutiveReuses: number;
  private readonly requireStored: boolean;

  /** Estado do último RECOMPUTO — não do último frame. Ver o teste de idade. */
  private base: RoiObservation | null = null;
  private roi: T | null = null;
  private consecutiveReuses = 0;

  private decisions = 0;
  private reuses = 0;
  private refreshByReason = reasonCounters();

  constructor(opts: RoiCacheOptions = {}) {
    this.maxAngleRad = opts.maxAngleRad ?? ROI_MAX_ANGLE_RAD;
    this.maxAgeMs = opts.maxAgeMs ?? ROI_MAX_AGE_MS;
    this.maxTranslationCm = opts.maxTranslationCm ?? ROI_MAX_TRANSLATION_CM;
    this.maxConsecutiveReuses = opts.maxConsecutiveReuses ?? ROI_MAX_CONSECUTIVE_REUSES;
    this.requireStored = opts.requireStored ?? false;
  }

  /**
   * Decide se o frame corrente pode reusar o ROI vigente.
   *
   * A ordem das guardas é deliberada: dados inválidos primeiro (nada mais faz
   * sentido sem eles), depois as três invalidações, e o reuso por último. Assim
   * o `reason` devolvido é sempre a razão MAIS FORTE, não a primeira que passou.
   */
  decide(o: RoiObservation): RoiDecision {
    this.decisions++;

    if (!this.dadosValidos(o)) return this.recomputar('dados-invalidos', 0);

    const base = this.base;
    if (!base) return this.recomputar('primeiro-frame', 0, o);

    const ageMs = o.nowMs - base.nowMs;

    if (this.requireStored && this.roi === null) return this.recomputar('sem-roi', ageMs, o);

    const dYaw = Math.abs(o.pose.yaw - base.pose.yaw);
    const dPitch = Math.abs(o.pose.pitch - base.pose.pitch);
    if (dYaw > this.maxAngleRad || dPitch > this.maxAngleRad) {
      return this.recomputar('pose', ageMs, o);
    }

    if (ageMs > this.maxAgeMs) return this.recomputar('tempo', ageMs, o);

    const d = deslocamentoCm(o.faceCenter, base.faceCenter, {
      iodPx: o.iodPx, videoWidth: o.videoWidth, videoHeight: o.videoHeight,
    });
    if (Math.hypot(d.x, d.y) > this.maxTranslationCm) {
      return this.recomputar('translacao', ageMs, o);
    }

    if (this.consecutiveReuses >= this.maxConsecutiveReuses) {
      return this.recomputar('skip-esgotado', ageMs, o);
    }

    this.consecutiveReuses++;
    this.reuses++;
    return { reuse: true, reason: 'reuso', consecutiveReuses: this.consecutiveReuses, ageMs };
  }

  /** Guarda o ROI recém-computado. Chamado depois de um `decide` que negou. */
  store(roi: T): void {
    this.roi = roi;
  }

  get(): T | null {
    return this.roi;
  }

  stats(): RoiStats {
    const refreshes = this.decisions - this.reuses;
    return {
      decisions: this.decisions,
      reuses: this.reuses,
      refreshes,
      reuseRate: this.decisions > 0 ? this.reuses / this.decisions : 0,
      refreshByReason: { ...this.refreshByReason },
    };
  }

  reset(): void {
    this.base = null;
    this.roi = null;
    this.consecutiveReuses = 0;
    this.decisions = 0;
    this.reuses = 0;
    this.refreshByReason = reasonCounters();
  }

  private dadosValidos(o: RoiObservation): boolean {
    return Number.isFinite(o.nowMs)
      && Number.isFinite(o.pose.yaw) && Number.isFinite(o.pose.pitch)
      && Number.isFinite(o.faceCenter.x) && Number.isFinite(o.faceCenter.y)
      && o.iodPx > 0 && o.videoWidth > 0 && o.videoHeight > 0;
  }

  /**
   * Registra a decisão de recomputar e move a base para o frame atual.
   *
   * A base NÃO avança em `dados-invalidos`: um frame ruim não deve virar a
   * referência contra a qual os próximos são comparados — isso propagaria o
   * defeito para as decisões seguintes.
   */
  private recomputar(reason: RoiReason, ageMs: number, o?: RoiObservation): RoiDecision {
    this.refreshByReason[reason]++;
    this.consecutiveReuses = 0;
    if (o) {
      this.base = o;
      this.roi = null; // o ROI vigente deixou de valer; `store()` traz o novo
    }
    return { reuse: false, reason, consecutiveReuses: 0, ageMs };
  }
}
