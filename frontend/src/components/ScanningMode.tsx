import React, { useEffect, useRef, useState } from 'react';
import { useGaze, DWELL_SELECTOR } from '../context/GazeContext';
import {
  stepScanning,
  criarEstadoScanning,
  type EstadoScanning,
} from '@tracker/interaction/scanning';
import { EXPERIMENT } from '@tracker/config/experiment';

// Modo de varredura. A lógica está em `src/interaction/scanning.ts`, pura e
// testada; aqui fica só o que é DOM: descobrir os botões, desenhar o destaque
// e clicar.
//
// O relógio é um `setInterval` próprio, NÃO o fluxo de amostras de gaze: o
// engine só emite enquanto `videoEl.currentTime` avança, e a varredura existe
// justamente para quando esse fluxo para (câmera desconectada, aba suspensa,
// `loopGuard`). Cronometrada por ele, nunca chegaria aos 3 s de "sem gaze".
// As amostras apenas alimentam um ref com o que se sabe e quando se soube.
//
// Limite conhecido: com a câmera morta não há sinal de piscada, então a
// varredura destaca mas não seleciona. Ainda é melhor que congelar em silêncio.
//
// `DWELL_SELECTOR` é importado do `GazeContext` em vez de copiado: uma cópia
// divergente faria a varredura destacar algo que o dwell não clica.

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

    // Emergência fica FORA da varredura, pela mesma regra de `blinkClick.ts`:
    // o ciclo percorre os botões sozinho, e uma piscada involuntária no
    // instante em que passa pela emergência dispararia o botão sem escolha do
    // paciente. O dwell longo continua sendo o caminho para a emergência.
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

      // Nunca durante a calibração: na coleta `uncalibrated` é `true`, logo
      // `gazeValido` é `false` e a varredura ligaria sozinha depois de 3 s,
      // clicando os botões da própria tela de calibração. Mesma política que o
      // `GazeContext` aplica ao dwell.
      //
      // Fora da calibração, `uncalibrated` NÃO bloqueia a varredura, de
      // propósito: o dwell bloqueia porque o ponto é o fallback do nariz, mas a
      // varredura não usa posição — usa relógio e piscada.
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

      // A lista só é montada com a varredura ativa ou prestes a ativar:
      // `querySelectorAll` + `getBoundingClientRect()` por nó força layout, e
      // fazer isso a cada tick com a varredura desligada é custo puro.
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

      // Só re-renderiza quando o item MUDA: um `setDestaque(rect)` por tick
      // criaria um objeto novo a cada vez, mesmo com o destaque parado.
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
        className="scan-highlight"
        style={{
          left: destaque.left - 6,
          top: destaque.top - 6,
          width: destaque.width + 12,
          height: destaque.height + 12,
        }}
      />
    </>
  );
}
