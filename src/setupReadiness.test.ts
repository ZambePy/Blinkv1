import { describe, it, expect } from 'vitest';
import {
  evaluateReadiness,
  estimateDistanceCm,
  aggregateSnapshots,
  CANTHAL_DISTANCE_CM,
  idealDistanceCm,
  effectiveViewingDistanceCm,
  TARGET_IOD_FRACTION,
  type ReadinessSnapshot,
  type CheckId,
} from './setupReadiness';

/** Posto de uso bom: rosto grande, centrado, de frente, bem iluminado. */
function goodSnapshot(over: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    hasFace: true,
    iod: 340,               // 340/1920 = 0,177 → dentro da faixa boa
    videoWidth: 1920,
    videoHeight: 1080,
    faceCenter: { x: 0.5, y: 0.5 },
    pose: { yaw: 0.01, pitch: -0.02, roll: 0.005 },
    brightness: 0.45,
    contrast: 0.20,
    detectorConfidence: 0.99,
    specularRatio: 0.0,
    ...over,
  };
}

const statusOf = (snap: ReadinessSnapshot, id: CheckId, fov?: number | null) =>
  evaluateReadiness(snap, { horizontalFovDeg: fov }).checks.find((c) => c.id === id)?.status;

describe('evaluateReadiness — posto de uso ideal', () => {
  it('não acusa nada e libera o início', () => {
    const r = evaluateReadiness(goodSnapshot());
    expect(r.checks.every((c) => c.status === 'ok')).toBe(true);
    expect(r.canStart).toBe(true);
    expect(r.blockedHard).toBe(false);
  });
});

describe('evaluateReadiness — o posto de uso que produziu 115 px', () => {
  // Reproduz as condições medidas em fixtures/replay/ci-baseline.jsonl, a
  // gravação cujo teste de precisão deu 115 px. O objetivo do módulo é
  // justamente NÃO aprovar em silêncio um setup como esse.
  const medido = goodSnapshot({
    iod: 127, videoWidth: 1280, videoHeight: 720,   // iodFraction = 0,099
    brightness: 0.236,
    contrast: 0.094,
    pose: { yaw: 0.083, pitch: -0.033, roll: -0.027 },
  });

  it('acusa rosto pequeno demais no frame', () => {
    expect(statusOf(medido, 'distance')).toBe('warn');
  });

  it('acusa rosto subexposto', () => {
    expect(statusOf(medido, 'lighting')).toBe('warn');
  });

  it('acusa contraste baixo', () => {
    expect(statusOf(medido, 'contrast')).toBe('warn');
  });

  it('acusa câmera abaixo de Full HD', () => {
    expect(statusOf(medido, 'resolution')).toBe('warn');
  });

  it('avisa sem bloquear — a calibração ainda é possível, só pior', () => {
    const r = evaluateReadiness(medido);
    expect(r.blockedHard).toBe(false);
    expect(r.checks.some((c) => c.status === 'warn')).toBe(true);
  });
});

describe('evaluateReadiness — bloqueios reais', () => {
  it('sem rosto bloqueia de verdade', () => {
    const r = evaluateReadiness(goodSnapshot({ hasFace: false }));
    expect(r.canStart).toBe(false);
    expect(r.blockedHard).toBe(true);
  });

  it('sem rosto não emite checagens que dependem do rosto', () => {
    const r = evaluateReadiness(goodSnapshot({ hasFace: false }));
    const ids = r.checks.map((c) => c.id);
    expect(ids).not.toContain('lighting');
    expect(ids).not.toContain('headPose');
  });

  it('resolução inviável bloqueia', () => {
    const r = evaluateReadiness(goodSnapshot({ videoWidth: 640, videoHeight: 480 }));
    expect(statusOf(goodSnapshot({ videoWidth: 640, videoHeight: 480 }), 'resolution')).toBe('fail');
    expect(r.blockedHard).toBe(true);
  });

  it('escuridão total falha, mas não bloqueia de forma dura', () => {
    const s = goodSnapshot({ brightness: 0.04 });
    expect(statusOf(s, 'lighting')).toBe('fail');
    const r = evaluateReadiness(s);
    expect(r.canStart).toBe(false);
    expect(r.blockedHard).toBe(false);  // regra 2: a UI não prende o usuário
  });
});

