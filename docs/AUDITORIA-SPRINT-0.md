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

_(a preencher)_
