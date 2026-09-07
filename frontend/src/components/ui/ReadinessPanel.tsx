import React, { useEffect, useRef, useState } from 'react';
import { useGaze } from '../../context/GazeContext';
import { useSettings } from '../../context/SettingsContext';
import { evaluateReadiness, type ReadinessReport } from '@tracker/setupReadiness';
import { snapshotFromDiagnostics, lerViewport } from '@tracker/setupReadinessAdapter';
import { guardarProntidao } from '../../ultimaProntidao';

/**
 * Painel de prontidão do posto de uso.
 *
 * ## Por que este componente existe
 *
 * `evaluateReadiness` e `aggregateSnapshots` estavam escritos, testados e
 * corretos em `src/setupReadiness.ts` — e **não tinham chamador de produção**.
 * O README anuncia "verificação de prontidão ao vivo: distância, enquadramento,
 * postura da cabeça, iluminação, contraste, reflexo em lentes e cintilação,
 * todos medidos e exibidos antes de gastar tempo de coleta com dado ruim", e
 * nada disso chegava ao cuidador.
 *
 * O item mais caro da lista é a checagem de **viewport**: é a única defesa
 * contra rodar a calibração numa janela não-maximizada, que infla o erro
 * angular do relatório. Sem ela, o relatório sai com
 * números que parecem medidos e não são comparáveis com nenhum outro.
 *
 * ## Postura
 *
 * Avisos (`warn`) NÃO bloqueiam — a decisão de prosseguir é do cuidador, que
 * sabe coisas que o software não sabe (o paciente está cansado hoje; a luz vai
 * melhorar em dez minutos). Só `fail` impede.
 *
 * Quando a qualidade ainda não foi medida, o painel diz "medindo…" em vez de
 * emitir veredito —.
 */
export const ReadinessPanel: React.FC<{ onReadyChange?: (ready: boolean) => void }> = ({
  onReadyChange,
}) => {
  const { getDiagnostics } = useGaze();
  const { settings } = useSettings();
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [medindo, setMedindo] = useState(true);

  // `getDiagnostics` e `onReadyChange` vivem em refs, FORA das deps: a
  // identidade de `getDiagnostics` é refeita pelo `useMemo` do GazeContext a
  // cada transição de estado do engine. Nas deps, cada uma dessas transições
  // destruía e recriava o intervalo — e numa sessão com o rosto entrando e
  // saindo o painel nunca completava um ciclo, ficando em "Medindo as
  // condições…" para sempre, justamente na tela onde o cuidador decide se
  // pode começar.
  const diagRef = useRef(getDiagnostics);
  diagRef.current = getDiagnostics;
  const readyCbRef = useRef(onReadyChange);
  readyCbRef.current = onReadyChange;
  const fovRef = useRef(settings.cameraHorizontalFovDeg);
  fovRef.current = settings.cameraHorizontalFovDeg;
  useEffect(() => {
    // 2 Hz: a avaliação é barata, mas atualizar a 30 Hz faria os textos
    // piscarem e ninguém consegue ler.
    const id = setInterval(() => {
      const d = diagRef.current();
      if (!d) return;
      const snap = snapshotFromDiagnostics(d, lerViewport());
      if (!snap) {
        setMedindo(true);
        return;
      }
      setMedindo(false);
      // Sem o FOV a checagem de distancia nao devolve centimetros e cai na
      // fracao do frame. `cameraHorizontalFovDeg` ja vem preenchido por
      // padrao — os centimetros eram calculaveis o tempo todo e simplesmente
      // nao chegavam a esta tela.
      const r = evaluateReadiness(snap, {
        horizontalFovDeg: fovRef.current,
      });
      setReport(r);
      // O relatório de precisão lê daqui para gravar iluminação, postura e
      // óculos MEDIDOS em vez dos valores hardcoded que saíam antes.
      guardarProntidao(r);
      readyCbRef.current?.(r.canStart);
    }, 500);
    return () => clearInterval(id);
  }, []);

  if (medindo || !report) {
    return (
      <div style={{ fontSize: '1rem', opacity: 0.7, padding: '0.5rem 0' }}>
        Medindo as condições do posto de uso…
      </div>
    );
  }

  const cor = (s: string) =>
    s === 'fail' ? '#ef4444' : s === 'warn' ? '#f59e0b' : '#22c55e';
  const icone = (s: string) => (s === 'fail' ? '✕' : s === 'warn' ? '!' : '✓');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        padding: '0.75rem 1rem',
        borderRadius: '0.75rem',
        background: 'rgba(255,255,255,0.04)',
        maxWidth: '46rem',
      }}
    >
      {report.checks.map((c) => (
        <div key={c.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
          <span aria-hidden="true" style={{ color: cor(c.status), fontWeight: 700, width: '1rem' }}>
            {icone(c.status)}
          </span>
          <span style={{ fontSize: '1rem', color: c.status === 'ok' ? 'inherit' : cor(c.status) }}>
            {c.message}
          </span>
        </div>
      ))}
      {report.blockedHard && (
        <div style={{ marginTop: '0.4rem', color: '#ef4444', fontWeight: 700 }}>
          Corrija os itens acima antes de calibrar.
        </div>
      )}
    </div>
  );
};
