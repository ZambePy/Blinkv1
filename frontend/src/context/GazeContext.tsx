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
import type {
  GazeEngine,
  GazeSample,
  EngineState,
  CalibrationApi,
  L2CSStatus,
  RecordingApi,
  EngineDiagnostics,
} from '@tracker/tracker/engine';
import {
  stepDwell,
  createDwellState,
  DEFAULT_DWELL_CONFIG,
  type DwellTarget,
} from '@tracker/interaction/dwell';
import { velocidadeDaBorda, estadoInicialDeBorda } from '@tracker/interaction/edgeScroll';
import { rolarSobOOlhar } from '../rolarSobOOlhar';
import { estiloDoCursor, limitarTamanho } from '@tracker/interaction/cursorStyle';
import { geometriaDoAnel } from '@tracker/interaction/dwellRing';
import { GazeFallback } from '@tracker/interaction/gazeFallback';
import { DetectorDeOlharForaDaTela } from '@tracker/interaction/olharForaDaTela';
import { DetectorDeOlhosFechados } from '@tracker/interaction/olhosFechados';
import { preflight, podeComecar } from '@tracker/diagnostics/preflight';
import { isAccuracyTesting } from '@tracker/accuracy';
import { stepBlinkClick, criarEstadoBlinkClick } from '@tracker/interaction/blinkClick';
import { GazeStatusBanner } from '../components/GazeStatusBanner';
import { ScanningMode } from '../components/ScanningMode';
import type { FilterPreset, FilterPresetV2 } from '@tracker/oneEuroFilter';
import { EXPERIMENT } from '@tracker/config/experiment';
import {
  planTuningStep,
  planStabilizationStep,
  type CameraCapabilities,
  type CameraState,
  type TuningStep,
} from '@tracker/cameraTuner';
import { getSaturacaoDoOlhar } from '@tracker/calibration';
import { detectFlicker, inferPowerLineHz } from '@tracker/flickerDetector';
import { AvisoDeDistancia } from '@tracker/distanceAdvisory';
import { useSettings } from './SettingsContext';
import { isDevMode, onDevModeChange } from '../devMode';
import { limitarDwellMs } from '../dwellMs';

export type {
  GazeEngine,
  GazeSample,
  EngineState,
  L2CSStatus,
  RecordingApi,
  EngineDiagnostics,
} from '@tracker/tracker/engine';

// Dwell time by user preset (matches DwellButton's own table).
// `DWELL_MS_BY_SPEED` morava aqui, convertendo o enum `dwellSpeed` em ms.
// O tempo de permanência passou a ser um número nas configurações — três
// degraus não cobrem a distância entre ELA avançada e boa fixação — e a
// conversão deixou de existir. Ver `dwellMs.ts`.
// Data-no-dwell="true" on any element that should opt out.
export const DWELL_SELECTOR = 'button, a, [role="button"], [role="link"]';

/**
 * Suspensão do dwell do APP.
 *
 * No Modo Computador a janela do app fica escondida, mas o motor continua
 * emitindo (é ele que alimenta a sobreposição sobre o Windows) e este
 * dispatcher continuaria clicando nos botões da tela oculta — inclusive no
 * botão flutuante de emergência, que fica acima de qualquer escudo visual.
 * Com o dwell suspenso, nenhum alvo do app acumula; o clique por piscada
 * também para. É uma variável de módulo, não estado React: precisa valer no
 * mesmo frame em que o modo liga, sem esperar re-render.
 */
let dwellSuspenso = false;
export function suspenderDwell(suspenso: boolean): void {
  dwellSuspenso = suspenso;
}
export function dwellEstaSuspenso(): boolean {
  return dwellSuspenso;
}

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
  /** Preenchido quando o pipeline mudou sob um perfil salvo e o modelo foi
   *  descartado. Sem isto o app ia para `degraded` em silêncio: cursor no
   *  fallback do nariz, sem dizer que a saída era recalibrar. */
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
   * Mensagem quando o gaze está perdido além do hold, ou `null`.
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
 * Contexto separado só para `isDwelling`.
 *
 * O valor alterna várias vezes por segundo no teclado ocular (teclas vizinhas
 * + jitter do cursor). Se entrasse nas deps do `useMemo` do contexto
 * principal, cada alternância re-renderizaria todos os consumidores de
 * `useGaze()` — e só o teclado lê o campo.
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
      console.log(
        `[IrisFlow] câmera aberta (pedido: ${rotulo}) → ${t?.width}×${t?.height} @ ${t?.frameRate ?? '?'}fps`
      );
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
 * Guard de instância única do provider.
 *
 * Precisa ser de MÓDULO, não um ref: o cleanup zera `engineRef.current`, então
 * no segundo mount do StrictMode um guard baseado no ref não barraria nada e
 * nasceria um segundo engine com um segundo `getUserMedia`.
 */
let provedorAtivo = 0;

