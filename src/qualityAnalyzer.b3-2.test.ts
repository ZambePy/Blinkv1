import { describe, it, expect } from 'vitest';
import { EyeQualityAnalyzer, blurFromVariance, BLUR_REFERENCE_AT_640x480 } from './qualityAnalyzer';
import type { Point3D } from './extractor';

// -----------------------------------------------------------------------------
// B3.2 — Landmarks degenerados produzem crop fora do canvas, e o resultado
//        parece medido.
//
// A bbox é montada com `minX = 1, maxX = 0` e reduzida pelos landmarks. Se os
// landmarks dos olhos estiverem ausentes ou degenerados, os valores iniciais
// SOBREVIVEM: `minX = 1.2, maxX = -0.2` depois do padding. `getImageData` fora
// do canvas não lança — devolve preto transparente.
//
// O guard `if (N === 0)` é **código morto**, porque `cropW`/`cropH` usam
// `Math.max(1, ...)`: N nunca é zero. O resultado é
// `{brightness: 0, contrast: 0, blur: 1, specular: 0}` — um estado
// fisicamente impossível (preto absoluto E sem reflexo E borrado) publicado
// como se fosse medição.
//
// B3.21 — `BLUR_REFERENCE_VARIANCE` é absoluto e calibrado para 640×480.
//
// A mesma cena a 1080p tem gradiente inter-pixel muito menor (a mesma borda
// física se espalha por mais pixels), então a variância do Laplaciano cai.
// Trocar uma webcam 480p por uma 1080p **aumenta** o `blurEstimate` e reprova
// frames nítidos. A métrica não é comparável entre setups — e é exatamente
// entre setups que o gate precisa decidir.
// -----------------------------------------------------------------------------

/** Landmarks válidos: uma caixa pequena e bem-formada em torno dos olhos. */
function landmarksValidos(): Point3D[] {
  const p: Point3D[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (i: number, x: number, y: number) => { p[i] = { x, y, z: 0 }; };
  set(33, 0.35, 0.45); set(133, 0.45, 0.45); set(159, 0.40, 0.42); set(145, 0.40, 0.48);
  set(362, 0.55, 0.45); set(263, 0.65, 0.45); set(386, 0.60, 0.42); set(374, 0.60, 0.48);
  return p;
}

/** Landmarks degenerados: os índices dos olhos não existem. A bbox mantém os
 *  valores iniciais e fica invertida. */
function landmarksDegenerados(): Point3D[] {
  const p = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })) as Point3D[];
  for (const i of [33, 133, 159, 145, 362, 263, 386, 374]) {
    (p as unknown as Array<Point3D | undefined>)[i] = undefined;
  }
  return p;
}

/** `<video>` falso com dimensões declaradas. */
function video(w = 1280, h = 720): HTMLVideoElement {
  return { videoWidth: w, videoHeight: h } as unknown as HTMLVideoElement;
}

