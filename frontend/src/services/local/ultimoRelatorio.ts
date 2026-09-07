import type { AccuracyResult, RunMeta } from '@tracker/accuracy';

/**
 * Último relatório de precisão, para a tela de relatório apresentar.
 *
 * ## Por que persistir, em vez de passar por rota
 *
 * O disparo do teste (`startAccuracyTest`) resolve geometria, monta a `RunMeta`,
 * deriva o bloco e registra no histórico clínico. Reproduzir isso numa tela
 * nova duplicaria um caminho delicado que já está certo e comentado — e duas
 * cópias divergem no primeiro ajuste.
 *
 * Então quem roda continua rodando, grava aqui, e a tela lê. Sobrevive a um
 * reload, que `location.state` não faria.
 *
 * ## Isto NÃO é o relatório
 *
 * O relatório canônico (`schema: irisflow.accuracy-report/2`) é escrito pelo
 * próprio `startAccuracyTest`, na raiz do projeto ou no download do navegador.
 * O que fica aqui é o resumo que a tela mostra, e o que o botão de exportar
 * reenvia — marcado com schema próprio para ninguém confundir os dois numa
 * análise posterior.
 */

const CHAVE = 'irisflow_ultimo_relatorio';

export const SCHEMA_DO_RESUMO = 'irisflow.accuracy-summary/1';

export interface ResumoDoRelatorio {
  schema: typeof SCHEMA_DO_RESUMO;
  /** ISO 8601. */
  em: string;
  result: AccuracyResult;
  meta: RunMeta;
}

export function gravarUltimoRelatorio(result: AccuracyResult, meta: RunMeta): void {
  try {
    const resumo: ResumoDoRelatorio = {
      schema: SCHEMA_DO_RESUMO,
      em: new Date().toISOString(),
      result,
      meta,
    };
    localStorage.setItem(CHAVE, JSON.stringify(resumo));
  } catch {
    // Sem persistência a tela de relatório fica vazia. Chato, e muito melhor
    // que derrubar a tela logo depois de uma medição que levou minutos.
  }
}

export function lerUltimoRelatorio(): ResumoDoRelatorio | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const o = JSON.parse(bruto) as Partial<ResumoDoRelatorio>;
    if (o.schema !== SCHEMA_DO_RESUMO || !o.result || !o.meta) return null;
    return o as ResumoDoRelatorio;
  } catch {
    return null;
  }
}

/** Baixa o resumo. O relatório canônico já foi salvo pelo teste. */
export function exportarResumo(resumo: ResumoDoRelatorio): void {
  const blob = new Blob([JSON.stringify(resumo, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `irisflow-resumo-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
