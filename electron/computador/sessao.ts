/**
 * Sessão do Modo Computador, no processo principal.
 *
 * Enquanto o modo está ligado:
 *   - a janela do app fica ESCONDIDA (a câmera e o motor continuam rodando
 *     nela — `backgroundThrottling: false` é o que impede o Chromium de
 *     congelar o `requestAnimationFrame` de uma janela oculta);
 *   - uma janela de SOBREPOSIÇÃO transparente, sempre no topo e atravessável
 *     pelo mouse cobre o monitor: é ela que desenha o cursor pequeno, o anel
 *     de dwell e a barra lateral de ações;
 *   - cada amostra de olhar da janela do app passa por aqui, é convertida
 *     para o sistema de coordenadas da sobreposição (`geometria.ts`) e
 *     reenviada; cada ação decidida pela sobreposição volta por aqui, é
 *     convertida para pixels físicos e executada no `ControleDoSistema`.
 *
 * O processo principal é a fronteira de confiança: tudo que chega por IPC é
 * validado em forma e em REMETENTE (só a janela do app manda olhar; só a
 * sobreposição manda ação). A lupa usa `desktopCapturer` — a sobreposição
 * está marcada com `setContentProtection(true)`, então não aparece na própria
 * captura.
 */

import { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, type Display, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  janelaParaSobreposicao,
  sobreposicaoParaTela,
  telaParaFisicoAproximado,
  regiaoDaLupa,
  type Ponto,
  type QuadroDeTela,
} from '../../src/computador/geometria';
import { ehTeclaNomeada } from '../../src/computador/entradaWindows';
import {
  CANAIS,
  acaoValida,
  amostraValida,
  type AcaoDoSistema,
  type AmostraDeOlhar,
  type CapacidadesDoSistema,
  type ConfiguracaoDoModo,
  type MotivoDeSaida,
  type RespostaDaAcao,
} from '../../src/computador/protocolo';
import { controleDoSistema, type ControleDoSistema } from './controle';

export interface OpcoesDoModo {
  /** Janela do app (a que tem a câmera). */
  janelaPrincipal: () => BrowserWindow | null;
  /** Como carregar a página da sobreposição neste build. */
  carregarSobreposicao: (janela: BrowserWindow) => Promise<void>;
  /** Preload da sobreposição (compilado ao lado do main). */
  preloadDaSobreposicao: string;
}

interface Sessao {
  sobreposicao: BrowserWindow;
  principal: BrowserWindow;
  quadro: QuadroDeTela;
  idDoMonitor: number;
  controle: ControleDoSistema;
  config: ConfiguracaoDoModo;
  /** Última amostra válida — a lupa e o cursor precisam dela. */
  ultimaAmostra: AmostraDeOlhar | null;
  /** Ponto do último `pressionar`, para interpolar o arrasto até o `soltar`. */
  pressionadoEm: Ponto | null;
  /** Relógio do vigia: quando chegou a última amostra e desde quando vem sem calibração. */
  ultimaAmostraEm: number;
  semCalibracaoDesde: number | null;
  vigia: NodeJS.Timeout | null;
  /** Para desligar os ouvintes da janela principal ao sair. */
  desligar: Array<() => void>;
  encerrando: boolean;
}

/** Sem amostra por este tempo, o motor travou ou a câmera caiu: sai. */
const VIGIA_SEM_AMOSTRA_MS = 6_000;
/** Amostras sem calibração por este tempo: nada é clicável, nem a barra: sai. */
const VIGIA_SEM_CALIBRACAO_MS = 10_000;
/** Atalho do CUIDADOR para encerrar o modo com o teclado físico. */
const ATALHO_DE_SAIDA = 'CommandOrControl+Alt+Shift+Escape';
/** Passos e intervalo do arrasto interpolado (o Explorer exige movimento com o botão preso). */
const ARRASTO_PASSOS = 12;
const ARRASTO_INTERVALO_MS = 16;

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pedido de início vindo do app. Tudo o mais o main decide. */
interface PedidoDeInicio {
  dwellMs: number;
  tamanhoCursorPx: number;
  lupa: boolean;
}

function pedidoValido(v: unknown): v is PedidoDeInicio {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.dwellMs === 'number' && p.dwellMs >= 300 && p.dwellMs <= 5000 &&
    typeof p.tamanhoCursorPx === 'number' && p.tamanhoCursorPx >= 16 && p.tamanhoCursorPx <= 64 &&
    typeof p.lupa === 'boolean'
  );
}

