// Ponte mínima para o renderer ler geometria física da tela.
//
// O renderer roda com `contextIsolation: true` e `sandbox: true`. Nesse modo
// o preload ainda tem acesso a `contextBridge` e `ipcRenderer` (subconjunto
// permitido), que é tudo de que precisamos: nenhum módulo de Node vaza para
// a página.
//
// Superfície deliberadamente estreita — uma função, sem argumentos, só
// leitura. Ampliar isto exige justificar por que o renderer precisa de mais
// poder.
import { contextBridge, ipcRenderer } from 'electron';

export interface PhysicalPanelSizeIPC {
  widthCm: number;
  heightCm: number;
}

contextBridge.exposeInMainWorld('irisflowSystem', {
  /** Dimensões físicas dos monitores conectados, do EDID. Lista vazia quando
   *  o SO não informa (não-Windows, EDID ausente, driver genérico). */
  getMonitorSizes: (): Promise<PhysicalPanelSizeIPC[]> =>
    ipcRenderer.invoke('irisflow:monitor-sizes'),
  /** Resolução e fator de escala da tela primária, do SO. `window.screen` do
   *  renderer não expõe a escala do Windows, e ela altera a relação px→cm. */
  getDisplayInfo: (): Promise<{
    widthPx: number; heightPx: number; scaleFactor: number;
    physicalWidthPx: number; physicalHeightPx: number;
  }> => ipcRenderer.invoke('irisflow:display-info'),
});
