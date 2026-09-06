import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BookOpen, Check, Crosshair, Loader2, Play, RotateCcw, Zap } from 'lucide-react';
import { useGaze, type EngineDiagnostics } from '../../context/GazeContext';
import { useSettings } from '../../context/SettingsContext';
import { BackButton } from '../../components/ui/BackButton';
import { GazeButton } from '../../components/ui/GazeButton';
import { GazeGrid } from '../../components/ui/GazeGrid';
import { ReadinessPanel } from '../../components/ui/ReadinessPanel';
import { startAccuracyTest, type RuntimeInfo } from '@tracker/accuracy';
import { buildAutoTestMeta } from '../../utils/autoTestMeta';
import type { OpticalCondition } from '@tracker/calibrationProfiles';
import type { VeredictoDeriva } from '@tracker/calibration';
import { getResumoDoPonto, getCalibrationFitDiagnostics } from '@tracker/calibration';
import { resolveCalibrationDistances } from '@tracker/calibrationDistances';
import { EXPERIMENT } from '@tracker/config/experiment';

interface CalibrationPointUI { x: number; y: number; name: string; }
const POINT_NAME: Record<string, string> = {
  '0.1,0.1': 'Superior Esquerdo',
  '0.5,0.1': 'Superior Central',
  '0.9,0.1': 'Superior Direito',
  '0.1,0.5': 'Meio Esquerdo',
  '0.5,0.5': 'Centro',
  '0.9,0.5': 'Meio Direito',
  '0.1,0.9': 'Inferior Esquerdo',
  '0.5,0.9': 'Inferior Central',
  '0.9,0.9': 'Inferior Direito',
};

const OPTICAL_LABELS: Record<OpticalCondition, string> = {
  sem_oculos:          'Sem óculos',
  oculos_simples:      'Óculos comuns (leitura, miopia)',
  oculos_progressivo:  'Óculos progressivos (multifocais)',
  lentes_contato:      'Lentes de contato',
  desconhecido:        'Prefiro não dizer',
};
const OPTICAL_OPTIONS: OpticalCondition[] = [
  'sem_oculos',
  'oculos_simples',
  'oculos_progressivo',
  'lentes_contato',
  'desconhecido',
];

// Falhas do ajuste final, explicadas para quem está na frente da tela.
const humanMessage: Record<string, string> = {
  singular_matrix: 'Não foi possível concluir o ajuste. A causa mais comum é reflexo constante nos óculos ou o olhar muito fora dos pontos.',
  insufficient_samples: 'Faltaram amostras. Mantenha o rosto visível e centralizado durante toda a calibração.',
  degenerate_features: 'Os dados variaram pouco. A causa mais comum é reflexo nos óculos ou o olhar fixo fora dos pontos.',
  unknown: 'Algo deu errado no ajuste. Tente novamente.',
};

const AUTO_RECORD_STORAGE_KEY = 'irisflow.autoRecordOnCalibrate';

/** Estado do runtime para o relatório do teste de precisão. */
function runtimeInfoDoEngine(getDiagnostics: () => EngineDiagnostics | null): RuntimeInfo | undefined {
  const d = getDiagnostics();
  if (!d) return undefined;
  return {
    l2csExecutionProvider: d.l2cs.executionProvider,
    l2csFallback: d.l2cs.fallback,
    l2csLatencyMs: d.l2cs.latencyMs,
    l2csStalePct: d.l2cs.stalePct,
    l2csInputSize: EXPERIMENT.l2csInputSize,
    filterEffective: d.filtro.efetivo,
    filterPreset: d.filtro.preset,
    fpsRender: d.fpsRender,
    video: { width: d.video.width, height: d.video.height },
  };
}