export function registrarModoComputador(opcoes: OpcoesDoModo): { parar: (motivo: MotivoDeSaida) => void } {
  let sessao: Sessao | null = null;

  const capacidades = (): CapacidadesDoSistema => controleDoSistema().capacidades();

  /** DIP da tela → físico, com a conversão nativa quando o SO oferece. */
  const paraFisico = (telaDip: Ponto, quadro: QuadroDeTela): Ponto => {
    const nativo = (screen as unknown as { dipToScreenPoint?: (p: Ponto) => Ponto }).dipToScreenPoint;
    if (typeof nativo === 'function') {
      try {
        return nativo.call(screen, { x: Math.round(telaDip.x), y: Math.round(telaDip.y) });
      } catch { /* cai na aproximação */ }
    }
    return telaParaFisicoAproximado(telaDip, quadro);
  };

  const moverPara = (s: Sessao, pontoNaSobreposicao: Ponto): Ponto => {
    const tela = sobreposicaoParaTela(pontoNaSobreposicao, s.quadro);
    const fis = paraFisico(tela, s.quadro);
    s.controle.mover(fis.x, fis.y);
    return fis;
  };

  /**
   * Arrasto: o Windows só inicia um arrastar-e-soltar quando o cursor se MOVE
   * com o botão preso (além do limiar de arrasto) e dá tempo ao `DoDragDrop`.
   * Um salto seco de origem para destino é lido como clique.
   */
  const arrastarAte = async (s: Sessao, destino: Ponto): Promise<void> => {
    const origem = s.pressionadoEm;
    if (!origem) { moverPara(s, destino); return; }
    for (let i = 1; i <= ARRASTO_PASSOS; i++) {
      const f = i / ARRASTO_PASSOS;
      moverPara(s, { x: origem.x + (destino.x - origem.x) * f, y: origem.y + (destino.y - origem.y) * f });
      await esperar(ARRASTO_INTERVALO_MS);
    }
  };

  async function capturarLupa(s: Sessao, ponto: Ponto, raioPx: number): Promise<RespostaDaAcao> {
    const centro = sobreposicaoParaTela(ponto, s.quadro);
    const regiao = regiaoDaLupa(centro, raioPx, s.quadro.monitor);
    const escala = s.quadro.escala;
    if (s.sobreposicao.isDestroyed()) return { ok: false, erro: 'Sessão encerrada.' };
    const fontes = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(s.quadro.monitor.width * escala),
        height: Math.round(s.quadro.monitor.height * escala),
      },
    });
    // A fonte tem de ser ESTE monitor. Sem `display_id` (X11 costuma devolver
    // vazio) só dá para confiar quando há um monitor só; senão, melhor não
    // ampliar do que ampliar a tela errada.
    const fonte = fontes.find((f) => f.display_id === String(s.idDoMonitor))
      ?? (fontes.length === 1 && screen.getAllDisplays().length === 1 ? fontes[0] : undefined);
    if (!fonte) return { ok: false, erro: 'Não foi possível capturar a tela deste monitor para a lupa.' };
    // Escala real da miniatura: o SO pode devolver um tamanho diferente do pedido.
    const tam = fonte.thumbnail.getSize();
    const ex = tam.width / s.quadro.monitor.width;
    const ey = tam.height / s.quadro.monitor.height;
    if (!(ex > 0) || !(ey > 0)) return { ok: false, erro: 'Captura vazia.' };
    const recorte = fonte.thumbnail.crop({
      x: Math.round((regiao.x - s.quadro.monitor.x) * ex),
      y: Math.round((regiao.y - s.quadro.monitor.y) * ey),
      width: Math.round(regiao.width * ex),
      height: Math.round(regiao.height * ey),
    });
    // A região volta em coordenadas da SOBREPOSIÇÃO: é nesse sistema que a
    // sobreposição vai mapear o segundo olhar de volta.
    return {
      ok: true,
      lupa: {
        imagem: recorte.toDataURL(),
        regiao: { ...regiao, x: regiao.x - s.quadro.monitor.x, y: regiao.y - s.quadro.monitor.y },
      },
    };
  }

  async function executar(s: Sessao, acao: AcaoDoSistema): Promise<RespostaDaAcao> {
    switch (acao.tipo) {
      case 'mover':
        moverPara(s, acao.ponto);
        return { ok: true };
      case 'clique':
        moverPara(s, acao.ponto);
        s.controle.clicar(acao.botao, acao.vezes);
        return { ok: true };
      case 'pressionar':
        moverPara(s, acao.ponto);
        s.controle.pressionar(acao.botao);
        s.pressionadoEm = acao.ponto;
        return { ok: true };
      case 'soltar':
        await arrastarAte(s, acao.ponto);
        s.controle.soltar(acao.botao);
        s.pressionadoEm = null;
        return { ok: true };
      case 'rolar':
        moverPara(s, acao.ponto);
        s.controle.rolar(acao.passos);
        return { ok: true };
      case 'digitar':
        s.controle.digitar(acao.texto);
        return { ok: true };
      case 'tecla':
        if (!ehTeclaNomeada(acao.nome)) return { ok: false, erro: 'Tecla desconhecida.' };
        s.controle.tecla(acao.nome);
        return { ok: true };
      case 'lupa':
        return capturarLupa(s, acao.ponto, acao.raioPx);
      case 'pronto':
        return { ok: true, config: s.config };
      case 'capturarMouse':
        // Atravessável por padrão; deixa de ser só enquanto o mouse físico
        // está sobre a barra, para o cuidador poder clicar em "IrisFlow".
        if (!s.sobreposicao.isDestroyed()) {
          if (acao.ligado) s.sobreposicao.setIgnoreMouseEvents(false);
          else s.sobreposicao.setIgnoreMouseEvents(true, { forward: true });
        }
        return { ok: true };
      case 'sair':
        parar(acao.motivo);
        return { ok: true };
    }
  }

  function parar(motivo: MotivoDeSaida): void {
    const s = sessao;
    if (!s || s.encerrando) return;
    s.encerrando = true;
    sessao = null;
    screen.removeListener('display-metrics-changed', aoMudarTela);
    screen.removeListener('display-removed', aoMudarTela);
    if (s.vigia) clearInterval(s.vigia);
    for (const d of s.desligar) { try { d(); } catch { /* já foi */ } }
    try { globalShortcut.unregister(ATALHO_DE_SAIDA); } catch { /* não registrado */ }
    try { s.controle.liberarTudo(); } catch { /* melhor esforço */ }
    if (!s.sobreposicao.isDestroyed()) s.sobreposicao.destroy();
    const principal = opcoes.janelaPrincipal();
    if (principal && !principal.isDestroyed()) {
      principal.show();
      principal.focus();
      principal.webContents.send(CANAIS.parou, motivo);
    }
    console.log(`[computador] modo encerrado (${motivo})`);
  }

  // Só o que invalida a calibração: geometria ou escala do monitor. A barra de
  // tarefas mudando de tamanho (`workArea`) não é motivo para sair.
  const aoMudarTela = (_e: unknown, _display?: Display, mudou?: string[]) => {
    if (Array.isArray(mudou) && !mudou.some((m) => m === 'bounds' || m === 'scaleFactor' || m === 'rotation')) return;
    parar('tela_mudou');
  };

  async function iniciar(evento: IpcMainInvokeEvent, pedido: unknown): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const principal = opcoes.janelaPrincipal();
    if (!principal || evento.sender !== principal.webContents) return { ok: false, motivo: 'Origem não autorizada.' };
    if (!pedidoValido(pedido)) return { ok: false, motivo: 'Pedido inválido.' };
    if (sessao) return { ok: true };

    const controle = controleDoSistema();
    const cap = controle.capacidades();
    if (!cap.suportado) return { ok: false, motivo: cap.motivo ?? 'Não suportado neste sistema.' };

    const janela = principal.getContentBounds();
    const display = screen.getDisplayMatching(janela);
    const quadro: QuadroDeTela = { janela, monitor: display.bounds, escala: display.scaleFactor };

    const sobreposicao = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      // +1: uma janela transparente EXATAMENTE do tamanho do monitor é tratada
      // pelo Windows como tela cheia e perde a transparência (fica preta). A
      // linha extra fica fora da tela.
      height: display.bounds.height + 1,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      show: false,
      enableLargerThanScreen: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: opcoes.preloadDaSobreposicao,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    sobreposicao.setAlwaysOnTop(true, 'screen-saver');
    // Atravessável, mas recebendo `mousemove`: é o que permite à barra saber
    // que o mouse físico entrou nela e pedir para capturar cliques.
    sobreposicao.setIgnoreMouseEvents(true, { forward: true });
    sobreposicao.setContentProtection(true);
    sobreposicao.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    sobreposicao.setMenuBarVisibility(false);
    sobreposicao.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const config: ConfiguracaoDoModo = {
      dwellMs: pedido.dwellMs,
      tamanhoCursorPx: pedido.tamanhoCursorPx,
      lupa: pedido.lupa && cap.lupa,
      monitor: { width: display.bounds.width, height: display.bounds.height },
      plataforma: process.platform,
    };

    const s: Sessao = {
      sobreposicao, principal, quadro, idDoMonitor: display.id, controle, config,
      ultimaAmostra: null, pressionadoEm: null,
      ultimaAmostraEm: Date.now(), semCalibracaoDesde: null, vigia: null, desligar: [], encerrando: false,
    };
    sessao = s;

    sobreposicao.on('closed', () => { if (sessao === s) parar('janela_fechada'); });
    sobreposicao.webContents.on('render-process-gone', () => { if (sessao === s) parar('erro'); });
    // A janela do app fechou, o renderer morreu ou navegou para fora: o olhar
    // deixa de vir e ninguém ouviria o `parou` — encerra por aqui.
    const aoFecharPrincipal = () => { if (sessao === s) parar('janela_fechada'); };
    const aoCairPrincipal = () => { if (sessao === s) parar('erro'); };
    principal.on('closed', aoFecharPrincipal);
    principal.webContents.on('render-process-gone', aoCairPrincipal);
    principal.webContents.on('did-navigate', aoCairPrincipal);
    s.desligar.push(() => {
      if (principal.isDestroyed()) return;
      principal.removeListener('closed', aoFecharPrincipal);
      principal.webContents.removeListener('render-process-gone', aoCairPrincipal);
      principal.webContents.removeListener('did-navigate', aoCairPrincipal);
    });

    try {
      await opcoes.carregarSobreposicao(sobreposicao);
    } catch (e) {
      console.error('[computador] falha ao carregar a sobreposição', e);
      parar('erro');
      return { ok: false, motivo: 'A sobreposição não carregou.' };
    }
    if (sessao !== s) return { ok: false, motivo: 'Encerrado durante o início.' };

    sobreposicao.webContents.send(CANAIS.sobreposicaoConfig, config);
    sobreposicao.showInactive();
    principal.hide();

    screen.on('display-metrics-changed', aoMudarTela);
    screen.on('display-removed', aoMudarTela);

    // Vigia: sem amostra (motor travou, câmera caiu) ou sem calibração (nada
    // clicável, nem a barra) o paciente não teria como sair — sai por ele.
    s.ultimaAmostraEm = Date.now();
    s.vigia = setInterval(() => {
      if (sessao !== s) return;
      const agora = Date.now();
      if (agora - s.ultimaAmostraEm > VIGIA_SEM_AMOSTRA_MS) { parar('rastreamento_parou'); return; }
      if (s.semCalibracaoDesde !== null && agora - s.semCalibracaoDesde > VIGIA_SEM_CALIBRACAO_MS) parar('sem_calibracao');
    }, 1000);

    // Saída pelo teclado físico, para o cuidador. Falha em silêncio se outro
    // programa já tiver o atalho — a barra continua sendo o caminho principal.
    try {
      if (!globalShortcut.register(ATALHO_DE_SAIDA, () => parar('atalho'))) {
        console.warn(`[computador] atalho ${ATALHO_DE_SAIDA} indisponível`);
      }
    } catch (e) {
      console.warn('[computador] não foi possível registrar o atalho de saída', e);
    }
    console.log(`[computador] modo iniciado em ${display.bounds.width}×${display.bounds.height} @${display.scaleFactor}× (${process.platform})`);
    return { ok: true };
  }

  function aoReceberOlhar(evento: IpcMainEvent, amostra: unknown): void {
    const s = sessao;
    if (!s) return;
    const principal = opcoes.janelaPrincipal();
    if (!principal || evento.sender !== principal.webContents) return;
    if (!amostraValida(amostra)) return;
    const p = janelaParaSobreposicao(amostra, s.quadro);
    const convertida: AmostraDeOlhar = { ...amostra, x: p.x, y: p.y };
    s.ultimaAmostra = convertida;
    s.ultimaAmostraEm = Date.now();
    if (amostra.uncalibrated) s.semCalibracaoDesde ??= Date.now();
    else s.semCalibracaoDesde = null;
    if (!s.sobreposicao.isDestroyed()) s.sobreposicao.webContents.send(CANAIS.sobreposicaoOlhar, convertida);
  }

  async function aoReceberAcao(evento: IpcMainInvokeEvent, acao: unknown): Promise<RespostaDaAcao> {
    const s = sessao;
    if (!s) return { ok: false, erro: 'Modo Computador não está ativo.' };
    if (evento.sender !== s.sobreposicao.webContents) return { ok: false, erro: 'Origem não autorizada.' };
    if (!acaoValida(acao)) return { ok: false, erro: 'Ação inválida.' };
    try {
      return await executar(s, acao);
    } catch (e) {
      console.error('[computador] ação falhou', acao.tipo, e);
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  }

  ipcMain.handle(CANAIS.capacidades, () => capacidades());
  ipcMain.handle(CANAIS.iniciar, iniciar);
  ipcMain.handle(CANAIS.parar, (evento) => {
    const principal = opcoes.janelaPrincipal();
    if (principal && evento.sender === principal.webContents) parar('voltar');
  });
  ipcMain.on(CANAIS.olhar, aoReceberOlhar);
  ipcMain.handle(CANAIS.sobreposicaoAcao, aoReceberAcao);

  return { parar };
}
