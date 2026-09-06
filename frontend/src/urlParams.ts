// Leitura de parâmetro de URL que funciona com `HashRouter`.
//
// O app usa `HashRouter` (sob `file://` no Electron, `BrowserRouter` dá tela
// branca em qualquer reload). Com ele, `useSearchParams` só lê a query DEPOIS
// do `#` — e `http://localhost:5173/?debug=1`, o formato que todo mundo
// digita, ficaria silenciosamente ignorado. Aceitamos as duas formas; a query
// do hash tem precedência porque é a que o react-router considera canônica.

/** Lê um parâmetro tanto de `?a=1` quanto de `#/rota?a=1`. */
export function lerParametroDeUrl(
  nome: string,
  loc: { search: string; hash: string } = window.location,
): string | null {
  const iq = loc.hash.indexOf('?');
  if (iq >= 0) {
    const doHash = new URLSearchParams(loc.hash.slice(iq + 1)).get(nome);
    if (doHash !== null) return doHash;
  }
  return new URLSearchParams(loc.search).get(nome);
}
