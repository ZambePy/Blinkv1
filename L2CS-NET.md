# Pipeline Técnico L2CS — Adaptado ao IrisFlow

> Adaptação da arquitetura proposta (MediaPipe → recorte → L2CS → mapeamento
> polinomial → Ridge → One Euro) para o ecossistema TypeScript/Electron do
> projeto. **Sem código de implementação** — apenas estágios, contratos de dados
> e onde cada peça vive.

---

## 1. Visão geral

### Pipeline proposto (referência)

```
[Webcam] → [MediaPipe Face] → [Recorte] → [L2CS] → (pitch, yaw)
                                                        ↓
[One Euro] ← [Ridge] ← [Polinomial grau 2] ←────────────┘
     ↓
  (X, Y) px
```

### Pipeline adaptado ao IrisFlow

```
                    ┌─────────────────────────────────────────┐
[Webcam] ──────────►│ E1  engine.ts — captura + desespelhamento│
                    └────────────────┬────────────────────────┘
                                     ▼
                    ┌─────────────────────────────────────────┐
                    │ E2  MediaPipe FaceLandmarker (existente) │
                    │     478 landmarks + transformationMatrix │
                    └───────┬─────────────────────────┬───────┘
                            │                         │
              ┌─────────────▼──────────┐   ┌──────────▼─────────────┐
              │ E3  recorte do rosto   │   │ E6  extractor.ts       │
              │     (NOVO)             │   │     features geométricas│
              └─────────────┬──────────┘   │     (existente, ~31d)   │
                            ▼              └──────────┬─────────────┘
              ┌────────────────────────┐              │
              │ E4  L2CS worker (NOVO) │              │
              │     10 Hz, assíncrono  │              │
              │     → (yaw, pitch) rad │              │
              └─────────────┬──────────┘              │
                            ▼                         │
              ┌────────────────────────┐              │
              │ E5  expansão polinomial│              │
              │     sobre tan() (NOVO) │              │
              │     → 7 dims           │              │
              └─────────────┬──────────┘              │
                            └──────────┬──────────────┘
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │ E7  scaler.ts → ridge.ts (existentes)   │
                    │     ~38 dims/olho, λ por CV             │
                    └────────────────┬────────────────────────┘
                                     ▼
                    ┌─────────────────────────────────────────┐
                    │ E8  oneEuroFilter.ts (existente)        │
                    └────────────────┬────────────────────────┘
                                     ▼
                                 (X, Y) px
```

**O que é novo:** E3, E4, E5. Todo o resto já existe e não muda.

---

## 2. Estágios

### E1 — Captura e orientação da imagem

**Onde:** `src/tracker/engine.ts`

**Já existe.** O contrato precisa ficar explícito: o consumidor precisa saber
se os pixels do vídeo estão espelhados horizontalmente antes de mandar para
o crop, porque o L2CS foi treinado com a imagem "como a câmera vê".

**Verdicto empírico para o IrisFlow (atualizado após E1):** pixels **NÃO**
estão espelhados. Constante fixada em `IS_VIDEO_MIRRORED = false` no engine.ts.
Evidência:

1. `frontend/src/context/GazeContext.tsx` cria o `<video>` sem
   `transform: scaleX(-1)` (linhas 244-253).
2. `getUserMedia({ facingMode: 'user' })` devolve pixels crus da câmera — os
   browsers não aplicam mirror por padrão nos pixels (só em `<video>` via CSS,
   quando o dev pede).
3. `axis_validation` com foto `look_right` (usuário olhou para a direita dele)
   → yaw = +26° do L2CS. Se pixels estivessem espelhados, yaw viria negativo.

A intuição inicial vinha da linha `targetX = (1.0 - landmarks[1].x) * vw` no
fallback de gaze. Essa inversão é um **proxy de gaze pela pose da cabeça**
(nariz à esquerda da imagem = usuário virou a cabeça à direita = alvo à direita
da tela), **não** evidência de que os pixels estejam espelhados.

**Se essa premissa mudar** (ex.: alguém adiciona um canvas espelhado como source,
ou driver/OS aplica mirror nível-driver), a mitigação continua a mesma da doc
original: desespelhar no crop, nunca inverter o sinal do yaw depois — a
inversão tardia quebra silenciosamente os termos cruzados de E5
(`tan(yaw)·tan(pitch)` é ímpar; `tan(yaw)²` é par).

**Contrato de saída:** `HTMLVideoElement` + `IS_VIDEO_MIRRORED` (constante
exportada de `src/tracker/engine.ts`).

---

### E2 — MediaPipe

**Onde:** `src/tracker/engine.ts` (existente, sem mudanças)

A proposta de referência usa `FaceDetection` (só bounding box). **Vocês já têm
`FaceLandmarker`**, que entrega 478 landmarks + `facialTransformationMatrixes`.
É estritamente mais informação pelo mesmo custo — não adicionar um segundo detector.

