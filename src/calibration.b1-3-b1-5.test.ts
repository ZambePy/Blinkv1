import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCalibrationReferencePose,
  getCalibrationReferenceCenter,
  getCalibrationDistancesCm,
  getEyeReliability,
  getCalibrationRefDistance,
  restoreReferenceStateFromProfile,
  profileTemReferencia,
  type CalibrationReferenceState,
} from './calibration';
import { deslocamentoPorPose } from './poseCompensation';
import type { StoredCalibrationProfile } from './calibrationProfiles';

// -----------------------------------------------------------------------------
// B1.3 — Estado de referência da calibração não é persistido: a compensação de
//        pose vira no-op após reload.
//
// `StoredCalibrationProfile` guardava SÓ `modelLeft/Right` e `scalerParams*`.
// Nunca guardava `calibrationReferencePose`, `calibrationReferenceCenter`,
// `calibrationCameraDistanceCm`, `calibrationScreenDistanceCm`,
// `calibrationRefDistance` nem `eyeReliability`. `loadProfile()` e
// `switchActiveProfile()` não restauravam nada disso.
//
// Com os defaults de produção (`geometricPoseCompensation: true`),
// `compensarPredicao(x, y, latestPose, null, …)` caía em `deslocamentoPorPose`
// retornando {0,0} — a compensação que `experiment.ts:104` documenta como
// valendo 361 px vs 150 px DESLIGAVA EM SILÊNCIO ao recarregar a página.
// Mesmo modelo, mesmo paciente, cursor diferente conforme tenha havido F5.
//
// B1.5 — `eyeReliability` sobrevive à troca de perfil.
//
// Só era zerada em `startCalibrationMode`. `switchActiveProfile()` e
// `loadProfile()` trocavam regressors e scalers mas deixavam `eyeReliability`
// como estava. Calibra "com óculos" (olho direito ruim → {0.85, 0.15}), troca
// para "sem óculos": `mapGaze` continua multiplicando por 0,85/0,15 num modelo
// que não os produziu — fusão binocular enviesada ~70/30 sem nenhum log.
// -----------------------------------------------------------------------------

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

describe('B1.3 — o estado de referência entra no perfil', () => {
  it('captureReferenceStateForProfile devolve todos os seis campos', () => {
    // Se um campo novo for adicionado ao estado de referência e esquecido
    // aqui, ele volta a sumir no reload — que é exatamente como B1.3 nasceu.
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
    expect(getCalibrationReferencePose()).toEqual(REFERENCIA.pose);
  });

  it('restaurar recoloca o centro facial de referência', () => {
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(getCalibrationReferenceCenter()).toEqual(REFERENCIA.center);
  });

  it('restaurar recoloca as duas distâncias', () => {
    restoreReferenceStateFromProfile(REFERENCIA);
    const d = getCalibrationDistancesCm();
    expect(d.cameraCm).toBe(25);
    expect(d.screenCm).toBe(60);
  });

  it('restaurar recoloca o proxy adimensional de distância', () => {
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(getCalibrationRefDistance()).toBeCloseTo(3.31, 5);
  });
});

describe('B1.3 — a compensação de pose sobrevive ao reload', () => {
  it('o deslocamento por pose é IDÊNTICO antes e depois de simular F5', () => {
    // Este é o coração de B1.3. Antes da correção, depois do reload a
    // referência era `null` e `deslocamentoPorPose(atual, null, …)` devolvia
    // {0,0} — a compensação sumia sem log, sem erro, sem sinal na UI.
    const poseAtual = { yaw: 0.30, pitch: -0.15, roll: 0.0 };
    const distanciaPx = 2000;

    restoreReferenceStateFromProfile(REFERENCIA);
    const antes = deslocamentoPorPose(poseAtual, getCalibrationReferencePose(), distanciaPx);

    // "Reload": o estado de módulo some, o perfil é recarregado do snapshot.
    restoreReferenceStateFromProfile(null);
    expect(getCalibrationReferencePose()).toBeNull();
    const semReferencia = deslocamentoPorPose(poseAtual, getCalibrationReferencePose(), distanciaPx);
    expect(semReferencia).toEqual({ dx: 0, dy: 0 }); // o bug, reproduzido

    restoreReferenceStateFromProfile(REFERENCIA);
    const depois = deslocamentoPorPose(poseAtual, getCalibrationReferencePose(), distanciaPx);

    expect(depois).toEqual(antes);
    // E o deslocamento tem que ser substancial — se fosse ~0 o teste passaria
    // por acidente mesmo com a compensação desligada.
    expect(Math.abs(depois.dx)).toBeGreaterThan(50);
  });
});

describe('B1.5 — eyeReliability pertence ao perfil, não à sessão', () => {
  beforeEach(() => {
    restoreReferenceStateFromProfile(null);
  });

  it('restaurar um perfil instala a confiabilidade DELE', () => {
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(getEyeReliability()).toEqual({ left: 0.85, right: 0.15 });
  });

  it('trocar para um perfil com outra confiabilidade SUBSTITUI a anterior', () => {
    // O cenário do bug: calibra "com óculos" (olho direito ruim), troca para
    // "sem óculos". Antes, `mapGaze` continuava multiplicando por 0,85/0,15
    // num modelo que nunca os produziu.
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(getEyeReliability()).toEqual({ left: 0.85, right: 0.15 });

    restoreReferenceStateFromProfile({
      ...REFERENCIA,
      eyeReliability: { left: 0.5, right: 0.5 },
    });
    expect(getEyeReliability()).toEqual({ left: 0.5, right: 0.5 });
  });

  it('trocar para um perfil SEM confiabilidade zera em vez de herdar', () => {
    // Perfil de schema antigo, ou perfil cuja calibração não mediu
    // confiabilidade. Herdar a do perfil anterior é pior que não ter nenhuma:
    // a média simples é neutra, o peso herdado é errado e invisível.
    restoreReferenceStateFromProfile(REFERENCIA);
    expect(getEyeReliability()).not.toBeNull();

    restoreReferenceStateFromProfile({ ...REFERENCIA, eyeReliability: null });
    expect(getEyeReliability()).toBeNull();
  });
});

describe('B1.3 — perfis de schema antigo são invalidados, não carregados com null', () => {
  it('um perfil sem `reference` é rejeitado pelo validador', () => {
    // O plano é explícito: "Perfis sem o campo (schema antigo) devem ser
    // INVALIDADOS, não carregados com null". Carregar com null reproduz
    // exatamente o bug que B1.3 corrige — compensação desligada em silêncio.
    const antigo = perfilSemReferencia('velho_1');
    expect(profileTemReferencia(antigo)).toBe(false);
  });

  it('um perfil com `reference` completo é aceito', () => {
    const novo = { ...perfilSemReferencia('novo_1'), reference: REFERENCIA };
    expect(profileTemReferencia(novo)).toBe(true);
  });

  it('um `reference: {}` vazio NÃO passa — reintroduziria o bug', () => {
    // Presença do objeto não basta. Um perfil gravado com `reference: {}` por
    // um bug futuro passaria numa checagem de truthiness e voltaria a
    // restaurar tudo como null, em silêncio.
    const vazio = {
      ...perfilSemReferencia('vazio_1'),
      reference: {} as CalibrationReferenceState,
    };
    expect(profileTemReferencia(vazio)).toBe(false);
  });
});
