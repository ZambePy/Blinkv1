// P4.5 — CLAHE (Contrast Limited Adaptive Histogram Equalization).
//
// ── Por que não equalização global ───────────────────────────────────────────
//
// O que precisa aparecer é a borda íris↔esclera: é dela que o landmark tira a
// posição, e é ela que some quando o crop está chapado. Equalização global é
// dominada pela região de maior área — no crop ocular, a pele ao redor. O
// resultado é uma imagem que "parece" melhor e cuja borda continua mole.
// Adaptativa por tile resolve isso porque cada vizinhança ganha o próprio
// mapeamento.
//
// ── Por que "contrast limited" ───────────────────────────────────────────────
//
// Equalização adaptativa pura amplifica o que existe na vizinhança — inclusive
// ruído do sensor numa região lisa, que vira textura convincente. O clip do
// histograma limita a inclinação máxima do mapeamento: um bin não pode
// contribuir mais que `clipLimit ×` a altura média. O excedente cortado é
// redistribuído, e não descartado, senão a transformação deixa de cobrir a
// faixa toda.
//
// ── Por que à mão, e não OpenCV.js ───────────────────────────────────────────
//
// Registrado como ADR em `docs/DECISOES_PIPELINE.md` (P4.4). Resumo: OpenCV.js
// custa ~8–10 MB de WASM para uma função de ~150 linhas, num app que já carrega
// 91 MB de ONNX. O custo medido desta implementação está no mesmo ADR.
//
// ── Determinismo ─────────────────────────────────────────────────────────────
//
// Sem DOM, sem relógio, sem `Math.random`. É requisito do harness `T0.3`: um
// estágio de pré-processamento não-determinístico tornaria toda comparação
// A→B ruidosa sem que a origem do ruído fosse óbvia.

export interface ClaheOptions {
  /** Tiles na horizontal. */
  tilesX?: number;
  /** Tiles na vertical. */
  tilesY?: number;
  /**
   * Teto de amplificação, em múltiplos da altura média do histograma do tile.
   * 1,0 é praticamente identidade; 2,0 é o valor da especificação; acima de ~4
   * o ruído do sensor começa a aparecer como textura.
   */
  clipLimit?: number;
}

export const CLAHE_DEFAULTS: Required<ClaheOptions> = {
  tilesX: 8,
  tilesY: 8,
  clipLimit: 2.0,
};

const NIVEIS = 256;

/**
 * Aplica CLAHE sobre um plano de 8 bits (luminância ou canal único).
 *
 * Puro: devolve buffer novo e não toca na entrada.
 */
