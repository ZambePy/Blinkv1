import { describe, it, expect } from 'vitest';
import { extractEyeFeatures } from './extractor';

// 2.3 — o fallback de ângulos de Euler rotulava os três eixos trocados.
//
// Quando não há `facialTransformationMatrixes`, o extractor deriva a pose dos
// próprios landmarks. As três linhas eram:
//
//   yaw   = atan2(xAxis.y, xAxis.x)                       ← isto é ROLL
//   pitch = atan2(-xAxis.z, hypot(yAxis.z, zAxis.z))      ← isto é YAW
//   roll  = atan2(yAxis.z, zAxis.z)                       ← isto é PITCH
//
// Permutação cíclica. `xAxis` é a linha entre os cantos externos dos olhos:
// o ângulo dela NO PLANO DA IMAGEM é a inclinação da cabeça (roll), e o
// componente z dela cresce quando a cabeça VIRA (yaw). O eixo vertical
// inclinando para perto/longe da câmera é que é pitch.
//
// Este teste constrói rotações conhecidas e exige que o fallback devolva o
// mesmo que o caminho da matriz — que é a referência, e o que o app usa em
// 100% dos quadros da gravação de referência.

const g = (d: number) => (d * Math.PI) / 180;

/** Matrizes de rotação elementares, na convenção do extractor
 *  (pitch = asin(−R12), yaw = atan2(R02, R22), roll = atan2(R10, R11)). */
const Ry = (a: number) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rx = (a: number) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Rz = (a: number) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const mul = (A: number[][], B: number[][]) =>
  A.map((li, i) => B[0].map((_, j) => li.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));

/**
 * Rosto sintético girado por R, com a conversão de frame explícita.
 *
 * O modelo é definido em coordenadas MÉTRICAS (as do MediaPipe:
 * x direita, y CIMA, z na direção do observador), giradas por R, e só então
 * convertidas para coordenadas de IMAGEM na hora de virar landmark:
 *
 *     img.x = 0,5 + p.x        img.y = 0,5 − p.y        img.z = −p.z
 *
 * Essa conversão é a raiz do bug de 2.3: os landmarks estão em coordenadas de
 * imagem, e o fallback extraía Euler deles como se já fossem métricas.
 */
function rostoGirado(R: number[][]) {
  const ap = (p: number[]) => {
    const m = [
      R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2],
      R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2],
      R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2],
    ];
    return { x: 0.5 + m[0], y: 0.5 - m[1], z: -m[2] };
  };
  const lm = Array.from({ length: 478 }, (_, i) => ap([(i % 17) * 0.002, (i % 13) * 0.002, (i % 7) * 0.002]));
  lm[33] = ap([-0.05, 0, 0]);      // canto externo esquerdo
  lm[263] = ap([+0.05, 0, 0]);     // canto externo direito
  lm[10] = ap([0, +0.10, 0]);      // topo da cabeça — y MÉTRICO cresce para cima
  lm[133] = ap([-0.02, 0, 0]); lm[159] = ap([-0.035, +0.012, 0]); lm[145] = ap([-0.035, -0.012, 0]);
  lm[362] = ap([+0.02, 0, 0]); lm[386] = ap([+0.035, +0.012, 0]); lm[374] = ap([+0.035, -0.012, 0]);
  for (const i of [468, 469, 470, 471, 472]) lm[i] = ap([-0.035, 0, 0]);
  for (const i of [473, 474, 475, 476, 477]) lm[i] = ap([+0.035, 0, 0]);
  return lm;
}

/** Matriz 4×4 column-major como o MediaPipe entrega — já em frame métrico. */
function matriz(R: number[][]): Float32Array {
  const m = new Float32Array(16);
  for (let c = 0; c < 3; c++) for (let l = 0; l < 3; l++) m[c * 4 + l] = R[l][c];
  m[15] = 1;
  return m;
}

/** Lê a pose pelo campo NOMEADO, não por índice: o layout [22..24] é do vetor
 *  compacto, e `extractEyeFeatures` produz outro. */
function pose(lm: ReturnType<typeof rostoGirado>, m?: Float32Array) {
  const f = extractEyeFeatures(lm, m).advancedFeatures!.face;
  return { yaw: f.yaw, pitch: f.pitch, roll: f.roll };
}

describe('ângulos de Euler — o fallback tem que concordar com a matriz', () => {
  const casos: [string, number[][], 'yaw' | 'pitch' | 'roll', number][] = [
    ['giro de cabeça (yaw) de 12°', Ry(g(12)), 'yaw', 12],
    ['giro de cabeça (yaw) de −12°', Ry(g(-12)), 'yaw', -12],
    ['cabeça inclinada (roll) de 10°', Rz(g(10)), 'roll', 10],
    ['cabeça para baixo (pitch) de 8°', Rx(g(8)), 'pitch', 8],
  ];

  for (const [nome, R, eixo, esperadoDeg] of casos) {
    it(`${nome}: o fallback põe o ângulo no eixo certo`, () => {
      const lm = rostoGirado(R);
      const semMatriz = pose(lm);
      // O eixo esperado carrega o ângulo…
      expect((semMatriz[eixo] * 180) / Math.PI).toBeCloseTo(esperadoDeg, 0);
      // …e os outros dois ficam perto de zero. Antes de 2.3 o ângulo aparecia
      // no eixo vizinho, e este par de asserções é o que falhava.
      for (const outro of ['yaw', 'pitch', 'roll'] as const) {
        if (outro === eixo) continue;
        expect(Math.abs((semMatriz[outro] * 180) / Math.PI)).toBeLessThan(1.5);
      }
    });

    it(`${nome}: fallback e matriz devolvem o mesmo`, () => {
      const lm = rostoGirado(R);
      const semMatriz = pose(lm);
      const comMatriz = pose(lm, matriz(R));
      for (const k of ['yaw', 'pitch', 'roll'] as const) {
        expect((semMatriz[k] * 180) / Math.PI).toBeCloseTo((comMatriz[k] * 180) / Math.PI, 0);
      }
    });
  }

  it('cabeça de frente devolve zero nos três eixos', () => {
    const p = pose(rostoGirado(mul(mul(Ry(0), Rx(0)), Rz(0))));
    for (const k of ['yaw', 'pitch', 'roll'] as const) {
      expect(Math.abs((p[k] * 180) / Math.PI)).toBeLessThan(0.5);
    }
  });
});
