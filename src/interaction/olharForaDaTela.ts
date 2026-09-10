/**
 * "O cursor travou" — o diagnóstico honesto de um sintoma que não era um bug.
 *
 * O relato é sempre o mesmo: o paciente olha para baixo, o cursor cola na
 * borda inferior e não sai mais de lá. Parece travamento; não é. A predição
 * saiu da tela, o `softClamp` devolve exatamente 1 em todo quadro, e o cursor
 * fica onde deveria ficar — grudado no ponto mais próximo do que está sendo
 * olhado. O defeito real era o SILÊNCIO: o estado seguia `tracking`, sem nada
 * na tela explicando o que estava acontecendo.
 *
 * Este módulo transforma a saturação instantânea (ruidosa, alterna a cada
 * quadro na borda) num veredito estável o bastante para virar texto na tela.
 * Duas assimetrias deliberadas:
 *
 *   - entra devagar (600 ms fora): passar pela borda a caminho de outro alvo é
 *     normal e não merece aviso;
 *   - sai depressa (200 ms dentro): assim que o paciente volta para a tela, o
 *     aviso some — um aviso que persiste depois de resolvido ensina o usuário
 *     a ignorar avisos.
 *
 * Trocar de direção enquanto já está avisando (de "baixo" para "direita")
 * reinicia a contagem: a mensagem estaria errada, e uma mensagem errada é pior
 * que nenhuma.
 */

export type DirecaoDeFuga = 'cima' | 'baixo' | 'esquerda' | 'direita';

export interface AmostraDeSaturacao {
  fora: boolean;
  direcao: DirecaoDeFuga | null;
  /** Há rosto no quadro. Sem rosto o assunto é outro (perda de rastreamento). */
  temRosto: boolean;
  tMs: number;
}

export interface VeredictoDeFuga {
  /** Deve haver aviso na tela agora. */
  avisar: boolean;
  direcao: DirecaoDeFuga | null;
  /** Texto pronto para a interface, ou `null`. */
  mensagem: string | null;
}

export const ENTRAR_MS = 600;
export const SAIR_MS = 200;

const TEXTOS: Record<DirecaoDeFuga, string> = {
  baixo: 'Você está olhando abaixo da tela — o cursor parou na borda de baixo. Levante o olhar para voltar a mover.',
  cima: 'Você está olhando acima da tela — o cursor parou na borda de cima. Baixe o olhar para voltar a mover.',
  esquerda: 'Você está olhando à esquerda da tela — o cursor parou na borda esquerda.',
  direita: 'Você está olhando à direita da tela — o cursor parou na borda direita.',
};

/**
 * Máquina de estado do aviso. Uma instância por sessão de rastreamento; o
 * chamador alimenta uma amostra por quadro e usa o veredito devolvido.
 */
export class DetectorDeOlharForaDaTela {
  private foraDesde: number | null = null;
  private dentroDesde: number | null = null;
  private direcaoAtual: DirecaoDeFuga | null = null;
  private avisando = false;

  avaliar(a: AmostraDeSaturacao): VeredictoDeFuga {
    // Sem rosto não há o que dizer sobre para onde a pessoa está olhando; quem
    // trata esse caso é o aviso de perda de rastreamento.
    if (!a.temRosto) {
      this.zerar();
      return { avisar: false, direcao: null, mensagem: null };
    }

    if (a.fora && a.direcao) {
      this.dentroDesde = null;
      // O RELÓGIO conta "fora da tela", não "fora nesta direção". A distinção é
      // o que faz a fuga na diagonal funcionar: olhando para o canto inferior
      // direito, os dois excessos ficam próximos e o desempate de
      // `avaliarSaturacao` alterna entre "baixo" e "direita" com o ruído da
      // predição. Reiniciar a contagem a cada alternância — como a primeira
      // versão fazia — deixava o contador zerando ~15 vezes por segundo, e o
      // aviso nunca aparecia justamente no canto, que é onde o cursor mais
      // parece travado.
      if (this.foraDesde === null) this.foraDesde = a.tMs;
      // A direção mostrada é sempre a do quadro atual enquanto o aviso ainda
      // não apareceu; depois de aparecer, ela é congelada, porque um texto que
      // pisca entre "abaixo" e "à direita" é pior que um texto aproximado.
      if (!this.avisando) this.direcaoAtual = a.direcao;
      if (a.tMs - this.foraDesde >= ENTRAR_MS) this.avisando = true;
    } else {
      this.foraDesde = null;
      if (this.dentroDesde === null) this.dentroDesde = a.tMs;
      else if (a.tMs - this.dentroDesde >= SAIR_MS) {
        this.avisando = false;
        this.direcaoAtual = null;
      }
    }

    return this.avisando && this.direcaoAtual
      ? { avisar: true, direcao: this.direcaoAtual, mensagem: TEXTOS[this.direcaoAtual] }
      : { avisar: false, direcao: null, mensagem: null };
  }

  /** Recomeça do zero (troca de tela, recalibração, perda de rosto). */
  zerar(): void {
    this.foraDesde = null;
    this.dentroDesde = null;
    this.direcaoAtual = null;
    this.avisando = false;
  }
}
