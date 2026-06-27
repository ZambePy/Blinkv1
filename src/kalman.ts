// Filtro de Kalman 2D + Exponential Moving Average (EMA)
// Implementação exata baseada na arquitetura de filtros do EyeTrax.

interface KalmanAxis {
  x: number;  // estimativa de posição
  v: number;  // estimativa de velocidade
  P: number;  // covariância do erro
}

export class KalmanEMASmoother {
  private axisX: KalmanAxis = { x: 0, v: 0, P: 1 };
  private axisY: KalmanAxis = { x: 0, v: 0, P: 1 };

  private emaX: number | null = null;
  private emaY: number | null = null;

  // EMA alpha default do EyeTrax: 0.25
  private emaAlpha: number;

  // Ruído de processo Q e medição R (ajustado para rastreamento de olhar)
  private static readonly Q_X = 0.0015;
  private static readonly R_X = 0.008;
  private static readonly Q_Y = 0.0008;
  private static readonly R_Y = 0.012;

  constructor(emaAlpha: number = 0.25) {
    this.emaAlpha = emaAlpha;
  }

  public setEmaAlpha(alpha: number): void {
    this.emaAlpha = alpha;
  }

  private stepKalman(s: KalmanAxis, meas: number, Q: number, R: number): KalmanAxis {
    // Predição
    const xp = s.x + s.v;
    const Pp = s.P + Q;
    // Ganho de Kalman
    const K  = Pp / (Pp + R);
    // Correção
    const res = meas - xp;
    return {
      x: xp + K * res,
      v: s.v * 0.8 + K * res * 0.2, // Decaimento leve da velocidade
      P: (1 - K) * Pp,
    };
  }

  update(measX: number, measY: number): { x: number; y: number } {
    // 1. Aplica o filtro de Kalman
    this.axisX = this.stepKalman(this.axisX, measX, KalmanEMASmoother.Q_X, KalmanEMASmoother.R_X);
    this.axisY = this.stepKalman(this.axisY, measY, KalmanEMASmoother.Q_Y, KalmanEMASmoother.R_Y);

    const kalmanX = this.axisX.x;
    const kalmanY = this.axisY.x;

    // 2. Aplica o EMA (Exponential Moving Average) no sinal filtrado pelo Kalman
    if (this.emaX === null || this.emaY === null) {
      this.emaX = kalmanX;
      this.emaY = kalmanY;
    } else {
      this.emaX = this.emaAlpha * kalmanX + (1 - this.emaAlpha) * this.emaX;
      this.emaY = this.emaAlpha * kalmanY + (1 - this.emaAlpha) * this.emaY;
    }

    return { x: this.emaX, y: this.emaY };
  }

  reset(x: number, y: number): void {
    this.axisX = { x, v: 0, P: 1 };
    this.axisY = { x: y, v: 0, P: 1 };
    this.emaX = x;
    this.emaY = y;
  }
}
