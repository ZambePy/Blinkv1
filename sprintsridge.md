# Plano de Sprints — Precisão do Ridge (IrisFlow)

> **Para o Claude Code:** trabalhe uma sprint por vez, na ordem. Cada sprint tem
> critério de aceite explícito. **Não avance sem rodar a medição do final da
> sprint e registrar o resultado em `docs/BASELINE.md`.**
>
> Regra geral: **toda mudança compara contra a Sprint 0**, nunca contra a sprint
> anterior. Ganhos ≤10% são ruído do protocolo — não comemore.

## Contexto

Pipeline atual (já implementado, não reescrever):

```
MediaPipe FaceLandmarker (478 landmarks + facialTransformationMatrix)
  → extractor.ts        canonicalização de pose + normalização por dist. interocular
  → featurePipeline.ts  USE_COMPACT_FEATURES = true → ~31 dims/olho
  → scaler.ts           StandardScaler
  → ridge.ts            (ΦᵀΦ + λI)β = Φᵀy, λ por CV leave-one-target-out
  → calibration.ts      2 regressores (L/R), predições mediadas
  → oneEuroFilter.ts    buffer ponderado 6 frames + One Euro
```

**O que NÃO fazer neste plano:** trocar o Ridge por CNN, adicionar ONNX,
integrar L2CS-Net. Isso é decisão posterior, dependente dos números daqui.

---

## Sprint 0 — Baseline (BLOQUEANTE)

**Problema:** `docs/BASELINE.md` está com todas as métricas em branco. Sem número
de partida, nenhuma sprint seguinte é avaliável.

### Tarefas

1. Verificar se `startAccuracyTest` (`src/accuracy.ts`) é chamável a partir da UI.
   Se não for, adicionar um botão "Testar precisão" em `SettingsScreen.tsx` que
   dispare o teste e mostre o `AccuracyResult`.

2. Adicionar exportação do resultado como JSON:
   ```ts
   // em accuracy.ts, dentro de finishTest
   export function exportAccuracyResult(r: AccuracyResult, meta: RunMeta): void
   // RunMeta = { data, iluminacao, oculos, movimentoCabeca, minutosDeSessao }
   ```

3. **Adicionar métrica de jitter** (não existe hoje). Durante cada ponto de
   validação, `accuracy.ts` já coleta `predictedX[]`/`predictedY[]` por ~1 s.
   Calcular o RMS da distância de cada predição à média daquele ponto:
   ```ts
   jitterRMS = sqrt( mean( (px - mean(px))² + (py - mean(py))² ) )
   ```
   Adicionar `jitterRMS` ao `AccuracyResult`.

4. **Adicionar medição de deriva.** Rodar o teste de precisão 3×: aos 0 min,
   20 min e 40 min de sessão contínua, sem recalibrar entre eles.

5. Rodar a matriz de medição e preencher `docs/BASELINE.md`:

   | Condição | Iluminação | Cabeça | Óculos |
   |---|---|---|---|
   | C1 | boa | parada | não |
   | C2 | boa | livre | não |
   | C3 | ruim | parada | não |
   | C4 | boa | parada | sim (se aplicável) |

   Para cada condição, registrar: `meanError`, `medianError`, `p90Error`,
   `meanErrorX`, `meanErrorY`, `meanErrorDeg`, `jitterRMS`, e a curva 0/20/40 min.

6. Corrigir as divergências de documentação: `README.md` diz 258 dims,
   `BASELINE.md` diz 260 e 9 pontos; o código roda 31 dims e 13 pontos.
   Deixar os três consistentes com o código.

### Critério de aceite
`docs/BASELINE.md` preenchido com ≥4 condições e a curva de deriva. Nenhum campo
em branco.

---

## Sprint 1 — Correção de bugs que contaminam medição

Três bugs encontrados na auditoria do código. Todos afetam a precisão medida.

### 1.1 — `QualityFeatures` é no-op

`extractor.ts` retorna valores hardcoded:
```ts
detectorConfidence: 1.0,   // constante
brightnessEstimate: 0.5,   // constante
contrastEstimate: 0.5,     // constante
blurEstimate: 0.0,         // constante
```

