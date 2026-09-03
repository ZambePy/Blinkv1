/**
 * 1.3 — compensação geométrica de pose, aplicada na SAÍDA.
 *
 * ── O problema ─────────────────────────────────────────────────────────────
 *
 * O modelo mapeia a íris (medida no frame da CABEÇA) para um ponto de tela.
 * Esse mapeamento só vale para a pose em que foi calibrado: se a cabeça girar
 * Δ e o olho mantiver o mesmo offset na órbita, o raio de olhar gira junto e o
 * ponto olhado se desloca `d · tan(Δ)` — mas o offset não mudou, então o modelo
 * prevê o mesmo ponto de antes.
 *
 * 1.1 mediu que isso é grande e real nesta base: a postura migra 2,38° em yaw e
 * 3,92° em pitch ao longo de UMA calibração, o que a 39,6 px/grau são 94 px em
 * X e 155 px em Y.
 *
 * ── Por que aqui e não no vetor de features ────────────────────────────────
 *
 * 1.2 tentou dar a pose ao Ridge como feature e piorou 8,6%. O coeficiente
 * aprendido saiu em −83,6 px/grau para yaw→X e +11,9 para pitch→Y, quando a
 * geometria exige a MESMA magnitude nos dois eixos (pixels são quadrados). Os
 * eixos discordaram por 7×: não era compensação, era a pose sendo usada como
 * atalho para adivinhar o alvo, já que ela deriva junto com a ordem de coleta.
 *
 * Aqui não há coeficiente livre. O ganho é `d · tan(Δ)` com `d` medido, então
 * não há o que memorizar e a extrapolação para poses fora da faixa de treino
 * é correta por construção — que é exatamente onde 1.2 falhou (84,4% dos
 * frames do teste tinham pitch fora da faixa vista no treino).
 *
 * ── Derivação dos sinais ───────────────────────────────────────────────────
 *
 * Os sinais NÃO foram escolhidos por medirem melhor; vêm da convenção com que
 * `extractor.ts` extrai os ângulos da matriz de transformação facial:
 *
 *     pitch = asin(−R12)        yaw = atan2(R02, R22)
 *
 * A coluna 2 de R é para onde vai o eixo Z do modelo — a direção do nariz.
 * Logo `f = (R02, R12, R22)` é a direção para onde a cabeça aponta, e
 * `yaw = atan2(f_x, f_z)`, `pitch = asin(−f_y)`.
 *
 * YAW: o usuário encara a tela e a câmera está sobre ela. Virar a cabeça para
 * a PRÓPRIA esquerda aponta o nariz para o lado esquerdo da tela — X de tela
 * MENOR — e coloca componente +X na direção do nariz em espaço de câmera, ou
 * seja yaw MAIOR. Então yaw↑ ⟹ ponto olhado com X↓, e a correção entra
 * NEGATIVA em X.
 *
 * PITCH: nariz para baixo dá f_y < 0, logo `−f_y > 0` e pitch MAIOR. Olhar
 * para baixo é Y de tela MAIOR (Y cresce para baixo). Então pitch↑ ⟹ Y↑, e a
 * correção entra POSITIVA em Y.
 *
 * ROLL não entra: rolar a cabeça gira a imagem do olho no frame, mas não
 * translada o raio de olhar. O efeito dele é sobre as features, não sobre o
 * ponto — e o extractor já rotaciona os landmarks pela matriz facial.
 */

/** Sinais derivados da convenção de `extractor.ts`. Ver o bloco acima. */
export const SINAL_YAW_X = -1;
export const SINAL_PITCH_Y = +1;

export interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * Maior desvio de pose (em relação à referência de calibração) que a
 * compensação geométrica aceita, em radianos — B3.12.
 *
 * π/6 = 30°. Acima disso a hipótese do modelo já não vale: a compensação
 * assume que a cabeça girou em torno de um centro fixo e que `tan(Δ)` descreve
 * o deslocamento resultante na tela. Aos 30° a aproximação está mal, e aos 60°
 * o número quase certamente veio de um `atan2` saltando de sinal — não de uma
 * cabeça que girou.
 *
 * Mesma ordem do `CLAMP_RAD = π/4` que `l2cs/block.ts` já aplica ao gaze.
 */
export const DELTA_POSE_MAX_RAD = Math.PI / 6;

/**
 * Deslocamento em pixels que a rotação da cabeça causa no ponto olhado.
 *
 * `distanciaPx` é a distância olho–tela expressa em pixels de tela: o mesmo
 * número que converte pixels em graus no resto do pipeline. Usa `tan` e não a
 * aproximação de ângulo pequeno porque o custo é zero e a aproximação já erra
 * 1% aos 10°.
 *
 * Função pura e total: pose ausente ou distância não-positiva devolvem zero,
 * nunca `NaN` — um NaN aqui contamina o filtro temporal e trava o cursor.
 */
