import React, { useEffect, useRef, useState } from 'react';
import { useGaze, DWELL_SELECTOR } from '../context/GazeContext';
import {
  stepScanning,
  criarEstadoScanning,
  type EstadoScanning,
} from '@tracker/interaction/scanning';
import { EXPERIMENT } from '@tracker/config/experiment';

// -----------------------------------------------------------------------------
// Modo de varredura.
//
// A lógica está em `src/interaction/scanning.ts`, pura e testada. Aqui fica só
// O que é DOM: descobrir quais botões existem, desenhar o destaque, e clicar.
//
// ── O relógio NÃO pode vir do fluxo de amostras ─────────────────────────────
//
// A primeira versão deste componente rodava `stepScanning` dentro do
// `subscribe(...)` de gaze. Parece natural — e destrói a funcionalidade no caso
// exato que ela existe para cobrir.
//
// O engine só emite amostra enquanto `videoEl.currentTime` avança. Câmera
// desconectada, driver travado, aba suspensa, `loopGuard` disparando: o fluxo
// de amostras **para**. Cronometrado por ele, o scanning nunca chega aos 3 s de
// "sem gaze" — porque nem tempo ele consegue contar. O paciente fica com o
// cursor congelado, sem varredura e sem aviso: a falha silenciosa que o Sprint
// 7 inteiro existe para eliminar.
//
// O fallback de último recurso não pode compartilhar relógio com o sistema cuja
// falha ele cobre. Aqui o relógio é um `setInterval` próprio, e as amostras
// apenas ALIMENTAM um ref com o que se sabe e QUANDO se soube.
//
// Nota honesta sobre o limite disto: com a câmera realmente morta não há sinal
// de piscada, então a varredura ativa e destaca mas não tem como ser
// selecionada. Isso continua sendo melhor que congelar em silêncio — o
// movimento na tela e o banner de status dizem ao cuidador que algo aconteceu.
// Recuperar de câmera morta exige uma pessoa; o que não se pode é esconder o
// fato.
//
// ── O seletor é o MESMO do dwell ────────────────────────────────────────────
//
// `DWELL_SELECTOR` é importado do `GazeContext` em vez de reescrito. Uma cópia
// divergiria, e a divergência tem forma ruim: a varredura destacaria um
// elemento que o dwell não considera clicável, o paciente selecionaria algo que
// não responde, e ele não teria como saber se errou o alvo ou se o botão está
// quebrado.
// -----------------------------------------------------------------------------

/** Passo do relógio próprio, em ms. */
const TICK_MS = 100;

/**
 * Idade máxima da última amostra para o gaze contar como vivo, em ms.
 *
 * Generosa de propósito: a 30 fps as amostras chegam a cada ~33 ms, e 400 ms
 * tolera uma dúzia de quadros perdidos sem declarar o gaze morto. O que ela
 * precisa pegar é a PARADA — que é permanente, não um soluço.
 */
const AMOSTRA_VIVA_MS = 400;