O filtro em `calibration.ts:feedRawData` testa `detectorConfidence < 0.5`, que
**nunca dispara**. Na prática nenhuma amostra ruim é rejeitada.

**Implementar de verdade**, calculando sobre o crop da região dos olhos:
- `brightnessEstimate` — média de luminância do crop, normalizada [0,1]
- `contrastEstimate` — desvio padrão da luminância
- `blurEstimate` — variância do Laplaciano (baixa variância = borrado)
- `detectorConfidence` — usar a confiança real do MediaPipe se exposta; senão,
  derivar da estabilidade dos landmarks entre frames consecutivos

Requer acesso ao frame de vídeo dentro do extractor (hoje ele só recebe
landmarks). Passar um `ImageData` ou `OffscreenCanvas` opcional.

**Depois de implementar**, ajustar os thresholds em `feedRawData` com base nos
valores reais observados — não deixar os atuais, que foram escritos para
constantes.

### 1.2 — Clamp antes da média binocular

`ridge.ts:predictRidge` aplica `clmp(v) → [0,1]` **por olho**. `calibration.ts:mapGaze`
só depois faz `(predLeft.x + predRight.x) / 2`. Se um olho satura (comum nas
bordas), a média fica enviesada para dentro da tela.

**Correção:** `predictRidge` retorna valor não-clampeado; `mapGaze` clampeia uma
única vez após mediar.

```ts
// ridge.ts — remover clmp() do retorno
return { x: normX, y: normY };

// calibration.ts:mapGaze — clampear após a média
const avgX = Math.min(1, Math.max(0, (predLeft.x + predRight.x) / 2));
const avgY = Math.min(1, Math.max(0, (predLeft.y + predRight.y) / 2));
```

⚠️ Verificar se `gazeRegressor.golden.test.ts` e `ridge.convexhull.test.ts`
dependem do clamp. Atualizar os testes se necessário.

### 1.3 — Grade de calibração assimétrica

`CalibrationCheck.tsx:CALIBRATION_POINTS` tem:
- linha superior (y=10): **4 pontos**
- linha central (y=50): **5 pontos**
- linha inferior (y=90): **3 pontos**
- + 1 ponto solto em (75, 75)

A borda inferior está sub-amostrada, e o erro cresce do centro para a periferia.

**Correção — grade simétrica de 13 pontos:**
```ts
const CALIBRATION_POINTS = [
  { x: 10, y: 10 }, { x: 37, y: 10 }, { x: 63, y: 10 }, { x: 90, y: 10 },
  { x: 10, y: 50 }, { x: 37, y: 50 }, { x: 63, y: 50 }, { x: 90, y: 50 },
  { x: 10, y: 90 }, { x: 37, y: 90 }, { x: 63, y: 90 }, { x: 90, y: 90 },
  { x: 50, y: 50 },  // centro
];
```

### Critério de aceite
Sprint 0 rodada novamente nas mesmas 4 condições. Registrar delta. **Esperado:
melhora no `p90Error` e no erro dos pontos de borda** (a média pode mexer pouco).

---

## Sprint 2 — Amostragem ponderada na periferia

A literatura mostra que o erro de fixação cresce do centro para a periferia, e que
usuários fixam pior nas bordas. A prática estabelecida é **coletar mais amostras
nos pontos periféricos**.

### Tarefas

1. Em `calibration.ts`, tornar `COLLECTION_MS` variável por ponto:
   ```ts
   // distância normalizada do centro, 0 (centro) a 1 (canto)
   const d = Math.hypot(x - 0.5, y - 0.5) / Math.hypot(0.5, 0.5);
   const collectionMs = 1200 + Math.round(d * 800);  // 1200ms centro → 2000ms canto
   ```
   Passar isso via `startCollectingPoint`.

2. Alternativa mais simples de testar primeiro: manter o tempo fixo e **duplicar
   os pontos de canto** no array de calibração (o mesmo alvo aparece 2×).

3. Ajustar a UI (`CalibrationCheck.tsx`) para refletir a duração variável na
   barra de progresso, senão o feedback visual fica dessincronizado.

