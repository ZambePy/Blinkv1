import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Lock, MousePointer2 } from 'lucide-react';
import { GazeButton } from '../../components/ui/GazeButton';
import { GazeGrid } from '../../components/ui/GazeGrid';
import { ICON_URL } from '../../design/assets';
import { setDevMode } from '../../devMode';

/**
 * Boas-vindas: primeira tela do paciente.
 *
 * Duas escolhas grandes e nada mais no caminho do olhar. Os controles do
 * cuidador (área restrita e modo de desenvolvedor) ficam pequenos, no rodapé,
 * e fora do dwell.
 *
 * A íris (`ICON_URL`) vai sozinha, com o nome em texto: o wordmark do logo
 * completo é azul-marinho e some no tema escuro, que é o padrão do app.
 */
export const InitialSplash: React.FC = () => {
  const navigate = useNavigate();

  const comecar = () => {
    setDevMode(false);
    navigate('/tutorial');
  };

  const jaSeiUsar = () => {
    setDevMode(false);
    navigate('/calibration-check');
  };

  const abrirAreaDoCuidador = () => {
    setDevMode(false);
    navigate('/settings');
  };

  const entrarComoDesenvolvedor = () => {
    setDevMode(true);
    navigate('/menu');
  };

  return (
    <main
      role="main"
      aria-labelledby="splash-title"
      className="gaze-page gaze-page--bare"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'var(--gaze-page-pad)',
        gap: 'var(--gaze-page-pad)',
      }}
    >
      {/* Marca + frase do que o app faz */}
      <section
        className="animate-fade-in-up"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '0.75rem',
          paddingTop: '1rem',
        }}
      >
        <img
          src={ICON_URL}
          alt=""
          aria-hidden="true"
          width={112}
          height={112}
          style={{ width: 112, height: 112, objectFit: 'contain' }}
        />
        <h1 id="splash-title" className="font-display" style={{ fontSize: 'var(--fs-56)' }}>
          IrisFlow
        </h1>
        <p style={{ fontSize: 'var(--fs-24)', color: 'var(--text-2)', maxWidth: '28ch' }}>
          Fale, escreva e peça ajuda usando só o olhar.
        </p>
      </section>

      {/* Zona de descanso: o olhar pode parar aqui sem acionar nada */}
      <div
        data-no-dwell="true"
        className="gaze-rest-zone"
        aria-label="Zona de descanso: olhar aqui não aciona nada"
        style={{ flex: '1 1 auto', width: 'min(100%, 960px)', minHeight: 96, height: 'auto' }}
      >
        <span>Zona de descanso</span>
      </div>

      {/* As duas escolhas do paciente */}
      <div style={{ width: 'min(100%, 960px)', height: 220, flex: '0 0 auto' }}>
        <GazeGrid columns={2} rows={1} gap={40}>
          <GazeButton
            variant="primary"
            size="xl"
            icon={<ArrowRight />}
            label="Começar"
            aria-label="Começar: ver o tutorial"
            onClick={comecar}
          />
          <GazeButton
            variant="secondary"
            size="xl"
            icon={<Check />}
            label="Já sei usar"
            aria-label="Já sei usar: ir direto para a calibração"
            onClick={jaSeiUsar}
          />
        </GazeGrid>
      </div>

      {/* Controles do cuidador: pequenos, mouse, sem dwell */}
      <footer
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          justifyContent: 'center',
          paddingBottom: '0.5rem',
        }}
      >
        <button
          type="button"
          className="btn btn--ghost"
          data-no-dwell="true"
          onClick={abrirAreaDoCuidador}
        >
          <Lock size={16} aria-hidden="true" /> Área do cuidador
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          data-no-dwell="true"
          onClick={entrarComoDesenvolvedor}
          title="Esconde o cursor do olhar e desliga o dwell para operar com o mouse"
        >
          <MousePointer2 size={16} aria-hidden="true" /> Modo desenvolvedor
        </button>
      </footer>
    </main>
  );
};
