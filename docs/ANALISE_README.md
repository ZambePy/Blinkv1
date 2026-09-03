# Análise do README.md vs. Código

> **Tarefa T0.1** do plano de sprints em `tasks.md`.
> **Commit de referência:** `a28bdb0`.
> **Metodologia:** cada afirmação deste documento cita `arquivo:linha`. Onde não foi possível confirmar por leitura direta, o texto usa "não verificado".

---

## 1. Pipeline como o README o descreve, mapeado ao código real

O bloco de arquitetura do README ([README.md:57-82](../README.md#L57-L82)) descreve nove estágios. A tabela abaixo mapeia cada um ao arquivo real de `src/` que o executa.

| # | Estágio (README) | Arquivo:linha real | Observação |
|---|---|---|---|
| 1 | Câmera (`getUserMedia`, 1920×1080) | [frontend/src/context/GazeContext.tsx:672-698](../frontend/src/context/GazeContext.tsx#L672-L698) | Constraints reais são `{width:1920,height:1080}`; ver bugs `B1.8` e `B2.12` sobre ciclo de vida. |
| 2 | Ajuste automático da câmera | [src/cameraTuner.ts](../src/cameraTuner.ts) | Lei de controle existe; ver `B3.14` sobre trava de zoom quando `caps.zoom.min===0`. |
| 3 | MediaPipe FaceLandmarker → 478 landmarks | [src/tracker/engine.ts](../src/tracker/engine.ts) (init MediaPipe), [src/extractor.ts:1-60](../src/extractor.ts#L1-L60) | Modelo em [frontend/public/mediapipe/models/face_landmarker.task](../frontend/public/mediapipe/models/face_landmarker.task) — 478 pontos com íris. |
| 4 | L2CS-Net (ONNX, Web Worker) → yaw/pitch @100 ms | [src/l2cs/l2cs.worker.ts](../src/l2cs/l2cs.worker.ts), [src/l2cs/client.ts](../src/l2cs/client.ts), meta em [frontend/public/models/l2cs/l2cs.meta.json](../frontend/public/models/l2cs/l2cs.meta.json) | **Entrada DINÂMICA desde 2026-09-03** (`P5.5a` executado): o ONNX aceita 224² e 448² no mesmo binário; a escolha é a flag `l2csInputSize`, default **448** (tamanho do export original; a resolução de TREINO não está registrada — ver ADR C2). 90 bins/eixo, NCHW RGB. Ver ADR C2 em [DECISOES_PIPELINE.md](DECISOES_PIPELINE.md). |
| 5 | `extractCompactFeatures` → 37 dims + bloco angular, projeção para 12 dims/olho | [src/extractor.ts:459-475](../src/extractor.ts#L459-L475), [src/featurePipeline.ts](../src/featurePipeline.ts) | **Divergência:** `ACTIVE_FEATURE_SET = 'irisCore+l2cs'` = **6 dims/olho** (não 12), pelas notas no próprio arquivo. |
| 6 | `EyeQualityAnalyzer` | [src/qualityAnalyzer.ts](../src/qualityAnalyzer.ts) | Ver `B3.2`/`B3.3` sobre landmarks degenerados. |
| 7 | Calibração (grade por excentricidade, Ridge Σ_W, LOO-Target CV) | [src/calibration.ts](../src/calibration.ts), [src/ridge.ts](../src/ridge.ts) | Grade por excentricidade real; ver `B2.7` sobre `foldStandardizer`. |
| 8 | `OneEuroFilter2D` → suavização adaptativa | [src/oneEuroFilter.ts](../src/oneEuroFilter.ts) | Ver `B2.15`: presets derivados de cálculo de `alpha` errado por ~5×. |
| 9 | GazeContext (React) → Dwell / Navegação / Emergência | [frontend/src/context/GazeContext.tsx](../frontend/src/context/GazeContext.tsx), [src/interaction/dwell.ts](../src/interaction/dwell.ts), [frontend/src/context/EmergencyContext.tsx](../frontend/src/context/EmergencyContext.tsx) | Ver `B1.9` sobre o banner "Recalibre aqui" inclicável em `degraded`. |

---

## 2. Tabela de divergências README × código

Toda afirmação do README que a leitura do código **não confirma** ou confirma parcialmente. Cada linha cita a evidência.

| # | Afirmação do README | Evidência no código | Status |
|---|---|---|---|
| D1 | "Recorte facial 448×448 normalizado (ImageNet)" ([README.md:43](../README.md#L43)) | [l2cs.meta.json:5](../frontend/public/models/l2cs/l2cs.meta.json#L5) — `inputSize: 448`. Confirma o estado atual. | ✅ **Resolvido em `P5.5a`.** O `README.md:43` foi atualizado: a entrada é dinâmica (224² ou 448²), com 448 como default. O `inputSize` do meta passou a ser o tamanho de REFERÊNCIA — o operacional é deduzido do próprio tensor pelo worker. |
| D2 | "478 landmarks 3D normalizados [0..1]" ([README.md:63](../README.md#L63)) | [src/extractor.ts:459-475](../src/extractor.ts#L459-L475) usa índices que exigem íris (indices 468–477). | ✅ Confere. **Conflito com especificação nova** (C4: pede 468 sem íris). |
| D3 | "extractCompactFeatures → vetor completo (37 dims + bloco angular), projeção 12 dims/olho" ([README.md:68-71](../README.md#L68-L71)) | [src/config/experiment.ts:106-113](../src/config/experiment.ts#L106-L113): `ACTIVE_FEATURE_SET = 'irisCore+l2cs'` = **6 dims/olho** (índices [0,1,2,3,37,38]). | ❌ Divergência ativa. README fala em 12 dims; código produz 6. |
| D4 | "OneEuroFilter2D → suavização adaptativa jitter × lag" ([README.md:79](../README.md#L79)) | [src/oneEuroFilter.ts:128-160](../src/oneEuroFilter.ts#L128-L160) existe, mas presets `balanceado`/`balanceado-v2` foram derivados de cálculo de `alpha` errado (ver `B2.15` em `tasks.md`). | ⚠️ Existe, parametrização incorreta. |
| D5 | "Ajuste automático da câmera em malha fechada" ([README.md:37](../README.md#L37)) | [src/cameraTuner.ts:197-216](../src/cameraTuner.ts#L197-L216) — malha existe, mas trava quando `caps.zoom.min === 0` (ver `B3.14`). | ⚠️ Parcialmente. Trava em drivers comuns. |
| D6 | "Verificação de prontidão ao vivo — distância, enquadramento, postura, iluminação, contraste, reflexo, cintilação" ([README.md:38](../README.md#L38)) | `grep evaluateReadiness \| aggregateSnapshots` retorna apenas `setupReadiness.ts` e `setupReadiness.test.ts` — **nenhum chamador de produção** (ver `B3.16`). | ❌ Módulo existe mas nunca é executado em runtime. |
| D7 | "A diagonal do monitor vem do EDID, não de digitação" ([README.md:39](../README.md#L39)) | [electron/main.ts:28](../electron/main.ts#L28) contém `-Namespace root\wmi` em string JS: `\w` não é escape reconhecido → colapsa para `rootwmi` → PowerShell erra sempre → `resolve([])`. **Nunca funcionou.** (ver `B2.11`) | ❌ Bug crítico. Diagonal fica no default 23,6″. |
| D8 | "Ângulos implausíveis são rejeitados, não clampeados" ([README.md:66](../README.md#L66)) | Rejeição existe em `isGazePlausible`, mas com fallback silencioso na média circular ausente (ver `B3.1`). | ⚠️ Parcial. |
| D9 | "Frames ruins são filtrados antes de armazenar" ([README.md:73](../README.md#L73)) | [src/qualityAnalyzer.ts:61-82](../src/qualityAnalyzer.ts#L61-L82) devolve `{brightness:0, blur:1, ...}` (aparentemente medido) quando landmarks são degenerados (ver `B3.2`). | ⚠️ Filtro fraco. |
| D10 | "Loop rAF principal, estados e diagnósticos" ([README.md:90](../README.md#L90) sobre `engine.ts`) | Loop existe, mas `getDiagnostics()` mistura FPS de dois cronômetros (`B3.26`) e `stop()` não zera nada (`B1.7`). | ⚠️ Diagnósticos com bug. |
| D11 | "Calibração online — `feedOnlineSample` disparado em todo dwell click" (comentário em [src/calibration.ts:91](../src/calibration.ts#L91)) | `grep feedOnlineSample` em `frontend/src/context/GazeContext.tsx` mostra que o ramo `outcome.effect.type === 'click'` **não** chama a função (ver `B2.14`). | ❌ Código morto. |
| D12 | "Treino via Web Worker elimina freeze de UI" ([src/config/experiment.ts:87-93](../src/config/experiment.ts#L87-L93)) | [src/calibration/client.ts:55](../src/calibration/client.ts#L55) — `createCalibrationClient` só é chamado em teste (ver `B3.10`). | ❌ Caminho morto na produção. |
| D13 | "Todo processamento local; nenhuma imagem sai do dispositivo" ([README.md:21](../README.md#L21), [README.md:249](../README.md#L249)) | Nenhuma chamada `fetch`/`XMLHttpRequest`/socket para servidor externo no núcleo. `readMonitorSizes` só toca `powershell.exe` local. | ✅ Confere. |
| D14 | "Grade de validação disjunta da de treino, com guarda" ([README.md:208](../README.md#L208)) | Guarda `checkValidationOverlap` existe; ver `B3.8`: guarda recebe subset (`VALIDATION_POINTS`, 9) em vez do conjunto completo (`ALL_VALIDATION_POINTS`, 13). | ⚠️ Guarda existe, mas com escopo reduzido. |
| D15 | "Erro em pixels depende do tamanho da tela, e erro angular depende da distância — o relatório grava as condições medidas" ([README.md:227](../README.md#L227)) | `RunMeta` grava `screenDiagonalIn`, mas o campo `screenGeometrySource` não é propagado ao JSON (ver `B2.10`) — o relatório sai com `assumed:false` sobre a diagonal padrão. | ⚠️ Meta incompleta. |

**Resumo:** o README descreve com honestidade o que o projeto **pretendia** fazer. Metade das promessas ainda vale (D1, D2, D13, D14 parciais). A outra metade sofre de bugs específicos (D3–D12, D15), a maioria já listada em `tasks.md`.

---

## 3. Onde cada etapa do pipeline novo se encaixa

Cada linha diz **em qual arquivo** a etapa da especificação nova entra, e **qual arquivo é criado**. Toda entrada é atrás de flag em `src/config/experiment.ts`, com o comportamento antigo preservado.

| Etapa nova | Modifica | Cria | Flag proposta | Task |
|---|---|---|---|---|
| 1 — Captura (ring buffer + worker) | `frontend/src/context/GazeContext.tsx`, `src/tracker/engine.ts` | `src/capture/frameRing.ts`, `src/capture/captureWorker.ts` | `captureRingBuffer`, `captureWorker` | `P4.1`, `P4.2` |
| 1b — Exposição manual | `src/cameraTuner.ts` | — | `lockCameraExposure` (existe) | `P4.3` |
| 2 — CLAHE + gama na região dos olhos | `src/tracker/engine.ts` (chamada) | `src/preprocess/clahe.ts`, `src/preprocess/gamma.ts`, `src/preprocess/illumination.ts` | `preprocess.clahe`, `preprocess.gamma` | `P4.4`, `P4.5`, `P4.6` |
| 2b — ROI dinâmico + skip | `src/tracker/engine.ts` | `src/preprocess/roiCache.ts` | `roiCache` | `P4.8` |
| 3 — Face Mesh 478 grupos nomeados | `src/extractor.ts` | — | (constantes; sem flag) | `P5.1` |
| 3b — Head pose PnP alternativo | `src/extractor.ts` | `src/pose/solvePnP.ts` | `headPoseSource: 'matrix'\|'pnp'` | `P5.2` |
| 3c — Constante antropométrica unificada | `src/setupReadiness.ts`, `src/cameraTuner.ts:350`, `src/distanceCompensation.ts` | `src/anthropometry.ts` | (sem flag; refator) | `P5.3` |
| 3d — EAR normalizado + threshold 0.18 | `src/extractor.ts` | — | `earIsotropic` | `P5.4` (dep. `B2.6`) |
| 4 — L2CS entrada configurável (224²/448²) ✅ **feito** | `frontend/public/models/l2cs/l2cs_gaze360.onnx`, `.../l2cs.meta.json`, `src/l2cs/crop.ts`, `src/l2cs/l2cs.worker.ts`, `src/tracker/engine.ts`, `src/l2cs/inputSize.test.ts`, `README.md` | ONNX reexportado com eixos espaciais dinâmicos (mesmos pesos) | `l2csInputSize` (default **448**) | **`P5.5a`** — executado em 2026-09-03 |
| 4 — L2CS latência (webgpu, cache `ortApi`) | `src/l2cs/l2cs.worker.ts`, `src/l2cs/client.ts` | — | `l2cs.executionProvider: 'wasm'\|'webgpu'` | `P5.5` (mede nos dois tamanhos; em CPU já medido 78,3 ms @448 contra 21,4 ms @224) |
| 4b — Gate de confiança + média circular | `src/l2cs/decode.ts`, `src/l2cs/block.ts` | — | `l2cs.confidenceGate` | `P5.6`, ver `B3.1` |
| 5 — Compensação aditiva em ângulo | `src/calibration.ts`, `src/tracker/engine.ts` | `src/pose/absoluteGaze.ts` | `poseCompensationMode: 'geometric'\|'additive'\|'both'` | `P5.7` |
| 5b — Referência neutra dinâmica | `src/pose/absoluteGaze.ts`, `src/calibration.ts` | — | `poseReference.dynamic` | `P5.8` |
| 6 — Kalman 2D | `src/tracker/engine.ts` (composição) | `src/filters/kalman2d.ts` | `filterMode: 'oneEuro'\|'kalman'\|'kalmanEma'` | `P6.1` |
| 6b — EMA adaptativo | idem | `src/filters/adaptiveEma.ts` | idem | `P6.2` |
| 6c — Hold on blink | `src/tracker/engine.ts`, `src/filters/` | — | `filter.holdOnBlink` | `P6.3` (dep. `P5.4`) |
| 6d — Dead zone | `src/filters/deadZone.ts` | — | `filter.deadZone` | `P6.4` |
| 7 — Vetor de 11 features (spec) | `src/extractor.ts`, `src/config/experiment.ts` | — | `featureSet: 'spec11'` | `P6.5` (dep. `B2.9`, ver conflito C6) |
| 7b — LOOCV alternativo ao LOTO | `src/ridge.ts` | — | `cvMode: 'loto'\|'loo'` | `P6.6` (dep. `B2.7`, `B3.9`) |
| 7c — RLS online | `src/recursiveRidge.ts` | — | `USE_ONLINE_CALIBRATION` (existe) | `P6.7` (dep. `B2.8`, `B2.14`) |
| 8 — Auditar normalização/desnormalização | `src/calibration.ts`, `src/ridge.ts`, `src/kernelRidge.ts` | — | (sem flag; corrige `B2.9`, `B3.20`, `B3.32`) | `P6.8` |
| 8b — Aviso de fora de faixa de distância | `src/distanceCompensation.ts`, `frontend/src/components/GazeStatusBanner.tsx` | — | (sem flag; corrige `B1.4`) | `P6.9` |
| 9 — UI: cursor, dwell, piscada, scanning, fallback | `frontend/src/**` | `frontend/src/components/ScanningMode.tsx` | vários | `P7.1`–`P7.6` |
| 9b — Harness E2E do pipeline | `src/testUtils/pipelineHarness.ts` (criado em `T0.3`) | — | — | `P7.6` |

**Mapa em texto (grafo mental):**
```
Captura ─┬─ FrameRing ─→ CaptureWorker ─┐
         │                              ├─→ ROI cache ─→ CLAHE ─→ γ ─→ [L2CS 448²] ─→ decode gate
         └── camera control (existente) │                                                    │
FaceMesh 478 ────────────────────────────┘                                                    ├─→ features 6 ou 11
Head pose (matrix|PnP) ─────────────────────────────────────────────────────────────────────┘
                                                                                              │
                                                                                              ▼
                            Ridge σW (LOTO ou LOO) + RLS online ──→ pose comp (geom|additive)
                                                                                              │
                                                                                              ▼
                     Filtro (OneEuro|Kalman|Kalman+EMA) ──→ deadZone ──→ holdOnBlink ──→ render
```

---

## 4. Invariantes que o pipeline novo **não pode quebrar**

Estes são os compromissos do projeto que precedem a especificação nova. Nenhuma tarefa `P*`/`F*` pode violá-los sem decisão explícita registrada em `docs/DECISOES_PIPELINE.md`.

1. **Privacidade 100% local.** Nenhuma imagem, landmark, feature, perfil de calibração ou telemetria sai do dispositivo ([README.md:21](../README.md#L21), [README.md:247-249](../README.md#L247-L249)). Nova dependência que exija network I/O é bloqueio.
2. **Núcleo `src/` sem DOM.** Todo módulo em `src/` é TypeScript puro, testável em vitest sem navegador. DOM só em `frontend/src/**` e `electron/`. Regra sustenta o tempo de teste (139 s para 596 casos).
3. **Alvos de calibração por orçamento de excentricidade angular.** Posição dos alvos vem de `d·tan(16°)` clampado por `MIN_EXTENT_FRACTION = 0.22` — nunca frações fixas de tela ([README.md:31](../README.md#L31), `src/calibration.ts`).
4. **Grade de validação deliberadamente disjunta da de treino.** Sobreposição é reportada, nunca ignorada ([README.md:208](../README.md#L208), `checkValidationOverlap` — ver `B3.8` para o bug de escopo do check).
5. **Nada de fabricar medição.** `qualityAnalyzer` devolve `{}` em vez de zeros; `cameraTuner` informa qual ação física é necessária quando o driver não expõe; o relatório grava condições medidas junto com o resultado. Todo módulo novo herda essa postura — em caso de dúvida, marcar `undefined`, não zero.
6. **Ciclo de vida completo.** `start()` idempotente; `stop()` reversível; `dispose()` libera WASM/GPU. Bugs `B1.6`/`B1.7`/`B1.8` violam isto hoje — o pipeline novo tem que reforçar o contrato, não copiá-lo.
7. **Comportamento novo entra atrás de flag em `src/config/experiment.ts`**, com o comportamento antigo como default até o benchmark do Dia 7 dizer o contrário. Sem isso o Sprint 8 não tem A/B.
8. **`FEATURE_VECTOR_ID` codifica toda mudança que afete a semântica do vetor de features.** Um perfil de vetor A não pode carregar sobre um vetor B. Ver `B2.9` — hoje `expandFactor`, `polynomialFeatures` e `enableL2CS` não estão codificados na chave.
9. **Nenhum `catch` novo silencia erro sem registrar em `EngineDiagnostics`.** Fallback silencioso é o padrão de defeito dominante do repositório (item da avaliação I.3).
10. **Documentação corresponde ao código.** Comentário que descreve comportamento inexistente é pior que ausência. Se a documentação divergir do código, atualizar a documentação.
11. **Alvo-usuário (ELA/ALS) mantém autonomia em degradado.** A saída de recuperação (`data-recovery`) precisa ser alcançável só pelo olhar — mesmo em `degraded` (ver `B1.9`, `P7.4`).

---

## 5. Notas de leitura não confirmáveis

Itens onde a leitura estática do código foi inconclusiva e ficam registrados como *não verificado* nesta análise:

- **BrowserRouter + `file://` no build empacotado** (`B2.12`): o par é incompatível por construção, mas o build de produção não foi executado nesta rodada.
- **Latência real do L2CS em WASM single-thread**: `l2cs.meta.json:18` diz 99 ms mas é `onnxruntime-node`. Números reais no browser dependem de execução (task `P5.5` faz a medição).
- **Delta exato entre `axisScale` estático do worker de calibração e o de produção** (`B3.10`): o caminho é morto (`createCalibrationClient` só em teste), então o comportamento observável hoje é irrelevante — a nota fica para quando o caminho for ativado.

---

## 6. Referência cruzada com `tasks.md`

Este documento é insumo obrigatório para toda tarefa `B*` e `P*`. Cada bug listado em `tasks.md` §Sprint 1–3 tem sua evidência mapeada aqui na seção 2. Cada etapa nova em §Sprint 4–7 tem sua entrada na seção 3. Antes de abrir PR em qualquer `B*.n`/`P*.n`, o executor deve reler a linha correspondente destas duas seções.
