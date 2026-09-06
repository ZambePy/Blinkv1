import { describe, it, expect } from 'vitest';
import { snapshotFromDiagnostics, type ViewportInfo } from './setupReadinessAdapter';
import { evaluateReadiness } from './setupReadiness';
import type { EngineDiagnostics } from './tracker/engine';

// Ponte entre `EngineDiagnostics` (formato do engine) e `ReadinessSnapshot`
// (formato de `evaluateReadiness`): sem ela a verificação de prontidão ao vivo
// — viewport, distância, iluminação, cintilação — nunca chega ao cuidador.

const VIEWPORT: ViewportInfo = {
  viewportWidth: 1920,
  viewportHeight: 1080,
  screenWidth: 1920,
  screenHeight: 1080,
};

function diagnostics(over: Partial<EngineDiagnostics> = {}): EngineDiagnostics {
  return {
    fpsRender: 30,
    l2cs: { status: 'ready', hz: 10, latencyMs: 90, stalePct: 0, confidence: 0.8, pendingCount: 0 },
    gaze: { yaw: 0.1, pitch: -0.05 },
    pose: { yaw: 0.02, pitch: -0.01, roll: 0.0 },
    features: { dims: 12, blink: false },
    prediction: { x: 960, y: 540 },
    calibration: { calibrated: true, lambda: 0.01, samples: 240 },
    experiment: { expandFactor: 1.4, cadenceMs: 100 },
    framing: {
      hasFace: true,
      iod: 0.12,
      faceCenter: { x: 0.5, y: 0.5 },
      specularRatio: 0.01,
      iodPx: 384,
    },
    quality: { brightness: 0.45, contrast: 0.2, blur: 0.1, detectorConfidence: 0.95 },
    video: { width: 1920, height: 1080 },
    brightnessHistory: [],
    brightnessHistoryFps: 30,
    stageLatency: {},
    loop: { errorsTotal: 0, errorsConsecutive: 0 },
    ...over,
  };
}

describe('a ponte entre o engine e a prontidão existe', () => {
  it('converte um diagnóstico completo em snapshot', () => {
    const s = snapshotFromDiagnostics(diagnostics(), VIEWPORT);
    expect(s).not.toBeNull();
    expect(s!.hasFace).toBe(true);
    expect(s!.iod).toBe(384);
    expect(s!.videoWidth).toBe(1920);
    expect(s!.brightness).toBeCloseTo(0.45, 6);
  });

  it('o snapshot alimenta `evaluateReadiness` sem adaptação extra', () => {
    // A saída do adaptador é aceita direto por `evaluateReadiness`.
    const s = snapshotFromDiagnostics(diagnostics(), VIEWPORT)!;
    const r = evaluateReadiness(s);
    expect(r.checks.length).toBeGreaterThan(0);
    expect(typeof r.canStart).toBe('boolean');
  });

  it('o viewport chega até a avaliação', () => {
    // A checagem de viewport é a única defesa contra o erro angular inflado
    // por rodar em janela não-maximizada. Se o campo não trafegar, a checagem
    // existe mas nunca dispara.
    const s = snapshotFromDiagnostics(diagnostics(), {
      ...VIEWPORT,
      viewportWidth: 1280,
      viewportHeight: 720,
    })!;
    expect(s.viewportWidth).toBe(1280);
    expect(s.screenWidth).toBe(1920);
  });

  it('janela pequena contra tela grande produz um check de viewport', () => {
    const s = snapshotFromDiagnostics(diagnostics(), {
      viewportWidth: 800,
      viewportHeight: 600,
      screenWidth: 1920,
      screenHeight: 1080,
    })!;
    const r = evaluateReadiness(s);
    const viewportCheck = r.checks.find((c) => c.id === 'viewport');
    expect(viewportCheck).toBeDefined();
    expect(viewportCheck!.status).not.toBe('ok');
  });

  it('janela maximizada não acusa problema de viewport', () => {
    const s = snapshotFromDiagnostics(diagnostics(), VIEWPORT)!;
    const r = evaluateReadiness(s);
    const viewportCheck = r.checks.find((c) => c.id === 'viewport');
    if (viewportCheck) expect(viewportCheck.status).toBe('ok');
  });
});

describe('qualidade não medida não vira veredito', () => {
  it('brightness undefined devolve null, não um snapshot com zeros', () => {
    // `undefined` é "não medido". Preencher com zero faria a tela de
    // prontidão reprovar a iluminação a partir de uma não-leitura.
    const s = snapshotFromDiagnostics(
      diagnostics({ quality: { contrast: 0.2, blur: 0.1, detectorConfidence: 0.95 } }),
      VIEWPORT,
    );
    expect(s).toBeNull();
  });

  it('contrast undefined também devolve null', () => {
    const s = snapshotFromDiagnostics(
      diagnostics({ quality: { brightness: 0.45, blur: 0.1, detectorConfidence: 0.95 } }),
      VIEWPORT,
    );
    expect(s).toBeNull();
  });

  it('vídeo sem dimensões devolve null', () => {
    // Antes do primeiro frame o `<video>` reporta 0×0. Avaliar prontidão aí
    // produziria `iodFraction = Infinity`.
    const s = snapshotFromDiagnostics(diagnostics({ video: { width: 0, height: 0 } }), VIEWPORT);
    expect(s).toBeNull();
  });

  it('sem rosto ainda produz snapshot — a ausência É o veredito', () => {
    // Diferente dos casos acima: aqui a medição aconteceu e o resultado é
    // "não há rosto". `evaluateReadiness` tem um check próprio para isso.
    const s = snapshotFromDiagnostics(
      diagnostics({ framing: { hasFace: false, iod: 0, faceCenter: { x: 0.5, y: 0.5 }, specularRatio: 0, iodPx: 0 } }),
      VIEWPORT,
    );
    expect(s).not.toBeNull();
    const r = evaluateReadiness(s!);
    expect(r.canStart).toBe(false);
    expect(r.checks.find((c) => c.id === 'face')!.status).toBe('fail');
  });
});