export function claheGray(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: ClaheOptions = {},
): Uint8ClampedArray {
  if (!(width > 0) || !(height > 0) || src.length !== width * height) {
    // Falhar alto: silenciar produz uma imagem embaralhada que ninguém liga ao
    // parâmetro errado — o modo de falha que custou caro em `B1.1`.
    throw new Error(
      `[clahe] dimensões incoerentes: ${width}×${height} = ${width * height} ` +
      `mas o buffer tem ${src.length}.`,
    );
  }

  const { tilesX, tilesY } = gradeEfetiva(
    width, height,
    opts.tilesX ?? CLAHE_DEFAULTS.tilesX,
    opts.tilesY ?? CLAHE_DEFAULTS.tilesY,
  );
  const clipLimit = Math.max(1, opts.clipLimit ?? CLAHE_DEFAULTS.clipLimit);

  // Fronteiras dos tiles calculadas por divisão inteira acumulada: com 45 px em
  // 8 tiles, alguns ficam com 6 e outros com 5, e nenhum pixel fica de fora.
  const bordasX = fronteiras(width, tilesX);
  const bordasY = fronteiras(height, tilesY);

  // Um LUT de 256 entradas por tile.
  const luts: Uint8ClampedArray[] = new Array(tilesX * tilesY);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      luts[ty * tilesX + tx] = lutDoTile(
        src, width, bordasX[tx], bordasX[tx + 1], bordasY[ty], bordasY[ty + 1], clipLimit,
      );
    }
  }

  // Centros dos tiles, em coordenadas de pixel. É entre eles que a interpolação
  // acontece — usar as bordas produziria a costura que ela existe para evitar.
  const centrosX = new Float64Array(tilesX);
  for (let tx = 0; tx < tilesX; tx++) centrosX[tx] = (bordasX[tx] + bordasX[tx + 1] - 1) / 2;
  const centrosY = new Float64Array(tilesY);
  for (let ty = 0; ty < tilesY; ty++) centrosY[ty] = (bordasY[ty] + bordasY[ty + 1] - 1) / 2;

  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const { i0: ty0, i1: ty1, f: fy } = vizinhos(y, centrosY);
    for (let x = 0; x < width; x++) {
      const { i0: tx0, i1: tx1, f: fx } = vizinhos(x, centrosX);
      const v = src[y * width + x];
      // Bilinear entre os quatro LUTs vizinhos. Nas bordas da imagem os índices
      // colapsam (tx0 === tx1) e a interpolação degenera para o LUT único, que
      // é o comportamento correto — replicar a borda, não extrapolar.
      const a = luts[ty0 * tilesX + tx0][v];
      const b = luts[ty0 * tilesX + tx1][v];
      const c = luts[ty1 * tilesX + tx0][v];
      const d = luts[ty1 * tilesX + tx1][v];
      const topo = a + (b - a) * fx;
      const base = c + (d - c) * fx;
      out[y * width + x] = Math.round(topo + (base - topo) * fy);
    }
  }
  return out;
}

/**
 * Aplica CLAHE sobre RGBA preservando cor e alfa.
 *
 * A equalização roda sobre a LUMINÂNCIA e o resultado vira um ganho aplicado
 * aos três canais. Equalizar R, G e B independentemente mudaria o matiz — um
 * olho castanho viraria esverdeado —, o que atrapalha tanto a inspeção visual
 * quanto o L2CS, treinado em imagens de cor natural.
 */
export function claheRGBA(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: ClaheOptions = {},
): Uint8ClampedArray {
  const px = width * height;
  if (!(width > 0) || !(height > 0) || rgba.length !== px * 4) {
    throw new Error(
      `[clahe] dimensões incoerentes: ${width}×${height} exigiria ${px * 4} bytes RGBA, ` +
      `mas o buffer tem ${rgba.length}.`,
    );
  }

  const luma = new Uint8ClampedArray(px);
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    // Rec. 601 — a mesma convenção do resto do pipeline de qualidade.
    luma[i] = Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]);
  }
  const equalizada = claheGray(luma, width, height, opts);

  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    const antes = luma[i];
    const depois = equalizada[i];
    // Ganho multiplicativo preserva a razão entre canais (o matiz). O piso de 1
    // no denominador evita divisão por zero em pixel preto, onde não há matiz a
    // preservar de qualquer forma.
    const ganho = depois / Math.max(antes, 1);
    out[j] = clamp255(rgba[j] * ganho);
    out[j + 1] = clamp255(rgba[j + 1] * ganho);
    out[j + 2] = clamp255(rgba[j + 2] * ganho);
    out[j + 3] = rgba[j + 3];
  }
  return out;
}

// -----------------------------------------------------------------------------
// Internos
// -----------------------------------------------------------------------------

