# Auditoria — Sprint 0

> Estado do repositório em `f9d9252` (tag `v0-melhor-erro`). Consertar nada
> ainda: só documentar o que está e o que não está.

---

## A0-2 — Compilação e testes

Executado em 2026-08-18, Windows 11, Node de acordo com `package.json`
engines-implícito.

| Comando | Resultado | Notas |
|---|---|---|
| `npm install` | ✅ passou | 390 pacotes auditados, 0 removidos/adicionados; 7 vulnerabilidades (1 moderate, 6 high) reportadas. Nenhum erro de instalação. |
| `npm --prefix frontend install` | ✅ passou | 198 pacotes, 1 high vuln, aviso de peer conflict com `vite@7.3.6` requerido por `@vitest/mocker@3.2.7`. Não bloqueia. |
| `npm test` | ✅ passou | 12 arquivos, **69 testes**, todos verdes. 4,87 s. |
| `npm run build` | ✅ passou | Vite build em 4,29 s. Aviso de plugin timings (css-post 30%, worker 26%). Bundle principal `index-*.js` 210 kB / 66,5 kB gzip. |
| `npm run electron:compile` | ✅ passou | `dist-electron/main.cjs` (2,7 kB) e `preload.cjs` (806 B) em 7 ms. |

**Conclusão:** o repositório está saudável no ponto `v0-melhor-erro`. Nenhum
conserto necessário para desbloquear o Sprint 0. Vulnerabilidades de `npm
audit` ficam fora do escopo desta fase (correção de dependência pode mexer em
comportamento — regra 4 do plano).

### Ações não-bloqueantes registradas para depois

- Revisar 7 vulnerabilidades do root e 1 do frontend (`npm audit`) — decidir
  se cabem no sprint de higiene A3.
- Investigar peer conflict `vite@7.3.6` × `@vitest/mocker` — pode virar bug
  latente se `vite` ou `vitest` subirem de versão.

---

## A0-3 — Degradação silenciosa

Varredura em `src/` e `frontend/src/` por `catch`, `return null`,
`return { x: 0, y: 0 }`, `?? 0`, `|| 0`.

Legenda de severidade:
- 🔴 **Crítico** — pode fazer o sistema afirmar sucesso sob falha, ou entregar
  dado sem-sentido para o usuário. É o que a regra 1 do plano proíbe.
- 🟡 **Alerta** — degrada silenciosamente uma métrica ou uma feature acessória
  sem afetar o caminho principal.
- 🟢 **Aceitável** — falha benigna (persistência opcional em `localStorage`,
  parse de arquivo externo) com log próprio ou com fallback declarado.

### Já confirmados pelo plano (verificação neste commit)

| Local | Status | O que pode falhar | O que acontece hoje | Usuário percebe? | Sev. |
|---|---|---|---|---|---|
| `src/calibration.ts:487-495` | ✅ confere | `trainScalersAndRegressors` lança (ex.: matriz singular por óculos) | `catch` loga `[calib] Erro fatal no treinamento`; `finally` chama `onComplete()`. `regressorLeft/Right` continuam com valor anterior/`null`. **`isCalibrated()` pode voltar `false`, mas a UI já foi para "Concluída".** | Não — vê "Calibração Concluída" | 🔴 |
| `src/tracker/engine.ts:472-477` | ✅ confere | `calibration.mapGaze` devolve `null` (regressor não treinado, dimensão errada, `predict` lança) | Cai no fallback do nariz: `targetX = (1 − landmarks[1].x) * vw; targetY = landmarks[1].y * vh`. Sem log, sem mudança de estado. | Não — cursor "funciona", mas está sobre o nariz | 🔴 |
| `src/calibration.ts:418-422` | ✅ confere | Variância acima do limiar | `console.warn('[calib] ✗ Ponto instável — aceitando mesmo assim')` — ponto entra no perfil de treino. Portão é **unilateral** (só alto). Variância baixa (óculos) passa como se fosse boa. | Não | 🔴 |

### Novos achados na varredura

