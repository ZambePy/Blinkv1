import React from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown, Info } from 'lucide-react';
import { getClinicalData } from '../../utils/clinicalLogger';

/**
 * Histórico de precisão do paciente.
 *
 * As medições **herdadas** aparecem marcadas. Elas vêm de antes da separação
 * por paciente e podem ser de outra pessoa desta máquina; apresentá-las junto
 * sem marca faria a curva parecer o acompanhamento de um paciente quando talvez
 * seja de dois — e quem lê não teria como perceber.
 *
 * Sem biblioteca de gráfico: uma lista com barras proporcionais lê bem, não
 * adiciona dependência e funciona no tema escuro sem configuração extra. Uma
 * curva desenhada sobre poucos pontos também sugere uma tendência que os dados
 * não sustentam.
 */

const emGraus = (n: number) => n.toFixed(1).replace('.', ',');

export const HistoricoDeSessoes: React.FC = () => {
  const { t, i18n } = useTranslation();

  const medicoes = [...getClinicalData().calibrations].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const temHerdadas = medicoes.some((m) => m.herdado === true);
  const erros = medicoes.map((m) => m.errorDeg).filter((n) => Number.isFinite(n));
  const melhor = erros.length ? Math.min(...erros) : null;
  const pior = erros.length ? Math.max(...erros) : null;

  return (
    <main
      role="main"
      aria-labelledby="historico-title"
      style={{
        minHeight: '100vh',
        background: 'var(--settings-bg)',
        display: 'flex',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
        overflowY: 'auto',
      }}
    >
      <div
        className="glass-card"
        style={{
          width: '100%',
          maxWidth: 620,
          height: 'fit-content',
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: '1.5rem',
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.2rem',
        }}
      >
        <h1
          id="historico-title"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            margin: 0,
            fontSize: '1.3rem',
            fontWeight: 800,
            color: 'var(--color-text-base)',
          }}
        >
          <TrendingDown size={20} color="var(--color-primary)" aria-hidden="true" />
          {t('historico.title')}
        </h1>

        {medicoes.length === 0 && (
          <p style={{ margin: 0, opacity: 0.8, color: 'var(--color-text-base)' }}>
            {t('historico.vazio')}
          </p>
        )}

        {/* Uma medição não é evolução. Desenhar uma linha de um ponto só
            sugeriria tendência onde não há dado para ela. */}
        {medicoes.length === 1 && (
          <p style={{ margin: 0, opacity: 0.8, color: 'var(--color-text-base)' }}>
            {t('historico.poucos')}
          </p>
        )}

        {medicoes.length > 0 && melhor !== null && pior !== null && (
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              flexWrap: 'wrap',
              fontSize: '0.9rem',
              opacity: 0.8,
              color: 'var(--color-text-base)',
            }}
          >
            <span>{t('historico.total', { n: medicoes.length })}</span>
            <span>{t('historico.melhor', { graus: emGraus(melhor) })}</span>
            <span>{t('historico.pior', { graus: emGraus(pior) })}</span>
          </div>
        )}

        <ol
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
          }}
        >
          {medicoes.map((m) => {
            // Barra proporcional ao erro, com o pior como referência: o que
            // interessa é a comparação entre as medições desta pessoa.
            const largura = pior && pior > 0 ? Math.max(4, (m.errorDeg / pior) * 100) : 0;
            return (
              <li key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    fontSize: '0.92rem',
                    color: 'var(--color-text-base)',
                  }}
                >
                  <span>
                    {t('historico.medicao', {
                      graus: emGraus(m.errorDeg),
                      data: new Date(m.timestamp).toLocaleDateString(i18n.language, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }),
                    })}
                  </span>
                  {m.herdado === true && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '0.1rem 0.5rem',
                        borderRadius: '999px',
                        background: 'var(--tint-warn-bg)',
                        border: '1px solid var(--tint-warn-border)',
                        color: 'var(--tint-warn-text)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('historico.herdado')}
                    </span>
                  )}
                </div>
                <div
                  aria-hidden="true"
                  style={{ height: 6, borderRadius: 999, background: 'var(--color-card-border)' }}
                >
                  <div
                    style={{
                      width: `${largura}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: 'var(--color-primary)',
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ol>

        {/* Só aparece quando há herdadas: uma ressalva que não se aplica é
            ruído numa tela que existe para dar confiança. */}
        {temHerdadas && (
          <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start' }}>
            <Info
              size={15}
              color="var(--tint-warn-text)"
              aria-hidden="true"
              style={{ flexShrink: 0, marginTop: 3 }}
            />
            <span
              style={{
                fontSize: '0.84rem',
                lineHeight: 1.5,
                opacity: 0.8,
                color: 'var(--color-text-base)',
              }}
            >
              {t('historico.avisoHerdado')}
            </span>
          </div>
        )}
      </div>
    </main>
  );
};
