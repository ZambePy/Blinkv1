// Cliente do worker L2CS (E4 do L2CS-NET.md).
// Responsabilidades:
//   1. Instanciar o Web Worker uma única vez.
//   2. Throttling da cadência (10 Hz por default — o gaze angular muda devagar).
//   3. Cache do último resultado válido + carimbo temporal.
//   4. Degradação graciosa: se o último resultado ficou stale, valid = false.
// O engine.ts NUNCA espera pelo worker; ele consulta getLatestGaze() no rAF
// e segue a vida se valid === false (o bloco de E5 vai a zero nesse caso).

import type { L2CSGaze, L2CSModelMeta, L2CSWorkerRequest, L2CSWorkerResponse } from './types';
import { EXPERIMENT } from '../config/experiment';

export interface L2CSClientOptions {
  modelUrl?: string;
  metaUrl?: string;
  cadenceMs?: number;
  staleMs?: number;
}

export interface L2CSClient {
  start(): Promise<void>;
  stop(): void;
  submitTensor(tensor: Float32Array): boolean;
  // Retorna true se um submitTensor agora seria aceito (throttle satisfeito
  // + worker pronto). Permite ao caller pular o preprocessamento pesado
  // (crop 448 + normalização ImageNet) quando o worker vai descartar mesmo.
  canSubmit(nowMs?: number): boolean;
  getLatestGaze(nowMs?: number): L2CSGaze;
  isReady(): boolean;
  getMeta(): L2CSModelMeta | null;
  getAverageLatencyMs(): number;
  /** Execution provider EFETIVAMENTE ativo no worker (P5.5). `null` antes do
   *  `ready`. É o campo que impede uma medição comparar wasm contra wasm. */
  getExecutionProvider(): string | null;
  // Média rolling das confidences (entropia softmax) das últimas ~20
  // inferências. 0 = incerteza total ou nenhum resultado ainda.
  getAverageConfidence(): number;
  /** Quantas inferências estão em voo (submetidas, sem resposta). Com o
   *  backpressure de B1.2 o valor fica em {0, 1}; expor o número (em vez de um
   *  booleano) permite ao diagnóstico detectar se o teto de concorrência mudar
   *  no futuro, e evidencia deadlock (preso em 1 com o L2CS mudo). */
  getPendingCount(): number;
}

const DEFAULT_MODEL_URL = '/models/l2cs/l2cs_gaze360.onnx';
const DEFAULT_META_URL = '/models/l2cs/l2cs.meta.json';
/**
 * Idade máxima (desde a CAPTURA) que um gaze pode ter e ainda valer (B2.1).
 *
 * Era 1500 ms. Com `l2csCadenceMs = 100`, isso são **15 cadências** de
 * tolerância para um sinal que ocupa 2 das 6 dimensões do vetor de features —
 * 33% da entrada do modelo. O plano pede ~3× a cadência real.
 *
 * 400 ms cobre uma inferência lenta (o worker single-thread com ResNet-50
 * @448² fica em 300–600 ms) sem deixar passar dado de vários frames atrás.
 * Fica generoso o bastante para não zerar o L2CS em máquinas lentas, e
 * apertado o bastante para o `l2csFramesStale` do diagnóstico voltar a
 * significar alguma coisa.
 *
 * Provisório: o número definitivo sai de `P5.5`, que mede a latência real por
 * execution provider. Até lá, a instrumentação de `T0.5`
 * (`stageLatency['l2cs.read']`) mostra se este teto está sendo atingido.
 */
export const DEFAULT_STALE_MS = 400;