| Local | O que pode falhar | O que acontece hoje | Usuário percebe? | Sev. |
|---|---|---|---|---|
| `src/calibration.ts:593-603` (`mapGaze`) | `regressor.predict` lança (dim mismatch, NaN, etc.) | `catch (e)` loga uma vez (`_dimErrorLogged`), depois **silencia todas as próximas exceções** e devolve `null`. Combinado com `engine.ts:472`, produz cursor no nariz sem sinal. | Não | 🔴 |
| `src/ridge.ts:199-201` (`RidgeRegressor.predict`) | `this.model === null` (chamado antes de treinar) | `return { x: 0, y: 0 }` — canto superior esquerdo da tela. Sem log. | Sim, mas atribui a "bug qualquer" — não a "não calibrado" | 🔴 |
| `src/kernelRidge.ts:197-199` (`KernelRidgeRegressor.predict`) | Sem modelo, ou dimensão de features errada | `return { x: 0, y: 0 }`. Sem log. | Idem | 🔴 |
| `src/recursiveRidge.ts:62` (`predict`) | Dimensão de features errada | `return { x: 0, y: 0 }`. Sem log. | Idem | 🟡 (só ativo com `USE_ONLINE_CALIBRATION`) |
| `src/oneEuroFilter.ts:29` | Filter chamado antes de qualquer amostra (`y === null`) | `return this.y ?? 0` — devolve **0**, não a primeira amostra. Puxa o cursor para a origem no boot. Confirma o defeito descrito em A2-2 do plano. | Sutil, salto no primeiro frame | 🟡 |
| `src/accuracy.ts:359-364` | `localStorage.setItem` lança (quota, modo privado) | `catch (_) {}` — resultado do teste de acurácia não é persistido, tela seguinte não acha `accuracyResult`. Sem log. | Sim (não vê o número), mas pensa que "não rodou" | 🟡 |
| `src/accuracy.ts:407-418` | Endpoint `POST /__/save-accuracy-report` off (build de produção, offline) | Loga um warn e faz download via blob. **Fallback declarado.** | Não, comportamento é intencional | 🟢 |
| `src/accuracy.ts:296-300` | Divisão de 0 amostras ou índice inexistente | `|| 0` mascara todos os edge cases de 0 amostras / NaN. Um relatório vazio sai como "erro 0" — parece **perfeito**. | Sim — número absurdo é lido como sucesso | 🔴 |
| `src/accuracy.ts:576` | `hitRateByRadius.find(r=>r.radiusPx===150)?.pct` indefinido | `|| 0` renderiza "0%" — indistinguível de "150 px não tem nenhum acerto". | Sim, ambíguo | 🟡 |
| `src/calibration.ts:490-495` (`completeCalibration`) | (já listado acima) | (já listado acima) | (já listado acima) | 🔴 |
| `src/calibration.ts:500-505` (`init` — leitura de `accuracyResult`) | `localStorage.getItem` lança | `catch (_) {}`. Efeito colateral zero (o corpo é vazio hoje), mas cria hábito ruim. | Não | 🟢 |
| `src/qualityAnalyzer.ts:154-157` | Canvas tainted por vídeo cross-origin | `catch (_)` devolve só `detectorConfidence` (sem brightness/blur). Sem log, mas comportamento **declarado** no comentário e degradação controlada. | Não | 🟡 |
| `src/ridge.ts:184-186` (`solveLambdaCV`) | Modelo lança durante CV de lambda | `totalError += Infinity` — lambda descarta esse candidato. Comportamento correto, sem log. | Não | 🟢 |
| `src/tracker/engine.ts:413-417` (crop L2CS) | `getImageData` taint / vídeo não pronto | `console.warn('[L2CS] crop failed:', e)` — logado, e L2CS anexa `null` no frame (comportamento declarado). | Não | 🟢 |
| `src/l2cs/l2cs.worker.ts:107-119` | Init/infer do worker lança | Devolve `init_error` / `infer_error` para o main thread. Falha propagada, não engolida. | Depende do main tratar — auditar em A0-4/A1 | 🟢 |
| `src/config/experiment.ts:38-46` | `JSON.parse` de storage corrompido | Devolve defaults. Sem log. Comportamento intencional (defaults são conservadores). | Não | 🟢 |
| `src/telemetry/recorder.ts:106-121` | JSON linha inválida em arquivo de recording | Devolve `null` — replay não roda com gravação parcial. Comentário explícito. | Sim, mas informa "arquivo inválido" | 🟢 |
| `frontend/src/context/GazeContext.tsx:183-185` | `feedOnlineSample` lança | `catch (e) {}` **totalmente vazio, sem log.** Recalibração online é otimização (comentário), mas ao menos um warn one-shot seria útil para saber se está sempre falhando. | Não | 🟡 |
| `frontend/src/context/GazeContext.tsx:247-252` | Subscriber de gaze lança | `console.error('[GazeContext] subscriber threw', e)` — outros subscribers continuam. **Correto.** | Sim se afetar UI, log presente | 🟢 |
| `frontend/src/context/GazeContext.tsx:290-294` | `video.play()` lança | Warn logado. Vídeo pode ficar parado — engine start ainda ocorre. Sintoma: face-count = 0 sem explicação. | Sim (cursor sumido) — log presente mas obscuro | 🟡 |
| `frontend/src/context/GazeContext.tsx:299-303` | Falha ao pegar câmera ou iniciar engine | `console.error('[IrisFlow] Falha ao inicializar câmera/engine:', err)`. **Nenhum estado de erro na UI.** Usuário fica com tela normal e cursor sumido. | Sim (cursor sumido, sem explicação visível) | 🔴 |
| `frontend/src/utils/api.ts:28, 56` | Requisição HTTP falha | Um devolve `null`, outro devolve `[]`. Um erro de rede vira "não há dados" na UI. | Sim, mas indistinguível de "nada existe" | 🟡 |
| `frontend/src/pages/ai/ChatbotScreen.tsx:38` | Chamada de IA falha | Mostra mensagem de erro na conversa. **Correto.** | Sim | 🟢 |
| `frontend/src/context/AuthContext.tsx:35` | Parse de token quebrado | `catch {}` — usuário fica deslogado. Sem log. | Sim (relogin) | 🟡 |
| `frontend/src/pages/core/MyOptionsScreen.tsx:19` | Storage falha | `catch {}` silencioso — perde configuração. | Sim | 🟡 |
| `frontend/src/pages/caregiver/IAmOkScreen.tsx:21` | API falha | Toast/alert de erro. | Sim | 🟢 |
| `frontend/src/pages/caregiver/CaregiverDashboard.tsx:41` | Fetch de métricas falha | `catch {}` sem log — dashboard fica com dados vazios. | Sim, mas ambíguo | 🟡 |
| `frontend/src/pages/output/EmergencyEscalation.tsx:46` | **Chamada de `sendHelpAlert` falha** | `.catch((e) => { ... })` (auditar o corpo — se é só log, o pedido de ajuda pode não chegar sem o cuidador saber). | **Sim — potencialmente crítico**, ver B4-1 | 🔴 |
| `frontend/src/pages/SettingsScreen.tsx:190` | Salvar setting falha | Log de erro. | Sim | 🟡 |

