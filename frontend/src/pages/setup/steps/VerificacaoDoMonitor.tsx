import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, AlertCircle } from 'lucide-react';
import { Semaforo } from '../../../components/ui/Semaforo';
import { Cabecalho } from './EscolhaDaCamera';

/**
 * Confirmação do tamanho do monitor.
 *
 * Deste número sai a conversão de pixels para graus no relatório de precisão.
 * Um erro angular calculado sobre uma diagonal chutada é um número com cara de
 * medido que não é comparável com nenhum outro — e ninguém consegue detectar
 * isso lendo o relatório depois.
 *
 * Daí a regra dura: **quando o EDID não responde, o campo fica vazio.**
 * Preencher 24" "porque a maioria é 24" seria pior do que não ter tela nenhuma,
 * porque cria confiança onde não há informação.
 */

/** Faixa plausível de monitor de mesa. Fora disso é engano de digitação. */
const MIN_POLEGADAS = 10;
const MAX_POLEGADAS = 60;

export interface VerificacaoDoMonitorProps {
  /** Diagonal lida do EDID, em polegadas. `null` = o sistema não informou. */
  diagonalDoEdid: number | null;
  aoMudar: (polegadas: number | null, origem: 'edid' | 'manual') => void;
}

/** Aceita vírgula: é como se digita decimal em português. */
function analisar(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (n < MIN_POLEGADAS || n > MAX_POLEGADAS) return null;
  return n;
}

export const VerificacaoDoMonitor: React.FC<VerificacaoDoMonitorProps> = ({
  diagonalDoEdid,
  aoMudar,
}) => {
  const { t } = useTranslation();
  const [texto, setTexto] = useState(diagonalDoEdid !== null ? String(diagonalDoEdid) : '');
  const [tocado, setTocado] = useState(false);

  const valor = analisar(texto);
  const origem: 'edid' | 'manual' = tocado || diagonalDoEdid === null ? 'manual' : 'edid';
  const invalido = texto.trim() !== '' && valor === null;

  // Reporta ao wizard a cada mudança, inclusive no primeiro render: sem isto o
  // passo começaria sem valor mesmo com o EDID tendo respondido.
  useEffect(() => {
    aoMudar(valor, origem);
    // `aoMudar` fora das deps de propósito: o wizard recria a função a cada
    // render, e incluí-la aqui produziria um laço de atualização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor, origem]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
      <Cabecalho titulo={t('setup.monitor.title')} lead={t('setup.monitor.lead')} />

      {diagonalDoEdid !== null ? (
        <Semaforo
          status="ok"
          titulo={t('setup.monitor.fromEdid', { polegadas: diagonalDoEdid })}
          detalhe={t('setup.monitor.fromEdidConfirm')}
        />
      ) : (
        <Semaforo
          status="warn"
          titulo={t('setup.monitor.noEdid')}
          detalhe={t('setup.monitor.noEdidWhy')}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <label
          htmlFor="monitor-diagonal"
          style={{
            fontSize: '0.9rem',
            fontWeight: 700,
            opacity: 0.9,
            color: 'var(--color-text-base)',
          }}
        >
          {t('setup.monitor.diagonalLabel')}
        </label>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span
            aria-hidden="true"
            style={{ position: 'absolute', left: '0.9rem', display: 'flex', pointerEvents: 'none' }}
          >
            <Monitor size={19} color="#64748b" />
          </span>
          <input
            id="monitor-diagonal"
            type="text"
            inputMode="decimal"
            value={texto}
            onChange={(e) => {
              setTocado(true);
              setTexto(e.target.value);
            }}
            placeholder={t('setup.monitor.diagonalPlaceholder')}
            style={{
              background: 'var(--field-bg)',
              border: `1px solid ${invalido ? 'var(--tint-danger-border)' : 'var(--field-border)'}`,
              borderRadius: '0.9rem',
              padding: '0.9rem 0.9rem 0.9rem 2.9rem',
              fontSize: '1rem',
              width: '100%',
              color: 'var(--color-text-base)',
            }}
          />
        </div>

        {invalido && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.88rem',
              color: 'var(--tint-danger-text)',
            }}
          >
            <AlertCircle size={16} aria-hidden="true" />
            <span>{t('setup.monitor.invalid')}</span>
          </div>
        )}
      </div>
    </div>
  );
};
