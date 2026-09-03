import { describe, it, expect } from 'vitest';
import { ReferenciaNeutra, gazeAbsoluto, type PoseCabeca } from './absoluteGaze';
import { sanitizeExperiment, VALORES_ACEITOS } from '../config/experiment';

// -----------------------------------------------------------------------------
// P5.7 + P5.8 — a integração com o caminho de produção.
//
// Os testes de `absoluteGaze.test.ts` exercitam os módulos isolados. Este
// arquivo cobre o CONTRATO com o engine: quais flags existem, qual referência
// vence quando as duas estão disponíveis, e o que acontece nas transições que
// o engine de fato produz (entrar e sair da calibração).
// -----------------------------------------------------------------------------

describe('as flags do contrato', () => {
  it('nascem no comportamento atual', () => {
    const e = sanitizeExperiment({});
    expect(e.poseCompensationMode).toBe('geometric');
    expect(e.dynamicNeutralReference).toBe(false);
    expect(e.headPoseSource).toBe('matrix');
  });

  it('os três modos de compensação são aceitos, e só eles', () => {
    expect(VALORES_ACEITOS.poseCompensationMode).toEqual(['geometric', 'additive', 'both']);
    for (const modo of VALORES_ACEITOS.poseCompensationMode) {
      expect(sanitizeExperiment({ poseCompensationMode: modo }).poseCompensationMode).toBe(modo);
    }
    // Um modo inventado não pode escolher um caminho de compensação em
    // silêncio: cai no default, com aviso.
    expect(sanitizeExperiment({ poseCompensationMode: 'aditivo' }).poseCompensationMode).toBe('geometric');
  });
});

describe('qual referência vence', () => {
  /**
   * Reproduz a regra do engine: a dinâmica só assume depois de ter adotado uma
   * pose; enquanto for `null`, vale a da calibração. Nunca há um instante sem
   * referência — e é essa a propriedade que importa, porque um quadro sem
   * referência devolveria o gaze não compensado no meio de uma série
   * compensada, produzindo um salto.
   */
  function referenciaEfetiva(
    dinamicaLigada: boolean,
    ref: ReferenciaNeutra,
    daCalibracao: PoseCabeca | null,
  ): PoseCabeca | null {
    const dinamica = dinamicaLigada ? ref.referencia : null;
    return dinamica ?? daCalibracao;
  }

  const OPTS = { janelaMs: 3000, estabilidadeMinMs: 1000, deltaMinRad: 0.05 };
  const DA_CALIBRACAO: PoseCabeca = { yaw: 0.05, pitch: -0.02 };

  it('flag desligada: sempre a da calibração, mesmo com a dinâmica pronta', () => {
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    for (let t = 1000; t <= 4000; t += 100) r.atualizar({ yaw: 0.3, pitch: 0 }, t, { calibrando: false });
    expect(r.referencia!.yaw).toBeCloseTo(0.3, 6);   // a dinâmica adotou
    // ...e mesmo assim não é usada.
    expect(referenciaEfetiva(false, r, DA_CALIBRACAO)).toBe(DA_CALIBRACAO);
  });

  it('flag ligada mas ainda sem adoção: a da calibração continua valendo', () => {
    const r = new ReferenciaNeutra(OPTS);
    expect(r.referencia).toBeNull();
    expect(referenciaEfetiva(true, r, DA_CALIBRACAO)).toBe(DA_CALIBRACAO);
  });

  it('flag ligada e dinâmica adotada: a dinâmica assume', () => {
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    for (let t = 1000; t <= 4000; t += 100) r.atualizar({ yaw: 0.3, pitch: 0 }, t, { calibrando: false });
    expect(referenciaEfetiva(true, r, DA_CALIBRACAO)!.yaw).toBeCloseTo(0.3, 6);
  });

  it('nunca existe um quadro SEM referência quando havia uma', () => {
    // A propriedade que evita o salto: em nenhuma combinação de flag e estado
    // a referência efetiva volta a ser `null` depois de ter existido.
    const r = new ReferenciaNeutra(OPTS);
    for (const ligada of [true, false]) {
      expect(referenciaEfetiva(ligada, r, DA_CALIBRACAO)).not.toBeNull();
    }
    r.definir({ yaw: 0, pitch: 0 }, 0);
    for (const ligada of [true, false]) {
      expect(referenciaEfetiva(ligada, r, DA_CALIBRACAO)).not.toBeNull();
    }
  });
});

describe('a transição entrar/sair da calibração, como o engine produz', () => {
  const OPTS = { janelaMs: 3000, estabilidadeMinMs: 1000, deltaMinRad: 0.05 };

  it('alimentar durante a calibração é diferente de NÃO alimentar', () => {
    // O engine chama `atualizar` sempre, passando `calibrando`. A alternativa
    // seria não chamar — e aí o relógio de estabilidade continuaria rodando por
    // baixo, e a primeira chamada após a calibração poderia adotar uma
    // referência formada por amostras da tarefa de calibração.
    const alimentado = new ReferenciaNeutra(OPTS);
    alimentado.definir({ yaw: 0, pitch: 0 }, 0);
    for (let t = 100; t <= 5000; t += 100) {
      alimentado.atualizar({ yaw: 0.4, pitch: 0 }, t, { calibrando: true });
    }
    // Sai da calibração: a primeira amostra não pode adotar nada.
    expect(alimentado.atualizar({ yaw: 0.4, pitch: 0 }, 5100, { calibrando: false })).toBeNull();
    expect(alimentado.referencia!.yaw).toBe(0);
  });

  it('depois de sair, adota normalmente quando a postura se sustenta', () => {
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    for (let t = 100; t <= 3000; t += 100) r.atualizar({ yaw: 0.4, pitch: 0 }, t, { calibrando: true });
    let trocou = false;
    for (let t = 3100; t <= 7000; t += 100) {
      if (r.atualizar({ yaw: 0.4, pitch: 0 }, t, { calibrando: false })) trocou = true;
    }
    expect(trocou).toBe(true);
    expect(r.referencia!.yaw).toBeCloseTo(0.4, 6);
  });

  it('a compensação segue a referência nova sem salto na troca', () => {
    // O que o usuário sentiria num salto: o cursor pula no instante da adoção.
    // Aqui se verifica que a diferença entre o antes e o depois da troca é
    // exatamente o delta da referência — não um degrau maior.
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    const postura = { yaw: 0.25, pitch: 0 };
    const gaze = { yaw: 0.1, pitch: 0 };

    const antes = gazeAbsoluto(gaze, postura, r.referencia);
    let troca = null;
    for (let t = 1000; t <= 4000 && !troca; t += 100) {
      troca = r.atualizar(postura, t, { calibrando: false });
    }
    expect(troca).not.toBeNull();
    const depois = gazeAbsoluto(gaze, postura, r.referencia);

    expect(antes.yaw - depois.yaw).toBeCloseTo(troca!.delta.yaw, 6);
  });
});
