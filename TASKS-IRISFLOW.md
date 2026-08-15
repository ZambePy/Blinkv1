# IrisFlow — Plano de Tarefas D1/D2 (15–16 ago 2026)

> **Objetivo das próximas 48h:** fechar a integração do pipeline L2CS sem erros silenciosos e conseguir **medir erro de forma confiável e reproduzível**.
> Não é sprint de features novas. É sprint de *terreno firme + medição*.

---

## 0. Como usar este documento (leia primeiro, Claude Code)

**Regras de execução:**

1. Execute as tarefas **na ordem numérica**. `PREP-*` antes de `D1-*`, `D1-*` antes de `D2-*`.
2. Cada tarefa tem um **Critério de aceite** com comando verificável. Não marque como concluída sem rodar o comando e colar a saída.
3. **Uma tarefa = um commit.** Mensagem no formato `[PREP-1] descrição curta`.
4. Se uma tarefa revelar que a premissa está errada (o código já faz aquilo, ou o bug não existe), **pare e reporte** em vez de inventar trabalho.
5. **Não refatore nada fora do escopo da tarefa.** Este repositório tem comentários densos explicando decisões — preserve-os; se mudar o comportamento que um comentário descreve, atualize o comentário na mesma edição.
6. Nunca altere o formato do vetor de features sem atualizar `RECORDING_FORMAT_VERSION` em `src/telemetry/types.ts`.

**Notação:**

- 🔴 bloqueador — trava as outras tarefas
- 🟡 alto impacto na medição
- 🟢 melhoria mensurável
- ⏱️ estimativa para um agente + revisão humana

---

## 1. Estado atual verificado (não reimplemente isto)

Auditoria feita direto no repositório (`ZambePy/Blink@f77738a`). O projeto está **muito mais avançado** do que um "demo": o pipeline descrito no documento técnico anterior já está implementado quase por inteiro.

| Componente | Onde | Status |
|---|---|---|
| Worker L2CS + ONNX Runtime WASM | `src/l2cs/l2cs.worker.ts` | ✅ funcionando, 1 thread, sem COOP/COEP |
| Decodificação de bins (90 × 4°, offset −180) | `src/l2cs/decode.ts` | ✅ com testes |
| Crop facial 448² + ImageNet + flip | `src/l2cs/crop.ts` | ✅ com testes |
| Throttle 10 Hz + cache stale 500 ms | `src/l2cs/client.ts` | ✅ |
| Bloco angular de 7 features (`tan`) | `src/l2cs/block.ts` | ✅ com testes, clamp ±π/4 |
| Features geométricas compactas (37 dims/olho) | `src/extractor.ts` | ✅ |
| Calibração 9 pontos 10/50/90, ordem embaralhada | `frontend/src/pages/onboarding/CalibrationCheck.tsx` | ✅ |
| Descarte de 400 ms + rejeição por qualidade e pose-drift | `src/calibration.ts` | ✅ |
| Ridge + λ por CV leave-one-target-out | `src/ridge.ts` | ✅ |
| One Euro Filter com 3 presets | `src/oneEuroFilter.ts` | ✅ |
| Teste de precisão 9 pontos (grade 25/50/75) | `src/accuracy.ts` | ⚠️ funciona, mas com viés — ver A2 |
| Gravador de sessão JSONL (sem vídeo) | `src/telemetry/recorder.ts` | ✅ |
| Replay determinístico offline | `scripts/_replay_impl.ts` | ⚠️ funciona, mas diverge do live — ver A3 |
| Dwell global com refratário | `frontend/src/context/GazeContext.tsx` | ⚠️ sem histerese — ver A8 |

### Correção ao documento técnico anterior

O documento de pipeline que produzi antes dizia que a entrada do L2CS-Net é **224²**. **Está errado, e este repositório está certo.**

O `l2cs/utils.py` oficial usa `transforms.Resize(448)` **sem** `CenterCrop`. Logo `INPUT_SIZE = 448` em `src/l2cs/crop.ts` e `"inputSize": 448` em `l2cs.meta.json` estão corretos e **não devem ser alterados**. O custo (~16 GFLOPs, ~99 ms/inferência em CPU) é inerente — a mitigação já adotada (cadência de 10 Hz + degradação graciosa) é a decisão certa.

---

## 2. Achados da auditoria

Ordenados por impacto sobre o objetivo das 48h. Cada um vira uma tarefa abaixo.

### 🔴 A1 — `npm test` está vermelho por escopo

`vitest.config.ts` da raiz não define `include`, então o glob padrão varre **também** `frontend/src/**/*.test.tsx`, que importa `react` — presente só em `frontend/node_modules`.

