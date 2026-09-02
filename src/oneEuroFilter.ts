export class LowPassFilter {
  // y inicia null: a primeira amostra passa intacta (result = value).
  // Um `initval = 0` no constructor causaria a primeira saída valer
  // `alpha * value + (1-alpha) * 0` — puxada para o canto superior esquerdo
  // (origem em pixels). Com alpha≈0.5 (filtro em espaço normalizado) o salto
  // seria de ~metade da tela no primeiro frame.
  private y: number | null = null;
  private a: number = 0;

  // Sem initval — não há argumento que faça sentido como "valor inicial
  // razoável" sem dados reais; null é a resposta correta.
  constructor(alpha: number) {
    this.setAlpha(alpha);
  }

  public setAlpha(alpha: number) {
    if (alpha <= 0.0 || alpha > 1.0) {
      throw new Error("alpha should be in (0.0., 1.0]");
    }
    this.a = alpha;
  }

  public filter(value: number): number {
    let result: number;
    if (this.y === null) {
      result = value;  // primeira amostra não é interpolada com zero
    } else {
      result = this.a * value + (1.0 - this.a) * this.y;
    }
    this.y = result;
    return result;
  }
  
  public lastValue(): number {
    return this.y ?? 0;
  }
}

export class OneEuroFilter {
  private freq: number;
  private mincutoff: number;
  private beta_: number;
  private dcutoff: number;
  private x: LowPassFilter | null = null;
  private dx: LowPassFilter | null = null;
  private lasttime: number = -1;

  constructor(freq: number, mincutoff: number = 1.0, beta_: number = 0.0, dcutoff: number = 1.0) {
    if (freq <= 0) throw new Error("freq should be >0");
    if (mincutoff <= 0) throw new Error("mincutoff should be >0");
    if (dcutoff <= 0) throw new Error("dcutoff should be >0");
    this.freq = freq;
    this.mincutoff = mincutoff;
    this.beta_ = beta_;
    this.dcutoff = dcutoff;
  }

  // Setters para mutação em tempo real pelo setParams da classe pai.
  // Permitem que OneEuroFilter2D.setParams preserve o estado filtrado (x, dx,
  // lasttime) enquanto troca os parâmetros de corte. Sem esses setters, a
  // única opção era recriar a instância, o que zeraria o estado e causaria
  // salto visível no cursor.
  public setMincutoff(mincutoff: number): void {
    if (mincutoff <= 0) throw new Error("mincutoff should be >0");
    this.mincutoff = mincutoff;
  }
  public setBeta(beta: number): void {
    this.beta_ = beta;
  }
  public reset(): void {
    this.x = null;
    this.dx = null;
    this.lasttime = -1;
  }

  private alpha(cutoff: number): number {
    const te = 1.0 / this.freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }

  public filter(value: number, timestamp: number = -1): number {
    if (this.lasttime !== -1 && timestamp !== -1) {
      this.freq = 1.0 / (timestamp - this.lasttime);
    }
    this.lasttime = timestamp;
    
    const dvalue = this.x ? (value - this.x.lastValue()) * this.freq : 0.0;
    // E8 ponto 1 do L2CS-NET.md: alpha depende de te = 1/freq, e freq é
    // atualizado com Δt real logo acima. Sem o setAlpha aqui, o dx ficava
    // preso ao freq inicial do constructor (60 Hz), amortecendo demais a
    // derivada quando os frames chegavam a 30 Hz — resultado: `edvalue`
    // sub-representa velocidade → cutoff fica baixo durante movimento rápido
    // → filtro suaviza demais justamente quando deveria ser responsivo.
    // Simétrico com o setAlpha do this.x logo abaixo.
    if (this.dx === null) {
      this.dx = new LowPassFilter(this.alpha(this.dcutoff));
    } else {
      this.dx.setAlpha(this.alpha(this.dcutoff));
    }
    const edvalue = this.dx.filter(dvalue);
    
    const cutoff = this.mincutoff + this.beta_ * Math.abs(edvalue);
    
    if (this.x === null) {
      this.x = new LowPassFilter(this.alpha(cutoff));
    } else {
      this.x.setAlpha(this.alpha(cutoff));
    }
    return this.x.filter(value);
  }
}

