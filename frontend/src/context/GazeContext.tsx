import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { createGazeEngine } from '@tracker/tracker/engine';
import type { GazeEngine, GazeSample, EngineState, CalibrationApi } from '@tracker/tracker/engine';
import { useSettings } from './SettingsContext';

export type { GazeSample, EngineState } from '@tracker/tracker/engine';

// Dwell time by user preset (matches DwellButton's own table).
const DWELL_MS_BY_SPEED: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 2500,
  normal: 1500,
  fast: 800,
};
// After firing, ignore gaze for REFRACTORY_MS to prevent double-fire on the same
// target while the user's eye is still on it.
const REFRACTORY_MS = 800;
// Selector for elements the global dispatcher treats as clickable. Add
// data-no-dwell="true" on any element that should opt out.
const DWELL_SELECTOR = 'button, a, [role="button"], [role="link"]';

interface GazeContextValue {
  subscribe: (cb: (sample: GazeSample) => void) => () => void;
  state: EngineState;
  calibration: CalibrationApi;
}

const GazeContext = createContext<GazeContextValue | null>(null);

export const useGaze = (): GazeContextValue => {
  const ctx = useContext(GazeContext);
  if (!ctx) throw new Error('useGaze must be used inside <GazeProvider>');
  return ctx;
};