describe('evaluateReadiness — pose da cabeça', () => {
  it('cabeça girada 15° falha', () => {
    expect(statusOf(goodSnapshot({ pose: { yaw: 0.3, pitch: 0, roll: 0 } }), 'headPose')).toBe('fail');
  });

  it('cabeça girada ~8° apenas avisa', () => {
    expect(statusOf(goodSnapshot({ pose: { yaw: 0.14, pitch: 0, roll: 0 } }), 'headPose')).toBe('warn');
  });

  it('inclinação lateral (roll) conta junto com yaw/pitch', () => {
    expect(statusOf(goodSnapshot({ pose: { yaw: 0, pitch: 0, roll: 0.25 } }), 'headPose')).toBe('fail');
  });

  it('o pitch de +0,138 rad da segunda gravação é acusado', () => {
    // As duas gravações reais diferiam 9° em pitch. Essa diferença sozinha é
    // maior que boa parte do erro que o pipeline tenta corrigir.
    expect(statusOf(goodSnapshot({ pose: { yaw: 0.014, pitch: 0.138, roll: -0.006 } }), 'headPose')).toBe('warn');
  });
});

describe('evaluateReadiness — enquadramento e reflexo', () => {
  it('rosto deslocado para a borda falha', () => {
    expect(statusOf(goodSnapshot({ faceCenter: { x: 0.8, y: 0.5 } }), 'centering')).toBe('fail');
  });

  it('reflexo acima do limiar de óculos vira aviso', () => {
    const s = goodSnapshot({ specularRatio: 0.05 });
    expect(statusOf(s, 'glasses')).toBe('warn');
    expect(evaluateReadiness(s).measured.glassesLikely).toBe(true);
  });

  it('rosto grande demais avisa (risco de sair do frame)', () => {
    expect(statusOf(goodSnapshot({ iod: 700 }), 'distance')).toBe('warn');
  });
});

describe('estimateDistanceCm', () => {
  it('sem campo de visão devolve null em vez de inventar', () => {
    expect(estimateDistanceCm(127, 1280, null)).toBeNull();
    expect(estimateDistanceCm(127, 1280, undefined)).toBeNull();
  });

  it('recupera a distância de uma geometria construída à mão', () => {
    // Monta o caso inverso: a 50 cm com FOV horizontal de 80°, a cena tem
    // 2·50·tan(40°) = 83,9 cm de largura. O rosto (9 cm entre cantos) ocupa
    // 9/83,9 do frame.
    const d = 50, fov = 80;
    const frameCm = 2 * d * Math.tan((fov / 2) * (Math.PI / 180));
    const videoWidth = 1280;
    const iod = (CANTHAL_DISTANCE_CM / frameCm) * videoWidth;
    expect(estimateDistanceCm(iod, videoWidth, fov)).toBeCloseTo(d, 6);
  });

  it('rejeita entradas degeneradas', () => {
    expect(estimateDistanceCm(0, 1280, 90)).toBeNull();
    expect(estimateDistanceCm(127, 0, 90)).toBeNull();
    expect(estimateDistanceCm(127, 1280, 180)).toBeNull();
    expect(estimateDistanceCm(127, 1280, 0)).toBeNull();
  });

  it('estimativa cai quando o rosto cresce no frame (mais perto)', () => {
    const perto = estimateDistanceCm(300, 1280, 90)!;
    const longe = estimateDistanceCm(127, 1280, 90)!;
    expect(perto).toBeLessThan(longe);
  });
});

