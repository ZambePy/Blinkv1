export class LowPassFilter {
  private y: number | null = null;
  private a: number = 0;

  constructor(alpha: number, initval: number = 0) {
    this.y = initval;
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
      result = value;
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
    if (this.dx === null) {
      this.dx = new LowPassFilter(this.alpha(this.dcutoff));
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

export class OneEuroFilter2D {
  private filterX: OneEuroFilter;
  private filterY: OneEuroFilter;

  constructor(freq: number = 60, mincutoff: number = 0.05, beta_: number = 0.5, dcutoff: number = 1.0) {
    this.filterX = new OneEuroFilter(freq, mincutoff, beta_, dcutoff);
    this.filterY = new OneEuroFilter(freq, mincutoff, beta_, dcutoff);
  }

  public filter(x: number, y: number, timestamp: number = -1): { x: number, y: number } {
    return {
      x: this.filterX.filter(x, timestamp),
      y: this.filterY.filter(y, timestamp)
    };
  }
}
