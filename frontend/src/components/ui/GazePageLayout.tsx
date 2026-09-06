import React from 'react';
import { Bell, Eye } from 'lucide-react';
import { BackButton } from './BackButton';
import { GazeButton } from './GazeButton';
import { useReminders } from '../../context/ReminderContext';

interface GazePageLayoutProps {
  children: React.ReactNode;
  /** Mostra o botão Voltar (alvo de gaze) no canto superior esquerdo. */
  showBack?: boolean;
  /**
   * Mantido por compatibilidade: o botão de emergência é global
   * (EmergencyProvider) e aparece sozinho em toda tela do paciente. O layout
   * apenas reserva o espaço dele no cabeçalho.
   */
  showEmergency?: boolean;
  backRoute?: string;
  /** Título curto exibido no centro do cabeçalho, acima da zona de descanso. */
  title?: string;
  /**
   * Modo "sem moldura": sem padding e sem o cabeçalho canônico. A tela
   * controla 100% do viewport e desenha a própria navegação (teclado).
   * Os lembretes continuam sendo exibidos.
   */
  bare?: boolean;
  className?: string;
}

/**
 * Moldura padrão das telas do paciente.
 *
 * Cabeçalho (altura fixa `--gaze-header-h`): Voltar à esquerda, título +
 * zona de descanso no centro, espaço reservado à direita para o botão de
 * emergência global. Quando a faixa de status está visível, `html.has-status-band`
 * empurra tudo para baixo — nada fica coberto.
 */
export const GazePageLayout: React.FC<GazePageLayoutProps> = ({
  children,
  showBack = true,
  backRoute,
  title,
  bare = false,
  className = '',
}) => {
  const { activeReminder, dismissActiveReminder } = useReminders();

  return (
    <div className={`gaze-page ${bare ? 'gaze-page--bare' : ''} ${className}`.trim()}>
      {!bare && (
        <header className="gaze-page__header">
          <div className="gaze-page__slot">
            {showBack ? <BackButton to={backRoute} /> : <div style={{ width: 160 }} />}
          </div>

          <div className="gaze-page__slot" style={{ flex: 1, minWidth: 0, height: '100%' }}>
            <div
              data-no-dwell="true"
              className="gaze-rest-zone"
              aria-label="Zona de descanso: olhar aqui não aciona nada"
            >
              {title ? (
                <span className="gaze-page__title">{title}</span>
              ) : (
                <Eye size={28} aria-hidden="true" />
              )}
              <span>Zona de descanso</span>
            </div>
          </div>

          {/* Espaço do botão de emergência global */}
          <div className="gaze-page__slot gaze-page__slot--end" aria-hidden="true" />
        </header>
      )}

      <div className="gaze-page__content">{children}</div>

      {activeReminder && (
        <div
          className="gaze-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reminder-title"
        >
          <div className="gaze-modal__card">
            <div className="gaze-modal__icon">
              <Bell size={40} aria-hidden="true" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span className="gaze-modal__eyebrow">Lembrete</span>
              <h2 id="reminder-title" className="gaze-modal__title">
                {activeReminder.title}
              </h2>
              <span className="gaze-modal__meta">Horário: {activeReminder.time}</span>
            </div>
            <GazeButton
              onClick={dismissActiveReminder}
              variant="primary"
              size="lg"
              label="Entendi"
            />
          </div>
        </div>
      )}
    </div>
  );
};
