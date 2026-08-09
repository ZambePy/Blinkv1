import React from 'react';
import { BackButton } from '../../components/ui/BackButton';
import { Image as ImageIcon } from 'lucide-react';

interface Photo {
  url: string;
  alt: string;
}

const PHOTOS: Photo[] = [
  {
    url: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=500&q=80',
    alt: 'Foto de família',
  },
  {
    url: 'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=500&q=80',
    alt: 'Foto de viagem',
  },
  {
    url: 'https://images.unsplash.com/photo-1516156008625-3a9d045f6b28?w=500&q=80',
    alt: 'Foto de paisagem',
  },
  {
    url: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=500&q=80',
    alt: 'Foto de pet',
  },
];

export const GalleryScreen: React.FC = () => {
  return (
    <main
      role="main"
      aria-labelledby="gallery-title"
      style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '2rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem', gap: '1rem' }}>
        <BackButton />
        <h1
          id="gallery-title"
          style={{
            fontSize: '2rem',
            color: '#1e293b',
            margin: 0,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <ImageIcon aria-hidden="true" /> Galeria
        </h1>
      </div>

      <div
        role="list"
        aria-label="Fotos"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '2rem',
        }}
      >
        {PHOTOS.map((photo, i) => (
          <div
            key={i}
            role="listitem"
            className="gallery-item"
            style={{
              borderRadius: '1.5rem',
              overflow: 'hidden',
              boxShadow: '0 10px 20px rgba(0,0,0,0.1)',
              transition: 'transform 0.3s',
            }}
          >
            <img
              src={photo.url}
              alt={photo.alt}
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '300px', objectFit: 'cover', display: 'block' }}
            />
          </div>
        ))}
      </div>
    </main>
  );
};
