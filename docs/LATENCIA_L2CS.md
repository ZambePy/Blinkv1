# Latência do L2CS — medições e o que ainda falta

> **Tarefa `P5.5`** do plano em `tasks.md`. Aceite: tabela de latência por execution provider com p50/p95, e a meta de latência do projeto reescrita a partir dela.
>
> **Estado: CONCLUÍDA** (exceto WASM multi-thread, que exige COOP/COEP e não muda a decisão). WebGPU foi medido e **resolve o problema**: a inferência cai de 2319 ms para 50 ms, e o staleness de 100% para 0%. O gargalo mudou para o thread principal — ver a seção da meta reescrita.

---

## O que a tarefa pedia, e onde cada parte está

| Passo | Estado |
|---|---|
| 1. Medir `session.run` no browser real (WASM SIMD, `numThreads = 1`) | ✅ feito |
| 2. Testar execution providers | ✅ **WebGPU medido — resolve.** Multi-thread não medido (exige COOP/COEP e não muda a decisão) |
| 3. Cachear o `ortApi`, que era reimportado a cada inferência | ✅ feito |
| 4. Registrar e **reescrever a meta de latência** a partir do medido | ✅ feito — C8 é alcançável **com WebGPU**; o gargalo passou para o thread principal |

---

## ✅ RESOLVIDO: WebGPU faz o L2CS funcionar

**Medido em navegador, com `l2csExecutionProvider: 'webgpu'`:**

| Provider | Crop | Inferência | Stale | Taxa |
|---|---|---|---|---|
| WASM | 448² | 2319 ms | **100%** | 0,0 Hz |
| WASM | 224² | 728 ms | **100%** | 0,0 Hz |
| **WebGPU** | **448²** | **50 ms** | **0,0%** | 3,7 Hz |
| **WebGPU** | **224²** | **32 ms** | **0,0%** | 8,0 Hz |

**46× mais rápido** em 448², **23×** em 224².

E o número que decide tudo: **`stale` saiu de 100% para 0,0%**. O bloco angular parou de ser zerado. As features `[4]` e `[5]` — `tan(yaw)` e `tan(pitch)` — passaram a carregar sinal de verdade pela primeira vez. **O modelo voltou a ter 6 dimensões úteis em vez de 4.**

A meta de C8 (`< 35 ms`) deixa de ser absurda: em 224² a inferência é **32 ms**, dentro do orçamento; em 448², 50 ms.

O bundle "all" com JSEP **carregou sem o erro** que o cabeçalho do worker registrava — o `wasmPaths` absoluto configurado no `init` resolveu aquele problema.

> O resto desta seção descreve o estado com WASM, que era o default quando a medição começou. Fica como registro do que estava acontecendo antes — e de por que a correção de `B2.1` foi o que tornou o problema visível.

---

## O estado anterior: com WASM, o L2CS não entregava nada

Medido em navegador, com o app rodando e rosto presente:

```
crop 448²:  inferência = 2319 ms   stale = 100%   l2cs = 0,0 Hz
crop 224²:  inferência =  728 ms   stale = 100%   l2cs = 0,0 Hz
```

**100% das leituras do L2CS estão obsoletas.** A tolerância de staleness é de 400 ms (`DEFAULT_STALE_MS`, ajustada por `B2.1` para ~3× a cadência pretendida); a inferência leva 2319 ms. Todo resultado chega cerca de **seis vezes tarde demais**, e `getLatestGaze` devolve `valid: false` sempre.

A consequência é direta e não é sutil: **`buildL2CSBlock` zera o bloco angular em todo quadro**. As features `[4]` e `[5]` do vetor de 6 dimensões — `tan(yaw)` e `tan(pitch)`, as duas que o L2CS deveria fornecer — são constantes zero. O modelo em produção está rodando com **4 dimensões úteis de 6**, e nada na interface diz isso.

Isso não é regressão nova: é o que a correção de `B2.1` tornou VISÍVEL. Antes dela, o timestamp era carimbado na chegada, então um resultado de 2,3 s atrás parecia recém-nascido e entrava como se fosse válido. O pipeline vinha alimentando o Ridge com ângulos de segundos atrás e chamando isso de sinal.

**O aviso agora é automático:** `__irisflowLatencia()` emite um `console.warn` explícito sempre que `stalePct > 50`.

---

## Medições em navegador (passo 1)

