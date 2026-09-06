import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Sparkles, Image as ImageIcon, Download, Check, RefreshCw, ArrowLeft, Clock } from 'lucide-react';
import { GazeButton } from '../../components/ui/GazeButton';

export interface CapturedPhoto {
  id: string;
  dataUrl: string;
  timestamp: number;
  filter: string;
}

const STORAGE_KEY = 'irisflow_captured_photos';

const FILTERS = [
  { id: 'none', name: 'Normal', css: 'none' },
  { id: 'vivid', name: 'Vívido', css: 'saturate(160%) contrast(110%)' },
  { id: 'bw', name: 'P&B', css: 'grayscale(100%) contrast(120%)' },
  { id: 'sepia', name: 'Retrô', css: 'sepia(80%) hue-rotate(-20deg) saturate(140%)' },
  { id: 'warm', name: 'Suave', css: 'sepia(30%) saturate(120%) brightness(105%)' },
];

export const PhotoCaptureScreen: React.FC = () => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [filterIndex, setFilterIndex] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<number>(3); // 3s padrão
  const [isFlashing, setIsFlashing] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);

  const currentFilter = FILTERS[filterIndex];

  // Carrega contagem de fotos salvas
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setPhotoCount(parsed.length);
        }
      }
    } catch {
      // Ignora erro de parse
    }
  }, []);

  // Inicializa a câmera
  useEffect(() => {
    let activeStream: MediaStream | null = null;
    let isMounted = true;

    async function initCamera() {
      try {
        setCameraError(null);
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: false,
        });

        if (!isMounted) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        activeStream = mediaStream;
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err: any) {
        console.warn('[PhotoCaptureScreen] Erro ao acessar webcam:', err);
        if (isMounted) {
          setCameraError(
            'Não foi possível conectar à câmera. Verifique as permissões de vídeo.'
          );
        }
      }
    }

    initCamera();

    return () => {
      isMounted = false;
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Efeitos Sonoros com Web Audio API
  const playSound = useCallback((type: 'tick' | 'shutter' | 'success') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      if (type === 'tick') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now); // Nota A5
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'shutter') {
        // Ruído de obturador clássico
        const bufferSize = ctx.sampleRate * 0.15;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        noise.connect(gain);
        gain.connect(ctx.destination);
        noise.start(now);
      } else if (type === 'success') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
      }
    } catch {
      // Ignora erro de áudio
    }
  }, []);

  // Executa o disparo da foto
  const captureFrame = useCallback(() => {
    setIsFlashing(true);
    playSound('shutter');

    setTimeout(() => {
      setIsFlashing(false);
    }, 250);

    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      // Cria imagem de demonstração caso câmera esteja em fallback
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, '#1b54a8');
        grad.addColorStop(0.5, '#3b82f6');
        grad.addColorStop(1, '#9333ea');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('📸 Foto IrisFlow Capturada!', 640, 360);
        ctx.font = '32px Inter, sans-serif';
        ctx.fillText(new Date().toLocaleTimeString(), 640, 420);
        setPreviewPhoto(canvas.toDataURL('image/jpeg', 0.92));
      }
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Inverte horizontalmente para o modo espelho
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);

      // Aplica o filtro CSS no canvas
      if (currentFilter.css !== 'none') {
        ctx.filter = currentFilter.css;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      setPreviewPhoto(dataUrl);
      setSavedSuccess(false);
    }
  }, [currentFilter, playSound]);

  // Inicia contagem regressiva
  const handleStartCapture = useCallback(() => {
    if (countdown !== null) return;

    if (timerSeconds === 0) {
      captureFrame();
      return;
    }

    setCountdown(timerSeconds);
    playSound('tick');

    let current = timerSeconds;
    const interval = setInterval(() => {
      current -= 1;
      if (current > 0) {
        setCountdown(current);
        playSound('tick');
      } else {
        clearInterval(interval);
        setCountdown(null);
        captureFrame();
      }
    }, 1000);
  }, [countdown, timerSeconds, playSound, captureFrame]);

  // Salvar foto no localStorage / Álbum
  const handleSavePhoto = useCallback(() => {
    if (!previewPhoto) return;

    try {
      const newPhoto: CapturedPhoto = {
        id: `photo_${Date.now()}`,
        dataUrl: previewPhoto,
        timestamp: Date.now(),
        filter: currentFilter.name,
      };

      const existing = localStorage.getItem(STORAGE_KEY);
      let list: CapturedPhoto[] = [];
      if (existing) {
        list = JSON.parse(existing);
      }
      list.unshift(newPhoto);
      // Mantém as 40 fotos mais recentes
      if (list.length > 40) list = list.slice(0, 40);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      setPhotoCount(list.length);
      setSavedSuccess(true);
      playSound('success');
    } catch (e) {
      console.error('Falha ao salvar foto no álbum:', e);
    }
  }, [previewPhoto, currentFilter, playSound]);

  // Baixar foto como JPG
  const handleDownloadPhoto = useCallback(() => {
    if (!previewPhoto) return;
    const a = document.createElement('a');
    a.href = previewPhoto;
    a.download = `irisflow_foto_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [previewPhoto]);

  // Alterna filtro
  const handleCycleFilter = useCallback(() => {
    setFilterIndex((prev) => (prev + 1) % FILTERS.length);
  }, []);

  // Alterna temporizador (0s -> 3s -> 5s)
  const handleCycleTimer = useCallback(() => {
    setTimerSeconds((prev) => (prev === 0 ? 3 : prev === 3 ? 5 : 0));
  }, []);

  return (
    <main
      role="main"
      aria-labelledby="camera-title"
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'var(--color-bg-base)',
        color: 'var(--color-text-base)',
        display: 'flex',
        flexDirection: 'column',
        padding: '1.75rem 2.5rem',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Flash Effect Overlay */}
      {isFlashing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#ffffff',
            zIndex: 99999,
            opacity: 0.95,
            pointerEvents: 'none',
            transition: 'opacity 0.2s ease-out',
          }}
        />
      )}

      {/* Cabeçalho */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <GazeButton
            onClick={() => navigate('/games')}
            width={200}
            height={68}
            style={{
              borderRadius: '1.5rem',
              boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
              border: '2px solid var(--color-card-border)',
              background: 'var(--color-card-bg)',
            }}
            aria-label="Voltar para Ajuda e Lazer"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.35rem', fontWeight: 800 }}>
              <ArrowLeft size={28} /> Voltar
            </div>
          </GazeButton>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '1rem',
                background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                boxShadow: '0 8px 20px rgba(14, 165, 233, 0.35)',
              }}
            >
              <Camera size={30} />
            </div>
            <div>
              <h1
                id="camera-title"
                style={{
                  fontSize: '2rem',
                  fontWeight: 800,
                  margin: 0,
                  color: 'var(--color-text-base)',
                  letterSpacing: '-0.02em',
                }}
              >
                Câmera & Fotos
              </h1>
              <span style={{ fontSize: '1.05rem', opacity: 0.75, fontWeight: 500 }}>
                Olhe para o botão para tirar uma foto divertida
              </span>
            </div>
          </div>
        </div>

        {/* Botão de Atalho para a Galeria */}
        <GazeButton
          onClick={() => navigate('/gallery')}
          width={240}
          height={68}
          style={{
            borderRadius: '1.5rem',
            background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.15), rgba(79, 70, 229, 0.15))',
            border: '2px solid rgba(147, 51, 234, 0.4)',
            boxShadow: '0 6px 20px rgba(147, 51, 234, 0.15)',
          }}
          aria-label={`Ver Galeria de Fotos (${photoCount} fotos salvas)`}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-base)' }}>
            <ImageIcon size={26} color="#9333ea" />
            <span>Galeria ({photoCount})</span>
          </div>
        </GazeButton>
      </header>

      {/* Conteúdo Principal (Layout em 2 Colunas: Câmera + Controles Grandes) */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr',
          gap: '2rem',
          minHeight: 0,
          width: '100%',
          alignItems: 'stretch',
        }}
      >
        {/* Área do Visor da Câmera (Viewfinder) */}
        <div
          style={{
            position: 'relative',
            borderRadius: '2.5rem',
            overflow: 'hidden',
            background: '#090d16',
            border: '4px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {cameraError ? (
            <div
              style={{
                textAlign: 'center',
                padding: '2.5rem',
                color: '#e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <Camera size={64} color="#f59e0b" />
              <h2 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>Modo Demonstração Ativo</h2>
              <p style={{ fontSize: '1.1rem', opacity: 0.8, maxWidth: '400px' }}>
                {cameraError} Você ainda pode tirar fotos no modo ilustrado!
              </p>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)', // Espelho
                filter: currentFilter.css,
                transition: 'filter 0.3s ease',
              }}
            />
          )}

          {/* Moldura de Foco / Guia Visual */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: '2rem',
              border: '2px dashed rgba(255, 255, 255, 0.4)',
              borderRadius: '2rem',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              padding: '1rem',
            }}
          >
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.65)',
                backdropFilter: 'blur(10px)',
                padding: '0.6rem 1.25rem',
                borderRadius: '1rem',
                color: '#ffffff',
                fontSize: '1.1rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                border: '1px solid rgba(255, 255, 255, 0.2)',
              }}
            >
              <Sparkles size={20} color="#38bdf8" />
              Filtro: {currentFilter.name}
            </div>

            {timerSeconds > 0 && (
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.65)',
                  backdropFilter: 'blur(10px)',
                  padding: '0.6rem 1.25rem',
                  borderRadius: '1rem',
                  color: '#ffffff',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                }}
              >
                <Clock size={20} color="#fbbf24" />
                {timerSeconds}s de contagem
              </div>
            )}
          </div>

          {/* Contagem Regressiva Visual Gigante */}
          {countdown !== null && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(2, 6, 23, 0.65)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
              }}
            >
              <span
                style={{
                  fontSize: '8rem',
                  fontWeight: 900,
                  color: '#ffffff',
                  textShadow: '0 0 40px rgba(56, 189, 248, 0.8)',
                  animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both',
                }}
              >
                {countdown}
              </span>
              <span style={{ fontSize: '2rem', fontWeight: 700, color: '#38bdf8', marginTop: '1rem' }}>
                Sorria para a câmera! 😊
              </span>
            </div>
          )}
        </div>

        {/* Coluna de Botões de Ação Ampliados */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            height: '100%',
            justifyContent: 'space-between',
          }}
        >
          {/* Botão Gigante de Disparo (Tirar Foto) */}
          <GazeButton
            onClick={handleStartCapture}
            disabled={countdown !== null}
            style={{
              flex: 2,
              minHeight: '160px',
              borderRadius: '2.5rem',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #4338ca 100%)',
              color: '#ffffff',
              boxShadow: '0 16px 36px -6px rgba(37, 99, 235, 0.45)',
              border: '3px solid rgba(255, 255, 255, 0.4)',
              cursor: 'pointer',
            }}
            aria-label="Tirar Foto agora com temporizador"
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.75rem',
                padding: '1rem',
              }}
            >
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 24px rgba(255, 255, 255, 0.4)',
                }}
              >
                <Camera size={48} color="#ffffff" />
              </div>
              <span style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
                📸 TIRAR FOTO
              </span>
              <span style={{ fontSize: '1.15rem', opacity: 0.9, fontWeight: 600 }}>
                {timerSeconds > 0 ? `Contagem de ${timerSeconds}s` : 'Disparo imediato'}
              </span>
            </div>
          </GazeButton>

          {/* Grid de Configurações da Câmera (Filtros e Temporizador) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1.25rem',
              flex: 1,
            }}
          >
            {/* Botão de Filtro */}
            <GazeButton
              onClick={handleCycleFilter}
              style={{
                height: '100%',
                minHeight: '120px',
                borderRadius: '2rem',
                background: 'var(--color-card-bg)',
                border: '2px solid var(--color-card-border)',
                boxShadow: '0 8px 24px var(--color-card-shadow)',
              }}
              aria-label={`Mudar Filtro de Cor (atual: ${currentFilter.name})`}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem',
                }}
              >
                <Sparkles size={36} color="#8b5cf6" />
                <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-text-base)' }}>
                  Filtro
                </span>
                <span style={{ fontSize: '1rem', opacity: 0.75, fontWeight: 600, color: 'var(--color-text-base)' }}>
                  {currentFilter.name}
                </span>
              </div>
            </GazeButton>

            {/* Botão de Temporizador */}
            <GazeButton
              onClick={handleCycleTimer}
              style={{
                height: '100%',
                minHeight: '120px',
                borderRadius: '2rem',
                background: 'var(--color-card-bg)',
                border: '2px solid var(--color-card-border)',
                boxShadow: '0 8px 24px var(--color-card-shadow)',
              }}
              aria-label={`Ajustar Temporizador (atual: ${timerSeconds === 0 ? 'Direto' : timerSeconds + 's'})`}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem',
                }}
              >
                <Clock size={36} color="#f59e0b" />
                <span style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-text-base)' }}>
                  Tempo
                </span>
                <span style={{ fontSize: '1rem', opacity: 0.75, fontWeight: 600, color: 'var(--color-text-base)' }}>
                  {timerSeconds === 0 ? 'Sem atraso' : `${timerSeconds} segundos`}
                </span>
              </div>
            </GazeButton>
          </div>
        </div>
      </div>

      {/* Modal / Overlay de Visualização da Foto Capturada */}
      {previewPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.88)',
            backdropFilter: 'blur(16px)',
            zIndex: 99990,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2.5rem',
            animation: 'fadeIn 0.3s ease-out both',
          }}
        >
          <div
            style={{
              background: 'var(--color-card-bg)',
              border: '3px solid var(--color-card-border)',
              borderRadius: '2.5rem',
              padding: '2rem 2.5rem',
              maxWidth: '1100px',
              width: '95%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.5rem',
              boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <h2
                id="preview-title"
                style={{ fontSize: '2.2rem', fontWeight: 900, margin: 0, color: 'var(--color-text-base)' }}
              >
                🎉 Sua Foto Ficou Ótima!
              </h2>
              <p style={{ fontSize: '1.15rem', opacity: 0.75, margin: '0.25rem 0 0 0', fontWeight: 600 }}>
                Escolha o que deseja fazer com sua foto
              </p>
            </div>

            {/* Imagem Capturada */}
            <div
              style={{
                width: '100%',
                maxHeight: '460px',
                borderRadius: '1.75rem',
                overflow: 'hidden',
                border: '3px solid var(--color-card-border)',
                boxShadow: '0 12px 30px rgba(0,0,0,0.2)',
                background: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={previewPhoto}
                alt="Foto capturada pelo usuário"
                style={{
                  maxWidth: '100%',
                  maxHeight: '460px',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>

            {/* Botões de Ação Ampliados */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '1.5rem',
                width: '100%',
              }}
            >
              {/* Salvar Foto */}
              <GazeButton
                onClick={handleSavePhoto}
                disabled={savedSuccess}
                style={{
                  height: '84px',
                  borderRadius: '1.75rem',
                  background: savedSuccess
                    ? 'linear-gradient(135deg, #16a34a, #15803d)'
                    : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                  color: '#ffffff',
                  border: '2px solid rgba(255,255,255,0.3)',
                  boxShadow: '0 8px 24px rgba(37,99,235,0.3)',
                }}
                aria-label="Salvar foto no álbum"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.35rem', fontWeight: 800 }}>
                  {savedSuccess ? <Check size={32} /> : <ImageIcon size={32} />}
                  <span>{savedSuccess ? 'Foto Salva! ✓' : 'Salvar no Álbum'}</span>
                </div>
              </GazeButton>

              {/* Baixar Arquivo */}
              <GazeButton
                onClick={handleDownloadPhoto}
                style={{
                  height: '84px',
                  borderRadius: '1.75rem',
                  background: 'linear-gradient(135deg, #059669, #047857)',
                  color: '#ffffff',
                  border: '2px solid rgba(255,255,255,0.3)',
                  boxShadow: '0 8px 24px rgba(5,150,105,0.3)',
                }}
                aria-label="Baixar foto para o computador"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.35rem', fontWeight: 800 }}>
                  <Download size={32} />
                  <span>Baixar Arquivo</span>
                </div>
              </GazeButton>

              {/* Tirar Outra Foto */}
              <GazeButton
                onClick={() => {
                  setPreviewPhoto(null);
                  setSavedSuccess(false);
                }}
                style={{
                  height: '84px',
                  borderRadius: '1.75rem',
                  background: 'var(--color-card-bg)',
                  border: '2px solid var(--color-card-border)',
                  color: 'var(--color-text-base)',
                  boxShadow: '0 8px 24px var(--color-card-shadow)',
                }}
                aria-label="Descartar e tirar outra foto"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.35rem', fontWeight: 800 }}>
                  <RefreshCw size={30} />
                  <span>Tirar Outra</span>
                </div>
              </GazeButton>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
