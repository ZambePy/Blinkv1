# Resultados — Semana de Precisão (D2 → D8)

Documento de consolidação da semana. Um único lugar para responder:

- O que foi ligado, e por quê?
- O que ficou desligado, e por quê?
- O que virou infraestrutura mas ainda precisa de dado humano para decidir?

Data: **2026-08-25**. Baseline referência: **57 px / 0,9°** (Rodada A, sem
óculos, cabeça parada — commit `f9d9252`, documentado em
`docs/PONTO-DE-REFERENCIA.md`).

---

> ## ⚠️ LEIA ANTES DE USAR QUALQUER NÚMERO DESTE DOCUMENTO
>
> **Tudo abaixo desta caixa descreve o vetor de features de 44 dims.**
>
> O commit `c3ade68` reduziu o vetor para 12 dims (`ACTIVE_FEATURE_SET = 'iris12'`).
> Os relatórios que embasaram as decisões desta semana — `ci-baseline-a2.report.json`
> e `ci-baseline-ablation.report.json` — foram gerados em **2026-08-26 às 14:38**,
> horas antes daquele commit, e com `featuresSource: "recorded"`: usaram as features
> gravadas no JSONL, que naquele momento eram as de 44 dims.
>
> Nada acusou a mudança. O replay seguia rodando e produzindo números como se o
> pipeline não tivesse mudado, porque o default era usar as features gravadas e não
> havia nenhuma verificação de compatibilidade.
>
> **Decisões que NÃO valem para a configuração atual:**
>
> | Decisão | Onde | Por que não vale |
> |---|---|---|
> | D3.2 — manter `expandFactor` em 1,4 | §Decisões | Varreu o parâmetro do crop do L2CS, cujo bloco angular nem entra mais no vetor ativo |
> | D4 — não remover nenhum grupo de features | §Decisões | A ablação media grupos (pose-linear, pose-cross, quadratic, l2cs) que `iris12` **já removeu** |
> | A2-5 — `isotropicLandmarks` OFF | §Flags | Medido sobre 44 dims; o efeito no vetor reduzido é desconhecido |
>
> Nenhuma dessas decisões foi *revertida* — elas apenas deixaram de ter medição que
> as sustente. Refazer a medição é o item que as reabilita.
>
> A partir de 0.1, três coisas impedem que isto se repita:
> `FEATURE_VECTOR_ID` no cabeçalho do JSONL, o replay abortando em incompatibilidade,
> e `recomputeFeatures` como padrão.

---

## Baseline verdadeiro do pipeline atual (0.4)

Primeiro número gerado pelo código de hoje, para a configuração de hoje.

**Arquivo:** `baseline-iris12.report.json` — reproduzível com:

```bash
npm run replay -- --jsonl fixtures/replay/ci-baseline.jsonl --filter balanceado-v2 --report baseline-iris12.report.json
```

| variante | vetor | mean | mediana | p90 | max |
|---|---|---|---|---|---|
| **baseline-iris12** (balanceado-v2, recomputado) | `iris12:12` | **144,6 px** | 71,3 | 410,1 | 1014,8 |
| ci-baseline-a2 (balanceado-v2, features gravadas) | 44 dims | 150,3 px | 76,4 | 470,9 | — |

O vetor de 12 dims sai ligeiramente melhor que o de 44 nesta gravação, e a diferença
é maior na cauda (p90: 410 contra 471) do que na média. Mesma gravação, mesmo harness,
mesmo filtro — a comparação é legítima.

### Três ressalvas sobre este baseline

**1. Não mede borda.** O anel de 4 cantos adicionado em 0.3 só existe no teste ao vivo.
O replay reexecuta os alvos que estão gravados no JSONL, e a gravação tem apenas a
grade interior 25/50/75. `meanErrorEdge` só aparece depois de uma calibração nova
feita no app.

**2. Os graus não são comparáveis com o teste ao vivo.** O replay converte pixels em
graus com `ASSUMED_DIST_PX = 2268` (60 cm a 96 DPI, hardcoded), enquanto o teste ao
vivo usa a geometria configurada — 2205 px para 23,6" a 60 cm. São 2,9% de diferença
na distância assumida, o que faz 144,6 px virar 3,59° no replay e 3,75° ao vivo.
**Compare em pixels.**

**3. Não é o mesmo número do teste ao vivo, e nem deveria ser.** O relatório
`accuracy-report-1787858613170` mede 103 px na mesma configuração de código. As duas
medidas diferem porque a gravação é de outra sessão, com outro posto de uso — a
gravação tem brilho 0,236 e rosto ocupando 9,9% do frame; a sessão ao vivo mais
recente tem 0,496 e 15,4%. O replay serve para comparar VARIANTES do pipeline sob
dados idênticos, não para prever o erro de campo.

