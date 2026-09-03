// P6.1 — Kalman 2D com estado posição+velocidade e predição de 1 quadro.
//
// ── O que este filtro faz que o One Euro não faz ────────────────────────────
//
// O One Euro é um passa-baixa com corte adaptativo: ele não tem modelo do
// movimento, só reage à derivada do sinal. O Kalman carrega um MODELO —
// velocidade constante — e por isso pode **predizer** onde o alvo estará no
// próximo quadro, em vez de sempre atrasar em relação a ele.
//
// Isso importa aqui porque a cadeia inteira tem latência: MediaPipe ~19 ms,
// crop ~12 ms, inferência do L2CS 32–50 ms. Um cursor que sempre aponta para
// onde o olho ESTAVA fica sistematicamente atrás durante uma sacada.
//
// ── O trade-off, que é real e precisa ficar visível ─────────────────────────
//
// Predizer 1 quadro à frente REDUZ o erro em movimento e o AUMENTA em repouso:
// em fixação, a velocidade estimada é ruído, e projetar ruído adiante só
// espalha o cursor. Não existe escolha grátis aqui — o teste do módulo trava as
// duas metades justamente para que ninguém "melhore" uma esquecendo a outra.
//
// Quem decide se isso compensa é o benchmark `F8.5`, não este sprint. O default
// do pipeline continua sendo o One Euro.
//
// ── O modelo ────────────────────────────────────────────────────────────────
//
// Estado: [x, y, vx, vy]. Transição de velocidade constante:
//
//     x' = x + vx·dt        vx' = vx
//     y' = y + vy·dt        vy' = vy
//
// Medição: só a posição (o sensor não mede velocidade).
//
// Implementado com as matrizes escritas à mão em vez de uma biblioteca de
// álgebra: são blocos 2×2 desacoplados por eixo, e a versão explícita é mais
// fácil de auditar do que uma multiplicação genérica 4×4 — que é onde erros de
// índice se escondem sem sintoma.

export interface Kalman2DOptions {
  /**
   * Variância do processo. Quanto MAIOR, mais o filtro confia na medição e
   * menos no modelo — cursor mais responsivo e mais ruidoso.
   */
  processVariance?: number;
  /**
   * Variância da medição. Quanto MAIOR, mais o filtro confia no modelo e menos
   * na medição — cursor mais suave e mais atrasado.
   */
  measurementVariance?: number;
  /**
   * Quantos quadros predizer à frente na saída. `0` devolve a estimativa do
   * instante atual; `1` projeta um quadro adiante.
   *
   * ── O horizonte ótimo é a LATÊNCIA, e ela foi medida ────────────────────
   *
   * A predição não melhora o rastreamento por mágica: ela **cancela latência**.
   * Medido no teste deste módulo, com alvo em movimento e ruído de σ = 3 px:
   *
   *     sensor instantâneo:   pa=0 → 0,80   pa=1 → 13,62
   *     sensor 2 quadros atrás: pa=0 → 26,39  pa=1 → 13,05   pa=2 → 0,89
   *
   * Sem latência, qualquer predição PIORA. Com latência, o erro é mínimo
   * quando o horizonte IGUALA o atraso — predizer demais ultrapassa o alvo
   * tanto quanto predizer de menos fica atrás.
   *
   * ⚠️ **O default de 1 é o da especificação, e provavelmente é curto.** A
   * latência medida do pipeline é: MediaPipe ~19 ms + crop ~12 ms + inferência
   * do L2CS 32–50 ms (WebGPU) ≈ **2 a 3 quadros** a 30 fps. Ver
   * `docs/LATENCIA_L2CS.md`. O valor certo sai do benchmark `F8.5`, e ele deve
   * ser derivado da latência medida em runtime, não fixado aqui.
   */
  predictAheadFrames?: number;
  /** Intervalo nominal entre quadros, em segundos. Usado quando o chamador não
   *  passa `dt` — e como piso/teto do `dt` recebido. */
  nominalDt?: number;
}

/** Defaults da especificação: Q = 0,01 e R = 0,1. */
export const KALMAN_DEFAULTS: Required<Kalman2DOptions> = {
  processVariance: 0.01,
  measurementVariance: 0.1,
  predictAheadFrames: 1,
  nominalDt: 1 / 30,
};

/**
 * Limites de `dt`, em segundos.
 *
 * Mesma lição de `B3.5` no One Euro: `dt = 0` faz a covariância degenerar, e um
 * `dt` enorme (aba em segundo plano, GC longo) projeta a velocidade por
 * centenas de milissegundos e joga o cursor para fora da tela. Clampar é mais
 * honesto que confiar no relógio do navegador.
 */
const DT_MIN = 1 / 240;
const DT_MAX = 1 / 5;

export interface Kalman2DState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class Kalman2D {
  private readonly q: number;
  private readonly r: number;
  private readonly predictAhead: number;
  private readonly nominalDt: number;

  private inicializado = false;
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;

  // Covariância por eixo. Os eixos são independentes no modelo, então em vez de
  // uma 4×4 quase toda zero guardamos duas 2×2 — [[pp, pv], [pv, vv]].
  private pxx = 1; private pxv = 0; private pvv = 1;
  private pyy = 1; private pyv = 0; private pvvY = 1;