export const GazeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { settings } = useSettings();
  // Os hooks de console e o boot leem as configurações fora do ciclo de render;
  // o ref garante que vejam o valor atual, não o do primeiro render.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const engineRef = useRef<GazeEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Stream da câmera, guardada assim que `getUserMedia` resolve. Se o cleanup
  // rodar durante o await, `video.srcObject` ainda é null — este ref é o que
  // garante que as tracks sejam paradas mesmo assim.
  const streamRef = useRef<MediaStream | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<EngineState>('idle');
  const [l2csStatus, setL2csStatus] = useState<L2CSStatus>('loading');
  const [isDwelling, setIsDwelling] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isDegraded, setIsDegraded] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /** Aviso de distância fora da faixa de calibração. */
  const [distanceAdvice, setDistanceAdvice] = useState<string | null>(null);
  const avisoDistanciaRef = useRef(new AvisoDeDistancia());
  const [calibrationInvalidated, setCalibrationInvalidated] = useState<string | null>(null);
  const isDegradedRef = useRef(false);
  const wasDwellingRef = useRef(false);

  // Sub pool: subscribers can hook in and receive callbacks. We keep the callback
  // model instead of React state to avoid re-rendering the tree at 30 Hz.
  const subscribersRef = useRef<Set<(s: GazeSample) => void>>(new Set());
  const cameraTuningRef = useRef<TuningStep | null>(null);
  // Estado da câmera antes de qualquer ajuste nosso, para restaurar ao sair.
  const originalCameraSettingsRef = useRef<Record<string, number | string> | null>(null);

  // Global dwell dispatcher state. Kept in refs to avoid re-renders — the loop
  // runs at 30 Hz and reads/writes these directly from the gaze callback.
  const dwellMsRef = useRef<number>(limitarDwellMs(settings.dwellMs));
  // Todo o estado do dwell vive num único objeto imutável, avançado pelo
  // redutor puro de `src/interaction/dwell.ts`. Refs soltos mutados em pontos
  // diferentes do callback saem de sincronia (dwell completando de olho fechado).
  const dwellStateRef = useRef(createDwellState());
  /** Estado da rolagem por borda: em qual faixa o olhar está e desde quando. */
  const bordaRef = useRef(estadoInicialDeBorda());
  /** Instante da última amostra, para converter velocidade em deslocamento. */
  const ultimaRolagemMsRef = useRef(0);
  // Gaze perdido: segura a última posição válida por 2 s, depois esconde e avisa.
  const fallbackRef = useRef(new GazeFallback());
  const [gazeLostMessage, setGazeLostMessage] = useState<string | null>(null);
  const gazeLostMessageRef = useRef<string | null>(null);

  // Cursor parado na borda porque o olhar saiu da área da tela. Estado
  // separado do `gazeLostMessage`: são sintomas parecidos na tela e causas
  // opostas — ali o rosto sumiu, aqui o rosto está presente e o olhar está
  // fora do monitor.
  const foraDaTelaRef = useRef(new DetectorDeOlharForaDaTela());
  const [avisoDeBorda, setAvisoDeBorda] = useState<string | null>(null);
  const avisoDeBordaRef = useRef<string | null>(null);

  // Pálpebra cobrindo a íris (o caso de olhar para baixo) ou olhos fechados
  // por tempo demais: o cursor congela com o rosto presente e o dwell pausa,
  // tudo correto e tudo silencioso.
  const olhosFechadosRef = useRef(new DetectorDeOlhosFechados());
  const [avisoDeOlhosFechados, setAvisoDeOlhosFechados] = useState<string | null>(null);
  const avisoDeOlhosFechadosRef = useRef<string | null>(null);
  // O `<circle>` do anel de progresso, quando a flag está ligada.
  const anelRef = useRef<SVGCircleElement | null>(null);
  // Piscada como clique. Desligada por default; ver a flag.
  const blinkClickRef = useRef(criarEstadoBlinkClick());
  // Nó que está com o realce `gaze-hover` aplicado no DOM.
  const hoveredNodeRef = useRef<HTMLElement | null>(null);

  /** Remove realce e barra de progresso do nó atualmente destacado. */
  const clearDwellVisuals = React.useCallback(() => {
    const n = hoveredNodeRef.current;
    if (n) {
      n.classList.remove('gaze-hover');
      n.style.removeProperty('--gaze-dwell-progress');
    }
    hoveredNodeRef.current = null;
  }, []);

  useEffect(() => {
    dwellMsRef.current = limitarDwellMs(settings.dwellMs);
  }, [settings.dwellMs]);

  // Propaga a dominância ocular do usuário ao pipeline. Feito num useEffect
  // separado para reagir a mudanças em tempo real (SettingsScreen troca
  // sem recarregar). Se o engine ainda não montou, fica pendente até o
  // primeiro chamado — o próprio calibration guarda o valor em módulo.
  useEffect(() => {
    engineRef.current?.calibration.setEyeDominance?.(settings.eyeDominance);
  }, [settings.eyeDominance]);

  // Geometria da tela para os filtros que trabalham em graus. Também é
  // reaplicada quando o engine sobe (ver o boot), porque este efeito pode
  // rodar antes de `createGazeEngine`.
  useEffect(() => {
    engineRef.current?.setScreenGeometry(settings.screenDiagonalIn, settings.viewingDistanceCm);
  }, [settings.screenDiagonalIn, settings.viewingDistanceCm]);

  // O campo de visão habilita a compensação de distância: sem ele o pipeline
  // não converte tamanho de rosto em centímetros e a compensação fica inativa.
  // Propagado em efeito próprio para reagir à calibração de FOV feita em
  // configurações sem exigir recarregar.
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
  const autoTuneCamera = useCallback(
    async (stream: MediaStream, engine: GazeEngine, isCancelled: () => boolean): Promise<void> => {
      const track = stream.getVideoTracks()[0];
      if (!track || typeof track.getCapabilities !== 'function') return;

      let rawCaps: Record<string, unknown> = {};
      try {
        rawCaps = track.getCapabilities() as unknown as Record<string, unknown>;
      } catch {
        return;
      }

      // Fotografa o estado original antes de mexer: `applyConstraints` altera o
      // dispositivo, não só a nossa view dele — em vários drivers o zoom e o
      // brilho que deixamos aqui aparecem no Teams depois. Devolvemos ao sair.
      try {
        const st = track.getSettings() as unknown as Record<string, unknown>;
        const keys = [
          'zoom',
          'brightness',
          'contrast',
          'exposureMode',
          'whiteBalanceMode',
          'focusMode',
          'powerLineFrequency',
        ];
        const snap: Record<string, number | string> = {};
        for (const k of keys) {
          const v = st[k];
          if (typeof v === 'number' || typeof v === 'string') snap[k] = v;
        }
        originalCameraSettingsRef.current = snap;
        console.log('[camera] estado original da câmera guardado para restauração:', snap);
      } catch {
        /* getSettings indisponível: não há o que restaurar */
      }

      // Usa a MAIOR resolução que a câmera oferece, até o teto.
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
            console.log(
              `[camera] resolução ${cur} → ${track.getSettings().width} (máx do driver: ${wCap.max})`
            );
          } catch (e) {
            console.warn('[camera] não foi possível subir a resolução:', e);
          }
        }
        if (wCap.max > MAX_USEFUL_WIDTH) {
          console.log(
            `[camera] câmera suporta até ${wCap.max}px de largura; usando ${MAX_USEFUL_WIDTH} ` +
              `para o FaceLandmarker sustentar 30 fps.`
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
        exposureMode: Array.isArray(rawCaps.exposureMode)
          ? (rawCaps.exposureMode as string[])
          : undefined,
        focusMode: Array.isArray(rawCaps.focusMode) ? (rawCaps.focusMode as string[]) : undefined,
        whiteBalanceMode: Array.isArray(rawCaps.whiteBalanceMode)
          ? (rawCaps.whiteBalanceMode as string[])
          : undefined,
        powerLineFrequency: Array.isArray(rawCaps.powerLineFrequency)
          ? (rawCaps.powerLineFrequency as number[])
          : undefined,
      };
      console.log('[camera] capabilities da câmera:', {
        zoom: caps.zoom,
        brightness: caps.brightness,
        exposureMode: caps.exposureMode,
        whiteBalanceMode: caps.whiteBalanceMode,
      });

      const settle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      // O auto-exposure precisa de ~2 s para convergir; medir antes disso
      // ajustaria o brilho contra um valor que ainda está mudando sozinho.
      await settle(2000);

      const MAX_ITER = 14;
      let ultimoBrilho: number | undefined;
      let convergiu = false;
      for (let i = 0; i < MAX_ITER; i++) {
        if (isCancelled()) return;
        const d = engine.getDiagnostics();
        if (!d) {
          await settle(300);
          continue;
        }

        const iodFraction = d.video.width > 0 ? d.framing.iodPx / d.video.width : 0;
        let state: CameraState = {};
        try {
          const st = track.getSettings() as unknown as Record<string, unknown>;
          state = {
            zoom: typeof st.zoom === 'number' ? st.zoom : undefined,
            brightness: typeof st.brightness === 'number' ? st.brightness : undefined,
            contrast: typeof st.contrast === 'number' ? st.contrast : undefined,
          };
        } catch {
          /* getSettings indisponível: o planner usa os defaults da faixa */
        }

        const step = planTuningStep(caps, state, {
          hasFace: d.framing.hasFace,
          iodFraction,
          brightness: d.quality.brightness,
          contrast: d.quality.contrast,
        });
        cameraTuningRef.current = step;
        ultimoBrilho = d.quality.brightness;
        convergiu = step.converged;

        if (step.converged || Object.keys(step.constraints).length === 0) {
          if (step.reasons.length) console.log('[camera]', step.reasons.join(' | '));
          if (step.physicalAdvice)
            console.warn('[camera] ação física necessária:', step.physicalAdvice);
          break;
        }

        console.log('[camera]', step.reasons.join(' | '));
        try {
          await track.applyConstraints(step.constraints as MediaTrackConstraints);
        } catch (e) {
          // Driver recusou. Insistir na mesma constraint só gastaria iterações.
          console.warn('[camera] applyConstraints rejeitado, ajuste interrompido:', e);
          break;
        }
        await settle(450);
      }

      if (isCancelled()) return;
      // Cintilação: mede a série de brilho na cadência de frame e, se houver
      // batimento compatível com 50/60 Hz, corrige na origem pelo driver.
      let powerLineHz: 50 | 60 | null = null;
      const dFinal = engine.getDiagnostics();
      if (dFinal && dFinal.brightnessHistoryFps > 0) {
        const flick = detectFlicker(dFinal.brightnessHistory, dFinal.brightnessHistoryFps);
        if (flick.detected) {
          powerLineHz = inferPowerLineHz(flick.dominantHz, dFinal.brightnessHistoryFps);
          console.warn(
            `[camera] cintilação de ${flick.dominantHz.toFixed(1)} Hz ` +
              `(${(flick.relativeAmplitude * 100).toFixed(1)}% do brilho)` +
              (powerLineHz ? ` → rede de ${powerLineHz} Hz` : ' → origem não elétrica')
          );
        }
      }

      // Travar exposição/balanço/foco só faz sentido com a imagem boa: travar
      // uma imagem escura porque o zoom bateu no limite congelaria o problema
      // pelo resto da sessão. Sem brilho medido, a exposição segue automática.
      const imagemBoa =
        typeof ultimoBrilho === 'number' && ultimoBrilho >= 0.25 && ultimoBrilho <= 0.75;
      const stab = planStabilizationStep(caps, powerLineHz);
      const constraints: Record<string, unknown> = {};
      if (stab.constraints.powerLineFrequency !== undefined) {
        constraints.powerLineFrequency = stab.constraints.powerLineFrequency;
      }
      if (convergiu || imagemBoa) {
        for (const k of ['exposureMode', 'whiteBalanceMode', 'focusMode'] as const) {
          if (stab.constraints[k] !== undefined) constraints[k] = stab.constraints[k];
        }
      } else if (ultimoBrilho !== undefined) {
        console.log(
          `[camera] brilho ${ultimoBrilho.toFixed(2)} fora da faixa — exposição segue automática.`
        );
      }
      if (Object.keys(constraints).length > 0) {
        try {
          await track.applyConstraints(constraints as MediaTrackConstraints);
          console.log(
            '[camera] estabilização:',
            Object.entries(constraints)
              .map(([k, v]) => `${k} → ${v}`)
              .join(' | ')
          );
        } catch (e) {
          console.warn('[camera] estabilização rejeitada (exposição segue automática):', e);
        }
      } else if (stab.physicalAdvice) {
        console.warn('[camera]', stab.physicalAdvice);
      }
    },
    []
  );

  useEffect(() => {
    // React StrictMode em dev roda useEffect duas vezes (mount → cleanup → mount).
    // getUserMedia + FaceLandmarker são caros e mantêm estado global (module-scope
    // da calibração), então travamos a segunda inicialização. Em produção o guard
    // é inofensivo — StrictMode não faz double-invoke fora de dev.
    // Ver `provedorAtivo` para o motivo de ser um contador de módulo.
    if (provedorAtivo > 0) {
      // Este provider fica sem engine: toda chamada de calibração vira no-op.
      // Silenciar isso deixava o app vivo por fora e morto por dentro — a tela
      // de calibração esperando um callback que nunca chegaria. Falha visível.
      console.error('[IrisFlow] GazeProvider duplicado — este provider fica sem engine.');
      setCameraError(
        'O rastreamento não pôde iniciar porque já existe outra instância ativa. ' +
          'Feche as outras janelas do app e recarregue.'
      );
      return;
    }
    provedorAtivo++;

    let cancelled = false;

    const engine = createGazeEngine();
    engineRef.current = engine;

    // Os efeitos de `eyeDominance` e `cameraHorizontalFovDeg` acima rodam
    // ANTES deste (ordem de declaração), quando `engineRef` ainda é null: sem
    // esta aplicação inicial, um FOV calibrado e salvo só voltaria a valer
    // quando o cuidador o alterasse — e sem FOV a compensação de distância
    // e o aviso de distância ficam inativos em silêncio.
    engine.calibration.setEyeDominance(settingsRef.current.eyeDominance);
    engine.calibration.setCameraFovDeg(settingsRef.current.cameraHorizontalFovDeg);

    // Cursor DOM node — direct writes via ref, no React state.
    // transform-origin: center lets scale() grow around the cursor's centre
    // (used by the dwell dispatcher for visual feedback) without breaking
    // the translate3d positioning.
    // O diâmetro vem da flag. `limitarTamanho` prende à faixa em vez de
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

    // Anel de progresso ao redor do cursor. Complementa a barra no alvo: alvos
    // pequenos escondem o próprio progresso debaixo do cursor, e o anel fica
    // sempre onde a fóvea está — ler um indicador fora dela exigiria um
    // sacádico, que cancelaria o dwell.
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

    // Calibração descartada por incompatibilidade de pipeline.
    const unsubInvalid = engine.calibration.onInvalidated(() => {
      if (cancelled) return;
      setCalibrationInvalidated(
        'A calibração salva não vale para esta versão do rastreador. ' +
          'Refaça a calibração para voltar a usar o olhar.'
      );
    });

    const unsubState = engine.onStateChange((s) => {
      if (!cancelled) setState(s);
    });

    const unsubL2CSStatus = engine.onL2CSStatusChange((s) => {
      if (!cancelled) setL2csStatus(s);
    });

    // Lido fora do caminho quente e atualizado por evento quando a tela
    // inicial alterna o modo.
    let devMode = isDevMode();
    const unsubDevMode = onDevModeChange((on) => {
      devMode = on;
    });

    let cbInvocations = 0;
    const unsubGaze = engine.subscribe((sample) => {
      if (devMode) {
        if (cursorRef.current) {
          cursorRef.current.style.transform = 'translate3d(-9999px,-9999px,0)';
          cursorRef.current.style.opacity = '0';
        }
        return;
      }

      const now = performance.now();

      // ── Global dwell dispatcher ───────────────────────────────────────────
      // finds the topmost clickable under the gaze via elementFromPoint (the
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

      // Durante a calibração, só a EMERGÊNCIA continua acionável. Um dwell
      // acidental nos botões da própria tela corromperia a coleta, mas o botão
      // de socorro fica visível durante os 1–2 minutos e não pode ficar
      // inoperante nesse tempo.
      const alvoDuranteCalibracao = engineIsCalibrating
        ? ((document.elementFromPoint(sample.x, sample.y) as Element | null)?.closest(
            '[data-emergency="true"]'
          ) as HTMLElement | null)
        : null;

      if (dwellSuspenso || (engineIsCalibrating && !alvoDuranteCalibracao)) {
        // Suspenso (Modo Computador: a janela está oculta e quem clica é a
        // sobreposição) ou calibrando: nada além da emergência é clicável — um
        // dwell acidental na UI da própria calibração corromperia a coleta.
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
              // Alvo de recuperação: aceito em `degraded` como o de emergência,
              // com dwell mais longo — é o que torna o "Recalibre aqui"
              // acionável exatamente no estado em que ele aparece.
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
            ...DEFAULT_DWELL_CONFIG,
            dwellMs: dwellMsRef.current,
          }
        );
        dwellStateRef.current = outcome.state;

        // ── Piscada como clique ─────────────────────────────────────────
        //
        // Roda em PARALELO ao dwell (fixa + pisca = confirma). As guardas de
        // duração, estabilidade, refratário e emergência vivem no módulo puro.
        //
        // O alvo passado é `node`, não `outcome.hoverKey`: o `hoverKey` zera
        // durante a piscada (olho fechado = sem amostra válida), o que faria o
        // alvo sumir justamente no quadro em que a piscada começa.
        //
        // As guardas de ESTADO DO SISTEMA ficam aqui: `stepBlinkClick` não sabe
        // se o sistema está calibrado. Sem este filtro a piscada clicava onde o
        // `stepDwell` se recusa a clicar — com o ponto no fallback do nariz
        // (`uncalibrated`), em `degraded` (só emergência/recuperação, com dwell
        // mais longo) e em alvos desabilitados.
        const piscadaPermitida =
          sample.uncalibrated !== true && !isDegraded && target?.isDisabled !== true;

        if (EXPERIMENT.blinkClick && !dwellSuspenso) {
          const rb = stepBlinkClick(blinkClickRef.current, {
            piscando:
              !sample.hasFace || sample.eyeState === undefined
                ? null
                : sample.eyeState === 'closed',
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

          // O refratário já está armado dentro de `outcome.state`, que foi
          // commitado ACIMA. Se o handler React lançar, o dwell não redispara
          // sob o mesmo olhar e o loop segue vivo.
          try {
            if (alvo.isConnected) alvo.click();
          } catch (err) {
            console.error('[IrisFlow] handler de clique por dwell lançou:', err);
          }
        }

        // ── Rolagem pelas bordas ────────────────────────────────────────
        //
        // Quem não usa as mãos também não usa a roda do mouse: sem isto,
        // qualquer conteúdo mais alto que a tela fica inalcançável a partir
        // do primeiro rolar.
        //
        // A condição que importa é `target === null`: **só rola quando não há
        // nada clicável sob o olhar**. É isso que impede a faixa de roubar o
        // botão de emergência, que fica exatamente numa borda (`top: 2rem` no
        // uso normal, `bottom: 1.5rem` durante a medição). Uma lista de
        // exceções por posição envelheceria no primeiro botão novo perto de
        // uma borda; esta regra protege por construção.
        //
        // As outras duas guardas são as mesmas da piscada, pelo mesmo motivo:
        // sem calibração o ponto é o fallback do nariz, e em `degraded` a
        // posição não é confiável o bastante para mover a tela sozinha.
        const podeRolar = target === null && sample.uncalibrated !== true && !isDegraded;

        // O relógio é o do FLUXO DE AMOSTRAS, não o de parede — mesma razão
        // que o dwell documenta acima. Com `performance.now()`, uma pausa na
        // emissão (piscada, rosto perdido, quadro dropado) deixaria os 300 ms
        // "passarem" sozinhos, e a primeira amostra depois da pausa rolaria de
        // imediato: exatamente o olhar de relance que o atraso existe para
        // ignorar.
        const relogio = Number.isFinite(sample.timestamp) ? sample.timestamp : now;

        if (podeRolar) {
          const r = velocidadeDaBorda(bordaRef.current, sample.y, window.innerHeight, relogio);
          bordaRef.current = r.estado;
          if (r.velocidadePxS !== 0) {
            rolarSobOOlhar(
              sample.x,
              sample.y,
              r.velocidadePxS,
              relogio - ultimaRolagemMsRef.current
            );
          }
          ultimaRolagemMsRef.current = relogio;
        } else {
          // Sair do estado zera o prazo: voltar à borda recomeça os 300 ms.
          bordaRef.current = estadoInicialDeBorda();
          ultimaRolagemMsRef.current = relogio;
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

        // O caso (3) do comentário acima estava documentado e NÃO
        // implementado: `isAccuracyTesting` não era lido em lugar nenhum deste
        // arquivo, e o cursor ficava visível durante toda a medição. O
        // participante enxerga o ponto vermelho, tenta corrigi-lo, e o erro
        // medido passa a ser o do loop de perseguição, não o do modelo.
        // A flag do operador vale SÓ para o teste de precisão. Na calibração
        // o cursor continua escondido em qualquer caso: lá a pessoa precisa
        // fixar o alvo, e um ponto se mexendo ao lado é justamente o que
        // estraga a fixação que se está tentando coletar.
        const escondePeloTeste = isAccuracyTesting && !EXPERIMENT.cursorNoTesteDePrecisao;
        if (isInCalibration || !isCalibrated || escondePeloTeste) {
          // Hard-hide: move offscreen + opacity 0
          cursorRef.current.style.transform = 'translate3d(-9999px,-9999px,0)';
          cursorRef.current.style.opacity = '0';
          if (anelRef.current) anelRef.current.ownerSVGElement!.style.opacity = '0';

          // O fallback de gaze perdido não roda aqui (não há cursor para
          // segurar), mas a mensagem dele precisa ser limpa: um "Posicione o
          // rosto" emitido antes da calibração ficaria na tela durante a coleta
          // inteira. O `GazeFallback` também é zerado, senão retomaria com uma
          // âncora de posição de antes da calibração.
          if (gazeLostMessageRef.current !== null) {
            gazeLostMessageRef.current = null;
            setGazeLostMessage(null);
            fallbackRef.current.reset();
          }
        } else {
          // ── Fallback de gaze perdido ───────────────────────────────────
          //
          // Com a flag desligada, `fb` reproduz o comportamento de sempre
          // (posição da amostra, cursor visível).
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

          // Aviso de borda. Só faz sentido com o rastreamento ativo: em
          // `segurando`/perdido a posição na tela é projetada, não medida, e
          // acusar "você está olhando para baixo" com base numa projeção seria
          // inventar.
          const sat = getSaturacaoDoOlhar();
          const vereditoDeBorda = foraDaTelaRef.current.avaliar({
            fora: fb.estado === 'ativo' && sat.fora,
            direcao: sat.direcao,
            temRosto: sample.hasFace === true,
            tMs: now,
          });
          if (vereditoDeBorda.mensagem !== avisoDeBordaRef.current) {
            avisoDeBordaRef.current = vereditoDeBorda.mensagem;
            setAvisoDeBorda(vereditoDeBorda.mensagem);
          }

          const vereditoDeOlhos = olhosFechadosRef.current.avaliar({
            estado: sample.eyeState ?? 'unknown',
            temRosto: sample.hasFace === true,
            tMs: now,
          });
          if (vereditoDeOlhos.mensagem !== avisoDeOlhosFechadosRef.current) {
            avisoDeOlhosFechadosRef.current = vereditoDeOlhos.mensagem;
            setAvisoDeOlhosFechados(vereditoDeOlhos.mensagem);
          }

          if (!fb.mostrarCursor || fb.posicao === null) {
            cursorRef.current.style.transform = 'translate3d(-9999px,-9999px,0)';
            cursorRef.current.style.opacity = '0';
            if (anelRef.current) anelRef.current.ownerSVGElement!.style.opacity = '0';
          } else {
            // Geometria e cores vêm do módulo puro — em especial o `offsetPx`:
            // um meio-tamanho escrito à mão aqui viraria viés constante assim
            // que o diâmetro do cursor mudasse, e viés constante parece erro
            // de calibração, não de layout.
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

            cursorRef.current.style.transform = `translate3d(${fb.posicao.x - est.offsetPx}px, ${fb.posicao.y - est.offsetPx}px, 0) scale(${est.escala})`;
            cursorRef.current.style.opacity =
              fb.estado === 'segurando' ? '0.5' : sample.hasFace ? '1' : '0.35';
            cursorRef.current.style.background = est.preenchimento;
            // O anel duplo é o que torna o cursor visível sobre QUALQUER
            // fundo: nenhuma cor sozinha contrasta com todos, e o vermelho
            // translúcido de antes sumia sobre o botão de emergência — que é
            // o pior alvo possível para o cursor sumir.
            cursorRef.current.style.boxShadow = est.anel;
            cursorRef.current.style.border = est.tracejado ? '2px dashed rgba(234,179,8,0.9)' : '';

            // Anel de progresso do dwell.
            if (anelRef.current) {
              const svg = anelRef.current.ownerSVGElement!;
              if (hitTarget) {
                const g = geometriaDoAnel(est.tamanhoPx, dwellPct);
                anelRef.current.setAttribute('stroke-dashoffset', String(g.offset));
                svg.style.transform = `translate3d(${fb.posicao.x - g.centro}px, ${fb.posicao.y - g.centro}px, 0)`;
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
          `[IrisFlow] gaze callback #${cbInvocations} — x=${sample.x.toFixed(0)} y=${sample.y.toFixed(0)} hasFace=${sample.hasFace} cursor=${!!cursorRef.current}`
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

      // Sincroniza `isDwelling` sem floodar re-renders.
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
        // Registra a stream ANTES de qualquer outra coisa: a partir daqui o
        // cleanup consegue pará-la mesmo que nunca cheguemos ao <video>.
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
        // Espera LIMITADA. Sem o teto, uma câmera que abre mas nunca entrega
        // quadro (driver Windows travado, dispositivo tomado por outro app
        // depois do getUserMedia) deixava este await pendente para sempre:
        // `engine.start()` nunca acontecia, o `l2csStatus` ficava em 'loading'
        // e a tela de calibração exibia "Carregando…" com o botão desabilitado
        // pelo resto da sessão — sem erro, sem console para o cuidador ler.
        const LOADEDDATA_TIMEOUT_MS = 10000;
        await new Promise<void>((resolve, reject) => {
          // O evento pode já ter passado se o quadro chegou antes de chegarmos
          // aqui; `readyState` é o estado, o evento é só a notificação dele.
          if (video.readyState >= 2) {
            resolve();
            return;
          }
          const timer = window.setTimeout(() => {
            video.removeEventListener('loadeddata', aoCarregar);
            reject(
              new Error(
                'A câmera foi aberta mas não entregou nenhum quadro em 10 segundos. ' +
                  'Feche outros programas que usem a webcam (Teams, Zoom, OBS), ' +
                  'desconecte e reconecte a câmera, e recarregue.'
              )
            );
          }, LOADEDDATA_TIMEOUT_MS);
          function aoCarregar() {
            window.clearTimeout(timer);
            resolve();
          }
          video.addEventListener('loadeddata', aoCarregar, { once: true });
        });
        // Alguns browsers em Electron não iniciam o playback sozinhos mesmo com
        // muted+autoplay quando o elemento é adicionado dinamicamente. Force.
        try {
          await video.play();
        } catch (e) {
          console.warn('[IrisFlow] video.play() falhou:', e);
        }
        console.log(
          `[IrisFlow] loadeddata OK — video ${video.videoWidth}x${video.videoHeight}, paused=${video.paused}, currentTime=${video.currentTime}`
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
              `app está segurando o dispositivo numa resolução menor.`
          );
        }

        // Segundo ponto de saída, depois de `loadeddata`: sair sem parar as
        // tracks deixaria um decode de 1080p vivo pelo resto da página.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          console.log('[IrisFlow] stream parada — provider desmontado durante o warm-up.');
          return;
        }
        await engine.start(video);
        engine.setScreenGeometry(
          settingsRef.current.screenDiagonalIn,
          settingsRef.current.viewingDistanceCm
        );
        console.log('[IrisFlow] engine.start() concluído; loop rAF em execução.');

        // ── Hooks de console para diagnóstico e medição de latência ────────
        //
        // `__irisflowDiag()` devolve o diagnóstico inteiro;
        // `__irisflowLatencia()` imprime a tabela de estágios ordenada pelo
        // p95. Ambos são removidos no cleanup do provider.
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
            // `stalePct` JÁ vem em percentual (0–100), não em fração —
            // `engine.ts` faz o `× 100` na origem. Não multiplicar de novo.
            console.log(
              `[latencia] fps=${d.fpsRender.toFixed(1)} l2cs=${d.l2cs.hz.toFixed(1)} Hz ` +
                `inferência=${d.l2cs.latencyMs.toFixed(0)} ms stale=${d.l2cs.stalePct.toFixed(1)}% ` +
                `crop=${EXPERIMENT.l2csInputSize}² ep=${d.l2cs.executionProvider ?? '?'}`
            );
            if (d.l2cs.stalePct > 50) {
              console.warn(
                `[latencia] ${d.l2cs.stalePct.toFixed(0)}% das leituras do L2CS estão OBSOLETAS ` +
                  `(inferência ${d.l2cs.latencyMs.toFixed(0)} ms contra tolerância de ${d.l2cs.staleMs.toFixed(0)} ms). ` +
                  'O bloco angular está sendo zerado — as features [4] e [5] do vetor não carregam sinal.'
              );
            }
            return linhas;
          };
          // ── Verificação pré-sessão ────────────────────────────────────
          //
          // Checklist do protocolo de medição num comando só. O parâmetro
          // opcional é a condição PRETENDIDA: declará-la pega o erro mais
          // provável — `__irisflowExp.set` só vale depois de recarregar, e
          // medir com a flag da condição anterior produz dado de aparência
          // perfeita atribuído à condição errada.
          //
          //   __irisflowPreflight()
          //   __irisflowPreflight({ filterMode: 'kalmanEma', l2csInputSize: 224 })
          w.__irisflowPreflight = async (condicaoEsperada?: Record<string, unknown>) => {
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
              telaPolegadas: settingsRef.current.screenDiagonalIn,
              origemGeometria: settingsRef.current.screenGeometrySource ?? 'default',
              distanciaCm: settingsRef.current.viewingDistanceCm,
              viewportPx: {
                w: document.documentElement.clientWidth,
                h: document.documentElement.clientHeight,
              },
              telaPx: { w: window.screen.width, h: window.screen.height },
              taxaAtualizacaoHz: hz,
              fpsRender: d.fpsRender,
              videoPx: { w: d.video.width, h: d.video.height },
              l2cs: {
                status: d.l2cs.status,
                executionProvider: d.l2cs.executionProvider ?? null,
                stalePct: d.l2cs.stalePct,
                pendingCount: d.l2cs.pendingCount,
                hz: d.l2cs.hz,
              },
              filtro: d.filtro,
              flags: EXPERIMENT as unknown as Record<string, unknown>,
              condicaoEsperada,
            });

            const icone = { ok: '✅', atencao: '⚠️', bloqueio: '⛔' } as const;
            console.table(
              itens.map((i) => ({
                '': icone[i.nivel],
                item: i.item,
                detalhe: i.detalhe,
                ação: i.acao ?? '',
              }))
            );
            if (podeComecar(itens)) {
              console.log('[preflight] ✅ PODE COMEÇAR.');
            } else {
              console.warn(
                '[preflight] ⛔ NÃO COMECE — os itens marcados produziriam dado que ' +
                  'será descartado. Resolva-os e rode de novo.'
              );
            }
            return itens;
          };

          console.log(
            '[IrisFlow] console: __irisflowPreflight() ANTES de medir · ' +
              '__irisflowLatencia() para a tabela de estágios · ' +
              '__irisflowDiag() para o diagnóstico completo.'
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
              : 'Falha ao inicializar a câmera. Recarregue a página.'
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
      unsubDevMode();
      // `dispose()` em vez de `stop()`: `stop()` só para o loop; `dispose()`
      // fecha o FaceLandmarker (heap WASM + GPU) e o worker L2CS (~91 MB de
      // sessão ONNX). O try/catch importa: uma exceção aqui abortaria o resto
      // do cleanup (`provedorAtivo--`, `track.stop()`) e deixaria o provider
      // travado com a câmera acesa.
      try {
        engine.dispose();
      } catch (e) {
        console.warn('[IrisFlow] engine.dispose() falhou durante o cleanup:', e);
      }
      engineRef.current = null;
      // Remove os hooks de console junto com o engine: vivos, apontando para
      // um engine descartado, devolveriam `null` em silêncio.
      if (typeof window !== 'undefined') {
        delete (window as unknown as Record<string, unknown>).__irisflowDiag;
        delete (window as unknown as Record<string, unknown>).__irisflowLatencia;
        delete (window as unknown as Record<string, unknown>).__irisflowPreflight;
      }
      // Libera o guard de instância única. Vem DEPOIS do dispose para que um
      // remount imediato não encontre recursos meio liberados.
      provedorAtivo = Math.max(0, provedorAtivo - 1);

      // A stream vem do ref (ver `streamRef`); o `??` é rede de segurança para
      // o caso de ela ter sido trocada no <video> por outro caminho.
      const stream = streamRef.current ?? (videoRef.current?.srcObject as MediaStream | null);

      // Devolve a câmera como estava ANTES de `track.stop()`: zoom e brilho
      // aplicados por `applyConstraints` persistem no dispositivo em vários
      // drivers. Best-effort — o cleanup do React não espera Promise, mas a
      // chamada é despachada ao driver antes do `stop()`.
      const original = originalCameraSettingsRef.current;
      const track0 = stream?.getVideoTracks()[0];
      if (original && track0 && Object.keys(original).length > 0) {
        try {
          void track0
            .applyConstraints(original as MediaTrackConstraints)
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
      startCollectingPoint: (x, y, onDone) =>
        engineRef.current?.calibration.startCollectingPoint(x, y, onDone),
      // Sem engine não há treino — mas devolver em silêncio deixa a tela
      // esperando um callback que nunca vem. A falha é dita.
      completeCalibration: (onComplete) => {
        const eng = engineRef.current;
        if (!eng) {
          console.error('[IrisFlow] completeCalibration sem engine ativo.');
          onComplete?.({
            ok: false,
            reason: 'engine_indisponivel',
            detail: 'O rastreamento não está ativo.',
          });
          return;
        }
        eng.calibration.completeCalibration(onComplete);
      },
      // Deriva de pose da calibração recém-treinada, para a tela poder avisar
      // em vez de deixar o usuário seguir com um modelo contaminado.
      getPoseDriftVerdict: () => engineRef.current?.calibration.getPoseDriftVerdict() ?? null,
      // Diagnóstico do ajuste. CARO: roda o leave-one-target-out (~9 s).
      // Quem só quer os alvos pulados usa `getTargetsSkipped`.
      getCalibrationFitDiagnostics: () =>
        engineRef.current?.calibration.getCalibrationFitDiagnostics() ?? null,
      // Alvos que ficaram fora do treino, para a tela avisar que a calibração
      // treinou sem parte da grade. Barato: não dispara o LOO.
      getTargetsSkipped: () => engineRef.current?.calibration.getTargetsSkipped() ?? [],
      abort: () => engineRef.current?.calibration.abort(),
      clear: () => engineRef.current?.calibration.clear(),
      isCalibrated: () => engineRef.current?.calibration.isCalibrated() ?? false,
      setEyeDominance: (d) => engineRef.current?.calibration.setEyeDominance(d),
      setCameraFovDeg: (fov) => engineRef.current?.calibration.setCameraFovDeg(fov),
      getCalibrationDistancesCm: () =>
        engineRef.current?.calibration.getCalibrationDistancesCm() ?? {
          cameraCm: null,
          screenCm: null,
        },
      setCalibrationDistancesCm: (cameraCm, screenCm) =>
        engineRef.current?.calibration.setCalibrationDistancesCm(cameraCm, screenCm),
      getCurrentCameraDistanceCm: () =>
        engineRef.current?.calibration.getCurrentCameraDistanceCm() ?? null,
      getDistanceRange: () => engineRef.current?.calibration.getDistanceRange() ?? null,
      onInvalidated: (cb) => engineRef.current?.calibration.onInvalidated(cb) ?? (() => {}),
      getRecentBlinkRatePerMinute: (windowMs) =>
        engineRef.current?.calibration.getRecentBlinkRatePerMinute(windowMs) ?? 0,
      getActiveOpticalCondition: () =>
        engineRef.current?.calibration.getActiveOpticalCondition() ?? 'desconhecido',
    }),
    []
  );

  const recording = useMemo<RecordingApi>(
    () => ({
      start: () => engineRef.current?.recording.start(),
      stop: () => engineRef.current?.recording.stop(),
      isActive: () => engineRef.current?.recording.isActive() ?? false,
      getStats: () => engineRef.current?.recording.getStats() ?? { frames: 0, dropped: 0 },
      exportAsJSONL: () => engineRef.current?.recording.exportAsJSONL() ?? '',
      clear: () => engineRef.current?.recording.clear(),
    }),
    []
  );

  // Aviso de distância a 2 Hz, não por quadro: a distância muda na escala de
  // segundos. A histerese do `AvisoDeDistancia` cuida da estabilidade, e o
  // `setState` só acontece quando o texto muda.
  useEffect(() => {
    const id = setInterval(() => {
      const faixa = engineRef.current?.calibration.getDistanceRange?.() ?? null;
      const calibradaCm =
        engineRef.current?.calibration.getCalibrationDistancesCm().screenCm ?? null;
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
      setFilterPreset: (preset: FilterPreset | FilterPresetV2) =>
        engineRef.current?.setFilterPreset(preset),
      getDiagnostics: () => engineRef.current?.getDiagnostics() ?? null,
      getCameraStream: () => (videoRef.current?.srcObject as MediaStream | null) ?? null,
      getCameraTuning: () => cameraTuningRef.current,
      getSessionUptimeMs: () => engineRef.current?.getSessionUptimeMs() ?? 0,
      // `isDwelling` continua exposto por compatibilidade, mas NÃO entra nas
      // deps do memo: quem precisa dele deve usar `useIsDwelling()`. Ler daqui
      // devolve o valor do último render em que outra coisa mudou.
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
    [
      subscribe,
      state,
      l2csStatus,
      calibration,
      recording,
      isComposing,
      setIsComposing,
      isDegraded,
      cameraError,
      calibrationInvalidated,
      gazeLostMessage,
    ]
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
        avisoDeBorda={avisoDeBorda}
        avisoDeOlhosFechados={avisoDeOlhosFechados}
      />
      {/* A varredura fica DENTRO do provider e FORA do `DwellContext`: ela não
          depende de dwell e não deve re-renderizar a cada alternância dele. */}
      <ScanningMode />
      {/* `isDwelling` num provider próprio: uma alternância de dwell só
          invalida este contexto, não os consumidores de `useGaze()`. */}
      <DwellContext.Provider value={isDwelling}>{children}</DwellContext.Provider>
    </GazeContext.Provider>
  );
};
