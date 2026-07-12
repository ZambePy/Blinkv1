// @ts-ignore
import SVM from 'libsvm-js/asm';
import type { GazeRegressor } from './gazeRegressor';

export class SVRRegressor implements GazeRegressor {
  private svmX: any = null;
  private svmY: any = null;
  private cost: number;
  private gamma: number;

  constructor(cost: number = 100.0, gamma: number = 0.005) {
    this.cost = cost;
    this.gamma = gamma;
  }

  public train(features: number[][], targetsX: number[], targetsY: number[]): void {
    if (features.length === 0) return;

    this.svmX = new SVM({
      type: SVM.SVM_TYPES.EPSILON_SVR,
      kernel: SVM.KERNEL_TYPES.RBF,
      cost: this.cost,
      gamma: this.gamma,
      epsilon: 0.001,
      quiet: true
    });

    this.svmY = new SVM({
      type: SVM.SVM_TYPES.EPSILON_SVR,
      kernel: SVM.KERNEL_TYPES.RBF,
      cost: this.cost,
      gamma: this.gamma,
      epsilon: 0.001,
      quiet: true
    });

    this.svmX.train(features, targetsX);
    this.svmY.train(features, targetsY);
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
      cost: this.cost,
      gamma: this.gamma
    };
  }
}

export function svrModelFromRegressor(regressor: GazeRegressor): any | null {
  if (regressor instanceof SVRRegressor) {
    return regressor.getModel();
  }
  return null;
}

export function svrRegressorFromModel(model: any): SVRRegressor | null {
  if (!model || !model.x || !model.y) return null;
  const regressor = new SVRRegressor(model.cost, model.gamma);
  (regressor as any).svmX = SVM.restore(model.x);
  (regressor as any).svmY = SVM.restore(model.y);
  return regressor;
}
