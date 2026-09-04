import { describe, it, expect, afterEach } from 'vitest';
import {
  currentCalibrationGeometry,
  setSessionGeometry,
  DEFAULT_SCREEN_DIAGONAL_IN,
  DEFAULT_VIEWING_DISTANCE_CM,
} from './calibration';
import { compensarPredicao } from './poseCompensation';

// -----------------------------------------------------------------------------
// A geometria física da sessão precisa chegar ao CAMINHO QUENTE.
//
// ── O defeito ───────────────────────────────────────────────────────────────
//
// A geometria configurada chegava só em `startCalibrationMode`, como `const`
// local. Ela posicionava a grade de alvos e morria ali. Todo o resto do módulo
// chamava `currentCalibrationGeometry()` sem overrides e recebia 23,6"/60 cm —
// inclusive `screenDistancePx()` e `screenPxPerCm()`, que rodam em TODO
// `mapGaze` porque `geometricPoseCompensation` é `true` por default.
//
// O relatório gravava uma diagonal e o pipeline usava outra.
//
// ── Por que isto não é um detalhe ───────────────────────────────────────────
//
// A leitura tentadora é: "o usuário-alvo não mexe a cabeça, então a
// compensação de pose quase não atua". Isso confunde duas coisas diferentes.
//
// "Cabeça parada" é premissa no sentido de que não se pode CONTAR com
// movimento voluntário como entrada — não no sentido de que a pose fica
// constante. Ao longo de uma sessão a postura cede, a cadeira é reajustada, o
// pescoço cansa. Em ELA a fraqueza cervical é característica: a deriva é MAIS
// provável nessa população, não menos.
//
// E o baseline do repositório mede exatamente isso: `pose-drift-5deg` é a PIOR
// das seis trajetórias — 97,0 px de erro médio contra 53,2 px da segunda
// colocada. Deriva de pose é a maior fonte de erro do pipeline, e a
// compensação que existe para corrigi-la rodava com a densidade errada.
// -----------------------------------------------------------------------------

afterEach(() => setSessionGeometry(null));

describe('a geometria da sessão alcança `currentCalibrationGeometry`', () => {
  it('sem sessão informada, valem os defaults', () => {
    expect(currentCalibrationGeometry().screenDiagonalIn).toBe(DEFAULT_SCREEN_DIAGONAL_IN);
    expect(currentCalibrationGeometry().viewingDistanceCm).toBe(DEFAULT_VIEWING_DISTANCE_CM);
  });

  it('informada, ela vence os defaults', () => {
    setSessionGeometry({ screenDiagonalIn: 27, viewingDistanceCm: 75 });
    expect(currentCalibrationGeometry().screenDiagonalIn).toBe(27);
    expect(currentCalibrationGeometry().viewingDistanceCm).toBe(75);
  });

  it('um override explícito vence a sessão', () => {
    // A precedência importa: o posicionamento da grade passa a geometria
    // explicitamente, e ela não pode ser sobrescrita pela da sessão.
    setSessionGeometry({ screenDiagonalIn: 27 });
    expect(currentCalibrationGeometry({ screenDiagonalIn: 32 }).screenDiagonalIn).toBe(32);
  });

  it('informar só um campo não zera o outro', () => {
    setSessionGeometry({ screenDiagonalIn: 27 });
    const g = currentCalibrationGeometry();
    expect(g.screenDiagonalIn).toBe(27);
    expect(g.viewingDistanceCm).toBe(DEFAULT_VIEWING_DISTANCE_CM);
  });

  it('`null` volta aos defaults', () => {
    setSessionGeometry({ screenDiagonalIn: 27 });
    setSessionGeometry(null);
    expect(currentCalibrationGeometry().screenDiagonalIn).toBe(DEFAULT_SCREEN_DIAGONAL_IN);
  });

  it('a largura/altura em px continuam vindo da janela, não da sessão', () => {
    // Diagonal e distância são físicas (o cuidador informa); a resolução é
    // observável. Misturar as duas origens deixaria o app usar um viewport que
    // não é o dele.
    setSessionGeometry({ screenDiagonalIn: 27 });
    const g = currentCalibrationGeometry();
    expect(g.screenWidthPx).toBeGreaterThan(0);
    expect(g.screenHeightPx).toBeGreaterThan(0);
  });
});

describe('o erro que a correção elimina, medido', () => {
  /** `screenDistancePx` reproduzido a partir da geometria — a mesma conta. */
  const distPx = (polegadas: number, cm: number, w: number, h: number) =>
    cm * (Math.hypot(w, h) / (polegadas * 2.54));

  it('numa tela de 27" a compensação era super-aplicada em ~14%', () => {
    const W = 1920, H = 1080;
    const certo = distPx(27, 60, W, H);
    const errado = distPx(DEFAULT_SCREEN_DIAGONAL_IN, 60, W, H);
    expect(errado / certo).toBeCloseTo(27 / DEFAULT_SCREEN_DIAGONAL_IN, 6);
    expect(errado / certo).toBeGreaterThan(1.14);
  });

  it('com a cabeça PARADA o erro é exatamente zero — e é só isso que a premissa garante', () => {
    // Este teste existe para delimitar o argumento, não para apoiá-lo. Sim, a
    // 0° de desvio a diagonal não muda nada. O que ele NÃO autoriza é concluir
    // que a diagonal é irrelevante: a pose de uma sessão real não fica em 0°.
    const W = 1920, H = 1080;
    const ref = { yaw: 0, pitch: 0, roll: 0 };
    const a = compensarPredicao(0.5, 0.5, ref, ref, distPx(27, 60, W, H), W, H);
    const b = compensarPredicao(0.5, 0.5, ref, ref, distPx(23.6, 60, W, H), W, H);
    expect(Math.abs(a.x - b.x) * W).toBeCloseTo(0, 9);
  });

  it('a partir de ~2° de desvio o erro já é da ordem do jitter que o projeto combate', () => {
    // Medido: 1° → 4,8 px · 2° → 9,7 px · 5° → 24,3 px · 10° → 49,0 px.
    //
    // Para comparar: o erro médio do baseline em fixação estática é 50,4 px.
    // Uma deriva de 10° sozinha somava um erro do tamanho do erro TOTAL do
    // pipeline — vindo de um número de configuração que ninguém tinha
    // conectado.
    const W = 1920, H = 1080;
    const ref = { yaw: 0, pitch: 0, roll: 0 };
    const erroEm = (grausDeDesvio: number) => {
      const atual = { yaw: (grausDeDesvio * Math.PI) / 180, pitch: 0, roll: 0 };
      const certo = compensarPredicao(0.5, 0.5, atual, ref, distPx(27, 60, W, H), W, H);
      const errado = compensarPredicao(0.5, 0.5, atual, ref, distPx(23.6, 60, W, H), W, H);
      return Math.abs(certo.x - errado.x) * W;
    };

    expect(erroEm(2)).toBeGreaterThan(5);
    expect(erroEm(5)).toBeGreaterThan(20);
    expect(erroEm(10)).toBeGreaterThan(45);

    // E cresce de forma monótona com o desvio — se não crescesse, a
    // explicação (o fator de escala erra proporcionalmente ao deslocamento)
    // estaria errada.
    expect(erroEm(5)).toBeGreaterThan(erroEm(2));
    expect(erroEm(10)).toBeGreaterThan(erroEm(5));
  });
});
