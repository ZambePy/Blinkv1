import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, Loader2, AlertTriangle } from 'lucide-react';
import { useGaze } from '../../context/GazeContext';
import { useSettings } from '../../context/SettingsContext';
import { SetupReadinessPanel } from '../../components/ui/SetupReadinessPanel';
import type { ReadinessReport, EffectiveDistance } from '@tracker/setupReadiness';
import { effectiveViewingDistanceCm } from '@tracker/setupReadiness';
import { BackButton } from '../../components/ui/BackButton';
import { startAccuracyTest } from '@tracker/accuracy';
import { buildAutoTestMeta, readinessMetaFrom } from '../../utils/autoTestMeta';
import type { OpticalCondition } from '@tracker/calibrationProfiles';

// D6.1 — a lista canônica de alvos passou a viver em `src/calibration.ts`
// (CALIBRATION_TARGETS_FULL). A UI consulta pelo context após chamar
// startCalibrationMode(opts) — a lista muda entre full (9 alvos) e quick
// (4 cantos) conforme `opts.quick`. Enquanto nada é iniciado, a lista default
// é a full pra a tela de tutorial mostrar "9 pontos" com honestidade.
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

// D6.2 — opções de condição óptica expostas ao cuidador. `desconhecido` é o
// default de compat (perfil pré-D6). Progressivos ganham warn no console
// via shouldWarnPrecisionForCondition — não é mentira dizer que a precisão
// vai ser pior. A UI mostra o rótulo em português.
const OPTICAL_LABELS: Record<OpticalCondition, string> = {
  sem_oculos:          'Sem óculos',
  oculos_simples:      'Óculos comuns (leitura, míopia)',
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

// ─── Paleta CAA — escura em todas as etapas ────────────────────────────────
// Fundo preto reduz fadiga ocular e força menos a piscada, permitindo fixações
// mais longas e estáveis. Contraste alto (branco/âmbar sobre preto) é o padrão CAA.
const BG           = '#000000';
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_DIM     = 'rgba(255,255,255,0.65)';
const ACCENT       = '#1B54A8';          // IrisFlow Azul
const ACCENT_DIM   = 'rgba(27, 84, 168, 0.15)';
const SUCCESS      = '#22C55E';
const DANGER       = '#EF4444';

const humanMessage: Record<string, string> = {
  singular_matrix: 'Não foi possível treinar o modelo (matriz singular). A causa mais comum é reflexo constante nos óculos ou desvio extremo do olhar.',
  insufficient_samples: 'Amostras insuficientes coletadas. Certifique-se de que seu rosto está visível e centralizado durante toda a calibração.',
  degenerate_features: 'Os dados coletados não variaram o suficiente. A causa mais comum é reflexo nos óculos travando a detecção ou olhar fixo fora dos pontos.',
  unknown: 'Erro desconhecido durante o treinamento do modelo. Por favor, tente novamente.',
};

// D3.2 (ROADMAP §5) — chave do localStorage pro checkbox "gravar sessão junto
// com a calibração". Motivo do design: o sweep de EXPAND_FACTOR exige 6
// rodadas de calibração+accuracy em fila, e no fluxo original o botão de
// gravar mora em Configurações. Alternar entre telas 6 vezes é atrito real.
// Deixando o checkbox aqui (default OFF, opt-in explícito), o operador que
// vai rodar sweep marca uma vez e faz as 6 rodadas sem sair da tela.
// Diferença essencial pro auto-recording revertido no D2: aqui é opt-in
// explícito, não sempre-ligado. Usuário normal nunca dispara gravação sem
// querer.
const AUTO_RECORD_STORAGE_KEY = 'irisflow.autoRecordOnCalibrate';

export const CalibrationCheck: React.FC = () => {
  const navigate = useNavigate();
  const { calibration, l2csStatus, getSessionUptimeMs, recording } = useGaze();
  // D9 — geometria física do posto de uso. Fonte ÚNICA para (a) o erro angular
  // do relatório e (b) o posicionamento dos alvos pelo orçamento de
  // excentricidade. Antes eram dois hardcodes de 15,6"/60 cm em arquivos
  // diferentes, e numa tela de 23,6" o erro angular saía 34% menor que o real.
  const { settings } = useSettings();

  const l2csReady  = l2csStatus === 'ready';
  const l2csFailed = l2csStatus === 'error';

  const [stage, setStage] = useState<
    'pre-calibration' | 'tutorial' | 'calibrating' | 'testing' | 'transitioning'
  >('pre-calibration');

  // Etapa 2 — último veredito do posto de uso. Serve para (a) liberar o
  // botão de avançar e (b) gravar as CONDIÇÕES MEDIDAS no relatório, no
  // lugar dos hardcodes que havia no `RunMeta`.
  const readinessRef = useRef<ReadinessReport | null>(null);
  // Distância efetiva escolhida no início desta calibração. Congelada aqui
  // para a grade e o relatório usarem exatamente o mesmo número.
  const sessionDistanceRef = useRef<EffectiveDistance | null>(null);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const handleReadiness = useCallback((r: ReadinessReport) => {
    readinessRef.current = r;
    setReadiness(r);
  }, []);

  const [currentIndex, setCurrentIndex]       = useState(0);
  const [completedList, setCompletedList]     = useState<number[]>([]);
  const [errorMessage, setErrorMessage]       = useState<string | null>(null);
  const [lastCompletedPoint, setLastCompletedPoint] = useState<number | null>(null);
  const [preparing, setPreparing]             = useState(false);
  const PREPARE_MS = 1500;

  // D6.2 — seleção da condição óptica antes de iniciar. Default `desconhecido`
  // preserva o comportamento antes de D6 (perfil salvo como desconhecido).
  const [opticalCondition, setOpticalCondition] = useState<OpticalCondition>('desconhecido');

  // D3.2 — checkbox opt-in pra iniciar a gravação junto com a calibração.
  // Persistido para o operador do sweep de EXPAND_FACTOR não precisar remarcar
  // a cada rodada. STOP e EXPORT continuam manuais em Configurações.
  const [autoRecord, setAutoRecord] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTO_RECORD_STORAGE_KEY) === 'true'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(AUTO_RECORD_STORAGE_KEY, String(autoRecord)); }
    catch { /* localStorage indisponível — silencia */ }
  }, [autoRecord]);
  // Espelho reativo do isActive() do recorder — usado só para mostrar o
  // indicador "🔴 Gravando" na UI. Poll a 500 ms é barato e evita ter que
  // adicionar API de subscription no recorder por conta desse único consumidor.
  const [isRecording, setIsRecording] = useState<boolean>(false);
  useEffect(() => {
    const tick = () => setIsRecording(recording.isActive());
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [recording]);
  // D6.1 — modo em curso; controla renderização de "4/4" vs "9/9" e a lista
  // de alvos consultada para display. Nulo enquanto nada iniciou.
  const [calibrationMode, setCalibrationMode] = useState<'full' | 'quick' | null>(null);

  // Lista de alvos ATUALMENTE usada pela sessão em curso (ou full por default).
  // useMemo por segurança contra rerenders desnecessários — a lista muda só
  // quando calibrationMode muda.
  const activePoints: CalibrationPointUI[] = useMemo(() => {
    const targets = calibrationMode === 'quick'
      ? calibration.getCalibrationTargets?.() ?? []
      : calibration.getCalibrationTargets?.() ?? [];
    if (targets.length === 0) {
      // Fallback: se o engine ainda não subiu, hardcode a grade full para
      // não quebrar a tela de tutorial. Idêntico ao layout pré-D6.
      return [
        { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 },
        { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
        { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.9 },
      ].map((t) => ({ x: t.x * 100, y: t.y * 100, name: POINT_NAME[`${t.x},${t.y}`] ?? '' }));
    }
    return targets.map((t) => ({
      x: t.x * 100,
      y: t.y * 100,
      name: POINT_NAME[`${t.x},${t.y}`] ?? '',
    }));
  }, [calibrationMode, calibration]);

  const shuffleOrderRef          = useRef<number[]>([]);
  const isMounted                = useRef(true);
  const retryCountRef            = useRef(0);
  const MAX_RETRIES_PER_POINT    = 3;

  // D3.2 — ownership da gravação auto-iniciada. Só finalizamos gravação que
  // ESTE componente iniciou (via handleStart com autoRecord marcado). Se o
  // operador começou manualmente em Configurações, deixamos em paz.
  const autoRecordOwnedRef = useRef(false);
  // Ref atualizada a cada render pra callback de unmount + timeouts sempre
  // enxergarem a versão mais nova (evita closure obsoleto sobre `recording`).
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
      console.log('[calib] gravação descartada (attempt incompleto)');
    }
    recording.clear();
    autoRecordOwnedRef.current = false;
  };

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // Sair da tela no meio de uma gravação auto-iniciada: descarta pra não
      // deixar JSONL parcial em lugar nenhum.
      finalizeAutoRecordingRef.current(false);
    };
  }, []);

  const finishAndTransition = () => {
    setStage('transitioning');
    setTimeout(() => { navigate('/menu'); }, 800);
  };

  const runAccuracyTestThenExit = () => {
    // D2 (ROADMAP.md) — meta capturada NA HORA do accuracy test, não no mount:
    //   - `minutosDeSessao` reflete uptime real do engine (via engine.getSessionUptimeMs)
    //   - `oculos` deriva do perfil ativo (`desconhecido` até D6 expor a UI)
    // Antes: hardcode 0/false, todo relatório automático mentia.
    const meta = buildAutoTestMeta({
      sessionUptimeMs: getSessionUptimeMs(),
      opticalCondition: calibration.getActiveOpticalCondition?.() ?? 'desconhecido',
      // D9 — diagonal configurada pelo cuidador (Configurações → Teste de
      // precisão) ou lida do EDID, persistida em SettingsContext.
      // Etapa 1 — a MESMA distância que posicionou a grade. Se o relatório
      // convertesse px→graus com um número diferente do que montou os alvos,
      // as duas metades do diagnóstico falariam de geometrias distintas.
      distanciaCm: sessionDistanceRef.current?.cm ?? settings.viewingDistanceCm,
      telaPolegadas: settings.screenDiagonalIn,
    });
    meta.screenScaleFactor = settings.screenScaleFactor;

    // Etapa 2 — sobrescreve com as condições MEDIDAS nesta sessão. Precisa vir
    // DEPOIS de buildAutoTestMeta: aquela função preenche `iluminacao: 'boa'`,
    // `movimentoCabeca: 'parada'` e deriva `oculos` da condição que o cuidador
    // escolheu na tela — todos independentes do que a câmera estava vendo.
    // Comparar sessões com metadado inventado é pior que não ter metadado: dá
    // aparência de rastreabilidade sem o conteúdo.
    Object.assign(meta, readinessMetaFrom(readinessRef.current));
    startAccuracyTest((_result, action) => {
      if (!isMounted.current) return;
      if (action === 'redo') {
        // Attempt descartado — não exporta um JSONL parcial.
        finalizeAutoRecordingRef.current(false);
        calibration.clear?.();
        setStage('tutorial');
        setCompletedList([]);
        return;
      }
      // Fluxo bem-sucedido: para + exporta antes de sair da tela.
      finalizeAutoRecordingRef.current(true);
      finishAndTransition();
    }, meta);
  };

  const startNextPoint = (step: number) => {
    if (!isMounted.current) return;
    const order = shuffleOrderRef.current;

    if (step >= order.length) {
      setStage('testing');
      calibration.completeCalibration?.((outcome) => {
        if (!outcome || outcome.ok !== false) {
          console.log('[React] Calibração concluída — disparando teste de precisão automático');
          setTimeout(() => { if (isMounted.current) runAccuracyTestThenExit(); }, 400);
        } else {
          if (isMounted.current) {
            const reason = outcome.reason || 'unknown';
            const msg = humanMessage[reason] || humanMessage.unknown;
            console.error(`[React] Treinamento falhou: ${reason} - ${outcome.detail}`);
            // Calibração falhou — o JSONL até aqui não tem accuracy test útil.
            // Descarta em vez de exportar; próxima tentativa recomeça limpa.
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

    const pt = activePoints[pointIdx];
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
          retryCountRef.current = 0;
          setCompletedList(prev => [...prev, pointIdx]);
          setTimeout(() => { if (isMounted.current) startNextPoint(step + 1); }, 500);
        } else {
          setErrorMessage('Tente não se mover. Tentando novamente...');
          setTimeout(() => { if (isMounted.current) startNextPoint(step); }, 1500);
        }
      }
    });
  };

  // D6.1/D6.2 — inicia calibração. `quick=true` reduz para 4 cantos e passa
  // opts.quick para o backend. `opticalCondition` grava o perfil sob a
  // condição escolhida — antes de D6.2, todo perfil ficava como `desconhecido`
  // silenciosamente.
  const handleStart = (quick: boolean = false) => {
    if (!l2csReady) return;

    // D3.2 — se o operador marcou o opt-in E ainda não há uma gravação ativa
    // (ex.: iniciada manualmente em Configurações), inicia agora. Paramos +
    // exportamos automaticamente após o accuracy test bem-sucedido. NÃO
    // paramos gravação iniciada manualmente em Settings (o `autoRecordOwnedRef`
    // é a distinção).
    // Diferença essencial pro auto-recording revertido no D2: aqui é opt-in
    // explícito (checkbox default off), o download vai pro Downloads do
    // browser (não pro project root via IPC), e cancelamentos/redos são
    // descartados em vez de exportados.
    if (autoRecord && !recording.isActive()) {
      recording.start();
      autoRecordOwnedRef.current = true;
      console.log('[calib] gravação iniciada junto com a calibração (opt-in D3.2)');
    }

    setCalibrationMode(quick ? 'quick' : 'full');
    setStage('calibrating');
    setCompletedList([]);

    // startCalibrationMode ANTES do useMemo reagir — chamamos aqui e a lista
    // ativa vem via getCalibrationTargets() na hora do startNextPoint.
    // Etapa 1 → pipeline: a distância MEDIDA nesta sessão manda, quando existe.
    //
    // `viewingDistanceCm` posiciona os alvos pelo orçamento de excentricidade.
    // Enquanto era só digitado, um paciente que sentasse 10 cm mais perto
    // recebia a grade montada para a distância de ontem — e as duas gravações
    // reais do repositório diferiam 30% em tamanho de rosto, exatamente esse
    // efeito. Fica registrado em `sessionDistanceRef` para o relatório usar a
    // MESMA distância que a grade usou.
    const dist = effectiveViewingDistanceCm(
      readinessRef.current?.measured.estimatedDistanceCm ?? null,
      settings.viewingDistanceCm,
    );
    sessionDistanceRef.current = dist;
    if (dist.rejectedReason) {
      console.warn(`[Etapa1] ${dist.rejectedReason}; usando ${dist.cm} cm configurado.`);
    } else {
      console.log(`[Etapa1] distância da sessão: ${dist.cm.toFixed(1)} cm (${dist.source}).`);
    }

    calibration.startCalibrationMode?.({
      quick,
      opticalCondition,
      // D9 — mesma geometria do relatório: a grade e o erro angular passam a
      // falar da mesma tela.
      geometry: {
        screenDiagonalIn: settings.screenDiagonalIn,
        viewingDistanceCm: dist.cm,
      },
    });

    // Ordem embaralhada em cima do TAMANHO REAL da lista ativa após o setState
    // (que ainda não propagou). Como `getCalibrationTargets` já retorna a
    // lista certa depois de startCalibrationMode, usamos ela direto.
    const targets = calibration.getCalibrationTargets?.() ?? [];
    const order = targets.map((_, i) => i);
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

  const progressPct = activePoints.length > 0
    ? (completedList.length / activePoints.length) * 100
    : 0;

  // ─── TRANSIÇÃO ────────────────────────────────────────────────────────────
  if (stage === 'transitioning') {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        backgroundColor: BG,
        zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'cfFadeOut 0.8s ease-in-out forwards',
      }}>
        <div style={{
          width: '100vw', height: '100vh',
          background: `radial-gradient(circle, ${ACCENT} 0%, ${BG} 100%)`,
          animation: 'cfRipple 0.8s ease-out forwards',
        }} />
        <style>{`
          @keyframes cfFadeOut { from { opacity:1; } to { opacity:0; } }
          @keyframes cfRipple  { from { transform:scale(0.1); opacity:1; } to { transform:scale(3); opacity:0; } }
        `}</style>
      </div>
    );
  }

  return (
    <>
      <main
        role="main"
        style={{
          position: 'relative',
          width: '100vw', height: '100vh',
          background: BG,
          color: TEXT_PRIMARY,
          overflow: 'hidden',
          userSelect: 'none',
          display: 'flex', flexDirection: 'column',
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Botão Voltar — só nas telas pré-calibração */}
        {(stage === 'pre-calibration' || stage === 'tutorial') && (
          <div style={{ position: 'absolute', top: '2rem', left: '2rem', zIndex: 60 }}>
            <BackButton />
          </div>
        )}

        {/* ─── PRÉ-CALIBRAÇÃO ──────────────────────────────────────────── */}
        {stage === 'pre-calibration' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
            <div style={{
              maxWidth: 600, width: '100%',
              display: 'flex', flexDirection: 'column', gap: '1.75rem',
              animation: 'cfFadeUp 0.4s ease-out both',
            }}>
              {/* Cabeçalho CAA */}
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 88, height: 88, borderRadius: '50%',
                  background: ACCENT_DIM,
                  border: `3px solid ${ACCENT}`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '1.25rem',
                }}>
                  <Eye size={44} color={ACCENT} />
                </div>
                <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 0.5rem', color: TEXT_PRIMARY }}>
                  Antes de começar
                </h1>
                <p style={{ fontSize: '1.05rem', color: TEXT_DIM, margin: 0, lineHeight: 1.6 }}>
                  A câmera está conferindo as condições. Ajuste o que estiver
                  marcado antes de calibrar.
                </p>
              </div>

              {/* Etapa 2 — verificação AO VIVO do posto de uso. Substituiu três
                  cards de texto fixo que diziam "fique a 50-60 cm", "rosto bem
                  iluminado" e "cabeça parada": conselhos corretos, mas que o
                  usuário não tinha como saber se estava cumprindo. Agora os
                  mesmos três itens são medidos e mostrados com o valor real. */}
              <SetupReadinessPanel onReport={handleReadiness} />

              {/* Só "sem rosto" / "câmera inadequada" desabilitam de verdade —
                  nessas condições a calibração não tem como funcionar. Avisos
                  mudam o rótulo do botão mas deixam seguir (regra 2 do
                  projeto: a UI não prende o usuário). */}
              <button
                type="button"
                disabled={readiness?.blockedHard ?? false}
                onClick={() => setStage('tutorial')}
                style={{
                  background: readiness?.blockedHard ? 'rgba(255,255,255,0.10)' : ACCENT,
                  color: readiness?.blockedHard ? TEXT_DIM : '#fff',
                  border: 'none', padding: '1rem 3rem',
                  borderRadius: '2rem', fontSize: '1.15rem', fontWeight: 800,
                  cursor: readiness?.blockedHard ? 'not-allowed' : 'pointer',
                  alignSelf: 'center',
                  boxShadow: readiness?.blockedHard ? 'none' : '0 8px 24px rgba(27, 84, 168, 0.40)',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseOver={e => { if (!readiness?.blockedHard) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(27, 84, 168, 0.55)'; } }}
                onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = readiness?.blockedHard ? 'none' : '0 8px 24px rgba(27, 84, 168, 0.40)'; }}
              >
                {readiness?.blockedHard
                  ? 'Ajuste a câmera para continuar'
                  : readiness && !readiness.canStart
                    ? 'Continuar mesmo assim'
                    : 'Tudo certo ✓'}
              </button>
            </div>
          </div>
        )}

        {/* ─── TUTORIAL / INÍCIO ───────────────────────────────────────── */}
        {stage === 'tutorial' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
            <div style={{
              maxWidth: 500, width: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              textAlign: 'center', gap: '2rem',
              animation: 'cfFadeUp 0.4s ease-out both',
            }}>
              {/* Preview do ponto — mostra ao usuário o que vai aparecer */}
              <div style={{ position: 'relative', width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ position: 'absolute', width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle, rgba(27, 84, 168, 0.22) 0%, transparent 70%)`, animation: 'cfRadarPing 2s ease-out infinite' }} />
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: ACCENT, boxShadow: `0 0 30px ${ACCENT}`, animation: 'cfPulse 1.2s infinite alternate' }} />
                <div style={{ position: 'absolute', width: 9, height: 9, borderRadius: '50%', background: BG, opacity: 0.85 }} />
              </div>

              <div>
                <h1 style={{ fontSize: '2.1rem', fontWeight: 800, margin: '0 0 0.75rem', color: TEXT_PRIMARY }}>
                  Calibração
                </h1>
                <p style={{ fontSize: '1.1rem', color: TEXT_DIM, margin: 0, lineHeight: 1.65 }}>
                  Um ponto <strong style={{ color: ACCENT }}>azul</strong> vai aparecer na tela.<br />
                  Olhe <strong style={{ color: TEXT_PRIMARY }}>direto para ele</strong> e fique parado até sumir.
                </p>
              </div>

              {errorMessage && (
                <div style={{
                  padding: '1rem',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: `1px solid ${DANGER}`,
                  borderRadius: '0.75rem',
                  color: DANGER,
                  fontSize: '0.95rem',
                  maxWidth: 400,
                  lineHeight: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  textAlign: 'left',
                  animation: 'cfFadeUp 0.3s ease-out both'
                }}>
                  <AlertTriangle size={24} style={{ flexShrink: 0 }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.15rem' }}>Falha na calibração</strong>
                    {errorMessage}
                    <div style={{ marginTop: '0.5rem' }}>
                      <a
                        href="/caregiver/guide"
                        onClick={(e) => {
                          e.preventDefault();
                          navigate('/caregiver/guide?from=/calibration-check');
                        }}
                        style={{
                          color: '#ef4444',
                          fontWeight: 700,
                          textDecoration: 'underline',
                          fontSize: '0.9rem',
                          cursor: 'pointer'
                        }}
                      >
                        Ver Guia de Instalação e Dicas do Cuidador
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* D6.2 — seleção da condição óptica ANTES de iniciar. Persiste no
                   perfil salvo (StoredCalibrationProfile.meta.opticalCondition).
                   Antes de D6.2 todo perfil ficava como 'desconhecido' — o
                   default aqui preserva esse fallback caso o cuidador não escolha. */}
              <label
                htmlFor="opticalConditionSelect"
                data-testid="optical-condition-label"
                style={{
                  fontSize: '0.9rem',
                  color: TEXT_DIM,
                  alignSelf: 'stretch',
                  textAlign: 'left',
                  fontWeight: 600,
                }}
              >
                Condição óptica do usuário:
              </label>
              <select
                id="opticalConditionSelect"
                data-testid="optical-condition-select"
                value={opticalCondition}
                onChange={(e) => setOpticalCondition(e.target.value as OpticalCondition)}
                data-no-dwell="true"
                style={{
                  alignSelf: 'stretch',
                  padding: '0.75rem 1rem',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '0.75rem',
                  color: TEXT_PRIMARY,
                  fontSize: '1rem',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {OPTICAL_OPTIONS.map((cond) => (
                  <option key={cond} value={cond} style={{ background: '#111' }}>
                    {OPTICAL_LABELS[cond]}
                  </option>
                ))}
              </select>

              {/* D3.2 — opt-in de gravação. Fica ANTES do botão primário para
                   que o operador do sweep marque uma vez e clique 6× seguidas
                   sem sair da tela. Persistido em localStorage. */}
              <label
                data-testid="auto-record-label"
                style={{
                  alignSelf: 'stretch',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  fontSize: '0.9rem',
                  color: TEXT_DIM,
                  cursor: 'pointer',
                  padding: '0.6rem 0.9rem',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: '0.75rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={autoRecord}
                  onChange={(e) => setAutoRecord(e.target.checked)}
                  data-no-dwell="true"
                  data-testid="auto-record-checkbox"
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: ACCENT }}
                />
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <strong style={{ color: TEXT_PRIMARY }}>Gravar sessão</strong> junto com esta calibração
                  {isRecording && (
                    <span style={{ color: DANGER, marginLeft: '0.5rem', fontWeight: 700 }}>
                      🔴 gravando
                    </span>
                  )}
                  <br />
                  <span style={{ fontSize: '0.78rem', color: TEXT_DIM }}>
                    Grava calibração + teste de precisão. JSONL baixa automático quando
                    o teste termina. Redo/falha descarta.
                  </span>
                </span>
              </label>

              <button
                type="button"
                onClick={() => handleStart(false)}
                disabled={!l2csReady}
                data-no-dwell="true"
                data-testid="start-calibration-full"
                aria-disabled={!l2csReady}
                aria-describedby="l2cs-status-message"
                style={{
                  background: l2csReady ? ACCENT : 'rgba(255,255,255,0.10)',
                  color: l2csReady ? '#fff' : TEXT_DIM,
                  border: 'none',
                  padding: '1rem 3rem',
                  borderRadius: '2rem',
                  fontSize: '1.15rem', fontWeight: 800,
                  cursor: l2csReady ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: '0.7rem',
                  transition: 'all 0.2s',
                  boxShadow: l2csReady ? '0 8px 24px rgba(27, 84, 168, 0.40)' : 'none',
                  opacity: l2csReady ? 1 : 0.75,
                }}
                onMouseOver={e => { if (l2csReady) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(27, 84, 168, 0.55)'; } }}
                onMouseOut={e => { if (l2csReady) { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 8px 24px rgba(27, 84, 168, 0.40)'; } }}
              >
                {l2csReady && '👁  Começar (9 pontos)'}
                {l2csStatus === 'loading' && (<><Loader2 size={20} style={{ animation: 'cfSpin 1s linear infinite' }} />Carregando...</>)}
                {l2csFailed && (<><AlertTriangle size={20} />Modelo indisponível</>)}
              </button>

              {/* D6.1 — modo rápido: 4 cantos, sem centro. Coerente com o
                   achado Frontiers 2024 (§3 do ROADMAP). Meta de tempo: <15s
                   contra ~19-29s do modo completo. Botão SECUNDÁRIO — o full
                   continua sendo a via principal para usuário novo. */}
              {l2csReady && (
                <button
                  type="button"
                  onClick={() => handleStart(true)}
                  data-no-dwell="true"
                  data-testid="start-calibration-quick"
                  style={{
                    background: 'transparent',
                    color: TEXT_PRIMARY,
                    border: `1px solid rgba(255,255,255,0.35)`,
                    padding: '0.7rem 2.2rem',
                    borderRadius: '2rem',
                    fontSize: '0.95rem', fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                  onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  Recalibração rápida (4 pontos)
                </button>
              )}

              <div
                id="l2cs-status-message"
                role={l2csFailed ? 'alert' : 'status'}
                aria-live="polite"
                style={{ fontSize: '0.88rem', color: l2csFailed ? DANGER : TEXT_DIM, minHeight: '1.4rem', maxWidth: 400, lineHeight: 1.5 }}
              >
                {l2csStatus === 'loading' && 'Aguardando o modelo (~10-15s na 1ª vez). Não feche a página.'}
                {l2csFailed && 'Não foi possível carregar o modelo. Recarregue a página e tente novamente.'}
              </div>
            </div>
          </div>
        )}

        {/* ─── CALIBRANDO ──────────────────────────────────────────────── */}
        {stage === 'calibrating' && (
          <>
            {/* D3.2 — indicador de gravação. Canto superior direito, discreto,
                 fora do centro do olhar. Só aparece se recorder ativo — assim
                 continua invisível pra usuário que gravou via Configurações. */}
            {isRecording && (
              <div
                data-testid="recording-indicator"
                style={{
                  position: 'absolute', top: '1.25rem', right: '1.5rem', zIndex: 45,
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.35rem 0.7rem',
                  background: 'rgba(239,68,68,0.10)',
                  border: `1px solid ${DANGER}`,
                  borderRadius: '999px',
                  color: DANGER, fontSize: '0.8rem', fontWeight: 700,
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: DANGER,
                  animation: 'cfPulseRed 1.2s infinite alternate',
                }} />
                Gravando
              </div>
            )}

            {/* Barra de progresso — discreta, no topo, não distrai o olhar */}
            <div style={{
              position: 'absolute', top: '1.25rem', left: '50%', transform: 'translateX(-50%)',
              zIndex: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem',
            }}>
              <div style={{ width: 130, height: 4, background: 'rgba(255,255,255,0.10)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${progressPct}%`, height: '100%', background: ACCENT, transition: 'width 0.5s ease-out', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: '0.8rem', color: TEXT_DIM, fontVariantNumeric: 'tabular-nums' }}>
                {completedList.length} / {activePoints.length}
              </span>
            </div>

            {/* Instrução contextual — só quando necessário (prepare-se / erro) */}
            {(preparing || errorMessage) && (
              <div style={{
                position: 'absolute', bottom: '2.5rem', left: '50%', transform: 'translateX(-50%)',
                zIndex: 40, padding: '0.7rem 2rem',
                background: errorMessage ? 'rgba(239,68,68,0.12)' : 'rgba(27, 84, 168, 0.10)',
                border: `1px solid ${errorMessage ? DANGER : ACCENT}`,
                borderRadius: '3rem',
                color: errorMessage ? DANGER : ACCENT,
                fontSize: '1.05rem', fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                {errorMessage ?? '👁  Prepare-se… olhe para o ponto azul'}
              </div>
            )}

            {/* Pontos de calibração */}
            {activePoints.map((pt, idx) => {
              const isCurrent      = idx === currentIndex;
              const isDone         = completedList.includes(idx);
              const isJustFinished = idx === lastCompletedPoint;

              return (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: `${pt.x}%`, top: `${pt.y}%`,
                    transform: 'translate(-50%, -50%)',
                    width: 80, height: 80,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: isCurrent ? 30 : 10,
                  }}
                >
                  {/* ── Ponto atual ── */}
                  {isCurrent && !isJustFinished && (
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {/* Halo pulsante — "olhe aqui" */}
                      <div style={{
                        position: 'absolute', width: 72, height: 72, borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(27, 84, 168, 0.22) 0%, transparent 70%)',
                        animation: 'cfRadarPing 2.2s ease-out infinite',
                      }} />
                      {/* Anel rotativo de guia */}
                      <div style={{
                        position: 'absolute', width: 52, height: 52, borderRadius: '50%',
                        border: '2px solid rgba(27, 84, 168, 0.40)',
                        animation: 'cfHalo 3s linear infinite',
                      }} />
                      {/* Ponto central — azul, limpo, sem elementos sobre ele */}
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%',
                        background: ACCENT,
                        boxShadow: `0 0 0 8px rgba(27, 84, 168, 0.18), 0 0 36px ${ACCENT}`,
                        animation: 'cfPulse 1.2s infinite alternate',
                      }} />
                    </div>
                  )}

                  {/* ── Recém concluído ── */}
                  {isJustFinished && (
                    <div style={{
                      width: 48, height: 48, borderRadius: '50%',
                      background: SUCCESS,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: `0 0 24px rgba(34,197,94,0.70)`,
                      animation: 'cfScaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
                    }}>
                      <CheckCircle2 size={28} color="#fff" />
                    </div>
                  )}

                  {/* ── Feito, não recente ── */}
                  {isDone && !isJustFinished && (
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: SUCCESS, opacity: 0.35 }} />
                  )}

                  {/* ── Pendente ── */}
                  {!isCurrent && !isDone && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.13)' }} />
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* ─── TESTING ─────────────────────────────────────────────────── */}
        {stage === 'testing' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              textAlign: 'center', gap: '1.5rem',
              animation: 'cfFadeUp 0.4s ease-out both',
            }}>
              <Loader2 size={52} color={ACCENT} style={{ animation: 'cfSpin 1s linear infinite' }} />
              <div>
                <h2 style={{ fontSize: '1.65rem', fontWeight: 800, margin: '0 0 0.5rem', color: TEXT_PRIMARY }}>
                  Iniciando teste de precisão
                </h2>
                <p style={{ color: TEXT_DIM, fontSize: '1rem', margin: 0, lineHeight: 1.6 }}>
                  Não se mexa. Olhe para os pontos que aparecerem.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ─── KEYFRAMES ───────────────────────────────────────────────── */}
        <style>{`
          @keyframes cfPulse {
            0%   { transform: scale(0.88); box-shadow: 0 0 0 8px rgba(27, 84, 168, 0.15), 0 0 18px #1B54A8; }
            100% { transform: scale(1.10); box-shadow: 0 0 0 12px rgba(27, 84, 168, 0.05), 0 0 44px #1B54A8; }
          }
          @keyframes cfRadarPing {
            0%   { transform: scale(0.1); opacity: 0.9; }
            100% { transform: scale(2.8); opacity: 0; }
          }
          @keyframes cfHalo {
            from { transform: rotate(0deg)   scale(1);    border-color: rgba(27, 84, 168, 0.40); }
            50%  { transform: rotate(180deg) scale(1.06); border-color: rgba(27, 84, 168, 0.20); }
            to   { transform: rotate(360deg) scale(1);    border-color: rgba(27, 84, 168, 0.40); }
          }
          @keyframes cfSpin    { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
          @keyframes cfFadeUp  { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
          @keyframes cfScaleIn { from { opacity:0; transform:scale(0.4); } to { opacity:1; transform:scale(1); } }
          @keyframes cfPulseRed { from { opacity: 0.55; } to { opacity: 1; } }
        `}</style>
      </main>
    </>
  );
};