---

**Regras que governaram a semana (de `PLANO-FRENTES-A-B.md`):**

1. Fail loud, não silent.
2. Emergência nunca bloqueada.
3. UI não pode mentir sobre estado.
4. Nada liga por padrão sem número que justifique.

---

## Resumo executivo

- **8 sprints implementadas** (D2 → D8). Toda infra planejada foi entregue.
- **Nenhuma flag nova foi ligada por padrão** — regra 4 mantida.
  `isotropicLandmarks`, `lockCameraExposure` e `applyDistanceCorrection`
  seguem `false`, esperando gravação real para decisão.
- **333 testes passando** (26 arquivos raiz · 228 testes; 19 arquivos frontend
  · 105 testes) — +174 testes novos ao longo da semana.
- **Baseline de 57 px / 0,9° preservado.** Nenhuma mudança de comportamento
  no caminho feliz — todas as extensões (correção de distância, ablação,
  drift, fadiga) são opt-in ou puramente diagnósticas.
- **Uma pendência humana única atravessa D2 → D8:** gravar 1 fixture de
  20-40 min via `SettingsScreen → Gravador de sessão`. Sem ela, as decisões
  numéricas de D3.1/D3.2, D4.3, D5.1, D5.2, D7.1, D7.3 e o gate de CI de
  D8.1 ficam suspensas.

---

## Decisões tomadas nesta semana

### Ligadas por default

| Item | Origem | Motivo |
|------|--------|--------|
| `balanceado-v2` como preset default do `measure_baseline` | D3.2 | Casa com o default do engine desde D1-1 → números comparáveis 1:1 com o accuracy test ao vivo. |
| `getSessionUptimeMs()` no `AUTO_TEST_META` (auto pós-calibração) | D2.2 | Substitui `minutosDeSessao: 0` hardcoded — a curva de drift do ROADMAP era impossível sem isso. |
| `applyUptimeToRunMetaIfDefault` no accuracy test manual (SettingsScreen) | D7.2 | Mesmo motivo, agora no fluxo manual. Preserva override do cuidador. |
| Condição óptica selecionável na tela de calibração | D6.2 | Antes o perfil salvo sempre saía com `opticalCondition: 'desconhecido'`. |
| `<DriftIndicator />` montado no App | D6.3 | Cuidador enxerga o viés de sessão que o D1-3 estava absorvendo silenciosamente. |
| `<FatigueIndicator />` montado no App | D7.4 | Taxa de piscadas já era medida (D1-4) mas não estava conectada a nenhuma ação. |
| Modo rápido de calibração (4 cantos) na UI | D6.1+D6.2 | Recalibração <15s (papel — meta) contra ~19-29s do modo completo. |

### Ficaram desligadas — dependem de fixture

| Flag | Estado | Espera |
|------|--------|--------|
| `EXPERIMENT.isotropicLandmarks` | `false` | Sweep OFF vs ON via `measure_baseline.mjs --a2-flags` sobre a fixture. Só liga se houver melhora sem regressão. |
| `EXPERIMENT.lockCameraExposure` | `false` | Medição AO VIVO (afeta apenas `ImageCapture.applyConstraints`, não afeta replay). Fora do sweep. |
| `EXPERIMENT.applyDistanceCorrection` | `false` | Gravação com movimento controlado (aproximação/afastamento). |
| `EXPERIMENT.expandFactor` (variação do 1.4 default) | `1.4` | Sweep AO VIVO (6 sessões, roteiro em `frontend/scripts/sweep_expand_factor.md` — replay não pode variar porque não persiste pixels). |
| Remoção de qualquer grupo de features (pose-linear/cross/quadratic/l2cs) | Nada removido | Ablação em `measure_baseline.mjs --ablation` produz números; mas N=1 gravação não justifica remover feature. |

### Decisões conservadoras registradas

- **Cadência do L2CS mantida em 100 ms; staleness em 500 ms.** D3.4
  documentou a decisão. Base: usuários-alvo (ELA, memory
  `project_target_users_als.md`) não fazem movimento rápido de cabeça — a
  premissa "head-still" torna a cadência atual seguramente adequada.
  Revisitar se `stalePct > 15%` sustentado *E* houver ganho de erro
  comprovado.
- **Detecção de outlier em nível de ponto é apenas sinalização.** D4.2
  registra em `StoredCalibrationProfile.quality.outlierTargets` e loga; NÃO
  retreina, NÃO bloqueia. MAD com N~9 é frágil — o próprio log fala isso.
