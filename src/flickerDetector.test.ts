import { describe, it, expect } from 'vitest';
import { detectFlicker, inferPowerLineHz, MIN_SAMPLES } from './flickerDetector';

const serie = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe('detectFlicker', () => {
  it('série curta demais não emite veredito', () => {
    const r = detectFlicker(serie(MIN_SAMPLES - 1, () => 0.25), 30);
    expect(r.detected).toBe(false);
    expect(r.samples).toBe(MIN_SAMPLES - 1);
  });

  it('brilho constante → sem cintilação', () => {
    expect(detectFlicker(serie(64, () => 0.236), 30).detected).toBe(false);
  });

  it('ruído aperiódico do nível medido em campo NÃO dispara', () => {
    // Nas gravações reais o desvio do brilho foi 0,0097 sobre média 0,236,
    // sem periodicidade. O detector não pode confundir isso com cintilação.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
    const r = detectFlicker(serie(64, () => 0.236 + rnd() * 0.02), 30);
    expect(r.detected).toBe(false);
  });

  it('detecta o batimento de 10 Hz da rede de 50 Hz a 30 fps', () => {
    // 100 Hz de luz amostrados a 30 fps aliam para 10 Hz.
    const r = detectFlicker(serie(60, (i) => 0.25 + 0.02 * Math.sin(2 * Math.PI * 10 * i / 30)), 30);
    expect(r.detected).toBe(true);
    expect(r.dominantHz).toBeCloseTo(10, 0);
    expect(r.relativeAmplitude).toBeGreaterThan(0.05);
  });

  it('rede de 60 Hz a 30 fps é invisível — e o detector não inventa', () => {
    // 120 mod 30 = 0: a oscilação some no aliasing. O sinal amostrado é
    // constante, e é exatamente isso que o detector deve reportar.
    const r = detectFlicker(serie(60, (i) => 0.25 + 0.02 * Math.sin(2 * Math.PI * 120 * i / 30)), 30);
    expect(r.detected).toBe(false);
  });

  it('deriva lenta de luz (sala escurecendo) não vira cintilação', () => {
    // Sem remoção de tendência, uma rampa apareceria como componente de
    // frequência muito baixa e dispararia um alarme falso.
    const r = detectFlicker(serie(64, (i) => 0.40 - 0.002 * i), 30);
    expect(r.detected).toBe(false);
  });

  it('amplitude relativa escala com a profundidade da oscilação', () => {
    const fraca = detectFlicker(serie(60, (i) => 0.25 + 0.005 * Math.sin(2 * Math.PI * 10 * i / 30)), 30);
    const forte = detectFlicker(serie(60, (i) => 0.25 + 0.05 * Math.sin(2 * Math.PI * 10 * i / 30)), 30);
    expect(forte.relativeAmplitude).toBeGreaterThan(fraca.relativeAmplitude);
  });

  it('série toda zero não divide por zero', () => {
    const r = detectFlicker(serie(64, () => 0), 30);
    expect(Number.isFinite(r.relativeAmplitude)).toBe(true);
    expect(r.detected).toBe(false);
  });
});

describe('inferPowerLineHz', () => {
  it('batimento de 10 Hz a 30 fps aponta para rede de 50 Hz', () => {
    expect(inferPowerLineHz(10, 30)).toBe(50);
  });

  it('não atribui rede a um batimento que não casa com nenhuma', () => {
    // 4 Hz não corresponde nem a 50 nem a 60 Hz — é sombra, monitor, outra
    // coisa. Mudar a configuração da câmera não resolveria.
    expect(inferPowerLineHz(4, 30)).toBeNull();
  });

  it('entradas degeneradas devolvem null', () => {
    expect(inferPowerLineHz(0, 30)).toBeNull();
    expect(inferPowerLineHz(10, 0)).toBeNull();
  });

  it('a 60 fps, rede de 50 Hz alia para 20 Hz', () => {
    // 100 mod 60 = 40, dobrado em torno de Nyquist (30) → 20 Hz.
    expect(inferPowerLineHz(20, 60)).toBe(50);
  });
});

// ─── Regressão: fps derivado de série com buracos ──────────────────────────
//
// O engine só acrescenta brilho à série quando há rosto e não há piscada. Uma
// perda de rosto deixa um buraco, e derivar o fps do VÃO TOTAL dividido por
// N-1 subestima a taxa. Como o detector converte bin→Hz usando esse fps, o erro
// vira frequência errada, que vira REDE ELÉTRICA errada — o ajuste automático
// mandaria a câmera para 50 Hz quando era 60.
//
// A correção mora em `engine.ts` (mediana dos intervalos + descarte quando há
// buraco grande). Estes testes travam a CONSEQUÊNCIA: com o fps certo a rede é
// identificada, com o fps errado não.
describe('sensibilidade do veredito ao fps', () => {
  const serie10Hz = Array.from({ length: 60 }, (_, i) => 0.25 + 0.02 * Math.sin(2 * Math.PI * 10 * i / 30));

  it('com o fps correto, a rede de 50 Hz é identificada', () => {
    const r = detectFlicker(serie10Hz, 30);
    expect(inferPowerLineHz(r.dominantHz, 30)).toBe(50);
  });

  it('com fps subestimado por um buraco, o diagnóstico erra', () => {
    // 18 fps é o que o cálculo antigo daria para 96 amostras a 30 fps com uma
    // perda de rosto de ~2 s no meio.
    const r = detectFlicker(serie10Hz, 18);
    expect(inferPowerLineHz(r.dominantHz, 18)).not.toBe(50);
  });

  it('fps zero (série inutilizável) não produz veredito', () => {
    expect(detectFlicker(serie10Hz, 0).detected).toBe(false);
  });
});