⚠️ **Cuidado com fadiga.** O usuário-alvo é pessoa com ELA. Se a calibração total
passar de ~40 s, o ganho de precisão pode ser anulado pela piora na qualidade das
últimas fixações. Medir o tempo total antes/depois.

### Critério de aceite
Sprint 0 remedida. Comparar especificamente o erro nos pontos de validação de
borda (P1, P3, P8, P10) contra os centrais (P11, P12, P13).

---

## Sprint 3 — Expansão dos termos de interação com pose

`extractor.ts:extractCompactFeatures` já tem 6 termos de interação:
```ts
offsetX*yaw, offsetY*pitch, offsetX*scale, offsetY*scale, offsetX*roll, offsetY*roll
```

Isso é compensação de pose de primeira ordem dentro de um modelo linear. Expandir
para segunda ordem é **custo computacional zero** (as variáveis já estão
calculadas) e o λ por CV cuida do overfitting.

### Tarefas

1. Adicionar ao array `interactions`:
   ```ts
   offsetX * pose.yaw * pose.yaw,
   offsetY * pose.pitch * pose.pitch,
   offsetX * pose.yaw * pose.scale,
   offsetY * pose.pitch * pose.scale,
   pose.yaw * pose.scale,
   pose.pitch * pose.scale,
   ```
   De 6 → 12 termos. Vetor por olho: ~31 → ~37 dims.

2. Com 13 pontos × ~30 amostras ≈ 390 amostras de calibração, há folga
   estatística de sobra para 37 features.

3. **Verificar se o λ escolhido pelo CV muda.** `ridge.ts:selectLambdaCV` já
   loga o valor. Se o λ subir muito (ex. de 0.1 para 100), é sinal de que as
   novas features estão majoritariamente ruído — nesse caso, reverter.

4. Atualizar `featurePipeline.parity.test.ts` se ele fixa o comprimento do vetor.

### Critério de aceite
Sprint 0 remedida. **O ganho deve aparecer principalmente na condição C2**
(cabeça livre). Se só melhorar em C1 (cabeça parada), as features novas estão
overfitando — reverter.

---

## Sprint 4 — Recalibração implícita (RLS)

**Provavelmente o item de maior impacto no produto**, não só na métrica. Para
usuário com ELA, pedir recalibração manual é barreira real de acessibilidade.

### Tarefas

1. Implementar `src/recursiveRidge.ts` — atualização do modelo Ridge por
   mínimos quadrados recursivos com fator de esquecimento:

   ```
   P₀ = (1/λ) I                          // matriz de covariância inicial
   
   para cada nova amostra (φ, y):
     k = P φ / (μ + φᵀ P φ)              // ganho
     β ← β + k (y − φᵀβ)                 // atualização dos coeficientes
     P ← (P − k φᵀ P) / μ                // atualização da covariância
   
   μ = fator de esquecimento, 0.98–0.995
   ```

2. Alimentar com **dwell clicks confirmados**: quando o usuário completa um dwell
   sobre um botão, a posição do centro do botão é um alvo supervisionado. Adicionar
   um hook no `GazeContext` que reporte `(features, targetX, targetY)` ao
   completar a seleção.

3. **Fallback conservador — obrigatório.** Manter o modelo da calibração explícita
   como base estável. Só migrar gradualmente para o modelo online depois de
   acumular evidência suficiente:
   ```ts
   const w = Math.min(1, nOnlineSamples / 50);   // rampa até 50 amostras
   pred = (1 - w) * predBase + w * predOnline;
   ```
   Sem isso, um dwell acidental (usuário olhando para outro lugar quando o clique
   dispara) degrada o modelo permanentemente.

4. **Rejeição de outlier**: descartar a amostra se a predição atual estiver a mais
   de N px do alvo do dwell (provável falso positivo).

5. Feature flag: `USE_ONLINE_CALIBRATION = false` por padrão.

### Critério de aceite
Sprint 0 remedida, mas o teste relevante aqui é a **curva de deriva 0/20/40 min**.
Esperado: o erro aos 40 min ficar próximo do erro aos 0 min, em vez de crescer.

