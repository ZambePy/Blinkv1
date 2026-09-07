import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as calib from './calibration';
import { profileRegistry, type StoredCalibrationProfile } from './calibrationProfiles';

// `getCalibrationTimestampMs()` é a fonte de `protocolo.minutosDesdeCalibracao`
// no relatório de precisão — o número que a documentação promete ser MEDIDO, e
// que decide de quanto em quanto tempo é preciso recalibrar (docs/MEDICOES.md
// §3). Ele descreve o MODELO EM USO: se o modelo é descartado ou trocado, o
// instante do treino tem de acompanhar, senão o relatório afirma uma idade que
// não é a do modelo que produziu os números.

/** Perfil mínimo carregável (schema v2, com estado de referência). Sem
 *  `contextKey` de propósito: a checagem de contexto é outro assunto. */
function perfil(id: string, createdAt: string): StoredCalibrationProfile {
  const modelo = {
    betaX: [0, 1], betaY: [0, 1], numFeatures: 1,
    lambda: 1, lambdaX: 1, lambdaY: 1,
    nearSingularCols: [] as number[], penalty: 'isotropic' as const,
  };
  return {
    meta: { id, label: id, createdAt, opticalCondition: 'sem_oculos' },
    modelLeft: modelo,
    modelRight: { ...modelo },
    scalerParamsLeft: { means: [0], stds: [1] },
    scalerParamsRight: { means: [0], stds: [1] },
    reference: {
      pose: null, center: null,
      cameraDistanceCm: null, screenDistanceCm: null,
      refDistance: null, eyeReliability: null,
    },
  };
}

/** Ativa um perfil com a data pedida — a única forma de instalar um modelo com
 *  instante de treino conhecido sem rodar uma calibração inteira. */
function ativarPerfilDe(id: string, createdAt: string) {
  profileRegistry.save(perfil(id, createdAt));
  return calib.switchActiveProfile(id);
}

describe('o instante do treino descreve o modelo em uso', () => {
  beforeEach(() => {
    profileRegistry.clear();
    calib.clearCalibration();
  });
  afterEach(() => {
    profileRegistry.clear();
    calib.clearCalibration();
  });

  it('sem nenhuma calibração, é null — não 0 nem "agora"', () => {
    expect(calib.getCalibrationTimestampMs()).toBeNull();
  });

  it('ativar um perfil instala o instante DAQUELE perfil', () => {
    // O modo de falha: calibrar "sem óculos" agora e trocar para o perfil "com
    // óculos" treinado 3 h antes. Com o instante preso na última calibração
    // desta sessão, o relatório da rodada seguinte diria "0 min desde a
    // calibração" sobre um modelo de 3 h — e a deriva medida entre blocos
    // (docs/MEDICOES.md §3) vira ficção.
    const tresHorasAtras = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const meta = ativarPerfilDe('antigo', tresHorasAtras);

    expect(meta?.id).toBe('antigo');
    expect(calib.isCalibrated()).toBe(true);
    expect(calib.getCalibrationTimestampMs()).toBe(Date.parse(tresHorasAtras));
  });

  it('clearCalibration apaga o instante junto com o modelo', () => {
    // Sem isto, `checarMudancaDeViewport` e a invalidação por dimensão
    // (as duas chamam `clearCalibration`) deixavam o relatório dizendo
    // "há 4 min" sobre uma calibração que já não existe.
    ativarPerfilDe('atual', new Date(Date.now() - 4 * 60_000).toISOString());
    expect(calib.getCalibrationTimestampMs()).not.toBeNull();

    calib.clearCalibration();

    expect(calib.isCalibrated()).toBe(false);
    expect(calib.getCalibrationTimestampMs()).toBeNull();
  });

  it('startCalibrationMode apaga o instante — os regressores acabaram de cair', () => {
    ativarPerfilDe('atual', new Date(Date.now() - 60_000).toISOString());

    calib.startCalibrationMode({ quick: true });

    expect(calib.isCalibrated()).toBe(false);
    expect(calib.getCalibrationTimestampMs()).toBeNull();
    calib.abortCalibration();
  });

  it('apagar o perfil ativo apaga o instante', () => {
    ativarPerfilDe('ativo', new Date().toISOString());
    expect(calib.getCalibrationTimestampMs()).not.toBeNull();

    calib.deleteCalibrationProfile('ativo');

    expect(calib.getCalibrationTimestampMs()).toBeNull();
  });

  it('uma data ilegível no perfil vira null, não NaN', () => {
    // `NaN` viajaria até `Math.round((Date.now() - t) / 60_000)` e sairia no
    // JSON como `null` de qualquer forma — mas por acidente, depois de o código
    // ter tratado NaN como "há um instante conhecido".
    ativarPerfilDe('quebrado', 'não é uma data');
    expect(calib.getCalibrationTimestampMs()).toBeNull();
  });
});

/**
 * O instante do treino tem de ser o MESMO número nos dois caminhos: recém
 * treinado em memória, e restaurado do perfil salvo depois de fechar o app.
 *
 * Não é preciosismo. `blocoDeMedicao` é derivado desse instante: a contagem de
 * rodadas é indexada por ele. Se treinar grava `Date.now()` e restaurar grava
 * `Date.parse(createdAt)`, os dois diferem pelos milissegundos que passaram
 * entre uma linha e outra — e o bloco 2 medido depois de reabrir o app volta a
 * se apresentar como bloco 1, contra o mesmo modelo.
 */
describe('coerência do instante entre treinar e restaurar', () => {
  beforeEach(() => {
    profileRegistry.clear();
    calib.clearCalibration();
  });
  afterEach(() => {
    profileRegistry.clear();
    calib.clearCalibration();
  });

  it('o instante vem do createdAt do perfil, com precisão de milissegundo', () => {
    ativarPerfilDe('p1', '2026-09-06T23:21:06.707Z');
    expect(calib.getCalibrationTimestampMs()).toBe(Date.parse('2026-09-06T23:21:06.707Z'));
  });

  /**
   * A restauração ao reabrir o app é filtrada por `contextKey`, e o viewport
   * faz parte da chave. Reabrir com a janela de outro tamanho descarta o
   * perfil em silêncio — `loadProfile()` devolve `false` e o instante do
   * treino some junto, levando o número do bloco com ele.
   */
  it('perfil de outro viewport NÃO é restaurado, e o instante não sobrevive', () => {
    const outroContexto = calib.buildContextKeyFrom({
      viewportW: 800, viewportH: 600,
      featureVectorId: 'irisCore+l2cs', formatVersion: 2,
      polynomialFeatures: true, geometricPoseCompensation: true,
      expandFactor: 1.4, l2csInputSize: 448,
    });
    const p = perfil('p1', '2026-09-06T23:21:06.707Z');
    profileRegistry.save({ ...p, contextKey: outroContexto });

    expect(calib.loadProfile()).toBe(false);
    expect(calib.getCalibrationTimestampMs()).toBeNull();
  });
});