**Ambiente:** navegador, WASM SIMD, `numThreads = 1`, `executionProviders: ['wasm']`. Janela de 120 amostras do `stageTimer`.

| Estágio | 448² p50 | 448² p95 | 224² p50 | 224² p95 |
|---|---|---|---|---|
| **inferência L2CS** (worker) | **2319 ms** | — | **728 ms** | — |
| `mediapipe` | 19,1 | 21,2 | 19,3 | 22,4 |
| `l2cs.crop` | **13,4** | 20,9 | **10,9** | 12,1 |
| `quality` | **12,7** | 14,7 | 12,5 | 15,0 |
| `pose.pnp` | 0,6 | 1,9 | 0,3 | 1,8 |
| `features` · `filter` · `predict` · `l2cs.read` | ~0 | ≤0,1 | ~0 | ≤0,1 |
| `loop.total` | 21,5 | 33,7 | 31,9 | 39,4 |

fps de renderização: 29,4 (448²) e 29,6 (224²).

### O que estes números desmentem

**1. A meta de C8 (`< 35 ms end-to-end`) é inalcançável por este caminho.** A inferência sozinha é **66× o orçamento** em 448² e **21×** em 224². Não é questão de otimizar o entorno: o `mediapipe` + `quality` + `crop` somados dão ~45 ms, e a inferência é duas ordens de grandeza acima disso.

**2. O CPU EP do Node não serve nem de ordem de grandeza para o WASM.** Medido antes, em Node: 78,3 ms @448². No navegador: **2319 ms**. São **~30× mais lento**. O documento já alertava que não transferia; a magnitude real é muito pior do que "não transfere" sugere. O campo `inferenceLatencyMsCpuNode: 99` do `meta.json` mede outra coisa e não deve ser usado para decidir nada.

**3. A razão 448²→224² se sustenta.** 2319/728 = **3,19×**, contra 3,66× medido em Node e 4,00× teórico. A redução de trabalho de convolução transfere; o valor absoluto não.

**4. `l2cs.crop` custa 13,4 ms, não "~1–2 ms".** O plano repete essa estimativa em vários lugares (inclusive ao dispensar o ganho de `P4.8`). O medido é **7 a 10× maior**. E cai pouco com 224² (10,9 ms), porque o custo dominante é `drawImage` + `getImageData` no thread principal, não a normalização — reduzir o destino não reduz a leitura da fonte. Isso muda a conta de `P4.8` (cache de ROI): o que se evita por reuso é 13 ms, não 2.

**5. Reduzir a entrada PIORA o thread principal.** `loop.total` subiu de 21,5 para 31,9 ms (p50) ao ir para 224². A causa está nas contagens: `l2cs.crop` acumulou 17 amostras em 448² e **45** em 224². Inferência mais rápida significa mais submissões aceitas pelo backpressure, e cada submissão paga um crop no thread principal. **O ganho no worker é pago pelo thread principal** — um efeito que nenhuma estimativa teórica previa, e que só aparece medindo.

**6. `quality` custa 12,7 ms por quadro** — ~38% de um orçamento de 33 ms, no thread principal, para produzir brilho/contraste/blur/specular. É o segundo maior custo depois do `mediapipe` e nunca foi tratado como alvo de otimização.

### Um defeito de instrumentação encontrado pela própria medição

`loop.total` reportava p50 = 21,5 ms enquanto `mediapipe` (19,1) + `quality` (12,7) já somavam 31,8 ms **no mesmo quadro**. O total aparecia menor que suas próprias partes — impossível.

Causa: o `end` de `loop.total` estava fora do ramo `if (lastVideoTime !== videoEl.currentTime)`, então toda iteração do rAF gerava amostra, inclusive as em que não havia quadro novo e o corpo não fazia nada. Com rAF a ~60 Hz e vídeo a 30 fps, **metade das amostras valia ~0 ms** e a mediana caía para o meio de uma distribuição bimodal.

É o mesmo defeito que `B3.7` corrigiu em `accuracy.ts`: duas populações numa métrica só. Corrigido — o `end` passou para dentro do ramo. Os números de `loop.total` na tabela acima são **anteriores** à correção e devem ser relidos: o p95 (33,7 / 39,4 ms) é o mais próximo do custo real de um quadro com trabalho.

---

## A meta de latência, reescrita (passo 4)

