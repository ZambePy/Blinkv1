/**
 * Referência da checagem de retomada.
 *
 * A primeira checagem feita contra uma calibração estabelece o número com que
 * todas as próximas serão comparadas. É o que permite um veredito **relativo**,
 * em vez de um limiar absoluto — que não seria honesto com os dados que
 * existem: seis sessões de um setup só, com erro entre 1,86° e 3,74°.
 *
 * **Amarrada ao `calibTs`.** Quando a calibração muda, a referência antiga não
 * vale: comparar a checagem de hoje contra um número tirado do modelo anterior
 * mediria a diferença entre dois modelos, não a deriva do posto de uso — e o
 * veredito falaria de uma coisa achando que fala de outra.
 *
 * Só uma referência vale por vez, pelo mesmo motivo: guardar um histórico delas
 * criaria a tentação de comparar contra a calibração errada.
 */

export const CHAVE_DA_REFERENCIA = 'irisflow_referencia_checagem';

export interface ReferenciaDaChecagem {
  /** A calibração a que esta referência pertence. */
  calibTs: number;
  erroDeg: number;
  /** ISO 8601. */
  em: string;
}

export function lerReferencia(calibTs: number | null): ReferenciaDaChecagem | null {
  if (calibTs === null || !Number.isFinite(calibTs)) return null;

  try {
    const bruto = localStorage.getItem(CHAVE_DA_REFERENCIA);
    if (!bruto) return null;

    const o = JSON.parse(bruto) as Partial<ReferenciaDaChecagem>;
    if (typeof o.calibTs !== 'number' || typeof o.erroDeg !== 'number') return null;

    // A amarração: referência de outra calibração é como se não existisse.
    if (o.calibTs !== calibTs) return null;

    return { calibTs: o.calibTs, erroDeg: o.erroDeg, em: o.em ?? new Date(0).toISOString() };
  } catch {
    return null;
  }
}

export function gravarReferencia(calibTs: number | null, erroDeg: number): void {
  if (calibTs === null || !Number.isFinite(calibTs)) return;

  // Medição que falhou não pode virar a referência contra a qual todas as
  // próximas serão julgadas. E 0° é implausível: viraria uma referência que
  // reprova tudo para sempre.
  if (!Number.isFinite(erroDeg) || erroDeg <= 0) return;

  try {
    const r: ReferenciaDaChecagem = { calibTs, erroDeg, em: new Date().toISOString() };
    localStorage.setItem(CHAVE_DA_REFERENCIA, JSON.stringify(r));
  } catch {
    // Sem persistência, toda checagem vira a primeira — e nenhuma reprova.
    // Degrada para inofensivo, que é o lado certo de falhar aqui.
  }
}

export function limparReferencia(): void {
  try {
    localStorage.removeItem(CHAVE_DA_REFERENCIA);
  } catch {
    /* idem */
  }
}
