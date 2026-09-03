import { describe, it, expect } from 'vitest';
import {
  gazeAbsoluto,
  ReferenciaNeutra,
  CLAMP_POSE_RAD,
  type PoseCabeca,
} from './absoluteGaze';

const GRAUS = Math.PI / 180;

// -----------------------------------------------------------------------------
// P5.7 — compensação aditiva em ângulo.
//
// Aceite: cabeça girando 15° com olhar fixo → gaze absoluto constante.
// -----------------------------------------------------------------------------

describe('P5.7 — gazeAbsoluto', () => {
  it('cabeça gira 15°, olhar fixo no mundo: o gaze absoluto não muda', () => {
    // O cenário físico: o usuário olha para o MESMO ponto da tela enquanto gira
    // a cabeça 15° para a direita. O L2CS mede o olhar RELATIVO à cabeça, então
    // ele vê o olho girar 15° para a ESQUERDA (compensando). Somar a rotação da
    // cabeça tem que devolver o mesmo ângulo absoluto.
    const ref: PoseCabeca = { yaw: 0, pitch: 0 };
    const olharAbsolutoVerdadeiro = 5 * GRAUS;

    for (const cabecaDeg of [0, 5, 10, 15]) {
      const cabeca = { yaw: cabecaDeg * GRAUS, pitch: 0 };
      // O que o L2CS mediria: absoluto menos a rotação da cabeça.
      const gazeRelativo = { yaw: olharAbsolutoVerdadeiro - cabeca.yaw, pitch: 0 };
      const abs = gazeAbsoluto(gazeRelativo, cabeca, ref);
      expect(abs.yaw).toBeCloseTo(olharAbsolutoVerdadeiro, 9);
      expect(abs.clamped).toBe(false);
    }
  });

  it('vale para pitch também', () => {
    const ref: PoseCabeca = { yaw: 0, pitch: 0 };
    const absVerdadeiro = -8 * GRAUS;
    for (const cabecaDeg of [0, -6, -12]) {
      const cabeca = { yaw: 0, pitch: cabecaDeg * GRAUS };
      const rel = { yaw: 0, pitch: absVerdadeiro - cabeca.pitch };
      expect(gazeAbsoluto(rel, cabeca, ref).pitch).toBeCloseTo(absVerdadeiro, 9);
    }
  });

  it('sem referência, devolve o gaze intacto', () => {
    // Inventar uma referência (a pose do primeiro quadro, por exemplo) faria a
    // sessão inteira herdar a postura de um instante arbitrário.
    const g = { yaw: 0.1, pitch: -0.05 };
    expect(gazeAbsoluto(g, { yaw: 0.3, pitch: 0.2 }, null)).toEqual({ ...g, clamped: false });
    expect(gazeAbsoluto(g, null, { yaw: 0.3, pitch: 0.2 })).toEqual({ ...g, clamped: false });
  });

  it('a variação de pose é clampada em ±30° (B3.12)', () => {
    const abs = gazeAbsoluto(
      { yaw: 0, pitch: 0 },
      { yaw: 80 * GRAUS, pitch: 0 },
      { yaw: 0, pitch: 0 },
    );
    expect(abs.yaw).toBeCloseTo(CLAMP_POSE_RAD, 9);
    expect(abs.clamped).toBe(true);
  });

  it('o clamp vale nos dois sentidos', () => {
    const abs = gazeAbsoluto({ yaw: 0, pitch: 0 }, { yaw: -80 * GRAUS, pitch: 0 }, { yaw: 0, pitch: 0 });
    expect(abs.yaw).toBeCloseTo(-CLAMP_POSE_RAD, 9);
    expect(abs.clamped).toBe(true);
  });

  it('pose não-finita devolve o gaze intacto em vez de NaN', () => {
    const g = { yaw: 0.1, pitch: -0.05 };
    expect(gazeAbsoluto(g, { yaw: NaN, pitch: 0 }, { yaw: 0, pitch: 0 })).toEqual({ ...g, clamped: false });
  });

  it('NÃO aplica a correção duas vezes', () => {
    // O modo `both` existe para MEDIR os dois métodos em paralelo, não para
    // somar os efeitos: eles descrevem o mesmo fenômeno em espaços diferentes,
    // e somar compensaria a rotação duas vezes — o cursor passaria do alvo em
    // vez de ficar aquém. Aqui se trava a propriedade da função pura: aplicar
    // duas vezes NÃO é o mesmo que aplicar uma.
    const ref = { yaw: 0, pitch: 0 };
    const cabeca = { yaw: 10 * GRAUS, pitch: 0 };
    const uma = gazeAbsoluto({ yaw: 0, pitch: 0 }, cabeca, ref);
    const duas = gazeAbsoluto(uma, cabeca, ref);
    expect(duas.yaw).toBeCloseTo(2 * uma.yaw, 9);
    expect(duas.yaw).not.toBeCloseTo(uma.yaw, 6);
  });
});

