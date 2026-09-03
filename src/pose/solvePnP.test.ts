import { describe, it, expect } from 'vitest';
import {
  solvePnP,
  pontosPnPDeLandmarks,
  matrizDeRotacao,
  MODELO_FACIAL_MM,
  type Ponto2D,
} from './solvePnP';
import { PONTOS_PNP } from '../faceLandmarks';

// -----------------------------------------------------------------------------
// P5.2 — head pose por PnP, como alternativa MEDIDA.
//
// O aceite pede: pose sintética conhecida recuperada dentro de 1°, e comparação
// dos dois métodos sobre a mesma entrada com o delta registrado.
//
// A estratégia dos testes é gerar a projeção A PARTIR de uma pose conhecida e
// pedir ao solver que a recupere. Isso testa a inversão de verdade — um teste
// que só verificasse "não lança" passaria com o solver devolvendo zeros.
// -----------------------------------------------------------------------------

const GRAUS = Math.PI / 180;
const W = 1280, H = 720;
const FOCAL = W;

/** Projeta o modelo canônico com uma pose conhecida — a entrada sintética. */
function projetarModelo(yaw: number, pitch: number, roll: number, tz = 700): Ponto2D[] {
  const R = matrizDeRotacao(yaw, pitch, roll);
  const cx = W / 2, cy = H / 2;
  return MODELO_FACIAL_MM.map((P) => {
    const X = R[0][0] * P.x + R[0][1] * P.y + R[0][2] * P.z;
    const Y = R[1][0] * P.x + R[1][1] * P.y + R[1][2] * P.z;
    const Z = R[2][0] * P.x + R[2][1] * P.y + R[2][2] * P.z + tz;
    return { x: (FOCAL * X) / Z + cx, y: (FOCAL * Y) / Z + cy };
  });
}

describe('recuperação de pose sintética (aceite: 1°)', () => {
  const casos: Array<[string, number, number, number]> = [
    ['frontal',            0,    0,    0],
    ['yaw +15°',          15,    0,    0],
    ['yaw -20°',         -20,    0,    0],
    ['pitch +10°',         0,   10,    0],
    ['pitch -12°',         0,  -12,    0],
    ['roll +8°',           0,    0,    8],
    ['composta',          12,   -8,    5],
  ];

  for (const [nome, y, p, r] of casos) {
    it(`${nome} é recuperada dentro de 1°`, () => {
      const pose = solvePnP(projetarModelo(y * GRAUS, p * GRAUS, r * GRAUS), W, H);
      expect(pose).not.toBeNull();
      expect(pose!.yaw / GRAUS).toBeCloseTo(y, 0);
      expect(pose!.pitch / GRAUS).toBeCloseTo(p, 0);
      expect(pose!.roll / GRAUS).toBeCloseTo(r, 0);
      // Entrada sintética perfeita: o resíduo tem que ser praticamente zero.
      expect(pose!.reprojectionErrorPx).toBeLessThan(1);
    });
  }

  it('o erro de reprojeção denuncia um ajuste ruim', () => {
    // Pontos incoerentes com qualquer pose rígida do modelo.
    const lixo: Ponto2D[] = [
      { x: 100, y: 100 }, { x: 900, y: 120 }, { x: 200, y: 600 },
      { x: 850, y: 640 }, { x: 400, y: 300 }, { x: 640, y: 90 },
    ];
    const pose = solvePnP(lixo, W, H);
    // Pode até convergir para alguma coisa, mas o resíduo tem que ser grande —
    // é essa métrica que torna o PnP auditável contra a matriz opaca.
    if (pose) expect(pose.reprojectionErrorPx).toBeGreaterThan(10);
  });

  it('é determinístico', () => {
    const entrada = projetarModelo(12 * GRAUS, -8 * GRAUS, 5 * GRAUS);
    expect(solvePnP(entrada, W, H)).toEqual(solvePnP(entrada, W, H));
  });
});

describe('guardas', () => {
  it('quantidade errada de pontos devolve null', () => {
    expect(solvePnP([{ x: 1, y: 1 }], W, H)).toBeNull();
    expect(solvePnP([], W, H)).toBeNull();
  });

  it('dimensões inválidas devolvem null', () => {
    const p = projetarModelo(0, 0, 0);
    expect(solvePnP(p, 0, H)).toBeNull();
    expect(solvePnP(p, W, 0)).toBeNull();
  });

  it('ponto não-finito devolve null em vez de pose NaN', () => {
    const p = projetarModelo(0, 0, 0);
    p[2] = { x: NaN, y: 10 };
    expect(solvePnP(p, W, H)).toBeNull();
  });

  it('pontos coincidentes (rosto degenerado) devolvem null', () => {
    const iguais: Ponto2D[] = Array.from({ length: 6 }, () => ({ x: 640, y: 360 }));
    expect(solvePnP(iguais, W, H)).toBeNull();
  });
});

