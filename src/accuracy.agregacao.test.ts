import { describe, it, expect } from 'vitest';
import {
  checkValidationOverlap,
  agregarErros,
  fracaoDaTelaParaPx,
  __testingPoints,
} from './accuracy';

// Agregação do relatório de acurácia: pontos sem amostra não entram em nenhuma
// métrica (nunca NaN nem 0 fabricado), cada métrica declara sua população
// (interior × borda), a guarda de sobreposição cobre todos os pontos de
// validação e alvo/ground-truth compartilham a mesma conversão fração→px.

const VW = 1920;
const VH = 1080;

describe('ponto sem amostra é marcado como não medido', () => {
  it('predX/predY ficam undefined, não iguais ao alvo', () => {
    // Inicializar predX/predY no próprio alvo faria o ponto parecer um acerto
    // perfeito para o ajuste afim.
    const d = agregarErros([
      { groundX: 100, groundY: 100, predX: undefined, predY: undefined, error: undefined, errorX: undefined, errorY: undefined, jitterRMS: undefined, isEdge: false, name: 'sem-amostra', samplesError: [] },
      { groundX: 500, groundY: 500, predX: 510, predY: 495, error: 11.18, errorX: 10, errorY: 5, jitterRMS: 2, isEdge: false, name: 'ok', samplesError: [11.18] },
    ], VW, VH);

    expect(d.pontosNaoMedidos).toBe(1);
    expect(d.pontosMedidos).toBe(1);
  });

  it('o ponto não medido NÃO entra em nenhuma métrica', () => {
    const so_um_bom = agregarErros([
      { groundX: 500, groundY: 500, predX: 510, predY: 495, error: 11.18, errorX: 10, errorY: 5, jitterRMS: 2, isEdge: false, name: 'ok', samplesError: [11.18] },
    ], VW, VH);

    const com_um_vazio = agregarErros([
      { groundX: 500, groundY: 500, predX: 510, predY: 495, error: 11.18, errorX: 10, errorY: 5, jitterRMS: 2, isEdge: false, name: 'ok', samplesError: [11.18] },
      { groundX: 100, groundY: 100, predX: undefined, predY: undefined, error: undefined, errorX: undefined, errorY: undefined, jitterRMS: undefined, isEdge: false, name: 'vazio', samplesError: [] },
    ], VW, VH);

    // Acrescentar um ponto não medido não pode mover NENHUM número.
    expect(com_um_vazio.meanError).toBeCloseTo(so_um_bom.meanError, 9);
    expect(com_um_vazio.meanErrorX).toBeCloseTo(so_um_bom.meanErrorX, 9);
    expect(com_um_vazio.maxError).toBeCloseTo(so_um_bom.maxError, 9);
  });

  it('uma única política de ausência: nunca NaN, nunca 0 fabricado', () => {
    // Com zero pontos medidos, todas as métricas viram `null` — "não há o que
    // reportar" — em vez de `NaN` numa e `0` noutra.
    const d = agregarErros([
      { groundX: 100, groundY: 100, predX: undefined, predY: undefined, error: undefined, errorX: undefined, errorY: undefined, jitterRMS: undefined, isEdge: false, name: 'a', samplesError: [] },
    ], VW, VH);

    expect(d.meanError).toBeNull();
    expect(d.meanErrorX).toBeNull();
    expect(d.maxError).toBeNull();
    expect(d.p90Error).toBeNull();
    expect(d.medianError).toBeNull();
    expect(d.errorPct).toBeNull();
    expect(Number.isNaN(d.meanError as unknown as number)).toBe(false);
  });

  it('nenhuma métrica devolve NaN em nenhuma combinação', () => {
    const casos = [
      [],
      [{ groundX: 1, groundY: 1, predX: undefined, predY: undefined, error: undefined, errorX: undefined, errorY: undefined, jitterRMS: undefined, isEdge: false, name: 'x', samplesError: [] }],
      [{ groundX: 1, groundY: 1, predX: 2, predY: 2, error: 1.41, errorX: 1, errorY: 1, jitterRMS: 0, isEdge: true, name: 'y', samplesError: [1.41] }],
    ];
    for (const pontos of casos) {
      const d = agregarErros(pontos, VW, VH);
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === 'number') {
          expect(Number.isNaN(v), `${k} é NaN`).toBe(false);
        }
      }
    }
  });
});

