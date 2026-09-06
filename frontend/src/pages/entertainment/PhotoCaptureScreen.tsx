import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Sparkles, Images, Download, Check, RotateCcw, Timer } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';
import { useGaze } from '../../context/GazeContext';
import { getSharedAudioContext, playTone } from '../../utils/emergencyAudio';

export interface CapturedPhoto {
  id: string;
  dataUrl: string;
  timestamp: number;
  filter: string;
}

const STORAGE_KEY = 'irisflow_captured_photos';
const MAX_FOTOS = 40;

const FILTERS = [
  { id: 'none', name: 'Normal', css: 'none' },
  { id: 'vivid', name: 'Vívido', css: 'saturate(160%) contrast(110%)' },
  { id: 'bw', name: 'P&B', css: 'grayscale(100%) contrast(120%)' },
  { id: 'sepia', name: 'Retrô', css: 'sepia(80%) hue-rotate(-20deg) saturate(140%)' },
  { id: 'warm', name: 'Suave', css: 'sepia(30%) saturate(120%) brightness(105%)' },
];

/** Temporizador: sem atraso, 3 s ou 5 s. */
const TEMPOS = [0, 3, 5] as const;

/** Quanto tempo esperar pela câmera do rastreador antes de cair no modo demonstração. */
const ESPERA_CAMERA_MS = 12000;
const INTERVALO_CAMERA_MS = 400;

function lerToken(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || 'currentColor';
}

/**
 * Sons da câmera. Usam o AudioContext compartilhado do app (um só por sessão)
 * em vez de criar um novo a cada bipe, que era o que esgotava o limite do
 * navegador depois de algumas fotos.
 */
function tocar(tipo: 'tick' | 'shutter' | 'success'): void {
  if (tipo === 'tick') {
    playTone(880, 0, 0.08, 0.3);
    return;
  }
  if (tipo === 'success') {
    playTone(523.25, 0, 0.12, 0.25);
    playTone(659.25, 0.1, 0.12, 0.25);
    playTone(783.99, 0.2, 0.2, 0.25);
    return;
  }
  // Obturador: ruído curto.
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const tamanho = Math.floor(ctx.sampleRate * 0.15);
    const buffer = ctx.createBuffer(1, tamanho, ctx.sampleRate);
    const dados = buffer.getChannelData(0);
    for (let i = 0; i < tamanho; i++) dados[i] = Math.random() * 2 - 1;
    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    const ganho = ctx.createGain();
    const agora = ctx.currentTime;
    ganho.gain.setValueAtTime(0.5, agora);
    ganho.gain.exponentialRampToValueAtTime(0.01, agora + 0.15);
    fonte.connect(ganho);
    ganho.connect(ctx.destination);
    fonte.start(agora);
    fonte.onended = () => {
      try {
        fonte.disconnect();
        ganho.disconnect();
      } catch {
        /* já desconectado */
      }
    };
  } catch {
    /* som é acessório */
  }
}

function lerAlbum(): CapturedPhoto[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as CapturedPhoto[]) : [];
  } catch {
    return [];
  }
}

