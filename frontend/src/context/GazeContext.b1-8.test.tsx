import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// -----------------------------------------------------------------------------
// B1.8 — StrictMode abre a câmera duas vezes; a primeira MediaStream nunca é
//        parada.
//
// O guard anti-double-invoke não funciona porque o próprio cleanup zera o ref
// que ele testa:
//
//   if (engineRef.current) { ...return; }              // guarda
//   return () => { ...; engineRef.current = null; };   // cleanup
//
// Sequência real em StrictMode:
//   1. Mount → `boot()` cria o <video> e SUSPENDE em `await openCameraWithFallback()`.
//   2. Cleanup do StrictMode: `videoRef.current.srcObject` ainda é `null` (a
//      stream não chegou), então `stream?.getTracks().forEach(t => t.stop())`
//      NÃO PARA NADA.
//   3. Segundo mount: `engineRef.current` é `null` → engine #2 e um SEGUNDO
//      getUserMedia.
//   4. Quando o primeiro getUserMedia resolve, atribui a stream a um <video>
//      destacado, espera `loadeddata` e só então checa `if (cancelled) return`
//      — saindo SEM PARAR AS TRACKS.
//
// Consequências: LED da webcam aceso permanentemente, um decode de 1080p órfão
// consumindo CPU, e em vários drivers Windows a segunda captura falha com
// `NotReadableError` — que o código traduz como "OUTRO PROGRAMA está usando a
// câmera". O app fica sem rastreamento e culpa o Teams.
// -----------------------------------------------------------------------------

/** Track falso que registra se foi parado. */
class FakeTrack {
  stopped = false;
  kind = 'video';
  constructor(public label: string) {}
  stop() { this.stopped = true; }
  getCapabilities() { return {}; }
  getSettings() { return {}; }
  applyConstraints() { return Promise.resolve(); }
}

/** MediaStream falsa. */
class FakeStream {
  tracks: FakeTrack[];
  constructor(label: string) { this.tracks = [new FakeTrack(label)]; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks; }
}

/** Streams criadas por getUserMedia, na ordem. */
let streamsCriadas: FakeStream[] = [];
/** Resolvedores pendentes de getUserMedia — o teste decide quando cada um
 *  resolve, que é o que permite exercitar a janela do StrictMode. */
let resolvedoresGUM: Array<(s: FakeStream) => void> = [];

const engineInstances: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];

function novoEngineMock() {
  const inst = {
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    dispose: vi.fn(),
    subscribe: () => () => {},
    onStateChange: () => () => {},
    onL2CSStatusChange: () => () => {},
    getState: () => 'tracking',
    getSessionUptimeMs: () => 0,
    getDiagnostics: () => null,
    setFilterPreset: vi.fn(),
    calibration: {
      isCalibrated: () => false,
      onInvalidated: () => () => {},
      feedOnlineSample: vi.fn(() => false),
      setOnlineCalibrationEnabled: vi.fn(),
      setCameraFovDeg: vi.fn(),
      setEyeDominance: vi.fn(),
      abort: vi.fn(),
      clear: vi.fn(),
    },
    recording: { isActive: () => false, start: vi.fn(), stop: vi.fn(), clear: vi.fn() },
  };
  engineInstances.push(inst);
  return inst;
}

vi.mock('@tracker/tracker/engine', async (orig) => {
  const real = await orig<typeof import('@tracker/tracker/engine')>();
  return { ...real, createGazeEngine: () => novoEngineMock() };
});

vi.mock('./SettingsContext', () => ({
  useSettings: () => ({
    settings: { dwellSpeed: 'normal', filterPreset: 'balanceado-v2', eyeDominance: 'both' },
    updateSettings: vi.fn(),
  }),
}));

import { GazeProvider } from './GazeContext';