// Presets do filtro temporal, expostos ao usuário via SettingsScreen.
// Trade-off jitter × lag:
//   • estavel     → mincutoff baixo + beta baixo → alto smoothing,
//                    ideal para leitura e navegação em botões grandes.
//   • balanceado  → valores intermediários, padrão.
//   • responsivo  → mincutoff alto + beta alto → baixo lag,
//                    ideal para teclado virtual e jogos com alvo em movimento.
export type FilterPreset = 'estavel' | 'balanceado' | 'responsivo';

export interface FilterConfig {
  mincutoff: number;
  beta: number;
  useRollingBuffer: boolean; // buffer de 6 frames — legado, pode adicionar lag sem ganho
  // Quando true, o filtro é aplicado em coordenadas normalizadas [0,1]
  // ANTES da conversão para pixel. Desligado por default nos presets legados.
  // Razão: a 30fps e mincutoff=0.02 (espaço de pixel), alpha≈0.99 — o filtro
  // fica praticamente inativo. Em espaço normalizado (0..1), mincutoff=0.5
  // produz alpha≈0.50 — suavização real, independente da resolução da tela.
  filterInNormalizedSpace: boolean;
}

export const FILTER_PRESETS: Record<FilterPreset, FilterConfig> = {
  // Presets em espaço de pixel (legado).
  // Com esses valores, alpha≈0.99 a 30fps — suavização provém quase toda do
  // useRollingBuffer, não do One Euro. Mantidos para não quebrar sessões
  // existentes; "v2" abaixo são os equivalentes em espaço normalizado.
  estavel:    { mincutoff: 0.020, beta: 0.3,  useRollingBuffer: false, filterInNormalizedSpace: false },
  balanceado: { mincutoff: 0.050, beta: 2.5,  useRollingBuffer: false, filterInNormalizedSpace: false },
  responsivo: { mincutoff: 0.150, beta: 8.0,  useRollingBuffer: false, filterInNormalizedSpace: false },
};

// Presets em espaço normalizado [0,1] com parâmetros calibrados para essa
// escala. A velocidade do cursor é ~1/vw e ~1/vh em vez de pixels/s, então
// mincutoff e beta são ajustados para produzir suavização equivalente
// independente da resolução. Só fazem sentido com filterInNormalizedSpace=true;
// o engine valida isso antes de aplicar.
export type FilterPresetV2 = 'estavel-v2' | 'balanceado-v2' | 'responsivo-v2';

export const FILTER_PRESETS_V2: Record<FilterPresetV2, FilterConfig> = {
  // mincutoff ≈ 0.5 Hz em normalizado produz alpha≈0.50 a 30fps — filtra de verdade.
  // BUG-11: beta anterior era muito baixo para espaço normalizado — velocidades de
  // sacada (~0.02-0.05 unid/frame a 30fps) não elevavam cutoff o suficiente, causando
  // alpha≈0.50 mesmo durante movimento rápido → undershoot de 20-50% na amplitude.
  // Betas ajustados para que sacada rápida eleve cutoff além de 3Hz → alpha>0.85.
  'estavel-v2':    { mincutoff: 0.30, beta: 2.5,   useRollingBuffer: false, filterInNormalizedSpace: true },
  'balanceado-v2': { mincutoff: 0.50, beta: 5.0,   useRollingBuffer: false, filterInNormalizedSpace: true },
  'responsivo-v2': { mincutoff: 1.00, beta: 12.0,  useRollingBuffer: false, filterInNormalizedSpace: true },
};

export class OneEuroFilter2D {
  private filterX: OneEuroFilter;
  private filterY: OneEuroFilter;

  constructor(freq: number = 60, mincutoff: number = 0.02, beta_: number = 1.5, dcutoff: number = 1.0) {
    this.filterX = new OneEuroFilter(freq, mincutoff, beta_, dcutoff);
    this.filterY = new OneEuroFilter(freq, mincutoff, beta_, dcutoff);
  }

  public filter(x: number, y: number, timestamp: number = -1): { x: number, y: number } {
    return {
      x: this.filterX.filter(x, timestamp),
      y: this.filterY.filter(y, timestamp)
    };
  }

  // Muta os parâmetros das instâncias existentes em vez de recriá-las —
  // preserva `x`, `dx`, `lasttime` e o estado filtrado acumulado. Sem isto,
  // trocar preset em uso zera o estado e o cursor salta.
  public setParams(mincutoff: number, beta_: number): void {
    this.filterX.setMincutoff(mincutoff);
    this.filterX.setBeta(beta_);
    this.filterY.setMincutoff(mincutoff);
    this.filterY.setBeta(beta_);
  }

  public reset(): void {
    this.filterX.reset();
    this.filterY.reset();
  }
}