Verificado nesta auditoria:

```
npx vitest run            →  2 failed | 13 passed   (falha no import de "react")
npx vitest run --dir src  → 12 passed | 68 tests    ✅
```

Sem portão verde você não tem como saber se as mudanças das próximas 48h quebraram algo.

### 🟡 A2 — O teste de precisão treina no próprio conjunto de validação

`src/accuracy.ts:386`, no fim de `finishTest`:

```ts
setGazeCorrections(diagnostics.map(d => ({
  refX: d.predX, refY: d.predY,
  offsetX: d.groundX - d.predX,
  offsetY: d.groundY - d.predY,
})));
```

Dois problemas encadeados:

1. **O número reportado não é o do sistema que o usuário usa.** As métricas são calculadas *antes* da correção; a correção é aplicada *depois*. O usuário navega com um pipeline cuja acurácia nunca foi medida.
2. **Medições repetidas ficam otimistas.** Rodar o teste duas vezes mede um modelo que já recebeu o gabarito daquelas 9 posições. O comentário em `VALIDATION_POINTS` (linha 54) diz explicitamente que a grade é disjunta "para não medir memorização" — e `finishTest` desfaz isso.

### 🟡 A3 — O replay treina em frames que o pipeline ao vivo descarta

`calibration.getCurrentTargetPx()` (linha 538) devolve o alvo **durante os 400 ms de acomodação** — por design, e o comentário explica o porquê. Mas:

- `engine.ts:442` grava **todo** frame, com `target` anexado;
- `feedRawData` (linha 296) descarta `elapsed < 400`, frames de baixa qualidade e frames com pose-drift;
- `_replay_impl.splitFrames` aceita **todo** frame com `target.kind === 'calibration'`.

Resultado: o modelo reconstruído pelo replay é treinado num superconjunto do que o modelo ao vivo viu. **O baseline offline não é comparável ao online** — e é exatamente essa comparação que você vai querer fazer nas próximas 48h.

### 🟡 A4 — `predictRidge` devolve `(0,0)` em silêncio quando a dimensão não bate

`src/ridge.ts`:

```ts
if (features.length !== model.numFeatures) {
  return { x: 0, y: 0 };
}
```

Combinado com o clamp `[0,1]` em `mapGaze`, o sintoma é **o cursor grudado no canto superior esquerdo, sem nenhum erro no console**. O cenário é real: o vetor tem 37 dims quando `l2csGaze == null` e 44 dims quando o bloco é anexado (`extractor.ts:402`). Qualquer caminho que misture os dois entre calibração e inferência produz esse modo de falha.

### 🟡 A5 — Métricas de acurácia enganosas

Em `finishTest`:

- `p90Error = sortedErrors[Math.floor(9 * 0.9)] = sortedErrors[8]` = **o maior de 9**. `p90Error === maxError`, sempre.
- `meanError` é a distância entre o alvo e a **média** das predições daquele ponto. Isso mede *bias*, não o que o dwell sente. Um ponto com bias 20 px e jitter 80 px passa como "Excelente".
- Falta a única métrica que prevê sucesso de dwell: **% de amostras dentro do raio do alvo**.

### 🟢 A6 — `ASSUMED_DIST_PX = 2268` é um chute fixo

60 cm a 96 CSS DPI. Os graus só são comparáveis dentro da mesma máquina e resolução. Para o baseline ter significado, distância real e densidade de pixels precisam entrar no `RunMeta`.

### 🟢 A7 — Calibração não persiste

`loadProfile()` sempre `return false`; `saveProfile()` é no-op (linhas 136–144). Toda sessão exige recalibração completa (~25 s + teste). Custo alto para o usuário-alvo, e atrito para você durante as medições.

### 🟢 A8 — Dwell reinicia do zero a cada frame fora do alvo

`GazeContext.tsx:159` — se `elementFromPoint` sai do elemento por **um único frame**, `dwellStartMsRef` zera. Com ~2° de erro e jitter residual, alvos médios ficam frustrantes. Falta histerese e snap.

### 🟢 A9 — `selectLambdaCV` faz 72 fits completos

8 λ × 9 folds, cada um recalculando a matriz de Gram (44² × ~450). O Gram depende só do fold, não do λ — dá para calcular uma vez por fold e variar apenas a diagonal (~8× mais rápido). `completeCalibration` trava a UI hoje.

### 🟢 A10 — `nearestDistance` roda sobre todo o perfil a 30 Hz

`calibration.ts:590` — ~450 vetores × 44 dims por frame, só para alimentar um log de debug com capacidade de 500 entradas.

### ⚪ A11 — Limite estrutural do replay (não é bug, é para você saber)

