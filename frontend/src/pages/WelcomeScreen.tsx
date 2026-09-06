import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crosshair, LayoutGrid } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeButton } from '../components/ui/GazeButton';
import { GazeGrid } from '../components/ui/GazeGrid';
import { ICON_URL } from '../design/assets';

/** Resumo que o teste de precisão grava ao terminar (ver `accuracy.ts`). */
interface ResumoDePrecisao {
  score: string;
  colorClass: string;
  meanErrorDeg: number | null;
  timestamp: number;
}

/** Um resultado antigo não descreve a sessão de agora. */
const VALIDADE_DO_RESULTADO_MS = 30 * 60_000;
/** Sem ação do paciente, o menu abre sozinho. */
const AUTO_AVANCO_MS = 20_000;

/** Frase curta, sem número, para o paciente. */
const FRASE_POR_SCORE: Record<string, string> = {
  Excelente: 'Sua calibração ficou excelente.',
  Bom: 'Sua calibração ficou boa.',
  Regular: 'Sua calibração ficou razoável. Se os botões não responderem bem, vale refazer.',
  Ruim: 'A calibração não ficou boa. Recomendamos refazer antes de usar.',
};

function lerResumoDePrecisao(): ResumoDePrecisao | null {
  try {
    const raw = localStorage.getItem('accuracyResult');
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<ResumoDePrecisao>;
    if (typeof r.score !== 'string' || typeof r.timestamp !== 'number') return null;
    if (Date.now() - r.timestamp > VALIDADE_DO_RESULTADO_MS) return null;
    return {
      score: r.score,
      colorClass: typeof r.colorClass === 'string' ? r.colorClass : '',
      meanErrorDeg: typeof r.meanErrorDeg === 'number' ? r.meanErrorDeg : null,
      timestamp: r.timestamp,
    };
  } catch {
    return null;
  }
}

/** Boas-vindas depois da calibração: saudação, resultado e um caminho só. */
export const WelcomeScreen: React.FC = () => {
  const navigate = useNavigate();
  const resumo = useMemo(lerResumoDePrecisao, []);
  const frase = resumo ? FRASE_POR_SCORE[resumo.score] : undefined;
  const sugerirRefazer = resumo?.score === 'Regular' || resumo?.score === 'Ruim';

  useEffect(() => {
    const id = setTimeout(() => navigate('/menu'), AUTO_AVANCO_MS);
    return () => clearTimeout(id);
  }, [navigate]);

  return (
    <GazePageLayout showBack={false} title="Bem-vindo">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.5rem' }}>
        <section
          aria-labelledby="welcome-title"
          className="animate-fade-in-up"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: '1rem',
          }}
        >
          <img
            src={ICON_URL}
            alt=""
            aria-hidden="true"
            width={96}
            height={96}
            style={{ width: 96, height: 96, objectFit: 'contain' }}
          />
          <h1 id="welcome-title" className="font-display" style={{ fontSize: 'var(--fs-40)' }}>
            Tudo pronto
          </h1>
          <p style={{ fontSize: 'var(--fs-24)', color: 'var(--text-2)', maxWidth: '40ch' }}>
            {frase ?? 'O sistema já está acompanhando o seu olhar.'}
          </p>
          {resumo && (
            <p
              className={resumo.colorClass}
              style={{ fontSize: 'var(--fs-18)', fontWeight: 700 }}
            >
              Precisão: {resumo.score}
              {resumo.meanErrorDeg !== null && ` (${resumo.meanErrorDeg.toFixed(1)}°)`}
            </p>
          )}
          <p style={{ fontSize: 'var(--fs-16)', color: 'var(--text-3)' }}>
            Se preferir esperar, o menu abre sozinho.
          </p>
        </section>

        <div style={{ height: 200, flex: '0 0 auto', width: 'min(100%, 880px)', alignSelf: 'center' }}>
          <GazeGrid columns={sugerirRefazer ? 2 : 1} rows={1} gap={40}>
            {sugerirRefazer && (
              <GazeButton
                size="xl"
                variant="secondary"
                icon={<Crosshair />}
                label="Refazer calibração"
                onClick={() => navigate('/calibration-check')}
              />
            )}
            <GazeButton
              size="xl"
              variant="primary"
              icon={<LayoutGrid />}
              label="Ir para o menu"
              onClick={() => navigate('/menu')}
            />
          </GazeGrid>
        </div>
      </div>
    </GazePageLayout>
  );
};