export const GazeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { settings } = useSettings();
  const engineRef = useRef<GazeEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<EngineState>('idle');

  // Sub pool: subscribers can hook in and receive callbacks. We keep the callback
  // model instead of React state to avoid re-rendering the tree at 30 Hz.
  const subscribersRef = useRef<Set<(s: GazeSample) => void>>(new Set());

  // Global dwell dispatcher state. Kept in refs to avoid re-renders — the loop
  // runs at 30 Hz and reads/writes these directly from the gaze callback.
  const dwellMsRef = useRef<number>(DWELL_MS_BY_SPEED[settings.dwellSpeed]);
  const dwellTargetRef = useRef<HTMLElement | null>(null);
  const dwellStartMsRef = useRef<number>(0);
  const refractoryUntilRef = useRef<number>(0);

  useEffect(() => {
    dwellMsRef.current = DWELL_MS_BY_SPEED[settings.dwellSpeed];
  }, [settings.dwellSpeed]);

  const subscribe = useCallback((cb: (s: GazeSample) => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  useEffect(() => {
    // React StrictMode em dev roda useEffect duas vezes (mount → cleanup → mount).
    // getUserMedia + FaceLandmarker são caros e mantêm estado global (module-scope
    // da calibração), então travamos a segunda inicialização. Em produção o guard
    // é inofensivo — StrictMode não faz double-invoke fora de dev.
    if (engineRef.current) {
      console.log('[IrisFlow] GazeProvider effect ignorado — engine já existe.');
      return;
    }

    let cancelled = false;

    const engine = createGazeEngine();
    engineRef.current = engine;

    // Cursor DOM node — direct writes via ref, no React state.
    // transform-origin: center lets scale() grow around the cursor's centre
    // (used by the dwell dispatcher for visual feedback) without breaking
    // the translate3d positioning.
    const cursor = document.createElement('div');
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:48px',
      'height:48px',
      'border-radius:50%',
      'background:rgba(239,68,68,0.6)',
      'box-shadow:0 0 16px rgba(255,0,0,0.9)',
      'pointer-events:none',
      'z-index:9999',
      'transform:translate3d(-9999px,-9999px,0)',
      'transform-origin:center center',
      'will-change:transform, background',
      'transition:opacity 600ms ease 300ms, background 120ms ease',
      'opacity:0',
    ].join(';');
    document.body.appendChild(cursor);
    cursorRef.current = cursor;

    const unsubState = engine.onStateChange((s) => {
      if (!cancelled) setState(s);
    });

    let cbInvocations = 0;
    const unsubGaze = engine.subscribe((sample) => {
      const now = performance.now();

      // ── Global dwell dispatcher ───────────────────────────────────────────
      // Finds the topmost clickable under the gaze via elementFromPoint (the
      // cursor itself is pointer-events:none, so it doesn't occlude). If the
      // gaze stays on the same target for dwellMs, fires a real .click() —
      // React's synthetic click handlers respond just like a mouse click.
      let dwellPct = 0;
      let hitTarget: HTMLElement | null = null;
      // Dwell dispatcher is entirely disabled during calibration — we don't want
      // accidental gaze clicks on calibration UI elements.
      const engineIsCalibrating = engineRef.current?.getState() === 'calibrating';
      if (!engineIsCalibrating && sample.hasFace && now >= refractoryUntilRef.current) {
        const el = document.elementFromPoint(sample.x, sample.y);
        const t = el?.closest(DWELL_SELECTOR) as HTMLElement | null;
        const isDisabled =
          !!t &&
          ((t as HTMLButtonElement).disabled ||
            t.getAttribute('aria-disabled') === 'true' ||
            t.dataset.noDwell === 'true');
        if (t && !isDisabled) {
          hitTarget = t;
          if (t !== dwellTargetRef.current) {
            if (dwellTargetRef.current) {
              dwellTargetRef.current.classList.remove('gaze-hover');
            }
            dwellTargetRef.current = t;
            dwellStartMsRef.current = now;
            t.classList.add('gaze-hover');
          } else {
            const elapsed = now - dwellStartMsRef.current;
            dwellPct = Math.min(1, elapsed / dwellMsRef.current);
            if (elapsed >= dwellMsRef.current) {
              t.click();
              t.classList.remove('gaze-hover');
              refractoryUntilRef.current = now + REFRACTORY_MS;
              dwellTargetRef.current = null;
              dwellStartMsRef.current = 0;
              dwellPct = 0;
              hitTarget = null;
            }
          }
        } else {
          if (dwellTargetRef.current) {
            dwellTargetRef.current.classList.remove('gaze-hover');
          }
          dwellTargetRef.current = null;
          dwellStartMsRef.current = 0;
        }
      } else if (!sample.hasFace) {
        // Face lost — freeze dwell, reset target so re-entry restarts fresh.
        if (dwellTargetRef.current) {
          dwellTargetRef.current.classList.remove('gaze-hover');
        }
        dwellTargetRef.current = null;
        dwellStartMsRef.current = 0;
      }

      // Move cursor via transform (no layout / no React re-render).
      // Visual feedback: green + growing while dwell fills; red otherwise.
      // The cursor is completely hidden during calibration to avoid distracting
      // the user while they are fixating on calibration targets.
      if (cursorRef.current) {
        const isInCalibration = engineRef.current?.getState() === 'calibrating';
        const isCalibrated = engineRef.current?.calibration.isCalibrated() ?? false;
        
        if (isInCalibration || !isCalibrated) {
          // Hard-hide: move offscreen + opacity 0
          cursorRef.current.style.transform = 'translate3d(-9999px,-9999px,0)';
          cursorRef.current.style.opacity = '0';
        } else {
          const scale = hitTarget ? 1 + dwellPct * 0.3 : 1;
          cursorRef.current.style.transform =
            `translate3d(${sample.x - 24}px, ${sample.y - 24}px, 0) scale(${scale})`;
          cursorRef.current.style.opacity = sample.hasFace ? '1' : '0.35';
          cursorRef.current.style.background = hitTarget
            ? `rgba(34,197,94,${(0.5 + dwellPct * 0.4).toFixed(2)})`
            : 'rgba(239,68,68,0.6)';
        }
      } else if (cbInvocations === 0) {
        console.warn('[IrisFlow] gaze subscribe callback disparou mas cursorRef.current é null');
      }
      if (cbInvocations === 0 || cbInvocations === 30) {
        console.log(
          `[IrisFlow] gaze callback #${cbInvocations} — x=${sample.x.toFixed(0)} y=${sample.y.toFixed(0)} hasFace=${sample.hasFace} cursor=${!!cursorRef.current}`,
        );
      }
      cbInvocations++;
      // Fan out to subscribers.
      subscribersRef.current.forEach((cb) => {
        try {
          cb(sample);
        } catch (e) {
          console.error('[GazeContext] subscriber threw', e);
        }
      });
    });

    async function boot() {
      // Video capture is owned by the provider (single source of truth).
      // Mantém o elemento visível (canto, opacidade ~0) para o Chromium não
      // suspender o pipeline de decoding — vídeos totalmente offscreen podem
      // ficar com `currentTime` congelado e travar o loop rAF do rastreador.
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.setAttribute('playsinline', 'true');
      video.style.cssText = [
        'position:fixed',
        'right:0',
        'bottom:0',
        'width:2px',
        'height:2px',
        'opacity:0.01',
        'pointer-events:none',
        'z-index:0',
      ].join(';');
      document.body.appendChild(video);
      videoRef.current = video;

      try {
        console.log('[IrisFlow] solicitando getUserMedia...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
        });
        video.srcObject = stream;
        console.log('[IrisFlow] stream obtido, aguardando loadeddata...');
        await new Promise<void>((resolve) => {
          video.addEventListener('loadeddata', () => resolve(), { once: true });
        });
        // Alguns browsers em Electron não iniciam o playback sozinhos mesmo com
        // muted+autoplay quando o elemento é adicionado dinamicamente. Force.
        try {
          await video.play();
        } catch (e) {
          console.warn('[IrisFlow] video.play() falhou:', e);
        }
        console.log(
          `[IrisFlow] loadeddata OK — video ${video.videoWidth}x${video.videoHeight}, paused=${video.paused}, currentTime=${video.currentTime}`,
        );
        if (cancelled) return;
        await engine.start(video);
        console.log('[IrisFlow] engine.start() concluído; loop rAF em execução.');
      } catch (err) {
        console.error('[IrisFlow] Falha ao inicializar câmera/engine:', err);
      }
    }

    boot();

    return () => {
      cancelled = true;
      unsubState();
      unsubGaze();
      engine.stop();
      engineRef.current = null;

      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      videoRef.current?.remove();
      videoRef.current = null;

      cursorRef.current?.remove();
      cursorRef.current = null;
    };
  }, []);

  // calibration must have STABLE identity across renders — consumers put it in
  // useEffect deps and any change here would fire their cleanup mid-flow.
  // The functions read engineRef.current lazily, so the ref stays fresh even
  // though the object identity never changes.
  const calibration = useMemo<CalibrationApi>(
    () => ({
      startCalibrationMode: () => engineRef.current?.calibration.startCalibrationMode(),
      startCollectingPoint: (x, y, onDone) => engineRef.current?.calibration.startCollectingPoint(x, y, onDone),
      completeCalibration: (onComplete) => engineRef.current?.calibration.completeCalibration(onComplete),
      clear: () => engineRef.current?.calibration.clear(),
      isCalibrated: () => engineRef.current?.calibration.isCalibrated() ?? false,
    }),
    [],
  );

  const value = useMemo<GazeContextValue>(
    () => ({ subscribe, state, calibration }),
    [subscribe, state, calibration],
  );

  return <GazeContext.Provider value={value}>{children}</GazeContext.Provider>;
};
