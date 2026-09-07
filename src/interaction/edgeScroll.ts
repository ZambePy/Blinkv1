/**
 * Rolagem por olhar nas bordas superior e inferior.
 *
 * Quem não pode usar as mãos também não pode usar a roda do mouse. Sem isto,
 * qualquer conteúdo mais alto que a tela — um texto, uma lista de frases, o
 * guia do cuidador — fica inalcançável a partir do primeiro rolar.
 *
 * ## Máquina pura
 *
 * Sem DOM, sem timer, sem relógio próprio: o chamador passa a posição do olhar,
 * a altura da viewport e o instante, e recebe a velocidade. Toda a regra —
 * inclusive o sinal, que é o erro clássico deste código — fica testável sem
 * câmera nem navegador.
 *
 * ## O que NÃO mora aqui
 *
 * A decisão de rolar. Quem decide é o despachante de olhar do app, e a regra é
 * dele: **só rola quando não há nada clicável sob o olhar.** É isso que impede
 * a faixa de roubar o botão de emergência, que fica exatamente numa borda —
 * `top: 2rem` no uso normal e `bottom: 1.5rem` durante a medição. Uma lista de
 * exceções por posição envelheceria no primeiro botão novo perto de uma borda.
 */

/**
 * Altura da zona sensível em cada borda, em px CSS.
 *
 * ~8% de uma tela de 1080. Menor fica difícil de acertar com o olhar calibrado
 * a ~1,4° de erro; maior começa a comer área útil.
 */
export const FAIXA_PX = 90;

/**
 * Quanto tempo o olhar precisa ficar na faixa antes de a rolagem começar.
 *
 * Sem isto, uma passada de olho pela borda move a tela de quem está lendo, e a
 * pessoa perde o lugar sem entender por quê.
 */
export const ATRASO_MS = 300;

/** Teto da velocidade. Um olhar fora da tela não pode virar rolagem infinita. */
export const VELOCIDADE_MAX_PX_S = 900;

/** Velocidade ao cruzar a linha da faixa. Entrar não pode ser um salto. */
const VELOCIDADE_MIN_PX_S = 60;

export type Borda = 'cima' | 'baixo' | null;

export interface EstadoDeBorda {
  /** Em qual faixa o olhar está. `null` = fora das duas. */
  readonly borda: Borda;
  /** Instante em que o olhar entrou na faixa atual. */
  readonly desdeMs: number;
}

export const estadoInicialDeBorda = (): EstadoDeBorda => ({
  borda: null,
  desdeMs: 0,
});

function bordaDe(y: number, alturaPx: number): Borda {
  if (!Number.isFinite(y) || !(alturaPx > 0)) return null;

  // Faixas que se sobrepõem (janela mais baixa que duas faixas) não podem
  // pedir rolagem nas duas direções: o mesmo ponto seria "cima" e "baixo".
  if (alturaPx < FAIXA_PX * 2) return null;

  if (y <= FAIXA_PX) return 'cima';
  if (y >= alturaPx - FAIXA_PX) return 'baixo';
  return null;
}

/**
 * Profundidade dentro da faixa, de 0 (na linha) a 1 (na borda da tela).
 * Presa em 1: o olhar pode cair fora da tela.
 */
function profundidade(y: number, alturaPx: number, borda: Borda): number {
  const bruta =
    borda === 'cima' ? (FAIXA_PX - y) / FAIXA_PX : (y - (alturaPx - FAIXA_PX)) / FAIXA_PX;
  return Math.min(1, Math.max(0, bruta));
}

export interface ResultadoDaBorda {
  estado: EstadoDeBorda;
  /** px/s. Negativo = para cima, positivo = para baixo, 0 = parado. */
  velocidadePxS: number;
}

export function velocidadeDaBorda(
  estado: EstadoDeBorda,
  y: number,
  alturaPx: number,
  agoraMs: number,
): ResultadoDaBorda {
  const borda = bordaDe(y, alturaPx);

  // Sair da faixa, ou trocar de faixa, REINICIA o prazo. Sem isso, 200 ms numa
  // borda mais 200 ms depois de desviar somariam 400 ms e rolariam sem ninguém
  // ter ficado olhando; e atravessar a tela herdaria o tempo da primeira borda,
  // rolando na direção oposta de imediato.
  if (borda === null) {
    return { estado: estadoInicialDeBorda(), velocidadePxS: 0 };
  }
  if (borda !== estado.borda) {
    return { estado: { borda, desdeMs: agoraMs }, velocidadePxS: 0 };
  }

  const proximo: EstadoDeBorda = estado;

  if (agoraMs - estado.desdeMs < ATRASO_MS) {
    return { estado: proximo, velocidadePxS: 0 };
  }

  // Aceleração linear entre o mínimo (na linha) e o teto (na borda da tela).
  const p = profundidade(y, alturaPx, borda);
  const magnitude = VELOCIDADE_MIN_PX_S + (VELOCIDADE_MAX_PX_S - VELOCIDADE_MIN_PX_S) * p;

  return {
    estado: proximo,
    velocidadePxS: borda === 'cima' ? -magnitude : magnitude,
  };
}
