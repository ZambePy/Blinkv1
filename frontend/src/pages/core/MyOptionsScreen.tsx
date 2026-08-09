import React, { useEffect, useState } from 'react';
import { Heart, Plus, Trash2, Volume2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useAuth } from '../../context/AuthContext';

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
    <main
      role="main"
      aria-labelledby="options-title"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #f8fafc 0%, #e2e8f0 100%)',
        padding: '2rem',
      }}
    >
      <PageHeader
        title="Minhas Opções — Favoritos"
        icon={<Heart color="#e11d48" aria-hidden="true" />}
      />

      <section
        aria-labelledby="add-fav"
        style={{
          maxWidth: 900,
          margin: '0 auto',
          background: 'white',
          padding: '2rem',
          borderRadius: '1.5rem',
          boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
        }}
      >
        <h2 id="add-fav" style={{ fontSize: '1.25rem', color: '#0f172a', margin: '0 0 1rem 0' }}>
          Adicionar frase favorita
        </h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <label htmlFor="fav-input" className="sr-only">
            Nova frase favorita
          </label>
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
              padding: '1rem 1.25rem',
              borderRadius: '1rem',
              border: '2px solid #e2e8f0',
              fontSize: '1.1rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          />
          <PrimaryButton
            onClick={addFavorite}
            disabled={!newText.trim()}
            aria-label="Adicionar frase aos favoritos"
          >
            <Plus size={18} aria-hidden="true" /> Adicionar
          </PrimaryButton>
        </div>
      </section>

      <section
        aria-labelledby="fav-list-title"
        style={{
          maxWidth: 900,
          margin: '1.5rem auto 0',
        }}
      >
        <h2
          id="fav-list-title"
          style={{ fontSize: '1.25rem', color: '#0f172a', margin: '0 0 1rem 0.5rem' }}
        >
          Meus favoritos ({favorites.length})
        </h2>

        {favorites.length === 0 ? (
          <p
            role="status"
            style={{
              padding: '2rem',
              background: 'white',
              borderRadius: '1.5rem',
              color: '#64748b',
              textAlign: 'center',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Nenhum favorito ainda. Adicione a primeira frase acima.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            {favorites.map((fav) => (
              <li
                key={fav.id}
                style={{
                  background: 'white',
                  padding: '1rem 1.25rem',
                  borderRadius: '1rem',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'center',
                }}
              >
                <span style={{ flex: 1, fontSize: '1.1rem', color: '#1e293b' }}>{fav.text}</span>
                <button
                  type="button"
                  onClick={() => speak(fav.text)}
                  aria-label={`Falar frase: ${fav.text}`}
                  style={{
                    background: '#eff6ff',
                    color: '#1B54A8',
                    border: 'none',
                    padding: '0.6rem 0.9rem',
                    borderRadius: '0.75rem',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: '0.4rem',
                    alignItems: 'center',
                    fontWeight: 700,
                  }}
                >
                  <Volume2 size={18} aria-hidden="true" /> Falar
                </button>
                <button
                  type="button"
                  onClick={() => removeFavorite(fav.id)}
                  aria-label={`Remover favorito: ${fav.text}`}
                  style={{
                    background: '#fef2f2',
                    color: '#dc2626',
                    border: 'none',
                    padding: '0.6rem 0.9rem',
                    borderRadius: '0.75rem',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: '0.4rem',
                    alignItems: 'center',
                    fontWeight: 700,
                  }}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};