export const PhotoCaptureScreen: React.FC = () => {
  const navigate = useNavigate();
  const { getCameraStream } = useGaze();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cameraPronta, setCameraPronta] = useState(false);
  const [semCamera, setSemCamera] = useState(false);
  const [filterIndex, setFilterIndex] = useState(0);
  const [tempoIndex, setTempoIndex] = useState(1);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [photoCount, setPhotoCount] = useState(() => lerAlbum().length);

  const currentFilter = FILTERS[filterIndex];
  const timerSeconds = TEMPOS[tempoIndex];

  // A câmera é a mesma do rastreador: o engine é o único dono do getUserMedia.
  // Aqui só apontamos um segundo <video> para o mesmo stream. Se o engine ainda
  // está subindo, esperamos um pouco; se não houver câmera, modo demonstração.
  useEffect(() => {
    let cancelado = false;
    let tentativas = 0;
    const maxTentativas = Math.ceil(ESPERA_CAMERA_MS / INTERVALO_CAMERA_MS);
    const video = videoRef.current;

    const tentar = (): boolean => {
      const stream = getCameraStream();
      if (!stream || !video) return false;
      if (video.srcObject !== stream) video.srcObject = stream;
      void video.play().catch(() => {
        /* autoplay bloqueado: o frame ainda aparece quando o usuário interagir */
      });
      setCameraPronta(true);
      return true;
    };

    if (tentar()) return;
    const id = setInterval(() => {
      if (cancelado) return;
      tentativas += 1;
      if (tentar() || tentativas >= maxTentativas) {
        clearInterval(id);
        if (tentativas >= maxTentativas) setSemCamera(true);
      }
    }, INTERVALO_CAMERA_MS);

    return () => {
      cancelado = true;
      clearInterval(id);
      // Solta a referência sem parar as tracks: o stream é do rastreador.
      if (video) video.srcObject = null;
    };
  }, [getCameraStream]);

  // Timers pendentes morrem com a tela.
  useEffect(
    () => () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (flashRef.current) clearTimeout(flashRef.current);
    },
    []
  );

  const captureFrame = useCallback(() => {
    setIsFlashing(true);
    tocar('shutter');
    if (flashRef.current) clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setIsFlashing(false), 250);

    const video = videoRef.current;
    const canvas = document.createElement('canvas');

    if (!video || !video.videoWidth || !video.videoHeight) {
      // Sem imagem da câmera: gera uma foto ilustrativa para o fluxo continuar.
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const grad = ctx.createLinearGradient(0, 0, 1280, 720);
      grad.addColorStop(0, lerToken('--primary'));
      grad.addColorStop(1, lerToken('--accent'));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = lerToken('--on-primary');
      ctx.textAlign = 'center';
      ctx.font = 'bold 48px system-ui, sans-serif';
      ctx.fillText('Foto de demonstração', 640, 350);
      ctx.font = '32px system-ui, sans-serif';
      ctx.fillText(new Date().toLocaleString(), 640, 410);
      setPreviewPhoto(canvas.toDataURL('image/jpeg', 0.92));
      setSavedSuccess(false);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Espelha, como no visor.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    if (currentFilter.css !== 'none') ctx.filter = currentFilter.css;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPreviewPhoto(canvas.toDataURL('image/jpeg', 0.92));
    setSavedSuccess(false);
  }, [currentFilter]);

  const handleStartCapture = useCallback(() => {
    if (countdown !== null) return;
    if (timerSeconds === 0) {
      captureFrame();
      return;
    }
    let atual: number = timerSeconds;
    setCountdown(atual);
    tocar('tick');
    countdownRef.current = setInterval(() => {
      atual -= 1;
      if (atual > 0) {
        setCountdown(atual);
        tocar('tick');
        return;
      }
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdown(null);
      captureFrame();
    }, 1000);
  }, [countdown, timerSeconds, captureFrame]);

  const handleSavePhoto = useCallback(() => {
    if (!previewPhoto) return;
    try {
      const nova: CapturedPhoto = {
        id: `photo_${Date.now()}`,
        dataUrl: previewPhoto,
        timestamp: Date.now(),
        filter: currentFilter.name,
      };
      const lista = [nova, ...lerAlbum()].slice(0, MAX_FOTOS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
      setPhotoCount(lista.length);
      setSavedSuccess(true);
      tocar('success');
    } catch (e) {
      console.error('Falha ao salvar foto no álbum:', e);
    }
  }, [previewPhoto, currentFilter]);

  const handleDownloadPhoto = useCallback(() => {
    if (!previewPhoto) return;
    const a = document.createElement('a');
    a.href = previewPhoto;
    a.download = `irisflow_foto_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [previewPhoto]);

  const handleCycleFilter = useCallback(() => {
    setFilterIndex((prev) => (prev + 1) % FILTERS.length);
  }, []);

  const handleCycleTimer = useCallback(() => {
    setTempoIndex((prev) => (prev + 1) % TEMPOS.length);
  }, []);

  const rotuloTempo = timerSeconds === 0 ? 'Sem atraso' : `${timerSeconds} segundos`;

  return (
    <GazePageLayout backRoute="/games" title="Câmera e Fotos">
      <h1 className="sr-only">Câmera</h1>

      {isFlashing && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--surface)',
            opacity: 0.95,
            zIndex: 99999,
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 24,
          height: '100%',
          minHeight: 0,
        }}
      >
        {/* Visor. Não é alvo. */}
        <div
          data-no-dwell="true"
          style={{
            position: 'relative',
            minHeight: 0,
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
            background: 'var(--text)',
            border: '2px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="Imagem da câmera"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
              filter: currentFilter.css,
              display: cameraPronta ? 'block' : 'none',
            }}
          />

          {!cameraPronta && (
            <div
              role="status"
              style={{
                textAlign: 'center',
                padding: '2rem',
                color: 'var(--bg)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <Camera size={64} aria-hidden="true" />
              <p style={{ fontSize: 'var(--fs-24)', fontWeight: 700 }}>
                {semCamera ? 'Câmera indisponível' : 'Ligando a câmera...'}
              </p>
              {semCamera && (
                <p style={{ fontSize: 'var(--fs-18)', opacity: 0.85, maxWidth: 420 }}>
                  Você ainda pode tirar uma foto de demonstração.
                </p>
              )}
            </div>
          )}

          {/* Estado atual, no canto do visor */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '1rem',
              left: '1rem',
              display: 'flex',
              gap: '0.6rem',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1rem',
                borderRadius: 'var(--r-pill)',
                background: 'color-mix(in srgb, var(--text) 70%, transparent)',
                color: 'var(--bg)',
                fontSize: 'var(--fs-16)',
                fontWeight: 700,
              }}
            >
              <Sparkles size={18} /> {`Filtro: ${currentFilter.name}`}
            </span>
            {timerSeconds > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 1rem',
                  borderRadius: 'var(--r-pill)',
                  background: 'color-mix(in srgb, var(--text) 70%, transparent)',
                  color: 'var(--bg)',
                  fontSize: 'var(--fs-16)',
                  fontWeight: 700,
                }}
              >
                <Timer size={18} /> {`${timerSeconds} s de espera`}
              </span>
            )}
          </div>

          {countdown !== null && (
            <div
              role="status"
              aria-live="assertive"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                background: 'color-mix(in srgb, var(--text) 55%, transparent)',
                color: 'var(--bg)',
              }}
            >
              <span style={{ fontSize: '8rem', fontWeight: 900, lineHeight: 1 }}>{countdown}</span>
              <span style={{ fontSize: 'var(--fs-32)', fontWeight: 700 }}>Sorria</span>
            </div>
          )}
        </div>

        {/* Controles: um alvo por ação */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: 'minmax(160px, 1.3fr) minmax(120px, 1fr) minmax(120px, 1fr)',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 24,
            minHeight: 0,
            '--gaze-grid-gap': '24px',
          } as React.CSSProperties}
        >
          <GazeButton
            onClick={handleStartCapture}
            disabled={countdown !== null}
            size="xl"
            stacked
            variant="primary"
            icon={<Camera />}
            label="Tirar foto"
            aria-label={timerSeconds > 0 ? `Tirar foto com ${timerSeconds} segundos de espera` : 'Tirar foto agora'}
            style={{ width: '100%', height: '100%', gridColumn: '1 / -1' }}
          />

          <GazeButton
            onClick={handleCycleFilter}
            size="lg"
            stacked
            icon={<Sparkles color="var(--primary)" />}
            aria-label={`Mudar filtro (atual: ${currentFilter.name})`}
            style={{ width: '100%', height: '100%' }}
          >
            <span className="gaze-button__label">Filtro</span>
            <span style={{ fontSize: 'var(--fs-18)', color: 'var(--text-2)' }}>{currentFilter.name}</span>
          </GazeButton>

          <GazeButton
            onClick={handleCycleTimer}
            size="lg"
            stacked
            icon={<Timer color="var(--primary)" />}
            aria-label={`Mudar tempo de espera (atual: ${rotuloTempo})`}
            style={{ width: '100%', height: '100%' }}
          >
            <span className="gaze-button__label">Tempo</span>
            <span style={{ fontSize: 'var(--fs-18)', color: 'var(--text-2)' }}>{rotuloTempo}</span>
          </GazeButton>

          <GazeButton
            onClick={() => navigate('/gallery')}
            size="lg"
            icon={<Images color="var(--primary)" />}
            label={`Galeria (${photoCount})`}
            aria-label={`Abrir galeria com ${photoCount} fotos salvas`}
            style={{ width: '100%', height: '100%', gridColumn: '1 / -1' }}
          />
        </div>
      </div>

      {previewPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
          className="gaze-modal"
        >
          <div
            className="gaze-modal__card"
            style={{ width: 'min(1100px, 94vw)', maxHeight: '94vh', gap: '1.25rem', padding: '1.75rem' }}
          >
            <h2 id="preview-title" className="gaze-modal__title">
              {savedSuccess ? 'Foto salva no álbum' : 'Sua foto'}
            </h2>

            <div
              data-no-dwell="true"
              style={{
                width: '100%',
                flex: '1 1 auto',
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--r-md)',
                overflow: 'hidden',
                background: 'var(--text)',
              }}
            >
              <img
                src={previewPhoto}
                alt="Foto que acabou de ser tirada"
                style={{ maxWidth: '100%', maxHeight: '48vh', objectFit: 'contain', display: 'block' }}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 24,
                width: '100%',
                '--gaze-grid-gap': '24px',
              } as React.CSSProperties}
            >
              <GazeButton
                onClick={handleSavePhoto}
                disabled={savedSuccess}
                size="lg"
                variant="primary"
                icon={savedSuccess ? <Check /> : <Images />}
                label={savedSuccess ? 'Salva' : 'Salvar no álbum'}
                aria-label="Salvar foto no álbum"
                style={{ width: '100%' }}
              />
              <GazeButton
                onClick={handleDownloadPhoto}
                size="lg"
                icon={<Download color="var(--primary)" />}
                label="Baixar"
                aria-label="Baixar a foto para o computador"
                style={{ width: '100%' }}
              />
              <GazeButton
                onClick={() => {
                  setPreviewPhoto(null);
                  setSavedSuccess(false);
                }}
                size="lg"
                icon={<RotateCcw color="var(--primary)" />}
                label="Tirar outra"
                aria-label="Fechar e tirar outra foto"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </div>
      )}
    </GazePageLayout>
  );
};