describe('aggregateSnapshots', () => {
  it('devolve null sem frames', () => {
    expect(aggregateSnapshots([])).toBeNull();
  });

  it('usa mediana, então um frame espúrio não move o veredito', () => {
    const bons = Array.from({ length: 9 }, () => goodSnapshot());
    const comOutlier = [...bons, goodSnapshot({ brightness: 0.99, iod: 20 })];
    const agg = aggregateSnapshots(comOutlier)!;
    expect(agg.brightness).toBeCloseTo(0.45, 6);
    expect(agg.iod).toBeCloseTo(340, 6);
  });

  it('um único frame sem rosto derruba hasFace do agregado', () => {
    const frames = [goodSnapshot(), goodSnapshot({ hasFace: false }), goodSnapshot()];
    expect(aggregateSnapshots(frames)!.hasFace).toBe(false);
  });

  it('resolução vem do frame mais recente, não da mediana', () => {
    // A resolução não é uma grandeza para tirar mediana: ela muda em degrau
    // quando a câmera renegocia, e o valor corrente é o que vale.
    const frames = [
      goodSnapshot({ videoWidth: 1280, videoHeight: 720 }),
      goodSnapshot({ videoWidth: 1920, videoHeight: 1080 }),
    ];
    expect(aggregateSnapshots(frames)!.videoWidth).toBe(1920);
  });
});

// ─── Itens que faltavam do pedido original ─────────────────────────────────

describe('idealDistanceCm — "onde eu me sento?"', () => {
  it('sem campo de visão não inventa alvo', () => {
    expect(idealDistanceCm(null)).toBeNull();
    expect(idealDistanceCm(undefined)).toBeNull();
  });

  it('campo de visão maior exige sentar mais perto para o mesmo tamanho de rosto', () => {
    // É a razão de a webcam de 90° render pouco pixel no olho: quanto mais
    // aberta a lente, mais perto é preciso estar para o rosto ocupar o frame.
    const largo = idealDistanceCm(90)!;
    const estreito = idealDistanceCm(50)!;
    expect(largo).toBeLessThan(estreito);
  });

  it('é o inverso de estimateDistanceCm no ponto-alvo', () => {
    const fov = 78;
    const d = idealDistanceCm(fov)!;
    const videoWidth = 1920;
    // Na distância ideal, o rosto deve medir exatamente TARGET_IOD_FRACTION.
    const frameCm = 2 * d * Math.tan((fov / 2) * (Math.PI / 180));
    const iod = (CANTHAL_DISTANCE_CM / frameCm) * videoWidth;
    expect(iod / videoWidth).toBeCloseTo(TARGET_IOD_FRACTION, 6);
  });

  it('a mensagem de distância cita o alvo quando o FOV é conhecido', () => {
    const s = goodSnapshot({ iod: 127, videoWidth: 1280 });
    const semFov = evaluateReadiness(s).checks.find((c) => c.id === 'distance')!;
    const comFov = evaluateReadiness(s, { horizontalFovDeg: 90 }).checks.find((c) => c.id === 'distance')!;
    expect(semFov.message).not.toMatch(/Posicione a câmera/);
    expect(comFov.message).toMatch(/Posicione a câmera a ~\d+ cm/);
  });
});

describe('checagem de cintilação', () => {
  it('sem dado de cintilação o item nem aparece', () => {
    const ids = evaluateReadiness(goodSnapshot()).checks.map((c) => c.id);
    expect(ids).not.toContain('flicker');
  });

  it('cintilação detectada vira aviso e cita a frequência', () => {
    const r = evaluateReadiness(goodSnapshot(), {
      flicker: { detected: true, dominantHz: 10, relativeAmplitude: 0.06 },
      powerLineHz: 50,
    });
    const c = r.checks.find((x) => x.id === 'flicker')!;
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/10\.0 Hz/);
    expect(c.message).toMatch(/50 Hz/);
  });

  it('sem cintilação o item passa', () => {
    const r = evaluateReadiness(goodSnapshot(), {
      flicker: { detected: false, dominantHz: 0, relativeAmplitude: 0.005 },
    });
    expect(r.checks.find((x) => x.id === 'flicker')!.status).toBe('ok');
  });
});

