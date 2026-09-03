// P5.1 — topologia do Face Mesh: índices com nome, e falha visível.
//
// ── Decisão C4: manter 478 pontos ───────────────────────────────────────────
//
// A especificação do pipeline novo menciona 468. O projeto mantém **478**, e o
// motivo é o sinal primário: os 10 pontos extras são o refinamento de ÍRIS
// (468–477), e é o deslocamento da íris que o modelo de gaze usa. Com 468
// pontos não existe centro de íris — o vetor de features seria outro produto.
//
// ── Por que este módulo existe ──────────────────────────────────────────────
//
// Os índices estavam soltos pelo `extractor.ts`: `landmarks[159]`,
// `landmarks[386]`, `landmarks[374]`. Três problemas com isso:
//
//   1. Ninguém revisa `landmarks[374]` — não há como saber, lendo, se é a
//      pálpebra inferior direita ou outra coisa. Um índice trocado produz um
//      EAR plausível e errado, que é o modo de falha mais caro deste projeto.
//   2. `P5.2` (head pose por PnP) precisa dos mesmos pontos. Duplicar os
//      índices num segundo módulo é como duas constantes antropométricas
//      divergiram no passado.
//   3. Um modelo de 468 pontos faz `landmarks[468]` devolver `undefined`, e o
//      código seguia adiante montando features com `NaN`.
//
// ── A convenção de lado ─────────────────────────────────────────────────────
//
// "Esquerdo" e "direito" seguem o MediaPipe, que nomeia pelo lado da PESSOA.
// Numa imagem não espelhada, o olho esquerdo dela aparece à DIREITA do quadro.
// Trocar isso inverte o sinal de yaw sem erro nenhum aparecendo.

import {
  LM_CANTO_EXTERNO_ESQUERDO,
  LM_CANTO_EXTERNO_DIREITO,
  LM_IRIS_ESQUERDA,
  LM_IRIS_DIREITA,
} from './anthropometry';

/** Contagem do Face Mesh COM refinamento de íris. É o que o projeto exige. */
export const FACE_MESH_LANDMARK_COUNT = 478;

/** Contagem SEM refinamento de íris. Aceitar isto silenciosamente é o defeito
 *  que `assertFaceMeshCompleto` existe para impedir. */
export const FACE_MESH_SEM_IRIS = 468;

/** Contorno de um olho: os quatro pontos que definem largura e altura. */
export interface ContornoOcular {
  /** Canto externo (lado de fora do rosto). */
  readonly externo: number;
  /** Canto interno (lado do nariz). */
  readonly interno: number;
  /** Pálpebra superior, no meio do olho. */
  readonly superior: number;
  /** Pálpebra inferior, no meio do olho. */
  readonly inferior: number;
}

export const OLHO_ESQUERDO: ContornoOcular = {
  externo: LM_CANTO_EXTERNO_ESQUERDO,  // 33
  interno: 133,
  superior: 159,
  inferior: 145,
};

export const OLHO_DIREITO: ContornoOcular = {
  externo: LM_CANTO_EXTERNO_DIREITO,   // 263
  interno: 362,
  superior: 386,
  inferior: 374,
};

/** Anel de íris: centro mais os quatro pontos cardeais do refinamento. */
export interface AnelDeIris {
  readonly centro: number;
  readonly direita: number;
  readonly superior: number;
  readonly esquerda: number;
  readonly inferior: number;
}

export const IRIS_ESQUERDA: AnelDeIris = {
  centro: LM_IRIS_ESQUERDA,  // 468
  direita: 469,
  superior: 470,
  esquerda: 471,
  inferior: 472,
};

export const IRIS_DIREITA: AnelDeIris = {
  centro: LM_IRIS_DIREITA,   // 473
  direita: 474,
  superior: 475,
  esquerda: 476,
  inferior: 477,
};

/** Ponta do nariz. É o ponto que `translationCompensation` usa como centro
 *  facial, por ser o mais estável a expressão. */
export const NARIZ_PONTA = 1;
/** Base do nariz (subnasal), entre as narinas. */
export const NARIZ_BASE = 2;
/** Ponto mais baixo do queixo (mento). */
export const QUEIXO = 152;
/** Topo da testa, na linha média. */
export const TESTA_TOPO = 10;
/** Cantos da boca — esquerdo e direito da pessoa. */
export const BOCA_CANTO_ESQUERDO = 61;
export const BOCA_CANTO_DIREITO = 291;
/** Extremos das sobrancelhas: início (perto do nariz) e fim (lado de fora). */
export const SOBRANCELHA_ESQUERDA_INICIO = 55;
export const SOBRANCELHA_ESQUERDA_FIM = 46;
export const SOBRANCELHA_DIREITA_INICIO = 285;
export const SOBRANCELHA_DIREITA_FIM = 276;

/**
 * Os seis pontos do PnP clássico (`P5.2`), na ordem canônica da literatura:
 * ponta do nariz, queixo, canto externo esquerdo, canto externo direito, canto
 * esquerdo da boca, canto direito da boca.
 *
 * A ordem importa: ela precisa corresponder, item a item, ao modelo 3D
 * canônico em `src/pose/solvePnP.ts`. Trocar dois pontos aqui produz uma pose
 * que converge para um valor errado sem sinal de erro.
 */