### Onde a regra 1 é mais violada

Ordenando por gravidade dentro da 🔴:

1. **`calibration.ts:487` + `mapGaze:602` + `engine.ts:472` + `ridge.ts:200` — o "sistema afirma que funciona".** Todo o Sprint 1 (A1-1 a A1-4) já ataca esses quatro pontos. Confirma que a hipótese do plano está exatamente calibrada nesse commit.
2. **`accuracy.ts:296` — relatório de acurácia com `|| 0`.** O número que você usa para decidir "melhorou ou piorou" pode ser 0 por bug, não por acerto. Merece uma tarefa própria na fase de medição.
3. **`GazeContext.tsx:302` — falha na câmera não sobe pra UI.** É o mesmo padrão do bug dos óculos, só que ainda mais cedo. Deveria ir junto com A1-1: "estado 'câmera indisponível' visível ao cuidador".
4. **`EmergencyEscalation.tsx:46` — `catch` no envio de alerta.** Auditar em B4-1: precisa de retry, confirmação visual e escalonamento se o request falhar.

### Falsos positivos (aparecem no grep mas são benignos)

- `src/calibration.ts:154` — `?? 0` em `model.lambda` (sensível: default de 0 significa "sem regularização"; mas o caminho é só telemetria)
- `src/tracker/engine.ts:631, 707, 708` — `?? 0` em métricas de telemetria (latência, dimensões de vídeo). Falha benigna.
- `src/qualityAnalyzer.ts:90` — `?? 0` em coordenada z (MediaPipe já garante). Benigno.
- `src/calibration.quality.test.ts:78` — teste.

---

## A0-4 — Estado mutável de módulo

Escopo: `let` (e `const` de array/Map mutáveis) declarados no **top-level de
módulo** de `src/`. Estado dentro de factories (`createGazeEngine`,
`createL2CSClient`) é per-instância e não conta como global.

Verificado com `grep -n "^let " src/**/*.ts` e leitura por arquivo.

### `src/extractor.ts` — o mais grave