export function createL2CSClient(opts: L2CSClientOptions = {}): L2CSClient {
  const modelUrl = opts.modelUrl ?? DEFAULT_MODEL_URL;
  const metaUrl = opts.metaUrl ?? DEFAULT_META_URL;
  const cadenceMs = opts.cadenceMs ?? EXPERIMENT.l2csCadenceMs;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;

  let worker: Worker | null = null;
  let ready = false;
  let meta: L2CSModelMeta | null = null;
  /** Provider que o worker de fato ativou (P5.5). `null` antes do `ready`.
   *  Registrado para que a medição nunca compare wasm contra wasm achando que
   *  comparou GPU contra CPU. */
  let executionProviderAtivo: string | null = null;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((e: Error) => void) | null = null;
  let readyPromise: Promise<void> | null = null;

  let lastSubmitMs = 0;
  let pendingId = 0;
  /**
   * Inferências submetidas e ainda sem resposta: `id → hora da CAPTURA`.
   *
   * Duas responsabilidades, uma estrutura:
   *
   * **B1.2 (backpressure)** — a presença da chave marca "em voo". É um Map, e
   * não um contador, porque decrementar às cegas em cada `result` deixava o
   * contador ir a negativo quando o worker respondia duas vezes o mesmo id ou
   * respondia um id de uma sessão anterior. Contador negativo faz
   * `canSubmit()` liberar submissões para sempre, reintroduzindo o vazamento
   * pela porta dos fundos.
   *
   * **B2.1 (staleness)** — o VALOR é o `performance.now()` do momento da
   * submissão, isto é, a hora em que o frame foi capturado. O resultado é
   * carimbado com esse número, não com a hora em que a resposta chegou.
   * Antes, `latest.timestamp = performance.now()` no handler fazia todo
   * resultado nascer "recém-medido": com respostas chegando em cadência
   * regular, o intervalo entre CHEGADAS é sempre ~400 ms, então o staleness
   * jamais disparava — mesmo quando o frame descrito tinha 30 s. Um gaze de
   * 30 s atrás alimentava `tan(yaw)`/`tan(pitch)`, 2 das 6 dimensões do
   * modelo, com `l2csFramesStale` reportando 0%.
   *
   * Teto de concorrência atual: 1. O worker roda WASM single-thread, então
   * mais de uma inferência em voo só produz fila, nunca paralelismo.
   */
  const inFlight = new Map<number, number>();
  const MAX_IN_FLIGHT = 1;
  let latest: L2CSGaze = { yaw: 0, pitch: 0, timestamp: 0, valid: false };
  let recentLatencies: number[] = [];
  // Confidences dos últimos N resultados válidos, para expor média no
  // diagnóstico. Mesma janela de 20 amostras usada para latência.
  let recentConfidences: number[] = [];

  function post(msg: L2CSWorkerRequest, transfer?: Transferable[]): void {
    if (!worker) return;
    if (transfer && transfer.length > 0) worker.postMessage(msg, transfer);
    else worker.postMessage(msg);
  }

  function handleMessage(ev: MessageEvent<L2CSWorkerResponse>): void {
    const msg = ev.data;
    if (msg.type === 'ready') {
      ready = true;
      meta = msg.meta;
      executionProviderAtivo = msg.executionProvider;
      if (msg.executionProvider !== msg.requested) {
        // Não deveria acontecer (pedimos lista unitária), mas se acontecer é
        // exatamente o caso que invalida uma medição — tem que gritar.
        console.error(
          `[L2CS] execution provider pedido '${msg.requested}' mas ativo '${msg.executionProvider}'. ` +
          'Qualquer medição comparando providers está INVÁLIDA.',
        );
      }
      readyResolve?.();
      readyResolve = null;
      readyReject = null;
    } else if (msg.type === 'init_error') {
      const err = new Error(`L2CS init: ${msg.error}`);
      console.error('[L2CS]', err);
      readyReject?.(err);
      readyResolve = null;
      readyReject = null;
    } else if (msg.type === 'result') {
      // B2.1 — a hora da CAPTURA vem do mapa, não do relógio de agora.
      const capturaMs = inFlight.get(msg.id);
      // B1.2 — libera o slot ANTES de qualquer outra coisa. Se uma exceção
      // acontecesse no processamento abaixo, o slot ficaria preso e o L2CS
      // ficaria mudo pelo resto da sessão.
      inFlight.delete(msg.id);
      if (capturaMs === undefined) {
        // Resultado sem submissão conhecida: worker respondendo um id de uma
        // sessão anterior, ou respondendo duas vezes. Sem hora de captura não
        // há como julgar a idade do dado — e carimbar `performance.now()`
        // aqui é exatamente o bug B2.1. Descartar é a única opção honesta.
        console.warn(`[L2CS] resultado com id desconhecido (${msg.id}) descartado — sem hora de captura.`);
        return;
      }
      latest = {
        yaw: msg.yaw,
        pitch: msg.pitch,
        timestamp: capturaMs,
        valid: true,
        confidence: msg.confidence,
      };
      recentLatencies.push(msg.inferenceMs);
      if (recentLatencies.length > 20) recentLatencies.shift();
      recentConfidences.push(msg.confidence);
      if (recentConfidences.length > 20) recentConfidences.shift();
    } else if (msg.type === 'infer_error') {
      // B1.2 — o slot precisa ser liberado TAMBÉM em erro. Sem isto, um único
      // erro de inferência (tensor corrompido, sessão ORT caída) prenderia
      // `inFlight` em 1 e nenhuma submissão passaria mais — um modo de falha
      // silencioso pior que o vazamento que este bug corrige.
      inFlight.delete(msg.id);
      // Não invalidamos o cache — mantemos o último valor enquanto ele ainda
      // for fresh; se ficar stale, valid cai para false naturalmente.
      console.warn('[L2CS] infer error:', msg.error);
    }
  }

  return {
    async start(): Promise<void> {
      if (worker) return readyPromise ?? Promise.resolve();
      worker = new Worker(new URL('./l2cs.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', (e) => {
        console.error('[L2CS] Worker execution error:', e.message, e.filename, e.lineno);
        readyReject?.(new Error('Worker execution error: ' + e.message));
      });

      readyPromise = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      post({ type: 'init', modelUrl, metaUrl, executionProvider: EXPERIMENT.l2csExecutionProvider });
      return readyPromise;
    },

    stop(): void {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      ready = false;
      meta = null;
      readyPromise = null;
      readyResolve = null;
      readyReject = null;
      latest = { yaw: 0, pitch: 0, timestamp: 0, valid: false };
      recentConfidences = [];
      // B1.2 — sem isto, um start() posterior herdaria o slot ocupado da
      // sessão anterior (o worker foi terminado e nunca vai responder aquele
      // id), e o L2CS nasceria mudo na segunda sessão.
      inFlight.clear();
    },

    canSubmit(nowMs?: number): boolean {
      if (!ready || !worker) return false;
      // B1.2 — backpressure. Enquanto houver inferência em voo, recusa.
      //
      // Esta é a condição que faltava. A cadência sozinha permite 10
      // submissões/s (`l2csCadenceMs = 100`), mas o worker single-thread
      // consome ~2–3/s com ResNet-50 @448². A diferença virava fila: cada
      // mensagem retém 3·448·448·4 B ≈ 2,3 MiB, ~16 MiB/s monotônicos, ~1 GB
      // em 60 s de calibração.
      //
      // Vem ANTES do teste de cadência de propósito: o engine consulta
      // `canSubmit()` para decidir se vale gastar ~5 ms em getImageData +
      // crop 448², e não faz sentido pagar esse custo para descobrir depois
      // que o slot está ocupado.
      if (inFlight.size >= MAX_IN_FLIGHT) return false;
      const now = nowMs ?? performance.now();
      return now - lastSubmitMs >= cadenceMs;
    },

    // Throttled por cadência E por backpressure — devolve false se o worker
    // não está pronto, se ainda não passou o intervalo de cadência, ou se já
    // há inferência em voo. O caller pode ignorar o retorno; é um hint para
    // telemetria (quantos frames o L2CS aceitou vs ignorou).
    submitTensor(tensor: Float32Array): boolean {
      if (!ready || !worker) return false;
      // Mesma guarda de `canSubmit`, repetida aqui de propósito: o engine
      // chama as duas em sequência, mas nada impede um caller futuro de
      // chamar só `submitTensor`. Deixar a barreira só no `canSubmit` faria
      // o backpressure depender da disciplina do chamador.
      if (inFlight.size >= MAX_IN_FLIGHT) return false;
      const now = performance.now();
      if (now - lastSubmitMs < cadenceMs) return false;
      lastSubmitMs = now;
      const id = ++pendingId;
      // B2.1 — `now` é a hora da captura deste frame. É o que vai carimbar o
      // resultado quando ele voltar, por mais tempo que leve.
      inFlight.set(id, now);
      // Transfere o buffer para o worker para evitar cópia (o caller não
      // pode reusar o tensor depois — deve alocar um novo por submissão).
      post({ type: 'infer', id, tensor, width: 0, height: 0 }, [tensor.buffer]);
      return true;
    },

    getLatestGaze(nowMs?: number): L2CSGaze {
      const now = nowMs ?? performance.now();
      if (!latest.valid) return latest;
      if (now - latest.timestamp > staleMs) {
        // Stale — confiança não faz mais sentido (o valor de referência
        // envelheceu), então retorna undefined explícito no lugar de
        // propagar um número que o consumidor confundiria com "medido agora".
        return { yaw: 0, pitch: 0, timestamp: latest.timestamp, valid: false };
      }
      return latest;
    },

    isReady(): boolean {
      return ready;
    },

    getMeta(): L2CSModelMeta | null {
      return meta;
    },
    /** Provider ativo, ou `null` antes do `ready` (P5.5). */
    getExecutionProvider(): string | null {
      return executionProviderAtivo;
    },

    getAverageLatencyMs(): number {
      if (recentLatencies.length === 0) return 0;
      let sum = 0;
      for (const t of recentLatencies) sum += t;
      return sum / recentLatencies.length;
    },
    // Média das últimas 20 confidences válidas. 0 se ainda não houver nenhum
    // resultado (mesmo padrão de getAverageLatencyMs). Consumido pelo
    // EngineDiagnostics para expor no HUD; NÃO alimenta lógica de decisão.
    getAverageConfidence(): number {
      if (recentConfidences.length === 0) return 0;
      let sum = 0;
      for (const c of recentConfidences) sum += c;
      return sum / recentConfidences.length;
    },
    getPendingCount(): number {
      return inFlight.size;
    },
  };
}
