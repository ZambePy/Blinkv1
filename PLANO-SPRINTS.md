# IrisFlow — Plano de Sprints

> **Complementa** o `PLANO-FRENTES-A-B.md`, não o substitui. Aquele documento definiu o preparo de terreno; este define a ordem de execução do que sobrou, com a prioridade que você pediu: **métricas → deriva → pipeline → terminar a Frente B**.
>
> Repositório em `5503091`. Cada achado tem arquivo:linha verificado.
>
> **Geometria fixa do projeto:** 1920 × 1080 · **23,3"** · `pxPorCm = 37,2226`. A 60 cm, `distPx = 2233` e **1° = 39,0 px**.

---

## Índice

- [Onde o projeto está](#onde-o-projeto-está)
- [Bloco I — Fundação de medição](#bloco-i--fundação-de-medição)
- [Bloco II — Pipeline de rastreamento](#bloco-ii--pipeline-de-rastreamento)
- [Bloco III — Medir de verdade](#bloco-iii--medir-de-verdade)
- [Bloco IV — Terminar a Frente B](#bloco-iv--terminar-a-frente-b)
- [Calendário e cortes](#calendário-e-cortes)

---

## Onde o projeto está

Auditei o estado atual contra o `PLANO-FRENTES-A-B.md`. O que já está fechado é bastante:

| Bloco do plano anterior | Estado |
|---|---|
| **A0** — auditoria, saneamento, invariantes, flags | ✅ `docs/AUDITORIA-SPRINT-0.md`, `invariants.ts`, `config/experiment.ts` |
| **A1** — bug dos óculos | ✅ `docs/BUG-OCULOS-EVIDENCIA.md`, `calibrationProfiles.ts`, specular em `qualityAnalyzer.ts` |
| **A2** — precisão atrás de flags | ⚠️ parcial — flags declaradas mas **desligadas**; três nem existem |
| **B0–B1** — auditoria UX e design system | ✅ `gazeMetrics.ts`, `GazeButton`, `GazeGrid`, `GazePageLayout`, `FramingIndicator` |
| **B2** — migrar telas | ⚠️ **8 de ~25 telas** usam `GazeButton`/`GazeGrid` |
| **B3** — funcionalidades novas | ✅ predição de palavras, varredura hierárquica, modo descanso, lembretes, histórico |
| **B4** — segurança clínica | ✅ emergência global, aviso de degradado, PIN, guia do cuidador |
| **D1** (plano de 7 dias) | ✅ filtro v2 default, EAR por olho, bias de sessão, taxa de piscadas |

E o que falta, exatamente nas três áreas que você priorizou:

### 🔴 Métricas — nada mudou desde a auditoria

```
frontend/src/pages/onboarding/CalibrationCheck.tsx:76   telaPolegadas: 15.6   ← hardcoded
frontend/src/pages/SettingsScreen.tsx:272               telaPolegadas: 15.6   ← default errado
src/accuracy.ts:94                                      ASSUMED_DIST_PX = 2268
```

O teste automático que roda após a calibração continua usando **15,6"** num monitor de **23,3"**. Todo grau que ele reporta está **cerca de 33 % otimista**, e o usuário não tem como corrigir aquele valor — ele não passa pelo formulário.

Também não existe métrica **por amostra** (só por ponto, que mede viés e ignora dispersão), e a distância continua sendo um número digitado.

### 🟡 Deriva — metade feita

`SESSION_BIAS_ALPHA` e o EMA de bias existem (`calibration.ts:59-60`, `1192-1197`) — isso é a *correção*. Falta a *detecção*: não há monitor de deriva, não há discordância binocular, não há reajuste de 1 ponto, não há indicador para o cuidador.

```bash
grep -rn "disagreement" src/     # vazio
```

### 🟡 Pipeline — flags prontas e desligadas

```
isotropicLandmarks: false     // A2-5 — desligado até medição confirmar melhora
lockCameraExposure: false     // A2-6 — desligado por compatibilidade de hardware
useMetricDistance             // não existe
deRoll                        // não existe
fixedIodPx                    // não existe
```

O comentário do `isotropicLandmarks` diz tudo: *"desligado até medição confirmar melhora"*. **Você está bloqueado em melhorias de pipeline porque não confia na medição** — e é por isso que o Bloco I vem primeiro.

### 🟢 Suíte de testes

`4 failed | 156 passed`. O arquivo que falha é `qualityAnalyzer.a1-5.test.ts`, e o erro é `ctx.fillRect` — provavelmente o pacote `canvas` não compilado no meu ambiente. **Confirme na sua máquina antes do Sprint 1**; se falhar aí também, é regressão e entra na frente de tudo.

---

# Bloco I — Fundação de medição

> Dois sprints. Nada depois disso é avaliável sem eles.

## Sprint 1 — Métricas confiáveis

**Objetivo:** poder acreditar em qualquer número que o app produzir.

| # | Tarefa | Onde | Tempo |
|---|---|---|---|
| S1-1 | 🔴 Eliminar `telaPolegadas` hardcoded; config persistida com 23,3"; **bloquear medição sem geometria confirmada** | `CalibrationCheck.tsx:76`, `SettingsScreen.tsx:272` | 2 h |
| S1-2 | 🔴 **Distância medida por frame** via `faceMatrix[14]` + âncora de fita métrica; mediana/p5/p95 no relatório | `extractor.ts`, `accuracy.ts` | 3 h |
| S1-3 | Métricas **por amostra** (mediana, p90) além das por ponto | `accuracy.ts` | 2 h |
| S1-4 | `hitRateByRadius` incluindo **260 px** (6,63° a 60 cm, o ótimo ergonômico) | `accuracy.ts` | 30 min |
| S1-5 | `rowMeansPx` e `colMeansPx` — erro por linha e coluna da grade | `accuracy.ts` | 1 h |
| S1-6 | Preencher `AccuracyRunMeta` no fluxo automático (hoje reporta `óculos=não` mesmo com óculos) | `CalibrationCheck.tsx` | 30 min |
| S1-7 | Corrigir `getCurrentLambda()` — devolve `0` quando o CV escolheu 1 e 0,01 | `calibration.ts:151` | 30 min |
| S1-8 | `gazeMetrics.degToPx` passa a usar a geometria real em vez de `96/2.54` fixo | `frontend/src/design/gazeMetrics.ts:8` | 45 min |

### Sobre S1-2 — medir, não perguntar

`src/extractor.ts:370` já extrai a translação da matriz do MediaPipe:

```ts
pos3D = { x: faceMatrix[12], y: faceMatrix[13], z: faceMatrix[14] };
```

[O modelo canônico de face do MediaPipe é métrico, em centímetros](https://developers.googleblog.com/mediapipe-3d-face-transform/). **`faceMatrix[14]` já é uma distância em cm** — e `extractor.ts:388` a descarta em favor de `1/interEyeDist`.

1. **Âncora única.** O cuidador mede com fita métrica uma vez, no setup. Guarde `k = distanciaRealCm / tzObservado` no perfil.
2. **Registro por frame** durante calibração e validação.
3. **No relatório:** mediana, p5, p95. A dispersão diz se a pessoa se mexeu — informação que hoje se perde inteira.
4. **Graus calculados com a mediana medida**, nunca com valor digitado.

> **Regra permanente: grau nunca viaja sozinho.** Toda exibição angular mostra a geometria ao lado — `1,32° (23,3" · 62 cm)`. Comparações entre sessões são feitas **em pixels**; graus recalculados a partir da geometria de cada uma.

### Sobre S1-3 — a métrica que importa

O relatório atual mede a distância do alvo até a **média** das predições daquele ponto: isso é **viés**, e ignora a dispersão. O que o dwell sente é o erro **por amostra**, sempre maior.

Reporte os dois. O número que você cita para terceiros é `sampleMedianDeg` e `sampleP90Deg`, **sempre juntos** — viés sozinho é tecnicamente verdadeiro e praticamente enganoso.

**Aceite do Sprint 1:** o relatório traz distância medida (não digitada), erro por amostra, e a condição de óculos correta. `npm test` verde.

---

## Sprint 2 — Deriva de sessão

**Objetivo:** o sistema saber que está errando, sem precisar de sessão de teste.

Você já tem a **correção** (EMA de bias). Falta a **detecção**.

| # | Tarefa | Tempo |
|---|---|---|
| S2-1 | 🔴 Calcular e expor **discordância binocular** por frame | 1 h |
| S2-2 | Linha de base na calibração (mediana e p90), salva no perfil **por condição óptica** | 1,5 h |
| S2-3 | Detector: discordância acima do p90 da linha de base por > 2 s → estado de deriva | 2 h |
| S2-4 | Fusão binocular ponderada pelo inverso da discordância (combina com o EAR já implementado no D1-2) | 2 h |
| S2-5 | Diagnóstico por olho no HUD | 1 h |
| S2-6 | Reajuste de 1 ponto: alvo central, 1,5 s, offset puro, persistido no perfil | 2,5 h |
| S2-7 | Guarda: offset **acumulado** acima de 20 % da menor dimensão → recusar e sugerir recalibração | 45 min |
| S2-8 | Deriva de distância em cm, agora que S1-2 a torna métrica | 1 h |
| S2-9 | Indicador discreto de deriva para o cuidador — **nunca modal** | 1,5 h |

### Por que a discordância binocular é a peça central

O `mapGaze` treina **dois regressores independentes**, um por olho. Como os dois olhos miram o mesmo ponto por fato anatômico, a discordância entre eles é **erro puro, mensurável sem ground truth**:

```ts
const disagreement = Math.hypot(predLeft.x - predRight.x, predLeft.y - predRight.y);
```

Cheng et al. (ECCV 2018) partem exatamente dessa observação — *"the gaze estimation performance on two eyes can be very different"* — e ponderar o olho melhor rende **21 % dentro do dataset e 25,4 % cross-dataset**. A revisão de calibração pessoal nomeia a mesma coisa (restrições de convergência binocular) entre as estratégias de autocorreção de deriva online.

Quatro usos, infraestrutura zero: linha de base individual, detector de deriva durante uso real, diagnóstico por olho (reflexo em uma lente aparece como assimetria), e peso do frame.

> **O EAR diz se o olho está *visível*; a discordância diz se ele está *certo*.** Você já tem o primeiro desde o D1-2.

⚠️ **S2-7 valida o acumulado, não o incremento.** Quatro reajustes de 15 % somam 60 %.

⚠️ **S2-9 nunca pode bloquear a comunicação.** Um usuário com ELA pode estar no meio de uma frase urgente.

**Aceite do Sprint 2:** com uma lente propositalmente suja, o HUD aponta *qual* olho degradou. O indicador de deriva aparece sem interromper nada.

---

# Bloco II — Pipeline de rastreamento

## Sprint 3 — Geometria

**Objetivo:** atacar pose e distância na raiz — os dois gargalos que sobreviveram a todas as correções anteriores.

| # | Tarefa | Tempo |
|---|---|---|
| S3-1 | 🔴 **Variância sobre features padronizadas** — pré-requisito do S3-2, ver nota | 1,5 h |
| S3-2 | `cameraDistanceEstimate` ← `faceMatrix[14]` (S1-2 já expõe). Flag `useMetricDistance` | 2 h |
| S3-3 | Guardar a matriz de rotação `R` inteira — hoje só os Euler são lidos (`extractor.ts:358-360`) | 1 h |
| S3-4 | **Des-normalizar o ângulo do L2CS** com `Rᵀ` | 2,5 h |
| S3-5 | Ligar `isotropicLandmarks` e medir (a flag existe desde A2-5, sempre desligada) | 1 h + medição |
| S3-6 | Ligar `lockCameraExposure` e medir | 1 h + medição |
| S3-7 | Novas flags `deRoll` e `fixedIodPx` no crop, defaults preservando comportamento | 3 h |

### ⚠️ Nota crítica sobre S3-1

`calculateFeatureVariance` (`calibration.ts:528`) tira a média da variância sobre as 44 dimensões — mas elas não estão na mesma escala:

| Grupo | Qtd | Variância típica |
|---|---|---|
| Offsets de íris, contorno, cantos (normalizados por IOD) | ~34 | ~1e-4 |
| Pose (rad) | 3 | ~1e-2 |
| **Bloco L2CS `ty·dProxy` e `tp·dProxy`** | **2** | **~10** |

Com `dProxy = 1/interEyeDist ≈ 5–10` e `tan` clampado em ±1, essas duas dimensões dominam a média. E elas são **face-level — idênticas nos dois olhos**, o que explica a observação do seu `BUG-OCULOS-EVIDENCIA.md`: *"Var L ≈ Var R até a sexta casa decimal"*. A diferença entre os olhos só aparece nas ~34 dimensões que contribuem com 1e-4 cada.

Duas consequências:

**(a)** O portão de variância não mede o que o comentário afirma. Ele mede **estabilidade angular do L2CS × ruído do proxy de distância**. Os limiares `INTRA_POINT_VARIANCE_FLOOR = 0.10` e `CEIL = 1.15` foram afinados empiricamente e medem um sinal útil — mas por outro motivo. Corrija o comentário para ninguém "consertar" isso depois.

**(b)** **Trocar `dProxy` pela distância métrica muda a escala de ~6,7 para ~1/60 = 0,017 — quatro ordens de grandeza.** Os dois limiares viram lixo e todo ponto passa a ser aceito ou rejeitado indiscriminadamente. Por isso S3-1 vem antes de S3-2: calcular a variância sobre features já padronizadas torna o número imune a mudanças de escala em qualquer dimensão.

### Por que S3-2 importa para pose

Hoje `dProxy = 1/interEyeDist`, e a distância interocular aparente **encolhe quando a cabeça vira**. Ou seja: **virar a cabeça 20° faz o sistema achar que o usuário se afastou.** Esse valor multiplica `tan(yaw)` e `tan(pitch)` nos dois termos de paralaxe do bloco L2CS, então o erro entra direto na predição.

### Sobre S3-4 — o passo que quase todo mundo esquece

O procedimento de normalização de Zhang & Sugano tem uma segunda metade:

```python
gc_normalized = R · (gc − et)     # o alvo de treino vive no espaço normalizado
# no inverso:  gc_camera = Rᵀ · gc_predito
```

Hoje o crop não é de-rolado, então o yaw/pitch que a rede devolve vive num referencial que **gira junto com a cabeça** — o significado de "yaw = +12°" muda conforme o roll. O Ridge absorve isso em parte pelo termo linear de roll, mas o efeito real é não-linear.

⚠️ S3-2 e S3-4 mudam valores de features → perfis salvos ficam incompatíveis. Incremente a versão do perfil e invalide **dizendo o motivo** ao usuário.

⚠️ Sobre S3-7: **não implemente a homografia completa de Zhang.** O `l2cs/utils.py` oficial mostra que o pré-processamento de treino é só `Resize(448) → ToTensor → Normalize` — os pesos do Gaze360 **não** foram treinados com normalização, e reprojetar cria descasamento de domínio. De-roll e escala fixa são seguros porque só reduzem variação.

**Aceite do Sprint 3:** com `useMetricDistance` ligado, girar a cabeça 20° sem se mover **não** altera a distância estimada. Hoje altera.

---

## Sprint 4 — Sinais e cauda

**Objetivo:** o resíduo que sobra depois da geometria.

| # | Tarefa | Tempo |
|---|---|---|
| S4-1 | **Entropia do softmax** do L2CS (já é TODO em `telemetry/types.ts`; `decode.ts` calcula e descarta) | 1,5 h |
| S4-2 | **Janela temporal** de mediana no L2CS (3 a 5 valores); a dispersão vira confiança de graça | 2 h |
| S4-3 | Portão de confiança combinando entropia + dispersão + discordância (S2-1) + qualidade | 2,5 h |
| S4-4 | Autópsia da cauda: separar o decil de pior erro e comparar cada sinal contra o corpo | 3 h |
| S4-5 | Curva de portão: *"cortando em confiança < X, removo Y % da cauda descartando Z % dos frames"* | 1,5 h |
| S4-6 | Consumo do portão: dwell **pausa** (não zera) em confiança baixa; opacidade do cursor proporcional | 2 h |

A S4-4 é análise puramente offline, custo humano zero, e historicamente é onde estava o resíduo dominante deste projeto — frames ruins intermitentes, não imprecisão distribuída.

A S4-5 é o que fixa o limiar do portão sem chute. Escolha o joelho da curva: descartar 40 % dos frames deixa o dwell lento demais; o joelho costuma ficar entre 0,3 e 0,5.

---

# Bloco III — Medir de verdade

## Sprint 5 — Referência e medição definitiva

**Objetivo:** os números que vão para a apresentação — e a trava que impede regressão.

| # | Tarefa | Tempo |
|---|---|---|
| S5-1 | Rodada **R-A**: cabeça parada, sem óculos | 15 min |
| S5-2 | Rodada **R-B**: cabeça parada, **com óculos** | 15 min |
| S5-3 | Rodada **R-C**: cabeça livre, movimento **guiado e cronometrado** | 20 min |
| S5-4 | Rodada **R-D**: sessão longa, validação em 0 / 20 / 40 min | 45 min |
| S5-5 | `src/reference.ts` com a referência congelada + `git tag -a v1-referencia` | 1 h |
| S5-6 | Comparação automática na tela de diagnóstico, **em pixels** | 2 h |
| S5-7 | Guarda de regressão no `npm test`: falha se `sampleP90Px` piorar > 15 % | 2,5 h |
| S5-8 | Varredura offline das flags do Sprint 3 sobre as gravações (zero tempo humano) | 3 h |
| S5-9 | Relatório final com condição declarada por número | 1,5 h |

Roteiro do movimento guiado da R-C — livre de verdade torna duas rodadas incomparáveis:

```
0–20 s   olhe o ponto, cabeça parada
20–40 s  incline devagar para a esquerda e volte
40–60 s  aproxime ~10 cm e volte
60–80 s  vire o rosto ~15° para cada lado
```

Faça R-A, R-B e R-C **na mesma sessão, em sequência**, com 2 min de descanso entre elas. Sessões em dias diferentes carregam variação de iluminação e fadiga que contamina mais que o efeito medido.

> **S5-8 é o que decide as flags do Sprint 3.** `isotropicLandmarks`, `deRoll`, `fixedIodPx` e `useMetricDistance` estão desligadas esperando exatamente esta medição. Ligue **uma de cada vez** — doze mudanças ligadas juntas, com o número piorando, é uma tarde perdida procurando qual foi.

⚠️ Uma medição que ainda falta e que ninguém cobra até tarde demais: **uma segunda pessoa**. Todo o projeto tem `n = 1`. É a primeira pergunta que um investidor com assessoria técnica faz, e o primeiro dado de um segundo rosto costuma ser o mais informativo de todos. Se der, encaixe no Sprint 5.

---

# Bloco IV — Terminar a Frente B

> Retoma exatamente de onde o `PLANO-FRENTES-A-B.md` parou. B3 e B4 estão fechados; falta completar B2 e a perfumaria.

## Sprint 6 — Completar a migração e o polimento

**Estado:** 8 de ~25 telas usam `GazeButton`/`GazeGrid`. As migradas são as de comunicação — a escolha certa de prioridade. Faltam as de lazer, entretenimento e onboarding.

| # | Tarefa | Tempo |
|---|---|---|
| S6-1 | Migrar `GamesMenu`, `WelcomeScreen`, `ProfileSelect` — telas de navegação do paciente | 3 h |
| S6-2 | Migrar `GalleryScreen`, `NewsScreen`, `MeditationScreen`, `TutorialScreen` | 4 h |
| S6-3 | **B2-3** — revisar os jogos (`BubblePop`, `Memory`, `Drawing`, `FollowTarget`): alvos podem ser menores (errar não custa), **mas o botão de sair segue o padrão** | 3 h |
| S6-4 | `VirtualMouseScreen` e `ChatbotScreen` | 2 h |
| S6-5 | Revisar o **tempo de dwell** (ver nota) | 1 h + teste |
| S6-6 | Zona de descanso presente em todas as telas do paciente, não só na `RestScreen` | 2 h |
| S6-7 | Polimento visual: consistência de espaçamento, tipografia, estados de foco | 4 h |
| S6-8 | Corrigir `/Boldonse.ttf` — devolve HTML 404 e o navegador cai em fallback silenciosamente | 30 min |

### ⚠️ Nota sobre o dwell

`GazeContext.tsx:21` — `slow: 2500, normal: 1500, fast: 800` ms.

Um estudo ergonômico de interação por olhar encontrou o ótimo em **600 ms**, com carga de tarefa de 28,55 contra **51,02 a 800 ms** — quase o dobro. **Dwell mais longo é mais cansativo, não mais confortável**, porque o usuário precisa *sustentar* a fixação, e sustentar fixação é trabalho muscular e atencional.

Ressalva honesta: o estudo é com participantes saudáveis e rastreador de qualidade. Não copie os 600 ms às cegas para ELA. Mas `normal: 1500 ms` é quase certamente longo demais, e o caminho para reduzir seleção acidental é **alvo maior e histerese**, nunca dwell mais longo.

Aproveite que `dwellGraceMs` e `dwellSnapPx` estão em `experiment.ts` desde A2 — e ainda em `0`. Este é o momento de ligá-los e medir.

**Um alvo de 6,63° a 60 cm na sua tela são 260 px.** Use isso como referência de tamanho ao migrar.

---

## Sprint 7 — Voz clonada e chatbot

Você classificou como o menos necessário, e concordo. Mas há decisões a tomar cedo porque são difíceis de reverter.

| # | Tarefa |
|---|---|
| S7-1 | Decisão local × nuvem, documentada |
| S7-2 | Tela de consentimento com exclusão efetiva e confirmação |
| S7-3 | Captura guiada de amostra com validação de qualidade mínima |
| S7-4 | Integração no `TTSButton` com fallback para voz sintética |
| S7-5 | Chatbot: **desligado por default**, consentimento separado, indicação visível quando a mensagem sai do aparelho |

**Voz clonada** é a funcionalidade de maior impacto emocional do projeto — devolver a própria voz a quem a perdeu. E a de maior peso regulatório: voz é **dado biométrico** sob a LGPD, e o paciente frequentemente já não consegue consentir por escrito no momento da clonagem.

- **Nuvem quebra a promessa de "100 % local"** que está no seu README. Se for nuvem, diga isso na tela de consentimento.
- **Escopo travado em código**: a voz clonada só narra conteúdo produzido pelo fluxo do IrisFlow, nunca texto arbitrário. Garantido em código, não em política.
- **Consentimento antecipado**: colete amostra e consentimento enquanto o paciente ainda fala. É a hora certa eticamente e tecnicamente — amostra comprometida gera modelo ruim.

---

# Calendário e cortes

| Sprint | Foco | Duração | Depende de |
|---|---|---|---|
| **1** | Métricas confiáveis | ~2 dias | — |
| **2** | Deriva de sessão | ~2 dias | S1 |
| **3** | Geometria do pipeline | ~2 dias | S1 |
| **4** | Sinais e cauda | ~2 dias | S2 |
| **5** | Medição definitiva | ~2 dias | S1–S4 |
| **6** | Terminar a Frente B | ~3 dias | S1 (geometria dos tokens) |
| **7** | Voz e chatbot | ~3 dias | — |

**Total: cerca de 16 dias úteis.**

## Regras que valem em todos os sprints

1. **Um commit por tarefa**, prefixo `[S3-2]`.
2. **`npm test` verde a cada commit.**
3. **Nenhuma flag de pipeline entra ligada por default sem medição.** As do Sprint 3 são ligadas e medidas no Sprint 5, uma a uma.
4. **Nenhum default muda sem o `runId` da medição no comentário** que o justifica.
5. **Grau nunca viaja sozinho.** Comparações em pixels; graus recalculados por sessão.
6. Se um achado deste documento não se confirmar no código, **pare e reporte** em vez de inventar trabalho.

## Ordem de corte, se apertar

1. **Sprint 7** — voz e chatbot são os mais dispensáveis para a V1.
2. **Sprint 4** — mantenha S4-1 e S4-2 (baratos, alimentam tudo); adie a autópsia.
3. **Metade do Sprint 6** — migre as telas de comunicação e navegação; jogos podem esperar.

**Nunca corte:** Sprint 1 (sem ele nenhum número vale), Sprint 2 (é a sua prioridade declarada) e Sprint 5 (sem ele não há o que apresentar).

## Por que esta ordem

**Sprint 1 primeiro** não é preciosismo de método. O comentário do seu próprio código diz: *"isotropicLandmarks: false — desligado até medição confirmar melhora"*. Você tem melhorias prontas e paradas porque não confia na medição. Consertar a medição **destrava** o pipeline.

**Sprint 2 antes do 3** porque a discordância binocular é barata, não tem risco, e vira o instrumento com que você vai avaliar tudo que vem depois — inclusive as flags do Sprint 3, durante uso real e sem sessão de teste.

**Sprint 6 depois do 1** porque os tokens do design system (`gazeMetrics.ts:8`) dependem da geometria real. Migrar 17 telas com `pxPerCm = 96/2.54` fixo e depois descobrir que o valor certo é 37,2226 significa revisar 17 telas de novo.

---

## Referências

- Assimetria entre os dois olhos (ARE-Net) — [Cheng et al., ECCV 2018](https://www.ecva.net/papers/eccv_2018/papers_ECCV/papers/Yihua_Cheng_Appearance-Based_Gaze_Estimation_ECCV_2018_paper.pdf)
- Normalização de dados — [Zhang & Sugano, ETRA 2018](https://www.ut-vision.org/publication/2018-zhang-revisiting/) · [código](https://github.com/xucong-zhang/data-preprocessing-gaze)
- Calibração pessoal, revisão — [Frontiers in Psychology, 2024](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1309047/full)
- Matriz de transformação facial métrica — [MediaPipe 3D Face Transform](https://developers.googleblog.com/mediapipe-3d-face-transform/)
- Tamanho de alvo e dwell ótimos — [MDPI, *Improving Eye–Computer Interaction Interface Design*](https://www.mdpi.com/1995-8692/12/3/21)
- L2CS-Net — [paper](https://arxiv.org/abs/2203.03339) · [repo](https://github.com/Ahmednull/L2CS-Net)
