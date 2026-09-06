import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCalibrationDistancesCm,
  captureReferenceStateForProfile,
  restoreReferenceStateFromProfile,
  profileTemReferencia,
  type CalibrationReferenceState,
} from './calibration';
import { deslocamentoPorPose } from './poseCompensation';
import type { StoredCalibrationProfile } from './calibrationProfiles';

// O estado de referência da calibração (pose, centro facial, distâncias,
// refDistance, eyeReliability) é persistido no perfil e restaurado com ele;
// sem isso a compensação de pose vira no-op após reload e a `eyeReliability`
// de um perfil vaza para o seguinte.

/** Perfil mínimo válido, sem estado de referência (schema antigo). */
function perfilSemReferencia(id: string): StoredCalibrationProfile {
  return {
    meta: {
      id,
      label: 'Perfil antigo',
      createdAt: new Date().toISOString(),
      opticalCondition: 'desconhecido',
    },
    modelLeft:  { betaX: [0, 1], betaY: [0, 1], numFeatures: 1, lambda: 1, lambdaX: 1, lambdaY: 1, nearSingularCols: [], penalty: 'isotropic' },
    modelRight: { betaX: [0, 1], betaY: [0, 1], numFeatures: 1, lambda: 1, lambdaX: 1, lambdaY: 1, nearSingularCols: [], penalty: 'isotropic' },
    scalerParamsLeft:  { means: [0], stds: [1] },
    scalerParamsRight: { means: [0], stds: [1] },
  };
}

const REFERENCIA: CalibrationReferenceState = {
  pose: { yaw: 0.12, pitch: -0.07, roll: 0.02 },
  center: { x: 0.48, y: 0.52 },
  cameraDistanceCm: 25,
  screenDistanceCm: 60,
  refDistance: 3.31,
  eyeReliability: { left: 0.85, right: 0.15 },
};

describe('o estado de referência entra no perfil', () => {
  it('captureReferenceStateForProfile devolve todos os seis campos', () => {
    // Se um campo novo for adicionado ao estado de referência e esquecido
    // aqui, ele volta a sumir no reload.
    const chaves = Object.keys(REFERENCIA).sort();
    expect(chaves).toEqual([
      'cameraDistanceCm',
      'center',
      'eyeReliability',
      'pose',
      'refDistance',
      'screenDistanceCm',
    ]);
  });

  it('restaurar um perfil recoloca a pose de referência', () => {
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(captureReferenceStateForProfile().pose).toEqual(REFERENCIA.pose);
  });

  it('restaurar recoloca o centro facial de referência', () => {
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(captureReferenceStateForProfile().center).toEqual(REFERENCIA.center);
  });

  it('restaurar recoloca as duas distâncias', () => {
    restoreReferenceStateFromProfile(REFERENCIA);
    const d = getCalibrationDistancesCm();
    expect(d.cameraCm).toBe(25);
    expect(d.screenCm).toBe(60);
  });

  it('restaurar recoloca o proxy adimensional de distância', () => {
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(captureReferenceStateForProfile().refDistance).toBeCloseTo(3.31, 5);
  });
});

describe('a compensação de pose sobrevive ao reload', () => {
  it('o deslocamento por pose é idêntico antes e depois de simular F5', () => {
    // Sem referência restaurada, `deslocamentoPorPose(atual, null, …)` devolve
    // {0,0} — a compensação some sem log, sem erro, sem sinal na UI.
    const poseAtual = { yaw: 0.30, pitch: -0.15, roll: 0.0 };
    const distanciaPx = 2000;

    restoreReferenceStateFromProfile(REFERENCIA);
    const antes = deslocamentoPorPose(poseAtual, captureReferenceStateForProfile().pose, distanciaPx);

    // "Reload": o estado de módulo some, o perfil é recarregado do snapshot.
    restoreReferenceStateFromProfile(null);
    expect(captureReferenceStateForProfile().pose).toBeNull();
    const semReferencia = deslocamentoPorPose(poseAtual, captureReferenceStateForProfile().pose, distanciaPx);
    expect(semReferencia).toEqual({ dx: 0, dy: 0 }); // sem referência, sem compensação

    restoreReferenceStateFromProfile(REFERENCIA);
    const depois = deslocamentoPorPose(poseAtual, captureReferenceStateForProfile().pose, distanciaPx);

    expect(depois).toEqual(antes);
    // E o deslocamento tem que ser substancial — se fosse ~0 o teste passaria
    // por acidente mesmo com a compensação desligada.
    expect(Math.abs(depois.dx)).toBeGreaterThan(50);
  });
});

describe('eyeReliability pertence ao perfil, não à sessão', () => {
  beforeEach(() => {
    restoreReferenceStateFromProfile(null);
  });

  it('restaurar um perfil instala a confiabilidade dele', () => {
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(captureReferenceStateForProfile().eyeReliability).toEqual({ left: 0.85, right: 0.15 });
  });

  it('trocar para um perfil com outra confiabilidade substitui a anterior', () => {
    // Calibra "com óculos" (olho direito ruim), troca para "sem óculos":
    // `mapGaze` não pode continuar multiplicando por 0,85/0,15 num modelo que
    // nunca os produziu.
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(captureReferenceStateForProfile().eyeReliability).toEqual({ left: 0.85, right: 0.15 });

    restoreReferenceStateFromProfile({
      ...REFERENCIA,
      eyeReliability: { left: 0.5, right: 0.5 },
    });
    expect(captureReferenceStateForProfile().eyeReliability).toEqual({ left: 0.5, right: 0.5 });
  });

  it('trocar para um perfil sem confiabilidade zera em vez de herdar', () => {
    // Perfil de schema antigo, ou perfil cuja calibração não mediu
    // confiabilidade. Herdar a do perfil anterior é pior que não ter nenhuma:
    // a média simples é neutra, o peso herdado é errado e invisível.
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(captureReferenceStateForProfile().eyeReliability).not.toBeNull();

    restoreReferenceStateFromProfile({ ...REFERENCIA, eyeReliability: null });
    expect(captureReferenceStateForProfile().eyeReliability).toBeNull();
  });
});

describe('perfis de schema antigo são invalidados, não carregados com null', () => {
  it('um perfil sem `reference` é rejeitado pelo validador', () => {
    // Carregar com null deixaria a compensação desligada em silêncio.
    const antigo = perfilSemReferencia('velho_1');
    expect(profileTemReferencia(antigo)).toBe(false);
  });

  it('um perfil com `reference` completo é aceito', () => {
    const novo = { ...perfilSemReferencia('novo_1'), reference: REFERENCIA };
    expect(profileTemReferencia(novo)).toBe(true);
  });

  it('um `reference: {}` vazio não passa', () => {
    // Presença do objeto não basta: `reference: {}` passaria numa checagem de
    // truthiness e restauraria tudo como null, em silêncio.
    const vazio = {
      ...perfilSemReferencia('vazio_1'),
      reference: {} as CalibrationReferenceState,
    };
    expect(profileTemReferencia(vazio)).toBe(false);
  });
});