/**
 * Área mínima de um tile, em pixels.
 *
 * ── Por que existe, e por que vale exatamente 256 ────────────────────────────
 *
 * O teto do clip é `clipLimit × total / 256`, com piso 1 porque contagem de
 * histograma é inteira. Quando o tile tem MENOS de `256 / clipLimit` pixels,
 * esse cálculo cai abaixo de 1, o piso assume, e o teto passa a valer 1 — o
 * mesmo valor que a maioria dos bins já tem. **O clip vira no-op e o CLAHE
 * degenera em AHE sem limite**, que é precisamente o que o "contrast limited"
 * do nome existe para impedir.
 *
 * Isso foi MEDIDO, não deduzido: numa rampa horizontal de 128×8 com a grade
 * 8×8 pedida pela especificação, cada tile ficava com 16 px, e a saída saía com
 * dente de serra de período 16 px (a largura do tile) caindo 15 níveis em cada
 * fronteira. A interpolação bilinear estava correta; o que estava errado era
 * cada tile mapear seus poucos níveis para a faixa inteira.
 *
 * E não é caso de laboratório: o alvo real é a região dos olhos, algo como
 * 100×50 px. Com 8×8 tiles isso dá ~72 px por tile — bem abaixo de 256.
 *
 * A resposta é reduzir a GRADE até que cada tile tenha bins suficientes, em vez
 * de aceitar um parâmetro que não faz o que promete. Menos tiles significa
 * menos adaptação local; um clip que não clipa significa ruído amplificado sem
 * teto. A primeira degradação é honesta e visível aqui; a segunda é silenciosa.
 */
export const MIN_TILE_PIXELS = 256;

/**
 * Grade efetiva depois do piso de `MIN_TILE_PIXELS` por tile.
 *
 * Exportada porque é observável: quem chama com 8×8 e recebe 2×2 precisa poder
 * descobrir isso sem ler o código.
 */
export function gradeEfetiva(
  width: number,
  height: number,
  tilesXPedido: number,
  tilesYPedido: number,
): { tilesX: number; tilesY: number } {
  let tx = Math.max(1, Math.min(Math.trunc(tilesXPedido) || 1, width));
  let ty = Math.max(1, Math.min(Math.trunc(tilesYPedido) || 1, height));
  const maxTiles = Math.max(1, Math.floor((width * height) / MIN_TILE_PIXELS));
  if (tx * ty <= maxTiles) return { tilesX: tx, tilesY: ty };
  // Encolhe proporcionalmente, preservando a razão da grade pedida.
  const fator = Math.sqrt(maxTiles / (tx * ty));
  tx = Math.max(1, Math.floor(tx * fator));
  ty = Math.max(1, Math.floor(ty * fator));
  // O `floor` pode deixar folga; devolve-a ao eixo maior, que é onde ela rende
  // mais adaptação local.
  while ((tx + 1) * ty <= maxTiles && tx < width && tx <= ty) tx++;
  while (tx * (ty + 1) <= maxTiles && ty < height) ty++;
  while (tx * ty > maxTiles && (tx > 1 || ty > 1)) {
    if (tx >= ty && tx > 1) tx--; else if (ty > 1) ty--; else break;
  }
  return { tilesX: tx, tilesY: ty };
}

/** Fronteiras de `n` pixels divididos em `t` faixas, sem perder pixel. */
function fronteiras(n: number, t: number): Int32Array {
  const out = new Int32Array(t + 1);
  for (let i = 0; i <= t; i++) out[i] = Math.round((i * n) / t);
  return out;
}

/**
 * Índices dos dois centros de tile que cercam a coordenada `p`, e a fração
 * entre eles. Fora dos centros extremos, colapsa no mesmo índice (replica a
 * borda em vez de extrapolar, que produziria realce artificial na moldura).
 */
function vizinhos(p: number, centros: Float64Array): { i0: number; i1: number; f: number } {
  const n = centros.length;
  if (n === 1) return { i0: 0, i1: 0, f: 0 };
  if (p <= centros[0]) return { i0: 0, i1: 0, f: 0 };
  if (p >= centros[n - 1]) return { i0: n - 1, i1: n - 1, f: 0 };
  let i = 0;
  while (i < n - 2 && p > centros[i + 1]) i++;
  const span = centros[i + 1] - centros[i];
  return { i0: i, i1: i + 1, f: span > 0 ? (p - centros[i]) / span : 0 };
}

/**
 * LUT de um tile: histograma → clip → redistribuição → CDF normalizada.
 */
