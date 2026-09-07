import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// O vigia de parada reagenda o quadro que o navegador não entregou. Quando o
// rAF está apenas ATRASADO (GC longo, aba voltando do segundo plano) e não
// morto, o agendamento original também acaba sendo entregue — e sem uma guarda
// o mesmo `collect` roda duas vezes, abrindo DUAS cadeias de coleta sobre o
// mesmo `pointIndex`. O sintoma no relatório é ponto duplicado em
// `diagnostics` e ponto pulado na tela.

vi.mock('./calibration', () => ({
  mapGaze: () => null,
  getCalibrationTargets: () => [],
  getCalibrationFitDiagnostics: () => null,
  getDistanceRange: () => null,
  getCalibrationDistancesCm: () => ({ cameraCm: null, screenCm: null }),
  getCurrentCameraDistanceCm: () => null,
  getCalibrationTimestampMs: () => null,
}));

const { startAccuracyTest } = await import('./accuracy');
const { COLLECTION_MS } = await import('./accuracyProtocol');
const { __testingPoints } = await import('./accuracy');

/** Callbacks de rAF pendentes, entregues só quando o teste mandar. */
let pendentes: FrameRequestCallback[] = [];
let relogio = 0;

function entregarQuadros() {
  const lote = pendentes;
  pendentes = [];
  for (const cb of lote) cb(relogio);
}

describe('vigia de parada: um quadro reagendado não roda duas vezes', () => {
  beforeEach(() => {
    pendentes = [];
    relogio = 0;
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pendentes.push(cb);
      return pendentes.length;
    });
    vi.stubGlobal('performance', { now: () => relogio });
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ saved: 'teste' }) }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('cada alvo aparece exatamente uma vez no relatório, mesmo com o quadro entregue em atraso', () => {
    startAccuracyTest();

    // 1,5 s de preparo até o primeiro alvo.
    relogio += 1500;
    vi.advanceTimersByTime(1500);
    expect(pendentes).toHaveLength(1);

    // O navegador engasga: 3,1 s sem entregar o quadro. O vigia (setInterval de
    // 1 s) percebe a parada e reagenda.
    relogio += 3100;
    vi.advanceTimersByTime(1000);
    expect(pendentes.length).toBeGreaterThan(1);

    // Agora o rAF volta e entrega OS DOIS: o original atrasado e o do vigia.
    entregarQuadros();

    // Toca o resto da rodada até o overlay final. Cada volta avança mais que
    // COLLECTION_MS, então um alvo fecha por entrega de quadro.
    for (let i = 0; i < 200 && !document.getElementById('diagnostic-overlay'); i++) {
      relogio += COLLECTION_MS + 100;
      vi.advanceTimersByTime(COLLECTION_MS + 400);
      entregarQuadros();
    }

    const cartoes = document.querySelectorAll('.diag-point-card');
    expect(cartoes.length).toBe(__testingPoints.ALL_VALIDATION_POINTS.length);

    const nomes = [...cartoes].map((c) => c.querySelector('.diag-point-name')?.textContent);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});
