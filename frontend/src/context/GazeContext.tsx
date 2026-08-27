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
import type { GazeEngine, GazeSample, EngineState, CalibrationApi, L2CSStatus, RecordingApi, EngineDiagnostics } from '@tracker/tracker/engine';
import type { FilterPreset, FilterPresetV2 } from '@tracker/oneEuroFilter';
import { EXPERIMENT } from '@tracker/config/experiment';
import {
  planTuningStep, planStabilizationStep,
  type CameraCapabilities, type CameraState, type TuningStep,
} from '@tracker/cameraTuner';
import { detectFlicker, inferPowerLineHz } from '@tracker/flickerDetector';
import { useSettings } from './SettingsContext';


export type { GazeEngine, GazeSample, EngineState, L2CSStatus, RecordingApi, EngineDiagnostics } from '@tracker/tracker/engine';

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

// A1-4 — em estado 'degraded' o cursor está sobre o nariz (fallback do
// engine), não sobre o olhar. Permitir dwell nesse estado dispara cliques
// aleatórios na tela do paciente — em software de saúde isso é falha crítica
// (mensagem errada enviada ao cuidador). O dwell é bloqueado, EXCETO em
// elementos marcados com data-emergency="true": para o botão de emergência
// vale mais um falso positivo ocasional que um pedido de socorro impossível
// (plano A1-4, "exceção obrigatória"). Dwell nesses elementos usa um tempo
// mais longo (EMERGENCY_DEGRADED_MULT) para reduzir o risco de falso positivo.
const EMERGENCY_DEGRADED_MULT = 1.8;

