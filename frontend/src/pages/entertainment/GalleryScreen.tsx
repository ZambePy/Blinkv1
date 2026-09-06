import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Download, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeGrid } from '../../components/ui/GazeGrid';
import { GazeButton } from '../../components/ui/GazeButton';

interface PhotoItem {
  id: string;
  url: string;
  alt: string;
  timestamp?: number;
  isUserPhoto?: boolean;
}

const STORAGE_KEY = 'irisflow_captured_photos';

/** Fotos de exemplo para a galeria não nascer vazia. */
const DEFAULT_PHOTOS: PhotoItem[] = [
  {
    id: 'def_1',
    url: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=800&q=80',
    alt: 'Família reunida',
  },
  {
    id: 'def_2',
    url: 'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=800&q=80',
    alt: 'Paisagem com árvores',
  },
  {
    id: 'def_3',
    url: 'https://images.unsplash.com/photo-1516156008625-3a9d045f6b28?w=800&q=80',
    alt: 'Montanhas ao pôr do sol',
  },
  {
    id: 'def_4',
    url: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=800&q=80',
    alt: 'Cachorro no jardim',
  },
];

/** Seis fotos por página: a grade 3×2 do paciente. */
const POR_PAGINA = 6;

function carregarFotos(): PhotoItem[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    if (Array.isArray(parsed) && parsed.length > 0) {
      const minhas: PhotoItem[] = parsed
        .filter((item): item is { id?: string; dataUrl: string; timestamp?: number } =>
          typeof item === 'object' && item !== null && typeof (item as { dataUrl?: unknown }).dataUrl === 'string'
        )
        .map((item) => ({
          id: item.id || `photo_${item.timestamp ?? Date.now()}`,
          url: item.dataUrl,
          alt: `Minha foto de ${new Date(item.timestamp ?? Date.now()).toLocaleDateString('pt-BR')}`,
          timestamp: item.timestamp,
          isUserPhoto: true,
        }));
      return [...minhas, ...DEFAULT_PHOTOS];
    }
  } catch (e) {
    console.warn('Erro ao carregar fotos locais:', e);
  }
  return DEFAULT_PHOTOS;
}

export const GalleryScreen: React.FC = () => {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<PhotoItem[]>(() => carregarFotos());
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);
  const [pagina, setPagina] = useState(0);

  const totalPaginas = Math.max(1, Math.ceil(photos.length / POR_PAGINA));
  useEffect(() => {
    if (pagina > totalPaginas - 1) setPagina(totalPaginas - 1);
  }, [pagina, totalPaginas]);

  const handleDeletePhoto = (photoId: string) => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((p: { id?: string }) => p.id !== photoId);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        }
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

  const visiveis = photos.slice(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA);

  return (
    <GazePageLayout backRoute="/games" title={`Galeria · ${pagina + 1} de ${totalPaginas}`}>
      <h1 className="sr-only">Galeria de fotos</h1>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 24, minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <GazeGrid columns={3} rows={2} gap={24}>
            {visiveis.map((photo) => (
              <GazeButton
                key={photo.id}
                onClick={() => setSelectedPhoto(photo)}
                aria-label={`Ampliar foto: ${photo.alt}`}
                noWarn
                style={{ width: '100%', height: '100%', padding: 0, overflow: 'hidden' }}
              >
                <img
                  src={photo.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: '0.6rem 1rem',
                    background: 'color-mix(in srgb, var(--text) 72%, transparent)',
                    color: 'var(--bg)',
                    fontSize: 'var(--fs-18)',
                    fontWeight: 700,
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {photo.alt}
                </span>
              </GazeButton>
            ))}
          </GazeGrid>
        </div>

        {/* Navegação: páginas e nova foto */}
        <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
          {totalPaginas > 1 && (
            <>
              <GazeButton
                onClick={() => setPagina((p) => p - 1)}
                size="lg"
                variant="ghost"
                icon={<ChevronLeft />}
                label="Anteriores"
                disabled={pagina === 0}
                style={{ borderColor: 'var(--border)' }}
              />
              <GazeButton
                onClick={() => setPagina((p) => p + 1)}
                size="lg"
                variant="ghost"
                icon={<ChevronRight />}
                label="Próximas"
                disabled={pagina >= totalPaginas - 1}
                style={{ borderColor: 'var(--border)' }}
              />
            </>
          )}
          <GazeButton
            onClick={() => navigate('/photo')}
            size="lg"
            variant="primary"
            icon={<Camera />}
            label="Tirar nova foto"
            aria-label="Ir para a câmera e tirar uma nova foto"
          />
        </div>
      </div>

      {selectedPhoto && (
        <div role="dialog" aria-modal="true" aria-labelledby="modal-photo-title" className="gaze-modal">
          <div
            className="gaze-modal__card"
            style={{ width: 'min(1100px, 94vw)', maxHeight: '94vh', gap: '1.25rem', padding: '1.75rem' }}
          >
            <h2 id="modal-photo-title" className="gaze-modal__title" style={{ fontSize: 'var(--fs-24)' }}>
              {selectedPhoto.alt}
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
                src={selectedPhoto.url}
                alt={selectedPhoto.alt}
                style={{ maxWidth: '100%', maxHeight: '50vh', objectFit: 'contain', display: 'block' }}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${selectedPhoto.isUserPhoto ? 3 : 2}, minmax(0, 1fr))`,
                gap: 24,
                width: '100%',
                '--gaze-grid-gap': '24px',
              } as React.CSSProperties}
            >
              <GazeButton
                onClick={() => setSelectedPhoto(null)}
                size="lg"
                icon={<X color="var(--primary)" />}
                label="Fechar"
                aria-label="Fechar a foto"
                style={{ width: '100%' }}
              />
              <GazeButton
                onClick={() => handleDownloadPhoto(selectedPhoto.url, `foto_${selectedPhoto.id || 'download'}`)}
                size="lg"
                variant="primary"
                icon={<Download />}
                label="Baixar"
                aria-label="Baixar esta foto"
                style={{ width: '100%' }}
              />
              {selectedPhoto.isUserPhoto && (
                <GazeButton
                  onClick={() => handleDeletePhoto(selectedPhoto.id)}
                  size="lg"
                  variant="danger"
                  icon={<Trash2 />}
                  label="Excluir"
                  aria-label="Excluir esta foto do álbum"
                  // Excluir é irreversível: dwell mais longo.
                  dwellMs={3000}
                  style={{ width: '100%' }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </GazePageLayout>
  );
};
