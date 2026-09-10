/**
 * Olhos fechados por tempo demais — o segundo jeito de o cursor "travar" em
 * silêncio.
 *
 * O primeiro é o olhar sair da tela (`olharForaDaTela.ts`). Este é o irmão
 * dele, e a causa está descrita no próprio `calibration.ts`: **olhar para
 * baixo é onde a pálpebra cobre a íris**. Quando isso acontece, o detector de
 * piscada dispara e continua disparando; o `blinkHold` congela o cursor por
 * até 2 s projetando a velocidade; o dwell pausa (corretamente, para não
 * clicar sem querer); e depois disso tudo o cursor fica parado, com o rosto
 * presente, sem uma palavra na tela.
 *
 * O paciente vê exatamente o que veria num travamento. E a saída — levantar um
 * pouco o olhar, ou abrir mais os olhos — é trivial para quem sabe qual é o
 * problema, e inalcançável para quem não sabe.
 *
 * O limiar é deliberadamente MAIOR que o teto do `blinkHold` (2 s): enquanto o
 * hold está projetando, o cursor ainda se move de forma defensável e não há
 * nada a relatar. O aviso é para o que vem depois.
 */

export type EstadoDoOlho = 'open' | 'closed' | 'unknown';

export interface AmostraDeOlho {
  estado: EstadoDoOlho;
  temRosto: boolean;
  tMs: number;
}

export interface VeredictoDeOlhosFechados {
  avisar: boolean;
  mensagem: string | null;
  /** Há quanto tempo os olhos estão fechados, em ms. 0 fora de episódio. */
  duracaoMs: number;
}

/** Acima do teto de 2 s do `blinkHold`: antes disso o hold ainda projeta. */
export const FECHADO_ATE_AVISAR_MS = 2600;
/** Sai depressa: um olho reaberto é resposta imediata. */
export const ABERTO_PARA_LIMPAR_MS = 250;

export const MENSAGEM =
  'Os olhos estão fechados ou a pálpebra está cobrindo a íris — o cursor ficou parado. ' +
  'Se você estiver olhando para baixo, levante um pouco o olhar.';

export class DetectorDeOlhosFechados {
  private fechadoDesde: number | null = null;
  private abertoDesde: number | null = null;
  private avisando = false;

  avaliar(a: AmostraDeOlho): VeredictoDeOlhosFechados {
    // Sem rosto, ou sem informação de olho, o assunto é a perda de
    // rastreamento — que tem aviso próprio. Dizer "seus olhos estão fechados"
    // quando ninguém está enxergando o rosto seria chute.
    if (!a.temRosto || a.estado === 'unknown') {
      this.zerar();
      return { avisar: false, mensagem: null, duracaoMs: 0 };
    }

    if (a.estado === 'closed') {
      this.abertoDesde = null;
      if (this.fechadoDesde === null) this.fechadoDesde = a.tMs;
      const duracaoMs = a.tMs - this.fechadoDesde;
      if (duracaoMs >= FECHADO_ATE_AVISAR_MS) this.avisando = true;
      return this.avisando
        ? { avisar: true, mensagem: MENSAGEM, duracaoMs }
        : { avisar: false, mensagem: null, duracaoMs };
    }

    // Aberto.
    if (this.abertoDesde === null) this.abertoDesde = a.tMs;
    if (a.tMs - this.abertoDesde >= ABERTO_PARA_LIMPAR_MS) {
      this.fechadoDesde = null;
      this.avisando = false;
    }
    return this.avisando
      ? { avisar: true, mensagem: MENSAGEM, duracaoMs: this.fechadoDesde === null ? 0 : a.tMs - this.fechadoDesde }
      : { avisar: false, mensagem: null, duracaoMs: 0 };
  }

  zerar(): void {
    this.fechadoDesde = null;
    this.abertoDesde = null;
    this.avisando = false;
  }
}