export const CalibrationCheck: React.FC = () => {
  const navigate = useNavigate();
  const { calibration, l2csStatus, getSessionUptimeMs, recording, getDiagnostics } = useGaze();
  // Geometria física do posto de uso: fonte única para o erro angular do
  // relatório e para o posicionamento dos alvos.
  const { settings } = useSettings();

  // `disabled` libera a calibração tanto quanto `ready`: o caminho do L2CS é
  // opcional, e sem esta linha a tela esperaria um modelo que ninguém pediu.
  const l2csReady  = l2csStatus === 'ready' || l2csStatus === 'disabled';
  const l2csFailed = l2csStatus === 'error';

  const [stage, setStage] = useState<'tutorial' | 'calibrating' | 'testing' | 'review'>('tutorial');
  // Espelho do `stage` para os listeners de visibilidade/blur, que são
  // registrados uma única vez e fechariam sobre o valor do primeiro render.
  const stageRef = useRef(stage);
  useEffect(() => { stageRef.current = stage; }, [stage]);

  // Revisão antes do teste: deriva de pose durante a coleta e/ou alvos que
  // ficaram de fora. Qualquer um dos dois para a tela e deixa a pessoa decidir.
  const [driftVerdict, setDriftVerdict] = useState<VeredictoDeriva | null>(null);
  const [alvosPulados, setAlvosPulados] = useState(0);
  const puladosNaSessaoRef = useRef(0);

  // Distância efetiva escolhida no início desta calibração. Congelada aqui
  // para a grade e o relatório usarem exatamente o mesmo número.
  const sessionDistanceRef = useRef<number | null>(null);

  const [currentIndex, setCurrentIndex]       = useState(0);
  const [completedList, setCompletedList]     = useState<number[]>([]);
  const [errorMessage, setErrorMessage]       = useState<string | null>(null);
  const [lastCompletedPoint, setLastCompletedPoint] = useState<number | null>(null);
  const [preparing, setPreparing]             = useState(false);
  const PREPARE_MS = 1500;

  const [opticalCondition, setOpticalCondition] = useState<OpticalCondition>('desconhecido');

  // Opt-in do cuidador para gravar a sessão junto com a calibração. Persistido
  // para não precisar remarcar a cada rodada; parar e exportar continuam
  // manuais em Configurações. Default desligado.
  const [autoRecord, setAutoRecord] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTO_RECORD_STORAGE_KEY) === 'true'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(AUTO_RECORD_STORAGE_KEY, String(autoRecord)); }
    catch { /* localStorage indisponível — silencia */ }
  }, [autoRecord]);
  // Espelho reativo do isActive() do recorder, só para o indicador "Gravando".
  const [isRecording, setIsRecording] = useState<boolean>(false);
  useEffect(() => {
    const tick = () => setIsRecording(recording.isActive());
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [recording]);
  // Lista de alvos da SESSÃO EM CURSO, congelada em `handleStart` depois de
  // `startCalibrationMode`. O ref é a fonte da verdade para o loop (síncrono,
  // imune a render velho); o state existe só para o JSX redesenhar. Os dois
  // são escritos juntos, nunca separadamente — ver `commitSessionTargets`.
  const activePointsRef = useRef<CalibrationPointUI[]>([]);
  const [sessionPoints, setSessionPoints] = useState<CalibrationPointUI[] | null>(null);

  const toUiPoints = (targets: readonly { x: number; y: number }[]): CalibrationPointUI[] =>
    targets.map((t) => ({
      x: t.x * 100,
      y: t.y * 100,
      name: POINT_NAME[`${t.x},${t.y}`] ?? '',
    }));

  /** Congela os alvos desta sessão. Chamado UMA vez, após startCalibrationMode. */
  const commitSessionTargets = (targets: readonly { x: number; y: number }[]) => {
    const pts = toUiPoints(targets);
    activePointsRef.current = pts;
    setSessionPoints(pts);
    return pts;
  };

  // Lista NOMINAL — usada só para o preview, antes de qualquer sessão começar.
  const nominalPoints: CalibrationPointUI[] = useMemo(() => {
    const targets = calibration.getCalibrationTargets?.() ?? [];
    if (targets.length === 0) {
      return [
        { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 },
        { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
        { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.9 },
      ].map((t) => ({ x: t.x * 100, y: t.y * 100, name: POINT_NAME[`${t.x},${t.y}`] ?? '' }));
    }
    return toUiPoints(targets);
  }, [calibration]);

  // O que a tela desenha: os alvos da sessão quando existe uma, senão o preview.
  const activePoints: CalibrationPointUI[] = sessionPoints ?? nominalPoints;

  const shuffleOrderRef          = useRef<number[]>([]);
  const isMounted                = useRef(true);
  const retryCountRef            = useRef(0);
  const MAX_RETRIES_PER_POINT    = 3;

  // Só finalizamos gravação que ESTE componente iniciou. Se o operador começou
  // manualmente em Configurações, deixamos em paz.
  const autoRecordOwnedRef = useRef(false);
  const finalizeAutoRecordingRef = useRef<(exportFile: boolean) => void>(() => {});
  finalizeAutoRecordingRef.current = (exportFile: boolean) => {
    if (!autoRecordOwnedRef.current) return;
    if (!recording.isActive()) {
      autoRecordOwnedRef.current = false;
      return;
    }
    const stats = recording.getStats();
    const jsonl = exportFile ? recording.exportAsJSONL() : '';
    recording.stop();
    if (exportFile && jsonl) {
      const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // ':' inválido em nome de arquivo no Windows — troca por '-'.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `irisflow-recording-${stamp}.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`[calib] gravação finalizada + exportada — ${stats.frames} frames`);
    } else {
      console.log('[calib] gravação descartada (tentativa incompleta)');
    }
    recording.clear();
    autoRecordOwnedRef.current = false;
  };

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // Sair no meio da coleta deixaria o engine em `calibrating` para sempre
      // (dwell desligado e cursor oculto em todo o app). Abortar não descarta
      // o modelo anterior — só encerra a sessão em curso.
      calibration.abort?.();
      finalizeAutoRecordingRef.current(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A janela perder o foco durante a coleta contaminaria o modelo com amostras
  // que não correspondem a alvo nenhum. Aborta e volta ao início.
  useEffect(() => {
    const abortarPorPerdaDeFoco = (motivo: string) => {
      if (document.visibilityState === 'visible' && motivo === 'visibility') return;
      if (stageRef.current !== 'calibrating') return;
      console.warn(`[calib] calibração abortada por ${motivo}`);
      calibration.abort?.();
      finalizeAutoRecordingRef.current(false);
      if (!isMounted.current) return;
      setStage('tutorial');
      setPreparing(false);
      setCompletedList([]);
      setSessionPoints(null);
      setErrorMessage('A calibração foi interrompida porque a janela perdeu o foco. Comece de novo.');
    };
    const onVisibility = () => abortarPorPerdaDeFoco('visibility');
    const onBlur = () => abortarPorPerdaDeFoco('blur');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAccuracyTestThenExit = () => {
    const meta = buildAutoTestMeta({
      sessionUptimeMs: getSessionUptimeMs(),
      opticalCondition: calibration.getActiveOpticalCondition?.() ?? 'desconhecido',
      distanciaCm: sessionDistanceRef.current ?? settings.viewingDistanceCm,
      telaPolegadas: settings.screenDiagonalIn,
      // Procedência da diagonal: `'default'` é o valor assumido, e o relatório
      // precisa dizer isso em vez de afirmar que mediu.
      screenGeometrySource: settings.screenGeometrySource,
    });
    meta.screenScaleFactor = settings.screenScaleFactor;
    startAccuracyTest((_result, action) => {
      if (!isMounted.current) return;
      if (action === 'redo') {
        // Tentativa descartada — não exporta um JSONL parcial.
        finalizeAutoRecordingRef.current(false);
        calibration.clear?.();
        setStage('tutorial');
        setCompletedList([]);
        return;
      }
      finalizeAutoRecordingRef.current(true);
      navigate('/welcome');
    }, meta, runtimeInfoDoEngine(getDiagnostics));
  };

  const startNextPoint = (step: number) => {
    if (!isMounted.current) return;
    const order = shuffleOrderRef.current;

    if (step >= order.length) {
      setStage('testing');
      calibration.completeCalibration?.((outcome) => {
        if (!outcome || outcome.ok !== false) {
          // Se a cabeça migrou mais que o limiar entre o primeiro e o último
          // alvo, o modelo aprendeu postura junto com alvo; se algum alvo ficou
          // de fora, a região dele é chute. Nos dois casos a tela para aqui.
          const veredito = calibration.getPoseDriftVerdict?.() ?? null;
          const pulados = getCalibrationFitDiagnostics()?.targetsSkipped.length ?? puladosNaSessaoRef.current;
          if ((veredito || pulados > 0) && isMounted.current) {
            if (veredito) console.warn(`[React] Deriva de pose na calibração: ${veredito.mensagem}`);
            if (pulados > 0) console.warn(`[React] ${pulados} alvo(s) de calibração ignorado(s).`);
            setDriftVerdict(veredito);
            setAlvosPulados(pulados);
            setStage('review');
            return;
          }
          console.log('[React] Calibração concluída — disparando teste de precisão automático');
          setTimeout(() => { if (isMounted.current) runAccuracyTestThenExit(); }, 400);
        } else {
          if (isMounted.current) {
            const reason = outcome.reason || 'unknown';
            const msg = humanMessage[reason] || humanMessage.unknown;
            console.error(`[React] Treinamento falhou: ${reason} - ${outcome.detail}`);
            // Sem teste de precisão útil, o JSONL até aqui é descartado.
            finalizeAutoRecordingRef.current(false);
            setErrorMessage(msg);
            setStage('tutorial');
          }
        }
      });
      return;
    }

    const pointIdx = order[step];
    setCurrentIndex(pointIdx);
    setErrorMessage(null);
    setLastCompletedPoint(null);

    // SEMPRE do ref: `activePoints` aqui seria a lista do render em que esta
    // closure nasceu, anterior a `startCalibrationMode`.
    const pt = activePointsRef.current[pointIdx];
    if (!pt) {
      // Ordem e lista dessincronizadas: abortar é melhor que treinar em alvo
      // errado.
      console.error(
        `[calib] alvo ${pointIdx} inexistente na lista da sessão ` +
        `(${activePointsRef.current.length} alvos). Coleta abortada.`,
      );
      setErrorMessage('Erro interno na grade de calibração. Tente novamente.');
      setStage('tutorial');
      return;
    }
    calibration.startCollectingPoint?.(pt.x / 100, pt.y / 100, (success: boolean) => {
      if (!isMounted.current) return;
      if (success) {
        retryCountRef.current = 0;
        setLastCompletedPoint(pointIdx);
        setCompletedList(prev => [...prev, pointIdx]);
        setTimeout(() => { if (isMounted.current) startNextPoint(step + 1); }, 1200);
      } else {
        retryCountRef.current++;
        if (retryCountRef.current >= MAX_RETRIES_PER_POINT) {
          // Desiste deste alvo para a sessão não travar; a revisão avisa depois.
          retryCountRef.current = 0;
          puladosNaSessaoRef.current++;
          setCompletedList(prev => [...prev, pointIdx]);
          setTimeout(() => { if (isMounted.current) startNextPoint(step + 1); }, 500);
        } else {
          // A mensagem diz a CAUSA REAL: culpar o movimento quando o problema é
          // a lâmpada faz o paciente tentar se mover ainda menos, sem efeito.
          const r = getResumoDoPonto();
          const detalhe = `${r.aceitos} de ${r.necessario} amostras`;
          setErrorMessage(
            r.porQualidade >= r.porL2cs && r.porQualidade > 0
              ? `A imagem ficou ruim neste ponto (${detalhe}). Confira a luz e o reflexo nos óculos. Vamos tentar de novo.`
              : r.porL2cs > 0
                ? `O sistema perdeu o olhar por um instante (${detalhe}). Vamos tentar de novo.`
                : `Poucas amostras neste ponto (${detalhe}). O rosto pode ter saído da câmera. Vamos tentar de novo.`,
          );
          setTimeout(() => { if (isMounted.current) startNextPoint(step); }, 1500);
        }
      }
    });
  };

  // Inicia calibração. `quick=true` reduz para 4 cantos; `opticalCondition`
  // grava o perfil sob a condição escolhida.
  const handleStart = (quick: boolean = false) => {
    if (!l2csReady) return;

    if (autoRecord && !recording.isActive()) {
      recording.start();
      autoRecordOwnedRef.current = true;
      console.log('[calib] gravação iniciada junto com a calibração (opt-in)');
    }

    setStage('calibrating');
    setCompletedList([]);
    setDriftVerdict(null);
    setAlvosPulados(0);
    puladosNaSessaoRef.current = 0;

    // As duas distâncias são grandezas DIFERENTES: a da câmera (medida) e a da
    // tela (configurada). A grade é posicionada pela distância até a TELA.
    const { cameraCm, screenCm } = resolveCalibrationDistances({
      measuredCameraDistanceCm: calibration.getCurrentCameraDistanceCm?.() ?? null,
      configuredViewingDistanceCm: settings.viewingDistanceCm,
    });
    sessionDistanceRef.current = screenCm;

    console.log(
      `[calib] distâncias da sessão — tela ${screenCm.toFixed(1)} cm ` +
      `(configurada), câmera ${cameraCm === null ? 'não medida' : `${cameraCm.toFixed(1)} cm`}.`,
    );

    // Congela as distâncias desta calibração: a compensação de distância usa a
    // VARIAÇÃO em relação a elas quando o paciente sentar mais perto ou longe.
    calibration.setCalibrationDistancesCm?.(cameraCm, screenCm);

    calibration.startCalibrationMode?.({
      quick,
      opticalCondition,
      geometry: {
        screenDiagonalIn: settings.screenDiagonalIn,
        viewingDistanceCm: screenCm,
      },
    });

    const targets = calibration.getCalibrationTargets?.() ?? [];
    const sessionTargets = commitSessionTargets(targets);
    const order = sessionTargets.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    shuffleOrderRef.current = order;
    setCurrentIndex(order[0]);

    setPreparing(true);
    setTimeout(() => {
      if (!isMounted.current) return;
      setPreparing(false);
      startNextPoint(0);
    }, PREPARE_MS);
  };

  const refazer = () => {
    setDriftVerdict(null);
    setAlvosPulados(0);
    handleStart(false);
  };

  const continuarParaOTeste = () => {
    setStage('testing');
    runAccuracyTestThenExit();
  };

  // ─── COLETA: palco escuro em tela cheia ─────────────────────────────────
  if (stage === 'calibrating') {
    return (
      <main role="main" aria-label="Calibração em andamento" className="accuracy-overlay">
        {isRecording && (
          <div
            data-testid="recording-indicator"
            className="accuracy-instruction"
            style={{ left: 'auto', right: '2rem', transform: 'none', color: 'var(--danger)' }}
          >
            Gravando
          </div>
        )}

        {/* Progresso e instrução: uma faixa só, no topo, longe dos pontos */}
        <div
          className="accuracy-instruction"
          role="status"
          aria-live="polite"
          style={{ whiteSpace: 'normal', maxWidth: 'min(90vw, 720px)', textAlign: 'center' }}
        >
          Ponto {Math.min(completedList.length + 1, activePoints.length)} de{' '}
          <span className="highlight" data-testid="calib-progress-total">{activePoints.length}</span>
          {preparing && <> — olhe para o ponto azul e fique parado</>}
          {errorMessage && <> — {errorMessage}</>}
        </div>

        {/* Pontos de calibração */}
        {activePoints.map((pt, idx) => {
          const isCurrent      = idx === currentIndex;
          const isDone         = completedList.includes(idx);
          const isJustFinished = idx === lastCompletedPoint;

          if (isCurrent && !isJustFinished) {
            return (
              <div
                key={idx}
                className="accuracy-dot"
                data-calibration-target=""
                style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
              >
                <div className="dot-inner" />
              </div>
            );
          }

          return (
            <div
              key={idx}
              data-calibration-target=""
              style={{
                position: 'absolute',
                left: `${pt.x}%`, top: `${pt.y}%`,
                transform: 'translate(-50%, -50%)',
                width: 48, height: 48,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              {isJustFinished ? (
                <div
                  className="animate-scale-in"
                  style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: 'var(--ok)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Check size={28} style={{ color: 'var(--on-primary)' }} aria-hidden="true" />
                </div>
              ) : (
                <div
                  style={{
                    width: isDone ? 10 : 8, height: isDone ? 10 : 8, borderRadius: '50%',
                    background: isDone
                      ? 'color-mix(in srgb, var(--ok) 45%, transparent)'
                      : 'color-mix(in srgb, var(--accent) 35%, transparent)',
                  }}
                />
              )}
            </div>
          );
        })}
      </main>
    );
  }

  // ─── Demais etapas: moldura padrão do paciente ──────────────────────────
  return (
    <main role="main" className="gaze-page">
      <header className="gaze-page__header">
        <div className="gaze-page__slot">
          {stage === 'tutorial' ? <BackButton /> : <div style={{ width: 160 }} />}
        </div>
        <div className="gaze-page__slot" style={{ flex: 1, minWidth: 0, height: '100%' }}>
          <div
            data-no-dwell="true"
            className="gaze-rest-zone"
            aria-label="Zona de descanso: olhar aqui não aciona nada"
          >
            <span className="gaze-page__title">Calibração</span>
            <span>Zona de descanso</span>
          </div>
        </div>
        {/* Espaço do botão de emergência global */}
        <div className="gaze-page__slot gaze-page__slot--end" aria-hidden="true" />
      </header>

      <div className="gaze-page__content" style={{ overflowY: 'auto' }}>
        {/* ─── PREPARAÇÃO ───────────────────────────────────────────── */}
        {stage === 'tutorial' && (
          <div
            className="animate-fade-in"
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(320px, 5fr) minmax(360px, 6fr)',
              gap: 40,
              alignItems: 'start',
              minHeight: '100%',
            }}
          >
            {/* Coluna do cuidador: condições do posto e opções (mouse) */}
            <section
              aria-labelledby="calib-prep-title"
              style={{
                display: 'flex', flexDirection: 'column', gap: '1rem',
                padding: '1.25rem',
                borderRadius: 'var(--r-lg)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <h2 id="calib-prep-title" style={{ fontSize: 'var(--fs-20)', fontWeight: 800 }}>
                Preparação do posto de uso
              </h2>
              <ReadinessPanel />

              <label
                htmlFor="opticalConditionSelect"
                data-testid="optical-condition-label"
                style={{ fontSize: 'var(--fs-16)', fontWeight: 700, color: 'var(--text-2)' }}
              >
                Condição visual do usuário
              </label>
              <select
                id="opticalConditionSelect"
                data-testid="optical-condition-select"
                value={opticalCondition}
                onChange={(e) => setOpticalCondition(e.target.value as OpticalCondition)}
                data-no-dwell="true"
                style={{
                  padding: '0.7rem 0.9rem',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontSize: 'var(--fs-16)',
                }}
              >
                {OPTICAL_OPTIONS.map((cond) => (
                  <option key={cond} value={cond}>{OPTICAL_LABELS[cond]}</option>
                ))}
              </select>

              <label
                data-testid="auto-record-label"
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.7rem',
                  padding: '0.75rem 0.9rem',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  fontSize: 'var(--fs-16)', color: 'var(--text-2)', cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={autoRecord}
                  onChange={(e) => setAutoRecord(e.target.checked)}
                  data-no-dwell="true"
                  data-testid="auto-record-checkbox"
                  style={{ width: 20, height: 20, marginTop: 2, accentColor: 'var(--primary)' }}
                />
                <span>
                  <strong style={{ color: 'var(--text)' }}>Gravar sessão</strong> junto com esta calibração
                  {isRecording && (
                    <strong style={{ color: 'var(--danger)', marginLeft: '0.5rem' }}>gravando</strong>
                  )}
                  <br />
                  <span style={{ color: 'var(--text-3)' }}>
                    Grava calibração e teste de precisão; o arquivo baixa sozinho ao terminar. Refazer ou falhar descarta.
                  </span>
                </span>
              </label>

              {errorMessage && (
                <div
                  role="alert"
                  className="animate-fade-in"
                  style={{
                    display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                    padding: '1rem',
                    borderRadius: 'var(--r-md)',
                    background: 'var(--danger-soft)',
                    border: '1px solid var(--danger)',
                    color: 'var(--text)',
                    lineHeight: 1.5,
                  }}
                >
                  <AlertTriangle size={24} style={{ flexShrink: 0, color: 'var(--danger)' }} aria-hidden="true" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div>
                      <strong style={{ display: 'block' }}>A calibração não foi concluída</strong>
                      {errorMessage}
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      data-no-dwell="true"
                      style={{ alignSelf: 'flex-start' }}
                      onClick={() => navigate('/caregiver/guide?from=/calibration-check')}
                    >
                      <BookOpen size={16} aria-hidden="true" /> Ver o guia do cuidador
                    </button>
                  </div>
                </div>
              )}

              <div
                id="l2cs-status-message"
                role={l2csFailed ? 'alert' : 'status'}
                aria-live="polite"
                style={{ fontSize: 'var(--fs-16)', color: l2csFailed ? 'var(--danger)' : 'var(--text-3)', minHeight: '1.4rem', lineHeight: 1.5 }}
              >
                {l2csStatus === 'loading' && 'Preparando o rastreamento (10 a 15 s na primeira vez). Não feche a página.'}
                {l2csFailed && 'Não foi possível carregar o rastreamento. Recarregue a página e tente novamente.'}
              </div>
            </section>

            {/* Coluna do paciente: o que vai acontecer e os alvos para começar */}
            <section
              aria-labelledby="calib-title"
              style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center', textAlign: 'center' }}
            >
              <div
                aria-hidden="true"
                style={{ position: 'relative', width: 96, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <div
                  style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    border: '2px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                  }}
                />
                <div
                  style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: 'var(--accent)',
                    boxShadow: '0 0 24px color-mix(in srgb, var(--accent) 80%, transparent)',
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '36ch' }}>
                <h1 id="calib-title" className="font-display" style={{ fontSize: 'var(--fs-32)' }}>
                  Calibração
                </h1>
                <p style={{ fontSize: 'var(--fs-24)', color: 'var(--text-2)', lineHeight: 1.45 }}>
                  Um ponto azul vai aparecer na tela. Olhe direto para ele e fique parado até ele sumir.
                </p>
              </div>

              {/* Dwell longo nos dois alvos: começar por acidente custa 1–2 min
                  de sessão, então o acionamento tem de ser deliberado — mas
                  possível só com o olhar, para quem está sozinho. */}
              <div style={{ width: 'min(100%, 560px)', height: 380 }}>
                <GazeGrid columns={1} rows={2} gap={32}>
                  <GazeButton
                    variant="primary"
                    size="xl"
                    icon={
                      l2csStatus === 'loading'
                        ? <Loader2 className="animate-spin" />
                        : l2csFailed ? <AlertTriangle /> : <Play />
                    }
                    label={
                      l2csReady ? 'Começar (9 pontos)'
                        : l2csFailed ? 'Rastreamento indisponível'
                          : 'Preparando…'
                    }
                    onClick={() => handleStart(false)}
                    disabled={!l2csReady}
                    dwellMs={2500}
                    data-testid="start-calibration-full"
                    aria-disabled={!l2csReady}
                    aria-describedby="l2cs-status-message"
                  />
                  <GazeButton
                    variant="secondary"
                    size="lg"
                    icon={<Zap />}
                    label="Calibração rápida (4 pontos)"
                    onClick={() => handleStart(true)}
                    disabled={!l2csReady}
                    dwellMs={2500}
                    data-testid="start-calibration-quick"
                  />
                </GazeGrid>
              </div>
            </section>
          </div>
        )}

        {/* ─── AJUSTANDO / TESTE ─────────────────────────────────────── */}
        {stage === 'testing' && (
          <div
            className="animate-fade-in"
            role="status"
            aria-live="polite"
            style={{
              height: '100%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', gap: '1.25rem',
            }}
          >
            <Loader2 size={56} className="animate-spin" style={{ color: 'var(--primary)' }} aria-hidden="true" />
            <h2 className="font-display" style={{ fontSize: 'var(--fs-32)' }}>Quase lá</h2>
            <p style={{ fontSize: 'var(--fs-24)', color: 'var(--text-2)', maxWidth: '36ch' }}>
              Agora vem um teste rápido. Continue parado e olhe para os pontos que aparecerem.
            </p>
          </div>
        )}

        {/* ─── REVISÃO: deriva de pose e/ou alvos ignorados ─────────── */}
        {stage === 'review' && (
          <div
            role="alertdialog"
            aria-labelledby="review-title"
            aria-describedby="review-msg"
            className="animate-fade-in"
            style={{
              height: '100%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: '1.5rem',
            }}
          >
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                textAlign: 'center', gap: '1rem',
                width: 'min(100%, 720px)',
                padding: '1.75rem',
                borderRadius: 'var(--r-lg)',
                background: 'var(--warn-soft)',
                border: '2px solid var(--warn)',
              }}
            >
              <AlertTriangle size={48} style={{ color: 'var(--warn)' }} aria-hidden="true" />
              <h2 id="review-title" style={{ fontSize: 'var(--fs-32)' }}>
                {driftVerdict
                  ? 'A cabeça se moveu durante a calibração'
                  : 'Alguns pontos ficaram de fora'}
              </h2>
              <div id="review-msg" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: 'var(--fs-20)', color: 'var(--text-2)', lineHeight: 1.45 }}>
                {driftVerdict && (
                  <p>
                    {driftVerdict.acao === 'apoiar-a-nuca'
                      ? 'A postura foi mudando aos poucos. Apoie bem a cabeça antes de refazer; senão a próxima calibração sai igual.'
                      : 'Houve movimento durante a coleta. Refazer com a cabeça parada deve melhorar a precisão.'}
                  </p>
                )}
                {alvosPulados > 0 && (
                  <p data-testid="skipped-warning">
                    {alvosPulados === 1
                      ? '1 ponto foi ignorado — recomendamos refazer.'
                      : `${alvosPulados} pontos foram ignorados — recomendamos refazer.`}
                  </p>
                )}
              </div>

              {/* Detalhe medido, para o cuidador: separa "achei que mexi" de um
                  número. */}
              {driftVerdict && (
                <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div data-testid="drift-px" style={{ fontSize: 'var(--fs-32)', fontWeight: 800, color: 'var(--warn)' }}>
                      {driftVerdict.piorEixoPx.toFixed(0)}px
                    </div>
                    <div style={{ fontSize: 'var(--fs-16)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      deslocamento
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--fs-32)', fontWeight: 800 }}>
                      {driftVerdict.monotona ? 'Progressiva' : 'Errática'}
                    </div>
                    <div style={{ fontSize: 'var(--fs-16)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      padrão do movimento
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Refazer vem primeiro: é a ação que corrige. Continuar segue
                possível — repetir a coleta custa fadiga real. */}
            <div style={{ width: 'min(100%, 720px)', height: 180 }}>
              <GazeGrid columns={2} rows={1} gap={40}>
                <GazeButton
                  variant="primary"
                  size="lg"
                  icon={<RotateCcw />}
                  label="Refazer calibração"
                  dwellMs={2500}
                  data-testid="drift-recalibrar"
                  onClick={refazer}
                />
                <GazeButton
                  variant="secondary"
                  size="lg"
                  icon={<Crosshair />}
                  label="Continuar mesmo assim"
                  data-testid="drift-continuar"
                  onClick={continuarParaOTeste}
                />
              </GazeGrid>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};
