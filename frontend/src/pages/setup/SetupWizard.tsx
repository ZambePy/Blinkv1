import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useGaze } from '../../context/GazeContext';
import { evaluateReadiness, type ReadinessCheck } from '@tracker/setupReadiness';
import { snapshotFromDiagnostics, lerViewport } from '@tracker/setupReadinessAdapter';
import {
  listarCameras,
  medirFps,
  lerCapacidade,
  type CameraCapacidade,
  type CameraDevice,
} from '../../services/camera/devices';
import { gravarPreparo } from '../../services/local/setupProfile';
import { PASSOS, indiceDoPasso, proximoPasso, passoAnterior, type PassoId } from './passos';
import { acumular, estavel, inicial, msEstavel, type EstadoDeEstabilidade } from './estabilidade';
import { PermissaoCamera, type EstadoDaPermissao } from './steps/PermissaoCamera';
import { EscolhaDaCamera } from './steps/EscolhaDaCamera';
import { Posicionamento } from './steps/Posicionamento';
import { Iluminacao } from './steps/Iluminacao';
import { VerificacaoDoMonitor } from './steps/VerificacaoDoMonitor';

/**
 * Wizard de preparo do ambiente.
 *
 * **Uma rota só, passo no estado.** Os passos 2, 3 e 4 precisam da câmera viva;
 * cinco rotas separadas remontariam o componente e reiniciariam o stream a cada
 * transição — segundos de tela preta num fluxo cujo objetivo é justamente medir
 * estabilidade.
 *
 * O wizard é dono de três coisas: o passo atual, o stream de preview, e a
 * amostragem de prontidão. As telas de passo são puras sobre props, e é por
 * isso que dá para testá-las sem câmera.
 */

/** 2 Hz, como o `ReadinessPanel`: a 30 Hz os textos piscam e ninguém lê. */
const INTERVALO_DE_AMOSTRA_MS = 500;

const IDS_DE_POSICAO = ['face', 'distance', 'centering', 'headPose'];

