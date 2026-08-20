import React, { useEffect, useState } from 'react';
import { Heart, Plus, Trash2, Volume2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';

interface Favorite {
  id: string;
  text: string;
  createdAt: string;
}

const storageKey = (userId: string) => `irisflow_favorites_${userId}`;

const loadFavorites = (userId: string): Favorite[] => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as Favorite[]) : [];
  } catch {
    return [];
  }
};

const speak = (text: string) => {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pt-BR';
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
};

export const MyOptionsScreen: React.FC = () => {
  const { currentProfile } = useAuth();
  const userId = currentProfile?.id ?? 'guest';

  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites(userId));
  const [newText, setNewText] = useState('');

  useEffect(() => {
    localStorage.setItem(storageKey(userId), JSON.stringify(favorites));
  }, [favorites, userId]);

  const addFavorite = () => {
    const text = newText.trim();
    if (!text) return;
    setFavorites((f) => [
      ...f,
      { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() },
    ]);
    setNewText('');
  };

  const removeFavorite = (id: string) => {
    setFavorites((f) => f.filter((fav) => fav.id !== id));
  };

  return (
    <GazePageLayout showBack={true} backRoute="/menu">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          boxSizing: 'border-box',
          gap: '2rem',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#ffffff', margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <Heart color="#e11d48" fill="#e11d48" size={36} /> Minhas Opções — Favoritos
          </h1>
          <p style={{ fontSize: '1.2rem', color: 'rgba(255,255,255,0.7)', margin: 0 }}>
            Gerencie e selecione suas frases favoritas
          </p>
        </div>

        {/* Adicionar frase (Operado por cuidador com mouse/teclado) */}
        <section
          aria-labelledby="add-fav"
          style={{
            background: 'var(--color-card-bg)',
            padding: '1.5rem',
            borderRadius: '1.5rem',
            border: '2px solid var(--color-card-border)',
          }}
        >
          <h2 id="add-fav" style={{ fontSize: '1.25rem', color: 'var(--color-text-base)', margin: '0 0 1rem 0', fontWeight: 700 }}>
            Adicionar frase favorita (Cuidador)
          </h2>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <input
              id="fav-input"
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFavorite()}
              placeholder="Ex.: Quero um copo de água"
              aria-label="Nova frase favorita"
              style={{
                flex: 1,
                minWidth: 200,
                padding: '0.75rem 1.25rem',
                borderRadius: '1rem',
                border: '2px solid var(--color-card-border)',
                fontSize: '1.1rem',
                background: 'var(--color-bg-base)',
                color: 'var(--color-text-base)',
                outline: 'none',
              }}
            />
            <button
              onClick={addFavorite}
              disabled={!newText.trim()}
              style={{
                padding: '0.75rem 1.5rem',
                background: newText.trim() ? '#1B54A8' : 'rgba(255,255,255,0.05)',
                color: newText.trim() ? 'white' : 'rgba(255,255,255,0.2)',
                border: '1px solid var(--color-card-border)',
                borderRadius: '1rem',
                fontWeight: 700,
                fontSize: '1.1rem',
                cursor: newText.trim() ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <Plus size={18} /> Adicionar
            </button>
          </div>
        </section>

        {/* Lista de Favoritos (Operado por paciente com gaze) */}
        <section
          aria-labelledby="fav-list-title"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <h2
            id="fav-list-title"
            style={{ fontSize: '1.35rem', color: '#ffffff', margin: '0 0 1rem 0.5rem', fontWeight: 700 }}
          >
            Seus favoritos ({favorites.length})
          </h2>

          {favorites.length === 0 ? (
            <p
              role="status"
              style={{
                padding: '3rem 2rem',
                background: 'var(--color-card-bg)',
                borderRadius: '1.5rem',
                color: 'var(--color-text-base)',
                opacity: 0.8,
                textAlign: 'center',
                fontSize: '1.25rem',
                border: '2px solid var(--color-card-border)',
              }}
            >
              Nenhum favorito ainda. Adicione a primeira frase acima.
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                maxHeight: '400px',
                overflowY: 'auto',
              }}
            >
              {favorites.map((fav) => (
                <li
                  key={fav.id}
                  style={{
                    background: 'var(--color-card-bg)',
                    padding: '1rem 1.5rem',
                    borderRadius: '1.5rem',
                    border: '2px solid var(--color-card-border)',
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ flex: 1, fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text-base)' }}>
                    {fav.text}
                  </span>

                  {/* Falar - GazeButton */}
                  <GazeButton
                    onClick={() => speak(fav.text)}
                    style={{
                      width: '180px',
                      height: '60px',
                      background: 'rgba(27, 84, 168, 0.05)',
                      border: '2px solid rgba(27, 84, 168, 0.3)',
                      borderRadius: '1rem',
                      color: '#1B54A8',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem', fontWeight: 800 }}>
                      <Volume2 size={22} /> Falar
                    </div>
                  </GazeButton>

                  {/* Remover - Botão comum (Cuidador) */}
                  <button
                    type="button"
                    onClick={() => removeFavorite(fav.id)}
                    aria-label={`Remover favorito: ${fav.text}`}
                    style={{
                      background: 'rgba(239, 68, 68, 0.05)',
                      color: '#dc2626',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      padding: '0.75rem',
                      borderRadius: '1rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Trash2 size={20} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </GazePageLayout>
  );
};