O replay reusa `featuresLeft/Right` gravados e, mesmo recomputando, o `yaw/pitch` do L2CS vem do JSONL. Portanto:

- ✅ **Dá para medir offline:** mudanças no Ridge, no λ, no scaler, no One Euro, no bloco de features (`block.ts`).
- ❌ **Só dá para medir ao vivo:** `EXPAND_FACTOR`, `INPUT_SIZE`, cadência do L2CS, troca de pesos, qualquer coisa antes da inferência.

Isso define a estratégia de D2: o que der para varrer offline, varre offline (barato, determinístico); o resto vira A/B ao vivo com protocolo fixo.

---

## 3. PREP — Preparação de terreno

Faça **tudo isto antes** de qualquer tarefa D1. São mudanças pequenas, de baixo risco, que destravam todo o resto.

---

### PREP-1 🔴 — Escopar o Vitest da raiz ⏱️ 5 min [✅ FEITO - GATE ACEITO: 12 files / 68 tests passed]

**Arquivo:** `vitest.config.ts` (raiz)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // O frontend tem a própria suíte (frontend/vitest.config.ts) e as próprias
    // deps (react, @testing-library) em frontend/node_modules. Sem este include,
    // o glob padrão do Vitest varre frontend/src/**/*.test.tsx a partir da raiz
    // e falha no import de "react".
    include: ['src/**/*.test.ts'],
  },
});
```

**Critério de aceite:**

```bash
npm test
# esperado: Test Files 12 passed (12) | Tests 68 passed (68)
```

---

### PREP-2 🔴 — Flags de experimento em runtime ⏱️ 25 min [✅ FEITO - GATE ACEITO: 68/68 passed e testado]

**Motivo:** metade das tarefas de D2 é A/B. Sem flags em runtime, cada variante exige rebuild — inviável em 48h.

**Arquivo novo:** `src/config/experiment.ts`

```ts
// Parâmetros de experimento ajustáveis SEM rebuild.
//
// Lidos de localStorage com fallback para o default de produção. Existem para
// permitir varredura A/B durante as sessões de medição (D2) sem recompilar.
// Em produção, nenhuma chave está setada → todos os defaults valem.
//
// Console:  __irisflowExp.set('expandFactor', 1.6)   → recarrega a página
//           __irisflowExp.reset()                     → volta aos defaults
//           __irisflowExp.dump()                      → estado atual (vai no relatório)

export interface ExperimentConfig {
  /** Fator de expansão da bbox facial antes do resize 448². Ver §E3. */
  expandFactor: number;
  /** Cadência de submissão ao worker L2CS, em ms. */
  l2csCadenceMs: number;
  /** Aplica o mapa RBF de correção derivado do teste de precisão.
   *  DEFAULT false — ver achado A2. Ligar só para comparação explícita. */
  applyGazeCorrection: boolean;
  /** Log de distância ao fecho convexo (caro: O(n·d) por frame). Ver A10. */
  enableDistanceLog: boolean;
  /** Janela de tolerância em que o dwell continua contando fora do alvo. Ver A8. */
  dwellGraceMs: number;
  /** Raio de snap magnético em px. 0 = desligado. */
  dwellSnapPx: number;
}

const DEFAULTS: ExperimentConfig = {
  expandFactor: 1.4,
  l2csCadenceMs: 100,
  applyGazeCorrection: false,
  enableDistanceLog: false,
  dwellGraceMs: 0,
  dwellSnapPx: 0,
};

const STORAGE_KEY = 'irisflow.experiment';

function load(): ExperimentConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ExperimentConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

// Snapshot único no boot — mudar no meio da sessão invalidaria a calibração
// já treinada (o vetor de features mudaria sob o modelo).
export const EXPERIMENT: ExperimentConfig = load();

