import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, OctagonX, ChevronLeft, ChevronRight } from 'lucide-react';
import { lerParametroDeUrl } from '../urlParams';
import { useGaze } from '../context/GazeContext';
import { useSettings } from '../context/SettingsContext';
import { preflight, podeComecar, type ItemPreflight } from '@tracker/diagnostics/preflight';
import { EXPERIMENT } from '@tracker/config/experiment';
import { medicaoEmAndamento } from '../medicaoEmAndamento';
import { snapshotDe, itensDeProntidao } from '../readinessDoDiagnostico';
import type { ReadinessSnapshot } from '@tracker/setupReadiness';

// -----------------------------------------------------------------------------
// Painel de verificação pré-sessão, NA TELA (ferramenta do operador).
//
// O caminho pelo console exigia abrir o DevTools, que ancorado na lateral
// comia ~900 px de viewport e invalidava o próprio preflight. Aqui não há
// console: uma URL (`?preflight=1`), a janela maximizada, e o veredito na tela.
// -----------------------------------------------------------------------------

const ICONE = {
  ok: CheckCircle2,
  atencao: AlertTriangle,
  bloqueio: OctagonX,
} as const;

/** Mede a taxa de rAF em ~30 quadros. */
function medirHz(): Promise<number | null> {
  return new Promise((resolve) => {
    const t: number[] = [];
    const passo = () => {
      t.push(performance.now());
      if (t.length <= 30) requestAnimationFrame(passo);
      else {
        const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
        resolve(dt > 0 ? 1000 / dt : null);
      }
    };
    requestAnimationFrame(passo);
  });
}

export const PreflightPanel: React.FC = () => {
  // Com `HashRouter`, o `useSearchParams` não enxerga a query antes do `#`.
  const ativo = lerParametroDeUrl('preflight') === '1';
  const { getDiagnostics, state, calibration } = useGaze();
  const { settings } = useSettings();
  const [itens, setItens] = useState<ItemPreflight[] | null>(null);
  const [rodando, setRodando] = useState(false);
  const [recolhido, setRecolhido] = useState(false);

  const rodar = useCallback(async () => {
    const d = getDiagnostics();
    if (!d) {
      setItens(null);
      return;
    }
    setRodando(true);

    // Janela de prontidão: ~2 s de snapshots coletados DURANTE a medição de
    // hz. Um quadro só não serve — iluminação e contraste são ruidosos, e o
    // reflexo persistente de lente só existe no agregado.
    const janela: ReadinessSnapshot[] = [];
    const coleta = setInterval(() => {
      const atual = getDiagnostics();
      if (atual) janela.push(snapshotDe(atual));
    }, 100);
    const hz = await medirHz();
    await new Promise((r) => setTimeout(r, 1500));
    clearInterval(coleta);

    const prontidao = itensDeProntidao(janela, settings.cameraHorizontalFovDeg ?? null).itens;
    setItens([
      ...preflight({
        estadoEngine: state,
        calibrado: calibration.isCalibrated(),
        telaPolegadas: settings.screenDiagonalIn,
        origemGeometria: settings.screenGeometrySource ?? 'default',
        distanciaCm: settings.viewingDistanceCm,
        viewportPx: {
          w: document.documentElement.clientWidth,
          h: document.documentElement.clientHeight,
        },
        telaPx: { w: window.screen.width, h: window.screen.height },
        taxaAtualizacaoHz: hz,
        fpsRender: d.fpsRender,
        videoPx: { w: d.video.width, h: d.video.height },
        l2cs: {
          status: d.l2cs.status,
          executionProvider: d.l2cs.executionProvider ?? null,
          stalePct: d.l2cs.stalePct,
          pendingCount: d.l2cs.pendingCount,
          hz: d.l2cs.hz,
        },
        filtro: d.filtro,
        flags: EXPERIMENT as unknown as Record<string, unknown>,
      }),
      ...prontidao,
    ]);
    setRodando(false);
  }, [getDiagnostics, state, calibration, settings]);

  // Roda sozinho depois de 12 s — tempo de o fps estabilizar e o modelo
  // acumular inferências. Antes disso dá falso negativo.
  useEffect(() => {
    if (!ativo) return;
    const id = setTimeout(() => {
      void rodar();
    }, 12000);
    return () => clearTimeout(id);
  }, [ativo, rodar]);

  if (!ativo) return null;

  // Some durante calibração e teste de precisão: os dois desenham alvos nas
  // bordas, e este painel ocupa o canto inferior esquerdo, em cima de um deles.
  if (medicaoEmAndamento(state)) return null;

  if (recolhido) {
    return (
      <button
        type="button"
        data-no-dwell="true"
        onClick={() => setRecolhido(false)}
        className="preflight__toggle"
      >
        preflight <ChevronRight size={12} aria-hidden="true" style={{ verticalAlign: 'middle' }} />
      </button>
    );
  }

  const bloqueado = itens !== null && !podeComecar(itens);
  const estadoClasse = itens === null ? '' : bloqueado ? 'preflight--blocked' : 'preflight--ok';

  return (
    <div data-no-dwell="true" className={`preflight ${estadoClasse}`.trim()}>
      <div className="preflight__head">
        <strong className="preflight__title">Verificação pré-sessão</strong>
        <span className="preflight__actions">
          <button
            type="button"
            data-no-dwell="true"
            onClick={() => setRecolhido(true)}
            title="Recolher: os alvos do teste de precisão ficam nas bordas"
            className="preflight__btn"
          >
            <ChevronLeft size={12} aria-hidden="true" style={{ verticalAlign: 'middle' }} />{' '}
            recolher
          </button>
          <button
            type="button"
            data-no-dwell="true"
            onClick={() => {
              void rodar();
            }}
            disabled={rodando}
            className="preflight__btn"
          >
            {rodando ? 'medindo…' : 'verificar'}
          </button>
        </span>
      </div>

      {itens === null && (
        <div className="preflight__hint">
          Aguardando ~12 s para o fps estabilizar e o modelo acumular inferências. Fique com o rosto
          na câmera.
        </div>
      )}

      {itens?.map((i) => {
        const Icone = ICONE[i.nivel];
        return (
          <div key={i.item} className={`preflight__item preflight__item--${i.nivel}`}>
            <div>
              <Icone size={13} aria-hidden="true" style={{ verticalAlign: 'text-bottom' }} />{' '}
              <strong>{i.item}</strong> — {i.detalhe}
            </div>
            {i.acao && <div className="preflight__action">{i.acao}</div>}
          </div>
        );
      })}

      {itens !== null && (
        <div
          className={`preflight__verdict ${bloqueado ? 'preflight__verdict--blocked' : 'preflight__verdict--ok'}`}
        >
          {bloqueado ? 'NÃO COMECE — resolva os itens acima e verifique de novo.' : 'PODE COMEÇAR.'}
        </div>
      )}
    </div>
  );
};
