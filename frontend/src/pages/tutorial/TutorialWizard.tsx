import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { limitarDwellMs } from '../../dwellMs';
import { gravarTutorial } from '../../services/local/tutorialProfile';
import {
  PASSOS_DO_TUTORIAL,
  indiceDoPassoDoTutorial,
  proximoPassoDoTutorial,
  passoAnteriorDoTutorial,
  type PassoDoTutorial,
} from './passos';
import { OQueEDwell } from './steps/OQueEDwell';
import { PraticaGuiada } from './steps/PraticaGuiada';
import { AjusteDoTempo } from './steps/AjusteDoTempo';
import { BotaoDeEmergencia } from './steps/BotaoDeEmergencia';
import { Concluido } from './steps/Concluido';

/**
 * Tutorial de uso.
 *
 * Vem **depois** da calibração: "sentir o tempo de permanência" só é real com o
 * olhar funcionando. Antes da calibração o dwell fica desligado, e a prática
 * seria feita com o mouse — que não ensina nada sobre olhar.
 *
 * **Não bloqueia nada.** Quem não quiser fazer, pula. Travar o acesso à
 * comunicação por um tutorial contradiz a premissa do projeto.
 *
 * Uma rota só, passo no estado: o dwell precisa seguir ativo e configurado
 * entre os passos, e o slider do passo 3 tem de afetar a prática sem remontar.
 */
export const TutorialWizard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile } = useAuth();
  const { settings, updateSettings } = useSettings();

  const [passo, setPasso] = useState<PassoDoTutorial>('oQueEDwell');
  const [ensaiou, setEnsaiou] = useState(false);

  const dwellMs = limitarDwellMs(settings.dwellMs);

  const mudarDwell = useCallback(
    (ms: number) => updateSettings({ dwellMs: limitarDwellMs(ms) }),
    [updateSettings]
  );

  const registrarEnsaio = useCallback((fez: boolean) => {
    if (fez) setEnsaiou(true);
  }, []);

  const sair = (concluiu: boolean) => {
    if (concluiu && currentProfile) {
      gravarTutorial(currentProfile.id, {
        dwellMsEscolhido: dwellMs,
        ensaiouEmergencia: ensaiou,
      });
    }
    navigate('/menu', { replace: true });
  };

  const avancar = () => {
    const p = proximoPassoDoTutorial(passo);
    if (p) setPasso(p);
    else sair(true);
  };

  const anterior = passoAnteriorDoTutorial(passo);
  const ultimo = proximoPassoDoTutorial(passo) === null;

  return (
    <main
      role="main"
      aria-labelledby="tutorial-title"
      style={{
        minHeight: '100vh',
        background: 'var(--settings-bg)',
        display: 'flex',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <h1
            id="tutorial-title"
            style={{
              margin: 0,
              fontSize: '1.15rem',
              fontWeight: 800,
              opacity: 0.75,
              color: 'var(--color-text-base)',
            }}
          >
            {t('tutorial.title')}
          </h1>
          {/* Pular está sempre disponível, em todos os passos. */}
          <button
            type="button"
            onClick={() => sair(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-primary)',
              fontSize: '0.9rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t('tutorial.skip')}
          </button>
        </div>

        <Trilha atual={passo} />

        <div
          className="glass-card"
          style={{
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-card-border)',
            borderRadius: '1.5rem',
            padding: '1.75rem',
          }}
        >
          {passo === 'oQueEDwell' && <OQueEDwell dwellMs={dwellMs} />}
          {passo === 'pratica' && (
            <PraticaGuiada dwellMs={dwellMs} aoSugerirAjuste={() => setPasso('ajuste')} />
          )}
          {passo === 'ajuste' && <AjusteDoTempo dwellMs={dwellMs} aoMudar={mudarDwell} />}
          {passo === 'emergencia' && <BotaoDeEmergencia aoEnsaiar={registrarEnsaio} />}
          {passo === 'concluido' && <Concluido />}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <PrimaryButton
            type="button"
            variant="ghost"
            disabled={anterior === null}
            onClick={() => anterior && setPasso(anterior)}
          >
            <ArrowLeft size={17} aria-hidden="true" /> {t('tutorial.back')}
          </PrimaryButton>

          <PrimaryButton type="button" onClick={avancar}>
            {ultimo ? (
              <>
                {t('tutorial.concluido.ir')} <Check size={17} aria-hidden="true" />
              </>
            ) : (
              <>
                {t('tutorial.next')} <ArrowRight size={17} aria-hidden="true" />
              </>
            )}
          </PrimaryButton>
        </div>
      </div>
    </main>
  );
};

const Trilha: React.FC<{ atual: PassoDoTutorial }> = ({ atual }) => {
  const { t } = useTranslation();
  const i = indiceDoPassoDoTutorial(atual);
  return (
    <div style={{ display: 'flex', gap: '0.4rem' }}>
      {PASSOS_DO_TUTORIAL.map((p, n) => (
        <div key={p} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <div
            style={{
              height: 4,
              borderRadius: 999,
              background: n <= i ? 'var(--color-primary)' : 'var(--color-card-border)',
            }}
          />
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: n === i ? 800 : 600,
              opacity: n === i ? 1 : 0.55,
              color: 'var(--color-text-base)',
            }}
          >
            {t(`tutorial.steps.${p}`)}
          </span>
        </div>
      ))}
    </div>
  );
};
