import React, { useEffect, useRef, useState } from 'react';
import { useGaze } from '../../context/GazeContext';
import {
  evaluateReadiness,
  aggregateSnapshots,
  type ReadinessReport,
  type ReadinessSnapshot,
  type CheckStatus,
} from '@tracker/setupReadiness';
import { detectFlicker, inferPowerLineHz } from '@tracker/flickerDetector';
import { useSettings } from '../../context/SettingsContext';

// Etapa 2 — verificação do posto de uso antes da calibração.
//
// Todos os sinais aqui JÁ eram calculados pelo pipeline (qualityAnalyzer,
// faceMatrix, landmarks) e alimentavam apenas portões internos e logs de
// console. O que faltava era mostrá-los a quem pode agir: sem isso o cuidador
// só descobria que o setup estava ruim depois de 30 s de coleta e de um teste
// de precisão com número feio, sem saber qual das condições corrigir.
//
// A decisão de bloquear é deliberadamente fraca: só "sem rosto" e "resolução
// inviável" impedem de seguir (regra 2 do projeto — a UI não prende o
// usuário). Todo o resto avisa e deixa passar.

// Paleta — mesma da tela de calibração, para a transição não trocar de
// linguagem visual no meio do fluxo.
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_DIM = 'rgba(255,255,255,0.65)';
const ACCENT = '#1B54A8';
const SUCCESS = '#22C55E';
const WARNING = '#F59E0B';
const DANGER = '#EF4444';

const COLOR_BY_STATUS: Record<CheckStatus, string> = {
  ok: SUCCESS,
  warn: WARNING,
  fail: DANGER,
  unknown: TEXT_DIM,
};

const ICON_BY_STATUS: Record<CheckStatus, string> = {
  ok: '✓',
  warn: '!',
  fail: '×',
  unknown: '·',
};

const LABEL_BY_ID: Record<string, string> = {
  face: 'Rosto',
  flicker: 'Cintilação',
  viewport: 'Tela cheia',
  resolution: 'Câmera',
  distance: 'Distância',
  centering: 'Enquadramento',
  headPose: 'Postura',
  lighting: 'Luz',
  contrast: 'Contraste',
  glasses: 'Reflexo',
};

/** Frames retidos para a mediana. 12 a 10 Hz ≈ 1,2 s — suficiente para o
 *  indicador parar de piscar sem ficar lento para reagir a um ajuste. */
const WINDOW = 12;

export interface SetupReadinessPanelProps {
  /** Recebe o veredito a cada atualização — a tela usa para liberar o botão e
   *  para gravar as condições medidas no relatório da sessão. */
  onReport?: (report: ReadinessReport) => void;
}