export const SetupWizard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile } = useAuth();
  const { settings, updateSettings } = useSettings();
  const { getDiagnostics } = useGaze();

  const [passo, setPasso] = useState<PassoId>('permissao');

  // ── Permissão e stream ───────────────────────────────────────────────────
  const [permissao, setPermissao] = useState<EstadoDaPermissao>('explicando');
  const [erroDeCamera, setErroDeCamera] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // ── Câmeras ──────────────────────────────────────────────────────────────
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [cameraSelecionada, setCameraSelecionada] = useState<string | null>(null);
  const [capacidade, setCapacidade] = useState<CameraCapacidade | null>(null);
  const [medindo, setMedindo] = useState(false);

  // ── Prontidão ────────────────────────────────────────────────────────────
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [distanciaCm, setDistanciaCm] = useState<number | null>(null);
  const [estabilidade, setEstabilidade] = useState<EstadoDeEstabilidade>(inicial());
  const [agora, setAgora] = useState(() => performance.now());

  // ── Coletados nos passos ─────────────────────────────────────────────────
  const [lux, setLux] = useState('');
  const [diagonal, setDiagonal] = useState<number | null>(null);
  const [origemDaDiagonal, setOrigemDaDiagonal] = useState<'edid' | 'manual'>('edid');

  const abrirStream = useCallback(async (deviceId?: string) => {
    setPermissao('pedindo');
    setErroDeCamera(null);
    try {
      streamRef.current?.getTracks().forEach((tk) => tk.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setPermissao('concedida');

      // Os labels só aparecem depois da permissão concedida.
      const lista = await listarCameras();
      setCameras(lista);
      const ativo =
        stream.getVideoTracks()[0]?.getSettings().deviceId ?? lista[0]?.deviceId ?? null;
      setCameraSelecionada(deviceId ?? ativo);
    } catch (e) {
      setPermissao('negada');
      setErroDeCamera(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Fecha o stream ao sair. Sem isto a luz da webcam fica acesa depois do
  // preparo, e o usuário-alvo não tem como investigar por quê.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((tk) => tk.stop());
    },
    []
  );

  // Mede o que a câmera entrega quando o passo 2 abre com o vídeo tocando.
  useEffect(() => {
    if (passo !== 'camera' || !videoRef.current || permissao !== 'concedida') return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    let vivo = true;
    setMedindo(true);
    void medirFps(video).then((fps) => {
      if (!vivo) return;
      setCapacidade(lerCapacidade(video, fps));
      setMedindo(false);
    });
    return () => {
      vivo = false;
    };
  }, [passo, permissao, cameraSelecionada]);

  // Amostragem de prontidão. `getDiagnostics` numa ref, fora das deps: a
  // identidade dela é refeita a cada transição de estado do engine, e nas deps
  // cada transição destruiria e recriaria o intervalo — o mesmo defeito que o
  // `ReadinessPanel` documenta.
  const diagRef = useRef(getDiagnostics);
  diagRef.current = getDiagnostics;

  useEffect(() => {
    if (passo !== 'posicionamento' && passo !== 'iluminacao') return;
    const id = setInterval(() => {
      const t0 = performance.now();
      setAgora(t0);
      const d = diagRef.current();
      if (!d) return;
      const snap = snapshotFromDiagnostics(d, lerViewport());
      if (!snap) return;

      const relatorio = evaluateReadiness(snap, {});
      setChecks(relatorio.checks);

      const posicao = relatorio.checks.filter((c) => IDS_DE_POSICAO.includes(c.id));
      const verde = posicao.length > 0 && posicao.every((c) => c.status === 'ok');
      setEstabilidade((e) => acumular(e, verde, t0));
    }, INTERVALO_DE_AMOSTRA_MS);
    return () => clearInterval(id);
  }, [passo]);

  // Distância ao vivo, do core.
  useEffect(() => {
    if (passo !== 'posicionamento') return;
    let vivo = true;
    void import('@tracker/calibration').then((m) => {
      const id = setInterval(() => {
        if (vivo) setDistanciaCm(m.getCurrentCameraDistanceCm());
      }, INTERVALO_DE_AMOSTRA_MS);
      if (!vivo) clearInterval(id);
      return () => clearInterval(id);
    });
    return () => {
      vivo = false;
    };
  }, [passo]);

  const posicao = checks.filter((c) => IDS_DE_POSICAO.includes(c.id));
  const verde = posicao.length > 0 && posicao.every((c) => c.status === 'ok');

  /**
   * Só o posicionamento tem porta. Os outros passos informam: travar "Continuar"
   * por FPS baixo ou sala escura deixaria o paciente sem comunicação por uma
   * condição que talvez ele não consiga mudar.
   */
  const podeAvancar = passo !== 'posicionamento' || estavel(estabilidade, agora);

  const concluir = () => {
    if (currentProfile) {
      gravarPreparo(currentProfile.id, {
        cameraDeviceId: cameraSelecionada,
        fpsMedido: capacidade?.fpsMedido ?? null,
        luxAmbiente: lux.trim() === '' ? null : Number(lux.trim().replace(',', '.')) || null,
        monitorDiagonalIn: diagonal,
        monitorOrigem: origemDaDiagonal,
      });
    }
    if (diagonal !== null && diagonal !== settings.screenDiagonalIn) {
      // Grava a origem junto: o `SettingsContext` documenta que o
      // preenchimento automatico pelo EDID nunca pode sobrescrever um valor que
      // o cuidador digitou — se ele mediu com fita, aquele numero vale mais que
      // um EDID arredondado a centimetro inteiro.
      updateSettings({
        screenDiagonalIn: diagonal,
        screenGeometrySource: origemDaDiagonal === 'manual' ? 'manual' : 'auto',
      });
    }
    navigate('/calibration-check', { replace: true });
  };

  const avancar = () => {
    const p = proximoPasso(passo);
    if (p) setPasso(p);
    else concluir();
  };

  const anterior = passoAnterior(passo);

  return (
    <main
      role="main"
      aria-labelledby="setup-title"
      style={{
        minHeight: '100vh',
        background: 'var(--settings-bg)',
        display: 'flex',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <h1
            id="setup-title"
            style={{
              margin: 0,
              fontSize: '1.15rem',
              fontWeight: 800,
              opacity: 0.75,
              color: 'var(--color-text-base)',
            }}
          >
            {t('setup.title')}
          </h1>
          <Trilha atual={passo} />
        </div>

        <div
          className="glass-card"
          style={{
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-card-border)',
            borderRadius: '1.5rem',
            padding: '1.75rem',
          }}
        >
          {passo === 'permissao' && (
            <PermissaoCamera
              estado={permissao}
              erro={erroDeCamera}
              aoPedir={() => void abrirStream()}
            />
          )}
          {passo === 'camera' && (
            <EscolhaDaCamera
              cameras={cameras}
              selecionada={cameraSelecionada}
              capacidade={capacidade}
              medindo={medindo}
              aoSelecionar={(id) => {
                setCameraSelecionada(id);
                setCapacidade(null);
                void abrirStream(id);
              }}
              aoRecarregar={() => void abrirStream(cameraSelecionada ?? undefined)}
              videoRef={videoRef}
            />
          )}
          {passo === 'posicionamento' && (
            <Posicionamento
              checks={checks}
              distanciaCm={distanciaCm}
              msEstavel={msEstavel(estabilidade, agora)}
              verde={verde}
            />
          )}
          {passo === 'iluminacao' && <Iluminacao checks={checks} lux={lux} aoMudarLux={setLux} />}
          {passo === 'monitor' && (
            <VerificacaoDoMonitor
              // `'auto'` e o valor vindo do EDID via IPC. `'default'` significa
              // que ninguem informou nada — e ai o campo tem de aparecer VAZIO,
              // em vez de exibir o chute inicial como se fosse medicao.
              diagonalDoEdid={
                settings.screenGeometrySource === 'auto' ? settings.screenDiagonalIn : null
              }
              aoMudar={(d, o) => {
                setDiagonal(d);
                setOrigemDaDiagonal(o);
              }}
            />
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <PrimaryButton
            type="button"
            variant="ghost"
            disabled={anterior === null}
            onClick={() => anterior && setPasso(anterior)}
          >
            <ArrowLeft size={17} aria-hidden="true" /> {t('setup.back')}
          </PrimaryButton>

          <PrimaryButton type="button" disabled={!podeAvancar} onClick={avancar}>
            {proximoPasso(passo) === null ? (
              <>
                {t('setup.finish')} <Check size={17} aria-hidden="true" />
              </>
            ) : (
              <>
                {t('setup.next')} <ArrowRight size={17} aria-hidden="true" />
              </>
            )}
          </PrimaryButton>
        </div>
      </div>
    </main>
  );
};

const Trilha: React.FC<{ atual: PassoId }> = ({ atual }) => {
  const { t } = useTranslation();
  const i = indiceDoPasso(atual);
  return (
    <div
      style={{ display: 'flex', gap: '0.4rem' }}
      aria-label={t('setup.stepOf', { atual: i + 1, total: PASSOS.length })}
    >
      {PASSOS.map((p, n) => (
        <div key={p} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <div
            style={{
              height: 4,
              borderRadius: 999,
              background: n <= i ? 'var(--color-primary)' : 'var(--color-card-border)',
            }}
          />
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: n === i ? 800 : 600,
              opacity: n === i ? 1 : 0.55,
              color: 'var(--color-text-base)',
            }}
          >
            {t(`setup.steps.${p}`)}
          </span>
        </div>
      ))}
    </div>
  );
};
