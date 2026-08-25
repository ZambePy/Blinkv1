import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Image as ImageIcon, Camera, ArrowLeft, Download, Trash2, X, ZoomIn } from 'lucide-react';
import { GazeButton } from '../../components/ui/GazeButton';

interface PhotoItem {
  id: string;
  url: string;
  alt: string;
  timestamp?: number;
  isUserPhoto?: boolean;
}

const STORAGE_KEY = 'irisflow_captured_photos';

const DEFAULT_PHOTOS: PhotoItem[] = [
  {
    id: 'def_1',
    url: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=800&q=80',
    alt: 'Foto de família reunida',
  },
  {
    id: 'def_2',
    url: 'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=800&q=80',
    alt: 'Paisagem natural com árvores',
  },
  {
    id: 'def_3',
    url: 'https://images.unsplash.com/photo-1516156008625-3a9d045f6b28?w=800&q=80',
    alt: 'Vista de montanhas ao pôr do sol',
  },
  {
    id: 'def_4',
    url: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=800&q=80',
    alt: 'Cachorrinho feliz no jardim',
  },
];

export const GalleryScreen: React.FC = () => {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<PhotoItem[]>(DEFAULT_PHOTOS);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);

  // Carrega fotos salvas pelo usuário
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const userItems: PhotoItem[] = parsed.map((item: any) => ({
            id: item.id || `photo_${item.timestamp}`,
            url: item.dataUrl,
            alt: `Foto tirada em ${new Date(item.timestamp || Date.now()).toLocaleDateString()}`,
            timestamp: item.timestamp,
            isUserPhoto: true,
          }));
          setPhotos([...userItems, ...DEFAULT_PHOTOS]);
          return;
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar fotos locais:', e);
    }
    setPhotos(DEFAULT_PHOTOS);
  }, []);

  const handleDeletePhoto = (photoId: string) => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const filtered = parsed.filter((p: any) => p.id !== photoId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      }
    } catch (e) {
      console.warn('Erro ao excluir foto:', e);
    }
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setSelectedPhoto(null);
  };

  const handleDownloadPhoto = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <main
      role="main"
      aria-labelledby="gallery-title"
      style={{
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: 'var(--color-bg-base)',
        color: 'var(--color-text-base)',
        display: 'flex',
        flexDirection: 'column',
        padding: '2rem 3rem',
        boxSizing: 'border-box',
        position: 'relative',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Barra Superior com Botões Ampliados */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2rem',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <GazeButton
            onClick={() => navigate('/games')}
            width={200}
            height={68}
            style={{
              borderRadius: '1.5rem',
              border: '2px solid var(--color-card-border)',
              background: 'var(--color-card-bg)',
              boxShadow: '0 6px 20px rgba(0,0,0,0.06)',
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
                background: 'linear-gradient(135deg, #9333ea, #6366f1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                boxShadow: '0 8px 20px rgba(147, 51, 234, 0.35)',
              }}
            >
              <ImageIcon size={30} />
            </div>
            <div>
              <h1
                id="gallery-title"
                style={{
                  fontSize: '2rem',
                  fontWeight: 800,
                  margin: 0,
                  color: 'var(--color-text-base)',
                  letterSpacing: '-0.02em',
                }}
              >
                Galeria de Fotos
              </h1>
              <span style={{ fontSize: '1.05rem', opacity: 0.75, fontWeight: 500 }}>
                {photos.length} fotos disponíveis para visualização
              </span>
            </div>
          </div>
        </div>

        {/* Botão Ampliado de Tirar Nova Foto */}
        <GazeButton
          onClick={() => navigate('/photo')}
          width={260}
          height={68}
          style={{
            borderRadius: '1.5rem',
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            color: '#ffffff',
            border: '2px solid rgba(255,255,255,0.3)',
            boxShadow: '0 8px 24px rgba(37,99,235,0.35)',
          }}
          aria-label="Ir para a tela de Tirar Nova Foto"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.3rem', fontWeight: 800 }}>
            <Camera size={28} />
            <span>Tirar Nova Foto</span>
          </div>
        </GazeButton>
      </header>

      {/* Grid de Fotos com Cards Ampliados */}
      <div
        role="list"
        aria-label="Fotos disponíveis"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '2rem',
          width: '100%',
        }}
      >
        {photos.map((photo) => (
          <div
            key={photo.id}
            role="listitem"
            style={{
              borderRadius: '2rem',
              overflow: 'hidden',
              background: 'var(--color-card-bg)',
              border: '2px solid var(--color-card-border)',
              boxShadow: '0 12px 30px var(--color-card-shadow)',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              transition: 'transform 0.25s ease, box-shadow 0.25s ease',
            }}
          >
            {photo.isUserPhoto && (
              <div
                style={{
                  position: 'absolute',
                  top: '1rem',
                  left: '1rem',
                  background: 'rgba(37, 99, 235, 0.9)',
                  backdropFilter: 'blur(8px)',
                  color: '#ffffff',
                  padding: '0.4rem 0.9rem',
                  borderRadius: '999px',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  zIndex: 2,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                }}
              >
                📸 Minha Foto
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedPhoto(photo)}
              aria-label={`Ampliar foto: ${photo.alt}`}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                width: '100%',
                height: '240px',
                position: 'relative',
                display: 'block',
              }}
            >
              <img
                src={photo.url}
                alt={photo.alt}
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.25)',
                  opacity: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  gap: '0.5rem',
                  transition: 'opacity 0.2s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
              >
                <ZoomIn size={32} /> Ampliar
              </div>
            </button>

            {/* Rodapé do Card com Botão de Ação */}
            <div
              style={{
                padding: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--color-card-border)',
              }}
            >
              <span
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: 'var(--color-text-base)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '180px',
                }}
              >
                {photo.alt}
              </span>

              <GazeButton
                onClick={() => setSelectedPhoto(photo)}
                width={130}
                height={50}
                style={{
                  borderRadius: '1rem',
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  background: 'var(--color-card-bg)',
                  border: '2px solid var(--color-primary)',
                  color: 'var(--color-primary)',
                }}
                aria-label={`Visualizar detalhes de ${photo.alt}`}
              >
                Ver Foto
              </GazeButton>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de Visualização em Tela Cheia */}
      {selectedPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-photo-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.92)',
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
              boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <h2
                id="modal-photo-title"
                style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, color: 'var(--color-text-base)' }}
              >
                {selectedPhoto.alt}
              </h2>

              <GazeButton
                onClick={() => setSelectedPhoto(null)}
                width={120}
                height={54}
                style={{
                  borderRadius: '1.25rem',
                  border: '2px solid var(--color-card-border)',
                  background: 'var(--color-card-bg)',
                }}
                aria-label="Fechar visualização"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem', fontWeight: 800 }}>
                  <X size={24} /> Fechar
                </div>
              </GazeButton>
            </div>

            <div
              style={{
                width: '100%',
                maxHeight: '520px',
                borderRadius: '1.75rem',
                overflow: 'hidden',
                background: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 12px 32px rgba(0,0,0,0.3)',
              }}
            >
              <img
                src={selectedPhoto.url}
                alt={selectedPhoto.alt}
                style={{
                  maxWidth: '100%',
                  maxHeight: '520px',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>

            {/* Controles do Modal */}
            <div style={{ display: 'flex', gap: '1.5rem', width: '100%', justifyContent: 'center' }}>
              <GazeButton
                onClick={() =>
                  handleDownloadPhoto(
                    selectedPhoto.url,
                    `foto_${selectedPhoto.id || 'download'}`
                  )
                }
                width={260}
                height={72}
                style={{
                  borderRadius: '1.5rem',
                  background: 'linear-gradient(135deg, #059669, #047857)',
                  color: '#ffffff',
                  border: '2px solid rgba(255,255,255,0.3)',
                  boxShadow: '0 8px 24px rgba(5,150,105,0.3)',
                }}
                aria-label="Baixar foto atual"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.25rem', fontWeight: 800 }}>
                  <Download size={28} />
                  <span>Baixar Foto</span>
                </div>
              </GazeButton>

              {selectedPhoto.isUserPhoto && (
                <GazeButton
                  onClick={() => handleDeletePhoto(selectedPhoto.id)}
                  width={240}
                  height={72}
                  style={{
                    borderRadius: '1.5rem',
                    background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    color: '#ffffff',
                    border: '2px solid rgba(255,255,255,0.3)',
                    boxShadow: '0 8px 24px rgba(220,38,38,0.3)',
                  }}
                  aria-label="Excluir foto do álbum"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.25rem', fontWeight: 800 }}>
                    <Trash2 size={26} />
                    <span>Excluir Foto</span>
                  </div>
                </GazeButton>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
