// Índices nomeados da topologia do Face Mesh (MediaPipe, 478 pontos).
//
// O projeto exige os 478 pontos, não 468: os 10 extras (468–477) são o
// refinamento de ÍRIS, e o deslocamento da íris é o sinal primário do modelo
// de gaze. Um índice trocado produz um EAR plausível e errado, por isso nada
// aqui é literal solto no `extractor.ts`.
//
// "Esquerdo" e "direito" seguem o MediaPipe, que nomeia pelo lado da PESSOA:
// numa imagem não espelhada, o olho esquerdo dela aparece à DIREITA do quadro.
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

/** Ponta do nariz — usada como centro facial por ser o ponto mais estável a
 *  expressão. */
export const NARIZ_PONTA = 1;
/** Topo da testa, na linha média. */
export const TESTA_TOPO = 10;

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
 * Lança quando a topologia não é a esperada.
 *
 * Devolver vetor vazio aqui produziria um app que liga, roda e nunca rastreia
 * sem uma linha de log. Lançar leva o problema ao `loopGuard`, que expõe erros
 * consecutivos em `EngineDiagnostics.loop`.
 *
 * Contagem ABAIXO de 468 não é erro de topologia: é quadro sem rosto ou
 * detecção parcial (transitório), e o contrato é devolver vazio. A partir de
 * 468 é um mesh facial de verdade com a topologia errada — falha permanente.
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