export const PONTOS_PNP: readonly number[] = [
  NARIZ_PONTA,
  QUEIXO,
  LM_CANTO_EXTERNO_ESQUERDO,
  LM_CANTO_EXTERNO_DIREITO,
  BOCA_CANTO_ESQUERDO,
  BOCA_CANTO_DIREITO,
];

/** Todos os índices que o pipeline lê, para validação de cobertura. */
export const INDICES_USADOS: readonly number[] = [
  OLHO_ESQUERDO.externo, OLHO_ESQUERDO.interno, OLHO_ESQUERDO.superior, OLHO_ESQUERDO.inferior,
  OLHO_DIREITO.externo, OLHO_DIREITO.interno, OLHO_DIREITO.superior, OLHO_DIREITO.inferior,
  IRIS_ESQUERDA.centro, IRIS_ESQUERDA.direita, IRIS_ESQUERDA.superior, IRIS_ESQUERDA.esquerda, IRIS_ESQUERDA.inferior,
  IRIS_DIREITA.centro, IRIS_DIREITA.direita, IRIS_DIREITA.superior, IRIS_DIREITA.esquerda, IRIS_DIREITA.inferior,
  NARIZ_PONTA, NARIZ_BASE, QUEIXO, TESTA_TOPO,
  BOCA_CANTO_ESQUERDO, BOCA_CANTO_DIREITO,
  SOBRANCELHA_ESQUERDA_INICIO, SOBRANCELHA_ESQUERDA_FIM,
  SOBRANCELHA_DIREITA_INICIO, SOBRANCELHA_DIREITA_FIM,
];

/**
 * Erro de topologia. Tipo próprio para o chamador poder distinguir "modelo
 * errado" (permanente, exige ação) de "quadro ruim" (transitório).
 */
export class FaceMeshTopologyError extends Error {
  /** Contagem recebida, para o diagnóstico. Campo explícito em vez de
   *  parameter property: o projeto compila com `erasableSyntaxOnly`. */
  readonly recebido: number;

  constructor(recebido: number) {
    super(
      `[faceMesh] esperava ${FACE_MESH_LANDMARK_COUNT} landmarks, recebeu ${recebido}. ` +
      (recebido === FACE_MESH_SEM_IRIS
        ? 'Isto é o Face Mesh SEM refinamento de íris. O pipeline inteiro depende do ' +
          'deslocamento da íris (landmarks 468–477) como sinal primário — sem eles não há ' +
          'o que rastrear. Ligue `refineLandmarks: true` no FaceLandmarker.'
        : 'Contagem inesperada — verifique a versão do modelo do MediaPipe.'),
    );
    this.name = 'FaceMeshTopologyError';
    this.recebido = recebido;
  }
}

/**
 * Falha ALTO quando a topologia não é a esperada.
 *
 * ── Por que lançar, e não devolver vazio ────────────────────────────────────
 *
 * O código anterior fazia `if (landmarks.length < 478) return { featuresLeft: [] }`.
 * O engine tem um ramo para features vazias, então um modelo de 468 pontos
 * produziria um app que **liga, roda, e nunca rastreia** — sem uma linha no
 * console dizendo por quê. É o padrão de defeito que este repositório mais
 * paga: degradação silenciosa que se parece com "está lento hoje".
 *
 * Lançar coloca o problema no `loopGuard`, que conta erros consecutivos e os
 * expõe em `EngineDiagnostics.loop` (B2.4). Uma condição permanente aparece
 * como erro permanente, que é o comportamento honesto.
 *
 * Em produção isto nunca dispara: o `FaceLandmarker` é criado com refinamento
 * de íris e sempre devolve 478. O valor da guarda é justamente o dia em que
 * alguém mudar essa configuração.
 *
 * ── O que NÃO é erro de topologia ──────────────────────────────────────────
 *
 * Contagem **abaixo de 468** é entrada ausente ou parcial — quadro sem rosto,
 * detecção truncada. Isso é transitório e normal, e o contrato de `B1.1` é
 * claro: devolve vetor vazio, não lança. Com 100 pontos não há como distinguir
 * "sem rosto" de "modelo errado", então a resposta conservadora é a certa.
 *
 * A partir de 468 dá para distinguir: é um mesh facial de verdade, com a
 * topologia errada. Aí a falha é permanente e tem que aparecer.
 */
export function assertFaceMeshCompleto(landmarks: { length: number }): void {
  const n = landmarks.length;
  if (n === FACE_MESH_LANDMARK_COUNT) return;
  // Abaixo do mesh completo sem íris: entrada ausente/parcial, não topologia.
  if (n < FACE_MESH_SEM_IRIS) return;
  throw new FaceMeshTopologyError(n);
}

/** Entrada ausente ou parcial — o caso em que o contrato é devolver vazio. */
export function meshAusenteOuParcial(landmarks: { length: number }): boolean {
  return landmarks.length < FACE_MESH_LANDMARK_COUNT;
}
