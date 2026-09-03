// P4.7 — ordem do pré-processamento, e a garantia de normalização única.
//
// ── O que esta tarefa NÃO é ──────────────────────────────────────────────────
//
// Não é correção da normalização ImageNet. Ela já estava certa e foi conferida
// na análise: RGB na ordem certa, NCHW com planos contíguos, `/255` antes de
// `(x−mean)/std`, mean/std batendo com `l2cs.meta.json`. Mexer nela agora seria
// consertar o que não está quebrado.
//
// ── O que ela é ──────────────────────────────────────────────────────────────
//
// O caminho novo (CLAHE de `P4.5`, gama de `P4.6`) abriu duas portas, e esta
// tarefa fecha as duas:
//
//   1. **Os dois rodam ANTES da normalização.** CLAHE é histograma de bytes;
//      gama é potência sobre [0,1] derivada de bytes. Depois da normalização os
//      valores estão centrados em zero e podem ser negativos — "histograma" e
//      "gama" deixam de significar o que significavam, sem que nada exploda. O
//      L2CS receberia entrada fora da distribuição de treino e responderia com
//      ângulos plausíveis, que é o pior sintoma possível (`B3.1` de novo).
//
//   2. **Ninguém normaliza duas vezes.** O tipo de retorno aqui é
//      `Uint8ClampedArray` — bytes, não tensor. Quem quiser o tensor chama
//      `preprocess448FromRGBA`, e o compilador impede que o resultado dela
//      volte para cá.
//
// A ordem é declarada em `PREPROCESS_ORDER` e o resultado carrega `steps` com o
// que de fato rodou. Isso permite ao teste verificar a ORDEM sem espionar
// função interna nenhuma — e ao diagnóstico dizer qual estágio estava ligado
// quando uma gravação foi feita.

import { claheGray, type ClaheOptions } from './clahe';
import { GammaCorrector, histogramFromGray } from './gamma';

/** Ordem canônica. `normalize` não roda aqui — é `preprocess448FromRGBA`, em
 *  `src/l2cs/crop.ts`. Está na lista para deixar a fronteira explícita. */
export const PREPROCESS_ORDER = ['clahe', 'gamma', 'normalize'] as const;

export type PreprocessStep = 'clahe' | 'gamma';

export interface Regiao {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreprocessOptions {
  /** CLAHE ligado (com defaults) ou configurado. */
  clahe?: boolean | ClaheOptions;
  /**
   * Corretor de gama COM ESTADO — a histerese vive nele, então o chamador
   * mantém a mesma instância entre frames. Passar um novo por frame anularia a
   * histerese e devolveria a oscilação que `P4.6` existe para remover.
   */
  gamma?: GammaCorrector | null;
  /**
   * Região dos olhos dentro do buffer. Quando presente, o CLAHE roda SÓ ali —
   * é o que a especificação de `P4.5` pede. Sem ela, roda no buffer inteiro.
   *
   * O motivo de restringir: o crop facial inclui sobrancelha, pele e fundo, e
   * a equalização adaptativa gasta faixa dinâmica com eles. O que precisa
   * aparecer é a borda íris↔esclera.
   */
  eyeRegion?: Regiao | null;
}

export interface PreprocessResult {
  /** Bytes RGBA, 0..255. **Não normalizado** — ver o cabeçalho. */
  rgba: Uint8ClampedArray;
  /** Passos efetivamente aplicados, na ordem. */
  steps: PreprocessStep[];
}

/**
 * Aplica o pré-processamento sobre RGBA, na ordem canônica.
 *
 * Quando nenhum passo está ligado, devolve a MESMA referência de entrada: o
 * caminho quente roda sobre 448² (800 KB) e copiar isso por frame para não
 * fazer nada seria pagar pelo estágio desligado.
 */
export function applyPreprocessRGBA(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: PreprocessOptions = {},
): PreprocessResult {
  const px = width * height;
  if (!(width > 0) || !(height > 0) || rgba.length !== px * 4) {
    throw new Error(
      `[preprocess] dimensões incoerentes: ${width}×${height} exigiria ${px * 4} bytes RGBA, ` +
      `mas o buffer tem ${rgba.length}.`,
    );
  }

  const querClahe = opts.clahe === true || (opts.clahe && typeof opts.clahe === 'object');
  const querGama = !!opts.gamma;
  if (!querClahe && !querGama) return { rgba, steps: [] };

  const steps: PreprocessStep[] = [];
  let atual = rgba;

  if (querClahe) {
    const claheOpts: ClaheOptions = typeof opts.clahe === 'object' ? opts.clahe : {};
    atual = opts.eyeRegion
      ? claheNaRegiao(atual, width, height, opts.eyeRegion, claheOpts)
      : claheNoBufferInteiro(atual, width, height, claheOpts);
    steps.push('clahe');
  }

  if (querGama) {
    // O histograma sai do buffer ATUAL — ou seja, já com CLAHE aplicado. Se
    // viesse do original, o γ seria escolhido contra uma imagem que o estágio
    // anterior acabou de mudar, e a correção chegaria sempre defasada.
    const luma = lumaDe(atual, px);
    opts.gamma!.update(histogramFromGray(luma));
    atual = opts.gamma!.applyRGBA(atual);
    steps.push('gamma');
  }

  return { rgba: atual, steps };
}

// -----------------------------------------------------------------------------
// Internos
// -----------------------------------------------------------------------------

/** Rec. 601 — mesma convenção do `qualityAnalyzer` e do `claheRGBA`. */
function lumaDe(rgba: Uint8ClampedArray, px: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px);
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    out[i] = Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]);
  }
  return out;
}