**Contrato de saída (já existente):**
```
landmarks: Point3D[478]
faceMatrix: Float32Array[16]   // transformação 4×4
```

---

### E3 — Recorte do rosto **(NOVO)**

**Onde:** novo módulo `src/l2cs/crop.ts`

**Entrada:** `landmarks[478]`, frame de vídeo, `isMirrored`
**Saída:** tensor `Float32Array[1 × 3 × 448 × 448]`

Etapas:

1. **Bounding box a partir dos landmarks** — min/max de x,y sobre os 478 pontos.
   Não usar detector separado.
2. **Expansão** por um fator `EXPAND_FACTOR`, mantendo o **quadrado** (senão o
   resize distorce o rosto).
3. **Desespelhar** se `isMirrored`.
4. **Resize para 448×448.** ⚠️ Verificar no repositório se é `Resize(448) +
   CenterCrop(448)` — se for, o crop já quadrado torna o CenterCrop identidade.
   Confirmar antes, não assumir.
5. **BGR/RGB.** Canvas em JS já entrega RGBA; extrair R,G,B nessa ordem. (Este é
   um bug clássico ao portar de OpenCV, onde o frame é BGR.)
6. **Normalização ImageNet:** `mean=[0.485, 0.456, 0.406]`, `std=[0.229, 0.224, 0.225]`.
7. **Layout NCHW** — canal-primeiro, não canal-último.

⚠️ **`EXPAND_FACTOR` é o parâmetro de maior risco do pipeline inteiro.** O L2CS foi
treinado com uma convenção específica de recorte. Um crop mais apertado ou mais
largo degrada a acurácia **sem sintoma visível** — o modelo devolve ângulos
plausíveis, só que errados. Determinar empiricamente varrendo `[1.0 … 2.0]` e
medindo o erro final, não escolher por intuição.

---

### E4 — Inferência L2CS **(NOVO)**

**Onde:** `src/l2cs/worker.ts` + `src/l2cs/client.ts`

**Entrada:** tensor de E3
**Saída:** `{ yaw: number, pitch: number, valid: boolean, timestamp: number }` — radianos

#### Decodificação dos bins

O modelo devolve dois tensores de 90 logits. Confirmado no `test.py` do repositório:

```
p = softmax(logits)
angulo_graus = Σᵢ pᵢ · i · 4 − 180        // i ∈ [0, 90)
angulo_rad   = angulo_graus · π / 180
```

⚠️ **A fórmula é específica do Gaze360** (90 bins, binwidth 4, offset −180). Os
pesos do MPIIGaze usam parâmetros diferentes. Registrar qual `.pkl` foi exportado
e travar a fórmula correspondente.

⚠️ **Ordem das saídas.** O `forward` do L2CS retorna dois tensores, e há
inconsistência na nomenclatura entre `model.py` e `pipeline.py` do próprio
repositório. **Não deduzir pela ordem — validar empiricamente:** olhar para cima
deve mover um dos ângulos consistentemente; olhar para o lado, o outro. Fixar em
teste antes de seguir.

#### Cadência desacoplada

O loop de rAF **nunca** espera pelo L2CS.

```
CADENCE_MS = 100     // 10 Hz — o gaze angular muda devagar
STALE_MS   = 500     // após isso, valid = false
```

O loop principal a 30 Hz consome sempre o último ângulo válido em cache. As
features de íris (E6) continuam carregando a dinâmica rápida.

#### Degradação graciosa (obrigatória)

Se `valid === false`, o bloco de E5 vai a zero e o Ridge opera com o comportamento
anterior. Em tecnologia assistiva, o sistema nunca pode travar esperando inferência.

---

### E5 — Expansão polinomial **(NOVO)**

**Onde:** `src/extractor.ts`, função nova `buildL2CSBlock`

Esta é a contribuição central da proposta de referência, e está conceitualmente
certa: a relação ângulo→tela é não-linear, e um Ridge linear sobre ângulos crus
distorce nas bordas.

**Mas a expansão correta não é polinômio sobre o ângulo — é tangente.**

A geometria é:

```
x_tela ≈ x_olho + d · tan(yaw)
y_tela ≈ y_olho − d · tan(pitch)
```

E a série de Taylor da tangente é **ímpar**:

```
tan(x) = x + x³/3 + 2x⁵/15 + …
```

Um `PolynomialFeatures(degree=2)` sobre o ângulo gera `x²` — que **não aparece na
expansão**. O termo que falta é `x³`, e grau 2 não o alcança. Você estaria
adicionando um termo que a física não pede e omitindo o que ela pede.

**Solução:** aplicar a tangente primeiro, depois o grau 2 sobre as tangentes. Assim
o termo de 1ª ordem já é exato, e o grau 2 captura resíduo (tela plana, não
esférica; câmera não centrada).