**Com WASM, a meta de `< 35 ms` do conflito C8 estava errada por dois zeros. Com WebGPU, ela é plausível.**

Medido: **32 ms** de inferência em 224², **50 ms** em 448². O provider é a variável dominante — muito mais que a resolução de entrada, que rende apenas 1,6× dentro do WebGPU (50 → 32 ms) contra 3,2× dentro do WASM.

### O gargalo mudou de lugar

Este é o desdobramento mais importante, e ele reordena o que falta do plano.

Com o worker rápido, o **thread principal** passou a ser o limite:

| Estágio (thread principal) | 224² WebGPU | 448² WebGPU |
|---|---|---|
| `mediapipe` | 18,9 | 18,8 |
| `quality` | 12,2 | 12,2 |
| `l2cs.crop` | 11,2 | 12,9 |
| **soma** | **42,3 ms** | **43,9 ms** |
| fps observado | 27,9 | 25,8 |

**A soma passa dos 33 ms de um quadro a 30 fps**, e o fps medido caiu de ~29,5 (WASM) para 27,9 e 25,8. Não é regressão de código: é o pipeline **finalmente funcionando**. Com o L2CS entregando, o crop passa a rodar muito mais vezes — no WASM ele rodava 17 vezes na janela de amostragem, no WebGPU roda 120.

⚠️ **`loop.total` não é comparável entre as duas medições.** Os números de WASM foram colhidos ANTES da correção da instrumentação (que misturava quadros sem trabalho e puxava a mediana para baixo); os de WebGPU, depois. O p95 do WASM (33,7 / 39,4) é o que mais se aproxima de comparável com o p50/p95 do WebGPU (31,7 / 43,4).

### O que isso muda no plano

Duas tarefas que o plano tratava como marginais passam a ter justificativa medida:

- **`P4.2` (captura em worker)** — o plano dizia explicitamente *"a captura não é o gargalo; o gargalo é o L2CS"*. **Não é mais verdade.** O gargalo agora é o thread principal, e `mediapipe` + `quality` + `crop` são exatamente o que ele carrega.
- **`P4.8` (cache de ROI)** — o plano dispensava o ganho estimando o crop em "~1–2 ms". O medido é **11–13 ms**, e ele agora roda em todo quadro. Reusar o crop deixou de ser economia marginal.

E aparece um alvo novo que ninguém tinha listado: **`quality` custa 12,2 ms por quadro**, no thread principal, para produzir brilho/contraste/blur/specular. É o segundo maior custo do pipeline e nunca foi tratado como candidato a otimização.

### A decisão que sobra

| Questão | Estado |
|---|---|
| WebGPU vira o default? | **Recomendo sim**, mas depende de disponibilidade no posto — WebGPU exige GPU e driver compatíveis, e o fallback tem que ser explícito, não silencioso. |
| 224² ou 448²? | **Não decidir por latência.** A diferença é 18 ms, ambos abaixo do custo do thread principal. Quem decide é a ACURÁCIA, em `F8.4`. ⚠️ E a resolução de TREINO não está registrada — ver a nota no ADR C2. |
| Meta de C8 | Alcançável na inferência. O que falta caber em 35 ms agora é o **thread principal**, não o modelo. |

**Recomendação imediata:** ligar WebGPU com **448²** (o tamanho do export original, sem introduzir uma segunda variável) faz o L2CS voltar a contribuir hoje, a 50 ms e 0% de stale. A escolha entre 224 e 448 fica para o `F8.4`, agora como pergunta de acurácia, que é o que ela sempre foi.

---

## Medições feitas

**Ambiente:** Node 24, `onnxruntime-node` 1.27.0, CPUExecutionProvider, máquina de desenvolvimento do projeto (Windows 11). p50 e p95 sobre 15 execuções após aquecimento de JIT.

| Execution provider | Entrada | p50 | p95 | Tensor |
|---|---|---|---|---|
| CPU (Node) | 448² | **78,3 ms** | 92,7 ms | 2,30 MiB |
| CPU (Node) | 224² | **21,4 ms** | 25,6 ms | 0,57 MiB |
| **WASM SIMD 1-thread (browser)** | 448² | **2319 ms** | — | 2,30 MiB |
| **WASM SIMD 1-thread (browser)** | 224² | **728 ms** | — | 0,57 MiB |
| **WebGPU / JSEP (browser)** | 448² | **50 ms** | — | 2,30 MiB |
| **WebGPU / JSEP (browser)** | 224² | **32 ms** | — | 0,57 MiB |
| WASM multi-thread (browser) | — | *não medido* | — | — |