export const SetupReadinessPanel: React.FC<SetupReadinessPanelProps> = ({ onReport }) => {
  const { getDiagnostics, getCameraStream, getCameraTuning } = useGaze();
  const { settings, updateSettings } = useSettings();
  // Etapa 1 → Etapa 2: o campo de visão calibrado é o que habilita o medidor
  // de distância e o alvo "posicione a câmera a X cm". Sem ele o painel ainda
  // funciona, só não sabe traduzir tamanho-de-rosto em centímetros.
  const horizontalFovDeg = settings.cameraHorizontalFovDeg;
  const [tuning, setTuning] = useState(getCameraTuning());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bufferRef = useRef<ReadinessSnapshot[]>([]);
  const [report, setReport] = useState<ReadinessReport | null>(null);

  // Espelha o srcObject do engine em vez de abrir uma segunda captura: muitos
  // drivers recusam dois consumidores da mesma webcam, e mesmo quando aceitam
  // o custo de decode dobra.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let cancelled = false;
    const attach = () => {
      if (cancelled || !videoRef.current) return;
      const stream = getCameraStream();
      if (stream && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => { /* autoplay negado: sem preview, checagens seguem */ });
      }
    };
    attach();
    // A câmera pode ainda não estar pronta quando o painel monta.
    const retry = setInterval(attach, 400);
    return () => { cancelled = true; clearInterval(retry); };
  }, [getCameraStream]);

  useEffect(() => {
    const id = setInterval(() => {
      const d = getDiagnostics();
      if (!d) return;
      const snap: ReadinessSnapshot = {
        hasFace: d.framing.hasFace,
        iod: d.framing.iodPx,
        videoWidth: d.video.width,
        videoHeight: d.video.height,
        faceCenter: d.framing.faceCenter,
        pose: d.pose,
        brightness: d.quality.brightness,
        contrast: d.quality.contrast,
        detectorConfidence: d.quality.detectorConfidence,
        specularRatio: d.framing.specularRatio,
        // Item 5 — a geometria física configurada descreve a TELA. Se a janela
        // não a ocupa inteira, a conversão px→cm do erro angular mente.
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        screenWidth: window.screen?.width,
        screenHeight: window.screen?.height,
      };
      const buf = bufferRef.current;
      buf.push(snap);
      while (buf.length > WINDOW) buf.shift();

      const agg = aggregateSnapshots(buf);
      if (!agg) return;

      // Cintilação é calculada AQUI, a cada tique, a partir da série de brilho
      // na cadência de frame que o engine mantém.
      //
      // Antes vinha de `getFlicker()`, que o ajuste automático preenchia uma
      // única vez ao terminar: se ele não terminasse — rosto ausente durante a
      // convergência, driver recusando uma constraint — o item nunca aparecia.
      // E mesmo terminando, o valor congelava: o cuidador trocava a lâmpada e a
      // tela continuava mostrando o veredito antigo.
      const flicker = d.brightnessHistoryFps > 0
        ? detectFlicker(d.brightnessHistory, d.brightnessHistoryFps)
        : null;
      const next = evaluateReadiness(agg, {
        horizontalFovDeg,
        flicker,
        powerLineHz: flicker?.detected
          ? inferPowerLineHz(flicker.dominantHz, d.brightnessHistoryFps)
          : null,
      });
      setReport(next);
      setTuning(getCameraTuning());
      onReport?.(next);
    }, 100);
    return () => clearInterval(id);
  }, [getDiagnostics, onReport, horizontalFovDeg, getCameraTuning]);

  const checks = report?.checks ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Auto-visualização — o usuário precisa se ver para corrigir postura. */}
      <div style={{
        position: 'relative',
        borderRadius: '1rem',
        overflow: 'hidden',
        border: `1px solid rgba(255,255,255,0.10)`,
        background: '#000',
        aspectRatio: '16 / 9',
      }}>
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Pré-visualização da câmera"
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            // Espelhado: as pessoas se corrigem melhor vendo a imagem como num
            // espelho. Não afeta o pipeline — o crop do L2CS desespelha por
            // conta própria a partir do stream original.
            transform: 'scaleX(-1)',
            display: 'block',
          }}
        />
        {report && !report.checks.find((c) => c.id === 'face' && c.status === 'ok') && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            color: TEXT_PRIMARY, fontWeight: 700, fontSize: '1rem', textAlign: 'center',
            padding: '1rem',
          }}>
            Procurando o rosto…
          </div>
        )}
      </div>

      {/* Lista de checagens */}
      <div
        role="status"
        aria-live="polite"
        style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
      >
        {checks.map((c) => {
          const color = COLOR_BY_STATUS[c.status];
          return (
            <div
              key={c.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                padding: '0.6rem 0.85rem',
                borderRadius: '0.75rem',
                background: c.status === 'ok' ? 'rgba(255,255,255,0.04)' : `${color}14`,
                border: `1px solid ${c.status === 'ok' ? 'rgba(255,255,255,0.08)' : `${color}55`}`,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: color, color: '#000',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 900, fontSize: '0.8rem', lineHeight: 1,
                }}
              >
                {ICON_BY_STATUS[c.status]}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: TEXT_PRIMARY }}>
                  {LABEL_BY_ID[c.id] ?? c.id}
                </div>
                <div style={{ fontSize: '0.85rem', color: TEXT_DIM, lineHeight: 1.45 }}>
                  {c.message}
                </div>
              </div>
            </div>
          );
        })}
        {checks.length === 0 && (
          <div style={{ fontSize: '0.9rem', color: TEXT_DIM, padding: '0.6rem 0.85rem' }}>
            Iniciando a câmera…
          </div>
        )}
      </div>

      {/* Item 6 — consentimento para ler configurações do sistema. Só aparece
          quando ainda não foi respondido E o IPC existe (build Electron). */}
      {settings.systemAccessGranted === null
        && typeof (window as unknown as { irisflowSystem?: unknown }).irisflowSystem !== 'undefined' && (
        <div style={{
          padding: '0.85rem 1rem', borderRadius: '0.75rem',
          background: `${ACCENT}18`, border: `1px solid ${ACCENT}66`,
          display: 'flex', flexDirection: 'column', gap: '0.6rem',
        }}>
          <div style={{ fontSize: '0.9rem', color: TEXT_PRIMARY, lineHeight: 1.5 }}>
            <strong>Permitir leitura das configurações de tela?</strong><br />
            O IrisFlow pode ler o tamanho físico do seu monitor direto do sistema.
            Isso evita digitar a medida à mão — e digitar errado faz o relatório de
            precisão mostrar um erro angular que não corresponde à realidade.
            Nenhum dado sai do computador.
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button
              type="button"
              onClick={() => updateSettings({ systemAccessGranted: true })}
              style={{
                background: ACCENT, color: '#fff', border: 'none',
                padding: '0.5rem 1.1rem', borderRadius: '1.5rem',
                fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Permitir
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ systemAccessGranted: false })}
              style={{
                background: 'transparent', color: TEXT_DIM,
                border: '1px solid rgba(255,255,255,0.20)',
                padding: '0.5rem 1.1rem', borderRadius: '1.5rem',
                fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Agora não
            </button>
          </div>
        </div>
      )}

      {/* Etapa 1 → o que o ajuste automático da câmera já fez, e o que ele não
          consegue resolver sozinho. Antes disto o resultado ficava só no
          console: o cuidador não tinha como saber que o zoom saturou. */}
      {tuning && (tuning.physicalAdvice || tuning.reasons.length > 0) && (
        <div style={{
          padding: '0.7rem 0.9rem', borderRadius: '0.75rem',
          background: tuning.atLimit ? `${WARNING}14` : 'rgba(255,255,255,0.04)',
          border: `1px solid ${tuning.atLimit ? `${WARNING}55` : 'rgba(255,255,255,0.08)'}`,
          fontSize: '0.85rem', lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, color: TEXT_PRIMARY, marginBottom: '0.2rem' }}>
            Ajuste automático da câmera
          </div>
          {tuning.physicalAdvice
            ? <div style={{ color: WARNING }}>{tuning.physicalAdvice}</div>
            : <div style={{ color: TEXT_DIM }}>
                {tuning.converged ? 'Câmera ajustada.' : 'Ajustando…'}
                {tuning.reasons.length > 0 && ` (${tuning.reasons[tuning.reasons.length - 1]})`}
              </div>}
        </div>
      )}

      {report && !report.canStart && !report.blockedHard && (
        <p style={{ fontSize: '0.85rem', color: WARNING, margin: 0, lineHeight: 1.5 }}>
          Dá para calibrar assim, mas a precisão vai ficar abaixo do que este
          equipamento consegue entregar. Corrigir os itens acima custa menos
          tempo que recalibrar depois.
        </p>
      )}
      {report?.blockedHard && (
        <p style={{ fontSize: '0.85rem', color: DANGER, margin: 0, lineHeight: 1.5 }}>
          Sem rosto detectado ou câmera inadequada — a calibração não tem como
          funcionar nesta condição.
        </p>
      )}
      <span style={{ fontSize: '0.75rem', color: ACCENT, opacity: 0.75 }}>
        Medições ao vivo da própria câmera, atualizadas 10×/s.
      </span>
    </div>
  );
};
