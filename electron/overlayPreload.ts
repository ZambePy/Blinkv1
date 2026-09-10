// Ponte da janela de SOBREPOSIÇÃO do Modo Computador.
//
// A sobreposição é a página que desenha o cursor e a barra de ações por cima
// do Windows. Ela não tem câmera nem motor: recebe o olhar já convertido pelo
// processo principal e devolve ações. Três funções, nada mais — e cada ação
// ainda passa pela validação de forma e de remetente no main.
import { contextBridge, ipcRenderer } from 'electron';
import { CANAIS } from '../src/computador/protocolo';
import type { AcaoDoSistema, AmostraDeOlhar, ConfiguracaoDoModo, RespostaDaAcao } from '../src/computador/protocolo';

contextBridge.exposeInMainWorld('irisflowOverlay', {
  onOlhar: (cb: (a: AmostraDeOlhar) => void): (() => void) => {
    const handler = (_e: unknown, a: AmostraDeOlhar) => cb(a);
    ipcRenderer.on(CANAIS.sobreposicaoOlhar, handler);
    return () => ipcRenderer.removeListener(CANAIS.sobreposicaoOlhar, handler);
  },
  onConfig: (cb: (c: ConfiguracaoDoModo) => void): (() => void) => {
    const handler = (_e: unknown, c: ConfiguracaoDoModo) => cb(c);
    ipcRenderer.on(CANAIS.sobreposicaoConfig, handler);
    return () => ipcRenderer.removeListener(CANAIS.sobreposicaoConfig, handler);
  },
  acao: (a: AcaoDoSistema): Promise<RespostaDaAcao> => ipcRenderer.invoke(CANAIS.sobreposicaoAcao, a),
});