  constructor(opts: Kalman2DOptions = {}) {
    this.q = Math.max(0, opts.processVariance ?? KALMAN_DEFAULTS.processVariance);
    this.r = Math.max(1e-9, opts.measurementVariance ?? KALMAN_DEFAULTS.measurementVariance);
    this.predictAhead = Math.max(0, opts.predictAheadFrames ?? KALMAN_DEFAULTS.predictAheadFrames);
    this.nominalDt = opts.nominalDt ?? KALMAN_DEFAULTS.nominalDt;
  }

  /** Estado interno atual (sem a predição à frente). Para teste e diagnóstico. */
  get state(): Kalman2DState {
    return { x: this.x, y: this.y, vx: this.vx, vy: this.vy };
  }

  get ready(): boolean {
    return this.inicializado;
  }

  /**
   * Alimenta uma medição e devolve a estimativa filtrada, já projetada
   * `predictAheadFrames` à frente.
   *
   * A primeira medição INICIALIZA o estado em vez de ser filtrada: sem isso o
   * filtro parte de (0,0) e leva vários quadros para alcançar o cursor,
   * produzindo um deslize visível no começo de cada sessão.
   */
  filter(mx: number, my: number, dtSec?: number): { x: number; y: number } {
    if (!Number.isFinite(mx) || !Number.isFinite(my)) {
      return { x: this.x, y: this.y };
    }
    if (!this.inicializado) {
      this.inicializado = true;
      this.x = mx; this.y = my;
      this.vx = 0; this.vy = 0;
      return { x: mx, y: my };
    }

    const dt = clampDt(dtSec ?? this.nominalDt);

    // ── Predição ───────────────────────────────────────────────────────────
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // P = F·P·Fᵀ + Q, com F = [[1, dt], [0, 1]].
    //
    // O ruído de processo entra nos dois termos: `q·dt²` na posição e `q` na
    // velocidade. Aplicá-lo só na velocidade (erro comum) faz a covariância de
    // posição encolher indefinidamente em fixação, e o filtro para de aceitar
    // medição nova — trava no lugar.
    const dt2 = dt * dt;
    const pxxNovo = this.pxx + dt * (2 * this.pxv + dt * this.pvv) + this.q * dt2;
    const pxvNovo = this.pxv + dt * this.pvv;
    this.pxx = pxxNovo;
    this.pxv = pxvNovo;
    this.pvv = this.pvv + this.q;

    const pyyNovo = this.pyy + dt * (2 * this.pyv + dt * this.pvvY) + this.q * dt2;
    const pyvNovo = this.pyv + dt * this.pvvY;
    this.pyy = pyyNovo;
    this.pyv = pyvNovo;
    this.pvvY = this.pvvY + this.q;

    // ── Correção ───────────────────────────────────────────────────────────
    // K = P·Hᵀ·(H·P·Hᵀ + R)⁻¹, com H = [1, 0] (só a posição é medida).
    const sX = this.pxx + this.r;
    const kxPos = this.pxx / sX;
    const kxVel = this.pxv / sX;
    const residuoX = mx - this.x;
    this.x += kxPos * residuoX;
    this.vx += kxVel * residuoX;
    const pxxAnterior = this.pxx;
    this.pxx = (1 - kxPos) * this.pxx;
    this.pxv = this.pxv - kxVel * pxxAnterior;
    this.pvv = this.pvv - kxVel * this.pxv;

    const sY = this.pyy + this.r;
    const kyPos = this.pyy / sY;
    const kyVel = this.pyv / sY;
    const residuoY = my - this.y;
    this.y += kyPos * residuoY;
    this.vy += kyVel * residuoY;
    const pyyAnterior = this.pyy;
    this.pyy = (1 - kyPos) * this.pyy;
    this.pyv = this.pyv - kyVel * pyyAnterior;
    this.pvvY = this.pvvY - kyVel * this.pyv;

    // ── Predição de saída ──────────────────────────────────────────────────
    const avanco = this.predictAhead * dt;
    return { x: this.x + this.vx * avanco, y: this.y + this.vy * avanco };
  }

  /**
   * Posição predita `n` quadros à frente SEM consumir medição.
   *
   * É o que `P6.3` (hold on blink) usa: durante a piscada não há medição, e
   * congelar no último valor emitido deixa o cursor parado enquanto o olho
   * continua se movendo. Projetar pelo modelo é a melhor estimativa disponível.
   */
  predict(frames = 1, dtSec?: number): { x: number; y: number } {
    const dt = clampDt(dtSec ?? this.nominalDt);
    const avanco = frames * dt;
    return { x: this.x + this.vx * avanco, y: this.y + this.vy * avanco };
  }

  /** Avança o estado no tempo sem medição (predição pura). Usado no hold. */
  step(dtSec?: number): void {
    if (!this.inicializado) return;
    const dt = clampDt(dtSec ?? this.nominalDt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // A incerteza CRESCE enquanto não há medição — é o que faz o filtro voltar
    // a aceitar a medição rapidamente quando o olho reabre.
    this.pxx += this.q * dt * dt;
    this.pvv += this.q;
    this.pyy += this.q * dt * dt;
    this.pvvY += this.q;
  }

  reset(): void {
    this.inicializado = false;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.pxx = 1; this.pxv = 0; this.pvv = 1;
    this.pyy = 1; this.pyv = 0; this.pvvY = 1;
  }
}

function clampDt(dt: number): number {
  if (!Number.isFinite(dt)) return KALMAN_DEFAULTS.nominalDt;
  return Math.min(DT_MAX, Math.max(DT_MIN, dt));
}