beforeEach(() => {
  streamsCriadas = [];
  resolvedoresGUM = [];
  engineInstances.length = 0;

  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => new Promise<FakeStream>((resolve) => {
        resolvedoresGUM.push((s) => resolve(s));
      })),
      enumerateDevices: vi.fn(async () => []),
    },
  });

  // jsdom não implementa play() nem loadeddata automaticamente.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(async () => {}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Resolve o i-ésimo getUserMedia pendente com uma stream nova e nomeada. */
async function resolverCamera(i: number, label: string) {
  const s = new FakeStream(label);
  streamsCriadas.push(s);
  await act(async () => {
    resolvedoresGUM[i](s);
    await Promise.resolve();
  });
  return s;
}

describe('B1.8 — a MediaStream nunca pode sobreviver ao cleanup', () => {
  it('desmontar ANTES do getUserMedia resolver ainda para a stream que chega depois', async () => {
    const { unmount } = render(
      <GazeProvider><div /></GazeProvider>,
    );

    // Estamos na janela: `boot()` suspendeu no await, nenhuma stream ainda.
    expect(resolvedoresGUM.length).toBeGreaterThanOrEqual(1);
    expect(streamsCriadas).toHaveLength(0);

    unmount();

    // A stream chega DEPOIS do cleanup. Antes da correção, `video.srcObject`
    // era null no momento do cleanup, então nada foi parado — e este caminho
    // saía por `if (cancelled) return` sem tocar nas tracks.
    const s = await resolverCamera(0, 'primeira');

    expect(s.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('toda stream aberta é parada, mesmo com dois mounts (StrictMode)', async () => {
    const Tree = () => (
      <React.StrictMode>
        <GazeProvider><div /></GazeProvider>
      </React.StrictMode>
    );
    const { unmount } = render(<Tree />);

    // Resolve tudo o que o StrictMode tiver disparado.
    for (let i = 0; i < resolvedoresGUM.length; i++) {
      await resolverCamera(i, `stream_${i}`);
    }

    unmount();
    // Deixa microtasks pendentes correrem (cleanups assíncronos).
    await act(async () => { await Promise.resolve(); });

    // O sintoma do bug é o LED aceso: alguma track ficou viva.
    const vivas = streamsCriadas.flatMap((s) => s.tracks).filter((t) => !t.stopped);
    expect(vivas).toHaveLength(0);
  });

  it('existe no máximo UM engine vivo por vez', async () => {
    const Tree = () => (
      <React.StrictMode>
        <GazeProvider><div /></GazeProvider>
      </React.StrictMode>
    );
    const { unmount } = render(<Tree />);
    for (let i = 0; i < resolvedoresGUM.length; i++) {
      await resolverCamera(i, `stream_${i}`);
    }

    // Todo engine criado a mais precisa ter sido parado/descartado — senão
    // dois loops rAF alimentam os mesmos singletons de calibração, duplicando
    // amostras na coleta e o `frameIdx` na telemetria.
    const vivos = engineInstances.filter(
      (e) => e.stop.mock.calls.length === 0 && e.dispose.mock.calls.length === 0,
    );
    expect(vivos.length).toBeLessThanOrEqual(1);

    unmount();
    await act(async () => { await Promise.resolve(); });

    const aindaVivos = engineInstances.filter(
      (e) => e.stop.mock.calls.length === 0 && e.dispose.mock.calls.length === 0,
    );
    expect(aindaVivos).toHaveLength(0);
  });

  it('o cleanup chama dispose(), não só stop()', async () => {
    // B1.7 criou `dispose()` para liberar o FaceLandmarker (heap WASM +
    // contexto GPU) e o worker L2CS de ~91 MB. Se o provider só chamar
    // `stop()`, esses recursos vazam por mount — que é o que B1.7 corrigiu no
    // engine e B1.8 precisa passar a usar de fato.
    const { unmount } = render(
      <GazeProvider><div /></GazeProvider>,
    );
    await resolverCamera(0, 'unica');
    unmount();
    await act(async () => { await Promise.resolve(); });

    expect(engineInstances.some((e) => e.dispose.mock.calls.length > 0)).toBe(true);
  });
});
