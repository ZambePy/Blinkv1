/**
 * Contraluz — a janela atrás da pessoa.
 *
 * É a falha de iluminação mais comum em casa e a única que os medidores atuais
 * não enxergam. O motivo é mecânico: a checagem de luz mede o brilho no CROP
 * dos olhos, e o crop passa DEPOIS da exposição automática da webcam. Com uma
 * janela às costas do paciente, a câmera expõe para a janela, o rosto vira
 * silhueta — e o crop, já compensado, pode devolver um brilho perfeitamente
 * aceitável. O registro que existe no código é literal: "43 lux passaram como
 * iluminação boa".
 *
 * A grandeza que denuncia contraluz não é o brilho do rosto, e sim a RAZÃO
 * entre o fundo e o rosto. Um fundo três vezes mais claro que o rosto é
 * exatamente o que a auto-exposição não consegue resolver: ela escolhe entre
 * estourar o fundo ou apagar o rosto, e escolhe errado para o nosso uso.
 *
 * A medição é barata de propósito. O quadro inteiro é desenhado num canvas
 * minúsculo (64×36 ≈ 2.300 pixels) e não a cada quadro — o analisador de
 * qualidade já paga o custo de ler pixels 30 vezes por segundo, e contraluz é
 * propriedade do POSTO de uso, não do instante: ela muda quando alguém abre
 * uma cortina, não entre dois quadros.
 */

/**
 * `indefinido` não é um veredito: é a ausência dele. Existe porque a versão
 * anterior devolvia `'ok'` quando o rosto estava escuro demais para medir — e
 * a tela dizia "sem contraluz: o rosto está tão claro quanto o fundo" para um
 * quarto escuro com a janela ao fundo, que é exatamente o caso que este módulo
 * foi escrito para pegar.
 */
export type NivelDeContraluz = 'indefinido' | 'ok' | 'atencao' | 'forte';

export interface MedidaDeContraluz {
  /** Luminância média do rosto, 0–1. */
  rosto: number;
  /** Luminância média do resto do quadro, 0–1. */
  fundo: number;
  /** fundo / rosto. Acima de 1 o fundo é mais claro que a pessoa. */
  razao: number;
  nivel: NivelDeContraluz;
}

/**
 * Limiares.
 *
 * Uma sala bem iluminada de frente costuma dar razão perto de 1 (o rosto é tão
 * claro quanto o ambiente) e frequentemente abaixo de 1 — a pele reflete mais
 * que a parede. 1,8 é onde a silhueta começa a aparecer no histograma; 3,0 é
 * onde a borda da íris já está mole o bastante para o landmark tremer, que é o
 * defeito que interessa aqui.
 */
export const RAZAO_ATENCAO = 1.8;
export const RAZAO_FORTE = 3.0;

/** Abaixo disto o rosto está escuro demais para a razão significar alguma coisa. */
const ROSTO_MINIMO = 0.02;

export function classificarContraluz(rosto: number, fundo: number): MedidaDeContraluz {
  const r = Number.isFinite(rosto) ? Math.max(0, rosto) : 0;
  const f = Number.isFinite(fundo) ? Math.max(0, fundo) : 0;

  // Rosto quase preto: a divisão explodiria e diria "contraluz absurdo" para
  // uma câmera tampada. Sem rosto medível não há veredito de contraluz — o
  // problema ali é outro, e a checagem de brilho é quem fala.
  if (r < ROSTO_MINIMO) {
    return { rosto: r, fundo: f, razao: 0, nivel: 'indefinido' };
  }

  const razao = f / r;
  const nivel: NivelDeContraluz = razao >= RAZAO_FORTE ? 'forte' : razao >= RAZAO_ATENCAO ? 'atencao' : 'ok';
  return { rosto: r, fundo: f, razao, nivel };
}

export function mensagemDeContraluz(m: MedidaDeContraluz): string {
  switch (m.nivel) {
    case 'indefinido':
      return 'Rosto escuro demais para medir a luz do ambiente. Acenda uma luz de frente e tente de novo.';
    case 'forte':
      return (
        `O fundo está ${m.razao.toFixed(1)}× mais claro que o rosto — há luz forte atrás de você. ` +
        'Feche a cortina ou vire a cadeira de costas para a janela: a câmera está expondo para a luz e apagando os seus olhos.'
      );
    case 'atencao':
      return (
        `O fundo está ${m.razao.toFixed(1)}× mais claro que o rosto. ` +
        'Ainda funciona, mas fechar a cortina ou acender uma luz de frente melhora a leitura da íris.'
      );
    default:
      return 'Sem contraluz: o rosto está tão claro quanto o fundo.';
  }
}