- **Modo rápido usa o mesmo vetor de features do modo completo.** D6.1
  discutiu (e rejeitou por ora) reduzir o vetor no modo rápido — reduzir
  invalidaria todos os perfis salvos, custo alto pra ganho incerto. Backlog
  se o modo rápido mostrar precisão sistematicamente pior: adicionar 1
  ponto central (variante de 5), NÃO reduzir o vetor.

---

## Sprint-a-sprint

### D2 — Loop de medição

**Entregas:**

- `docs/PONTO-DE-REFERENCIA.md` sem nenhum `[PREENCHER]` — todos os 10 campos
  consolidados a partir da Rodada A de `docs/BUG-OCULOS-EVIDENCIA.md`.
- `AUTO_TEST_META` do auto-test pós-calibração deixou de ser hardcode.
  `frontend/src/utils/autoTestMeta.ts` — função pura testável;
  `minutosDeSessao` vem do uptime do engine; `oculos` deriva da condição
  óptica ativa.
- `frontend/scripts/measure_baseline.mjs` — wrapper de `scripts/replay.mjs`
  para varrer variantes de configuração sobre a MESMA gravação.
- `fixtures/replay/README.md` — roteiro passo-a-passo para produzir a fixture.

**Pendência humana:** gravar a fixture (a única tarefa manual de D2, ver
`fixtures/replay/README.md`).

**Testes novos (12):** `frontend/src/utils/autoTestMeta.test.ts` — cobre
uptime, arredondamento, negativo, mapeamento de condição óptica.

### D3 — Endurecer o uso do L2CS-Net

**Entregas:**

- D3.1: `frontend/scripts/l2cs_axis_validation.mjs` reescrito. 5 poses
  (adicionou `look_down`, `look_left`); veredicto por PAR (simetria); aceita
  `--dirs` para consistência entre distâncias.
- D3.2: Presets v2 do OneEuroFilter (`estavel-v2`/`balanceado-v2`/
  `responsivo-v2`) no replay — resolve a limitação declarada no comentário
  do próprio `measure_baseline.mjs`.
- D3.3: `confidence` da softmax exposta como diagnóstico (novo campo em
  `L2CSGaze`, `RecordedL2CS`, `EngineDiagnostics.l2cs`). NÃO consome
  downstream — respeitando regra 4.
- D3.4: Decisão "manter cadência 100 ms + staleness 500 ms" documentada.

**Pendências humanas:**

- Capturar 5 fotos (idealmente ×2 distâncias) e rodar D3.1.
- Rodar sweep de `expandFactor` ao vivo (6 sessões, roteiro em
  `frontend/scripts/sweep_expand_factor.md`).

**Testes novos (9):** `src/l2cs/decode.test.ts` (+7 para
`decodeAngleWithConfidence`); `src/l2cs/client.test.ts` (+2 para
`getAverageConfidence`).

### D4 — Outliers Ridge + ablação de features

**Entregas:**

- D4.1: `detectOutlierPoints` em `src/calibration.ts` — função pura
  testável, LOO com MAD escalado por 1.4826, piso absoluto de 15% (calibrado
  empiricamente contra a extrapolação natural de LOO nos cantos da grade 3×3).
- D4.2: Wiring em `StoredCalibrationProfile.quality.outlierTargets` +
  `__irisflowDebug.outlierTargets()`. Apenas sinaliza.
- D4.3: `scripts/replay.mjs --drop-features <grupos>` (pose-linear |
  pose-cross | pose-quadratic | l2cs); `measure_baseline.mjs --ablation`
  anexa 4 variantes de ablação.

**Pendência humana:** rodar `measure_baseline.mjs --ablation` quando a
fixture existir.

**Testes novos (7):** `src/calibration.d4.test.ts` — todos os regimes de
input (poucos alvos, features vazias, ruído idêntico, 1 outlier isolado).

### D5 — Head pose validation + correção de distância

**Entregas:**

- D5.1: Variante combinada "sem pose alguma" anexada em
  `measure_baseline.mjs` (herda D4.3, adiciona o número que D5 pede).
- D5.2: `src/distanceCorrection.ts` novo — função pura + wiring reversível
  em `calibration.ts` (`calibrationRefDistance` capturada no treino) +
  `engine.ts` (passa `cameraDistanceEstimate` a `mapGaze`).
  `EXPERIMENT.applyDistanceCorrection: false` (regra 4). Escala IN-PLACE
  apenas dims dependentes de offset ([0..3] iris + [25..30] pose·offset
  1ª ordem + [31..34] pose²·offset); NÃO escala pose linear ([22..24]),
  pose·scale ([35..36]), nem bloco L2CS ([37..43]) — todas invariantes a
  distância em ângulo.
