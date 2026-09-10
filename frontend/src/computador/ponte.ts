import type { AmostraDeOlhar, CapacidadesDoSistema, MotivoDeSaida } from '@tracker/computador/protocolo';

/** `window.irisflowSystem.desktop`, exposto pelo preload do Electron. */
export interface PonteDoModoComputador {
  capacidades: () => Promise<CapacidadesDoSistema>;
  iniciar: (pedido: { dwellMs: number; tamanhoCursorPx: number; lupa: boolean }) => Promise<{ ok: true } | { ok: false; motivo: string }>;
  parar: () => Promise<void>;
  olhar: (amostra: AmostraDeOlhar) => void;
  onParou: (cb: (motivo: MotivoDeSaida) => void) => () => void;
}

/** `null` fora do Electron (navegador puro): a tela explica em vez de falhar. */
export function ponteDoModoComputador(w: Window = window): PonteDoModoComputador | null {
  const sys = (w as unknown as { irisflowSystem?: { desktop?: PonteDoModoComputador } }).irisflowSystem;
  return sys?.desktop ?? null;
}

/** Texto para o cuidador, por motivo de saída. `null` quando não há o que dizer. */
export function mensagemDeSaida(motivo: MotivoDeSaida): string | null {
  switch (motivo) {
    case 'voltar':
      return null;
    case 'emergencia':
      return null;
    case 'inatividade':
      return 'O Modo Computador foi encerrado por inatividade: o olhar não foi encontrado por alguns minutos.';
    case 'tela_mudou':
      return 'A configuração da tela mudou (resolução, escala ou monitor). Recalibre antes de voltar ao Modo Computador.';
    case 'janela_fechada':
      return 'A sobreposição foi fechada.';
    case 'rastreamento_parou':
      return 'O rastreamento parou de responder e o Modo Computador foi encerrado por segurança. Confira a câmera e tente de novo.';
    case 'sem_calibracao':
      return 'O olhar chegou sem calibração por tempo demais: nada seria clicável. Calibre e tente de novo.';
    case 'atalho':
      return 'Encerrado pelo atalho do teclado (Ctrl+Alt+Shift+Esc).';
    case 'erro':
      return 'O Modo Computador foi encerrado por um erro. Se repetir, reinicie o IrisFlow.';
  }
}
