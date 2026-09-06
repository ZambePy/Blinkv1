import React, { useEffect, useState } from 'react';
import { Heart, Plus, Trash2, Volume2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeGrid } from '../../components/ui/GazeGrid';
import { GazeButton } from '../../components/ui/GazeButton';
import { speak, stopSpeaking } from '../../utils/speech';

interface Favorite {
  id: string;
  text: string;
  createdAt: string;
}

const storageKey = (userId: string) => `irisflow_favorites_${userId}`;

const loadFavorites = (userId: string): Favorite[] => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as Favorite[]) : [];
  } catch {
    return [];
  }
};

/** Seis alvos por página, como nas outras grades do paciente. */
const POR_PAGINA = 6;

/**
 * Frases favoritas. O cuidador cadastra com mouse e teclado (barra de baixo,
 * fora do dwell); o paciente fala cada frase olhando para o alvo dela.
 */
export const MyOptionsScreen: React.FC = () => {
  const { currentProfile } = useAuth();
  const userId = currentProfile?.id ?? 'guest';

  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites(userId));
  const [newText, setNewText] = useState('');
  const [pagina, setPagina] = useState(0);
  const [falando, setFalando] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(storageKey(userId), JSON.stringify(favorites));
  }, [favorites, userId]);

  useEffect(() => () => stopSpeaking(), []);

  const totalPaginas = Math.max(1, Math.ceil(favorites.length / POR_PAGINA));
  // Ao remover a última frase de uma página, volta uma página em vez de
  // mostrar uma grade vazia.
  useEffect(() => {
    if (pagina > totalPaginas - 1) setPagina(totalPaginas - 1);
  }, [pagina, totalPaginas]);

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

  const falar = (fav: Favorite) => {
    setFalando(fav.id);
    if (!speak(fav.text, { onEnd: () => setFalando(null) })) setFalando(null);
  };

  const visiveis = favorites.slice(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA);
  const temAnterior = pagina > 0;
  const temProxima = pagina < totalPaginas - 1;

  return (
    <GazePageLayout backRoute="/menu" title="Minhas frases">
      <h1 className="sr-only">Minhas frases favoritas</h1>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.25rem' }}>
        {/* Área do paciente: grade de alvos, um por frase */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {favorites.length === 0 ? (
            <div
              role="status"
              data-no-dwell="true"
              className="gaze-rest-zone"
              style={{ height: '100%', gap: '1rem', fontSize: 'var(--fs-24)' }}
            >
              <Heart size={48} aria-hidden="true" />
              <span>Ainda não há frases favoritas.</span>
              <span style={{ fontSize: 'var(--fs-18)', fontWeight: 500 }}>
                O cuidador pode adicionar a primeira na barra de baixo.
              </span>
            </div>
          ) : (
            <GazeGrid columns={3} rows={2} gap={32}>
              {visiveis.map((fav) => {
                const ativa = falando === fav.id;
                return (
                  <div
                    key={fav.id}
                    style={{ position: 'relative', display: 'flex', minHeight: 0 }}
                  >
                    <GazeButton
                      onClick={() => falar(fav)}
                      size="lg"
                      stacked
                      variant={ativa ? 'primary' : 'secondary'}
                      icon={<Volume2 color={ativa ? 'var(--on-primary)' : 'var(--primary)'} />}
                      label={fav.text}
                      aria-label={`Falar: ${fav.text}`}
                      aria-pressed={ativa}
                      style={{ width: '100%', height: '100%', padding: '1rem 1.25rem 2.75rem' }}
                    />
                    {/* Remoção é do cuidador: botão compacto, fora do dwell */}
                    <button
                      type="button"
                      onClick={() => removeFavorite(fav.id)}
                      aria-label={`Remover frase: ${fav.text}`}
                      data-no-dwell="true"
                      className="btn btn--ghost"
                      style={{
                        position: 'absolute',
                        right: 12,
                        bottom: 10,
                        minHeight: 36,
                        padding: '0.25rem 0.6rem',
                        fontSize: '0.85rem',
                        zIndex: 3,
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" /> Remover
                    </button>
                  </div>
                );
              })}
            </GazeGrid>
          )}
        </div>

        {/* Paginação (paciente) + cadastro (cuidador) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            flexWrap: 'wrap',
          }}
        >
          {totalPaginas > 1 && (
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <GazeButton
                onClick={() => setPagina((p) => p - 1)}
                size="lg"
                variant="ghost"
                icon={<ChevronLeft />}
                label="Anteriores"
                disabled={!temAnterior}
                style={{ borderColor: 'var(--border)' }}
              />
              <GazeButton
                onClick={() => setPagina((p) => p + 1)}
                size="lg"
                variant="ghost"
                icon={<ChevronRight />}
                label="Próximas"
                disabled={!temProxima}
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
          )}

          <form
            data-no-dwell="true"
            onSubmit={(e) => {
              e.preventDefault();
              addFavorite();
            }}
            aria-label="Adicionar frase favorita (cuidador)"
            style={{
              flex: 1,
              minWidth: 320,
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'center',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <label htmlFor="fav-input" style={{ fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
              Nova frase
            </label>
            <input
              id="fav-input"
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Ex.: Quero um copo de água"
              data-no-dwell="true"
              style={{
                flex: 1,
                minWidth: 160,
                minHeight: 44,
                padding: '0.5rem 0.9rem',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 'var(--fs-16)',
              }}
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!newText.trim()}
              data-no-dwell="true"
            >
              <Plus size={18} aria-hidden="true" /> Adicionar
            </button>
          </form>
        </div>
      </div>
    </GazePageLayout>
  );
};
