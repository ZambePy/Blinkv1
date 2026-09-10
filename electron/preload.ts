// Ponte mínima para o renderer ler geometria física da tela.
//
// O renderer roda com `contextIsolation: true` e `sandbox: true`. Nesse modo
// o preload ainda tem acesso a `contextBridge` e `ipcRenderer` (subconjunto
// permitido), que é tudo de que precisamos: nenhum módulo de Node vaza para
// a página.
//
// Superfície deliberadamente estreita. Ampliar isto exige justificar por que
// o renderer precisa de mais poder. Hoje são dois grupos:
//   `irisflowSystem` — geometria física da tela (leitura).
//   `irisflowCloud`  — cofre cifrado (safeStorage) para o token da sessão do
//                      Supabase e a chave do computador, mais a identidade do
//                      app. Chaves restritas ao prefixo `irisflow.` no main.
//   `irisflowSystem.desktop` — Modo Computador: liga/desliga a sobreposição
//                      sobre o Windows e manda o olhar para o main (que é
//                      quem move o mouse do sistema). O renderer NÃO tem
//                      acesso a mover/clicar diretamente.
//   `irisflowVoz`    — motor de voz local (clonagem): status, importar
//                      áudio de referência, sintetizar. Áudio e modelo ficam
//                      na pasta de dados do app; nada disto sai do computador.
import { contextBridge, ipcRenderer } from 'electron';
import { CANAIS } from '../src/computador/protocolo';
import type { AmostraDeOlhar, CapacidadesDoSistema, MotivoDeSaida } from '../src/computador/protocolo';
import { CANAIS_VOZ } from '../src/voz/protocolo';
import type { EstadoDoMotorDeVoz, OpcoesDeSintese, ResultadoDaImportacao, ResultadoDaSintese } from '../src/voz/protocolo';

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

  desktop: {
    capacidades: (): Promise<CapacidadesDoSistema> => ipcRenderer.invoke(CANAIS.capacidades),
    iniciar: (pedido: { dwellMs: number; tamanhoCursorPx: number; lupa: boolean }): Promise<{ ok: true } | { ok: false; motivo: string }> =>
      ipcRenderer.invoke(CANAIS.iniciar, pedido),
    parar: (): Promise<void> => ipcRenderer.invoke(CANAIS.parar),
    /** Fluxo contínuo (30–60 Hz): `send`, sem resposta, para não enfileirar promessas. */
    olhar: (amostra: AmostraDeOlhar): void => ipcRenderer.send(CANAIS.olhar, amostra),
    onParou: (cb: (motivo: MotivoDeSaida) => void): (() => void) => {
      const handler = (_e: unknown, motivo: MotivoDeSaida) => cb(motivo);
      ipcRenderer.on(CANAIS.parou, handler);
      return () => ipcRenderer.removeListener(CANAIS.parou, handler);
    },
  },
});

contextBridge.exposeInMainWorld('irisflowVoz', {
  estado: (): Promise<EstadoDoMotorDeVoz> => ipcRenderer.invoke(CANAIS_VOZ.estado),
  onEstado: (cb: (e: EstadoDoMotorDeVoz) => void): (() => void) => {
    const handler = (_e: unknown, estado: EstadoDoMotorDeVoz) => cb(estado);
    ipcRenderer.on(CANAIS_VOZ.estadoMudou, handler);
    return () => ipcRenderer.removeListener(CANAIS_VOZ.estadoMudou, handler);
  },
  /** Abre o seletor de arquivo do sistema e prepara o áudio de referência. */
  importar: (consentimento: { texto: string; aceitoEm: string; perfilId: string | null }): Promise<ResultadoDaImportacao> =>
    ipcRenderer.invoke(CANAIS_VOZ.importar, consentimento),
  remover: (): Promise<void> => ipcRenderer.invoke(CANAIS_VOZ.remover),
  baixarModelo: (): Promise<{ ok: boolean; erro?: string }> => ipcRenderer.invoke(CANAIS_VOZ.baixarModelo),
  sintetizar: (texto: string, opcoes?: OpcoesDeSintese): Promise<ResultadoDaSintese> => ipcRenderer.invoke(CANAIS_VOZ.sintetizar, texto, opcoes ?? {}),
  /** Acorda o motor e consulta status/dispositivo (tela de Voz). */
  sondar: (): Promise<EstadoDoMotorDeVoz> => ipcRenderer.invoke(CANAIS_VOZ.sondar),
  ativar: (ligado: boolean): Promise<void> => ipcRenderer.invoke(CANAIS_VOZ.ativar, ligado),
});

contextBridge.exposeInMainWorld('irisflowCloud', {
  secureGet: (chave: string): Promise<string | null> =>
    ipcRenderer.invoke('irisflow:secure-get', chave),
  secureSet: (chave: string, valor: string): Promise<boolean> =>
    ipcRenderer.invoke('irisflow:secure-set', chave, valor),
  secureRemove: (chave: string): Promise<boolean> =>
    ipcRenderer.invoke('irisflow:secure-remove', chave),
  appInfo: (): Promise<{
    version: string; hostname: string; platform: string; encryptionAvailable: boolean;
  }> => ipcRenderer.invoke('irisflow:app-info'),
});

// Atualização automática: estado para a faixa na tela e o botão de reiniciar.
// A instalação só acontece por este canal (decisão do cuidador) ou ao fechar.
contextBridge.exposeInMainWorld('irisflowAtualizacao', {
  estado: (): Promise<unknown> => ipcRenderer.invoke('irisflow:atualizacao-estado'),
  verificar: (): Promise<boolean> => ipcRenderer.invoke('irisflow:atualizacao-verificar'),
  instalar: (): Promise<boolean> => ipcRenderer.invoke('irisflow:atualizacao-instalar'),
  aoMudar: (cb: (estado: unknown) => void): (() => void) => {
    const ouvinte = (_e: unknown, estado: unknown) => cb(estado);
    ipcRenderer.on('irisflow:atualizacao-mudou', ouvinte);
    return () => ipcRenderer.removeListener('irisflow:atualizacao-mudou', ouvinte);
  },
});