**Ganho de 448² para 224²: 3,66×**, contra 4,00× teórico pela contagem de MACs. A diferença vem do que não escala com a resolução — carga de pesos, overhead de sessão, camadas finais.

---

## Histórico: por que a meta não tinha sido reescrita antes da medição em navegador

> Este bloco ficou como registro do raciocínio anterior. Ele estava certo na direção e **subestimou a magnitude**: o alerta era "o número do Node é otimista por um fator desconhecido", e o fator medido foi **30×**.

O número que decide o conflito **C8** (`< 35 ms end-to-end`) é o do **navegador em WASM**, não o do Node em CPU nativa. São runtimes diferentes:

- O CPU EP do Node usa código nativo com as instruções do host; o WASM SIMD do browser roda numa VM com um subconjunto de SIMD e sem multi-thread por default (exige `crossOriginIsolated`, que exige cabeçalhos COOP/COEP).
- O `meta.json` do projeto trazia `inferenceLatencyMsCpuNode: 99` — e o próprio nome do campo registra que era Node. Substituir a meta do projeto por um número de Node seria repetir esse erro com outra roupa.

**Reescrever a meta a partir do que foi medido aqui daria um número otimista por um fator desconhecido.** O passo 4 fica aberto até a medição do passo 1 existir.

O que já dá para afirmar, e é útil: **224² é 3,66× mais rápido que 448² no mesmo runtime**. Essa razão deve transferir aproximadamente para o WASM, porque a redução é de trabalho de convolução, não de overhead. Se a meta de 35 ms for alcançável em algum cenário, é neste.

---

## Passo 3 — cache do `ortApi` (feito)

`l2cs.worker.ts` fazia `await import(ortUrl)` **dentro de `infer`**, ou seja, a cada inferência. Não havia download (o módulo já está no cache do runtime), mas havia resolução de URL e um `await` que empurra a inferência para o próximo tick de microtask.

Agora a importação é memorizada. Três detalhes que valem registro:

- **Guarda-se a PROMESSA, não o valor resolvido.** Duas inferências disparadas antes da primeira resolver compartilham a mesma importação; guardar só o valor deixaria uma janela em que ambas importam.
- **Falha não fica memorizada.** Uma rejeição limpa o cache, senão uma falha transitória de rede travaria o worker pelo resto da sessão.
- **`init` usa a mesma função.** Antes havia duas chamadas de `import()` com a URL escrita duas vezes — funcionava, e era duplicação esperando divergir.

O ganho não foi medido isoladamente: é da ordem de um tick de microtask por inferência, abaixo do ruído das medições acima. A justificativa é ser gratuito de remover, não ser grande.

---

## Como completar isto

1. Servir o app (`npm --prefix frontend run dev`), abrir com o L2CS ligado, deixar rodar **~1 min com rosto** — a janela do `stageTimer` é de 120 amostras, e p95 com poucas amostras não significa nada.

2. **Ler os números.** Há dois caminhos, e os dois foram criados junto com este documento (antes deles, `stageLatency` só existia dentro do contexto React e não havia como lê-lo pelo DevTools):

   **Console do DevTools** — o caminho para medir, porque dá número copiável:

   ```js
   __irisflowLatencia()   // console.table por estágio, ordenado por p95
   __irisflowDiag()       // o diagnóstico inteiro, se precisar de outro campo
   ```

   `__irisflowLatencia()` imprime uma linha por estágio com `p50ms`, `p95ms`, `amostras` e `orfaos` — este último é contagem de `end()` sem `begin()`, ou seja, bug de instrumentação, não de latência. Se aparecer diferente de zero, o número daquele estágio não vale.

   Abaixo da tabela sai uma linha com fps, taxa do L2CS, latência de inferência e o tamanho do crop vigente — que é o contexto sem o qual a tabela não se interpreta.

   **HUD visual** — abra qualquer tela com `?debug=1` na URL (ex.: `http://localhost:5173/?debug=1`). O painel no canto superior direito mostra os **quatro estágios mais caros** por p95, atualizando a 4 Hz. Serve para acompanhar enquanto mexe em alguma coisa; para registrar, use o console.

   Os hooks só existem enquanto o engine está vivo — são removidos no cleanup do provider, de propósito: um hook apontando para um engine descartado devolveria `null` em silêncio, e quem estivesse medindo leria isso como "o estágio não rodou".

   **O que cada estágio significa:** `l2cs.crop` é `getImageData` + normalização; `l2cs.read` é a leitura do cache do worker (não a inferência). A latência de **inferência** vem separada, em `l2cs.latencyMs`, medida dentro do worker em volta do `session.run` — é ela que responde ao C8.