// -----------------------------------------------------------------------------
// P5.8 — referência neutra dinâmica.
//
// Aceite: pose em degrau que permanece → atualiza após a janela; pose que
// oscila → não atualiza; durante `isCalibrating` → nunca atualiza.
// -----------------------------------------------------------------------------

describe('P5.8 — ReferenciaNeutra', () => {
  /** Opções apertadas para o teste rodar sem simular 60 s reais. */
  const OPTS = { janelaMs: 3000, estabilidadeMinMs: 1000, velocidadeMaxRadPorS: 0.1, deltaMinRad: 0.05 };

  function alimentar(
    r: ReferenciaNeutra, pose: PoseCabeca, deMs: number, ateMs: number,
    calibrando = false, passo = 100,
  ) {
    const eventos = [];
    for (let t = deMs; t <= ateMs; t += passo) {
      const e = r.atualizar(pose, t, { calibrando });
      if (e) eventos.push(e);
    }
    return eventos;
  }

  it('degrau que PERMANECE atualiza a referência depois da janela', () => {
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    const eventos = alimentar(r, { yaw: 0.2, pitch: 0.1 }, 1000, 4000);
    expect(eventos.length).toBeGreaterThan(0);
    expect(r.referencia!.yaw).toBeCloseTo(0.2, 6);
    expect(r.referencia!.pitch).toBeCloseTo(0.1, 6);
    expect(eventos[0].de).toEqual({ yaw: 0, pitch: 0, roll: undefined });
    expect(eventos[0].delta.yaw).toBeCloseTo(0.2, 6);
  });

  it('pose que OSCILA nunca atualiza — o relógio de estabilidade zera', () => {
    // Uma virada de cabeça de ida e volta não é mudança de postura. A guarda
    // existe para isso: sem ela, olhar para o cuidador e voltar redefiniria o
    // "neutro" para o meio do caminho.
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    const eventos = [];
    for (let t = 1000; t <= 20000; t += 100) {
      // Oscilação de ±0,3 rad a cada 200 ms: velocidade de ~3 rad/s, muito
      // acima do limite de 0,1.
      const yaw = (Math.floor(t / 200) % 2 === 0) ? 0.3 : -0.3;
      const e = r.atualizar({ yaw, pitch: 0 }, t, { calibrando: false });
      if (e) eventos.push(e);
    }
    expect(eventos).toHaveLength(0);
    expect(r.referencia!.yaw).toBe(0);
  });

  it('durante a calibração NUNCA atualiza, nem acumula', () => {
    // A referência da calibração é o ponto contra o qual o Ridge minimizou o
    // erro (B1.3). Trocá-la no meio invalida o modelo sendo treinado.
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    const eventos = alimentar(r, { yaw: 0.5, pitch: 0.3 }, 1000, 30000, true);
    expect(eventos).toHaveLength(0);
    expect(r.referencia!.yaw).toBe(0);
  });

  it('sair da calibração não herda as amostras colhidas durante ela', () => {
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    alimentar(r, { yaw: 0.9, pitch: 0 }, 1000, 5000, true);   // calibrando
    // Logo após sair, ainda não pode haver atualização: a janela recomeça.
    const e = r.atualizar({ yaw: 0.2, pitch: 0 }, 5100, { calibrando: false });
    expect(e).toBeNull();
  });

  it('mudança pequena demais não vale a troca', () => {
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    // 0,02 rad ≈ 1,1°, abaixo do `deltaMinRad` de 0,05.
    const eventos = alimentar(r, { yaw: 0.02, pitch: 0 }, 1000, 10000);
    expect(eventos).toHaveLength(0);
  });

  it('cada atualização exige uma nova janela de estabilidade', () => {
    // Sem isso, depois da primeira troca a referência ficaria perseguindo a
    // média a cada quadro.
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    const eventos = alimentar(r, { yaw: 0.2, pitch: 0 }, 1000, 3000);
    expect(eventos).toHaveLength(1);
  });

  it('registra TODA atualização, com timestamp e delta', () => {
    // Sem o registro fica impossível explicar, no Dia 7, por que o erro mudou
    // no meio da sessão. "Mudou e ninguém sabe por quê" é o pior resultado
    // possível de um dia de medição com paciente.
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 500);
    alimentar(r, { yaw: 0.2, pitch: 0.1 }, 1000, 4000);
    const h = r.atualizacoes;
    expect(h.length).toBeGreaterThanOrEqual(2);   // a definição + ao menos uma troca
    expect(h[0].timestampMs).toBe(500);
    expect(h[0].de).toBeNull();                    // a primeira é a definição
    const troca = h[1];
    expect(troca.timestampMs).toBeGreaterThan(1000);
    expect(troca.de).not.toBeNull();
    expect(troca.amostras).toBeGreaterThan(1);
    expect(Number.isFinite(troca.delta.yaw)).toBe(true);
  });

  it('pose não-finita é ignorada sem contaminar a média', () => {
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0, pitch: 0 }, 0);
    r.atualizar({ yaw: NaN, pitch: 0 }, 1000, { calibrando: false });
    alimentar(r, { yaw: 0.2, pitch: 0 }, 1100, 4000);
    expect(Number.isFinite(r.referencia!.yaw)).toBe(true);
    expect(r.referencia!.yaw).toBeCloseTo(0.2, 6);
  });

  it('reset apaga referência e histórico', () => {
    const r = new ReferenciaNeutra(OPTS);
    r.definir({ yaw: 0.1, pitch: 0 }, 0);
    r.reset();
    expect(r.referencia).toBeNull();
    expect(r.atualizacoes).toHaveLength(0);
  });

  it('a janela default é de 60 s, como a especificação pede', () => {
    const r = new ReferenciaNeutra();
    r.definir({ yaw: 0, pitch: 0 }, 0);
    // Com a janela default, 3 s de pose nova não bastam.
    const eventos = alimentar(r, { yaw: 0.2, pitch: 0 }, 1000, 4000);
    expect(eventos).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Integração das duas: a referência dinâmica alimentando a compensação.
// -----------------------------------------------------------------------------

describe('P5.7 + P5.8 juntos', () => {
  it('depois que a postura muda e a referência acompanha, a compensação zera', () => {
    const r = new ReferenciaNeutra({ janelaMs: 3000, estabilidadeMinMs: 1000, deltaMinRad: 0.05 });
    r.definir({ yaw: 0, pitch: 0 }, 0);

    const novaPostura = { yaw: 0.25, pitch: 0 };
    // Antes de a referência acompanhar, a compensação é grande.
    const antes = gazeAbsoluto({ yaw: 0, pitch: 0 }, novaPostura, r.referencia);
    expect(antes.yaw).toBeCloseTo(0.25, 6);

    for (let t = 1000; t <= 4000; t += 100) r.atualizar(novaPostura, t, { calibrando: false });

    // Depois, a mesma postura passa a ser o neutro e não há mais o que compensar.
    const depois = gazeAbsoluto({ yaw: 0, pitch: 0 }, novaPostura, r.referencia);
    expect(depois.yaw).toBeCloseTo(0, 6);
  });
});