| Variável | Escrita | Leitura | Reset? | Se não resetar |
|---|---|---|---|---|
| `earHistory: number[]` (linha 105) | `earHistory.push(ear)` em cada frame (linha 234), com `shift()` acima de 50 (`EAR_HISTORY_LEN`) | `meanEar = ...reduce(...)` na linha 241, gera limiar `thr = meanEar × 0,8` (linha 242) | **Nunca.** Não existe `reset()` exportado. Sobrevive a: recalibração, troca de perfil, mudança de tela, F5 no dev-server. | **Deriva de precisão descrita em A2-4.** Fadiga faz o EAR cair → média cai → limiar cai → menos piscadas detectadas → frames semi-fechados entram no regressor. Progressivo e invisível. |

### `src/calibration.ts` — estado da calibração

Todos são `let` de módulo, resetados manualmente por `clearCalibration()`
(linha 138), `startCalibrationMode()` (linha 243) e `loadProfile()` (linha
159). Não existe um `reset()` único; três caminhos parciais.

| Variável | Escrita | Leitura | Reset em… | Se não resetar |
|---|---|---|---|---|
| `profile: CalibrationPoint[]` (101) | `.push` em `processStaticPoint`, atribuído em `startCalibrationMode` e `clearCalibration`. | `trainScalersAndRegressors`, `getSampleCount`. | `startCalibrationMode`, `clearCalibration`. **Não** em `loadProfile` (por design — perfil salvo entra por outro caminho). | Segunda calibração acumula pontos da primeira se não for chamado o start. |
| `isCalibrating: boolean` (102, **exportado**) | `startCalibrationMode = true`; `completeCalibration = false`. | Consumido por `startCollectingPoint`, `mapGaze` e por UI. | Só em `completeCalibration`. | Se `completeCalibration` não rodar (ex.: user aborta com ESC), fica em `true` — bloqueia próximo start; sintoma: "startCollectingPoint chamado mas isCalibrating=false — ignorando" invertido, ou UI presa em "calibrando". |
| `isCollecting: boolean` (103) | `startCollectingPoint = true`; `processStaticPoint` e `completeCalibration = false`. | `feedRawData` (gate para acumular), `mapGaze`. | Vários caminhos. | Coleta zumbi acumulando features do ponto anterior. |
| `regressorLeft/Right: GazeRegressor \| null` (122-123) | Em `trainScalersAndRegressors` (linhas 454-457). Set a `null` em `clearCalibration`, `startCalibrationMode`, `loadProfile`. | `mapGaze` (linha 586), `ridgeModelFromRegressor`. | 3 caminhos acima. | **É a raiz do bug dos óculos:** se `trainScalersAndRegressors` lançar, `completeCalibration` engole no `catch` (487); mas se antes disso `startCalibrationMode` já zerou os regressors, ficam `null` para sempre — daí `mapGaze === null` para sempre — daí fallback do nariz. |
| `onlineLeft/Right: RecursiveRidgeRegressor \| null` (131-132) | Set em `trainScalersAndRegressors`. `null` em muitos lugares. | `mapGaze` para blend com RLS quando `USE_ONLINE_CALIBRATION`. | Junto com regressors offline. | Blend com peso ~0.5 vezes valor obsoleto → discrepância silenciosa entre sessões. |
| `scaledProfileLeft/Right: number[][]` (127-128) | Escrita em `trainScalersAndRegressors`. | Não achei leitor externo — parece cache/telemetria. | Nunca zerado; realocado em cada treino. | Baixo risco isolado; pode segurar amostras antigas em memória. |
| `poseDriftRejects: number` (99) | Incrementado em `processStaticPoint`. | Logado no mesmo. | Não zerado entre pontos! | Contador acumulado entre pontos; log fica com números crescentes que dão impressão errada da estabilidade do ponto atual. **Bug menor de diagnóstico.** |
| `currentPointBaselinePose` (98), `collectedFeaturesLeft/Right/Qualities` (105-107), `currentTargetX/Y` (109-110), `currentCollectionMs` (111), `pointCompleteCallback` (112), `collectionTimeoutHandle` (113) | Ciclo de vida do ponto atual, escrito em `startCollectingPoint` e limpo em `processStaticPoint`/timeout. | `feedRawData`, `processStaticPoint`. | Sim, no fim de cada ponto. | Ok em fluxo feliz; sujeito a ficar preso se exceção quebrar o ciclo. |
| `distanceLog: GazeDistanceLogEntry[]` (83, `const` mutável) | `.push` em `mapGaze` quando `EXPERIMENT.enableDistanceLog`. | `exportGazeDistanceLog`. | Nunca. | Cresce sem limite em sessões longas com o flag ligado. Baixo risco (flag off por default). |
| `_gazeCorrections: GazeCorrection[]` (129) | `setGazeCorrections`. | Consumido em `mapGaze`. | Substituído em cada set. | Ok. |
| `_dimErrorLogged: boolean` (580) | Toggle no `catch` de `mapGaze`. | O próprio `mapGaze`. | Reseta a `false` no primeiro frame feliz. | Ok em fluxo saudável; **em fluxo degradado permanente, esconde exceções repetidas** — é o achado 🔴 de A0-3. |
| `lastDecision: RecordedSampleDecision \| null` (114) | Escrita em `processStaticPoint`, consumida por `consumeLastSampleDecision`. | O consumidor. | Consumo zera. | Ok. |