3. Repetir com `l2csInputSize: 224`. No console: `__irisflowExp.set('l2csInputSize', 224)` e **recarregar a página** (o snapshot de configuração é resolvido no boot).
---

## Como medir WebGPU (passo 2) — o que falta

**Não precisa mais editar código.** A escolha do execution provider virou flag.

### O procedimento

```js
// 1. Console do DevTools, com o app aberto:
__irisflowExp.set('l2csExecutionProvider', 'webgpu')

// 2. RECARREGAR a página (o snapshot de config é resolvido no boot).

// 3. Confirmar que a GPU foi de fato ativada — este passo NÃO é opcional:
__irisflowDiag().l2cs.executionProvider     // tem que devolver 'webgpu'

// 4. Deixar rodar ~1 min com rosto, e então:
__irisflowLatencia()

// 5. Repetir com o crop menor:
__irisflowExp.set('l2csInputSize', 224)     // recarregar de novo

// 6. Voltar ao estado anterior quando terminar:
__irisflowExp.reset()                       // recarregar
```

A linha de resumo do `__irisflowLatencia()` agora traz o provider ativo:

```
[latencia] fps=29.4 l2cs=0.0 Hz inferência=2319 ms stale=100.0% crop=448² ep=wasm
```

### Por que o passo 3 é obrigatório

O ONNX Runtime aceita uma **lista** de execution providers e cai para o próximo sozinho quando o primeiro não inicializa. Para uso normal isso é bom; para medir é desastroso — pedir WebGPU, receber WASM em silêncio, e ler o resultado inevitavelmente igual como **"a GPU não ajudou"**. A conclusão exatamente invertida, com dado de aparência perfeita.

Por isso o worker pede **um provider só**, sem lista de fallback: se o WebGPU não inicializar, a criação da sessão **lança** e o status do L2CS vai para `error`. Falha visível em vez de comparação inválida. E `executionProvider` no diagnóstico registra o que ficou ativo.

### O obstáculo conhecido

WebGPU exige o bundle **"all"** (`ort.all.bundle.min.mjs`), que é o único com JSEP. E o cabeçalho de `l2cs.worker.ts` registra que esse bundle **já falhou uma vez** dentro de Worker sob o dev-server do Vite: ele tenta importar `ort-wasm-simd-threaded.jsep.mjs` por caminho absoluto e o `import()` dinâmico rejeita, mesmo com o arquivo respondendo 200 OK.

Isso pode ter sido resolvido pelo `wasmPaths` absoluto que o `init` configura hoje — ou não. Se o erro voltar, ele aparece como `init_error` no console, e as saídas são: testar no **Electron** (que não passa pelo dev-server) ou servir o build de produção (`npm --prefix frontend run build && npx vite preview`).

### O que esperar

Se o WebGPU funcionar, é o único caminho com chance de tirar a inferência de 2319 ms para a ordem de dezenas de ms. Se ele entregar algo como 50–150 ms em 224², a conversa sobre C8 muda de figura. Se ficar em centenas de ms, a decisão passa a ser entre aceitar cadência baixa e desligar o L2CS — e aí o `F8.4` compara contra o baseline **sem** L2CS, que é o que roda hoje na prática.

---

## Os outros caminhos

**WASM multi-thread:** exige `crossOriginIsolated`, isto é, cabeçalhos COOP/COEP. `ortApi.env.wasm.numThreads` está fixo em 1 em `l2cs.worker.ts` justamente porque o dev-server do Vite não serve esses cabeçalhos. No Electron é configurável. Ganho esperado: talvez 3× com 4 threads — ainda ~240 ms em 224², longe dos 35 ms.

**Preencher a tabela e reescrever a meta de C8** — a meta já foi reescrita com o dado de WASM; se o WebGPU mudar a ordem de grandeza, ela precisa ser reescrita outra vez.
