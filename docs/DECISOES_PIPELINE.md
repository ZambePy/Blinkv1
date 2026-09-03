# Decisões de Arquitetura — Pipeline Novo (ADRs)

> **Tarefa T0.2** do plano em `tasks.md`.
> Uma ADR curta por conflito **C1–C9** da Parte II de `tasks.md`.
> **Estado:** *proposto*. Cada decisão precisa ser confirmada por um humano antes do Sprint 4. As decisões que dependem de medição são resolvidas de forma vinculante em `F8.6` (Dia 7) — se a evidência do Dia 7 contrariar o que está aqui, o Dia 7 vence.

**Formato:** contexto (1 parágrafo), decisão, justificativa (com evidência do repo ou de `tasks.md`), como será medida no Dia 7, e o que muda no código.

---

## ADR C1 — Resolução de captura

**Contexto.** A especificação nova pede captura em **640×480 @30 fps**. O código atual pede **1920×1080** ([frontend/src/context/GazeContext.tsx:672-698](../frontend/src/context/GazeContext.tsx#L672-L698)). O README argumenta explicitamente que "o erro escala com o inverso da densidade de pixels sobre o olho" ([README.md:155](../README.md#L155), [README.md:160](../README.md#L160)).

**Decisão.** **Manter 1080p** na captura. Adicionar `captureResolution: '1080p' \| '720p' \| '480p'` como flag em `experiment.ts`, com downscale opcional antes do pipeline.

**Justificativa.**
- 640×480 reduz o deslocamento da íris (sinal primário do vetor de features) para poucos pixels. Não há evidência empírica no repositório de que compense.
- A afirmação da especificação nova ("640×480 basta") contradiz explicitamente uma nota registrada no README.
- Manter a flag permite `F8.4/C1` medir com dado, não com opinião.

**Como será medida no Dia 7.** Condição C1 de `F8.4`: rodar o protocolo `F8.1` com `captureResolution: '480p'` contra o baseline B. Métrica primária: erro médio e p90 sobre a grade de validação 3×3. Critério de reversão: se `meanError(480p) ≤ meanError(1080p) + 5%`, adotar 480p pelo custo/latência menor.

**Mudança no código.** Nova flag em `src/config/experiment.ts`; caminho de downscale em `frontend/src/context/GazeContext.tsx`. Sem mexer em nada mais.

---

## ADR C2 — Tamanho de entrada do L2CS

**Contexto.** Modelo exportado hoje tem `inputSize: 448` fixo em [frontend/public/models/l2cs/l2cs.meta.json:5](../frontend/public/models/l2cs/l2cs.meta.json#L5) e no próprio ONNX. A decisão do projeto para o pipeline novo é operar o L2CS-Net com entrada **228×228** — resolução escolhida pelo time por combinar redução substancial de FLOPs (≈3,86× menos que 448²) com margem sobre a densidade de pixel mínima que o olho ocupa dentro do crop facial em setups de webcam comum.

**Decisão.** **Migrar para 228².** O runtime passa a receber um tensor NCHW 1×3×228×228 do `cropFaceToTensor`; o ONNX exportado com entrada 228 substitui o `l2cs_gaze360.onnx` atual; o `l2cs.meta.json` é atualizado. O caminho 448 é removido no mesmo PR — sem convivência, para não deixar dois modelos disputando espaço no cache do navegador (~92 MB cada).

**Justificativa.**
- Decisão explícita do time.
- 228² reduz o custo de convolução (~3,86× menos MACs), tornando a meta de latência C8 tecnicamente alcançável em execution providers WASM SIMD single-thread — o que muda a análise do conflito C8.
- Manter 448 e 228 simultaneamente dobraria o passivo de download inicial e o footprint em cache e diluiria a atenção do benchmark.

> ### ✅ RESOLVIDO (2026-09-03): era 224, e a migração foi feita de outra forma
>
> A questão levantada abaixo foi confirmada — **o número correto é 224**, não 228 — e a decisão de C2 mudou de forma na execução. Resumo do que de fato aconteceu:
>
> **1. O ONNX foi reexportado com eixos espaciais DINÂMICOS**, não fixos em 224:
> ```
> input: ['batch', 3, 'height', 'width']       (antes: [batch, 3, 448, 448])
> ```
> Isso é possível porque a rede termina em `GlobalAveragePool`: `fc_yaw_gaze` e `fc_pitch_gaze` recebem 2048 features em qualquer resolução. Verificado no grafo antes da troca.
>
> **2. Não há substituição atômica, e não precisa haver.** A ADR original exigia que 448 e o tamanho novo não coexistissem, para não dobrar o passivo de cache (~92 MB por modelo). Com eixos dinâmicos **um único binário roda os dois**, então a restrição perdeu o motivo — e a condição de ablação de `F8.4` (224 contra 448) fica possível sem nenhum custo de download.
>
> **3. É reexport, não retreino.** Os 110 tensores de peso são **byte-idênticos** aos do modelo anterior, e a saída em 448² é **bit-idêntica** à de antes. A troca do binário não muda nada no comportamento default — a resolução fica isolada como única variável do experimento.
>
> **4. Latência medida** (CPU, p50 sobre 15 execuções): **448² = 78,3 ms · 224² = 21,4 ms → 3,66×** (teórico por MACs: 4,0×).
>
> **5. O default continua 448.** ⚠️ **A resolução de TREINO não está registrada em lugar nenhum do repositório.** O que se sabe: o export original fixava a entrada em 448², e o L2CS-Net upstream usa 448². Isso é evidência do tamanho de INFERÊNCIA pretendido por quem exportou — não prova da resolução de treino. Enquanto isso não for confirmado, 448 é o default por ser o comportamento atual e o tamanho do export original, e o efeito de 224 na acurácia é desconhecido até `F8.4` medir. Quem escolhe é a flag `l2csInputSize` (`src/config/experiment.ts`), default 448 — a mesma disciplina de todo o resto: default = comportamento atual, e a medição decide.
>
> **6. `signConvention` foi medido em 448² e NÃO foi revalidado em 224².** O script aceita `--size` para isso.
>
> O bloco abaixo fica como registro de como a dúvida foi levantada.
>
> ---
>
> ### ⚠️ Questão aberta (histórico): 228 ou 224?
>
> **Levantada em 2026-09-03, antes de `P5.5a` começar.** O valor `228` precisa ser confirmado com quem exporta o ONNX, e a suspeita é que ele seja um `224` corrompido que virou canônico por repetição.
>
> **O que sustenta 224:**
> - É o que a **especificação original pedia** (registrado em `tasks.md` §Parte II, conflito C2, e em `tasks.md:124`). O `228` aparece como substituição feita "antes deste plano", sem justificativa técnica registrada.
> - É o tamanho canônico de ImageNet — onde os pesos do backbone nasceram.
> - O backbone do L2CS-Net é uma **ResNet-50, que reduz por 32**. `224/32 = 7` exato e `448/32 = 14` exato: os dois tamanhos em uso hoje são limpos. **`228/32 = 7,125`, que não fecha** — o mapa final sai com padding assimétrico, e só funciona sem erro porque o pooling adaptativo do PyTorch mascara a diferença.
> - `228` não é tamanho padrão de nenhuma arquitetura conhecida.
>
> **O que sustenta 228:** apenas o registro de que foi decisão do time. Nenhum documento traz o porquê.
>
> **A conta de MACs não decide nada.** O ADR cita "≈3,86× menos MACs", e `(448/228)² = 3,86` — o número foi derivado *do* 228, então ele confirma consistência interna, não correção. Com 224 seria exatamente `4,0×`.
>
> **Por que corrigir agora custa zero.** O binário ainda não foi entregue ao repositório (é o pré-requisito bloqueante de `P5.5a`), então nada foi construído em cima. Depois do export, trocar significa reexportar, revalidar sinais e refazer medição.
>
> **Ação:** confirmar com quem faz o export antes de `P5.5a` iniciar. Se for `224`, trocar as ~10 ocorrências de `228` em `tasks.md` e neste ADR. **Nada além deste bloco foi alterado** — o resto do ADR segue descrevendo a decisão como registrada.

**Riscos e mitigação.**
- **Sinais de yaw/pitch podem mudar** ao reexportar. O script [frontend/scripts/l2cs_axis_validation.mjs](../frontend/scripts/l2cs_axis_validation.mjs) precisa ser reexecutado com o modelo novo (ver `B3.29` — o script atual tem defeitos que precisam ser corrigidos junto). Até a reexecução, tratar `signConvention` do `meta.json` novo como **provisional**.
- **Precisão pode cair.** É por isso que a migração entra **antes** do Sprint 8: `F8.4/C1` mede o modelo 228 contra o baseline B (com bugs corrigidos, sem pipeline novo) e um baseline A' (código original com o modelo 228 no lugar do 448). Se `meanError(228) > meanError(448) + 15%`, abrir tarefa de investigação de crop/normalização antes de aceitar.
- **O ONNX 228 precisa existir.** Se ainda não foi exportado, a tarefa de migração fica bloqueada até o artefato chegar ao repositório. A tarefa `P5.5a` (ver "Quando") explicita esse pré-requisito.

**Como será medida no Dia 7.** Nova condição do `F8.4`: `L2CS_input_size ∈ {228, 448}` sob mesmo protocolo, mesmas trajetórias, mesmas condições de captura. Métricas: `meanError`, `p90`, `looErrorPx`, e latência p50/p95 vinda de `T0.5` (`stageLatency.l2cs.*`). O 228 é adotado como default vinculante se ele não regride acurácia **e** melhora latência de forma medida.

**Mudança no código.**
- Substituir `frontend/public/models/l2cs/l2cs_gaze360.onnx` pelo binário 228² (mesmo dataset Gaze360, mesmo layout NCHW RGB, 90 bins/eixo).
- `frontend/public/models/l2cs/l2cs.meta.json`: `inputSize: 228`. Marcar `signConvention.*.confidence` como `"provisional"` até revalidação.
- [src/l2cs/crop.ts](../src/l2cs/crop.ts): trocar a constante `CROP_SIZE` de 448 para 228 (e o resize do canvas correspondente); nada mais precisa mudar porque a normalização ImageNet é invariante à resolução.
- [src/tracker/engine.ts](../src/tracker/engine.ts): `createCropContext(228)` no lugar de 448 (ou parametrizar pela constante importada).
- Atualizar testes `src/l2cs/crop.test.ts`, `src/l2cs/integracao.test.ts` para o novo tamanho.
- Reexecutar `frontend/scripts/l2cs_axis_validation.mjs` (com as correções de `B3.29`) e gravar o resultado como evidência no `meta.json`.
- Atualizar [README.md:43](../README.md#L43) — a linha "recorte facial 448×448" passa a "228×228".

**Quando.** Nova tarefa `P5.5a` em `tasks.md` (Sprint 5, Etapa 4), **imediatamente antes** de `P5.5` (medir e atacar latência). A ordem é obrigatória: medir latência do 448 sem migrar não informa nada útil para o Sprint 8 — o modelo em produção no dia da medição precisa ser o que vai para o benchmark. Ver detalhamento em `tasks.md` §Sprint 5.

---

## ADR C3 — Backbone / dataset de treino

**Contexto.** Especificação: **ResNet-50 treinada em MPIIGaze + Gaze360**. Pesos disponíveis no repo: apenas Gaze360.

**Decisão.** **Manter Gaze360** enquanto for o único peso disponível.

**Justificativa.**
- Sem pesos MPIIGaze+Gaze360 disponíveis, a troca não é implementável.
- Mudança de distribuição de treino só faz sentido medindo, e não há artefato para medir.

**Como será medida no Dia 7.** Fora de escopo. Reabrir se e quando pesos alternativos forem obtidos.

**Mudança no código.** Nenhuma.

---

## ADR C4 — Número de landmarks

**Contexto.** Especificação: **468 landmarks** (Face Mesh sem refinamento de íris). Modelo atual: **478** ([frontend/public/mediapipe/models/face_landmarker.task](../frontend/public/mediapipe/models/face_landmarker.task), com íris habilitada). Os 10 pontos de íris são a origem das features [0..3] do vetor ativo (offsets de íris), conforme [src/extractor.ts:459-475](../src/extractor.ts#L459-L475).

**Decisão.** **Manter 478.**

**Justificativa.**
- Os 10 pontos de íris são o sinal primário do vetor. Sem eles, `landmarks.length < 478` faz o extractor degradar para vetor vazio.
- A especificação nova pede 468 sem justificativa técnica registrada; o repositório tem justificativa clara para os 478.

**Como será medida no Dia 7.** Fora de escopo (a especificação seria uma regressão medida).

**Mudança no código.** `P5.1` expõe as constantes de grupos de landmarks nomeadas e adiciona `assert(landmarks.length === 478)` que faz o sistema **falhar visivelmente** se algum dia chegar um modelo de 468 (defesa contra `B2.3` reaparecer).

---

## ADR C5 — Head pose por PnP vs. `facialTransformationMatrix`

**Contexto.** Especificação: PnP com 6 landmarks (`solvePnP`). Código atual usa `facialTransformationMatrix` do MediaPipe (matriz 4×4 ajustada sobre 478 pontos).

**Decisão.** **Implementar PnP como alternativa medida**, atrás de `headPoseSource: 'matrix' \| 'pnp'`. **Não substituir** a matriz.

**Justificativa.**
- PnP de 6 pontos é regressão em robustez comparado a ajuste sobre 478 pontos — menos redundância, mais sensível a oclusão parcial.
- Ter ambos permite comparar num dataset controlado, o que a especificação não permite.

**Como será medida no Dia 7.** Condição C4 de `F8.4`: rodar com `headPoseSource: 'pnp'` contra baseline B. Métrica: erro após compensação de pose (a variável que a head pose realmente influencia) e robustez sob oclusão parcial induzida.

**Mudança no código.** `P5.2` cria `src/pose/solvePnP.ts`; `src/extractor.ts` passa a expor o método escolhido pelo enum. Diagnóstico registra o delta entre os dois em toda execução (para auditoria offline).

---

## ADR C6 — Ridge com 11 features

**Contexto.** Especificação: 11 features (`pitch`, `yaw`, `head_pitch`, `head_yaw`, `head_roll`, `distância`, `EAR_left`, `EAR_right`, `pitch×yaw`, `pitch²`, `yaw²`). Código atual: `ACTIVE_FEATURE_SET = 'irisCore+l2cs'` = **6 dims/olho** (após decisão registrada de que ampliar o vetor com pose e interações **piorou** — nota em [src/extractor.ts:300-330](../src/extractor.ts#L300-L330) registra 322 px vs 140 px em teste medido).

**Decisão.** **Implementar `featureSet: 'spec11'` atrás de flag**; default continua `'irisCore+l2cs'` (6 dims) até o `F8.4` dizer o contrário.

**Justificativa.**
- O repositório já tem evidência empírica de que ampliar o vetor com pose e interações degrada por memorização (com ~240 amostras contra 44+ features).
- A especificação não traz medição contra essa evidência; portanto vira hipótese a testar, não decisão.
- Cuidado extra: `polynomialFeatures: true` combinada com `spec11` **duplica** os termos quadráticos e de interação (que já estão explícitos em `spec11`). O caminho `spec11` precisa desligar a expansão polinomial na chamada.

**Como será medida no Dia 7.** Condição C5 de `F8.4`. Se `spec11` bater `irisCore+l2cs` por > 8% em erro médio e p90 **e** não piorar `looErrorPx`, adotar como default. Caso contrário, remover a flag para não deixar código morto.

**Mudança no código.** `P6.5` cria o conjunto em `src/extractor.ts`; `FEATURE_VECTOR_ID` codifica o novo nome; `buildContextKey` passa a incluir `featureSet` na chave (parte de `B2.9`).

---

## ADR C7 — EAR threshold 0,18

**Contexto.** Especificação: threshold fixo **0,18** para olho fechado. EAR atual é anisotrópico (mediana ~0,55, inflado por W/H = 1,78×) — 0,18 num EAR de escala 0,55 **nunca dispararia**.

**Decisão.** **Implementar 0,18**, precedido obrigatoriamente pela normalização isotrópica do EAR (`B2.6`).

**Justificativa.**
- 0,18 é o limiar canônico da literatura sobre EAR isotrópico. É correto — só não é aplicável a um EAR que está inflado por bug de normalização.
- Corrigir `B2.6` **isoladamente** é ganho independente (o limiar adaptativo hoje trava em `thrMax = 0,22` porque `mean × 0.8 ≈ 0,44 > 0,22`).

**Como será medida no Dia 7.** Sequência de EAR sintética + validação de piscadas espontâneas contadas contra ground truth manual num segmento gravado. Métrica: precisão e recall de detecção de piscada.

**Mudança no código.** `B2.6` corrige a normalização; `P5.4` adota o 0,18 e recalcula `irisVisibilityPercentage` (`B3.31`) na nova escala.

---

## ADR C8 — Latência alvo < 35 ms end-to-end

**Contexto.** Especificação: latência **< 35 ms**. Configuração atual: L2CS em WASM single-thread (`numThreads = 1`), ResNet-50 @448² ≈ 16 GFLOPs, `inferenceLatencyMsCpuNode: 99` no meta — mas esse número é `onnxruntime-node`, não vale no browser. Estimativa realista no browser: **300–600 ms por inferência**.

**Decisão.** **Reformular a meta.** Não fixar 35 ms sem medir. `P5.5` mede latência real por estágio (com `T0.5` já instalado) e a meta oficial vira `p95(end-to-end) ≤ 3× a cadência de emissão`.

**Justificativa.**
- 35 ms end-to-end é fisicamente inatingível com WASM single-thread + ResNet-50 @448². Fixar uma meta impossível vicia o restante do plano.
- WebGPU (via `ort-wasm-simd-threaded.jsep.wasm` que o repo já traz, 26,8 MB) pode reduzir a latência do L2CS por ordem de magnitude. Multi-thread exige `crossOriginIsolated` (COOP/COEP), viável em Electron, condicional em browser.
- Depois de medido, a meta se ajusta ao teto real.

**Como será medida no Dia 7.** `P5.5` produz tabela por execution provider (wasm-simd single, wasm-simd multi se disponível, webgpu). Meta final registrada em `docs/DECISOES_PIPELINE.md` (esta ADR) como *atualização*.

**Mudança no código.** `T0.5` (esta sprint) já instrumenta os estágios. `P5.5` implementa o toggle de execution provider e cacheia `ortApi`.

> ### ✅ ATUALIZAÇÃO (2026-09-03) — medido em navegador, e a estimativa estava otimista
>
> **A estimativa de "300–600 ms por inferência" no browser era otimista por ~4×.** Medido com WASM SIMD single-thread: **2319 ms** em 448² e **728 ms** em 224².
>
> Consequência que ninguém tinha percebido: com a tolerância de staleness em 400 ms (corrigida por `B2.1`), **100% das leituras do L2CS vinham obsoletas**. `buildL2CSBlock` zerava o bloco angular em todo quadro, e o modelo rodava com **4 dimensões úteis de 6** — sem nada na interface dizendo isso.
>
> **WebGPU resolve.** Medido com `l2csExecutionProvider: 'webgpu'` (bundle "all" com JSEP, que o repositório já trazia):
>
> | Provider | Crop | Inferência | Stale |
> |---|---|---|---|
> | WASM | 448² | 2319 ms | 100% |
> | WASM | 224² | 728 ms | 100% |
> | **WebGPU** | **448²** | **50 ms** | **0%** |
> | **WebGPU** | **224²** | **32 ms** | **0%** |
>
> **46× mais rápido em 448².** O staleness foi de 100% para 0% — o bloco angular voltou a carregar sinal.
>
> **A meta de 35 ms deixa de ser impossível na inferência**, mas o gargalo mudou de lugar: com o worker rápido, o thread principal passou a somar `mediapipe` (18,9) + `quality` (12,2) + `l2cs.crop` (11,2) = **42,3 ms**, acima do orçamento de 33 ms a 30 fps. O fps medido caiu para 27,9 (224²) e 25,8 (448²).
>
> **Isso reordena duas tarefas do plano**, que eram tratadas como marginais:
> - **`P4.2`** (captura em worker) — o plano dizia *"a captura não é o gargalo; o gargalo é o L2CS"*. **Não é mais verdade.**
> - **`P4.8`** (cache de ROI) — o plano estimava o crop em "~1–2 ms" para dispensá-lo. O medido é **11–13 ms**, e agora ele roda em todo quadro.
>
> E aparece um alvo que o plano nunca listou: **`quality` custa 12,2 ms por quadro** no thread principal, o segundo maior custo do pipeline.
>
> **Meta reescrita:** `p95(end-to-end) ≤ 3× a cadência de emissão`, com o L2CS em **WebGPU**. O que falta caber no orçamento é o thread principal, não o modelo. Detalhes e procedimento de medição em `docs/LATENCIA_L2CS.md`.

---

## ADR C9 — Distância interpupilar antropométrica

**Contexto.** Duas constantes coexistem no código: **6,3 cm** (interpupilar) e **9,0 cm** (cantal, duplicada em `src/cameraTuner.ts:350` e outros locais). [src/translationCompensation.ts:53-63](../src/translationCompensation.ts#L53-L63) documenta que essa divergência já custou 43% de erro de escala.

**Decisão.** **Implementar.** Unificar num único módulo `src/anthropometry.ts` com ambas as constantes tipadas e o landmark correto associado a cada uma. Todo consumidor importa de lá.

**Justificativa.**
- Bug medido no próprio repositório. Custo de manter divergente é conhecido e não trivial.
- Refatoração pura (sem mudança de semântica), então cabe em uma tarefa.

**Como será medida no Dia 7.** Não precisa medir. O teste é que grep de literais `6.3` e `9.0` fora de `anthropometry.ts` retorna zero, e a suíte continua verde.

**Mudança no código.** `P5.3` cria o módulo e migra os chamadores.

---

## ADR P4.4 — Biblioteca de correção de iluminação: OpenCV.js ou implementação própria

> Esta ADR não vem de um conflito C1–C9: ela é o **aceite da tarefa `P4.4`** do Sprint 4, que pede o registro da decisão e o **custo medido de cada opção**. Escrita depois de medir, não antes.

**Contexto.** O pedido é "usar uma ferramenta/biblioteca que deixe a iluminação mais ajustada" antes de a imagem virar feature. Existem três degraus possíveis, e eles não são intercambiáveis: constraints do MediaStream corrigem no **sensor**, antes da quantização; CLAHE e gama corrigem a **distribuição** do que já foi capturado; e o aviso ao cuidador corrige a **cena**. Só o primeiro adiciona informação.

**Decisão.** **Implementação própria**, em TypeScript puro: [src/preprocess/clahe.ts](../src/preprocess/clahe.ts) e [src/preprocess/gamma.ts](../src/preprocess/gamma.ts). **OpenCV.js fica rejeitado.** A escada de decisão vive em [src/preprocess/illumination.ts](../src/preprocess/illumination.ts), e o estágio inteiro entra **desligado por default** (`claheEyeRegion`, `dynamicGamma` em `experiment.ts`).

**Custo medido** — Node nesta máquina, p50 sobre 50 execuções após aquecimento de JIT, buffer 448²:

| Operação | p50 | p95 |
|---|---|---|
| CLAHE no crop 448² inteiro | **5,93 ms** | 7,36 ms |
| CLAHE só na região ocular (180×70) | **0,67 ms** | 0,81 ms |
| Gama (histograma + LUT + apply, 448²) | **2,67 ms** | 4,18 ms |
| Pipeline completo 448² (CLAHE + gama) | **12,16 ms** | 14,91 ms |
| Pipeline com CLAHE restrito aos olhos | **4,31 ms** | 6,32 ms |

| Opção | Custo de bundle | Custo por frame | Observação |
|---|---|---|---|
| Implementação própria | **0 KB** (≈420 linhas com os comentários) | 0,67–12,16 ms conforme a região | Determinística, sem DOM, roda no harness `T0.3` |
| OpenCV.js | **~8–10 MB de WASM** (não medido aqui — número da distribuição publicada) | não medido | Exigiria worker próprio e carga sob demanda; o app já carrega 91 MB de ONNX |

**Justificativa.**

1. **A estimativa da especificação estava errada por ~6×.** O plano dizia "~120 linhas sobre `Uint8ClampedArray` num crop de 448², e o custo é da ordem de 1 ms". O medido é **5,93 ms** para o crop inteiro. Isso não inverte a decisão sobre a biblioteca — inverte a decisão sobre **onde aplicar**.

2. **Daí a região ocular deixar de ser preferência e virar requisito de orçamento.** 12,16 ms é mais de um terço do orçamento de 33 ms por frame a 30 fps, num pipeline cujo gargalo declarado (C8) já é a latência. Restringir o CLAHE aos olhos custa 0,67 ms — 9× menos — e é onde o sinal está.

3. **Adicionar 8–10 MB de WASM para uma função de ~150 linhas não se paga.** O app já pede 91 MB de ONNX ao usuário; o público-alvo usa isto em casa, em conexões que não são de laboratório.

4. **A implementação própria é testável no harness.** Determinística, sem DOM, sem relógio — requisito de `T0.3`. OpenCV.js precisaria de mock ou de um worker no caminho de teste.

**O que a medição mudou no plano.** Duas coisas, ambas registradas:
- CLAHE passa a ser aplicado **só na região ocular** por padrão (`eyeRegion` em `applyPreprocessRGBA`), não no crop facial.
- O estágio nasce **desligado**. Com o gargalo em C8 ainda em aberto, ligar por default um estágio de 4–12 ms antes de `F8.4` medir o ganho de acurácia seria trocar latência conhecida por precisão hipotética.

**Conflito registrado (regra 6 do prompt de pipeline).** A especificação de `P4.5` pede CLAHE "apenas na região dos olhos, não no crop facial inteiro". Isso é claramente certo para o caminho de **landmarks**. Para o **L2CS** é discutível: o modelo enxerga o crop facial inteiro, e equalizar só um retângulo interno cria uma descontinuidade na fronteira que não existe em nada do conjunto de treino — entrada fora da distribuição, exatamente o que `P4.7` tenta evitar do outro lado. Não resolvi isso sozinho. Fica como pergunta para `F8.4`, com três condições a medir: (a) sem CLAHE, (b) CLAHE só nos olhos, (c) CLAHE no crop inteiro. O default (a) é o comportamento de hoje, então o custo de estar errado é zero.

**Como será medida no Dia 7.** Condição nova de `F8.4`, com as três variantes acima sob o protocolo `F8.1`. Métrica primária: erro médio e p90 na grade de validação 3×3. Métrica de custo: `stageLatency['preprocess.clahe']` e `['preprocess.gamma']` de `T0.5`. Critério de adoção: só entra por default se reduzir o erro **e** couber no orçamento de latência que `P5.5` estabelecer.

**Mudança no código.** Módulos novos em `src/preprocess/`; flags novas em `src/config/experiment.ts` com default `false`; ponto de entrada opcional em `cropFaceToTensor`. Nenhum caminho de produção muda enquanto as flags estiverem desligadas.

---

## Resumo em uma linha

| Conflito | Decisão |
|---|---|
| C1 (640×480) | Manter 1080p; flag para medir |
| C2 (L2CS 224² spec vs 448² código) | **Resolvido: ONNX reexportado com eixos DINÂMICOS** — um binário roda 224² e 448². Default 448 (resolução de treino); `F8.4` decide. O `228` era um `224` corrompido. |
| C3 (MPIIGaze+Gaze360) | Manter Gaze360 (sem pesos) |
| C4 (468 landmarks) | Manter 478 (íris é sinal primário) |
| C5 (PnP 6 pts) | Alternativa medida, não substituição |
| C6 (Ridge 11 feats) | Flag; default 6 dims até medição |
| C7 (EAR 0,18) | Implementar após `B2.6` |
| C8 (< 35 ms) | **Medido.** WASM: 2319 ms (inviável, 100% stale). **WebGPU: 50 ms, 0% stale.** Meta viável com WebGPU; o gargalo passou para o thread principal |
| C9 (6,3 cm) | Unificar em `anthropometry.ts` |
| P5.5a (tamanho do L2CS) | **Entrada dinâmica**; flag `l2csInputSize`, default 448; latência medida 78,3 ms → 21,4 ms (3,66×) |
| P4.4 (OpenCV.js vs. próprio) | **Implementação própria**; CLAHE restrito aos olhos (0,67 ms contra 5,93 ms); estágio desligado por default até `F8.4` |

**4 de 9 recomendações são "manter o código atual e tratar a especificação como hipótese a medir"** (C1, C3, C4, C6). C2 saiu desse grupo — foi resolvido como *migração ativa* para L2CS-Net 228². Nenhuma decisão é imutável — o Dia 7 é o árbitro final para as demais.
