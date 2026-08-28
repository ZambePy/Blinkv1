/**
 * 1.4 — compensação de TRANSLAÇÃO lateral da cabeça, aplicada na saída.
 *
 * ── O problema, e por que é diferente de 1.3 ───────────────────────────────
 *
 * 1.3 trata a cabeça GIRANDO. Aqui a cabeça se DESLOCA sem girar — o usuário
 * escorrega na cadeira, ou a cadeira anda. São efeitos independentes e a
 * correção de um não cobre o outro.
 *
 * O modelo mapeia a íris (no frame da cabeça) para um ponto de tela, e esse
 * mapeamento foi ajustado com o olho numa posição `e₀`. Se o olho passa para
 * `e₀ + t` e o usuário olha para o mesmo ponto `S` da tela, o ângulo do olhar
 * na órbita passa a ser o de `S − t`, então o modelo prevê `S − t`.
 *
 * A correção é somar `t`. **Exatamente `t`, sem escalar por distância nenhuma**
 * — o que a distingue de 1.3, onde o ganho é `d · tan(Δ)` e a distância entra.
 * Isto vale porque tela e olho transladam no mesmo plano: mover o olho 1 cm
 * para a direita move o ponto olhado 1 cm para a direita, esteja a tela perto
 * ou longe.
 *
 * ── O campo de visão CANCELA ───────────────────────────────────────────────
 *
 * A tarefa foi descrita como "usar `latestFaceCenter` + o FOV calibrado". O FOV
 * não é necessário, e é melhor assim: ele é justamente o parâmetro incerto do
 * setup (a webcam declara 90°, número que fabricantes costumam dar na diagonal
 * e inflar).
 *
 * Seja `D` a distância câmera→rosto e `tanH = tan(FOV_h / 2)`. Um deslocamento
 * normalizado `Δx` na imagem corresponde a `X = 2 · Δx · D · tanH` no mundo. A
 * distância interocular física obedece à mesma relação: `IOD_cm = 2 · iod_norm
 * · D · tanH`. Dividindo uma pela outra, `D` e `tanH` somem dos dois lados:
 *
 *     X_cm = IOD_cm · Δx_norm · larguraVideo / iod_px
 *
 * Ou seja: medir o deslocamento do nariz EM UNIDADES DA DISTÂNCIA INTEROCULAR
 * e multiplicar pela distância interocular física. Sobra uma única suposição —
 * o IOD físico — e ela é bem menos incerta que o FOV.
 *
 * ── Derivação dos sinais ───────────────────────────────────────────────────
 *
 * Os landmarks vêm do vídeo CRU: `GazeContext` não aplica `scaleX(-1)` ao
 * elemento, e mirror de CSS não afeta pixels (ver o bloco de convenções em
 * `tracker/engine.ts`). Numa imagem não espelhada de alguém que encara a
 * câmera, o lado DIREITO da pessoa aparece à ESQUERDA da imagem.
 *
 * X: o usuário desliza para a própria direita → o nariz vai para x MENOR na
 * imagem, e o olho vai para X de tela MAIOR. Sinal negativo.
 *
 * Y: o usuário sobe (senta mais ereto) → o nariz vai para y MENOR (y da imagem
 * cresce para baixo), e o olho sobe, ou seja Y de tela MENOR. Sinal positivo.
 */

/** Distância interocular física assumida, em cm.
 *
 *  63 mm é a média adulta e a mesma constante que a estimativa de distância do
 *  `setupReadiness` usa — se um dia virar medida por usuário, tem que mudar nos
 *  dois lugares juntos. O erro típico entre adultos é de ~4 mm, ou seja ~6%, e
 *  entra proporcionalmente na correção: numa translação de 1 cm são 0,6 mm. */
export const IOD_CM = 6.3;

/** Sinais derivados da convenção da imagem não espelhada. Ver o bloco acima. */
export const SINAL_X = -1;
export const SINAL_Y = +1;

export interface CentroFacial {
  /** Ponta do nariz em coordenadas normalizadas do vídeo (x por largura, y por altura). */
  x: number;
  y: number;
}

export interface EscalaFacial {
  /** Distância interocular MEDIDA no quadro, em pixels de vídeo. */
  iodPx: number;
  videoWidth: number;
  videoHeight: number;
}

/**
 * Deslocamento físico do olho, em cm, entre o quadro atual e a referência.
 *
 * Pura e total: entrada ausente ou escala degenerada devolvem zero, nunca
 * `NaN` — um NaN aqui contamina o filtro temporal e trava o cursor.
 */
export function deslocamentoCm(
  atual: CentroFacial | null | undefined,
  referencia: CentroFacial | null | undefined,
  escala: EscalaFacial | null | undefined,
): { x: number; y: number } {
  if (!atual || !referencia || !escala) return { x: 0, y: 0 };
  const { iodPx, videoWidth, videoHeight } = escala;
  if (!(iodPx > 0) || !(videoWidth > 0) || !(videoHeight > 0)) return { x: 0, y: 0 };
  const dx = atual.x - referencia.x;
  const dy = atual.y - referencia.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  // Normalizado → pixels de vídeo (x pela largura, y pela altura) → múltiplos
  // da distância interocular → cm.
  return {
    x: (IOD_CM * dx * videoWidth) / iodPx,
    y: (IOD_CM * dy * videoHeight) / iodPx,
  };
}

/**
 * Aplica a compensação a uma predição em espaço NORMALIZADO [0,1].
 *
 * `pxPorCm` é a densidade da TELA — é ela que converte o deslocamento físico do
 * olho em pixels de tela, na razão 1:1 discutida acima.
 *
 * Não faz clamp: quem cuida do domínio é o `softClamp` do caller, e fazer clamp
 * aqui esconderia uma correção grande demais em vez de deixá-la medir.
 */
export function compensarTranslacao(
  x: number,
  y: number,
  atual: CentroFacial | null | undefined,
  referencia: CentroFacial | null | undefined,
  escala: EscalaFacial | null | undefined,
  pxPorCm: number,
  larguraPx: number,
  alturaPx: number,
): { x: number; y: number } {
  if (!(pxPorCm > 0) || !(larguraPx > 0) || !(alturaPx > 0)) return { x, y };
  const d = deslocamentoCm(atual, referencia, escala);
  return {
    x: x + (SINAL_X * d.x * pxPorCm) / larguraPx,
    y: y + (SINAL_Y * d.y * pxPorCm) / alturaPx,
  };
}

/**
 * Centro facial de referência de uma calibração: média por eixo.
 *
 * Média e não mediana pelo mesmo motivo de `poseDeReferencia`: a referência tem
 * que ser o centróide da distribuição em que o modelo foi ajustado, que é o
 * ponto contra o qual o Ridge minimizou o erro.
 */
export function centroDeReferencia(
  amostras: readonly (CentroFacial | null | undefined)[],
): CentroFacial | null {
  const v = amostras.filter((p): p is CentroFacial => !!p
    && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (v.length === 0) return null;
  return {
    x: v.reduce((a, b) => a + b.x, 0) / v.length,
    y: v.reduce((a, b) => a + b.y, 0) / v.length,
  };
}