function lutDoTile(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  x0: number, x1: number,
  y0: number, y1: number,
  clipLimit: number,
): Uint8ClampedArray {
  const hist = new Int32Array(NIVEIS);
  let total = 0;
  for (let y = y0; y < y1; y++) {
    const linha = y * width;
    for (let x = x0; x < x1; x++) {
      hist[src[linha + x]]++;
      total++;
    }
  }

  const lut = new Uint8ClampedArray(NIVEIS);
  if (total === 0) {
    // Tile vazio (pode acontecer com imagem menor que a grade): identidade.
    for (let i = 0; i < NIVEIS; i++) lut[i] = i;
    return lut;
  }

  // Clip: nenhum bin passa de `clipLimit ×` a altura média.
  const teto = Math.max(1, Math.floor((clipLimit * total) / NIVEIS));
  let excedente = 0;
  for (let i = 0; i < NIVEIS; i++) {
    if (hist[i] > teto) {
      excedente += hist[i] - teto;
      hist[i] = teto;
    }
  }
  // Redistribuição do que foi cortado. Devolver ao histograma (em vez de
  // descartar) é o que mantém a CDF chegando a 1 — sem isso a saída perde faixa
  // dinâmica justamente nas regiões mais uniformes.
  //
  // ⚠️ O RESTO PRECISA SER ESPALHADO, não empilhado no começo.
  //
  // A primeira versão fazia `if (resto > 0) { hist[i]++; resto--; }` dentro do
  // laço, o que dá +1 aos `resto` PRIMEIROS bins — uma redistribuição enviesada
  // para os níveis escuros. O sintoma foi medido numa rampa horizontal: dente
  // de serra com período de exatamente 16 px (a largura do tile) e queda de 15
  // níveis em cada fronteira. Ou seja, a costura que a interpolação bilinear
  // existe para eliminar, reintroduzida pelo viés da CDF de cada tile.
  //
  // Espalhar com passo constante mantém a CDF aproximadamente linear quando o
  // histograma do tile é quase plano — que é o caso de um gradiente suave, onde
  // a resposta certa é ficar perto da identidade.
  const porBin = Math.floor(excedente / NIVEIS);
  if (porBin > 0) {
    for (let i = 0; i < NIVEIS; i++) hist[i] += porBin;
  }
  const resto = excedente - porBin * NIVEIS;
  if (resto > 0) {
    const passo = Math.max(1, Math.floor(NIVEIS / resto));
    let colocados = 0;
    for (let i = 0; i < NIVEIS && colocados < resto; i += passo) {
      hist[i]++;
      colocados++;
    }
    // Sobra possível quando `NIVEIS / passo < resto` por arredondamento: os
    // últimos vão nos bins ainda não visitados, do fim para o começo, para não
    // reintroduzir viés no início da faixa.
    for (let i = NIVEIS - 1; i >= 0 && colocados < resto; i--) {
      if (i % passo !== 0) { hist[i]++; colocados++; }
    }
  }

  // CDF → mapeamento. `cdfMin` é subtraído para que o menor nível presente vá
  // para 0: sem isso a imagem sai com um véu cinza.
  let acumulado = 0;
  let cdfMin = -1;
  const cdf = new Int32Array(NIVEIS);
  for (let i = 0; i < NIVEIS; i++) {
    acumulado += hist[i];
    cdf[i] = acumulado;
    if (cdfMin < 0 && acumulado > 0) cdfMin = acumulado;
  }
  const denom = acumulado - cdfMin;
  for (let i = 0; i < NIVEIS; i++) {
    // Denominador zero significa um único nível presente no tile: a imagem é
    // constante ali, e o mapeamento correto é a identidade — mapear tudo para 0
    // faria uma imagem chapada virar preta.
    lut[i] = denom > 0
      ? Math.round(((cdf[i] - cdfMin) / denom) * (NIVEIS - 1))
      : i;
  }
  return lut;
}

function clamp255(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}
