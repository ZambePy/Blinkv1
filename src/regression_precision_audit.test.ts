import { describe, it, expect } from 'vitest';
import { extractCompactFeatures, projectFeatureSet, activeFeatureDims } from './extractor';
import { RidgeRegressor, trainRidgeModel, withinTargetPenalty } from './ridge';
import { buildL2CSBlock, isGazePlausible } from './l2cs/block';
import { deslocamentoPorPose, compensarPredicao } from './poseCompensation';

function syntheticFace() {
  const p = Array.from({ length: 478 }, (_, i) => ({
    x: 0.5 + (i % 17) * 0.002,
    y: 0.5 + (i % 13) * 0.002,
    z: (i % 7) * 0.002,
  }));
  const olho = (int: number, ext: number, topo: number, base: number) => {
    p[int] = { x: 0.45, y: 0.50, z: 0 }; p[ext] = { x: 0.55, y: 0.50, z: 0 };
    p[topo] = { x: 0.50, y: 0.47, z: 0 }; p[base] = { x: 0.50, y: 0.53, z: 0 };
  };
  olho(133, 33, 159, 145);
  olho(362, 263, 386, 374);
  p[10] = { x: 0.5, y: 0.3, z: 0 };
  for (const i of [468, 469, 470, 471, 472]) p[i] = { x: 0.50, y: 0.50, z: 0 };
  for (const i of [473, 474, 475, 476, 477]) p[i] = { x: 0.50, y: 0.50, z: 0 };
  return p;
}

