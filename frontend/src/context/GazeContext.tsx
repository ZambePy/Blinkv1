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
import { stepDwell, createDwellState, type DwellTarget } from '@tracker/interaction/dwell';
import { estiloDoCursor, limitarTamanho } from '@tracker/interaction/cursorStyle';
import { geometriaDoAnel } from '@tracker/interaction/dwellRing';
import { GazeFallback } from '@tracker/interaction/gazeFallback';
import { preflight, podeComecar } from '@tracker/diagnostics/preflight';
import { stepBlinkClick, criarEstadoBlinkClick } from '@tracker/interaction/blinkClick';
import { GazeStatusBanner } from '../components/GazeStatusBanner';
import { ScanningMode } from '../components/ScanningMode';
import type { FilterPreset, FilterPresetV2 } from '@tracker/oneEuroFilter';
import { EXPERIMENT } from '@tracker/config/experiment';
import {
  planTuningStep, planStabilizationStep, planExposureStep,
  type CameraCapabilities, type CameraState, type TuningStep,
} from '@tracker/cameraTuner';
// P4.2 — a estratégia de captura é decidida a partir do que o navegador
// realmente expõe, e registrada. Enquanto `captureWorker` estiver desligada
// (default), isto só informa; nada no caminho muda.
import { detectCaptureEnvironment, planCaptureStrategy } from '@tracker/capture/captureWorker';
import { detectFlicker, inferPowerLineHz } from '@tracker/flickerDetector';
// P6.9 — aviso de distância fora da faixa de calibração, com histerese.
import { AvisoDeDistancia } from '@tracker/distanceAdvisory';
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
export const DWELL_SELECTOR = 'button, a, [role="button"], [role="link"]';

// Em estado 'degraded' o cursor está sobre o nariz (fallback do engine), não
// sobre o olhar. Permitir dwell nesse estado dispara cliques aleatórios — em
// software de saúde, mensagem errada ao cuidador é falha crítica. O dwell é
// bloqueado, EXCETO em elementos com data-emergency="true": para o botão de
// emergência vale mais um falso positivo ocasional do que um pedido de socorro
// impossível. Nesses elementos o tempo é multiplicado por este fator para
// reduzir o risco de falso positivo.
const EMERGENCY_DEGRADED_MULT = 1.8;
// B1.9 — mesma lógica para elementos com data-recovery="true" (o botão
// "Recalibre aqui"). Fator MAIOR que o de emergência: um alarme disparado por
// engano é reversível, uma recalibração disparada por engano custa 1–2 min de
// sessão a um paciente com fadiga limitante — e o risco é maior justamente
// porque o cursor está instável. Provisório até a medição de F8.5 (métrica 7,
// estabilidade do dwell) no Dia 7.
const RECOVERY_DEGRADED_MULT = 2.5;
// Janela em que sair e voltar ao mesmo alvo preserva o progresso do dwell.
const DWELL_GRACE_MS = 300;
// Lacuna de amostras válidas acima da qual o progresso é ZERADO em vez de
// apenas pausado. Também limita quanto tempo um único frame pode acrescentar,
// o que impede que um salto de relógio (aba em segundo plano, GC longo)
// complete um dwell de uma só vez.
const DWELL_LOST_RESET_MS = 500;

interface GazeContextValue {
  subscribe: (cb: (sample: GazeSample) => void) => () => void;
  state: EngineState;
  l2csStatus: L2CSStatus;
  calibration: CalibrationApi;
  recording: RecordingApi;
  setFilterPreset: (preset: FilterPreset | FilterPresetV2) => void;
  getDiagnostics: () => EngineDiagnostics | null;
  /** Stream da webcam para telas que precisam mostrar o usuário a si mesmo.
   *  O `<video>` do engine fica com 2px e opacidade 0.01 (não pode ser
   *  display:none, senão o browser suspende o decoding), então a UI que quiser
   *  exibir precisa criar o próprio elemento e apontar para o MESMO `srcObject`
   *  — não abrir uma segunda captura, que muitos drivers recusam e que
   *  dobraria o custo de decode. */
  getCameraStream: () => MediaStream | null;
  /** Resultado do ajuste automático da câmera. `null` enquanto não rodou.
   *  Consumido pela pré-calibração para dizer ao cuidador o que o software já
   *  resolveu e o que ainda exige ação física. */
  getCameraTuning: () => TuningStep | null;
  /** Mensagem acionável quando a câmera não pôde ser aberta. `null` no caminho
   *  feliz. Existe porque a falha era só um `console.error`: o app ficava
   *  parado sem rastrear e sem dizer por quê — num software assistivo, quem
   *  está na frente da tela não tem como abrir o DevTools. */
  cameraError: string | null;
  /** 0.2 — preenchido quando o pipeline mudou sob um perfil salvo e o modelo
   *  foi descartado. Antes disso o app ia para `degraded` em silêncio: cursor
   *  no fallback do nariz, sem dizer que a saída era recalibrar. */
  calibrationInvalidated: string | null;
  // Tempo em ms desde o start bem-sucedido do engine. 0 antes do start.
  // Consumido pelo relatório pós-calibração para preencher o campo
  // `minutosDeSessao` em vez de hardcode 0.
  getSessionUptimeMs: () => number;
  isDwelling: boolean;
  isComposing: boolean;
  setIsComposing: (val: boolean) => void;
  isDegraded: boolean;
  /**
   * `P7.5` — mensagem quando o gaze está perdido além do hold, ou `null`.
   *
   * Só existe com a flag `gazeLostFallback` ligada. Sem ela o comportamento
   * continua o de sempre: cursor congelado a 35% de opacidade, sem aviso.
   */
  gazeLostMessage: string | null;
}

const GazeContext = createContext<GazeContextValue | null>(null);

export const useGaze = (): GazeContextValue => {
  const ctx = useContext(GazeContext);
  if (!ctx) throw new Error('useGaze must be used inside <GazeProvider>');
  return ctx;
};

/**
 * Contexto separado só para `isDwelling` — B3.23.
 *
 * ## Por que separar
 *
 * `isDwelling` alterna a cada entrada e saída de alvo. No teclado ocular, onde
 * as teclas são vizinhas e o cursor tem jitter, isso acontece **várias vezes
 * por segundo**. Enquanto ele estava nas deps do `useMemo` do contexto
 * principal, cada alternância criava um `value` novo e re-renderizava os **11
 * consumidores** de `useGaze()` — a maioria dos quais nem lê o campo.
 *
 * `KeyboardScreen` (507 linhas) era o mais caro dos onze, e é também o único
 * que de fato usa `isDwelling`. Separar o contexto significa que ele continua
 * recebendo o sinal de que precisa, e os outros dez param de pagar por ele.
 */
const DwellContext = createContext<boolean>(false);

/**
 * Estado de dwell em curso. Use este hook em vez de `useGaze().isDwelling`
 * quando só o dwell interessar — assinar o contexto principal para ler este
 * campo faz o componente re-renderizar a cada mudança de estado do engine.
 */
export const useIsDwelling = (): boolean => useContext(DwellContext);

