import { describe, it, expect, beforeEach } from 'vitest';
import {
  setConsent,
  getClinicalData,
  logCalibrationAccuracy,
  definirPerfilAtivo,
  chaveDoPerfil,
  CHAVE_GLOBAL_LEGADA,
} from './clinicalLogger';

// -----------------------------------------------------------------------------
// O histórico de acurácia era GLOBAL. Num produto clínico, curva de dois
// pacientes misturada é pior que curva nenhuma: ela parece um acompanhamento e
// não é, e quem lê não tem como perceber.
//
// A migração leva o histórico existente para o perfil ativo, MARCADO como
// herdado. A atribuição pode estar errada — se houve mais de um paciente antes
// da separação, aquelas medições não são todas dele. A tela marca; não corrige.
//
// A chave global NÃO é apagada: se a atribuição estiver errada, o dado original
// ainda existe para ser reatribuído à mão.
// -----------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  definirPerfilAtivo(null);
  setConsent(true);
});

describe('separação por perfil', () => {
  it('grava sob a chave do perfil ativo', () => {
    definirPerfilAtivo('p1');
    logCalibrationAccuracy(2.4);

    expect(localStorage.getItem(chaveDoPerfil('p1'))).toContain('2.4');
  });

  it('o histórico de um perfil não aparece no outro', () => {
    definirPerfilAtivo('p1');
    logCalibrationAccuracy(2.4);

    definirPerfilAtivo('p2');
    expect(getClinicalData().calibrations).toHaveLength(0);
  });

  it('voltar ao perfil devolve o histórico dele', () => {
    definirPerfilAtivo('p1');
    logCalibrationAccuracy(2.4);
    definirPerfilAtivo('p2');
    logCalibrationAccuracy(3.1);

    definirPerfilAtivo('p1');
    const c = getClinicalData().calibrations;
    expect(c).toHaveLength(1);
    expect(c[0].errorDeg).toBe(2.4);
  });
});

describe('a migração do histórico global', () => {
  const semearGlobal = () =>
    localStorage.setItem(
      CHAVE_GLOBAL_LEGADA,
      JSON.stringify({
        sentences: [],
        calibrations: [
          { id: 'a', errorDeg: 3.2, timestamp: '2026-09-01T10:00:00.000Z' },
          { id: 'b', errorDeg: 2.8, timestamp: '2026-09-02T10:00:00.000Z' },
        ],
      })
    );

  it('o histórico antigo aparece no perfil ativo', () => {
    semearGlobal();
    definirPerfilAtivo('p1');

    expect(getClinicalData().calibrations).toHaveLength(2);
  });

  it('vem MARCADO como herdado', () => {
    // A marca é o que permite a tela dizer "pode incluir medições de outro
    // paciente" em vez de apresentar tudo como sendo dele.
    semearGlobal();
    definirPerfilAtivo('p1');

    expect(getClinicalData().calibrations.every((c) => c.herdado === true)).toBe(true);
  });

  it('a chave global NÃO é apagada', () => {
    // Se a atribuição estiver errada, o dado original precisa existir para ser
    // reatribuído à mão.
    semearGlobal();
    definirPerfilAtivo('p1');
    getClinicalData();

    expect(localStorage.getItem(CHAVE_GLOBAL_LEGADA)).not.toBeNull();
  });

  it('migra uma vez só — o que vier depois não é herdado', () => {
    semearGlobal();
    definirPerfilAtivo('p1');
    getClinicalData();

    logCalibrationAccuracy(1.9);

    const c = getClinicalData().calibrations;
    expect(c).toHaveLength(3);
    expect(c.filter((x) => x.herdado === true)).toHaveLength(2);
  });

  it('não migra o mesmo global para um SEGUNDO perfil', () => {
    // Duplicaria as medições e inflaria as duas curvas.
    semearGlobal();
    definirPerfilAtivo('p1');
    getClinicalData();

    definirPerfilAtivo('p2');
    expect(getClinicalData().calibrations).toHaveLength(0);
  });
});

describe('sem perfil ativo', () => {
  it('não grava — não há a quem atribuir', () => {
    definirPerfilAtivo(null);
    logCalibrationAccuracy(2.4);

    expect(getClinicalData().calibrations).toHaveLength(0);
  });
});

describe('o consentimento continua valendo', () => {
  it('sem consentimento não grava, mesmo com perfil', () => {
    setConsent(false);
    definirPerfilAtivo('p1');
    logCalibrationAccuracy(2.4);

    expect(getClinicalData().calibrations).toHaveLength(0);
  });
});
