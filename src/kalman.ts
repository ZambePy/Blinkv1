// Filtro de Kalman 2D para suavização do olhar (Adição A — IRISFLOW_PIPELINE_TECNICO.md §6A)
// Modelo posição-velocidade independente por eixo.
// Parâmetros assimétricos: eixo X tem maior ruído de processo (sacadas mais amplas horizontalmente).

interface KalmanAxis {
  x: number;  // estimativa de posição
  v: number;  // estimativa de velocidade
  P: number;  // covariância do erro
}

export class KalmanGaze2D {
  private axisX: KalmanAxis = { x: 0, v: 0, P: 1 };
  private axisY: KalmanAxis = { x: 0, v: 0, P: 1 };

  // Ruído de processo Q: quão rápido a posição verdadeira pode mudar (maior → segue sacadas mais rápido)
  // Ruído de medição R: confiança na leitura do sensor (maior → mais suavização)
  private static readonly Q_X = 0.0015;
  private static readonly R_X = 0.008;
  private static readonly Q_Y = 0.0008;
  private static readonly R_Y = 0.012;

  private step(s: KalmanAxis, meas: number, Q: number, R: number): KalmanAxis {
    // Predição
    const xp = s.x + s.v;
    const Pp = s.P + Q;
    // Ganho de Kalman
    const K  = Pp / (Pp + R);
    // Correção
    const res = meas - xp;
    return {
      x: xp + K * res,
      v: s.v * 0.8 + K * res * 0.2,
      P: (1 - K) * Pp,
    };
  }

  update(measX: number, measY: number): { x: number; y: number } {
    this.axisX = this.step(this.axisX, measX, KalmanGaze2D.Q_X, KalmanGaze2D.R_X);
    this.axisY = this.step(this.axisY, measY, KalmanGaze2D.Q_Y, KalmanGaze2D.R_Y);
    return { x: this.axisX.x, y: this.axisY.x };
  }

  reset(x: number, y: number): void {
    this.axisX = { x, v: 0, P: 1 };
    this.axisY = { x: y, v: 0, P: 1 };
  }
}