/**
 * Abre a câmera tentando resoluções em ordem decrescente.
 *
 * POR QUE UMA ESCADA E NÃO UM PEDIDO SÓ
 *
 * O pipeline quer 1080p: o sinal útil é o deslocamento da íris no frame, e ele
 * escala com a densidade de pixels sobre o olho (ver o comentário de
 * `cameraTuner.ts`). Mas pedir 1080p e desistir se falhar deixa o usuário sem
 * rastreamento nenhum — e para software assistivo isso é pior que rastrear com
 * menos precisão.
 *
 * Duas armadilhas que a escada evita:
 *
 *   • `min` é constraint DURA. `width: { min: 640 }` faz o browser recusar a
 *     câmera inteira se ela não puder garantir o mínimo, com
 *     OverconstrainedError. A primeira tentativa aqui usa só `ideal`, que
 *     negocia em vez de falhar.
 *   • Alguns drivers do Windows anunciam 1080p mas não conseguem INICIAR nesse
 *     modo, e o Chrome reporta isso como `NotReadableError` — o mesmo erro de
 *     "câmera em uso por outro app". Sem tentar uma resolução menor não dá para
 *     distinguir os dois casos.
 */
async function openCameraWithFallback(): Promise<MediaStream> {
  const tentativas: { rotulo: string; constraints: MediaStreamConstraints }[] = [
    {
      rotulo: '1920×1080',
      constraints: {
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
      },
    },
    {
      rotulo: '1280×720',
      constraints: {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
      },
    },
    // Última tentativa sem nenhuma preferência: se a câmera abrir de algum
    // jeito, o rastreamento roda (pior, mas roda). O ajuste automático tenta
    // subir a resolução depois, já com as capabilities em mãos.
    { rotulo: 'padrão da câmera', constraints: { video: true } },
  ];

  let ultimoErro: unknown = null;
  for (const { rotulo, constraints } of tentativas) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const t = stream.getVideoTracks()[0]?.getSettings();
      console.log(`[IrisFlow] câmera aberta (pedido: ${rotulo}) → ${t?.width}×${t?.height} @ ${t?.frameRate ?? '?'}fps`);
      return stream;
    } catch (e) {
      ultimoErro = e;
      const nome = (e as DOMException)?.name ?? 'Error';
      // Permissão negada não melhora tentando outra resolução — abortar já
      // evita três diálogos seguidos na cara do usuário.
      if (nome === 'NotAllowedError' || nome === 'SecurityError') break;
      console.warn(`[IrisFlow] tentativa "${rotulo}" falhou (${nome}); tentando resolução menor…`);
    }
  }

  const nome = (ultimoErro as DOMException)?.name ?? 'Error';
  const causa =
    nome === 'NotAllowedError' || nome === 'SecurityError'
      ? 'Permissão de câmera negada. Autorize o acesso nas configurações do navegador e recarregue.'
      : nome === 'NotFoundError' || nome === 'DevicesNotFoundError'
      ? 'Nenhuma câmera encontrada. Conecte a webcam e recarregue.'
      : nome === 'NotReadableError' || nome === 'TrackStartError'
      ? 'A câmera existe mas não pôde ser iniciada — quase sempre porque OUTRO PROGRAMA está usando ela ' +
        '(OBS, Teams, Zoom, Meet, ou outra aba deste navegador). Feche o outro programa e recarregue.'
      : nome === 'OverconstrainedError'
      ? 'A câmera não suporta nenhum dos formatos solicitados.'
      : `Falha ao abrir a câmera (${nome}).`;

  console.error(`[IrisFlow] ${causa}`);
  throw new Error(causa, { cause: ultimoErro });
}

/**
 * Guard de instância única do provider (B1.8).
 *
 * Precisa ser de MÓDULO, não um ref. O guard original testava
 * `engineRef.current`, mas o próprio cleanup fazia `engineRef.current = null`
 * — então no segundo mount do StrictMode o ref já estava limpo, o guard não
 * barrava nada, e nascia um segundo engine com um segundo `getUserMedia`.
 *
 * Um contador de módulo sobrevive ao ciclo mount→cleanup→mount e é a única
 * coisa que consegue distinguir "estou remontando" de "sou o primeiro".
 */
let provedorAtivo = 0;

