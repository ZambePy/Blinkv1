import type { AcaoDoSistema, AmostraDeOlhar, ConfiguracaoDoModo, RespostaDaAcao } from '@tracker/computador/protocolo';

/** O que o preload da sobreposição (`electron/overlayPreload.ts`) expõe. */
export interface PonteDaSobreposicao {
  onOlhar: (cb: (a: AmostraDeOlhar) => void) => () => void;
  onConfig: (cb: (c: ConfiguracaoDoModo) => void) => () => void;
  acao: (a: AcaoDoSistema) => Promise<RespostaDaAcao>;
}

/**
 * Lê a ponte da janela. Fora do Electron (uma aba do navegador aberta em
 * `/overlay.html` por curiosidade, ou o teste) devolve uma ponte inerte, para
 * a página não lançar antes de dizer o que é.
 */
export function pontePara(w: Window): PonteDaSobreposicao {
  const real = (w as unknown as { irisflowOverlay?: PonteDaSobreposicao }).irisflowOverlay;
  if (real) return real;
  return {
    onOlhar: () => () => {},
    onConfig: () => () => {},
    acao: async () => ({ ok: false, erro: 'Fora do Electron.' }),
  };
}
