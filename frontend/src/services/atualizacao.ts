/**
 * Ponte com o atualizador do Electron (electron/atualizacao.ts).
 *
 * No navegador (desenvolvimento, testes) não há ponte: tudo aqui devolve
 * "inativa" e o restante do app não sabe que existe atualização — que é o
 * comportamento certo, já que não há o que atualizar.
 */

export type EstadoDaAtualizacao =
  | { fase: 'inativa'; motivo: string }
  | { fase: 'verificando' }
  | { fase: 'em_dia'; versao: string }
  | { fase: 'baixando'; versao: string; progresso: number }
  | { fase: 'pronta'; versao: string }
  | { fase: 'erro'; mensagem: string };

interface PonteDaAtualizacao {
  estado(): Promise<EstadoDaAtualizacao | null>;
  verificar(): Promise<boolean>;
  instalar(): Promise<boolean>;
  aoMudar(cb: (estado: EstadoDaAtualizacao) => void): () => void;
}

function ponte(): PonteDaAtualizacao | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { irisflowAtualizacao?: PonteDaAtualizacao }).irisflowAtualizacao ?? null;
}

export const ESTADO_SEM_PONTE: EstadoDaAtualizacao = { fase: 'inativa', motivo: 'fora do Electron' };

export async function estadoDaAtualizacao(): Promise<EstadoDaAtualizacao> {
  const p = ponte();
  if (!p) return ESTADO_SEM_PONTE;
  try {
    return (await p.estado()) ?? ESTADO_SEM_PONTE;
  } catch {
    return ESTADO_SEM_PONTE;
  }
}

/** Devolve a função que cancela a escuta. Sem ponte, não escuta nada. */
export function ouvirAtualizacao(cb: (estado: EstadoDaAtualizacao) => void): () => void {
  const p = ponte();
  if (!p) return () => undefined;
  try {
    return p.aoMudar(cb);
  } catch {
    return () => undefined;
  }
}

export async function instalarAtualizacao(): Promise<boolean> {
  const p = ponte();
  if (!p) return false;
  try {
    return await p.instalar();
  } catch {
    return false;
  }
}

export async function verificarAtualizacao(): Promise<boolean> {
  const p = ponte();
  if (!p) return false;
  try {
    return await p.verificar();
  } catch {
    return false;
  }
}

/** O que a faixa mostra para cada fase — `null` é "não mostra nada". */
export function textoDaFaixa(estado: EstadoDaAtualizacao): { titulo: string; acao: 'reiniciar' | null } | null {
  switch (estado.fase) {
    case 'baixando':
      return { titulo: `Baixando a versão ${estado.versao}… ${estado.progresso}%`, acao: null };
    case 'pronta':
      return { titulo: `Nova versão ${estado.versao} pronta`, acao: 'reiniciar' };
    default:
      // "verificando", "em_dia", "erro" e "inativa" não interrompem ninguém:
      // ficam em Ajustes, para quem quiser saber.
      return null;
  }
}