**Bloco de 7 dimensões:**

| # | Termo | Papel |
|---|---|---|
| 1 | `tan(yaw)` | 1ª ordem, eixo X |
| 2 | `tan(pitch)` | 1ª ordem, eixo Y |
| 3 | `tan(yaw) · dProxy` | paralaxe — raio mais longo, desvio maior na tela |
| 4 | `tan(pitch) · dProxy` | idem, eixo Y |
| 5 | `tan(yaw)²` | curvatura residual |
| 6 | `tan(pitch)²` | idem |
| 7 | `tan(yaw) · tan(pitch)` | termo cruzado (rotação/skew da tela) |

`dProxy` = `face.cameraDistanceEstimate`, **já calculado** em `extractor.ts` como
`1/scale3D`.

⚠️ **Clamp obrigatório antes da tangente.** `tan()` explode perto de ±90°. Limitar
os ângulos a ±45° (±π/4). Um único frame de pose extrema envenena o
`StandardScaler.fit` — média e desvio vão a infinito e o regressor inteiro degenera.
É a mesma classe de falha que o comentário anti-NaN em `Math.asin` já documenta
no `extractor.ts`.

---

### E6 — Features geométricas **(existente, mantida)**

**Onde:** `src/extractor.ts` → `src/featurePipeline.ts`

Aqui está a divergência mais importante em relação à proposta de referência, e
vale explicar por quê.

A proposta usa **apenas `(pitch, yaw)`** como entrada do Ridge — 2 números. Isso
descarta tudo que o `extractCompactFeatures` já produz.

**Por que isso quebra:** o yaw do L2CS é o **gaze absoluto no frame da câmera** —
ele já inclui a rotação da cabeça:

```
l2cs_yaw ≈ head_yaw + eye_yaw_relativo
```

Mas a projeção na tela precisa de mais que o ângulo. Precisa de **onde o olho
está** e **a que distância**:

```
x_tela = x_olho + d · tan(yaw)
         ↑        ↑
         └────────┴── nenhum dos dois está em (pitch, yaw)
```

Se o usuário desliza a cadeira 10 cm para o lado sem virar a cabeça, `yaw` não
muda, mas `x_olho` sim — e a predição fica deslocada 10 cm.

E há uma sutileza a mais: **o recorte dinâmico do rosto normaliza a escala na
imagem**, o que torna a saída do L2CS *invariante à distância*. Isso é bom para o
modelo, mas significa que a informação de distância é **removida** justamente
quando a projeção precisa dela. A afirmação de que o recorte dinâmico dá
"imunidade a deslocamentos de cabeça" inverte o efeito real: o crop não confere
imunidade, ele apaga o sinal que compensaria o deslocamento.

**Por isso o L2CS entra como bloco adicional, não como substituto.** O vetor final
contém os dois lados da equação, e o Ridge pode separá-los:

```
vetor/olho = [ ~31 dims geométricas ] + [ 7 dims L2CS ] = ~38 dims
             └─ x_olho, dProxy, pose, ─┘  └─ direção ──┘
                offsets de íris
```

---

### E7 — Normalização e Ridge **(existentes, sem mudanças)**

**Onde:** `src/scaler.ts`, `src/ridge.ts`, `src/calibration.ts`

**Nada muda aqui.** `numFeatures` já é derivado dinamicamente do comprimento do
vetor. O sistema normal `(ΦᵀΦ + λI)β = Φᵀy` com bias não regularizado continua igual.

Dois pontos sobre a proposta de referência que **não** devem ser adotados:

**1. `alpha = 5.0` fixo.** O `ridge.ts` já seleciona λ por CV leave-one-target-out
sobre `[1e-4 … 1000]`. Um α fixo sobre features não padronizadas é arbitrário: a
penalidade `λ‖β‖²` pesa de forma desigual quando as features têm escalas diferentes
(radianos ~0.5, tangentes ao quadrado ~0.25, offsets de íris ~0.02). A CV existente
é estritamente melhor — manter.

*Diagnóstico útil:* o `selectLambdaCV` já loga o λ escolhido. Se ele saltar muito ao
ligar o L2CS (ex. de 0.1 para 100), as novas features estão sendo regularizadas
para fora — sinal de que não contribuem.

**2. Mediar 10 frames em 1 amostra por ponto.** A proposta coleta 10 frames por
ponto e guarda a média — 13 pontos vira **13 linhas de treino**.

O `calibration.ts` atual coleta por 1500 ms com 400 ms de descarte inicial: a 30 fps
são ~33 amostras/ponto, **~430 amostras totais**. Com 38 features, a diferença entre
430 e 13 amostras é a diferença entre um sistema regularizado e um sistema
subdeterminado.

