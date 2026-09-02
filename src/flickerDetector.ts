// Detecção de cintilação da rede elétrica no sensor.
//
// POR QUE IMPORTA AQUI
//
// Lâmpada ligada na rede pulsa no DOBRO da frequência elétrica: 100 Hz em rede
// de 50 Hz, 120 Hz em rede de 60 Hz. A câmera amostra isso a 30 fps, e o que
// sobra é aliasing:
//
//   rede 60 Hz → luz 120 Hz → 120 mod 30 = 0 Hz  → invisível, estável
//   rede 50 Hz → luz 100 Hz → 100 mod 30 = 10 Hz → oscilação visível
//
// Ou seja: a MESMA lâmpada é inofensiva ou destrutiva dependendo do casamento
// entre a rede local e o `powerLineFrequency` configurado na webcam. Quando não
// casa, o brilho do crop ocular oscila frame a frame, o contraste da borda da
// íris oscila junto, e o landmark se desloca. Sobre um sinal de ~7 px de
// deslocamento total, isso é ruído caro.
//
// O detector não tenta adivinhar a rede: ele mede a oscilação que sobrou e diz
// se existe. A correção é configurar `powerLineFrequency` na câmera (o tuner
// faz, quando o driver expõe) ou trocar a lâmpada.
//
// ⚠️ Nyquist: amostrando a `fps`, só enxergamos até `fps/2`. A 30 fps isso
// cobre o batimento de 10 Hz da rede de 50 Hz, que é o caso problemático no
// Brasil (onde há rede de 60 Hz, mas webcams frequentemente vêm com o default
// de 50 Hz de fábrica — e é esse descasamento que gera o batimento).

export interface FlickerReport {
  /** Oscilação periódica acima do limiar. */
  detected: boolean;
  /** Frequência aparente dominante (Hz), já considerando o aliasing. */
  dominantHz: number;
  /** Amplitude da componente dominante relativa ao brilho médio (0..1). */
  relativeAmplitude: number;
  /** Amostras usadas. Abaixo de MIN_SAMPLES o veredito não é confiável. */
  samples: number;
}

/** Série curta demais não permite distinguir oscilação de deriva. */
export const MIN_SAMPLES = 32;

/**
 * Amplitude relativa a partir da qual vale avisar.
 *
 * Referência: nas gravações reais o desvio-padrão do brilho ficou em 0,0097
 * sobre média 0,236 — cerca de 4% de variação relativa, e nenhuma delas
 * periódica. Uma componente PERIÓDICA de 3% já é maior que todo o ruído
 * aperiódico medido, então é um piso defensável.
 */
const AMPLITUDE_THRESHOLD = 0.03;

/**
 * Analisa uma série temporal de brilho e devolve a componente periódica
 * dominante.
 *
 * Usa DFT direta sobre um punhado de bins em vez de FFT: a série tem dezenas
 * de amostras, roda uma vez por segundo, e uma FFT aqui seria complexidade sem
 * ganho mensurável.
 *
 * A média é removida antes (a componente DC é o brilho, não a cintilação), e
 * também a tendência linear — sem isso, uma sala escurecendo devagar apareceria
 * como "oscilação de frequência muito baixa".
 */
export function detectFlicker(series: readonly number[], fps: number): FlickerReport {
  const n = series.length;
  if (n < MIN_SAMPLES || !(fps > 0)) {
    return { detected: false, dominantHz: 0, relativeAmplitude: 0, samples: n };
  }

  const mean = series.reduce((a, b) => a + b, 0) / n;
  if (!(Math.abs(mean) > 1e-9)) {
    return { detected: false, dominantHz: 0, relativeAmplitude: 0, samples: n };
  }

  // Remoção de tendência linear por mínimos quadrados sobre o índice.
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += series[i]; sxx += i * i; sxy += i * series[i]; }
  const denom = n * sxx - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const intercept = (sy - slope * sx) / n;
  const detrended = series.map((v, i) => v - (intercept + slope * i));

  // Varre bins de 1 até n/2 - 1. O bin 0 é a DC (já removida pela tendência).
  let bestAmp = 0;
  let bestK = 0;
  const maxK = Math.floor(n / 2);
  for (let k = 1; k < maxK; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI * k * i) / n;
      re += detrended[i] * Math.cos(ang);
      im -= detrended[i] * Math.sin(ang);
    }
    // Amplitude do senoide equivalente: 2·|X_k|/N.
    const amp = (2 * Math.hypot(re, im)) / n;
    if (amp > bestAmp) { bestAmp = amp; bestK = k; }
  }

  const dominantHz = (bestK * fps) / n;
  const relativeAmplitude = bestAmp / Math.abs(mean);

  return {
    detected: relativeAmplitude >= AMPLITUDE_THRESHOLD,
    dominantHz,
    relativeAmplitude,
    samples: n,
  };
}

/**
 * Traduz o batimento observado na rede elétrica mais provável.
 *
 * A 30 fps, rede de 50 Hz descasada produz batimento de 10 Hz (100 mod 30) e
 * rede de 60 Hz produz 0 Hz (120 mod 30) — invisível. Então batimento perto de
 * 10 Hz aponta para 50 Hz, e é o que o `powerLineFrequency` da câmera deve
 * passar a valer.
 *
 * Devolve `null` quando o batimento não casa com nenhum dos dois: aí a
 * oscilação tem outra origem (monitor, tela do próprio app, sombra em
 * movimento) e mudar a configuração da câmera não resolve.
 */
export function inferPowerLineHz(dominantHz: number, fps: number): 50 | 60 | null {
  if (!(fps > 0) || !(dominantHz > 0)) return null;
  const alias = (lightHz: number) => {
    const m = lightHz % fps;
    return Math.min(m, fps - m);   // dobra em torno de Nyquist
  };
  const cands: [50 | 60, number][] = [[50, alias(100)], [60, alias(120)]];
  let best: 50 | 60 | null = null;
  let bestErr = Infinity;
  for (const [hz, expected] of cands) {
    if (expected < 0.5) continue;     // aliasing para ~DC: indetectável
    const err = Math.abs(dominantHz - expected);
    if (err < bestErr) { bestErr = err; best = hz; }
  }
  // Tolerância de 1,5 Hz: o fps real oscila e a série é curta.
  return bestErr <= 1.5 ? best : null;
}