### `src/accuracy.ts`

| Variável | Escrita | Leitura | Reset? | Se não resetar |
|---|---|---|---|---|
| `currentFeaturesLeft/Right: number[]` (96-97) | `feedAccuracyRaw` a cada frame. | `runNextPoint` para snapshot. | Substituído a cada frame. | Ok em fluxo, mas nunca zerado entre testes de precisão → primeira amostra do segundo teste usa features do fim do primeiro. |
| `isAccuracyTesting: boolean` (101, **exportado**) | `startAccuracyTest = true`; em `runNextPoint` (quando acaba os pontos) `= false`. | `GazeContext.tsx` (esconde o cursor); `main.ts` (histórico de log). | Sim. | Se `startAccuracyTest` for chamado e a UI fechar antes de acabar (unmount, navegação, exceção), fica `true` para sempre → **cursor invisível pelo resto da sessão sem explicação.** 🟡 |
| `currentValidationTarget` (106) | Set em `runNextPoint`; limpo em `null` no fim. | `getCurrentTargetPx` (gravador). | Só no fim do teste. | Análogo a `isAccuracyTesting`; gravador continua marcando o último alvo como "ativo" se o teste morrer no meio. |

### `src/telemetry/recorder.ts`

| Variável | Escrita | Leitura | Reset? | Se não resetar |
|---|---|---|---|---|
| `active: boolean` (28) | `start`/`stop`. | Toda função de gravação. | Sim. | Ok. |
| `header: RecordingHeader \| null` (29) | `start = {...}`; `stop = null` | `pushFrame`, `serialize`. | Sim. | Ok. |
| `frames: RecordedFrame[]` (30) | `.push`; `stop = []` | `serialize`. | Sim, no `stop`. | Cresce sem limite — sessão longa gravada estoura memória. Baixo risco (gravação é curta). |
| `dropped: number` (31) | Incrementado. | `serialize`. | Sim. | Ok. |

### `src/l2cs/l2cs.worker.ts`

Roda em Web Worker, escopo dedicado:

| Variável | Escrita | Leitura | Reset? | Se não resetar |
|---|---|---|---|---|
| `session: any` (27) | Set em `init`. | `infer`. | Nunca (recriar o worker é o "reset"). | Init duplicado sobrescreve modelo sem liberar o anterior. |
| `meta: L2CSModelMeta \| null` (28) | Set em `init`. | `infer`. | Idem. | Idem. |

### `src/l2cs/client.ts` — falso positivo

`let latest`, `let lastSubmitMs` estão **dentro de `createL2CSClient()`**
(linha 38), não em escopo de módulo. O plano cita "latest/lastSubmitMs
(l2cs/client)" como suspeitos, mas na verdade são per-instância. Único
risco: se alguém criar mais de um cliente, cada um tem seu próprio contador
— comportamento correto.

### Análise sinóptica

**Três padrões de risco no arquivo `calibration.ts`, todos convergentes:**

1. **Três caminhos parciais de reset** (`clearCalibration`, `startCalibrationMode`, `loadProfile`) em vez de um `reset()` único. É fácil adicionar um novo `let` e esquecer de zerá-lo em um dos caminhos. Vale considerar consolidar em `resetCalibrationState({ preserveProfile?: boolean })`.
2. **Estado exportado (`isCalibrating`, `isAccuracyTesting`) muta de dentro do módulo** — sem opacidade. Consumidores podem ler valor "meio setado" durante uma transição.
3. **`earHistory` é o pior**: `const` mutável, sem reset, sem encapsulamento, no arquivo em que menos se procura ("é só um detector de piscada"). Confirma A2-4.

**Nada aqui é bug a consertar agora** (A0 é auditoria). Consolidação vai para
o Sprint 1 (A1) para o que afeta o bug dos óculos, e A2-4 encapsula
`earHistory` num `class BlinkDetector`.