---

## Sprint 5 — Tuning do filtro temporal

Hoje há **duas camadas de suavização em série**:
- `engine.ts`: buffer ponderado de 6 frames (pesos 1..6)
- `oneEuroFilter.ts`: One Euro com `mincutoff = 0.005`, `beta = 1.5`

`mincutoff = 0.005` é muito agressivo. Combinado com o buffer, provavelmente há
lag desnecessário.

### Tarefas

1. **Testar remover o buffer ponderado** e deixar só o One Euro. O One Euro já é
   um passa-baixa adaptativo; o buffer em série adiciona lag sem adicionar
   robustez.

2. Fazer varredura de `mincutoff` × `beta` medindo os dois eixos do trade-off:
   - **jitter** (`jitterRMS` da Sprint 0) — quanto menor, melhor
   - **lag** — medir com um alvo em movimento (o `FollowTarget.tsx` já existe
     em `pages/games/`; instrumentar para logar erro de rastreamento)

   Grade sugerida: `mincutoff ∈ {0.005, 0.02, 0.1, 0.5}`, `beta ∈ {0.5, 1.5, 5}`.

3. Expor **dois presets** em `SettingsScreen.tsx`:
   - `estável` — jitter baixo, para leitura e navegação
   - `responsivo` — lag baixo, para teclado virtual e jogos

### Critério de aceite
Tabela jitter × lag para todas as combinações testadas, com os dois presets
escolhidos e justificados.

---

## Sprint 6 — Medição final e documento comparativo

### Tarefas

1. Rodar a matriz completa (4 condições × curva 0/20/40 min) com todas as sprints
   ativas.

2. Criar `docs/RESULTADOS.md` com tabela comparativa:

   | Sprint | meanError (px) | medianError | p90 | jitterRMS | erro @40min | Δ vs S0 |
   |---|---|---|---|---|---|---|
   | S0 baseline | | | | | | — |
   | S1 bugs | | | | | | |
   | S2 periferia | | | | | | |
   | S3 interações | | | | | | |
   | S4 RLS | | | | | | |
   | S5 filtro | | | | | | |

3. **Ablação**: desligar uma sprint por vez com as outras ativas, para isolar a
   contribuição de cada uma. Ganhos não são aditivos.

4. Registrar também: tempo total de calibração, taxa de falha por ponto, e FPS
   médio ao longo de 40 min.

### Critério de aceite
`docs/RESULTADOS.md` completo. Este documento é o insumo para decidir se vale
investir em encoder aprendido (L2CS ou encoder de landmarks) — sem ele, essa
decisão é palpite.

---

## Trilha paralela — Coleta de dados (começar já)

Independente das sprints acima, e com o maior tempo de espera de todo o projeto.

- Submeter protocolo ao comitê de ética (tempo de tramitação longo)
- Definir termo de consentimento — landmarks e head pose **são dado biométrico**,
  mesmo sem armazenar vídeo
- Meta: ~30 participantes, 50+ sessões, com variação de iluminação, óculos, idade
- Formato: salvar por sessão as features extraídas + alvos + metadados, não vídeo
- Referência de escala: EMC-Gaze treinou com ~32 participantes / 50–60 sessões

Este dataset é o único ativo do projeto que não vira obsoleto e não tem passivo
de licença. É pré-requisito para qualquer encoder aprendido próprio.

---

## Fora de escopo deste plano

Decidir **depois** da Sprint 6, com números na mão:

- **L2CS-Net / CNN de aparência** — pesos oficiais vêm de Gaze360/MPIIFaceGaze,
  ambos não-comerciais. Ok para experimento acadêmico atrás de feature flag;
  bloqueante para produto. ResNet-50 fp32 não cabe no orçamento de 30 fps.
- **Encoder leve sobre landmarks** (linha do EMC-Gaze) — mais promissor que CNN de
  pixels: ~944k params, 4,76 MB ONNX, ~12 ms no browser, sem passivo de licença.
  Requer a trilha de coleta de dados concluída.