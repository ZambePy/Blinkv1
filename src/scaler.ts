export class StandardScaler {
  private means: number[] = [];
  private stds: number[] = [];
  private isFitted: boolean = false;

  public fit(data: number[][]): void {
    if (data.length === 0) return;
    
    const numFeatures = data[0].length;
    const numSamples = data.length;

    this.means = new Array(numFeatures).fill(0);
    this.stds = new Array(numFeatures).fill(0);

    // Média
    for (let i = 0; i < numSamples; i++) {
      for (let j = 0; j < numFeatures; j++) {
        this.means[j] += data[i][j];
      }
    }
    for (let j = 0; j < numFeatures; j++) {
      this.means[j] /= numSamples;
    }

    // Variância
    for (let i = 0; i < numSamples; i++) {
      for (let j = 0; j < numFeatures; j++) {
        const diff = data[i][j] - this.means[j];
        this.stds[j] += diff * diff;
      }
    }

    // Desvio padrão
    for (let j = 0; j < numFeatures; j++) {
      this.stds[j] = Math.sqrt(this.stds[j] / numSamples);
      // Evita divisão por zero se a feature for constante
      if (this.stds[j] < 1e-8) {
        this.stds[j] = 1.0;
      }
    }
    this.isFitted = true;
  }

  public transform(data: number[][]): number[][] {
    if (!this.isFitted) return data;
    const numSamples = data.length;
    const numFeatures = data[0].length;

    const scaled = new Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      scaled[i] = new Array(numFeatures);
      for (let j = 0; j < numFeatures; j++) {
        scaled[i][j] = (data[i][j] - this.means[j]) / this.stds[j];
      }
    }
    return scaled;
  }

  public transformSingle(row: number[]): number[] {
    if (!this.isFitted) return row;
    const scaled = new Array(row.length);
    for (let j = 0; j < row.length; j++) {
      scaled[j] = (row[j] - this.means[j]) / this.stds[j];
    }
    return scaled;
  }

  public getParams() {
    return { means: this.means, stds: this.stds };
  }

  public setParams(means: number[], stds: number[]) {
    this.means = means;
    this.stds = stds;
    this.isFitted = true;
  }
}