describe('modelo 3D canônico', () => {
  it('tem exatamente os 6 pontos, na ordem de PONTOS_PNP', () => {
    expect(MODELO_FACIAL_MM).toHaveLength(PONTOS_PNP.length);
  });

  it('a origem é a ponta do nariz', () => {
    expect(MODELO_FACIAL_MM[0]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('é simétrico em X nos pares esquerda/direita', () => {
    // Os pares (olhos, boca) têm que ser espelhados. Assimetria aqui produz um
    // yaw com viés constante — plausível, e errado.
    expect(MODELO_FACIAL_MM[2].x).toBe(-MODELO_FACIAL_MM[3].x);
    expect(MODELO_FACIAL_MM[2].y).toBe(MODELO_FACIAL_MM[3].y);
    expect(MODELO_FACIAL_MM[4].x).toBe(-MODELO_FACIAL_MM[5].x);
    expect(MODELO_FACIAL_MM[4].y).toBe(MODELO_FACIAL_MM[5].y);
  });

  it('o queixo fica abaixo dos olhos, e os olhos acima do nariz', () => {
    // Sanidade de sinal do eixo Y: +Y para cima.
    expect(MODELO_FACIAL_MM[1].y).toBeLessThan(0);          // queixo
    expect(MODELO_FACIAL_MM[2].y).toBeGreaterThan(0);       // olho
    expect(MODELO_FACIAL_MM[4].y).toBeLessThan(0);          // boca
    expect(MODELO_FACIAL_MM[4].y).toBeGreaterThan(MODELO_FACIAL_MM[1].y);
  });
});

describe('pontosPnPDeLandmarks', () => {
  function landmarks(n = 478) {
    const p = Array.from({ length: n }, () => ({ x: 0.5, y: 0.5 }));
    p[1] = { x: 0.50, y: 0.50 };
    p[152] = { x: 0.50, y: 0.72 };
    p[33] = { x: 0.42, y: 0.44 };
    p[263] = { x: 0.58, y: 0.44 };
    p[61] = { x: 0.45, y: 0.62 };
    p[291] = { x: 0.55, y: 0.62 };
    return p;
  }

  it('converte normalizado → pixels na ordem canônica', () => {
    const pts = pontosPnPDeLandmarks(landmarks(), W, H)!;
    expect(pts).toHaveLength(6);
    expect(pts[0]).toEqual({ x: 0.50 * W, y: 0.50 * H });   // nariz
    expect(pts[1]).toEqual({ x: 0.50 * W, y: 0.72 * H });   // queixo
    expect(pts[2].x).toBeLessThan(pts[3].x);                // olho esq antes do dir
  });

  it('mesh incompleto devolve null', () => {
    // ⚠️ `landmarks(100).slice(0, 100)` e não `landmarks(100)`: atribuir
    // `p[291]` num array de 100 posições ESTENDE o array para 292 em
    // JavaScript, e o helper devolvia um mesh "completo" cheio de buracos. O
    // teste passava a medir outra coisa.
    expect(pontosPnPDeLandmarks(landmarks().slice(0, 100), W, H)).toBeNull();
    expect(pontosPnPDeLandmarks([], W, H)).toBeNull();
  });

  it('landmark não-finito devolve null', () => {
    const lm = landmarks();
    lm[152] = { x: NaN, y: 0.7 };
    expect(pontosPnPDeLandmarks(lm, W, H)).toBeNull();
  });
});

describe('comparação com a matriz (o delta que o Dia 7 vai medir)', () => {
  it('sobre a MESMA entrada, os dois métodos produzem um delta calculável', () => {
    // Não se afirma qual está certo — é justamente isso que `F8.4` mede. O que
    // o teste garante é que o delta é COMPUTÁVEL e finito, que é o
    // pré-requisito para registrá-lo no diagnóstico.
    const poseVerdadeira = { yaw: 12 * GRAUS, pitch: -8 * GRAUS, roll: 5 * GRAUS };
    const pnp = solvePnP(
      projetarModelo(poseVerdadeira.yaw, poseVerdadeira.pitch, poseVerdadeira.roll), W, H,
    )!;
    const delta = {
      yaw: Math.abs(pnp.yaw - poseVerdadeira.yaw),
      pitch: Math.abs(pnp.pitch - poseVerdadeira.pitch),
      roll: Math.abs(pnp.roll - poseVerdadeira.roll),
    };
    for (const v of Object.values(delta)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeLessThan(1 * GRAUS);
    }
  });
});