export const GazeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { settings } = useSettings();
  const engineRef = useRef<GazeEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /**
   * Stream da câmera, guardada assim que `getUserMedia` resolve (B1.8).
   *
   * O cleanup lia a stream de `videoRef.current?.srcObject`. Quando ele roda
   * durante o await de `getUserMedia`, `srcObject` ainda é `null` — e
   * `stream?.getTracks().forEach(t => t.stop())` não parava nada. Guardar a
   * referência aqui, antes de qualquer atribuição ao <video>, dá ao cleanup
   * algo concreto para parar.
   */
  const streamRef = useRef<MediaStream | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<EngineState>('idle');
  const [l2csStatus, setL2csStatus] = useState<L2CSStatus>('loading');
  const [isDwelling, setIsDwelling] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isDegraded, setIsDegraded] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /** P6.9 — aviso de distância fora da faixa de calibração. */
  const [distanceAdvice, setDistanceAdvice] = useState<string | null>(null);
  const avisoDistanciaRef = useRef(new AvisoDeDistancia());
  const [calibrationInvalidated, setCalibrationInvalidated] = useState<string | null>(null);
  const isDegradedRef = useRef(false);
  const wasDwellingRef = useRef(false);

  // Sub pool: subscribers can hook in and receive callbacks. We keep the callback
  // model instead of React state to avoid re-rendering the tree at 30 Hz.
  const subscribersRef = useRef<Set<(s: GazeSample) => void>>(new Set());
  const cameraTuningRef = useRef<TuningStep | null>(null);
  // Item 4 — estado da câmera antes de qualquer ajuste nosso.
  const originalCameraSettingsRef = useRef<Record<string, number | string> | null>(null);

  // Global dwell dispatcher state. Kept in refs to avoid re-renders — the loop
  // runs at 30 Hz and reads/writes these directly from the gaze callback.
  const dwellMsRef = useRef<number>(DWELL_MS_BY_SPEED[settings.dwellSpeed]);
  // Todo o estado do dwell vive num único objeto imutável, avançado pelo
  // redutor puro de `src/interaction/dwell.ts`. Os refs anteriores (alvo,
  // início, refratário, último alvo, saída, progresso congelado) eram mutados
  // em pontos diferentes do callback e saíam de sincronia — foi assim que o
  // dwell chegou a completar com os olhos fechados.
  const dwellStateRef = useRef(createDwellState());
  // P7.5 — segura a última posição válida por 2 s, depois esconde e avisa.
  const fallbackRef = useRef(new GazeFallback());
  const [gazeLostMessage, setGazeLostMessage] = useState<string | null>(null);
  const gazeLostMessageRef = useRef<string | null>(null);
  // P7.2 — o `<circle>` do anel de progresso, quando a flag está ligada.
  const anelRef = useRef<SVGCircleElement | null>(null);
  // P7.3 — piscada como clique. Desligada por default; ver a flag.
  const blinkClickRef = useRef(criarEstadoBlinkClick());
  // Nó que está com o realce `gaze-hover` aplicado no DOM.
  const hoveredNodeRef = useRef<HTMLElement | null>(null);

  /** Remove realce e barra de progresso do nó atualmente destacado. */
  const clearDwellVisuals = React.useCallback(() => {
    const n = hoveredNodeRef.current;
    if (n) {
      // F-FE-33 — nó pode ter sido desmontado sob o olhar; `isConnected` evita
      // segurar referência a um elemento fora da árvore.
      n.classList.remove('gaze-hover');
      n.style.removeProperty('--gaze-dwell-progress');
    }
    hoveredNodeRef.current = null;
  }, []);

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

  // O campo de visão habilita a compensação de distância: sem ele o pipeline
  // não converte tamanho de rosto em centímetros e a compensação fica inativa.
  // Propagado em efeito próprio para reagir à calibração de FOV feita em
  // Configurações sem exigir recarregar.
  useEffect(() => {
    engineRef.current?.calibration.setCameraFovDeg?.(settings.cameraHorizontalFovDeg);
  }, [settings.cameraHorizontalFovDeg]);

  const subscribe = useCallback((cb: (s: GazeSample) => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  /**
   * Ajuste automático da câmera em malha fechada.
   *
   * O pipeline já mede o tamanho do rosto no frame a cada quadro. Em vez de
   * pedir ao cuidador que configure zoom e brilho no painel do Windows — onde
   * ele não sabe qual valor serve, e o valor certo muda com a distância em que
   * o paciente sentou hoje — o programa mede, ajusta, mede de novo.
   *
   * A política de decisão está em `@tracker/cameraTuner` (puro e testado).
   * Aqui só ficam os efeitos: ler capabilities, aplicar constraints, esperar
   * o driver assentar. `applyConstraints` pode rejeitar o lote inteiro se
   * qualquer chave for inválida, então cada passo vai isolado num try.
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
      console.log('[camera] estado original da câmera guardado para restauração:', snap);
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
          console.log(`[camera] resolução ${cur} → ${track.getSettings().width} (máx do driver: ${wCap.max})`);
        } catch (e) {
          console.warn('[camera] não foi possível subir a resolução:', e);
        }
      }
      if (wCap.max > MAX_USEFUL_WIDTH) {
        console.log(
          `[camera] câmera suporta até ${wCap.max}px de largura; usando ${MAX_USEFUL_WIDTH} ` +
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
    console.log('[camera] capabilities da câmera:', {
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
        if (step.reasons.length) console.log('[camera]', step.reasons.join(' | '));
        if (step.physicalAdvice) console.warn('[camera] ação física necessária:', step.physicalAdvice);
        break;
      }

      console.log('[camera]', step.reasons.join(' | '));
      try {
        await track.applyConstraints(step.constraints as MediaTrackConstraints);
      } catch (e) {
        // Driver recusou. Não insiste: continuar tentando a mesma constraint
        // rejeitada só gastaria o orçamento de iterações.
        console.warn('[camera] applyConstraints rejeitado, ajuste interrompido:', e);
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
          `[camera] cintilação de ${flick.dominantHz.toFixed(1)} Hz ` +
          `(${(flick.relativeAmplitude * 100).toFixed(1)}% do brilho)` +
          (powerLineHz ? ` → rede de ${powerLineHz} Hz` : ' → origem não elétrica'),
        );
      }
    }
    const stab = planStabilizationStep(caps, powerLineHz);
    if (Object.keys(stab.constraints).length > 0) {
      try {
        await track.applyConstraints(stab.constraints as MediaTrackConstraints);
        console.log('[camera] estabilização:', stab.reasons.join(' | '));
      } catch (e) {
        console.warn('[camera] estabilização rejeitada (exposição segue automática):', e);
      }
    } else {
      console.log('[camera]', stab.reasons.join(' | '));
      if (stab.physicalAdvice) console.warn('[camera]', stab.physicalAdvice);
    }

    // ── P4.3 — exposição manual DERIVADA da medição ──────────────────────────
    //
    // Roda aqui, e não no warm-up de 2 s da câmera, por um motivo simples: o
    // plano depende de `d.quality.brightness`, que só existe com o engine
    // rodando. A versão anterior pedia `exposureMode: 'manual'` às cegas antes
    // do engine subir — travava a exposição sem saber se a imagem estava boa, e
    // não tinha o que dizer ao cuidador quando o driver não colaborava.
    //
    // Continua atrás da MESMA flag (`lockCameraExposure`, default false), então
    // o caminho de produção não muda enquanto ela estiver desligada.
    if (!EXPERIMENT.lockCameraExposure) {
      console.log('[camera] lockCameraExposure=false, exposição segue automática');
      return;
    }
    if (isCancelled()) return;
    const dExp = engine.getDiagnostics();
    let stateExp: CameraState = {};
    try {
      const st = track.getSettings() as unknown as Record<string, unknown>;
      stateExp = {
        exposureTime: typeof st.exposureTime === 'number' ? st.exposureTime : undefined,
        exposureCompensation: typeof st.exposureCompensation === 'number' ? st.exposureCompensation : undefined,
      };
    } catch { /* getSettings indisponível: o planner parte do meio da faixa */ }

    const exp = planExposureStep(caps, stateExp, {
      hasFace: dExp?.framing.hasFace ?? false,
      iodFraction: dExp && dExp.video.width > 0 ? dExp.framing.iodPx / dExp.video.width : 0,
      brightness: dExp?.quality.brightness,
      contrast: dExp?.quality.contrast,
    });
    console.log(`[camera] exposição (suporte: ${exp.supportLevel}):`, exp.reasons.join(' | '));
    if (Object.keys(exp.constraints).length > 0) {
      try {
        await track.applyConstraints(exp.constraints as MediaTrackConstraints);
      } catch (e) {
        console.warn('[camera] constraints de exposição rejeitadas:', e);
      }
    }
    // O conselho físico é a saída honesta quando o software esgotou o que
    // podia. Ele existe justamente para o caso em que não há constraint a
    // aplicar — silenciar aqui deixaria o cuidador sem ação nenhuma.
    if (exp.physicalAdvice) console.warn('[camera] ação física necessária:', exp.physicalAdvice);
  }, []);

  useEffect(() => {
    // React StrictMode em dev roda useEffect duas vezes (mount → cleanup → mount).
    // getUserMedia + FaceLandmarker são caros e mantêm estado global (module-scope
    // da calibração), então travamos a segunda inicialização. Em produção o guard
    // é inofensivo — StrictMode não faz double-invoke fora de dev.
    //
    // B1.8 — o guard usa um contador de MÓDULO, não `engineRef.current`. O
    // antigo se auto-anulava: o cleanup fazia `engineRef.current = null`, então
    // o segundo mount encontrava o ref limpo, passava direto, e criava engine
    // #2 + um segundo getUserMedia. Resultado: LED da webcam permanentemente
    // aceso, decode de 1080p órfão, e `NotReadableError` em vários drivers
    // Windows — que o app traduzia como "OUTRO PROGRAMA está usando a câmera",
    // culpando o Teams por um bug nosso.
    if (provedorAtivo > 0) {
      console.log('[IrisFlow] GazeProvider effect ignorado — já existe um provider ativo.');
      return;
    }
    provedorAtivo++;

    let cancelled = false;

    const engine = createGazeEngine();
    engineRef.current = engine;

    // Cursor DOM node — direct writes via ref, no React state.
    // transform-origin: center lets scale() grow around the cursor's centre
    // (used by the dwell dispatcher for visual feedback) without breaking
    // the translate3d positioning.
    // P7.1 — o diâmetro vem da flag. `limitarTamanho` prende à faixa em vez de
    // rejeitar: um valor corrompido não pode deixar o paciente sem cursor, que
    // é justamente o que ele usaria para chegar às configurações e consertá-lo.
    const tamanhoCursor = limitarTamanho(EXPERIMENT.cursorSizePx);

    const cursor = document.createElement('div');
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      `width:${tamanhoCursor}px`,
      `height:${tamanhoCursor}px`,
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

    // P7.2 — anel de progresso ao redor do cursor.
    //
    // Fica FORA do fluxo do dwell no alvo (que continua existindo): alvos
    // pequenos escondem o próprio progresso debaixo do cursor, e olhando para
    // o vazio não há onde desenhá-lo. O anel acompanha o olhar, então está
    // sempre onde a fóvea está — ler um indicador fora dele exigiria um
    // sacádico, que cancelaria o dwell que se queria acompanhar.
    if (EXPERIMENT.dwellRingOnCursor) {
      const g = geometriaDoAnel(tamanhoCursor, 0);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('viewBox', `0 0 ${g.lado} ${g.lado}`);
      svg.style.cssText = [
        'position:fixed',
        'left:0',
        'top:0',
        `width:${g.lado}px`,
        `height:${g.lado}px`,
        'pointer-events:none',
        'z-index:9998',
        'transform:translate3d(-9999px,-9999px,0)',
        'opacity:0',
      ].join(';');
      const circulo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circulo.setAttribute('cx', String(g.centro));
      circulo.setAttribute('cy', String(g.centro));
      circulo.setAttribute('r', String(g.raio));
      circulo.setAttribute('fill', 'none');
      circulo.setAttribute('stroke', 'rgba(34,197,94,0.95)');
      circulo.setAttribute('stroke-width', String(g.espessura));
      circulo.setAttribute('stroke-linecap', 'round');
      circulo.setAttribute('stroke-dasharray', String(g.circunferencia));
      circulo.setAttribute('stroke-dashoffset', String(g.offset));
      // Começa às 12 h: o zero do SVG fica às 3 h, e um indicador circular que
      // não começa no topo se lê como andando para trás.
      circulo.setAttribute('transform', `rotate(${g.rotacaoDeg} ${g.centro} ${g.centro})`);
      svg.appendChild(circulo);
      document.body.appendChild(svg);
      anelRef.current = circulo;
    }

    // 0.2 — calibração descartada por incompatibilidade de pipeline.
    const unsubInvalid = engine.calibration.onInvalidated(() => {
      if (cancelled) return;
      setCalibrationInvalidated(
        'A calibração salva não vale para esta versão do rastreador. ' +
        'Refaça a calibração para voltar a usar o olhar.',
      );
    });

    const unsubState = engine.onStateChange((s) => {
      if (!cancelled) setState(s);
    });

    const unsubL2CSStatus = engine.onL2CSStatusChange((s) => {
      if (!cancelled) setL2csStatus(s);
    });

    // B3.23 — `sessionStorage` lido UMA vez, no mount.
    //
    // A leitura estava dentro do callback de gaze, ou seja, no caminho quente:
    // 30 acessos por segundo a uma API síncrona que atravessa a fronteira do
    // JS para o armazenamento do navegador. O valor é um modo de depuração
    // que ninguém alterna no meio de uma sessão — e se alterar, um F5 aplica.
    let isDevMode = false;
    try {
      isDevMode = sessionStorage.getItem('irisflow_dev_mode') === 'true';
    } catch {
      // sessionStorage indisponível (modo privado restritivo, iframe sem
      // permissão). Modo de depuração desligado é o default correto.
    }

    let cbInvocations = 0;
    const unsubGaze = engine.subscribe((sample) => {
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

      const engineIsCalibrating = engineRef.current?.getState() === 'calibrating';
      const isDegraded = sample.degraded === true;
      if (isDegraded !== isDegradedRef.current) {
        isDegradedRef.current = isDegraded;
        setIsDegraded(isDegraded);
      }

      // B3.25 — durante a calibração, só a EMERGÊNCIA continua acionável.
      //
      // A regra anterior zerava o dwell a cada frame enquanto `calibrating`,
      // com o raciocínio de que um dwell acidental corromperia a coleta. O
      // raciocínio vale para os botões da própria tela de calibração — e não
      // vale para o botão de emergência, que fica VISÍVEL durante os 1–2
      // minutos da coleta e ficava completamente inoperante.
      //
      // A política de exceção que existe para `degraded` nunca foi estendida
      // à calibração. O resultado: o paciente passa dois minutos olhando para
      // pontos, vê o botão de socorro na tela, e ele não responde. Para o
      // público-alvo, dois minutos sem via de comunicação não é detalhe.
      const alvoDuranteCalibracao = engineIsCalibrating
        ? ((document.elementFromPoint(sample.x, sample.y) as Element | null)
            ?.closest('[data-emergency="true"]') as HTMLElement | null)
        : null;

      if (engineIsCalibrating && !alvoDuranteCalibracao) {
        // Nada além da emergência é clicável: um dwell acidental na UI da
        // própria calibração corromperia a coleta.
        clearDwellVisuals();
        dwellStateRef.current = createDwellState();
      } else {
        const el = document.elementFromPoint(sample.x, sample.y);
        const node = el?.closest(DWELL_SELECTOR) as HTMLElement | null;

        // `data-dwell-ms` inválido (NaN) não pode virar dwell instantâneo.
        const rawCustom = node?.dataset.dwellMs ? parseInt(node.dataset.dwellMs, 10) : NaN;
        const customDwellMs = Number.isFinite(rawCustom) && rawCustom > 0 ? rawCustom : null;

        const target: DwellTarget | null = node
          ? {
              key: node,
              customDwellMs,
              isEmergency: node.dataset.emergency === 'true',
              // B1.9 — alvo de recuperação: aceito em `degraded` como o de
              // emergência, com dwell mais longo. É o que torna o botão
              // "Recalibre aqui" acionável exatamente no estado em que ele
              // aparece. Sem isto o banner é decorativo.
              isRecovery: node.dataset.recovery === 'true',
              isDisabled:
                (node as HTMLButtonElement).disabled ||
                node.getAttribute('aria-disabled') === 'true' ||
                node.dataset.noDwell === 'true',
            }
          : null;

        const outcome = stepDwell(
          dwellStateRef.current,
          {
            x: sample.x,
            y: sample.y,
            // O dwell tem de acompanhar o FLUXO DE AMOSTRAS, não o relógio do
            // render. Usar `performance.now()` aqui mediria o tempo de parede
            // do callback: se o engine parar de emitir (piscada, rosto
            // perdido, frame dropado), o relógio segue correndo e o dwell
            // completaria sozinho. `sample.timestamp` é carimbado pelo engine
            // na emissão.
            timestamp: Number.isFinite(sample.timestamp) ? sample.timestamp : now,
            hasFace: sample.hasFace,
            degraded: isDegraded,
            // Sem calibração o ponto é o fallback do nariz. O dispatcher
            // bloqueia tudo, inclusive emergência.
            uncalibrated: sample.uncalibrated === true,
            eyeState: sample.eyeState ?? 'unknown',
          },
          target,
          {
            dwellMs: dwellMsRef.current,
            emergencyDegradedMult: EMERGENCY_DEGRADED_MULT,
            recoveryDegradedMult: RECOVERY_DEGRADED_MULT,
            refractoryMs: REFRACTORY_MS,
            graceMs: DWELL_GRACE_MS,
            lostResetMs: DWELL_LOST_RESET_MS,
          },
        );
        dwellStateRef.current = outcome.state;

        // ── P7.3 — piscada como clique ──────────────────────────────────
        //
        // Roda em PARALELO ao dwell, não no lugar dele: o plano pede
        // "combinável com dwell (fixa + pisca = confirma)". As cinco guardas
        // (duração 150–800 ms, alvo estável há 300 ms, refratário de 1 s,
        // nunca em emergência) vivem no módulo puro.
        //
        // O alvo passado é `node`, não `outcome.hoverKey`: o `hoverKey` já
        // reflete a política do dwell (que zera durante a piscada, porque com
        // o olho fechado não há amostra válida). Alimentar a piscada-clique
        // com ele faria o alvo sumir justamente no quadro em que a piscada
        // começa — que é o mesmo defeito que a guarda de estabilidade do
        // módulo teve, e que os testes dele pegaram.
        //
        // ⚠️ As guardas de ESTADO DO SISTEMA vivem aqui, não no módulo puro.
        // `stepBlinkClick` conhece duração, estabilidade, refratário e
        // emergência — ele não sabe se o sistema está calibrado. Sem o filtro
        // abaixo, a piscada clicava onde o `stepDwell` se RECUSA a clicar:
        //
        //   - `uncalibrated`: o ponto emitido é o fallback do NARIZ, que não
        //     tem relação nenhuma com a direção do olhar. Uma piscada ali
        //     aciona um botão escolhido pela posição da cabeça — e o `dwell`
        //     bloqueia tudo nesse estado, inclusive a emergência, exatamente
        //     por isso.
        //   - `degraded`: a predição falhou. O `dwell` só permite emergência e
        //     recuperação, as duas com dwell mais LONGO. Deixar a piscada
        //     passar aqui daria o caminho mais curto justamente no estado
        //     menos confiável — e um "Recalibre aqui" disparado por engano
        //     custa 1–2 min de sessão a quem tem fadiga limitante.
        //   - `isDisabled`: cobre `disabled`, `aria-disabled` e
        //     `data-no-dwell`. Um botão que o dwell não clica não pode virar
        //     clicável só porque a pessoa piscou.
        const piscadaPermitida =
          sample.uncalibrated !== true
          && !isDegraded
          && target?.isDisabled !== true;

        if (EXPERIMENT.blinkClick) {
          const rb = stepBlinkClick(blinkClickRef.current, {
            piscando: sample.eyeState === 'closed',
            nowMs: now,
            // `null` quando o estado proíbe: o relógio de estabilidade não
            // deve acumular sobre um alvo que não poderia ser clicado.
            alvo: piscadaPermitida ? node : null,
            alvoEhEmergencia: target?.isEmergency === true,
          });
          blinkClickRef.current = rb.estado;
          if (rb.clicou) {
            const alvoDaPiscada = rb.clicou as HTMLElement;
            // Zera o dwell junto: sem isso, o relógio do dwell continuaria
            // correndo sobre o mesmo alvo e dispararia um SEGUNDO clique
            // pouco depois — o paciente confirmaria uma vez e a letra sairia
            // duas.
            clearDwellVisuals();
            dwellStateRef.current = createDwellState();
            if (alvoDaPiscada?.isConnected) alvoDaPiscada.click();
          }
        }

        // Realce: só o alvo apontado pelo outcome fica com `gaze-hover`.
        const hoverNode = outcome.hoverKey as HTMLElement | null;
        if (hoverNode !== hoveredNodeRef.current) {
          clearDwellVisuals();
          hoveredNodeRef.current = hoverNode;
          if (hoverNode?.isConnected) hoverNode.classList.add('gaze-hover');
        }

        if (outcome.effect.type === 'progress') {
          dwellPct = outcome.effect.pct;
          hitTarget = hoverNode;
          if (hoverNode?.isConnected) {
            hoverNode.style.setProperty('--gaze-dwell-progress', `${dwellPct}`);
          }
        } else if (outcome.effect.type === 'click') {
          const alvo = outcome.effect.targetKey as HTMLElement;
          clearDwellVisuals();

          // B2.14 — alimenta a calibração online com o clique confirmado.
          //
          // Esta chamada NÃO EXISTIA, apesar de `calibration.ts` afirmar que
          // "`feedOnlineSample` é disparado em todo dwell click da UI". A
          // cadeia de consequências: `biasSamples` ficava sempre em 0, então o
          // `DriftIndicator` (que exige `MIN_BIAS_SAMPLES = 20`) NUNCA
          // renderizava, e o interruptor "calibração online" em
          // `SettingsScreen` ligava um caminho que não recebia amostra nenhuma.
          // O cuidador tinha um botão que não fazia nada e um alerta de deriva
          // que nunca disparava.
          //
          // Conectada só agora, depois de `B2.8`: com o RLS anterior (λ com
          // semântica invertida) uma única amostra online anulava o Ridge
          // offline, e ligar isto teria degradado a predição em vez de
          // corrigi-la.
          //
          // Continua inócua por default — os DOIS consumidores estão atrás de
          // flag desligada (`sessionBiasEnabled` e `USE_ONLINE_CALIBRATION`).
          // O que muda é que agora existe sinal para elas consumirem quando o
          // F8.4 mandar ligar.
          try {
            // O alvo é o CENTRO do botão: é para lá que o paciente estava
            // olhando quando o dwell completou, não para o ponto exato do
            // cursor (que carrega justamente o erro que se quer corrigir).
            const r = alvo.getBoundingClientRect();
            engineRef.current?.calibration.feedOnlineSample?.(
              r.left + r.width / 2,
              r.top + r.height / 2,
            );
          } catch (err) {
            // Aprender com o clique é secundário; executá-lo não é.
            console.warn('[IrisFlow] feedOnlineSample falhou:', err);
          }

          // O refratário já está armado dentro de `outcome.state`, que foi
          // commitado ACIMA. Se o handler React lançar, o dwell não redispara
          // sob o mesmo olhar e o loop segue vivo.
          try {
            if (alvo.isConnected) alvo.click();
          } catch (err) {
            console.error('[IrisFlow] handler de clique por dwell lançou:', err);
          }
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
          if (anelRef.current) anelRef.current.ownerSVGElement!.style.opacity = '0';

          // P7.5 — o fallback NÃO roda aqui (não há cursor para segurar), mas
          // a mensagem dele precisa ser limpa.
          //
          // Sem isto, um "Posicione o rosto na câmera" emitido antes de a
          // calibração começar sobrevive à transição e fica na tela durante
          // os 1–2 minutos inteiros da coleta — sobre a própria UI de
          // calibração, mandando o paciente fazer algo que ele já está
          // fazendo. O `GazeFallback` também é zerado, senão ele retomaria
          // com uma âncora de posição de antes da calibração.
          if (gazeLostMessageRef.current !== null) {
            gazeLostMessageRef.current = null;
            setGazeLostMessage(null);
            fallbackRef.current.reset();
          }
        } else {
          // ── P7.5 — fallback de gaze perdido ────────────────────────────
          //
          // Com a flag desligada, `fb` reproduz o comportamento de sempre
          // (posição da amostra, cursor visível), então o caminho abaixo é o
          // mesmo de antes — nenhum paciente vê mudança sem alguém ligar.
          const fb = EXPERIMENT.gazeLostFallback
            ? fallbackRef.current.step({
                gazeValido: sample.hasFace,
                x: sample.x,
                y: sample.y,
                nowMs: now,
              })
            : {
                estado: 'ativo' as const,
                posicao: { x: sample.x, y: sample.y },
                mostrarCursor: true,
                mensagem: null,
                zerarDwell: false,
              };

          // O dwell é DESCARTADO na perda, não preservado — política oposta à
          // do `blinkHold`, e de propósito: numa piscada a pessoa continua
          // olhando para o alvo; com o rosto perdido, o olhar pode ter ido
          // para a porta.
          if (fb.zerarDwell) {
            clearDwellVisuals();
            dwellStateRef.current = createDwellState();
          }

          if (fb.mensagem !== gazeLostMessageRef.current) {
            gazeLostMessageRef.current = fb.mensagem;
            setGazeLostMessage(fb.mensagem);
          }

          if (!fb.mostrarCursor || fb.posicao === null) {
            cursorRef.current.style.transform = 'translate3d(-9999px,-9999px,0)';
            cursorRef.current.style.opacity = '0';
            if (anelRef.current) anelRef.current.ownerSVGElement!.style.opacity = '0';
          } else {
            // ── P7.1 — geometria e cores vêm do módulo puro ──────────────
            //
            // Em especial o `offsetPx`. O código anterior subtraía `24` — a
            // metade do `width:48px` escrita à mão em outro arquivo. Com o
            // tamanho ajustável, esse `24` desenharia um cursor de 96 px a
            // 24 px do ponto olhado; e esse erro não parece bug de layout,
            // parece erro de calibração: viés constante que piora conforme o
            // cursor cresce.
            const est = estiloDoCursor({
              tamanhoPx: limitarTamanho(EXPERIMENT.cursorSizePx),
              estado: hitTarget
                ? 'sobreAlvo'
                : isDegraded
                  ? 'degradado'
                  : fb.estado === 'segurando'
                    ? 'segurando'
                    : 'normal',
              dwellPct,
            });

            cursorRef.current.style.transform =
              `translate3d(${fb.posicao.x - est.offsetPx}px, ${fb.posicao.y - est.offsetPx}px, 0) scale(${est.escala})`;
            cursorRef.current.style.opacity =
              fb.estado === 'segurando' ? '0.5' : sample.hasFace ? '1' : '0.35';
            cursorRef.current.style.background = est.preenchimento;
            // O anel duplo é o que torna o cursor visível sobre QUALQUER
            // fundo: nenhuma cor sozinha contrasta com todos, e o vermelho
            // translúcido de antes sumia sobre o botão de emergência — que é
            // o pior alvo possível para o cursor sumir.
            cursorRef.current.style.boxShadow = est.anel;
            cursorRef.current.style.border = est.tracejado
              ? '2px dashed rgba(234,179,8,0.9)'
              : '';

            // ── P7.2 — anel de progresso do dwell ──────────────────────────
            if (anelRef.current) {
              const svg = anelRef.current.ownerSVGElement!;
              if (hitTarget) {
                const g = geometriaDoAnel(est.tamanhoPx, dwellPct);
                anelRef.current.setAttribute('stroke-dashoffset', String(g.offset));
                svg.style.transform =
                  `translate3d(${fb.posicao.x - g.centro}px, ${fb.posicao.y - g.centro}px, 0)`;
                svg.style.opacity = '1';
              } else {
                svg.style.opacity = '0';
              }
            }
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

      // Sincroniza o estado de isDwelling de forma segura sem floodar re-renders.
      // Lê o estado do redutor puro (`dwellStateRef`), que substituiu os sete
      // refs mutáveis anteriores.
      const targetExists = dwellStateRef.current.targetKey !== null;
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
        const stream = await openCameraWithFallback();
        // B1.8 — registra a stream ANTES de qualquer outra coisa. A partir
        // daqui o cleanup consegue pará-la mesmo que nunca cheguemos a
        // atribuí-la ao <video>.
        streamRef.current = stream;
        // E se o cleanup JÁ rodou enquanto esperávamos, a stream que acabou de
        // chegar não tem dono: para agora mesmo em vez de deixar a câmera
        // acesa até o GC.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          console.log('[IrisFlow] stream descartada — provider desmontado durante getUserMedia.');
          return;
        }
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

        // A resolução obtida é preditor DIRETO do erro final; não fica só num
        // log informativo. O sinal útil são poucos px de deslocamento da íris,
        // e escala linearmente com a densidade do sensor.
        if (video.videoWidth > 0 && video.videoWidth < 1920) {
          console.warn(
            `[IrisFlow] ⚠ câmera negociou ${video.videoWidth}x${video.videoHeight}, abaixo de 1920x1080. ` +
            `O erro de rastreamento escala com o inverso da densidade de pixels no rosto: ` +
            `a ${video.videoWidth}px de largura, espere ~${(1920 / video.videoWidth).toFixed(1)}× mais erro ` +
            `de landmark do que a 1080p. Verifique se a webcam suporta Full HD e se nenhum outro ` +
            `app está segurando o dispositivo numa resolução menor.`,
          );
        }

        // P4.3 — a trava de exposição SAIU DAQUI e foi para `autoTuneCamera`.
        //
        // O que existia aqui era um `setTimeout(2000)` que pedia
        // `exposureMode/focusMode/whiteBalanceMode = 'manual'` às cegas: sem
        // medir a imagem, sem escolher QUAL exposição, e sem nada a dizer
        // quando o driver não expunha os controles. Travar uma exposição ruim é
        // pior que deixá-la automática — a câmera perde a capacidade de
        // compensar e a imagem fica ruim pelo resto da sessão.
        //
        // Agora o plano vem de `planExposureStep`, que precisa de
        // `d.quality.brightness` — ou seja, precisa do engine rodando. Por isso
        // o lugar certo é depois da convergência da malha, em `autoTuneCamera`.
        // A flag continua sendo `lockCameraExposure` (default false).

        // P4.2 — registra a estratégia de captura que este navegador permite.
        //
        // Fica no log mesmo com a flag desligada, e de propósito: sem isso,
        // uma gravação feita numa máquina sem `MediaStreamTrackProcessor` é
        // indistinguível de outra feita com ele, e as duas têm jitter de
        // agendamento diferente. É contexto que o Dia 7 vai precisar.
        const capturePlan = planCaptureStrategy(detectCaptureEnvironment());
        console.log(
          `[capture] estratégia possível: ${capturePlan.strategy} ` +
          `(fora do thread principal: ${capturePlan.offMainThread ? 'sim' : 'não'}) — ` +
          capturePlan.reasons.join(' | '),
        );
        if (EXPERIMENT.captureWorker && !capturePlan.offMainThread) {
          console.warn(
            '[capture] captureWorker está LIGADA mas este navegador não permite a captura sair ' +
            'do thread principal. O caminho segue o de sempre — a flag não tem efeito aqui.',
          );
        }
        // B1.8 — segundo ponto de saída, depois de `loadeddata` e do warm-up
        // de exposição. Antes o `return` aqui era nu: saía sem parar as
        // tracks, deixando um decode de 1080p vivo pelo resto da página.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          console.log('[IrisFlow] stream parada — provider desmontado durante o warm-up.');
          return;
        }
        await engine.start(video);
        console.log('[IrisFlow] engine.start() concluído; loop rAF em execução.');

        // ── P5.5 — hooks de console para a medição de latência ──────────────
        //
        // Sem isto, `stageLatency` só existia dentro do contexto React: não
        // havia caminho pelo DevTools, e o roteiro de medição de
        // `docs/LATENCIA_L2CS.md` não era executável.
        //
        // `__irisflowDiag()` devolve o diagnóstico inteiro;
        // `__irisflowLatencia()` imprime só a tabela de estágios, ordenada
        // pelo p95 — que é o número que decide onde o orçamento está sendo
        // gasto. Ambos são removidos no cleanup do provider.
        if (typeof window !== 'undefined') {
          const w = window as unknown as Record<string, unknown>;
          w.__irisflowDiag = () => engineRef.current?.getDiagnostics() ?? null;
          w.__irisflowLatencia = () => {
            const d = engineRef.current?.getDiagnostics();
            if (!d) {
              console.warn('[latencia] engine não está rodando.');
              return null;
            }
            const linhas = Object.entries(d.stageLatency)
              .map(([estagio, s]) => ({
                estagio,
                p50ms: +s.p50Ms.toFixed(2),
                p95ms: +s.p95Ms.toFixed(2),
                amostras: s.count,
                // `orphanEnds > 0` é bug de instrumentação, não de latência —
                // significa `end()` sem `begin()`. Fica na tabela para não
                // passar despercebido.
                orfaos: s.orphanEnds,
              }))
              .sort((a, b) => b.p95ms - a.p95ms);
            console.table(linhas);
            // ⚠️ `stalePct` JÁ vem em percentual (0–100), não em fração —
            // `engine.ts` faz o `× 100` na origem. A primeira versão desta
            // linha multiplicava de novo e imprimia `stale=10000.0%`, que é
            // absurdo o bastante para ser notado; se o valor real fosse 0,5%
            // teria virado 50% e passaria como plausível.
            console.log(
              `[latencia] fps=${d.fpsRender.toFixed(1)} l2cs=${d.l2cs.hz.toFixed(1)} Hz ` +
              `inferência=${d.l2cs.latencyMs.toFixed(0)} ms stale=${d.l2cs.stalePct.toFixed(1)}% ` +
              `crop=${EXPERIMENT.l2csInputSize}² ep=${d.l2cs.executionProvider ?? '?'}`,
            );
            if (d.l2cs.stalePct > 50) {
              console.warn(
                `[latencia] ${d.l2cs.stalePct.toFixed(0)}% das leituras do L2CS estão OBSOLETAS ` +
                `(inferência ${d.l2cs.latencyMs.toFixed(0)} ms contra tolerância de 400 ms). ` +
                'O bloco angular está sendo zerado — as features [4] e [5] do vetor não carregam sinal.',
              );
            }
            return linhas;
          };
          // ── Verificação pré-sessão ────────────────────────────────────
          //
          // Transforma a lista de "lembre-se de" do protocolo `F8.1` num
          // comando só. Cada item dessa lista é uma forma de perder a sessão —
          // e o modo de falha que mais preocupa não é esquecer, é esquecer e
          // NÃO PERCEBER: rodar a condição inteira com a flag da anterior
          // produz dado de aparência perfeita, atribuído à condição errada.
          //
          // O parâmetro opcional é a condição PRETENDIDA. Declará-la é o que
          // pega o erro mais provável do dia — `__irisflowExp.set` só passa a
          // valer depois de recarregar a página.
          //
          //   __irisflowPreflight()
          //   __irisflowPreflight({ filterMode: 'kalmanEma', l2csInputSize: 224 })
          w.__irisflowPreflight = async (
            condicaoEsperada?: Record<string, unknown>,
          ) => {
            const d = engineRef.current?.getDiagnostics();
            if (!d) {
              console.warn('[preflight] engine não está rodando.');
              return null;
            }

            // Taxa de atualização medida na hora: 30 quadros de rAF. É curto
            // de propósito — o operador não vai esperar, e a taxa não varia.
            const hz = await new Promise<number | null>((resolve) => {
              const t: number[] = [];
              const passo = () => {
                t.push(performance.now());
                if (t.length <= 30) requestAnimationFrame(passo);
                else {
                  const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
                  resolve(dt > 0 ? 1000 / dt : null);
                }
              };
              requestAnimationFrame(passo);
            });

            const itens = preflight({
              estadoEngine: engineRef.current?.getState() ?? 'desconhecido',
              calibrado: engineRef.current?.calibration.isCalibrated() ?? false,
              telaPolegadas: settings.screenDiagonalIn,
              origemGeometria: settings.screenGeometrySource ?? 'default',
              distanciaCm: settings.viewingDistanceCm,
              viewportPx: {
                w: document.documentElement.clientWidth,
                h: document.documentElement.clientHeight,
              },
              telaPx: { w: window.screen.width, h: window.screen.height },
              taxaAtualizacaoHz: hz,
              l2cs: {
                status: d.l2cs.status,
                executionProvider: d.l2cs.executionProvider ?? null,
                stalePct: d.l2cs.stalePct,
                pendingCount: d.l2cs.pendingCount,
              },
              filtro: d.filtro,
              flags: EXPERIMENT as unknown as Record<string, unknown>,
              condicaoEsperada,
            });

            const icone = { ok: '✅', atencao: '⚠️', bloqueio: '⛔' } as const;
            console.table(itens.map((i) => ({
              '': icone[i.nivel], item: i.item, detalhe: i.detalhe, ação: i.acao ?? '',
            })));
            if (podeComecar(itens)) {
              console.log('[preflight] ✅ PODE COMEÇAR.');
            } else {
              console.warn(
                '[preflight] ⛔ NÃO COMECE — os itens marcados produziriam dado que '
                + 'será descartado. Resolva-os e rode de novo.',
              );
            }
            return itens;
          };

          console.log(
            '[IrisFlow] console: __irisflowPreflight() ANTES de medir · ' +
            '__irisflowLatencia() para a tabela de estágios · ' +
            '__irisflowDiag() para o diagnóstico completo.',
          );
        }

        // Ajuste automático da câmera. Roda DEPOIS do engine porque a malha
        // se fecha sobre o tamanho do rosto, que só existe com o detector de
        // landmarks rodando. Deliberadamente sem `await`: são ~8 s de
        // convergência e o app não pode ficar parado esperando — a
        // pré-calibração já mostra o estado enquanto o ajuste acontece.
        void autoTuneCamera(stream, engine, () => cancelled);
      } catch (err) {
        console.error('[IrisFlow] Falha ao inicializar câmera/engine:', err);
        if (!cancelled) {
          setCameraError(
            err instanceof Error && err.message
              ? err.message
              : 'Falha ao inicializar a câmera. Recarregue a página.',
          );
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
      unsubState();
      unsubInvalid();
      unsubL2CSStatus();
      unsubGaze();
      // B1.8/B1.7 — `dispose()` em vez de `stop()`. `stop()` só para o loop;
      // `dispose()` fecha o FaceLandmarker (heap WASM + contexto GPU) e para
      // o worker L2CS com ~91 MB de sessão ONNX. Sem isso cada mount vazava
      // esses recursos — dois mounts em StrictMode = ~182 MB de ONNX vivos.
      //
      // O try/catch não é decorativo: uma exceção aqui abortaria o resto do
      // cleanup — incluindo `provedorAtivo--` e o `track.stop()` — e deixaria
      // o provider permanentemente travado, com a câmera acesa. Falhar ao
      // liberar um recurso não pode impedir a liberação dos outros.
      try {
        engine.dispose();
      } catch (e) {
        console.warn('[IrisFlow] engine.dispose() falhou durante o cleanup:', e);
      }
      engineRef.current = null;
      // P5.5 — remove os hooks de console junto com o engine. Deixá-los vivos
      // apontando para um engine descartado devolveria `null` em silêncio, e
      // quem estivesse medindo leria isso como "o estágio não rodou".
      if (typeof window !== 'undefined') {
        delete (window as unknown as Record<string, unknown>).__irisflowDiag;
        delete (window as unknown as Record<string, unknown>).__irisflowLatencia;
        delete (window as unknown as Record<string, unknown>).__irisflowPreflight;
      }
      // Libera o guard de instância única. Vem DEPOIS do dispose para que um
      // remount imediato não encontre recursos meio liberados.
      provedorAtivo = Math.max(0, provedorAtivo - 1);

      // B1.8 — a stream vem do ref, não de `videoRef.current?.srcObject`.
      // Quando o cleanup roda durante o await de `getUserMedia`, `srcObject`
      // ainda é null e a leitura antiga devolvia `null`: nenhuma track era
      // parada e a câmera ficava acesa. O `?? ` mantém o caminho antigo como
      // rede de segurança para o caso de a stream ter sido trocada no <video>
      // por outro caminho.
      const stream = streamRef.current
        ?? (videoRef.current?.srcObject as MediaStream | null);

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
            .then(() => console.log('[camera] câmera restaurada ao estado original.'))
            .catch((e) => console.warn('[camera] restauração da câmera falhou:', e));
        } catch (e) {
          console.warn('[camera] restauração da câmera falhou:', e);
        }
      }
      originalCameraSettingsRef.current = null;

      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      videoRef.current?.remove();
      videoRef.current = null;

      cursorRef.current?.remove();
      cursorRef.current = null;
      anelRef.current?.ownerSVGElement?.remove();
      anelRef.current = null;
    };
  }, []);

  // calibration must have STABLE identity across renders — consumers put it in
  // useEffect deps and any change here would fire their cleanup mid-flow.
  // The functions read engineRef.current lazily, so the ref stays fresh even
  // though the object identity never changes.
  const calibration = useMemo<CalibrationApi>(
    () => ({
      startCalibrationMode: (opts) => engineRef.current?.calibration.startCalibrationMode(opts),
      getCalibrationTargets: () => engineRef.current?.calibration.getCalibrationTargets() ?? [],
      getCalibrationMode: () => engineRef.current?.calibration.getCalibrationMode() ?? null,
      startCollectingPoint: (x, y, onDone) => engineRef.current?.calibration.startCollectingPoint(x, y, onDone),
      completeCalibration: (onComplete) => engineRef.current?.calibration.completeCalibration(onComplete),
      // 1.1-UI — deriva de pose da calibração recém-treinada, para a tela poder
      // avisar em vez de deixar o usuário seguir com um modelo contaminado.
      getPoseDriftVerdict: () => engineRef.current?.calibration.getPoseDriftVerdict() ?? null,
      abort: () => engineRef.current?.calibration.abort(),
      clear: () => engineRef.current?.calibration.clear(),
      isCalibrated: () => engineRef.current?.calibration.isCalibrated() ?? false,
      feedOnlineSample: (x, y) => engineRef.current?.calibration.feedOnlineSample(x, y) ?? false,
      setOnlineCalibrationEnabled: (enabled) =>
        engineRef.current?.calibration.setOnlineCalibrationEnabled(enabled),
      onlineSampleCount: () => engineRef.current?.calibration.onlineSampleCount() ?? 0,
      setEyeDominance: (d) => engineRef.current?.calibration.setEyeDominance(d),
      setCameraFovDeg: (fov) => engineRef.current?.calibration.setCameraFovDeg(fov),
      getCalibrationDistancesCm: () =>
        engineRef.current?.calibration.getCalibrationDistancesCm()
        ?? { cameraCm: null, screenCm: null },
      setCalibrationDistancesCm: (cameraCm, screenCm) =>
        engineRef.current?.calibration.setCalibrationDistancesCm(cameraCm, screenCm),
      getCurrentCameraDistanceCm: () =>
        engineRef.current?.calibration.getCurrentCameraDistanceCm() ?? null,
      getDistanceRange: () => engineRef.current?.calibration.getDistanceRange() ?? null,
      onInvalidated: (cb) => engineRef.current?.calibration.onInvalidated(cb) ?? (() => {}),
      setSessionBiasEnabled: (enabled) => engineRef.current?.calibration.setSessionBiasEnabled(enabled),
      resetSessionBias: () => engineRef.current?.calibration.resetSessionBias(),
      getSessionBias: () => engineRef.current?.calibration.getSessionBias() ?? { x: 0, y: 0, samples: 0 },
      getRecentBlinkRatePerMinute: (windowMs) => engineRef.current?.calibration.getRecentBlinkRatePerMinute(windowMs) ?? 0,
      getActiveOpticalCondition: () => engineRef.current?.calibration.getActiveOpticalCondition() ?? 'desconhecido',
    }),
    [],
  );

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


  // ── P6.9 — aviso de distância, a 2 Hz ────────────────────────────────────
  //
  // 2 Hz e não por quadro: a distância muda na escala de segundos (a pessoa se
  // reacomoda na cadeira), e reavaliar 30 vezes por segundo só gastaria
  // re-render. A histerese do `AvisoDeDistancia` cuida da estabilidade; a
  // cadência baixa cuida do custo.
  //
  // O `setState` só acontece quando o TEXTO muda — sem isso, cada tique
  // re-renderizaria os consumidores do contexto com o mesmo valor.
  useEffect(() => {
    const id = setInterval(() => {
      const faixa = engineRef.current?.calibration.getDistanceRange?.() ?? null;
      const calibradaCm = engineRef.current?.calibration.getCalibrationDistancesCm().screenCm ?? null;
      const r = avisoDistanciaRef.current.avaliar(faixa?.screenDistanceNowCm ?? null, calibradaCm);
      setDistanceAdvice((anterior) => (anterior === r.mensagem ? anterior : r.mensagem));
    }, 500);
    return () => clearInterval(id);
  }, []);

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
      // B3.23 — `isDwelling` continua exposto aqui por compatibilidade, mas
      // NÃO entra nas deps do memo: quem precisa dele deve usar
      // `useIsDwelling()`, que assina o contexto separado. Ler daqui devolve o
      // valor do último render em que outra coisa mudou, o que é suficiente
      // para os consumidores que apenas o repassam, e evita re-renderizar os
      // onze consumidores várias vezes por segundo.
      isDwelling,
      isComposing,
      setIsComposing,
      isDegraded,
      cameraError,
      calibrationInvalidated,
      gazeLostMessage,
    }),
    // `isDwelling` deliberadamente FORA das deps — ver o comentário acima e
    // `DwellContext`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscribe, state, l2csStatus, calibration, recording, isComposing, setIsComposing, isDegraded, cameraError, calibrationInvalidated, gazeLostMessage],
  );

  return (
    <GazeContext.Provider value={value}>
      {/* Falhas que desligam o controle por olhar precisam ser VISÍVEIS. Sem
          isto, `cameraError` e `calibrationInvalidated` eram calculados e
          nunca renderizados: o usuário ficava com cursor invisível e nada
          clicável, sem explicação. */}
      <GazeStatusBanner
        state={state}
        cameraError={cameraError}
        calibrationInvalidated={calibrationInvalidated}
        distanceAdvice={distanceAdvice}
        gazeLostMessage={gazeLostMessage}
      />
      {/* P7.4 — a varredura fica DENTRO do provider e FORA do `DwellContext`:
          ela não depende de dwell (é o que resta quando o dwell não é
          alcançável) e não deve re-renderizar a cada alternância dele. */}
      <ScanningMode />
      {/* B3.23 — `isDwelling` num provider próprio, POR DENTRO do principal.
          Uma alternância de dwell agora só invalida este contexto; os
          consumidores que assinam apenas `useGaze()` não re-renderizam. */}
      <DwellContext.Provider value={isDwelling}>
        {children}
      </DwellContext.Provider>
    </GazeContext.Provider>
  );
};