A média também descarta a informação de **variância** — que é exatamente o que
permite ao Ridge saber quais pontos foram fixados com firmeza e quais não. Manter o
comportamento atual.

---

### E8 — Filtro temporal **(existente)**

**Onde:** `src/oneEuroFilter.ts` + buffer em `src/tracker/engine.ts`

Já implementado. Dois pontos a verificar:

1. **`te` deve ser o Δt real entre frames**, não uma constante. Se o filtro
   assumir `te = 1.0` enquanto os frames chegam a ~33 ms, o cálculo de `alpha` fica
   errado e o comportamento não corresponde aos parâmetros configurados.

2. **Há duas camadas de suavização em série** — o buffer ponderado de 6 frames no
   `engine.ts` e o One Euro. Ao adicionar o L2CS, a fonte de ruído muda: o L2CS é
   frame-a-frame, sem modelo temporal, e a 10 Hz pode introduzir degraus visíveis
   quando o ângulo atualiza. Retunar `mincutoff`/`beta` **depois** da integração,
   não antes.

---

## 3. Contratos de dados

```
E2 → E3    landmarks: Point3D[478], video: HTMLVideoElement, isMirrored: boolean
E3 → E4    Float32Array[1×3×448×448]   NCHW, RGB, normalizado ImageNet
E4 → E5    { yaw: rad, pitch: rad, valid: boolean, timestamp: ms }
E5 → E7    number[7]                    (zeros se valid === false)
E6 → E7    number[31] × 2 (olho E/D)
E7 → E8    { x: 0..1, y: 0..1 }         normalizado, clampeado 1× após média binocular
E8 → UI    { x: px, y: px }
```

---

## 4. Resumo das divergências

| # | Proposta de referência | Adaptação | Razão |
|---|---|---|---|
| 1 | Ridge sobre `(pitch, yaw)` apenas | L2CS como bloco adicional às features geométricas | `(yaw,pitch)` não contém `x_olho` nem `d`; o crop apaga a distância |
| 2 | `PolynomialFeatures(degree=2)` sobre ângulos | `tan()` primeiro, grau 2 sobre as tangentes | A expansão de `tan` é ímpar (`x + x³/3`); grau 2 gera `x²`, que não aparece nela |
| 3 | Média de 10 frames → 1 amostra/ponto | Manter ~33 amostras/ponto | 430 vs 13 linhas de treino para 38 features |
| 4 | `Ridge(alpha=5.0)` | λ por CV (já implementado) | α fixo sobre features de escalas distintas penaliza de forma desigual |
| 5 | `FaceDetection` (bbox) | `FaceLandmarker` (478 pts) — já em uso | Mais informação, mesmo custo, sem dependência nova |
| 6 | L2CS síncrono no loop | Worker a 10 Hz + degradação graciosa | ResNet-50 a 448×448 ≈ 16 GFLOPs; não cabe em 33 ms |

---

## 5. Ordem de implementação

| Ordem | Estágio | Arquivo | Critério de pronto |
|---|---|---|---|
| 1 | E4 — worker + decodificação | `src/l2cs/worker.ts` | Ordem yaw/pitch validada empiricamente; latência p50 medida |
| 2 | E3 — recorte | `src/l2cs/crop.ts` | `EXPAND_FACTOR` escolhido por varredura, não por intuição |
| 3 | E1 — desespelhamento | `src/tracker/engine.ts` | Teste travando o sinal do yaw |
| 4 | E5 — bloco de 7 dims | `src/extractor.ts` | Clamp ±45° antes da tangente; zeros quando `valid === false` |
| 5 | E6/E7 — integração | `src/featurePipeline.ts` | Bloco anexado sempre (L2CS é obrigatório); testes de paridade atualizados (31→38 dims) |
| 6 | E8 — retuning | `src/oneEuroFilter.ts` | Jitter medido antes/depois |

**Medição:** `startAccuracyTest` (`src/accuracy.ts`) com a flag on/off, nas condições
do `BASELINE.md`. O ganho deve concentrar-se na condição de **cabeça livre**. Se
aparecer só com cabeça parada, as features novas estão absorvendo variância que o
modelo geométrico já explicava.

---

## 6. Riscos de falha silenciosa

Os cinco pontos onde o sistema erra sem avisar:

1. **`EXPAND_FACTOR` fora da convenção de treino** — ângulos plausíveis mas errados
2. **Ordem yaw/pitch trocada** — o Ridge "funciona" e o ganho não aparece
3. **Vídeo espelhado** — corrompe os termos cruzados de E5
4. **Fórmula de decodificação errada** — Gaze360 e MPIIGaze usam parâmetros distintos
5. **Canal de cor trocado** — BGR onde o modelo espera RGB

Nenhum dos cinco gera exceção. Todos exigem validação explícita.