/**
 * Estabilizador por estado do olho: fixação congela, sacada solta (sprint S5).
 *
 * ## Por que um filtro só não dá conta
 *
 * Qualquer filtro de parâmetro único é obrigado a ser ruim em algum regime:
 * manso o bastante para uma fixação estável é lento demais para uma sacada, e
 * vice-versa. É o compromisso que a função de custo precisão×atraso mede — e
 * ele só se resolve de verdade classificando o estado ANTES de filtrar.
 *
 * ## O que este estágio faz, e por que ele é o ganho barato
 *
 * Durante uma fixação, a melhor estimativa da posição do olhar não é a última
 * amostra: é a MÉDIA das amostras da fixação. Com 30 Hz e uma janela de 200 ms
 * isso já divide o ruído por √6; ao longo de um dwell de 1500 ms o mesmo
 * raciocínio leva o tremor de ~22 px para ~3 px. A medição M1 registrou razão
 * de filtro 0,99 — o One Euro em produção praticamente não suaviza — então esse
 * espaço está inteiro disponível.
 *
 * Na sacada, o oposto: a média é veneno, porque mistura o ponto de partida com
 * o de chegada. Detectada a sacada, a janela é jogada fora e a saída volta a
 * ser a amostra filtrada, sem atraso adicional nenhum.
 *
 * ## O critério
 *
 * Dispersão I-DT clássica — (máx − mín) em X mais (máx − mín) em Y sobre a
 * janela — comparada a um limiar em GRAUS, convertido para pixels pela
 * geometria da tela. Com histerese: entra em fixação abaixo de 1,0° e só sai
 * acima de 1,5°. Sem histerese o estado oscilaria a cada quadro no limiar, e o
 * cursor pularia entre a média e a amostra crua.
 *
 * Sem geometria não há como converter graus em pixels, e aí este estágio se
 * declara inativo e devolve a entrada intacta — nunca um chute.
 */

import { pixelsPorGrau, type GeometriaDeTela } from './angularVelocity';

/** Janela de análise. 200 ms a 30 Hz são ~6 amostras — o mesmo tempo que a
 *  zona morta do EMA adaptativo já usa. */
export const JANELA_MS = 200;

/** Abaixo desta dispersão, é fixação. O 1,0° é o valor clássico do I-DT. */
export const LIMIAR_FIXACAO_DEG = 1.0;

/** Acima desta, sai de fixação. A folga é a histerese. */
export const LIMIAR_SACADA_DEG = 1.5;

/**
 * Mínimo de amostras para declarar fixação.
 *
 * Quatro: com menos, a dispersão de uma janela recém-criada é pequena
 * simplesmente porque ela tem poucos pontos, e toda sacada começaria
 * classificada como fixação.
 */
export const MIN_AMOSTRAS = 4;

/**
 * Quanto a saída pode se afastar da amostra corrente, em graus.
 *
 * É a guarda mais importante deste módulo, e ela existe por um modo de falha
 * concreto: quatro botões que se encontram num canto. Se o olhar alterna entre
 * dois quadrantes opostos com dispersão abaixo do limiar de fixação, a média
 * cai bem no encontro dos quatro — um lugar onde o olhar cru NUNCA esteve — e,
 * pior, cai lá PARADA, o que faz o dwell concluir. Trocar letra errada é
 * exatamente o dano que este produto não pode causar.
 *
 * Com o teto, a saída nunca fica a mais de meio grau de onde o olho está de
 * fato. Meio grau é bem menor que qualquer alvo desta interface (o mínimo é
 * 5°), então a média continua tirando ruído sem poder inventar posição.
 */
export const DESLOCAMENTO_MAX_DEG = 0.5;

interface Amostra {
  x: number;
  y: number;
  t: number;
}

export type EstadoDoOlho = 'fixando' | 'movendo';

export interface SaidaDoEstabilizador {
  x: number;
  y: number;
  estado: EstadoDoOlho;
  /** Dispersão da janela em graus. `null` sem geometria ou janela curta. */
  dispersaoDeg: number | null;
  /** Amostras que compuseram a média. 1 = a saída é a própria entrada. */
  amostrasNaMedia: number;
}

export class EstabilizadorDeFixacao {
  private readonly janela: Amostra[] = [];
  private readonly pxPorGrau: number | null;
  private estado: EstadoDoOlho = 'movendo';

  constructor(geometria: GeometriaDeTela | null | undefined) {
    this.pxPorGrau = geometria ? pixelsPorGrau(geometria) : null;
  }

  /** O estágio tem geometria para trabalhar? */
  get ativo(): boolean {
    return this.pxPorGrau !== null && this.pxPorGrau > 0;
  }

  reset(): void {
    this.janela.length = 0;
    this.estado = 'movendo';
  }

  /** Dispersão I-DT da janela, em pixels. */
  private dispersaoPx(): number {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const a of this.janela) {
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
    }
    return (maxX - minX) + (maxY - minY);
  }

  processar(x: number, y: number, nowMs: number): SaidaDoEstabilizador {
    if (!this.ativo || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(nowMs)) {
      return { x, y, estado: 'movendo', dispersaoDeg: null, amostrasNaMedia: 1 };
    }

    this.janela.push({ x, y, t: nowMs });
    // Descarta o que saiu da janela. `<=` e não `<`: uma amostra exatamente no
    // limite é do passado, e mantê-la faria a janela crescer sem teto quando o
    // relógio parasse de avançar.
    while (this.janela.length > 0 && nowMs - this.janela[0].t >= JANELA_MS) {
      this.janela.shift();
    }
    // A amostra corrente pode ter sido descartada junto (relógio para trás, ou
    // uma pausa maior que a janela). Recomeça a janela com ela.
    if (this.janela.length === 0) this.janela.push({ x, y, t: nowMs });

    const px = this.pxPorGrau as number;
    const dispersaoDeg = this.janela.length >= 2 ? this.dispersaoPx() / px : null;

    if (this.janela.length < MIN_AMOSTRAS || dispersaoDeg === null) {
      this.estado = 'movendo';
      return { x, y, estado: 'movendo', dispersaoDeg, amostrasNaMedia: 1 };
    }

    // Histerese: o limiar de entrada é mais exigente que o de saída.
    const limiar = this.estado === 'fixando' ? LIMIAR_SACADA_DEG : LIMIAR_FIXACAO_DEG;
    if (dispersaoDeg > limiar) {
      // Sacada: a média é veneno aqui, porque mistura a partida com a chegada.
      // A janela vai fora inteira para a próxima fixação começar limpa.
      this.estado = 'movendo';
      this.janela.length = 0;
      this.janela.push({ x, y, t: nowMs });
      return { x, y, estado: 'movendo', dispersaoDeg, amostrasNaMedia: 1 };
    }

    this.estado = 'fixando';
    let sx = 0;
    let sy = 0;
    for (const a of this.janela) {
      sx += a.x;
      sy += a.y;
    }
    const n = this.janela.length;
    let mx = sx / n;
    let my = sy / n;

    // Teto de deslocamento: a média pode limpar ruído, não inventar posição.
    // Ver `DESLOCAMENTO_MAX_DEG`.
    const maxPx = DESLOCAMENTO_MAX_DEG * px;
    const dx = mx - x;
    const dy = my - y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxPx) {
      const escala = maxPx / dist;
      mx = x + dx * escala;
      my = y + dy * escala;
    }

    return {
      x: mx,
      y: my,
      estado: 'fixando',
      dispersaoDeg,
      amostrasNaMedia: n,
    };
  }
}