// ---------------------------------------------------------------------------
// Medição no quadro. Só esta parte toca o DOM.
// ---------------------------------------------------------------------------

/** Lado maior do canvas de amostragem. Pequeno de propósito — ver o cabeçalho. */
export const LARGURA_DA_AMOSTRA = 64;

export interface RetanguloNormalizado {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/**
 * Separa a luminância dentro e fora de um retângulo, sobre pixels RGBA.
 *
 * Puro e exportado porque é aqui que mora o erro fácil: confundir a ordem dos
 * canais, esquecer o alfa, ou contar o rosto duas vezes ao somar o fundo.
 */
export function separarLuminancia(
  pixels: Uint8ClampedArray,
  largura: number,
  altura: number,
  rosto: RetanguloNormalizado,
): { rosto: number; fundo: number } {
  const x0 = Math.max(0, Math.floor(rosto.x * largura));
  const y0 = Math.max(0, Math.floor(rosto.y * altura));
  const x1 = Math.min(largura, Math.ceil((rosto.x + rosto.largura) * largura));
  const y1 = Math.min(altura, Math.ceil((rosto.y + rosto.altura) * altura));

  let somaRosto = 0;
  let nRosto = 0;
  let somaFundo = 0;
  let nFundo = 0;

  for (let y = 0; y < altura; y++) {
    const dentroY = y >= y0 && y < y1;
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 4;
      // Rec. 601: é a ponderação que corresponde à percepção de claro/escuro,
      // e é a mesma que a exposição automática da câmera persegue.
      const lum = (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) / 255;
      if (dentroY && x >= x0 && x < x1) {
        somaRosto += lum;
        nRosto++;
      } else {
        somaFundo += lum;
        nFundo++;
      }
    }
  }

  return {
    rosto: nRosto > 0 ? somaRosto / nRosto : 0,
    fundo: nFundo > 0 ? somaFundo / nFundo : 0,
  };
}

/**
 * Mede contraluz a partir do vídeo, no máximo uma vez a cada `intervaloMs`.
 *
 * Guarda a última medida: chamadas dentro do intervalo devolvem o valor
 * anterior em vez de `null`, para a interface não piscar entre "medido" e "não
 * medido" a cada quadro.
 */
export class MedidorDeContraluz {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private ultimaMedidaMs = -Infinity;
  private ultima: MedidaDeContraluz | null = null;
  private readonly intervaloMs: number;

  constructor(intervaloMs = 2000) {
    this.intervaloMs = intervaloMs;
  }

  get medida(): MedidaDeContraluz | null {
    return this.ultima;
  }

  /**
   * Esquece a última medida e libera a próxima imediatamente.
   *
   * Chamado ao reiniciar a sessão: contraluz é propriedade do POSTO de uso, e
   * o posto muda quando alguém leva o computador para outro cômodo. Sem isto,
   * a primeira leitura depois de um `start()` trazia a razão medida na sala
   * anterior — e a tela acusava "luz forte atrás de você" num lugar sem
   * janela nenhuma.
   */
  reiniciar(): void {
    this.ultima = null;
    this.ultimaMedidaMs = -Infinity;
  }

  medir(
    video: { videoWidth: number; videoHeight: number } & CanvasImageSource,
    rosto: RetanguloNormalizado,
    agoraMs: number,
  ): MedidaDeContraluz | null {
    if (agoraMs - this.ultimaMedidaMs < this.intervaloMs) return this.ultima;
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (vw <= 0 || vh <= 0) return this.ultima;

    this.ultimaMedidaMs = agoraMs;

    const largura = LARGURA_DA_AMOSTRA;
    const altura = Math.max(1, Math.round((largura * vh) / vw));

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this.ctx || !this.canvas) return this.ultima;
    if (this.canvas.width !== largura || this.canvas.height !== altura) {
      this.canvas.width = largura;
      this.canvas.height = altura;
    }

    try {
      this.ctx.drawImage(video, 0, 0, largura, altura);
      const dados = this.ctx.getImageData(0, 0, largura, altura).data;
      const { rosto: lumRosto, fundo: lumFundo } = separarLuminancia(dados, largura, altura, rosto);
      this.ultima = classificarContraluz(lumRosto, lumFundo);
    } catch {
      // Canvas contaminado (origem cruzada) ou vídeo sem quadro: não medimos,
      // e não inventamos. A interface diz "não medido", que é a verdade.
      this.ultima = null;
    }
    return this.ultima;
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.ctx = null;
    this.ultima = null;
  }
}