export function deslocamentoPorPose(
  atual: Pose | null | undefined,
  referencia: Pose | null | undefined,
  distanciaPx: number,
): { dx: number; dy: number } {
  if (!atual || !referencia || !(distanciaPx > 0)) return { dx: 0, dy: 0 };
  const dyaw = atual.yaw - referencia.yaw;
  const dpitch = atual.pitch - referencia.pitch;
  if (!Number.isFinite(dyaw) || !Number.isFinite(dpitch)) return { dx: 0, dy: 0 };

  // B3.12 — Δpose fora da faixa plausível ZERA aquele eixo.
  //
  // `yaw` vem de `atan2`, que salta de sinal quando a cabeça vira de perfil ou
  // quando a matriz de transformação degenera. Nesses instantes `dyaw` se
  // aproxima de ±π/2 e `tan` explode: `tan(π/2 − 0,001) ≈ 1000`, e com
  // `distanciaPx = 2000` isso vira 2 milhões de pixels de deslocamento.
  //
  // O `softClamp` do caller segura o valor FINAL, então o cursor não some da
  // tela. Mas o pico já entrou no buffer temporal e no One Euro antes do
  // clamp — e o filtro leva vários frames para decair, produzindo um salto
  // visível que dura muito mais que o frame ruim que o causou.
  //
  // Zerar em vez de clampar é deliberado: um Δ de 60° entre a calibração e o
  // frame corrente não é rotação de cabeça, é matriz degenerada. Compensar por
  // um número que sabemos ser lixo — mesmo clampado — seria fabricar correção.
  // Zero significa "não sei compensar este frame", e o frame seguinte volta ao
  // normal sozinho.
  //
  // Os eixos são avaliados INDEPENDENTEMENTE: um yaw absurdo não descarta um
  // pitch plausível. Mesma proteção que `block.ts` já aplica com `CLAMP_RAD`.
  const yawOk = Math.abs(dyaw) <= DELTA_POSE_MAX_RAD;
  const pitchOk = Math.abs(dpitch) <= DELTA_POSE_MAX_RAD;

  // `-0` sai naturalmente quando o desvio é zero e o sinal é negativo. É
  // inofensivo em aritmética, mas vaza para o JSON do relatório como `-0` e
  // faz comparação exata falhar sem motivo. Normalizado aqui, uma vez.
  const semZeroNegativo = (v: number) => (v === 0 ? 0 : v);
  return {
    dx: yawOk ? semZeroNegativo(SINAL_YAW_X * distanciaPx * Math.tan(dyaw)) : 0,
    dy: pitchOk ? semZeroNegativo(SINAL_PITCH_Y * distanciaPx * Math.tan(dpitch)) : 0,
  };
}

/**
 * Aplica a compensação a uma predição em espaço NORMALIZADO [0,1].
 *
 * Normalizado e não pixels porque é onde `mapGaze` opera antes do clamp: cada
 * eixo é dividido pela sua própria dimensão, o que também evita o erro de
 * tratar fração-de-tela como grandeza única numa tela 16:9.
 *
 * Não faz clamp — quem cuida do domínio é o `softClamp` do caller. Fazer clamp
 * aqui esconderia uma compensação grande demais em vez de deixá-la aparecer na
 * medição.
 */
export function compensarPredicao(
  x: number,
  y: number,
  atual: Pose | null | undefined,
  referencia: Pose | null | undefined,
  distanciaPx: number,
  larguraPx: number,
  alturaPx: number,
): { x: number; y: number } {
  if (!(larguraPx > 0) || !(alturaPx > 0)) return { x, y };
  const { dx, dy } = deslocamentoPorPose(atual, referencia, distanciaPx);
  return { x: x + dx / larguraPx, y: y + dy / alturaPx };
}

/**
 * Pose de referência de uma calibração: a média por eixo das amostras aceitas.
 *
 * MÉDIA, e não a mediana usada em 1.1 para o baseline de sessão, porque aqui a
 * referência tem que ser o CENTRÓIDE da distribuição em que o modelo foi
 * ajustado — é contra ele que o Ridge minimizou o erro. A mediana é a escolha
 * certa quando se quer resistir a um frame espúrio; aqui um outlier de pose já
 * foi rejeitado pelo gate, e o que interessa é o ponto que o ajuste privilegia.
 */
export function poseDeReferencia(amostras: readonly (Pose | null | undefined)[]): Pose | null {
  const v = amostras.filter((p): p is Pose => !!p
    && Number.isFinite(p.yaw) && Number.isFinite(p.pitch) && Number.isFinite(p.roll));
  if (v.length === 0) return null;
  const media = (pick: (p: Pose) => number) => v.reduce((a, b) => a + pick(b), 0) / v.length;
  return { yaw: media((p) => p.yaw), pitch: media((p) => p.pitch), roll: media((p) => p.roll) };
}
