// SVR (Support Vector Regression) com auto-tuning de hiperparâmetros.
//
// O kernel RBF K(x,x') = exp(-gamma * ||x-x'||²) requer gamma ajustado
// à escala do espaço de features. Com 258 features z-scored, gamma=0.005
// (valor anterior, herdado do GazeFollower para CNN embeddings) produz
// K ≈ 1.0 para TODOS os pares → SVR prediz ≈ média dos targets.
//
// O auto-tuning usa leave-one-POINT-out CV sobre medianas por ponto de
// calibração: 9 pontos × 18 combinações do grid = 162 treinos rápidos.

// @ts-ignore
import SVM from 'libsvm-js/asm';
import type { GazeRegressor } from './gazeRegressor';

// ─── Grid de hiperparâmetros para auto-tuning ─────────────────────────────────

const COST_GRID   = [0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0, 50.0, 100.0] as const;
const SVR_EPSILON = 0.01;

// ─── Utilidades ───────────────────────────────────────────────────────────────

interface PointGroup {
  targetX: number;
  targetY: number;
  features: number[][];
}

/** Agrupa amostras por ponto de calibração (mesma target screenX,screenY). */
function groupByTarget(
  features: number[][],
  targetsX: number[],
  targetsY: number[],
): PointGroup[] {
  const map = new Map<string, PointGroup>();
  for (let i = 0; i < features.length; i++) {
    const key = `${targetsX[i].toFixed(4)},${targetsY[i].toFixed(4)}`;
    if (!map.has(key)) {
      map.set(key, { targetX: targetsX[i], targetY: targetsY[i], features: [] });
    }
    map.get(key)!.features.push(features[i]);
  }
  return Array.from(map.values());
}

/** Calcula a mediana element-wise de um conjunto de vetores. */
function medianVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const d = vectors[0].length;
  const result = new Array<number>(d);
  for (let j = 0; j < d; j++) {
    const col = vectors.map(v => v[j]).sort((a, b) => a - b);
    const mid = Math.floor(col.length / 2);
    result[j] = col.length % 2 !== 0
      ? col[mid]
      : (col[mid - 1] + col[mid]) / 2;
  }
  return result;
}

// ─── Classe ───────────────────────────────────────────────────────────────────

export class SVRRegressor implements GazeRegressor {
  private svmX: any = null;
  private svmY: any = null;
  private cost: number;

  constructor(cost: number = 10.0) {
    this.cost = cost;
  }

  public train(features: number[][], targetsX: number[], targetsY: number[]): void {
    if (features.length === 0) return;

    // Auto-tune C via leave-one-POINT-out cross-validation
    const best = this._autoTune(features, targetsX, targetsY);
    this.cost  = best.cost;

    // Treino final com todos os dados e melhores hiperparâmetros
    this.svmX = new SVM({
      type: SVM.SVM_TYPES.EPSILON_SVR,
      kernel: SVM.KERNEL_TYPES.LINEAR,
      cost: this.cost,
      epsilon: SVR_EPSILON,
      quiet: true
    });

    this.svmY = new SVM({
      type: SVM.SVM_TYPES.EPSILON_SVR,
      kernel: SVM.KERNEL_TYPES.LINEAR,
      cost: this.cost,
      epsilon: SVR_EPSILON,
      quiet: true
    });

    this.svmX.train(features, targetsX);
    this.svmY.train(features, targetsY);
  }

  /**
   * Auto-tuning de C via leave-one-POINT-out cross-validation.
   *
   * Usa representantes (mediana por ponto) para tornar o CV instantâneo.
   * Com o kernel LINEAR, não sofremos do colapso geométrico do RBF em altas
   * dimensões (258 dims).
   */
  private _autoTune(
    features: number[][],
    targetsX: number[],
    targetsY: number[],
  ): { cost: number } {
    const groups = groupByTarget(features, targetsX, targetsY);
    const nPoints = groups.length;

    if (nPoints < 3) {
      console.log('[svr] auto-tuning pulado (< 3 pontos) — usando defaults');
      return { cost: 10.0 };
    }

    // Representantes: mediana das features de cada ponto
    const reps = groups.map(g => medianVector(g.features));
    const repTX = groups.map(g => g.targetX);
    const repTY = groups.map(g => g.targetY);

    const t0 = performance.now();
    let bestCost: number = COST_GRID[4];  // 1.0 default (index 4 na nova grade)
    let bestErr   = Infinity;

    for (const cost of COST_GRID) {
      let totalErr = 0;
      let valid = true;

      for (let lo = 0; lo < nPoints; lo++) {
        // Treina em todos os representantes exceto o ponto `lo`
        const trainF:  number[][] = [];
        const trainTX: number[]   = [];
        const trainTY: number[]   = [];

        for (let p = 0; p < nPoints; p++) {
          if (p === lo) continue;
          trainF.push(reps[p]);
          trainTX.push(repTX[p]);
          trainTY.push(repTY[p]);
        }

        try {
          const sx = new SVM({
            type: SVM.SVM_TYPES.EPSILON_SVR,
            kernel: SVM.KERNEL_TYPES.LINEAR,
            cost,
            epsilon: SVR_EPSILON,
            quiet: true
          });
          const sy = new SVM({
            type: SVM.SVM_TYPES.EPSILON_SVR,
            kernel: SVM.KERNEL_TYPES.LINEAR,
            cost,
            epsilon: SVR_EPSILON,
            quiet: true
          });

          sx.train(trainF, trainTX);
          sy.train(trainF, trainTY);

          // Prediz o representante do ponto excluído
          const px = sx.predict([reps[lo]])[0];
          const py = sy.predict([reps[lo]])[0];
          totalErr += (px - repTX[lo]) ** 2 + (py - repTY[lo]) ** 2;
        } catch {
          valid = false;
          break;
        }
      }

      if (valid && totalErr < bestErr) {
        bestErr   = totalErr;
        bestCost  = cost;
      }
    }

    const elapsed = performance.now() - t0;
    console.log(
      `[svr] auto-tuning concluído em ${elapsed.toFixed(0)}ms — ` +
      `C=${bestCost} lopoErr=${bestErr.toFixed(6)} | ` +
      `${nPoints} pontos | grid=${COST_GRID.length}`
    );

    return { cost: bestCost };
  }

  public predict(features: number[]): { x: number; y: number } {
    if (!this.svmX || !this.svmY) {
      throw new Error("SVRRegressor not trained");
    }
    const px = this.svmX.predict([features])[0];
    const py = this.svmY.predict([features])[0];

    return {
      x: Math.max(0, Math.min(1, px)) * document.documentElement.clientWidth,
      y: Math.max(0, Math.min(1, py)) * document.documentElement.clientHeight
    };
  }

  public getModel(): any {
    if (!this.svmX || !this.svmY) return null;
    return {
      x: this.svmX.serializeModel(),
      y: this.svmY.serializeModel(),
      cost: this.cost
    };
  }
}

// ─── Serialização ─────────────────────────────────────────────────────────────

export function svrModelFromRegressor(regressor: GazeRegressor): any | null {
  if (regressor instanceof SVRRegressor) {
    return regressor.getModel();
  }
  return null;
}

export function svrRegressorFromModel(model: any): SVRRegressor | null {
  if (!model || !model.x || !model.y) return null;
  const regressor = new SVRRegressor(model.cost);
  (regressor as any).svmX = SVM.restore(model.x);
  (regressor as any).svmY = SVM.restore(model.y);
  return regressor;
}