export function experimentSnapshot(): ExperimentConfig {
  return { ...EXPERIMENT };
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__irisflowExp = {
    dump: () => ({ ...EXPERIMENT }),
    defaults: () => ({ ...DEFAULTS }),
    set(key: keyof ExperimentConfig, value: number | boolean) {
      const next = { ...load(), [key]: value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      console.warn('[exp] gravado. RECARREGUE a página para aplicar.', next);
    },
    reset() {
      localStorage.removeItem(STORAGE_KEY);
      console.warn('[exp] limpo. RECARREGUE a página.');
    },
  };
}
```

**Pontos de consumo (só trocar a constante pela flag, nada mais):**

| Arquivo | Trocar |
|---|---|
| `src/tracker/engine.ts` | passar `expandFactor: EXPERIMENT.expandFactor` em `cropFaceToTensor` |
| `src/l2cs/client.ts` | `cadenceMs` default ← `EXPERIMENT.l2csCadenceMs` |
| `src/calibration.ts` | `applyGazeCorrection()` retorna `{x,y}` sem alterar se `!EXPERIMENT.applyGazeCorrection` |
| `src/calibration.ts` | envolver `nearestDistance` + `logGazeDistance` em `if (EXPERIMENT.enableDistanceLog)` |

⚠️ **Não** altere `INPUT_SIZE`. 448 está correto (ver §1).

**Critério de aceite:**

```bash
npm test            # continua 68/68
npm run dev
# console: __irisflowExp.dump() → objeto com os 6 campos nos defaults
```

---

### PREP-3 🔴 — Gravar a decisão de aceite de cada amostra ⏱️ 40 min [✅ FEITO - GATE ACEITO: 68/68 passed]

**Motivo:** corrige o achado A3. Sem isto, todo número que o replay produzir em D1/D2 é incomparável com o número ao vivo.

**a) `src/telemetry/types.ts`** — bump de versão + campos novos:

```ts
export const RECORDING_FORMAT_VERSION = 2; // era 1 — v2 adiciona `sampleDecision`

/** Decisão do pipeline de calibração sobre este frame. Reproduz, no replay,
 *  exatamente o filtro que `calibration.feedRawData` aplicou ao vivo.
 *  Ausente em frames fora de coleta de calibração. */
export interface RecordedSampleDecision {
  accepted: boolean;
  /** ms desde o início da coleta deste ponto. */
  elapsedMs: number;
  reason?: 'acclimation' | 'quality' | 'pose_drift' | 'not_collecting';
}
```

E em `RecordedFrame`: `sampleDecision?: RecordedSampleDecision;`

**b) `src/calibration.ts`** — publicar a decisão em vez de só retornar cedo.

Adicione um módulo-level `let lastDecision: RecordedSampleDecision | null = null;` e, em `feedRawData`, **substitua cada `return;` por** um `lastDecision = {...}; return;` com o `reason` correspondente. No caminho feliz, `lastDecision = { accepted: true, elapsedMs }`.

Exporte:

```ts
export function consumeLastSampleDecision(): RecordedSampleDecision | null {
  const d = lastDecision;
  lastDecision = null;   // consumo destrutivo — um frame, uma decisão
  return d;
}
```

**c) `src/tracker/engine.ts`** — no bloco `if (recorder.isRecording())` de `hasFace`, anexar:

```ts
sampleDecision: calibration.consumeLastSampleDecision() ?? undefined,
```

⚠️ `feedRawData` precisa ser chamado **antes** do `recordFrame` — no código atual já é (linha 377 vs 442). Não reordene.

**d) `scripts/_replay_impl.ts`** — em `splitFrames`, no ramo `calibration`:

```ts
// v2+: honra a decisão gravada. Sem isto o replay treina em frames de
// acomodação/baixa qualidade que o pipeline ao vivo descartou — e o
// baseline offline deixa de ser comparável ao online (achado A3).
if (rec.header.formatVersion >= 2) {
  if (!f.sampleDecision?.accepted) { rejectedByDecision++; continue; }
} else {
  legacyNoDecision++;   // v1: comportamento antigo, mas avisa no relatório
}
```

Adicione `rejectedByDecision` e `legacyNoDecision` à seção `frames` do `Report`, e imprima em stderr um aviso claro quando `legacyNoDecision > 0`:

```
AVISO: gravação v1 sem sampleDecision — o modelo do replay inclui frames
que o pipeline ao vivo descartaria. Números NÃO comparáveis com o teste online.
```

**Critério de aceite:**

```bash
npm test
# grave uma calibração pelo app, exporte o .jsonl, e:
npm run replay -- --jsonl fixtures/replay/<arquivo>.jsonl -v 2>&1 | head -20
# esperado: frames.rejectedByDecision > 0 e frames.calibration menor que antes
```

---

### PREP-4 🔴 — Falhar alto em incompatibilidade de dimensão ⏱️ 20 min [✅ FEITO - GATE ACEITO: 69/69 passed]

**Motivo:** corrige A4 — o modo de falha mais caro do sistema hoje é totalmente silencioso.

**a) `src/ridge.ts`** — em `predictRidge`, trocar o `return {x:0,y:0}` por:

```ts
if (features.length !== model.numFeatures) {
  throw new RangeError(
    `[ridge] dimensão incompatível: modelo treinado com ${model.numFeatures} features, ` +
    `recebeu ${features.length}. Causa provável: calibração feita com o bloco L2CS ` +
    `ativo (44 dims/olho) e inferência sem ele (37 dims), ou vice-versa. ` +
    `Recalibre com o worker L2CS em estado 'ready'.`
  );
}
```

**b) `src/calibration.ts`** — em `mapGaze`, envolver as predições em `try/catch`, logar **uma vez** (guarda de flag, não a 30 Hz) e retornar `null`. O engine já trata `null` caindo no fallback do nariz.

**c) `src/l2cs/block.ts`** — adicionar teste de regressão em `block.test.ts`:

```ts
it('vetor tem sempre 44 dims quando l2csGaze != null, independente de valid', () => {
  // trava a invariante que PREP-4 protege
});
```

**Critério de aceite:**

```bash
npm test   # inclui o teste novo
```

---

### PREP-5 🟡 — `--recompute-features` no replay ⏱️ 20 min [✅ FEITO - GATE ACEITO: 69/69 passed]

**Motivo:** hoje o replay prefere `featuresLeft/Right` gravados, então **mudanças em `extractor.ts` ou `block.ts` não aparecem no replay**. Isso mata metade da varredura offline de D2.

**Arquivo:** `scripts/_replay_impl.ts`

- Adicionar `recomputeFeatures: boolean` a `CliArgs` e a flag `--recompute-features`.
- Em `getFeatures(f)`, quando a flag estiver ligada, **pular** o atalho dos features gravados e ir direto para `unflattenLandmarks` + `extractFeatures`.
- Registrar em `Report.config`: `featuresSource: 'recorded' | 'recomputed'`.

**Critério de aceite:**

```bash
npm run replay -- --jsonl <f>.jsonl --report /tmp/a.json
npm run replay -- --jsonl <f>.jsonl --recompute-features --report /tmp/b.json
diff <(jq .accuracy.meanErrorPx /tmp/a.json) <(jq .accuracy.meanErrorPx /tmp/b.json)
# esperado: valores muito próximos (mesma matemática, mesmo caminho)
# se divergirem muito → há divergência real entre gravação e extractor: investigue
```

---

## 4. D1 — Sábado 15/08: pipeline sem erros + baseline confiável

**Meta do dia:** ao fim de D1 você tem um número em que confia, gravado num arquivo versionado, produzido por um protocolo que dá para repetir amanhã.

---

### D1-1 🟡 — Separar medição de correção ⏱️ 30 min

Corrige A2.

**Arquivo:** `src/accuracy.ts`

1. Envolver a chamada de `setGazeCorrections` (linha 386) em `if (EXPERIMENT.applyGazeCorrection)` — default `false` (PREP-2).
2. Acrescentar ao JSON do relatório: `pipeline.gazeCorrectionApplied: EXPERIMENT.applyGazeCorrection`.
3. Quando a correção **estiver** ligada, o relatório precisa deixar explícito que o número reportado é **pré-correção**. Adicione ao overlay de diagnóstico um aviso visível.

**Por que default `false`:** você precisa de um baseline honesto antes de ligar qualquer coisa. A correção RBF pode voltar depois, medida corretamente (D2-4).

**Critério de aceite:** rodar o teste duas vezes seguidas sem recalibrar produz números **estatisticamente iguais** (antes, o segundo era artificialmente melhor).

```bash
# rode o teste 2×, compare os accuracy-report-*.json
jq '.result.meanError, .pipeline.gazeCorrectionApplied' accuracy-report-*.json
```

---

### D1-2 🟡 — Métricas que predizem sucesso de dwell ⏱️ 45 min

Corrige A5.

**Arquivo:** `src/accuracy.ts`

Adicionar a `AccuracyResult`:

```ts
/** Erro por AMOSTRA (não por média do ponto). É o que o dwell sente. */
sampleMeanError: number;
sampleMedianError: number;
sampleP90Error: number;          // p90 real, sobre todas as amostras
/** % de amostras dentro de um alvo de raio R centrado no ponto.
 *  Preditor direto da taxa de sucesso do dwell. */
hitRateByRadius: { radiusPx: number; pct: number }[];
```

- Guardar **todas** as amostras por ponto (hoje `predictedX/Y` já existem no escopo de `collect` — só faltam ser propagadas para `diagnostics`).
- `hitRateByRadius` calculado para raios de **60, 100, 150, 200 px** (grosso modo: botão pequeno, médio, grande, cartão AAC).
- Corrigir `p90Error`: com `n` amostras, `sorted[Math.min(n-1, Math.ceil(n*0.9)-1)]`.
- Manter `meanError` (bias) — é útil, só não pode ser o único.
- No overlay de diagnóstico, exibir a linha **"Taxa de acerto em alvo de 150 px: XX%"**. É o número que você vai citar para qualquer pessoa não-técnica.

**Critério de aceite:** relatório JSON contém os campos novos; `hitRateByRadius` é monotônico crescente no raio.

---

### D1-3 🟡 — `RunMeta` com geometria real ⏱️ 20 min

Corrige A6.

**Arquivo:** `src/accuracy.ts`

```ts
export interface RunMeta {
  // ...campos existentes...
  /** Distância olho→tela MEDIDA com fita métrica, em cm. Obrigatório para
   *  que o erro angular tenha significado fora desta máquina. */
  distanciaCm: number;
  /** Diagonal física do monitor em polegadas. */
  telaPolegadas: number;
}
```

Substituir `ASSUMED_DIST_PX` por cálculo real:

```ts
const diagPx = Math.hypot(vw, vh);
const pxPorCm = diagPx / (meta.telaPolegadas * 2.54);
const distPx = meta.distanciaCm * pxPorCm;
const meanErrorDeg = Math.atan(meanError / distPx) * 180 / Math.PI;
```

Fallback para `ASSUMED_DIST_PX` quando `meta` ausente, marcando `geometryAssumed: true` no relatório.

Atualizar também `AUTO_TEST_META` em `CalibrationCheck.tsx` e o formulário de `SettingsScreen.tsx`.

⚠️ **Meça com fita métrica de verdade.** Estimativa a olho erra fácil 15 %, o que vira 15 % de erro em todos os números angulares do baseline.

**Critério de aceite:** relatório traz `distanciaCm`, `telaPolegadas` e `pxPorCm`; `geometryAssumed: false`.

---

### D1-4 🟢 — Painel de diagnóstico ao vivo ⏱️ 40 min

**Motivo:** você vai passar D1 e D2 olhando para o comportamento do pipeline. Hoje o diagnóstico está espalhado por `console.log` a cada 3 s.

**Arquivo novo:** `frontend/src/components/DebugHUD.tsx`

Overlay canto superior direito, ligado por `?debug=1` na URL, atualizado a 4 Hz (não a 30 — não compita com o pipeline):

```
FPS render     28.4
L2CS           ready · 9.8 Hz · 97 ms · stale 3 %
yaw / pitch    +12.4° / −4.1°
pose           y −2.1° p +1.4° r +0.3°
features       44 dims · blink não
predito        (742, 431) px
calibrado      sim · λ=0.1 · 412 amostras
exp            expand 1.4 · cad 100 ms · rbf off
```

Exponha o que faltar via `engine.getDiagnostics()` — **objeto novo, não altere assinaturas existentes**.

**Critério de aceite:** `npm run dev -- --open '/?debug=1'` mostra o HUD com valores vivos; sem o parâmetro, zero overhead.

---

### D1-5 🔴 — Sessão de baseline (protocolo fixo) ⏱️ 60 min

Esta é **manual** (precisa de um humano em frente à câmera). O agente prepara o terreno e o registro; você executa.

**Protocolo — repita 3×, exatamente igual:**

| # | Condição | Iluminação | Cabeça | Óculos | Minuto da sessão |
|---|---|---|---|---|---|
| B1 | referência | boa | parada | conforme uso | 0 |
| B2 | cabeça livre | boa | livre | conforme uso | 0 |
| B3 | deriva | boa | parada | conforme uso | 20 |

Para **cada** rodada:

1. `__irisflowExp.reset()` e recarregar (garante defaults).
2. Ligar o **Gravador de sessão** em Configurações **antes** de calibrar.
3. Medir a distância com fita métrica → anotar em `distanciaCm`.
4. Calibração completa de 9 pontos, sem pular pontos.
5. Teste de precisão automático até o fim.
6. Parar o gravador, exportar `.jsonl` para `fixtures/replay/`.
7. Nomear: `baseline-B1-2026-08-15.jsonl` (mesmo padrão para o report).

**Arquivo novo:** `docs/BASELINE.md` — o agente cria o esqueleto:

```markdown
# Baseline de precisão — IrisFlow

Convenção: uma linha por rodada. Nunca edite linhas antigas; só acrescente.
`commit` = SHA do código que produziu o número.

| Data | Rodada | commit | dist(cm) | tela(") | mean(px) | mean(°) | p90 amostra(°) | hit@150px | jitter(px) | exp | obs |
|------|--------|--------|----------|---------|----------|---------|----------------|-----------|------------|-----|-----|
| 2026-08-15 | B1 | | | | | | | | | defaults | |
| 2026-08-15 | B2 | | | | | | | | | defaults | |
| 2026-08-15 | B3 | | | | | | | | | defaults | |
```

**Critério de aceite:** 3 `.jsonl` em `fixtures/replay/`, 3 linhas preenchidas em `docs/BASELINE.md`, e:

```bash
for f in fixtures/replay/baseline-*.jsonl; do
  npm run replay -- --jsonl "$f" --report "${f%.jsonl}.report.json"
done
git add -f fixtures/replay/*.report.json docs/BASELINE.md
```

> ⚠️ **Portão de D1.** Se o replay e o teste online divergirem em mais de ~10 % no `meanError`, **pare**. PREP-3 não está completo, e todo o D2 seria construído sobre medição furada.

---

## 5. D2 — Domingo 16/08: melhorias medidas contra o baseline

**Regra do dia:** nenhuma mudança entra sem número antes/depois. Se não deu para medir, não conta.

---

### D2-1 🟢 — Varredura offline de λ e do filtro ⏱️ 45 min

O mais barato: determinístico, sem humano, sem câmera.

**Arquivo novo:** `scripts/sweep.mjs` — roda o replay sobre os 3 baselines variando:

- `--filter`: `estavel` | `balanceado` | `responsivo`
- grade de λ forçada (adicione `--lambda <valor>` ao replay para pular a CV)

Saída: tabela markdown ordenada por `p90ErrorDeg`.

```bash
node scripts/sweep.mjs --glob 'fixtures/replay/baseline-*.jsonl' --out docs/SWEEP-D2.md
```

**Critério de aceite:** `docs/SWEEP-D2.md` com ≥ 24 linhas (3 gravações × 3 filtros × ≥ 3 λ) e um vencedor claro por métrica.

> A CV leave-one-target-out escolhe λ minimizando erro quadrático. A varredura pode revelar que outro λ minimiza o **p90** — que é o que importa para dwell. Se divergirem, é achado, não erro.

---

### D2-2 🟢 — Dwell com histerese e snap ⏱️ 50 min

Corrige A8. **Não é cosmético** — é provavelmente o maior ganho de usabilidade por hora investida em todo este plano.

**Arquivo:** `frontend/src/context/GazeContext.tsx`

1. **Histerese:** ao sair do alvo, não zere. Marque `dwellLeftAtMs`. Só zere se `now - dwellLeftAtMs > EXPERIMENT.dwellGraceMs`. Se voltar dentro da janela, **continue de onde parou** (o tempo fora não conta para o progresso, mas também não zera).
2. **Snap:** se `elementFromPoint` não achar alvo, procure o alvo elegível mais próximo dentro de `EXPERIMENT.dwellSnapPx` (use `getBoundingClientRect` dos elementos que casam com `DWELL_SELECTOR` no viewport, com cache invalidado por rota).
3. **Feedback:** o anel de progresso não pode voltar a zero durante o grace — o usuário lê isso como "o sistema não me viu".

Valores para testar: `dwellGraceMs` ∈ {0, 150, 300}, `dwellSnapPx` ∈ {0, 40, 80}.

**Critério de aceite (mensurável, use o jogo que já existe):**

`BubblePop` com 20 bolhas em posições fixas, cronometrado. Registre em `docs/BASELINE.md`:

| variante | tempo p/ 20 seleções | seleções erradas | abandonos (>5 s no mesmo alvo) |
|---|---|---|---|

Rode as 9 combinações? Não — rode 3: `(0,0)` baseline, `(300,0)`, `(300,80)`. Suficiente para decidir.

---

### D2-3 🟢 — Persistir perfil de calibração ⏱️ 50 min

Corrige A7.

**Arquivo:** `src/calibration.ts` — implementar de fato `saveProfile`/`loadProfile`.

O que serializar:

```ts
interface StoredProfile {
  version: 1;
  savedAt: string;
  featureDim: number;              // ← invalidação dura se mudar
  scalerLeft:  { means: number[]; stds: number[] };
  scalerRight: { means: number[]; stds: number[] };
  ridgeLeft:  RidgeModel;
  ridgeRight: RidgeModel;
  screen: { w: number; h: number; dpr: number };
  experiment: ExperimentConfig;    // ← invalidação dura se mudar
}
```

**Invalidar automaticamente (e dizer o motivo ao usuário) quando:**

- `featureDim` ≠ dimensão atual do vetor → **crítico**, é exatamente o cenário de A4;
- resolução ou `devicePixelRatio` mudaram;
- `experiment` difere do atual;
- perfil com mais de 24 h (ofereça revalidação rápida em vez de bloquear).

`StandardScaler` já tem `getParams`/`setParams`; `gazeRegressor` já tem `ridgeModelFromRegressor`/`ridgeRegressorFromModel`. **A infraestrutura toda já existe** — é ligação, não invenção.

**Critério de aceite:**

```bash
# calibrar → F5 → o app deve reportar "calibrado" sem recalibrar
# e o teste de precisão logo após o F5 deve dar erro dentro de 15% do
# medido antes do F5 (mesma sessão, mesma pose)
```

---

### D2-4 🟢 — Correção de deriva de 1 ponto ⏱️ 40 min

**Motivo:** substitui o RBF do A2 por algo honesto e barato. A deriva de sessão é majoritariamente um **offset**, não uma mudança de forma.

**Arquivos:** `src/calibration.ts` + tela nova acessível pelo menu.

1. `applyOffsetCorrection(dx, dy)` — offset puro em px, aplicado depois de `mapGaze`, persistido junto do perfil.
2. Tela: um alvo único no centro, 1,5 s de coleta (400 ms descartados), `dx = alvo − mediana(predições)`.
3. Botão grande no menu principal: **"Reajustar olhar (2 s)"**.
4. Guarda: se `|dx|` ou `|dy|` > 20 % da tela, **recuse** e sugira recalibração completa — um offset desse tamanho não é deriva, é modelo quebrado.

**Critério de aceite:** medir B3 (20 min de sessão) antes e depois do reajuste. Espera-se queda perceptível do `meanError` sem alteração do `jitterRMS` — se o jitter mudar, a correção está fazendo algo além de offset e há bug.

---

### D2-5 🟢 — A/B ao vivo de `EXPAND_FACTOR` ⏱️ 45 min

Só dá para medir ao vivo (achado A11). O comentário em `crop.ts:12` já sinaliza isto como "o parâmetro de maior risco silencioso do pipeline" — hoje `1.4` é um palpite.

**Protocolo:** para cada valor ∈ **{1.2, 1.4, 1.7}**:

1. `__irisflowExp.set('expandFactor', X)` → recarregar
2. Gravador ligado → calibração completa → teste de precisão
3. Exportar como `expand-X-2026-08-16.jsonl`

Mesma pessoa, mesma sessão, mesma iluminação, mesma distância, **na sequência** (não em horários diferentes — a deriva contaminaria a comparação).

**Critério de aceite:** 3 linhas em `docs/BASELINE.md` + recomendação escrita. Se as diferenças ficarem **dentro do ruído entre rodadas do baseline** (que você mediu em D1-5), a conclusão honesta é *"não há evidência de que importe nesta faixa"* — e isso é um resultado válido; registre e siga.

---

### D2-6 🟢 — Fechamento: relatório comparativo ⏱️ 30 min

**Arquivo novo:** `docs/RESULTADOS-D1-D2.md`

Estrutura:

1. **Baseline D1** — 3 rodadas, número principal com desvio entre rodadas
2. **O que mudou** — uma linha por tarefa, com commit
3. **Ganho medido** — tabela antes/depois, por métrica
4. **O que não deu para medir** — e por quê (seja explícito; é o que orienta a próxima sprint)
5. **Próximas 3 apostas** — ordenadas por ganho esperado ÷ esforço

**Critério de aceite:** o documento responde à pergunta *"o sistema ficou melhor? em quanto? como sabemos?"* com números, não adjetivos.

---

## 6. Backlog explícito (NÃO fazer em D1/D2)

Registrado para o agente não puxar por conta própria:

- ⏸️ Otimizar `selectLambdaCV` (A9) — ganho de UX, zero ganho de precisão. Depois de D2-1, que pode tornar a CV desnecessária.
- ⏸️ Quantização INT8 do ONNX — tarefa de dia inteiro, e a cadência de 10 Hz já resolve o problema hoje.
- ⏸️ Fine-tuning personalizado dos heads FC — maior ganho de precisão disponível (30–50 %), mas exige pipeline Python offline. Sprint própria.
- ⏸️ Blendshapes do MediaPipe para piscada (`outputFaceBlendshapes: false` hoje, blink vem do EAR) — só depois de haver uma métrica de falso-positivo de piscada.
- ⏸️ Migrar `rAF` → `requestVideoFrameCallback` — ganho marginal; o guard `lastVideoTime !== currentTime` já evita reprocessar frames.
- ⏸️ Entropia do softmax como sinal de confiança (TODO já em `telemetry/types.ts:37`).

---

## 7. Checklist de fim de cada dia

```bash
npm test                        # 68/68 verde
npm run --prefix frontend verify   # lint + types + testes + build
git log --oneline -20           # um commit por tarefa, prefixado
ls docs/                        # BASELINE.md atualizado
ls fixtures/replay/*.report.json   # relatórios versionados
```

**Pergunta de controle, honestamente:** *o número de amanhã será comparável ao de hoje?* Se a resposta não for um "sim" claro, a prioridade da manhã seguinte é consertar a medição — não adicionar melhorias.
