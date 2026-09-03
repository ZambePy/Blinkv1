import { describe, it, expect } from 'vitest';
import { eyeRegionInCrop, computeSquareBBox, INPUT_SIZE } from './crop';

// P4.5 — "CLAHE apenas na região dos olhos, não no crop facial inteiro".
//
// Para isso é preciso saber ONDE ficam os olhos dentro do crop 448². O crop é
// construído a partir do bbox dos landmarks expandido por `EXPAND_FACTOR` e
// reescalado; a região ocular tem que atravessar a mesma transformação, senão o
// CLAHE equaliza pele e sobrancelha e deixa a íris de fora — o oposto do
// objetivo, e sem sintoma visível.
//
// A outra armadilha é o espelhamento: o crop faz o flip horizontal quando
// `isMirrored`, então a região tem que ser espelhada junto ou ela aponta para o
// lado errado do rosto.

/** Constrói um conjunto de landmarks com os quatro cantos oculares no lugar. */
function landmarksComOlhos(opts: {
  esquerdoExterno: [number, number];
  esquerdoInterno: [number, number];
  direitoInterno: [number, number];
  direitoExterno: [number, number];
  extra?: [number, number][];
}) {
  const pts = new Array(478).fill(null).map(() => ({ x: 0.5, y: 0.5 }));
  pts[33] = { x: opts.esquerdoExterno[0], y: opts.esquerdoExterno[1] };
  pts[133] = { x: opts.esquerdoInterno[0], y: opts.esquerdoInterno[1] };
  pts[362] = { x: opts.direitoInterno[0], y: opts.direitoInterno[1] };
  pts[263] = { x: opts.direitoExterno[0], y: opts.direitoExterno[1] };
  // Espalha alguns pontos para o bbox facial ficar maior que a região ocular.
  pts[10] = { x: 0.5, y: 0.2 };   // topo da testa
  pts[152] = { x: 0.5, y: 0.85 }; // queixo
  (opts.extra ?? []).forEach(([x, y], i) => { pts[200 + i] = { x, y }; });
  return pts;
}

const rostoTipico = landmarksComOlhos({
  esquerdoExterno: [0.40, 0.45],
  esquerdoInterno: [0.47, 0.45],
  direitoInterno: [0.53, 0.45],
  direitoExterno: [0.60, 0.45],
});

describe('eyeRegionInCrop', () => {
  it('devolve um retângulo dentro dos limites do crop', () => {
    const r = eyeRegionInCrop(rostoTipico, 1280, 720, 1.4, false)!;
    expect(r).not.toBeNull();
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(INPUT_SIZE);
    expect(r.y + r.height).toBeLessThanOrEqual(INPUT_SIZE);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it('a região é bem menor que o crop inteiro — é isso que a economiza', () => {
    const r = eyeRegionInCrop(rostoTipico, 1280, 720, 1.4, false)!;
    const fracao = (r.width * r.height) / (INPUT_SIZE * INPUT_SIZE);
    expect(fracao).toBeLessThan(0.35);
    // Mas não pode ser um filete: precisa conter a íris com folga vertical.
    expect(fracao).toBeGreaterThan(0.02);
  });

  it('cobre horizontalmente os dois cantos externos', () => {
    const bbox = computeSquareBBox(rostoTipico, 1280, 720, 1.4);
    const paraCrop = (xNorm: number) => ((xNorm * 1280) - bbox.x) / bbox.side * INPUT_SIZE;
    const r = eyeRegionInCrop(rostoTipico, 1280, 720, 1.4, false)!;
    expect(r.x).toBeLessThanOrEqual(paraCrop(0.40));
    expect(r.x + r.width).toBeGreaterThanOrEqual(paraCrop(0.60));
  });

  it('tem folga VERTICAL: os cantos são colineares, e a pálpebra não', () => {
    // Os quatro cantos deste rosto estão todos em y = 0,45. Uma região com
    // altura derivada só deles teria altura zero e o CLAHE não veria pálpebra,
    // esclera nem sombra — justamente o gradiente que interessa.
    const r = eyeRegionInCrop(rostoTipico, 1280, 720, 1.4, false)!;
    expect(r.height).toBeGreaterThan(10);
  });

  it('espelhado: a região reflete para o outro lado do crop', () => {
    // Rosto assimétrico, para que a reflexão seja detectável.
    const assimetrico = landmarksComOlhos({
      esquerdoExterno: [0.30, 0.45],
      esquerdoInterno: [0.38, 0.45],
      direitoInterno: [0.44, 0.45],
      direitoExterno: [0.50, 0.45],
    });
    const normal = eyeRegionInCrop(assimetrico, 1280, 720, 1.4, false)!;
    const espelhado = eyeRegionInCrop(assimetrico, 1280, 720, 1.4, true)!;
    expect(espelhado.width).toBe(normal.width);
    expect(espelhado.height).toBe(normal.height);
    // O centro reflete em torno do meio do crop.
    const centroNormal = normal.x + normal.width / 2;
    const centroEspelhado = espelhado.x + espelhado.width / 2;
    expect(centroNormal + centroEspelhado).toBeCloseTo(INPUT_SIZE, 0);
  });

  it('landmarks ausentes devolvem null em vez de um retângulo inventado', () => {
    expect(eyeRegionInCrop([], 1280, 720, 1.4, false)).toBeNull();
    const poucos = new Array(100).fill(null).map(() => ({ x: 0.5, y: 0.5 }));
    expect(eyeRegionInCrop(poucos, 1280, 720, 1.4, false)).toBeNull();
  });

  it('dimensões de vídeo degeneradas devolvem null', () => {
    expect(eyeRegionInCrop(rostoTipico, 0, 720, 1.4, false)).toBeNull();
    expect(eyeRegionInCrop(rostoTipico, 1280, 0, 1.4, false)).toBeNull();
  });

  it('rosto no canto do frame: a região é recortada aos limites, não estoura', () => {
    const noCanto = landmarksComOlhos({
      esquerdoExterno: [0.01, 0.03],
      esquerdoInterno: [0.04, 0.03],
      direitoInterno: [0.06, 0.03],
      direitoExterno: [0.09, 0.03],
    });
    const r = eyeRegionInCrop(noCanto, 1280, 720, 1.4, false);
    if (r) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(INPUT_SIZE);
      expect(r.y + r.height).toBeLessThanOrEqual(INPUT_SIZE);
    }
  });

  it('é determinístico', () => {
    const a = eyeRegionInCrop(rostoTipico, 1280, 720, 1.4, false);
    const b = eyeRegionInCrop(rostoTipico, 1280, 720, 1.4, false);
    expect(a).toEqual(b);
  });
});