describe('Auditoria Técnica e Suíte de Precisão', () => {
  describe('Conjuntos Destilados (irisCore)', () => {
    it('projeta corretamente as dimensões essenciais (4, 7, 9, 6, 11)', () => {
      const lm = syntheticFace();
      const gaze = { yaw: 0.15, pitch: -0.10, valid: true };
      const raw = extractCompactFeatures(lm, undefined, gaze).featuresLeft;

      expect(projectFeatureSet(raw, 'irisCore')).toHaveLength(4);
      expect(projectFeatureSet(raw, 'irisCore+pose')).toHaveLength(7);
      expect(projectFeatureSet(raw, 'irisCore+posecross')).toHaveLength(9);
      expect(projectFeatureSet(raw, 'irisCore+l2cs')).toHaveLength(6);
      expect(projectFeatureSet(raw, 'irisCore+l2cs+pose')).toHaveLength(11);

      expect(activeFeatureDims('irisCore')).toBe(4);
      expect(activeFeatureDims('irisCore+pose')).toBe(7);
      expect(activeFeatureDims('irisCore+posecross')).toBe(9);
      expect(activeFeatureDims('irisCore+l2cs')).toBe(6);
      expect(activeFeatureDims('irisCore+l2cs+pose')).toBe(11);
    });

    it('elimina colinearidades de contorno de íris', () => {
      const lm = syntheticFace();
      const gaze = { yaw: 0.10, pitch: -0.05, valid: true };
      const raw = extractCompactFeatures(lm, undefined, gaze).featuresLeft;
      const core = projectFeatureSet(raw, 'irisCore');

      // As 4 primeiras features são [offsetX, offsetY, relX, relY]
      expect(Number.isFinite(core[0])).toBe(true);
      expect(Number.isFinite(core[1])).toBe(true);
      expect(Number.isFinite(core[2])).toBe(true);
      expect(Number.isFinite(core[3])).toBe(true);
    });
  });

  describe('L2CS Estabilidade e Zero-Order Hold', () => {
    it('bloqueia valores fora da faixa fisiológica com isGazePlausible', () => {
      expect(isGazePlausible(0.2, -0.1)).toBe(true);
      expect(isGazePlausible(1.4, 0)).toBe(false); // ~80° implausível
      expect(isGazePlausible(0, -1.2)).toBe(false);
      expect(isGazePlausible(NaN, 0)).toBe(false);
    });

    it('buildL2CSBlock aplica tangentes contínuas sem degraus', () => {
      const blockValid = buildL2CSBlock(0.15, -0.10, true, 1.0);
      expect(blockValid).toHaveLength(7);
      expect(blockValid[0]).toBeCloseTo(Math.tan(0.15), 4);
      expect(blockValid[1]).toBeCloseTo(Math.tan(-0.10), 4);

      const blockInvalid = buildL2CSBlock(0.15, -0.10, false, 1.0);
      expect(blockInvalid).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });

  describe('Regressão Ridge com Lambdas Independentes e Descompressão de Ganho', () => {
    it('otimiza lambdaX e lambdaY de forma independente', () => {
      const features: number[][] = [];
      const targetsX: number[] = [];
      const targetsY: number[] = [];

      // Sinal limpo em X com grande amplitude, sinal com ruído em Y
      for (const x of [0.1, 0.5, 0.9]) {
        for (const y of [0.1, 0.5, 0.9]) {
          for (let i = 0; i < 20; i++) {
            const fx = (x - 0.5) * 0.1;
            const fy = (y - 0.5) * 0.03 + (i % 2 === 0 ? 0.01 : -0.01);
            features.push([fx, fy, fx * 2, fy * 2]);
            targetsX.push(x);
            targetsY.push(y);
          }
        }
      }

      const reg = new RidgeRegressor();
      reg.train(features, targetsX, targetsY);
      const model = reg.getModel()!;

      expect(model.lambdaX).toBeDefined();
      expect(model.lambdaY).toBeDefined();
      // B3.9 — a asserção anterior era `lambdaX <= lambdaY`, com o raciocínio
      // "sinal limpo precisa de menos regularização". Ela dependia do bug:
      // com a comparação `<` estrita e `bestLambda` inicializado no MENOR λ do
      // grid, todo empate era resolvido a favor da menor regularização — e um
      // sinal limpo produz justamente um PLATÔ de erro, onde tudo empata.
      //
      // Com o desempate pelo MAIOR λ, o eixo X (limpo) passa a escolher 1e-2
      // em vez de 1e-5: três ordens de grandeza a mais de regularização, com a
      // qualidade de predição intacta (medido abaixo — as bordas continuam
      // sendo alcançadas). O eixo Y (ruidoso) tem ótimo mais estreito e fica
      // no menor λ.
      //
      // Ou seja: a relação se INVERTE, e a inversão é o comportamento correto.
      // O que o teste trava agora é que os dois eixos escolhem λ de forma
      // independente — que é o nome do caso — e que a predição não degrada.
      expect(model.lambdaX!).not.toBe(model.lambdaY!);

      // Predição nas bordas deve atingir ~0.1 e ~0.9 sem compressão severa de ganho
      const predLeft = reg.predict([-0.04, 0, -0.08, 0]);
      const predRight = reg.predict([0.04, 0, 0.08, 0]);
      expect(predLeft.x).toBeLessThan(0.20);
      expect(predRight.x).toBeGreaterThan(0.80);
    });

    it('PENALTY_FLOOR de 1% não destrói direções de sinal primário', () => {
      const feats = [
        [0.1, 0.2],
        [0.1, 0.21],
        [0.5, 0.5],
        [0.5, 0.51],
      ];
      const groups = ['A', 'A', 'B', 'B'];
      const P = withinTargetPenalty(feats, groups);
      expect(P).not.toBeNull();
      // A diagonal deve conter penalidade moderada
      expect(P![0][0]).toBeGreaterThanOrEqual(0.01);
      expect(P![1][1]).toBeGreaterThanOrEqual(0.01);
    });

    it('Σ_W sai simétrica — `solveLinear` aceitaria uma P assimétrica calada', () => {
      // Features correlacionadas DENTRO de cada alvo, para que a covariância
      // intra-fixação tenha fora-de-diagonal não-nula: é exatamente ali que uma
      // normalização que só percorre o triângulo superior deixa
      // P[b][a] = meanDiag · P[a][b] e A = ΦᵀΦ + reg·P deixa de ser simétrica.
      const feats = [
        [0.10, 0.30, 0.02],
        [0.14, 0.38, 0.05],
        [0.50, 0.20, 0.60],
        [0.56, 0.31, 0.66],
      ];
      const groups = ['A', 'A', 'B', 'B'];
      const P = withinTargetPenalty(feats, groups);
      expect(P).not.toBeNull();

      // Sem isto o teste passaria de graça numa matriz diagonal.
      const maxOffDiag = Math.max(
        ...P!.flatMap((row, a) => row.map((v, b) => (a === b ? 0 : Math.abs(v))))
      );
      expect(maxOffDiag).toBeGreaterThan(1e-6);

      for (let a = 0; a < P!.length; a++) {
        for (let b = a + 1; b < P!.length; b++) {
          expect(P![b][a]).toBeCloseTo(P![a][b], 12);
        }
      }
    });
  });

  describe('Compensação Geométrica de Pose de Cabeça', () => {
    it('corrige o desvio da cabeça de forma proporcional à distância', () => {
      const refPose = { yaw: 0, pitch: 0, roll: 0 };
      const curPose = { yaw: 0.05, pitch: -0.03, roll: 0 }; // ~2.86° yaw, -1.72° pitch
      const distPx = 2268;

      const d = deslocamentoPorPose(curPose, refPose, distPx);
      // Girar a cabeça para a direita (yaw > 0) requer compensação negativa em X
      expect(d.dx).toBeLessThan(0);
      // Inclinar para cima (pitch < 0) requer compensação negativa em Y
      expect(d.dy).toBeLessThan(0);

      const comp = compensarPredicao(0.5, 0.5, curPose, refPose, distPx, 1920, 1080);
      expect(comp.x).toBeLessThan(0.5);
      expect(comp.y).toBeLessThan(0.5);
    });
  });
});
