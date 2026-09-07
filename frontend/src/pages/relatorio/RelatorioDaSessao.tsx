import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileDown, Monitor, Sun, Layers, Crosshair, Info } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import {
  lerUltimoRelatorio,
  exportarResumo,
  type ResumoDoRelatorio,
} from '../../services/local/ultimoRelatorio';

/**
 * Relatório da sessão.
 *
 * Apresenta o que a última rodada mediu. Não dispara o teste: quem dispara é a
 * tela de Configurações, num caminho que resolve geometria, monta a `RunMeta` e
 * deriva o bloco — reproduzir aquilo aqui duplicaria um trecho delicado que já
 * está certo, e duas cópias divergem no primeiro ajuste.
 *
 * O **bloco de medição** aparece somente leitura. Ele é derivado do instante do
 * treino; `registroDaSessao.ts` registra por que deixou de ser digitado:
 * "anotação manual virou `blocoDeMedicao: undefined` em todo relatório". Um
 * campo editável ao lado seria a primeira coisa a ficar vazia de novo.
 */
export const RelatorioDaSessao: React.FC<{
  /** Injetável para teste. */
  resumo?: ResumoDoRelatorio | null;
}> = ({ resumo: injetado }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resumo = injetado !== undefined ? injetado : lerUltimoRelatorio();

  if (!resumo) {
    return (
      <Moldura titulo={t('calib.relatorio.title')}>
        <PrimaryButton type="button" onClick={() => navigate('/settings')}>
          <Crosshair size={18} aria-hidden="true" /> {t('calib.relatorio.rodar')}
        </PrimaryButton>
      </Moldura>
    );
  }

  const { result, meta } = resumo;
  const graus = result.meanErrorDeg;
  const bloco = meta.blocoDeMedicao;
  const origem = meta.screenGeometrySource ?? 'default';

  return (
    <Moldura titulo={t('calib.relatorio.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        <strong style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--color-primary)' }}>
          {graus !== null
            ? t('calib.relatorio.erroGraus', { g: graus.toFixed(2).replace('.', ',') })
            : '—'}
        </strong>
        {result.meanError !== null && (
          <span style={{ fontSize: '0.9rem', opacity: 0.7, color: 'var(--color-text-base)' }}>
            {t('calib.relatorio.erroPx', { px: Math.round(result.meanError) })}
          </span>
        )}
      </div>

      {/* Bloco de medição — derivado, somente leitura. */}
      <Linha icone={<Layers size={17} aria-hidden="true" />}>
        {bloco === undefined || bloco === null
          ? t('calib.relatorio.blocoAusente')
          : bloco === 1
            ? t('calib.relatorio.blocoUm')
            : t('calib.relatorio.bloco', { n: bloco })}
      </Linha>

      {/* A origem da diagonal muda o que o erro em graus significa: calculado
          sobre a diagonal padrão, ele não é comparável com um calculado sobre
          medida real. */}
      <Linha icone={<Monitor size={17} aria-hidden="true" />}>
        {t('calib.relatorio.monitor', {
          pol: meta.telaPolegadas,
          origem: t(`calib.relatorio.origem.${origem}`),
        })}
      </Linha>

      <Linha icone={<Sun size={17} aria-hidden="true" />}>
        {meta.luxAmbiente !== null && meta.luxAmbiente !== undefined
          ? t('calib.relatorio.lux', { lux: meta.luxAmbiente })
          : t('calib.relatorio.semLux')}
      </Linha>

      <PrimaryButton
        type="button"
        onClick={() => exportarResumo(resumo)}
        style={{ alignSelf: 'flex-start' }}
      >
        <FileDown size={18} aria-hidden="true" /> {t('calib.relatorio.exportar')}
      </PrimaryButton>
    </Moldura>
  );
};

const Linha: React.FC<{ icone: React.ReactNode; children: React.ReactNode }> = ({
  icone,
  children,
}) => (
  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
    <span style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 2, display: 'flex' }}>
      {icone}
    </span>
    <span
      style={{
        fontSize: '0.95rem',
        lineHeight: 1.5,
        color: 'var(--color-text-base)',
        opacity: 0.88,
      }}
    >
      {children}
    </span>
  </div>
);

const Moldura: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
  <main
    role="main"
    aria-labelledby="relatorio-title"
    style={{
      minHeight: '100vh',
      background: 'var(--settings-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1.5rem',
    }}
  >
    <div
      className="glass-card"
      style={{
        width: '100%',
        maxWidth: 600,
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
        id="relatorio-title"
        style={{
          margin: 0,
          fontSize: '1.2rem',
          fontWeight: 700,
          opacity: 0.7,
          color: 'var(--color-text-base)',
        }}
      >
        {titulo}
      </h1>
      {children}
      <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start' }}>
        <Info
          size={15}
          color="var(--color-primary)"
          aria-hidden="true"
          style={{ flexShrink: 0, marginTop: 3 }}
        />
        <span
          style={{
            fontSize: '0.82rem',
            lineHeight: 1.5,
            opacity: 0.65,
            color: 'var(--color-text-base)',
          }}
        >
          {/* O relatório completo já foi gravado pelo próprio teste. O botão
              acima reenvia o resumo, que é outra coisa. */}
          O relatório completo é salvo automaticamente ao fim do teste.
        </span>
      </div>
    </div>
  </main>
);