describe('checagem de tela cheia', () => {
  it('sem dados de viewport o item nem aparece', () => {
    const ids = evaluateReadiness(goodSnapshot()).checks.map((c) => c.id);
    expect(ids).not.toContain('viewport');
  });

  it('janela em tela cheia passa', () => {
    const s = goodSnapshot({ viewportWidth: 1920, viewportHeight: 1080, screenWidth: 1920, screenHeight: 1080 });
    expect(statusOf(s, 'viewport')).toBe('ok');
  });

  it('janela menor que a tela avisa — a conversão px→cm depende disso', () => {
    const s = goodSnapshot({ viewportWidth: 1280, viewportHeight: 800, screenWidth: 1920, screenHeight: 1080 });
    const c = evaluateReadiness(s).checks.find((x) => x.id === 'viewport')!;
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/tela cheia/);
  });
});

describe('reflexo — persistência distingue lente de brilho passageiro', () => {
  it('reflexo em poucos frames NÃO acusa óculos', () => {
    const s = goodSnapshot({ specularRatio: 0.05, specularPersistence: 0.10 });
    expect(statusOf(s, 'glasses')).toBe('ok');
    expect(evaluateReadiness(s).measured.glassesLikely).toBe(false);
  });

  it('reflexo na maioria dos frames acusa lente', () => {
    const s = goodSnapshot({ specularRatio: 0.05, specularPersistence: 0.65 });
    const c = evaluateReadiness(s).checks.find((x) => x.id === 'glasses')!;
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/65% dos frames/);
  });

  it('a agregação calcula a persistência por contagem, não por mediana', () => {
    // 3 de 10 frames com reflexo: a mediana daria 0 e esconderia o problema.
    const frames = [
      ...Array.from({ length: 7 }, () => goodSnapshot({ specularRatio: 0 })),
      ...Array.from({ length: 3 }, () => goodSnapshot({ specularRatio: 0.08 })),
    ];
    const agg = aggregateSnapshots(frames)!;
    expect(agg.specularRatio).toBe(0);
    expect(agg.specularPersistence).toBeCloseTo(0.3, 6);
  });

  it('a agregação propaga viewport e tela do frame mais recente', () => {
    const frames = [
      goodSnapshot(),
      goodSnapshot({ viewportWidth: 1920, viewportHeight: 1080, screenWidth: 1920, screenHeight: 1080 }),
    ];
    const agg = aggregateSnapshots(frames)!;
    expect(agg.viewportWidth).toBe(1920);
    expect(agg.screenHeight).toBe(1080);
  });
});

describe('effectiveViewingDistanceCm — a medição realimenta o pipeline', () => {
  it('sem medição usa o valor configurado', () => {
    expect(effectiveViewingDistanceCm(null, 60)).toEqual({ cm: 60, source: 'configured' });
    expect(effectiveViewingDistanceCm(undefined, 60)).toEqual({ cm: 60, source: 'configured' });
  });

  it('com medição plausível, a medição vence a digitação', () => {
    const r = effectiveViewingDistanceCm(47, 60);
    expect(r.cm).toBe(47);
    expect(r.source).toBe('measured');
  });

  it('medição absurda é descartada COM motivo, não silenciosamente', () => {
    // Campo de visão mal calibrado produz estimativas sem sentido; usá-las
    // moveria a grade de calibração para o lugar errado.
    const r = effectiveViewingDistanceCm(400, 60);
    expect(r.cm).toBe(60);
    expect(r.source).toBe('configured');
    expect(r.rejectedReason).toMatch(/fora da faixa plausível/);
  });

  it('rejeita distância perto demais para um posto de uso', () => {
    expect(effectiveViewingDistanceCm(5, 60).source).toBe('configured');
  });

  it('NaN não passa como número', () => {
    expect(effectiveViewingDistanceCm(NaN, 60).source).toBe('configured');
  });

  it('as bordas da faixa plausível são aceitas', () => {
    expect(effectiveViewingDistanceCm(25, 60).source).toBe('measured');
    expect(effectiveViewingDistanceCm(130, 60).source).toBe('measured');
  });
});
