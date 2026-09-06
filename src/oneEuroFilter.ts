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

/**
 * Intervalo mínimo entre amostras, em segundos. 1/240 cobre monitores de alta
 * taxa com folga. `dt = 0` (timestamps iguais em replay, ou `performance.now()`
 * grosseirizado) levaria `alpha` a 0 e `setAlpha` lança — o frame inteiro
 * seria descartado pelo `loopGuard`.
 */
export const DT_MIN_SEC = 1 / 240;

/**
 * Intervalo máximo entre amostras, em segundos. 1/5 é 5 fps — abaixo disso o
 * rastreamento já não é utilizável. `dt` grande (aba em segundo plano, GC
 * longo, sleep/wake) levaria `alpha → 1`: o filtro vira identidade e o cursor
 * salta justamente no frame em que o usuário volta a olhar para a tela.
 */
export const DT_MAX_SEC = 1 / 5;

export class OneEuroFilter {
  private freq: number;
  /** Frequência do construtor, para `reset()` poder restaurá-la. */
  private readonly freqInicial: number;
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
    this.freqInicial = freq;
    this.mincutoff = mincutoff;
    this.beta_ = beta_;
    this.dcutoff = dcutoff;
  }

  // Setters para `OneEuroFilter2D.setParams` trocar os parâmetros de corte
  // preservando o estado filtrado — recriar a instância zeraria o estado e
  // causaria salto visível no cursor.
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
    // `freq` também é estado de sessão: sem restaurá-la, um dt patológico
    // anterior continuava governando o alpha até o próximo par de timestamps.
    this.freq = this.freqInicial;
  }

  // Uma única implementação da fórmula, para que o número declarado nos
  // presets e o número usado pelo filtro não possam divergir.
  private alpha(cutoff: number): number {
    return alphaFromCutoff(cutoff, this.freq);
  }

  public filter(value: number, timestamp: number = -1): number {
    // Um NaN de entrada contaminaria o estado até o próximo reset(); o filtro
    // devolve o último valor conhecido em vez de propagar.
    if (!Number.isFinite(value)) {
      return this.x ? this.x.lastValue() : 0;
    }
    if (this.lasttime !== -1 && timestamp !== -1) {
      // `dt` clampado em [DT_MIN_SEC, DT_MAX_SEC]: dt ≤ 0 faria `setAlpha`
      // lançar; dt muito alto faria o filtro virar identidade.
      const bruto = timestamp - this.lasttime;
      const dt = Number.isFinite(bruto)
        ? Math.min(DT_MAX_SEC, Math.max(DT_MIN_SEC, bruto))
        : DT_MIN_SEC;
      this.freq = 1.0 / dt;
    }
    this.lasttime = timestamp;
    
    const dvalue = this.x ? (value - this.x.lastValue()) * this.freq : 0.0;
    // alpha depende de te = 1/freq, e freq acabou de ser atualizado com o Δt
    // real. Sem o setAlpha aqui o dx ficava preso ao freq do constructor,
    // sub-representando a velocidade a 30 Hz e suavizando demais justamente
    // no movimento rápido. Simétrico com o setAlpha do this.x abaixo.
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

/**
 * Ganho do passa-baixa para um cutoff e uma taxa de amostragem:
 * `alpha = 1/(1 + τ/te)`, com `τ = 1/(2π·fc)` e `te = 1/freq`.
 *
 * Exportada porque os presets declaram o alpha que produzem e um teste
 * verifica que a declaração bate com a fórmula. `alpha` é adimensional e não
 * depende do espaço de coordenadas — só o termo `beta·|ẋ|` muda de escala
 * entre pixel e normalizado.
 */
export function alphaFromCutoff(cutoffHz: number, freqHz: number): number {
  const te = 1 / freqHz;
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / te);
}

/** Constante de tempo do passa-baixa, em segundos: `τ = 1/(2π·fc)`.
 *  É o número que descreve o comportamento observável — quanto tempo um viés
 *  residual leva para decair a ~37%. */
export function tauFromCutoff(cutoffHz: number): number {
  return 1 / (2 * Math.PI * cutoffHz);
}

export interface FilterConfig {
  mincutoff: number;
  beta: number;
  // Quando true, o filtro é aplicado em coordenadas normalizadas [0,1] ANTES
  // da conversão para pixel. O que muda é a escala de `|ẋ|` no termo
  // `beta·|ẋ|`: em pixel a velocidade é ~1000× maior que em normalizado,
  // então o mesmo beta produz efeitos completamente diferentes.
  filterInNormalizedSpace: boolean;
  /** Alpha em repouso a 30 fps, derivado da fórmula. Declarado no preset para
   *  que a documentação não possa divergir do comportamento. */
  alphaAt30: number;
  /** Constante de tempo em segundos — quanto tempo o cursor leva para
   *  acomodar, que é o que o cuidador percebe. */
  tauSec: number;
}

/** Monta um preset já com `alphaAt30` e `tauSec` derivados do mincutoff. */
function preset(
  mincutoff: number,
  beta: number,
  filterInNormalizedSpace: boolean,
): FilterConfig {
  return {
    mincutoff,
    beta,
    filterInNormalizedSpace,
    alphaAt30: alphaFromCutoff(mincutoff, 30),
    tauSec: tauFromCutoff(mincutoff),
  };
}

export const FILTER_PRESETS: Record<FilterPreset, FilterConfig> = {
  // Presets em espaço de pixel (legado). A 30 fps:
  //
  //   estavel     mincutoff 0,020 → alpha 0,0042, τ = 7,96 s
  //   balanceado  mincutoff 0,050 → alpha 0,0104, τ = 3,18 s
  //   responsivo  mincutoff 0,150 → alpha 0,0304, τ = 1,06 s
  //
  // Estes presets filtram DEMAIS: um τ de 3,18 s significa que um viés
  // residual leva mais de 3 s para decair — inutilizável para um dwell de
  // 1,5 s. Mantidos com os mesmos números para não mudar o comportamento de
  // sessões existentes sem medição.
  estavel:    preset(0.020, 0.3, false),
  balanceado: preset(0.050, 2.5, false),
  responsivo: preset(0.150, 8.0, false),
};

// Presets em espaço normalizado [0,1] com parâmetros calibrados para essa
// escala. A velocidade do cursor é ~1/vw e ~1/vh em vez de pixels/s, então
// mincutoff e beta são ajustados para produzir suavização equivalente
// independente da resolução. Só fazem sentido com filterInNormalizedSpace=true;
// o engine valida isso antes de aplicar.
export type FilterPresetV2 = 'estavel-v2' | 'balanceado-v2' | 'responsivo-v2';

export const FILTER_PRESETS_V2: Record<FilterPresetV2, FilterConfig> = {
  // A 30 fps:
  //
  //   estavel-v2     mincutoff 0,30 → alpha 0,0592, τ = 0,53 s
  //   balanceado-v2  mincutoff 0,50 → alpha 0,0948, τ = 0,32 s
  //   responsivo-v2  mincutoff 1,00 → alpha 0,1730, τ = 0,16 s
  //
  // Um viés residual de 40 px converge em ~1 s. Os betas (2,5/5/12) são
  // provisórios até haver medição comparativa com as outras cadeias.
  'estavel-v2':    preset(0.30, 2.5,  true),
  'balanceado-v2': preset(0.50, 5.0,  true),
  'responsivo-v2': preset(1.00, 12.0, true),
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