interface GazeContextValue {
  subscribe: (cb: (sample: GazeSample) => void) => () => void;
  state: EngineState;
  // Estado do worker L2CS. UI de calibração deve bloquear enquanto != 'ready'
  // porque treinar o Ridge com o bloco angular zerado gera modelo
  // dessincronizado quando o worker liga (§ L2CS-TESTE-PASSOS.txt Fase 2).
  l2csStatus: L2CSStatus;
  calibration: CalibrationApi;
  // Fase 0.1 — API do gravador de sessão. Estado é lido via polling em
  // getStats (recorder é singleton de módulo); a UI que consome pode
  // querer um setInterval de ~500 ms enquanto ativo pra atualizar o
  // contador de frames.
  recording: RecordingApi;
  setFilterPreset: (preset: FilterPreset | FilterPresetV2) => void;
  getDiagnostics: () => EngineDiagnostics | null;
  /** Etapa 2 — stream da webcam, para a tela de pré-calibração mostrar o
   *  usuário a si mesmo. O `<video>` do engine fica com 2px e opacidade 0.01
   *  (não pode ser display:none, senão o browser suspende o decoding), então a
   *  UI que quer exibir precisa criar o próprio elemento e apontar para o
   *  MESMO `srcObject` — não abrir uma segunda captura, que muitos drivers
   *  recusam e que dobraria o custo de decode. */
  getCameraStream: () => MediaStream | null;
  /** Etapa 1 — resultado do ajuste automático da câmera. `null` enquanto
   *  não rodou. Consumido pela pré-calibração para dizer ao cuidador o que
   *  o software já resolveu e o que ainda exige ação física. */
  getCameraTuning: () => TuningStep | null;
  // D2 — tempo em ms desde o start bem-sucedido do engine. 0 antes do start.
  // Consumido pelo AUTO_TEST_META do fluxo pós-calibração para preencher
  // `RunMeta.minutosDeSessao` em vez de hardcode 0.
  getSessionUptimeMs: () => number;
  isDwelling: boolean;
  isComposing: boolean;
  setIsComposing: (val: boolean) => void;
  isDegraded: boolean;
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
  const [l2csStatus, setL2csStatus] = useState<L2CSStatus>('loading');
  const [isDwelling, setIsDwelling] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isDegraded, setIsDegraded] = useState(false);
  const isDegradedRef = useRef(false);
  const wasDwellingRef = useRef(false);

  // Sub pool: subscribers can hook in and receive callbacks. We keep the callback
  // model instead of React state to avoid re-rendering the tree at 30 Hz.
  const subscribersRef = useRef<Set<(s: GazeSample) => void>>(new Set());
  // Etapa 1 — último veredito do ajuste automático da câmera.
  const cameraTuningRef = useRef<TuningStep | null>(null);
  // Item 4 — estado da câmera antes de qualquer ajuste nosso.
  const originalCameraSettingsRef = useRef<Record<string, number | string> | null>(null);

  // Global dwell dispatcher state. Kept in refs to avoid re-renders — the loop
  // runs at 30 Hz and reads/writes these directly from the gaze callback.
  const dwellMsRef = useRef<number>(DWELL_MS_BY_SPEED[settings.dwellSpeed]);
  const dwellTargetRef = useRef<HTMLElement | null>(null);
  const dwellStartMsRef = useRef<number>(0);
  const refractoryUntilRef = useRef<number>(0);
  const lastDwellTargetRef = useRef<HTMLElement | null>(null);
  const exitTimeMsRef = useRef<number>(0);
  const frozenDwellProgressRef = useRef<number>(0);

  useEffect(() => {
    dwellMsRef.current = DWELL_MS_BY_SPEED[settings.dwellSpeed];
  }, [settings.dwellSpeed]);

  // Propaga a dominância ocular do usuário ao pipeline. Feito num useEffect
  // separado para reagir a mudanças em tempo real (SettingsScreen troca
  // sem recarregar). Se o engine ainda não montou, fica pendente até o
  // primeiro chamado — o próprio calibration guarda o valor em módulo.
  useEffect(() => {
    engineRef.current?.calibration.setEyeDominance?.(settings.eyeDominance);
  }, [settings.eyeDominance]);

  const subscribe = useCallback((cb: (s: GazeSample) => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  /**
   * Etapa 1 — ajuste automático da câmera em malha fechada.
   *
   * O pipeline já mede o tamanho do rosto no frame a cada quadro. Em vez de
   * pedir ao cuidador que configure zoom e brilho no painel do Windows — onde
   * ele não sabe qual valor serve, e o valor certo muda com a distância em que
   * o paciente sentou hoje — o programa mede, ajusta, mede de novo.
   *
   * O que decide está em `@tracker/cameraTuner` (puro e testado). Aqui só
   * ficam os efeitos: ler capabilities, aplicar constraints, esperar o driver
   * assentar. `applyConstraints` pode rejeitar o lote inteiro se qualquer
   * chave for inválida, então cada passo vai isolado num try.
   */
  const autoTuneCamera = useCallback(async (
    stream: MediaStream,
    engine: GazeEngine,
    isCancelled: () => boolean,
  ): Promise<void> => {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return;

    let rawCaps: Record<string, unknown> = {};
    try {
      rawCaps = track.getCapabilities() as unknown as Record<string, unknown>;
    } catch {
      return;
    }

    // Item 4 — fotografa o estado ORIGINAL antes de mexer.
    //
    // `applyConstraints` altera o dispositivo, não só a nossa view dele: em
    // vários drivers o zoom e o brilho que deixamos aqui aparecem no Teams
    // depois. O pedido era adaptar a câmera "somente ao nosso produto", então
    // guardamos o que havia e devolvemos ao sair.
    try {
      const st = track.getSettings() as unknown as Record<string, unknown>;
      const keys = ['zoom', 'brightness', 'contrast', 'exposureMode', 'whiteBalanceMode', 'focusMode', 'powerLineFrequency'];
      const snap: Record<string, number | string> = {};
      for (const k of keys) {
        const v = st[k];
        if (typeof v === 'number' || typeof v === 'string') snap[k] = v;
      }
      originalCameraSettingsRef.current = snap;
      console.log('[Etapa1] estado original da câmera guardado para restauração:', snap);
    } catch { /* getSettings indisponível: não há o que restaurar */ }

    // Item 3 — usar a MAIOR resolução que a câmera oferece, até o teto.
    //
    // O `getUserMedia` pede 1920×1080 como `ideal`, mas o browser negocia e
    // pode entregar menos. Aqui, já com as capabilities na mão, sabemos o
    // máximo real e pedimos explicitamente.
    //
    // Teto em 1920: o custo do FaceLandmarker cresce com o número de pixels e
    // o loop precisa sustentar 30 fps. Acima disso trocaríamos precisão de
    // landmark por frames perdidos — e frame perdido também é erro.
    const MAX_USEFUL_WIDTH = 1920;
    const wCap = rawCaps.width as { max?: number } | undefined;
    const hCap = rawCaps.height as { max?: number } | undefined;
    if (typeof wCap?.max === 'number' && typeof hCap?.max === 'number') {
      const cur = track.getSettings().width ?? 0;
      const targetW = Math.min(wCap.max, MAX_USEFUL_WIDTH);
      if (targetW > cur) {
        const targetH = Math.round((targetW * hCap.max) / wCap.max);
        try {
          await track.applyConstraints({ width: { ideal: targetW }, height: { ideal: targetH } });
          console.log(`[Etapa1] resolução ${cur} → ${track.getSettings().width} (máx do driver: ${wCap.max})`);
        } catch (e) {
          console.warn('[Etapa1] não foi possível subir a resolução:', e);
        }
      }
      if (wCap.max > MAX_USEFUL_WIDTH) {
        console.log(
          `[Etapa1] câmera suporta até ${wCap.max}px de largura; usando ${MAX_USEFUL_WIDTH} ` +
          `para o FaceLandmarker sustentar 30 fps.`,
        );
      }
    }
    const asRange = (v: unknown) =>
      v && typeof v === 'object' && 'min' in (v as object) && 'max' in (v as object)
        ? (v as { min: number; max: number; step?: number })
        : undefined;
    const caps: CameraCapabilities = {
      zoom: asRange(rawCaps.zoom),
      brightness: asRange(rawCaps.brightness),
      contrast: asRange(rawCaps.contrast),
      exposureMode: Array.isArray(rawCaps.exposureMode) ? rawCaps.exposureMode as string[] : undefined,
      focusMode: Array.isArray(rawCaps.focusMode) ? rawCaps.focusMode as string[] : undefined,
      whiteBalanceMode: Array.isArray(rawCaps.whiteBalanceMode) ? rawCaps.whiteBalanceMode as string[] : undefined,
      powerLineFrequency: Array.isArray(rawCaps.powerLineFrequency) ? rawCaps.powerLineFrequency as number[] : undefined,
    };
    console.log('[Etapa1] capabilities da câmera:', {
      zoom: caps.zoom, brightness: caps.brightness,
      exposureMode: caps.exposureMode, whiteBalanceMode: caps.whiteBalanceMode,
    });

    const settle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // O auto-exposure precisa de ~2 s para convergir; medir antes disso
    // ajustaria o brilho contra um valor que ainda está mudando sozinho.
    await settle(2000);

    const MAX_ITER = 14;
    for (let i = 0; i < MAX_ITER; i++) {
      if (isCancelled()) return;
      const d = engine.getDiagnostics();
      if (!d) { await settle(300); continue; }

      const iodFraction = d.video.width > 0 ? d.framing.iodPx / d.video.width : 0;
      let state: CameraState = {};
      try {
        const st = track.getSettings() as unknown as Record<string, unknown>;
        state = {
          zoom: typeof st.zoom === 'number' ? st.zoom : undefined,
          brightness: typeof st.brightness === 'number' ? st.brightness : undefined,
          contrast: typeof st.contrast === 'number' ? st.contrast : undefined,
        };
      } catch { /* getSettings indisponível: o planner usa os defaults da faixa */ }

      const step = planTuningStep(caps, state, {
        hasFace: d.framing.hasFace,
        iodFraction,
        brightness: d.quality.brightness,
        contrast: d.quality.contrast,
      });
      cameraTuningRef.current = step;

      if (step.converged || Object.keys(step.constraints).length === 0) {
        if (step.reasons.length) console.log('[Etapa1]', step.reasons.join(' | '));
        if (step.physicalAdvice) console.warn('[Etapa1] ação física necessária:', step.physicalAdvice);
        break;
      }

      console.log('[Etapa1]', step.reasons.join(' | '));
      try {
        await track.applyConstraints(step.constraints as MediaTrackConstraints);
      } catch (e) {
        // Driver recusou. Não insiste: continuar tentando a mesma constraint
        // rejeitada só gastaria o orçamento de iterações.
        console.warn('[Etapa1] applyConstraints rejeitado, ajuste interrompido:', e);
        break;
      }
      await settle(450);
    }

    // Estabilização só DEPOIS de convergir — travar antes congelaria uma
    // exposição ainda não assentada.
    if (isCancelled()) return;
    // Item 1 — cintilação: mede a série de brilho na cadência de frame e, se
    // houver batimento compatível com 50/60 Hz, corrige na origem pelo
    // `powerLineFrequency` do driver.
    let powerLineHz: 50 | 60 | null = null;
    const dFinal = engine.getDiagnostics();
    if (dFinal && dFinal.brightnessHistoryFps > 0) {
      const flick = detectFlicker(dFinal.brightnessHistory, dFinal.brightnessHistoryFps);
      if (flick.detected) {
        powerLineHz = inferPowerLineHz(flick.dominantHz, dFinal.brightnessHistoryFps);
        console.warn(
          `[Etapa1] cintilação de ${flick.dominantHz.toFixed(1)} Hz ` +
          `(${(flick.relativeAmplitude * 100).toFixed(1)}% do brilho)` +
          (powerLineHz ? ` → rede de ${powerLineHz} Hz` : ' → origem não elétrica'),
        );
      }
    }
    const stab = planStabilizationStep(caps, powerLineHz);
    if (Object.keys(stab.constraints).length > 0) {
      try {
        await track.applyConstraints(stab.constraints as MediaTrackConstraints);
        console.log('[Etapa1] estabilização:', stab.reasons.join(' | '));
      } catch (e) {
        console.warn('[Etapa1] estabilização rejeitada (exposição segue automática):', e);
      }
    } else {
      console.log('[Etapa1]', stab.reasons.join(' | '));
      if (stab.physicalAdvice) console.warn('[Etapa1]', stab.physicalAdvice);
    }
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

    const unsubL2CSStatus = engine.onL2CSStatusChange((s) => {
      if (!cancelled) setL2csStatus(s);
    });

    let cbInvocations = 0;
    const unsubGaze = engine.subscribe((sample) => {
      const isDevMode = sessionStorage.getItem('irisflow_dev_mode') === 'true';
      if (isDevMode) {
        if (cursorRef.current) {
          cursorRef.current.style.transform = 'translate3d(-9999px,-9999px,0)';
          cursorRef.current.style.opacity = '0';
        }
        return;
      }

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
      // A1-4 — em degraded, só permite dwell em botões de emergência.
      const isDegraded = sample.degraded === true;
      if (isDegraded !== isDegradedRef.current) {
        isDegradedRef.current = isDegraded;
        setIsDegraded(isDegraded);
      }
      const gracePeriodMs = 300;

      if (!engineIsCalibrating && sample.hasFace && now >= refractoryUntilRef.current) {
        const el = document.elementFromPoint(sample.x, sample.y);
        const t = el?.closest(DWELL_SELECTOR) as HTMLElement | null;
        const customDwell = t?.dataset.dwellMs ? parseInt(t.dataset.dwellMs, 10) : null;
        const isEmergency = !!t && t.dataset.emergency === 'true';
        const isDisabled =
          !!t &&
          ((t as HTMLButtonElement).disabled ||
            t.getAttribute('aria-disabled') === 'true' ||
            t.dataset.noDwell === 'true');
        const blockedByDegraded = isDegraded && !isEmergency;

        if (t && !isDisabled && !blockedByDegraded) {
          hitTarget = t;
          const effectiveDwellMs = customDwell || (isDegraded && isEmergency
            ? dwellMsRef.current * EMERGENCY_DEGRADED_MULT
            : dwellMsRef.current);

          if (t !== dwellTargetRef.current) {
            // Re-entrada no mesmo botão dentro da janela de tolerância: restaura progresso
            if (t === lastDwellTargetRef.current && exitTimeMsRef.current > 0 && now - exitTimeMsRef.current < gracePeriodMs) {
              dwellTargetRef.current = t;
              t.classList.add('gaze-hover');
              dwellStartMsRef.current = now - (frozenDwellProgressRef.current * effectiveDwellMs);
              exitTimeMsRef.current = 0;
              frozenDwellProgressRef.current = 0;
            } else {
              // Mudou de alvo: limpa o anterior imediatamente
              if (dwellTargetRef.current) {
                dwellTargetRef.current.classList.remove('gaze-hover');
                dwellTargetRef.current.style.removeProperty('--gaze-dwell-progress');
              }
              if (lastDwellTargetRef.current && lastDwellTargetRef.current !== t) {
                lastDwellTargetRef.current.classList.remove('gaze-hover');
                lastDwellTargetRef.current.style.removeProperty('--gaze-dwell-progress');
              }

              dwellTargetRef.current = t;
              dwellStartMsRef.current = now;
              t.classList.add('gaze-hover');
              lastDwellTargetRef.current = t;
              exitTimeMsRef.current = 0;
              frozenDwellProgressRef.current = 0;
            }
          }

          if (t === dwellTargetRef.current) {
            const elapsed = now - dwellStartMsRef.current;
            dwellPct = Math.min(1, elapsed / effectiveDwellMs);
            t.style.setProperty('--gaze-dwell-progress', `${dwellPct}`);

            if (elapsed >= effectiveDwellMs) {
              t.click();
              try {
                const rect = t.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                engineRef.current?.calibration.feedOnlineSample(centerX, centerY);
              } catch (e) {
                // Silencia
              }
              t.classList.remove('gaze-hover');
              t.style.removeProperty('--gaze-dwell-progress');
              refractoryUntilRef.current = now + REFRACTORY_MS;
              dwellTargetRef.current = null;
              lastDwellTargetRef.current = null;
              dwellStartMsRef.current = 0;
              exitTimeMsRef.current = 0;
              frozenDwellProgressRef.current = 0;
              dwellPct = 0;
              hitTarget = null;
            }
          }
        } else {
          handleGazeExit(now);
        }
      } else {
        handleGazeExit(now);
      }

      function handleGazeExit(timestamp: number) {
        if (dwellTargetRef.current) {
          const t = dwellTargetRef.current;
          const customDwell = t.dataset.dwellMs ? parseInt(t.dataset.dwellMs, 10) : null;
          const effectiveDwellMs = customDwell || (isDegraded && t.dataset.emergency === 'true'
            ? dwellMsRef.current * EMERGENCY_DEGRADED_MULT
            : dwellMsRef.current);
          const elapsed = timestamp - dwellStartMsRef.current;
          frozenDwellProgressRef.current = Math.min(1, elapsed / effectiveDwellMs);
          exitTimeMsRef.current = timestamp;
          lastDwellTargetRef.current = dwellTargetRef.current;
          
          // Desacopla dwellTarget ativo mas deixa o estilo congelado na tela
          dwellTargetRef.current = null;
        }

        // Se expirou a tolerância, remove do DOM o estado visual de progresso e hover
        if (exitTimeMsRef.current > 0 && timestamp - exitTimeMsRef.current >= gracePeriodMs) {
          if (lastDwellTargetRef.current) {
            lastDwellTargetRef.current.classList.remove('gaze-hover');
            lastDwellTargetRef.current.style.removeProperty('--gaze-dwell-progress');
          }
          lastDwellTargetRef.current = null;
          exitTimeMsRef.current = 0;
          frozenDwellProgressRef.current = 0;
          dwellStartMsRef.current = 0;
        }
      }

      // Move cursor via transform (no layout / no React re-render).
      // Visual feedback: green + growing while dwell fills; red otherwise.
      // Cursor completamente escondido em 3 casos: (1) durante calibração
      // para não distrair a fixação; (2) antes de calibrar (não há mapeamento
      // ainda, mostrar um cursor aleatório confunde); (3) durante o teste
      // de precisão — se o usuário vir o cursor ele tenta "corrigi-lo"
      // olhando para outro lugar, criando feedback loop que corrompe a
      // medida (a variável isAccuracyTesting é lida a cada frame, então
      // pega o valor fresco assim que startAccuracyTest liga).
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
          // A1-4 — aparência distinta em degraded: amarelo com borda tracejada,
          // sinaliza que o cursor não é confiável. O background verde só entra
          // quando hitTarget existe (que em degraded só é possível se for
          // emergency), então o feedback verde permanece coerente.
          if (isDegraded) {
            cursorRef.current.style.background = hitTarget
              ? `rgba(34,197,94,${(0.5 + dwellPct * 0.4).toFixed(2)})`
              : 'rgba(234,179,8,0.55)'; // amarelo tailwind-500 c/ transparência
            cursorRef.current.style.border = '2px dashed rgba(234,179,8,0.9)';
          } else {
            cursorRef.current.style.background = hitTarget
              ? `rgba(34,197,94,${(0.5 + dwellPct * 0.4).toFixed(2)})`
              : 'rgba(239,68,68,0.6)';
            cursorRef.current.style.border = '';
          }
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

      // Sincroniza o estado de isDwelling de forma segura sem floodar re-renders
      const targetExists = dwellTargetRef.current !== null;
      if (wasDwellingRef.current !== targetExists) {
        wasDwellingRef.current = targetExists;
        setIsDwelling(targetExists);
      }
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
          // A2-6 — solicitar frameRate explícito para evitar que o auto-rate
          // do driver oscile entre 15-60 Hz conforme a luminosidade ambiente.
          // 30fps é o target; 24fps é o mínimo para rastreamento aceitável.
          //
          // D10 — resolução subiu de 1280×720 para 1920×1080.
          //
          // MOTIVO (medido em fixtures/replay/*.jsonl): o sinal ÚTIL do
          // pipeline inteiro é o deslocamento do centro da íris no frame, e ele
          // vale 6,8 px em X para a tela toda a 1280×720. Todo o resto — 44
          // features, Ridge, filtros — opera em cima desses 6,8 px. A relação
          // medida é de 141 px de TELA por 1 px de CÂMERA; o piso de ruído de
          // 22 px que o pipeline exibe corresponde a ~0,15 px de tremor de
          // landmark, ou seja, já está no limite do sensor.
          //
          // Pedir 1080p numa câmera que entrega 1080p multiplica a densidade
          // linear por 1,5× e divide por 1,5× a contribuição do tremor de
          // landmark no erro final. É o maior ganho disponível sem tocar em
          // nenhuma lógica do pipeline.
          //
          // `ideal` (não `exact`) de propósito: numa webcam que só faça 720p o
          // browser negocia para baixo em vez de falhar com
          // OverconstrainedError e deixar o app sem câmera nenhuma.
          video: {
            width: { ideal: 1920, min: 640 },
            height: { ideal: 1080, min: 480 },
            facingMode: 'user',
            frameRate: { ideal: 30, min: 24 },
          },
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

        // D10 — a resolução obtida é um preditor DIRETO do erro final, então
        // não pode ficar só num log informativo. Ver o comentário do
        // getUserMedia acima: o sinal útil são poucos px de deslocamento da
        // íris, e ele escala linearmente com a densidade do sensor.
        if (video.videoWidth > 0 && video.videoWidth < 1920) {
          console.warn(
            `[IrisFlow] ⚠ câmera negociou ${video.videoWidth}x${video.videoHeight}, abaixo de 1920x1080. ` +
            `O erro de rastreamento escala com o inverso da densidade de pixels no rosto: ` +
            `a ${video.videoWidth}px de largura, espere ~${(1920 / video.videoWidth).toFixed(1)}× mais erro ` +
            `de landmark do que a 1080p. Verifique se a webcam suporta Full HD e se nenhum outro ` +
            `app está segurando o dispositivo numa resolução menor.`,
          );
        }

        // A2-6 — travar exposição da câmera após aquecimento de 2s (atrás de flag).
        // O auto-exposure precisa de ~2s para convergir; travar de imediato
        // congelaria uma exposição ainda não convergida, gerando crop escuro ou
        // saturado pelo resto da sessão. Nem toda webcam suporta essas capabilities;
        // registramos o resultado para o cuidador poder interpretar medidas futuras.
        if (EXPERIMENT.lockCameraExposure) {
          setTimeout(async () => {
            try {
              const track = stream.getVideoTracks()[0];
              if (!track) return;
              const caps = track.getCapabilities() as Record<string, unknown>;
              const constraints: Record<string, unknown> = {};
              if (caps.exposureMode) constraints.exposureMode = 'manual';
              if (caps.focusMode) constraints.focusMode = 'manual';
              if (caps.whiteBalanceMode) constraints.whiteBalanceMode = 'manual';
              if (Object.keys(constraints).length > 0) {
                await track.applyConstraints(constraints as MediaTrackConstraints);
                console.log('[A2-6] exposição travada:', Object.keys(constraints).join(', '));
              } else {
                console.log('[A2-6] câmera não suporta constraints manuais (exposição livre)');
              }
            } catch (e) {
              console.warn('[A2-6] applyConstraints falhou (exposição livre):', e);
            }
          }, 2000);
        } else {
          console.log('[A2-6] lockCameraExposure=false, exposição livre');
        }
        if (cancelled) return;
        await engine.start(video);
        console.log('[IrisFlow] engine.start() concluído; loop rAF em execução.');

        // Etapa 1 — ajuste automático da câmera. Roda DEPOIS do engine porque
        // a malha se fecha sobre o tamanho do rosto, que só existe com o
        // detector de landmarks rodando. Deliberadamente sem `await`: são
        // ~8 s de convergência e o app não pode ficar parado esperando —
        // a pré-calibração já mostra o estado enquanto o ajuste acontece.
        void autoTuneCamera(stream, engine, () => cancelled);
      } catch (err) {
        console.error('[IrisFlow] Falha ao inicializar câmera/engine:', err);
      }
    }

    boot();

    return () => {
      cancelled = true;
      unsubState();
      unsubL2CSStatus();
      unsubGaze();
      engine.stop();
      engineRef.current = null;

      const stream = videoRef.current?.srcObject as MediaStream | null;

      // Item 4 — devolve a câmera como estava ANTES de `track.stop()`.
      //
      // Zoom e brilho aplicados por `applyConstraints` persistem no dispositivo
      // em vários drivers: sem isto, o usuário abriria a próxima videochamada
      // com o zoom que deixamos. O pedido era adaptar a câmera "somente ao
      // nosso produto".
      //
      // Best-effort e síncrono-ish: o cleanup do React não espera Promise, mas
      // `applyConstraints` chega ao driver antes do `stop()` porque a chamada é
      // despachada imediatamente. Se falhar, o `stop()` a seguir libera o
      // dispositivo de qualquer forma.
      const original = originalCameraSettingsRef.current;
      const track0 = stream?.getVideoTracks()[0];
      if (original && track0 && Object.keys(original).length > 0) {
        try {
          void track0.applyConstraints(original as MediaTrackConstraints)
            .then(() => console.log('[Etapa1] câmera restaurada ao estado original.'))
            .catch((e) => console.warn('[Etapa1] restauração da câmera falhou:', e));
        } catch (e) {
          console.warn('[Etapa1] restauração da câmera falhou:', e);
        }
      }
      originalCameraSettingsRef.current = null;

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
      // D6 — opts opcional: `quick` (4 cantos) e `opticalCondition` (persistida no perfil).
      startCalibrationMode: (opts) => engineRef.current?.calibration.startCalibrationMode(opts),
      getCalibrationTargets: () => engineRef.current?.calibration.getCalibrationTargets() ?? [],
      getCalibrationMode: () => engineRef.current?.calibration.getCalibrationMode() ?? null,
      startCollectingPoint: (x, y, onDone) => engineRef.current?.calibration.startCollectingPoint(x, y, onDone),
      completeCalibration: (onComplete) => engineRef.current?.calibration.completeCalibration(onComplete),
      clear: () => engineRef.current?.calibration.clear(),
      isCalibrated: () => engineRef.current?.calibration.isCalibrated() ?? false,
      feedOnlineSample: (x, y) => engineRef.current?.calibration.feedOnlineSample(x, y) ?? false,
      setOnlineCalibrationEnabled: (enabled) =>
        engineRef.current?.calibration.setOnlineCalibrationEnabled(enabled),
      onlineSampleCount: () => engineRef.current?.calibration.onlineSampleCount() ?? 0,
      setEyeDominance: (d) => engineRef.current?.calibration.setEyeDominance(d),
      setSessionBiasEnabled: (enabled) => engineRef.current?.calibration.setSessionBiasEnabled(enabled),
      resetSessionBias: () => engineRef.current?.calibration.resetSessionBias(),
      // D6.3 — indicador de drift consulta este valor a cada tick para
      // decidir se mostra o aviso "recalibração recomendada".
      getSessionBias: () => engineRef.current?.calibration.getSessionBias() ?? { x: 0, y: 0, samples: 0 },
      getRecentBlinkRatePerMinute: (windowMs) => engineRef.current?.calibration.getRecentBlinkRatePerMinute(windowMs) ?? 0,
      getActiveOpticalCondition: () => engineRef.current?.calibration.getActiveOpticalCondition() ?? 'desconhecido',
    }),
    [],
  );

  // Fase 0.1 — mesma estratégia da calibration: identidade estável, leitura
  // lazy do ref. As respostas de isActive/getStats vêm do singleton do
  // recorder, que é global — se o engine for recriado (StrictMode) o estado
  // da gravação persiste, o que é o comportamento desejado.
  const recording = useMemo<RecordingApi>(
    () => ({
      start: () => engineRef.current?.recording.start(),
      stop: () => engineRef.current?.recording.stop(),
      isActive: () => engineRef.current?.recording.isActive() ?? false,
      getStats: () =>
        engineRef.current?.recording.getStats() ?? { frames: 0, dropped: 0 },
      exportAsJSONL: () => engineRef.current?.recording.exportAsJSONL() ?? '',
      clear: () => engineRef.current?.recording.clear(),
    }),
    [],
  );


  const value = useMemo<GazeContextValue>(
    () => ({
      subscribe,
      state,
      l2csStatus,
      calibration,
      recording,
      setFilterPreset: (preset: FilterPreset | FilterPresetV2) => engineRef.current?.setFilterPreset(preset),
      getDiagnostics: () => engineRef.current?.getDiagnostics() ?? null,
      getCameraStream: () => (videoRef.current?.srcObject as MediaStream | null) ?? null,
      getCameraTuning: () => cameraTuningRef.current,
      getSessionUptimeMs: () => engineRef.current?.getSessionUptimeMs() ?? 0,
      isDwelling,
      isComposing,
      setIsComposing,
      isDegraded,
    }),
    [subscribe, state, l2csStatus, calibration, recording, isDwelling, isComposing, setIsComposing, isDegraded],
  );

  return <GazeContext.Provider value={value}>{children}</GazeContext.Provider>;
};