describe('B3.2 — bbox degenerada não produz medição fabricada', () => {
  it('landmarks ausentes ⇒ só detectorConfidence, sem brilho/contraste/blur', () => {
    // O estado que o bug publicava: `brightness: 0` (preto absoluto) junto de
    // `blur: 1` e `specular: 0`. Fisicamente impossível, e passava nos
    // critérios do gate de calibração como se tivesse sido medido.
    const a = new EyeQualityAnalyzer();
    const r = a.analyze(video(), landmarksDegenerados());

    expect(r.brightnessEstimate).toBeUndefined();
    expect(r.contrastEstimate).toBeUndefined();
    expect(r.blurEstimate).toBeUndefined();
    expect(r.specularRatio).toBeUndefined();
  });

  it('bbox invertida (maxX < minX) é rejeitada', () => {
    // O guard `if (N === 0)` era código morto: `Math.max(1, ...)` garante
    // N ≥ 1 sempre. A validação precisa ser sobre a bbox, não sobre a área.
    const a = new EyeQualityAnalyzer();
    const p = landmarksValidos();
    // Inverte: todos os pontos do olho no mesmo lugar, com padding zero.
    for (const i of [33, 133, 159, 145, 362, 263, 386, 374]) {
      p[i] = { x: 0.5, y: 0.5, z: 0 };
    }
    const r = a.analyze(video(), p);
    expect(r.brightnessEstimate).toBeUndefined();
  });

  it('landmarks fora da faixa [0,1] são rejeitados', () => {
    // Um detector que devolve coordenadas absurdas não pode produzir um crop
    // "válido" por acidente do clamp.
    const a = new EyeQualityAnalyzer();
    const p = landmarksValidos();
    p[33] = { x: -5, y: -5, z: 0 };
    p[263] = { x: 9, y: 9, z: 0 };
    const r = a.analyze(video(), p);
    expect(r.brightnessEstimate).toBeUndefined();
  });

  it('detectorConfidence continua sendo reportado — ele FOI medido', () => {
    // Vem do deslocamento de landmarks entre quadros, não do crop. Suprimi-lo
    // junto seria descartar uma medição legítima.
    const a = new EyeQualityAnalyzer();
    a.analyze(video(), landmarksDegenerados());
    const r = a.analyze(video(), landmarksDegenerados());
    expect(typeof r.detectorConfidence).toBe('number');
  });
});

describe('B3.21 — o blur é normalizado por resolução', () => {
  it('a referência declarada é a de 640×480', () => {
    expect(BLUR_REFERENCE_AT_640x480).toBeGreaterThan(0);
  });

  it('a mesma cena física dá o MESMO blur em 480p e em 1080p', () => {
    // O coração de B3.21. A variância do Laplaciano escala com o quadrado do
    // gradiente inter-pixel, e esse gradiente cai proporcionalmente à
    // resolução — a mesma borda física se espalha por mais pixels.
    //
    // Aqui simulamos: a 1080p a variância medida é (640/1920)² da de 480p
    // para a mesma cena.
    const varA = 0.001;                       // cena nítida a 640×480
    const escala = (640 / 1920) ** 2;
    const varB = varA * escala;               // MESMA cena a 1920×1080

    const blurA = blurFromVariance(varA, 640, 480);
    const blurB = blurFromVariance(varB, 1920, 1080);

    expect(blurB).toBeCloseTo(blurA, 6);
  });

  it('sem normalização, 1080p reprovaria um frame nítido', () => {
    // Demonstra o tamanho do erro que o bug produzia: usando a referência de
    // 480p direto sobre a variância de 1080p, o frame nítido vira "borrado".
    const varA = 0.001;
    const varB = varA * (640 / 1920) ** 2;
    const semNormalizar = 1 - Math.min(1, varB / BLUR_REFERENCE_AT_640x480);
    expect(semNormalizar).toBeGreaterThan(0.85);   // "muito borrado" — falso
    expect(blurFromVariance(varB, 1920, 1080)).toBeLessThan(0.2); // nítido — certo
  });

  it('imagem de fato borrada continua sendo reprovada, em qualquer resolução', () => {
    // Regressão: normalizar não pode transformar tudo em "nítido".
    for (const [w, h] of [[640, 480], [1280, 720], [1920, 1080]] as const) {
      const varNitida = 0.001 * ((640 / w) ** 2);
      const varBorrada = varNitida * 0.01;
      expect(blurFromVariance(varBorrada, w, h)).toBeGreaterThan(0.9);
    }
  });

  it('o resultado fica sempre em [0,1]', () => {
    for (const v of [0, 1e-12, 0.001, 1, 1e6]) {
      const b = blurFromVariance(v, 1280, 720);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it('dimensões inválidas caem na referência de 640×480 sem lançar', () => {
    for (const [w, h] of [[0, 0], [-1, 100], [NaN, 480]] as const) {
      const b = blurFromVariance(0.001, w, h);
      expect(Number.isFinite(b)).toBe(true);
    }
  });
});
