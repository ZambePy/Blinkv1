// Configuração de sessão de medição pela URL: a condição inteira (provider,
// tamanho do L2CS, filtro, diagonal) cabe numa URL copiável e registrável
// junto do relatório. `EXPERIMENT` é resolvido uma vez no import, então a
// página recarrega — só quando algum valor mudou de fato.

const CHAVE_EXP = 'irisflow.experiment';
const CHAVE_SETTINGS = 'irisflow_settings';

const PROVIDERS = ['auto', 'wasm', 'webgpu', 'off'] as const;
const TAMANHOS_L2CS = [224, 448];
const FILTROS = ['oneEuro', 'kalman', 'kalmanEma'] as const;

function lerJson(chave: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(chave);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o)
      ? (o as Record<string, unknown>)
      : {};
  } catch {
    // localStorage ilegível não pode derrubar o boot: sem app, o operador não
    // tem como consertar a configuração que quebrou o app.
    return {};
  }
}

/**
 * Aplica `?ep=`, `?l2cs=`, `?filtro=` e `?diagonal=` ao armazenamento local.
 *
 * Devolve `true` quando alguma coisa mudou e a página precisa recarregar.
 * Valores inválidos são IGNORADOS com aviso — nunca aplicados parcialmente,
 * porque uma condição meio aplicada é pior que nenhuma: o relatório
 * registraria a condição pedida e o pipeline rodaria outra.
 */
export function aplicarSessaoDaUrl(
  busca: string = window.location.search,
  hash: string = typeof window !== 'undefined' ? window.location.hash : '',
): boolean {
  // Aceita `?a=1` e `#/rota?a=1` (HashRouter). Roda antes do render, então
  // `hash`/`busca` ausentes não podem derrubar o boot.
  const h = hash ?? '';
  const b = busca ?? '';
  const iq = h.indexOf('?');
  const p = new URLSearchParams(
    iq >= 0 ? `${h.slice(iq + 1)}&${b.replace(/^\?/, '')}` : b,
  );
  let mudou = false;

  const exp = lerJson(CHAVE_EXP);
  const expAntes = JSON.stringify(exp);

  const ep = p.get('ep');
  if (ep !== null) {
    if ((PROVIDERS as readonly string[]).includes(ep)) exp.l2cs = ep;
    else console.warn(`[sessão] ?ep=${ep} inválido — aceitos: ${PROVIDERS.join(', ')}.`);
  }

  const l2cs = p.get('l2cs');
  if (l2cs !== null) {
    const n = Number(l2cs);
    if (TAMANHOS_L2CS.includes(n)) exp.l2csInputSize = n;
    else console.warn(`[sessão] ?l2cs=${l2cs} inválido — aceitos: ${TAMANHOS_L2CS.join(', ')}.`);
  }

  const filtro = p.get('filtro');
  if (filtro !== null) {
    if ((FILTROS as readonly string[]).includes(filtro)) exp.filterMode = filtro;
    else console.warn(`[sessão] ?filtro=${filtro} inválido — aceitos: ${FILTROS.join(', ')}.`);
  }

  // Cursor visível durante o teste de precisão. Diagnóstico do operador, não
  // condição de medida: a rodada deixa de ser comparável (ver a nota da flag
  // em `config/experiment.ts`). Aceita `1`/`0` para poder ser DESligada pela
  // mesma URL que ligou — a flag mora no localStorage e sobrevive ao reload.
  const cursorNoTeste = p.get('cursorNoTeste');
  if (cursorNoTeste !== null) {
    if (cursorNoTeste === '1' || cursorNoTeste === '0') {
      exp.cursorNoTesteDePrecisao = cursorNoTeste === '1';
    } else {
      console.warn(`[sessão] ?cursorNoTeste=${cursorNoTeste} inválido — aceitos: 1, 0.`);
    }
  }

  // Compensação de translação lateral da cabeça (M4 do plano de medição).
  // Ganhou parâmetro de URL pelo mesmo motivo dos outros: a alternativa era
  // `__irisflowExp.set` no console seguido de reload, e esquecer o reload roda
  // a condição anterior inteira sob o rótulo da nova — o erro mais provável do
  // dia de medição, e o que a checagem de condição do preflight não pega.
  const compTranslacao = p.get('compTranslacao');
  if (compTranslacao !== null) {
    if (compTranslacao === '1' || compTranslacao === '0') {
      exp.lateralTranslationCompensation = compTranslacao === '1';
    } else {
      console.warn(`[sessão] ?compTranslacao=${compTranslacao} inválido — aceitos: 1, 0.`);
    }
  }

  if (JSON.stringify(exp) !== expAntes) {
    localStorage.setItem(CHAVE_EXP, JSON.stringify(exp));
    mudou = true;
  }

  const diagonal = p.get('diagonal');
  if (diagonal !== null) {
    const n = Number(diagonal);
    if (Number.isFinite(n) && n > 0) {
      const s = lerJson(CHAVE_SETTINGS);
      // `'manual'` porque quem escreveu a URL AFIRMOU o valor. É a mesma
      // procedência de digitar no campo, e distinta do default — que significa
      // "ninguém verificou".
      if (s.screenDiagonalIn !== n || s.screenGeometrySource !== 'manual') {
        s.screenDiagonalIn = n;
        s.screenGeometrySource = 'manual';
        s.schemaVersion = 1;
        localStorage.setItem(CHAVE_SETTINGS, JSON.stringify(s));
        mudou = true;
      }
    } else {
      console.warn(`[sessão] ?diagonal=${diagonal} inválido — precisa ser um número > 0.`);
    }
  }

  return mudou;
}
