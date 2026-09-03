// Conversão pixel → grau, e velocidade angular. Base de `P6.2` e `P6.4`.
//
// ── Por que isto precisa existir separado ───────────────────────────────────
//
// Os dois filtros adaptativos são especificados em GRAUS: α muda em 5°/s e
// 15°/s; a zona morta é 0,3°. Nenhum dos dois pode ser implementado em pixels,
// porque o mesmo deslocamento em pixels é um ângulo completamente diferente
// conforme a tela e a distância:
//
//     23,6" a 60 cm   →  ~111 px por grau
//     40"   a 100 cm  →  ~130 px por grau
//     13"   a 45 cm   →  ~86 px por grau
//
// Um limiar fixo em pixels trataria essas três situações como iguais.
//
// ── A dependência que o plano registra ──────────────────────────────────────
//
// `P6.2` depende de `B2.9` e `B2.10` estarem corrigidos, e o motivo é este
// módulo: se a geometria da tela estiver errada, α é escolhido a partir de uma
// velocidade angular errada, e o filtro fica mais suave ou mais responsivo do
// que deveria — sem nada indicando isso. Os dois bugs já foram corrigidos
// (Sprint 2), mas a dependência continua real: **este módulo é só tão bom
// quanto a geometria que recebe**.
//
// Por isso ele não tem default para a geometria. Sem os números da tela, a
// resposta é `null` — nunca um chute.

export interface GeometriaDeTela {
  /** Largura da área útil em PIXELS. Precisa ser a mesma que o mapeamento de
   *  predição usa (`clientWidth`, não `vw` — ver `B3.32`). */
  larguraPx: number;
  alturaPx: number;
  /** Largura física da área útil em cm. */
  larguraCm: number;
  /** Distância olho→tela em cm. */
  distanciaCm: number;
}

/**
 * Pixels por grau no centro da tela.
 *
 * ⚠️ É uma aproximação de pequeno ângulo, e ela degrada nas BORDAS. A relação
 * exata é `px = d·tan(θ)·densidade`, então a mesma variação angular cobre mais
 * pixels quanto mais longe do centro. Para os limiares destes filtros (0,3° de
 * zona morta, 5–15°/s de velocidade) a diferença é irrelevante; para converter
 * o ERRO de precisão em graus, não é — e é por isso que `accuracy.ts` faz a
 * conta completa em vez de usar esta função.
 *
 * Devolve `null` quando a geometria não permite o cálculo. Sem isso, um
 * `viewingDistanceCm` zerado produziria `Infinity` px/grau e desligaria os dois
 * filtros em silêncio.
 */
export function pixelsPorGrau(g: GeometriaDeTela): number | null {
  if (!(g.larguraPx > 0) || !(g.larguraCm > 0) || !(g.distanciaCm > 0)) return null;
  if (!Number.isFinite(g.larguraPx) || !Number.isFinite(g.larguraCm) || !Number.isFinite(g.distanciaCm)) {
    return null;
  }
  const pxPorCm = g.larguraPx / g.larguraCm;
  // cm que 1 grau cobre à distância `d`: d · tan(1°).
  const cmPorGrau = g.distanciaCm * Math.tan(Math.PI / 180);
  const r = pxPorCm * cmPorGrau;
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Converte um deslocamento em pixels para graus. `null` se a geometria não permite. */
export function pixelsParaGraus(px: number, g: GeometriaDeTela): number | null {
  const ppg = pixelsPorGrau(g);
  if (ppg === null || !Number.isFinite(px)) return null;
  return px / ppg;
}

/**
 * Velocidade angular em GRAUS POR SEGUNDO entre dois pontos consecutivos.
 *
 * `dtSec` não-positivo devolve `null` em vez de `Infinity`: um `dt` zero
 * aconteceria com dois quadros no mesmo instante de relógio, e uma velocidade
 * infinita empurraria o α adaptativo para o extremo responsivo — exatamente o
 * oposto do que se quer num quadro duplicado.
 */
export function velocidadeAngularDegPorSeg(
  x0: number, y0: number,
  x1: number, y1: number,
  dtSec: number,
  g: GeometriaDeTela,
): number | null {
  if (!(dtSec > 0) || !Number.isFinite(dtSec)) return null;
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const graus = pixelsParaGraus(Math.hypot(x1 - x0, y1 - y0), g);
  if (graus === null) return null;
  return graus / dtSec;
}

/**
 * Geometria a partir dos campos que o projeto já guarda nas configurações.
 *
 * `screenDiagonalIn` é a diagonal em polegadas; a largura sai dela pela razão
 * de aspecto REAL da área útil em pixels — não por 16:9 assumido, que estaria
 * errado em tela ultrawide ou com a janela fora de tela cheia.
 */
export function geometriaDeDiagonal(
  larguraPx: number,
  alturaPx: number,
  diagonalPolegadas: number,
  distanciaCm: number,
): GeometriaDeTela | null {
  if (!(larguraPx > 0) || !(alturaPx > 0) || !(diagonalPolegadas > 0) || !(distanciaCm > 0)) {
    return null;
  }
  const diagonalPx = Math.hypot(larguraPx, alturaPx);
  const cmPorPx = (diagonalPolegadas * 2.54) / diagonalPx;
  return {
    larguraPx,
    alturaPx,
    larguraCm: larguraPx * cmPorPx,
    distanciaCm,
  };
}