describe('cada métrica declara sua população (interior × borda)', () => {
  const pontos = [
    { groundX: 480, groundY: 270, predX: 490, predY: 280, error: 14.1, errorX: 10, errorY: 10, jitterRMS: 3, isEdge: false, name: 'i1', samplesError: [14.1] },
    { groundX: 960, groundY: 540, predX: 965, predY: 545, error: 7.07, errorX: 5, errorY: 5, jitterRMS: 2, isEdge: false, name: 'i2', samplesError: [7.07] },
    { groundX: 96,  groundY: 54,  predX: 200, predY: 150, error: 141.9, errorX: 104, errorY: 96, jitterRMS: 9, isEdge: true,  name: 'e1', samplesError: [141.9] },
  ];

  it('meanErrorInner usa SÓ os pontos interiores', () => {
    const d = agregarErros(pontos, VW, VH);
    expect(d.meanErrorInner).toBeCloseTo((14.1 + 7.07) / 2, 3);
  });

  it('meanErrorEdge usa SÓ os pontos de borda', () => {
    const d = agregarErros(pontos, VW, VH);
    expect(d.meanErrorEdge).toBeCloseTo(141.9, 3);
  });

  it('meanError continua sendo o interior — comparabilidade histórica', () => {
    // `meanError` é a única métrica com série temporal; mudar sua população
    // tornaria todo relatório anterior incomparável.
    const d = agregarErros(pontos, VW, VH);
    expect(d.meanError).toBe(d.meanErrorInner);
    expect(d.meanError).not.toBeCloseTo((14.1 + 7.07 + 141.9) / 3, 3);
  });

  it('meanErrorX/Y usam a mesma população de meanError', () => {
    // `explainedFraction` compara X/Y com `meanError`; populações diferentes
    // produziriam um número sem significado.
    const d = agregarErros(pontos, VW, VH);
    expect(d.meanErrorX).toBeCloseTo((10 + 5) / 2, 3);   // só interiores
    expect(d.meanErrorY).toBeCloseTo((10 + 5) / 2, 3);
  });

  it('as contagens de população são explícitas no resultado', () => {
    // Quem lê o JSON precisa saber sobre quantos pontos cada número foi
    // calculado.
    const d = agregarErros(pontos, VW, VH);
    expect(d.nInterior).toBe(2);
    expect(d.nEdge).toBe(1);
    expect(d.pontosMedidos).toBe(3);
  });

  it('sem pontos de borda, meanErrorEdge é null e não zero', () => {
    const d = agregarErros(pontos.filter((p) => !p.isEdge), VW, VH);
    expect(d.meanErrorEdge).toBeNull();
    expect(d.nEdge).toBe(0);
  });
});

describe('a guarda de sobreposição cobre todos os pontos de validação', () => {
  it('o conjunto checado inclui os pontos de borda', () => {
    // Os `EDGE_POINTS` em 5%/95% precisam ser verificados: é em Y que a grade
    // de calibração cai justamente em 5%/95%.
    const todos = __testingPoints.ALL_VALIDATION_POINTS;
    expect(todos.length).toBeGreaterThan(__testingPoints.VALIDATION_POINTS.length);
    expect(todos.some((p) => p.isEdge)).toBe(true);
  });

  it('um alvo de calibração em cima de um ponto de borda é detectado', () => {
    const borda = __testingPoints.ALL_VALIDATION_POINTS.find((p) => p.isEdge)!;
    const overlap = checkValidationOverlap(
      [{ x: borda.screenX, y: borda.screenY }],
      __testingPoints.ALL_VALIDATION_POINTS,
    );
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('checar só os interiores não detecta a sobreposição de borda', () => {
    // Com o conjunto reduzido, o mesmo alvo passa limpo.
    const borda = __testingPoints.ALL_VALIDATION_POINTS.find((p) => p.isEdge)!;
    const overlap = checkValidationOverlap(
      [{ x: borda.screenX, y: borda.screenY }],
      __testingPoints.VALIDATION_POINTS,
    );
    expect(overlap.length).toBe(0);
  });

  it('grades disjuntas não acusam sobreposição', () => {
    const overlap = checkValidationOverlap(
      [{ x: 0.33, y: 0.33 }, { x: 0.67, y: 0.67 }],
      __testingPoints.ALL_VALIDATION_POINTS,
    );
    expect(overlap).toEqual([]);
  });
});

describe('alvos e ground-truth usam a mesma largura', () => {
  it('a conversão fração→px usa clientWidth, não vw', () => {
    // `vw` inclui a barra de rolagem e `clientWidth` não; com scrollbar de
    // 15 px, misturar os dois injeta até 15 px de erro sistemático. Esta função
    // é a fonte única usada pelos dois lados.
    expect(fracaoDaTelaParaPx(0.5, 1905)).toBeCloseTo(952.5, 6);
    expect(fracaoDaTelaParaPx(0.25, 1905)).toBeCloseTo(476.25, 6);
  });

  it('o mesmo par (fração, largura) sempre dá o mesmo px', () => {
    // Determinismo é o ponto: qualquer divergência entre as duas pontas
    // reintroduz o viés.
    for (const f of [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
      expect(fracaoDaTelaParaPx(f, 1905)).toBe(fracaoDaTelaParaPx(f, 1905));
    }
  });

  it('larguras diferentes produzem px diferentes', () => {
    // 1920 (vw, com scrollbar) contra 1905 (clientWidth): 15 px na borda.
    const comScrollbar = fracaoDaTelaParaPx(1.0, 1920);
    const semScrollbar = fracaoDaTelaParaPx(1.0, 1905);
    expect(Math.abs(comScrollbar - semScrollbar)).toBeCloseTo(15, 6);
  });
});
