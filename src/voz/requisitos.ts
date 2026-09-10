/**
 * Requisitos de hardware da voz clonada — a tabela que o produto promete
 * publicar e que a tela mostra ANTES de o cuidador tentar.
 *
 * Existe por uma falha concreta: numa máquina apertada, carregar o modelo
 * (~3,5 GB em memória, todos os núcleos ocupados) travou o computador inteiro.
 * O motor hoje se defende com guarda de memória, teto de threads e prioridade
 * abaixo do normal, mas defesa técnica não substitui aviso honesto — quem tem
 * 8 GB precisa saber, antes de baixar 1,5 GB de modelo, que a experiência vai
 * ser ruim.
 *
 * Os números vêm da medição no computador de referência (16 GB, 12 núcleos,
 * CPU) e dos limites já codificados em `recursos.py`; não são estimativa de
 * marketing.
 */

import { VOZ_MEMORIA_NECESSARIA_GB } from './protocolo';

export type NivelDeHardware = 'insuficiente' | 'apertado' | 'adequado' | 'confortavel';

export interface FaixaDeHardware {
  nivel: NivelDeHardware;
  rotulo: string;
  memoriaGb: string;
  nucleos: string;
  /** O que o cuidador deve esperar na prática, em segundos de espera. */
  expectativa: string;
}

export const TABELA_DE_HARDWARE: readonly FaixaDeHardware[] = [
  {
    nivel: 'insuficiente',
    rotulo: 'Abaixo do mínimo',
    memoriaGb: 'menos de 8 GB',
    nucleos: 'qualquer',
    expectativa: 'A voz clonada não é recomendada. O paciente fala com a voz do sistema.',
  },
  {
    nivel: 'apertado',
    rotulo: 'Mínimo',
    memoriaGb: '8 a 12 GB',
    nucleos: '4 núcleos',
    expectativa:
      'Funciona com outros programas fechados. A primeira frase pode levar mais de um minuto e o computador fica lento enquanto o modelo carrega.',
  },
  {
    nivel: 'adequado',
    rotulo: 'Recomendado',
    memoriaGb: '16 GB',
    nucleos: '8 núcleos',
    expectativa:
      'Primeira frase em cerca de meio minuto; as frases do dia a dia saem do cache, sem espera.',
  },
  {
    nivel: 'confortavel',
    rotulo: 'Folgado',
    memoriaGb: '32 GB ou mais',
    nucleos: '12 núcleos ou mais',
    expectativa: 'Frases novas saem em poucos segundos mesmo fora do cache.',
  },
];

export interface MaquinaMedida {
  memoriaTotalGb: number;
  memoriaLivreGb: number;
  nucleos: number;
}

/**
 * Em que faixa este computador cai.
 *
 * A memória LIVRE decide o caso extremo — não adianta ter 32 GB instalados se
 * 30 estão ocupados pelo navegador: o modelo não carrega. Fora isso, a memória
 * total e os núcleos definem a faixa, e vale sempre a pior das duas.
 */
/** Qual das duas dimensões puxou a máquina para baixo. */
export type LimitanteDoHardware = 'memoria' | 'nucleos' | null;

export function avaliarMaquina(
  m: MaquinaMedida | null | undefined,
): { nivel: NivelDeHardware; limitante: LimitanteDoHardware } | null {
  if (!m || !Number.isFinite(m.memoriaTotalGb) || m.memoriaTotalGb <= 0) return null;

  const ordem: NivelDeHardware[] = ['insuficiente', 'apertado', 'adequado', 'confortavel'];
  const porMemoria: NivelDeHardware =
    m.memoriaTotalGb < 8 ? 'insuficiente'
    : m.memoriaTotalGb >= 32 ? 'confortavel'
    : m.memoriaTotalGb >= 16 ? 'adequado'
    : 'apertado';
  const porNucleos: NivelDeHardware =
    m.nucleos >= 12 ? 'confortavel' : m.nucleos >= 8 ? 'adequado' : m.nucleos >= 4 ? 'apertado' : 'insuficiente';

  const iMem = ordem.indexOf(porMemoria);
  const iNuc = ordem.indexOf(porNucleos);
  return {
    nivel: ordem[Math.min(iMem, iNuc)],
    // Saber QUAL das duas reprovou é o que separa um conselho útil de um
    // conselho caro e inútil: sem isto, uma máquina de 64 GB com 2 núcleos
    // recebia "compre mais memória".
    limitante: iMem === iNuc ? null : iMem < iNuc ? 'memoria' : 'nucleos',
  };
}

export function classificarMaquina(m: MaquinaMedida | null | undefined): NivelDeHardware | null {
  return avaliarMaquina(m)?.nivel ?? null;
}

/** O modelo cabe na memória livre AGORA? É a guarda que o motor aplica. */
export function cabeNaMemoriaLivre(m: MaquinaMedida | null | undefined): boolean {
  if (!m || !Number.isFinite(m.memoriaLivreGb)) return true;
  return m.memoriaLivreGb >= VOZ_MEMORIA_NECESSARIA_GB;
}

/**
 * Frase única para o cuidador.
 *
 * O recado nomeia a dimensão que de fato reprovou. A versão anterior falava
 * sempre de memória, e devolvia "este computador tem menos de 8 GB" para uma
 * máquina de 64 GB com dois núcleos — mandando o cuidador comprar memória que
 * não resolveria nada.
 */
export function recadoSobreOHardware(m: MaquinaMedida | null | undefined): string | null {
  const avaliacao = avaliarMaquina(m);
  if (!avaliacao) return null;
  if (!cabeNaMemoriaLivre(m)) {
    return `Memória livre abaixo de ${VOZ_MEMORIA_NECESSARIA_GB} GB. Feche outros programas antes de testar a voz.`;
  }

  const { nivel, limitante } = avaliacao;
  if (nivel === 'insuficiente') {
    if (limitante === 'nucleos') {
      return `Este computador tem ${m!.nucleos} ${m!.nucleos === 1 ? 'núcleo' : 'núcleos'} de processador: a voz clonada não é recomendada aqui, mesmo com memória de sobra.`;
    }
    return `Este computador tem ${m!.memoriaTotalGb.toFixed(0)} GB de memória, abaixo do mínimo de 8 GB: a voz clonada não é recomendada aqui.`;
  }
  if (nivel === 'apertado') {
    const causa =
      limitante === 'nucleos'
        ? `com ${m!.nucleos} núcleos`
        : `com ${m!.memoriaTotalGb.toFixed(0)} GB de memória`;
    return `Este computador está no mínimo (${causa}): a voz funciona, mas a primeira frase demora e o computador fica lento enquanto o modelo carrega.`;
  }
  return null;
}