- Achado teórico honesto preservado no código: correção é heurística de 1ª
  ordem; solução completa (Structure-from-Motion) fica no §8 do ROADMAP como
  backlog explícito.

**Pendência humana:** gravar sessão de movimento controlado
(aproximação/afastamento) para comparar `applyDistanceCorrection` OFF vs ON.

**Testes novos (19):** `src/distanceCorrection.test.ts` — 8 sobre
`computeDistanceCorrectionRatio` (guards, clamps, inputs inválidos); 11
sobre `applyDistanceCorrectionToFeatures` (dims corretas escaladas, sinal
preservado, vetor curto tolerado).

### D6 — Recalibração rápida + drift indicator

**Entregas:**

- D6.1: Backend `startCalibrationMode({ quick })`;
  `CALIBRATION_TARGETS_QUICK` (4 cantos) e `CALIBRATION_TARGETS_FULL` (9
  pontos 3×3) exportados; `getCalibrationTargets()` devolve a lista ativa.
- D6.2: `CalibrationCheck.tsx` ganhou `<select>` de condição óptica e
  botão secundário "Recalibração rápida (4 pontos)". Perfil salvo agora
  reflete a escolha real do cuidador (não mais `'desconhecido'` fixo).
- D6.3: `frontend/src/components/DriftIndicator.tsx` — banner azul opt-in,
  polling 1 Hz de `getSessionBias()`. Regras: `samples >= 20`, `|bias| >=
  5%`, nunca em `/calibration-check` ou `/emergency`, nunca em rotas de
  cuidador ou públicas, cede prioridade ao `isDegraded` (B4-2).

**Pendência humana:** medir tempo de coleta real e erro pós-recalibração
rápida vs. completa.

**Testes novos (16):** `src/calibration.d6.test.ts` (+7); `frontend/src/
components/DriftIndicator.test.tsx` (+9).

### D7 — Sessões longas: drift, fadiga

**Entregas:**

- D7.1: Override de `EXPERIMENT` via env-var (`IRISFLOW_EXP_<key>=<value>`).
  `measure_baseline.mjs --a2-flags` (2 variantes: `isotropicLandmarks` OFF
  vs ON). `lockCameraExposure` fica FORA do sweep — só afeta câmera ao vivo
  (limitação declarada em código).
- D7.2: `applyUptimeToRunMetaIfDefault` no fluxo manual de accuracy
  (SettingsScreen). Preserva override manual do cuidador.
- D7.3: `--time-window <startSec,endSec>` no `scripts/_replay_impl.ts` (só
  filtra frames de accuracy — calibração é preservada, é pré-requisito do
  modelo). `--drift-curve <windows>` no `measure_baseline.mjs`; default
  `0-5,20-25,40-45` min.
- D7.4: `frontend/src/components/FatigueIndicator.tsx` — banner verde
  opt-in, polling 10s de `getRecentBlinkRatePerMinute`. Sustained detection
  (3 polls acima do limiar 25/min = ~30s); histerese de 5/min. Mesmas
  regras de rota do DriftIndicator. Cede ao `isDegraded` (nunca empilha
  avisos).

**Pendências humanas:** gravar 1 sessão contínua ~40 min; rodar
`--a2-flags` e `--drift-curve` sobre a fixture; medição ao vivo de
`lockCameraExposure`.

**Testes novos (30):** `src/config/experiment.test.ts` (+8);
`frontend/src/utils/autoTestMeta.test.ts` (+7 sobre
`applyUptimeToRunMetaIfDefault`); `frontend/src/utils/driftWindows.test.ts`
(+13); `frontend/src/components/FatigueIndicator.test.tsx` (+10).

### D8 — Consolidação

**Entregas:**

- D8.1: `frontend/scripts/check_baseline_regression.mjs` (nova CLI, com a
  lógica pura extraída em `checkBaselineDecision.mjs` para poder ser
  testada sem imports Node). Compara `meanErrorPx` da variante-baseline
  entre dois relatórios do `measure_baseline`; falha se current excede
  baseline + tolerância (default 15%, preliminar). Step de CI condicional
  adicionado ao `frontend/.github/workflows/ci.yml`: smoke test das CLIs
  roda sempre; gate real roda apenas quando `fixtures/replay/ci-baseline.jsonl`
  e `ci-baseline.report.json` estão commitados.