/** Aplica o ganho de luminância equalizada de volta aos três canais. */
function aplicarGanho(
  destino: Uint8ClampedArray,
  origem: Uint8ClampedArray,
  indicePixel: number,
  lumaAntes: number,
  lumaDepois: number,
): void {
  const j = indicePixel * 4;
  const ganho = lumaDepois / Math.max(lumaAntes, 1);
  destino[j] = clamp255(origem[j] * ganho);
  destino[j + 1] = clamp255(origem[j + 1] * ganho);
  destino[j + 2] = clamp255(origem[j + 2] * ganho);
  destino[j + 3] = origem[j + 3];
}

function claheNoBufferInteiro(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: ClaheOptions,
): Uint8ClampedArray {
  const px = width * height;
  const luma = lumaDe(rgba, px);
  const eq = claheGray(luma, width, height, opts);
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < px; i++) aplicarGanho(out, rgba, i, luma[i], eq[i]);
  return out;
}

function claheNaRegiao(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  r: Regiao,
  opts: ClaheOptions,
): Uint8ClampedArray {
  const x0 = Math.trunc(r.x);
  const y0 = Math.trunc(r.y);
  const rw = Math.trunc(r.width);
  const rh = Math.trunc(r.height);
  if (!(rw > 0) || !(rh > 0) || x0 < 0 || y0 < 0 || x0 + rw > width || y0 + rh > height) {
    // Silenciar (clampando a região) produziria uma equalização sobre uma área
    // diferente da pedida, sem sintoma — e o chamador continuaria acreditando
    // que tratou os olhos.
    throw new Error(
      `[preprocess] região inválida: ${rw}×${rh} em (${x0},${y0}) não cabe em ${width}×${height}.`,
    );
  }

  // Extrai a luminância só da região, equaliza, e escreve de volta.
  const luma = new Uint8ClampedArray(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const j = ((y0 + y) * width + (x0 + x)) * 4;
      luma[y * rw + x] = Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]);
    }
  }
  const eq = claheGray(luma, rw, rh, opts);

  const out = Uint8ClampedArray.from(rgba); // fora da região, cópia intacta
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const idxRegiao = y * rw + x;
      aplicarGanho(out, rgba, (y0 + y) * width + (x0 + x), luma[idxRegiao], eq[idxRegiao]);
    }
  }
  return out;
}

function clamp255(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}
