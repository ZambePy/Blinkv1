// Registro da sessão de medição.
//
// O número do bloco ficava para anotação manual, e "anotação manual" virou
// `blocoDeMedicao: undefined` em todo relatório — sem ele a sessão de dois
// blocos não pode ser lida depois: não há como saber qual rodada é a de logo
// após calibrar e qual é a de 10 minutos depois.
//
// Aqui o número é DERIVADO do instante do treino, sem ninguém digitar.

const CHAVE = 'irisflow.registroDaSessao';

export interface RegistroDaSessao {
  /** Instante do treino a que a contagem de blocos se refere. */
  calibTs: number | null;
  /** Quantas rodadas já aconteceram contra `calibTs`. */
  execucoes: number;
}

const VAZIO: RegistroDaSessao = {
  calibTs: null,
  execucoes: 0,
};

function numeroOuNulo(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function lerRegistroDaSessao(): RegistroDaSessao {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return { ...VAZIO };
    const o = JSON.parse(bruto) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ...VAZIO };
    return {
      calibTs: numeroOuNulo(o.calibTs),
      execucoes: numeroOuNulo(o.execucoes) ?? 0,
    };
  } catch {
    // Storage ilegível (JSON quebrado, modo privado, cota) não pode derrubar
    // uma sessão de medição: sem registro é pior, sem app é inaceitável.
    return { ...VAZIO };
  }
}

export function gravarRegistroDaSessao(campos: Partial<RegistroDaSessao>): void {
  const atual = lerRegistroDaSessao();
  const novo: RegistroDaSessao = { ...atual, ...campos };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(novo));
  } catch {
    // idem: perder o registro não pode perder a sessão.
  }
}

/**
 * Número do bloco desta rodada, INCREMENTANDO a contagem.
 *
 * Chamar uma vez por rodada, no instante em que o teste começa.
 *
 * `calibTs` é `getCalibrationTimestampMs()`. Quando ele muda — recalibração,
 * ou ativação de outro perfil salvo — a contagem recomeça em 1, porque a
 * comparação entre blocos só vale dentro do MESMO modelo treinado.
 *
 * `null` quando não há calibração: um teste rodado sem modelo não pertence a
 * bloco nenhum, e marcá-lo como "1" o faria parecer comparável com uma rodada
 * de verdade.
 */
export function proximoBloco(calibTs: number | null): number | null {
  if (calibTs === null || !Number.isFinite(calibTs)) return null;
  const r = lerRegistroDaSessao();
  const execucoes = r.calibTs === calibTs ? r.execucoes + 1 : 1;
  gravarRegistroDaSessao({ calibTs, execucoes });
  return execucoes;
}

/** Zera a contagem de blocos. */
export function limparContagemDeBlocos(): void {
  gravarRegistroDaSessao({ calibTs: null, execucoes: 0 });
}