/** Itens navegáveis, na ordem em que aparecem no documento. */
function itensNavegaveis(): HTMLElement[] {
  const nos = Array.from(document.querySelectorAll<HTMLElement>(DWELL_SELECTOR));
  return nos.filter((n) => {
    if ((n as HTMLButtonElement).disabled) return false;
    if (n.getAttribute('aria-disabled') === 'true') return false;
    if (n.dataset.noDwell === 'true') return false;

    // ⚠️ EMERGÊNCIA FORA DA VARREDURA.
    //
    // `blinkClick.ts` declara esta guarda como a única não-configurável do
    // módulo: *"o custo de um falso positivo aqui é grande demais, e o dwell
    // longo continua sendo o caminho para a emergência"*. A varredura
    // selecionava por piscada e não aplicava a mesma regra — então a piscada
    // acionava, pela varredura, exatamente o botão que ela tem proibição
    // explícita de acionar.
    //
    // E aqui é pior que no cursor: a varredura percorre os botões sozinha.
    // Basta uma piscada involuntária no instante em que o ciclo passa pela
    // emergência. O paciente não escolheu o alvo — o relógio escolheu por ele.
    if (n.dataset.emergency === 'true') return false;

    // Um botão de 0×0 (colapsado, fora da tela, dentro de um `hidden`) não tem
    // como ser destacado de forma legível — destacar o invisível faria o ciclo
    // parecer travado, sem nada acontecendo na tela por um passo inteiro.
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

interface Destaque {
  left: number;
  top: number;
  width: number;
  height: number;
  rotulo: string;
}

export function ScanningMode(): React.ReactElement | null {
  const { subscribe, state } = useGaze();
  // Lido pelo relógio sem entrar nas deps do efeito: o intervalo é montado uma
  // vez, e remontá-lo a cada troca de estado zeraria o ciclo da varredura.
  const stateRef = useRef(state);
  stateRef.current = state;
  const estadoRef = useRef<EstadoScanning>(criarEstadoScanning());
  const [destaque, setDestaque] = useState<Destaque | null>(null);
  /** Índice destacado no último render — evita `setState` a cada tick. */
  const indiceRenderizadoRef = useRef<number | null>(null);

  /** O que se sabe do gaze, e quando se soube. Alimentado pelas amostras. */
  const ultimaAmostraRef = useRef<{
    ts: number;
    gazeValido: boolean;
    piscando: boolean;
  } | null>(null);

  // As amostras apenas ALIMENTAM o ref. Nenhuma lógica de varredura aqui — ver
  // a nota sobre o relógio no cabeçalho.
  useEffect(() => {
    if (!EXPERIMENT.scanningMode) return;
    return subscribe((sample) => {
      ultimaAmostraRef.current = {
        ts: performance.now(),
        // "Gaze utilizável" — NÃO "o engine está em degraded". Um gatilho
        // pendurado no estado do engine herdaria os modos de falha que nunca
        // alcançam esse estado.
        gazeValido: sample.hasFace
          && sample.degraded !== true
          && sample.uncalibrated !== true,
        piscando: sample.eyeState === 'closed',
      };
    });
  }, [subscribe]);

  // O relógio próprio.
  useEffect(() => {
    if (!EXPERIMENT.scanningMode) return;

    const id = setInterval(() => {
      const now = performance.now();

      // ⚠️ NUNCA durante a calibração.
      //
      // Durante a coleta o `uncalibrated` vale `true`, então `gazeValido` fica
      // `false` e a varredura ligava sozinha depois de 3 s — passando a
      // destacar e clicar os botões da PRÓPRIA tela de calibração enquanto o
      // paciente olha para os pontos. Isso corrompe a coleta e, numa sessão de medição,
      // corromperia em silêncio: o relatório registraria uma calibração
      // concluída, com o modelo treinado sobre dados que uma piscada
      // involuntária interrompeu.
      //
      // O `GazeContext` já aplica esta política ao dwell (só emergência é
      // acionável durante a calibração); a varredura contradizia isso.
      //
      // Fora da calibração, `uncalibrated` NÃO bloqueia a varredura — e a
      // diferença é deliberada. O `dwell` bloqueia tudo nesse estado porque o
      // ponto emitido é o fallback do nariz, e clicar sobre um sinal que não
      // segue o olhar é disparar botão por acaso. A varredura não usa a
      // posição do olhar: ela usa um relógio e uma piscada. O motivo do
      // bloqueio não se aplica a ela.
      if (stateRef.current === 'calibrating') {
        estadoRef.current = criarEstadoScanning();
        if (indiceRenderizadoRef.current !== null) {
          indiceRenderizadoRef.current = null;
          setDestaque(null);
        }
        return;
      }

      const ultima = ultimaAmostraRef.current;
      const amostraViva = ultima !== null && now - ultima.ts < AMOSTRA_VIVA_MS;

      // Sem amostra viva: o gaze não é utilizável (é a definição do gatilho) e
      // não há piscada a reportar — inventar `piscando: true` aqui faria a
      // varredura selecionar sozinha quando a câmera morresse.
      const gazeValido = amostraViva && ultima.gazeValido;
      const piscando = amostraViva && ultima.piscando;

      // ⚠️ A LISTA só é consultada com a varredura ativa ou prestes a ativar.
      //
      // `querySelectorAll` no documento inteiro mais um
      // `getBoundingClientRect()` por nó força layout. Fazer isso a cada quadro
      // de gaze, inclusive com a varredura desligada, colocava um custo de
      // layout no caminho quente — que já estoura o orçamento de 33 ms
      // (`mediapipe` + `quality` + `crop` = 42,3 ms, medido em
      // `docs/LATENCIA_L2CS.md`). Num sprint cujo objeto é MEDIR latência,
      // instrumento que altera o que mede é o pior defeito possível.
      const ativoOuQuaseAtivo =
        estadoRef.current.ativoDesde !== null || !gazeValido;
      const itens = ativoOuQuaseAtivo ? itensNavegaveis() : [];

      const r = stepScanning(estadoRef.current, {
        gazeValido,
        piscando,
        nowMs: now,
        totalItens: itens.length,
      });
      estadoRef.current = r.estado;

      if (!r.ativo || r.indiceDestacado === null) {
        if (indiceRenderizadoRef.current !== null) {
          indiceRenderizadoRef.current = null;
          setDestaque(null);
        }
        return;
      }

      const alvo = itens[r.indiceDestacado];
      if (!alvo) return;

      // Só re-renderiza quando o item MUDA. Antes, um `setDestaque(rect)` por
      // tick criava um objeto novo a cada vez e re-renderizava sempre, mesmo
      // com o destaque parado no mesmo botão por 1,2 s.
      if (indiceRenderizadoRef.current !== r.indiceDestacado) {
        indiceRenderizadoRef.current = r.indiceDestacado;
        const rect = alvo.getBoundingClientRect();
        setDestaque({
          left: rect.left, top: rect.top,
          width: rect.width, height: rect.height,
          rotulo: alvo.getAttribute('aria-label') ?? alvo.textContent?.trim() ?? '',
        });
      }

      if (r.selecionou !== null) {
        // `.click()` de verdade: os handlers sintéticos do React respondem a
        // ele igual a um clique de mouse, que é o mesmo caminho do dwell. Um
        // caminho paralelo de ativação teria bugs próprios, e eles apareceriam
        // só no modo que existe para quando tudo o mais falhou.
        itens[r.selecionou]?.click();
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, []);

  if (!EXPERIMENT.scanningMode || destaque === null) return null;

  return (
    <>
      {/*
        `aria-live="polite"` e não `assertive`: a varredura anuncia um item por
        segundo, e `assertive` interromperia o leitor de tela a cada passo,
        deixando o paciente sem ouvir nenhum nome inteiro.
      */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed', width: 1, height: 1, overflow: 'hidden',
          clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
        }}
      >
        {destaque.rotulo}
      </div>
      <div
        aria-hidden="true"
        data-testid="scanning-highlight"
        style={{
          position: 'fixed',
          left: destaque.left - 6,
          top: destaque.top - 6,
          width: destaque.width + 12,
          height: destaque.height + 12,
          border: '4px solid rgba(250,250,250,0.95)',
          // Anel duplo, mesma razão do cursor: nenhuma cor sozinha
          // contrasta com todos os fundos, e o destaque some justamente sobre
          // o botão cuja cor por acaso combine com ele.
          boxShadow: '0 0 0 4px rgba(17,17,17,0.9), 0 0 24px rgba(0,0,0,0.5)',
          borderRadius: 12,
          pointerEvents: 'none',
          zIndex: 9997,
        }}
      />
    </>
  );
}