- D8.2: **este documento** + atualização do `README.md`.
- D8.3: Sanity check final (testes + build + electron:compile). Conserto
  colateral de 4 warnings de TS pré-existentes (unused vars em
  `PhotoCaptureScreen.tsx` + `accuracy.ts:112`) que quebravam o build
  desde antes de D2 — parte da consolidação de "build limpo". Timeout do
  teste flaky `qualityAnalyzer.a1-5.test.ts` aumentado para 15s (o teste
  fica intermitente sob load pesado por conta de jsdom+canvas 3.2.3;
  runs isolados <500ms).
- D8.4: `§8` do ROADMAP expandido em duas subseções (8.1 backlog técnico
  original + 8.2 novas pendências humanas emergentes de D3-D7, agrupadas
  por origem para o próximo operador não precisar caçar).

**Testes novos (11):** `frontend/src/utils/checkBaselineRegression.test.ts`
sobre `decideRegression` (boundary conditions, invalid inputs, tolerância 0).

---

## Estado ao fim da semana

- **Raiz:** 26 arquivos · 228 testes verdes (+1 arquivo, +18 testes vs. fim
  do D7 — D8.1 adicionou pouco na raiz; a maior parte cresceu no frontend).
- **Frontend:** 19 arquivos · 105 testes verdes (+1 arquivo, +11 testes vs.
  fim do D7 — `checkBaselineRegression.test.ts` de D8.1).
- **Total:** 333 testes verdes.
- **Build (`npm run build`):** limpo.
- **Electron:compile (`npm run electron:compile`):** limpo.

Novos testes ao longo da semana: **+174** (12 D2 + 9 D3 + 7 D4 + 19 D5 +
16 D6 + 30 D7 + 11 D8 + calibração/e2e residuais deixados pela mesma semana).

---

## Backlog explícito consolidado (não escondido)

**Pendências humanas atravessando toda a semana** (dependem de sessão
física com webcam — o agente não tem acesso):

1. **Fixture de calibração+accuracy (D2.4).** Base de tudo. Sem ela, D3.1,
   D3.2, D4.3, D5.1, D5.2, D7.1, D7.3 e o gate de CI de D8.1 ficam
   suspensos. Roteiro em `fixtures/replay/README.md`.
2. **5 fotos ×2 distâncias (D3.1).** Para validar axis symmetry do L2CS.
3. **Sweep ao vivo de `expandFactor` (D3.2, 6 sessões).** Roteiro em
   `frontend/scripts/sweep_expand_factor.md`.
4. **Fixture longa ~40 min (D7).** Base para curva de drift + sweep A2.
5. **Sessão de movimento controlado (D5.2).** Para decidir
   `applyDistanceCorrection`.
6. **Medição ao vivo de `lockCameraExposure` (D7.1).** Impossível via
   replay.
7. **Tempo real de coleta e erro pós-recalibração rápida vs. completa
   (D6).** Só com usuário real.

**Backlog técnico registrado no §8 do ROADMAP:**

- Reconstrução 3D de cabeça / Structure-from-Motion (solução completa que
  a literatura usa para deslocamento lateral).
- Retreinar ou substituir o L2CS-Net (fora de escopo de 1 semana).
- RANSAC clássico (com N=9 alvos, MAD é mais adequado — D4 escolheu MAD
  intencionalmente).
- Investigação do revert de `f78b6bd` (ordenação raster + gate de deriva
  entre pontos).
- Automação completa da curva de deriva (pipeline contínuo, múltiplos
  usuários, análise estatística).
- Validação em outro hardware/webcam.

---

## Como usar isto

Se você é o próximo agente/desenvolvedor a tocar neste código:

1. Se precisar decidir sobre uma flag: consulte a tabela "Ficaram
   desligadas" primeiro. Se a flag está lá, os números que a decisão
   precisa vêm de rodar `measure_baseline.mjs` sobre a fixture com o
   sweep apropriado.
2. Se precisar entender uma decisão passada: cada sprint em §D2-D8 tem os
   comentários canônicos no código que citam explicitamente a razão.
3. Se precisar produzir a fixture: `fixtures/replay/README.md` tem o
   roteiro passo-a-passo. Nomear o arquivo como
   `fixtures/replay/ci-baseline.jsonl` (mais o snapshot `.report.json`)
   ativa o gate de CI automaticamente.
4. Se o gate de CI falhar num PR: `check_baseline_regression.mjs` explica
   o delta e as 3 ações possíveis. Regressão intencional exige regravar o
   snapshot baseline + justificar no PR.
