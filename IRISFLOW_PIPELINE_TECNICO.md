# IrisFlow — Documento Técnico de Engenharia
## Pipeline Completo, Diagnóstico e Roadmap de Evolução para Precisão Clínica

**Classificação:** Documento interno de engenharia  
**Versão:** 1.0  
**Contexto:** Tecnologia assistiva — rastreamento ocular via webcam para comunicação alternativa (AAC)  
**Stack atual:** Vite + TypeScript + MediaPipe Tasks Vision (`@mediapipe/tasks-vision ^0.10.35`)

---

## Sumário

1. [Contexto clínico e justificativa](#1-contexto-clínico-e-justificativa)
2. [Arquitetura atual do projeto](#2-arquitetura-atual-do-projeto)
3. [Pipeline de dados — fluxo passo a passo](#3-pipeline-de-dados--fluxo-passo-a-passo)
4. [Análise crítica: o que já funciona bem](#4-análise-crítica-o-que-já-funciona-bem)
5. [Gargalos identificados e por que existem](#5-gargalos-identificados-e-por-que-existem)
6. [Adições propostas — o que adicionar e onde encaixar](#6-adições-propostas--o-que-adicionar-e-onde-encaixar)
7. [Metas de desempenho mensuráveis](#7-metas-de-desempenho-mensuráveis)
8. [Critérios de aceitação clínica](#8-critérios-de-aceitação-clínica)

---

## 1. Contexto clínico e justificativa

O IrisFlow tem como objetivo final ser uma alternativa acessível a dispositivos de eye tracking dedicados como o **Tobii Dynavox**, utilizados por pessoas com paralisia cerebral, ELA, AVC, e outras condições que comprometem a comunicação verbal e motora.

### Por que a precisão importa nesse contexto

Em um sistema de comunicação alternativa (AAC), o usuário seleciona letras, palavras ou símbolos olhando para alvos na tela. O tamanho típico de um botão em uma prancha de CAA é de **60×60px a 120×120px** em uma tela Full HD (1920×1080). Para que a seleção seja confiável, o erro de estimativa do olhar precisa ser consistentemente menor que metade do menor alvo.

| Parâmetro | Tobii Dynavox PCEye 5 | Tobii Eye Tracker 5 | Meta IrisFlow |
|---|---|---|---|
| Erro angular médio | ~0.4° | ~0.9° | ≤ 1.5° |
| Erro em pixels (60cm, 24") | ~10–15px | ~25px | ≤ 45px |
| Taxa de amostragem | 60 Hz | 60 Hz | ≥ 25 Hz |
| Latência ponta a ponta | ~35ms | ~35ms | ≤ 80ms |
| Robustez a movimento de cabeça | Alta (câmera IR) | Moderada | Moderada com compensação |

A diferença entre "funciona como experimento" e "funciona como ferramenta clínica" está precisamente nesses números.

---

## 2. Arquitetura atual do projeto

```
irisflow/
├── index.html              ← Ponto de entrada HTML
└── src/
    ├── main.ts             ← Loop principal: câmera → landmarks → gaze bruto → laser
    ├── calibration.ts      ← Calibração 16 pontos + fase dinâmica + mapeamento bilinear
    ├── accuracy.ts         ← Teste de validação pós-calibração (5 pontos)
    ├── counter.ts          ← (não usado no pipeline principal)
    └── style.css           ← UI completa: laser, overlays, painel de controle
```

### Dependências

- `@mediapipe/tasks-vision ^0.10.35` — detecção de face e landmarks 3D
- Vite + TypeScript — bundler e tipagem estática
- Sem dependências de ML adicionais (tudo roda no browser)

---

## 3. Pipeline de dados — fluxo passo a passo

O pipeline completo do IrisFlow em sua versão atual percorre 8 etapas distintas desde o pixel bruto da câmera até o pixel do cursor na tela.

---

### Etapa 1 — Captura de vídeo (`main.ts`, função `startCamera`)

**O que acontece:**
O navegador abre a câmera via `getUserMedia` solicitando resolução `1280×720` em modo `facingMode: "user"`. O frame de vídeo é alimentado ao MediaPipe a cada iteração do loop via `requestAnimationFrame`.

**Detalhe técnico importante:**
A tag `<video>` tem `transform: scaleX(-1)` no CSS — isso espelha a imagem visualmente para o usuário, mas **os landmarks do MediaPipe são sempre extraídos da imagem não-espelhada**. Toda a lógica de inversão de X já foi corretamente compensada no código com `ratioXL = 1.0 - ratioXL`.

**Estado atual:** correto e adequado.

---

### Etapa 2 — Detecção de face e landmarks 3D (`main.ts`, `FaceLandmarker`)

**O que acontece:**
O `FaceLandmarker` do MediaPipe Tasks Vision roda inferência sobre o frame atual e retorna:
- **478 landmarks 3D** normalizados (coordenadas X/Y/Z entre 0 e 1)
- **`facialTransformationMatrixes`**: uma matriz 4×4 column-major que encoda a pose da cabeça no espaço da câmera

**Landmarks relevantes usados:**

| Grupo | Índices | Uso |
|---|---|---|
| Íris direita do usuário (olho esquerdo na imagem) | 468–472 | Centro da íris (média dos 5 pontos) |
| Íris esquerda do usuário (olho direito na imagem) | 473–477 | Centro da íris (média dos 5 pontos) |
| Canto externo olho direito (usuário) | 33 | Referência horizontal |
| Canto interno olho direito (usuário) | 133 | Referência horizontal |
| Canto externo olho esquerdo (usuário) | 263 | Referência horizontal |
| Canto interno olho esquerdo (usuário) | 362 | Referência horizontal |

**Configuração atual:**
```typescript
outputFaceBlendshapes: false,          // correto — não precisa
outputFacialTransformationMatrixes: true, // crítico para compensação de pose
runningMode: "VIDEO",
numFaces: 1
```

**Estado atual:** correto. `refine_landmarks` não existe nesta API (Tasks Vision), mas os 478 landmarks já incluem os pontos de íris refinados por padrão.

---

### Etapa 3 — Compensação de pose da cabeça (`main.ts`, funções `extractRotationMatrix` e `applyMatrix3`)

**O que acontece:**
Esta é uma das partes mais sofisticadas do projeto atual e merece atenção especial.

A matriz 4×4 retornada pelo MediaPipe (`facialTransformationMatrixes`) representa a transformação do espaço canônico da cabeça (um rosto "neutro" frontal) para o espaço da câmera. Em outras palavras:

```
P_câmera = M * P_cabeça
```

Para remover o efeito da rotação da cabeça dos landmarks antes de calcular os ratios de íris, o código extrai a submatriz de rotação 3×3 e calcula sua transposta, que para matrizes de rotação é igual à inversa:

```typescript
// R^T = R^{-1} para matrizes de rotação ortogonais
Rinv = transposta(R)
// Depois: P_cabeça = R^T * P_câmera
const irisL = toHead(irisL_cam);
```

**Por que isso importa:** sem essa etapa, virar a cabeça para a esquerda deslocaria o cursor para a esquerda mesmo que os olhos estivessem olhando para o centro. Com a compensação, o cursor reflete apenas o movimento dos olhos, não da cabeça.

**Estado atual:** matematicamente correto e bem implementado.

---

### Etapa 4 — Cálculo dos Gaze Ratios (`main.ts`, bloco principal de `predictWebcam`)

**O que acontece:**
Com os landmarks já no espaço da cabeça (compensados), o código calcula dois números escalares que representam a posição da íris dentro da abertura do olho:

**Ratio horizontal (ratioX):**
```
ratioXL = (irisL.x - min(eyeOuterL.x, eyeInnerL.x)) / |eyeOuterL.x - eyeInnerL.x|
ratioXL = 1.0 - ratioXL   ← inversão para corrigir orientação
```

**Ratio vertical (dy):**
```
stableCenterY = (eyeOuterL.y + eyeInnerL.y) / 2
dyL = (irisL.y - stableCenterY) / eyeWidthL   ← normalizado pela largura
```

Os dois olhos são calculados independentemente e depois **a média é tomada** (`ratioX = (ratioXL + ratioXR) / 2`, `dy = (dyL + dyR) / 2`), o que aumenta estabilidade ao cancelar ruído assimétrico entre os olhos.

**Estado atual:** boa escolha de features. A normalização de `dy` pela largura do olho (em vez da altura) é deliberada — a largura é mais estável frente a mudanças de iluminação que fazem a pupila dilatar/contrair.

---

### Etapa 5 — Calibração auto-adaptativa de limites (`main.ts`, variáveis `minX/maxX/minY/maxY`)

**O que acontece:**
Antes de existir um perfil de calibração formal, o sistema opera com um mecanismo de fallback adaptativo. Ele expande dinamicamente os limites `[minX, maxX]` e `[minY, maxY]` conforme o usuário olha para diferentes regiões, e aplica um **decaimento lento** (`CALIBRATION_DECAY = 0.0001`) para que os limites retornem gradualmente aos defaults caso o usuário pare de usar as bordas extremas.

**Função no fluxo:**
```
calibration.feedRawData(ratioX, dy)   ← envia ao sistema de calibração formal
feedAccuracyRaw(ratioX, dy)           ← envia ao sistema de teste

se calibrated → calibration.mapGaze(ratioX, dy)   ← usa bilinear 4×4
senão         → mapRange(ratioX, minX/maxX...)     ← fallback linear
```

**Estado atual:** funcional como fallback. Não é adequado como método principal porque o mapeamento linear não captura a não-linearidade do movimento angular da íris. Serve como experiência inicial sem calibração.

---

### Etapa 6 — Calibração formal: coleta e mapeamento bilinear (`calibration.ts`)

Esta é a etapa mais complexa e a que tem maior impacto na precisão final. Divide-se em três sub-fases:

#### 6a — Fase 1: Calibração estática (16 pontos)

O usuário olha para 16 pontos em grade 4×4 (`TARGET_POINTS`), distribuídos de `(3%, 3%)` a `(97%, 97%)` da tela. Para cada ponto:

1. O usuário pressiona Espaço ou clica
2. O sistema coleta amostras brutas por `COLLECTION_MS = 1000ms`
3. Calcula o desvio padrão das amostras (`stdDev`)
4. Se `stdDev > STD_THRESHOLD_X (0.015)` ou `> STD_THRESHOLD_Y (0.010)`, rejeita e pede repetição (máximo `MAX_UNSTABLE_RETRIES = 2`)
5. Caso aprovado, armazena a **média** das amostras como `CalibrationPoint { screenX, screenY, rawX, rawY }`

**Estrutura do perfil:**
```typescript
interface CalibrationPoint {
  screenX: number;  // fração 0–1 da tela
  screenY: number;
  rawX: number;     // ratio horizontal médio coletado
  rawY: number;     // dy vertical médio coletado
}
```
O perfil é salvo no `localStorage` como JSON de 16 elementos.

#### 6b — Fase 2: Calibração dinâmica (snake path 9 waypoints)

Após a fase estática, uma bolinha percorre um caminho em S pela tela (`DYNAMIC_WAYPOINTS`) passando por 9 posições. O sistema coleta amostras contínuas com peso diferenciado:
- **Em movimento** (bolinha se deslocando): `weight = 1.0`
- **Em fixação** (bolinha pulsando): `weight = 3.0`

Ao final, a função `refineDynamicProfile()` usa as amostras dinâmicas para **ajustar conservadoramente** os 16 pontos estáticos com Gaussian weighting espacial:

```
sigma = 0.15, maxDist = 0.35
alpha = min((totalWeight - 5) / 200, 0.30)
ponto.rawX = rawX_estático * (1 - alpha) + rawX_dinâmico * alpha
```

O limite de 30% de influência dinâmica é conservador por design — protege contra variações de atenção durante o movimento da bolinha.

#### 6c — Mapeamento bilinear 4×4 (`mapGaze`)

Com o perfil de 16 pontos, o `mapGaze` faz interpolação bilinear em grade 4×4. Para um par `(ratioX, dy)` de entrada:

1. Interpola os valores `rawX` de cada coluna ao longo do eixo Y → obtém 4 valores de `rawX` na linha do `dy` atual
2. Compara `ratioX` com esses 4 valores → determina em qual célula está → interpola para obter `normX`
3. Faz o mesmo processo no eixo Y → obtém `normY`
4. Multiplica por `window.innerWidth` e `window.innerHeight`

**Estado atual:** funcionalmente correto, mas com limitações matemáticas documentadas na Seção 5.

---

### Etapa 7 — Suavização temporal (`main.ts`, rolling buffer + lerp)

**Rolling buffer ponderado (6 frames):**
```
BUFFER_WEIGHTS = [1, 2, 3, 4, 5, 6]
targetX = média_ponderada(bufferX)  ← frames mais recentes têm maior peso
```

**LERP para animação suave:**
```
currentX = lerp(currentX, targetX, 0.05)
currentY = lerp(currentY, targetY, 0.05)
```

O fator `0.05` significa que a cada frame o cursor avança 5% da distância restante até o alvo — isso produz uma animação exponencialmente decelerada, visualmente agradável.

**Estado atual:** o buffer ponderado é uma forma simplificada de suavização temporal. Funciona bem para reduzir jitter de alta frequência, mas não tem modelo de movimento (não distingue tremor de sacada intencional). A seção 6 descreve o que adicionar aqui.

---

### Etapa 8 — Renderização do cursor e teste de precisão

**Cursor (laser):**
O `<div id="laser">` é posicionado via `style.left` e `style.top` com `will-change: left, top` para otimização de composição pelo browser. O `display: none` durante calibração evita que o cursor distraia o olho do usuário durante a coleta.

**Teste de precisão (`accuracy.ts`):**
Após cada calibração, 5 pontos de validação são exibidos (4 cantos + centro). Para cada ponto, coleta `mapGaze(rawFeedX, rawFeedY)` por `600ms`, calcula o erro euclidiano médio e classifica:

| Score | Critério |
|---|---|
| Excelente | `meanError < 30px` |
| Bom | `meanError < 60px` |
| Regular | `meanError < 100px` |
| Ruim | `meanError ≥ 100px` |

---

## 4. Análise crítica: o que já funciona bem

Antes de propor mudanças, é fundamental reconhecer as decisões de engenharia corretas já presentes:

**Compensação de pose via matriz de rotação inversa**
A inversão da matriz de transformação facial (`R^T`) para transformar landmarks para o espaço canônico da cabeça é matematicamente precisa e elimina a causa mais comum de degradação de precisão em eye tracking com webcam. Poucos projetos open-source implementam isso corretamente.

**Dual-eye averaging**
A média dos dois olhos cancela ruído assimétrico e aumenta robustez a oclusão parcial ou piscada de um olho.

**Detecção de instabilidade durante coleta**
O `stdDev` threshold com retry previne que pontos de calibração ruidosos (o usuário se mexeu) corrompam o perfil. Isso é equivalente ao que sistemas clínicos chamam de "fixation quality check".

**Fase dinâmica com Gaussian weighting**
O refinamento pós-calibração com gaussian spatial weighting e limite conservador de 30% de influência é uma técnica sofisticada. Adiciona amostras de regiões inter-pontos sem arriscar degradar os pontos estáticos bem coletados.

**Calibração persistida em localStorage**
O usuário não precisa recalibrar a cada sessão, o que é crítico para usuários com mobilidade reduzida para quem a calibração é fisicamente custosa.

**Normalização de dy pela largura do olho**
A divisão de `dy` pela `eyeWidthL` (e não pela altura da abertura do olho) é uma escolha inteligente — a largura do olho é muito mais estável sob variações de iluminação e de abertura da pálpebra.

---

## 5. Gargalos identificados e por que existem

### Gargalo 1 — Interpolação bilinear vs. mapeamento não-linear real

**Onde:** `calibration.ts`, função `mapGaze`

**O problema:**
A interpolação bilinear em grade 4×4 assume que o mapeamento entre `(ratioX, dy)` e `(screenX, screenY)` é localmente linear dentro de cada célula da grade. Na prática, o movimento angular da íris produz um mapeamento não-linear com distorção crescente nas bordas da tela. A bilinear subestima sistematicamente o deslocamento em cantos extremos.

**Evidência quantitativa:**
Arxiv 1907.04325 (Tabela 2.3) mostra que o método RBF Kernel com grade 4×4 (16 pontos) alcança MAE de 2.71° sem suavização temporal, vs. 2.97° do polinomial simples — uma diferença de 9%. Mais significativo: com Filtro de Kalman, o RBF cai para 1.33° vs. 1.95° do polinomial (redução de 32%).

**Por que acontece:**
A interpolação bilinear é $O(1)$ e simples de implementar, mas não generaliza bem fora da grade. A Ridge Regression com base polinomial de 2ª ordem — `[1, x, y, x², y², xy]` — captura a curvatura do mapeamento com os mesmos 16 pontos, sem complexidade computacional proibitiva.

---

### Gargalo 2 — Suavização temporal sem modelo de movimento

**Onde:** `main.ts`, rolling buffer + lerp

**O problema:**
O rolling buffer ponderado trata todos os frames como igualmente incertos. Não distingue entre:
- Tremor de fixação (ruído de sensor — deve ser suprimido)
- Sacada ocular (movimento intencional rápido — deve ser seguido com mínimo lag)

O resultado é um trade-off forçado: ou o fator de lerp é baixo (suave mas lento) ou é alto (responsivo mas tremido).

**Evidência quantitativa:**
O mesmo Arxiv 1605.05272 documenta que o Filtro de Kalman reduz o MAE em:
- De 2.97° para 1.95° (polinomial, -34%)
- De 2.71° para 1.33° (RBF, -51%)

O Filtro de Kalman mantém estimativas de posição **e velocidade**, o que permite resposta rápida a sacadas sem amplificar o tremor de fixação.

**Por que acontece:**
O buffer ponderado é intuitivo e fácil de implementar em TypeScript sem dependências. O Kalman requer implementação explícita das equações de predição/correção, mas continua sendo código puro sem bibliotecas.

---

### Gargalo 3 — Ridge Regression ausente (overfitting implícito)

**Onde:** `calibration.ts`, `mapGaze`

**O problema:**
A interpolação bilinear atual não tem parâmetro de regularização. Se dois pontos de calibração adjacentes têm valores de `rawX` muito próximos (porque o usuário olhou de forma ligeiramente imprecisa para pontos vizinhos na grade), a interpolação entre eles produz uma região de altíssima sensibilidade — um pequeno deslocamento da íris causa um grande salto do cursor.

A Ridge Regression resolve isso com regularização L2 (`λ * ||β||²`) que penaliza coeficientes grandes, suavizando implicitamente o mapeamento e tornando-o mais robusto a pontos de calibração levemente ruidosos.

**Evidência quantitativa:**
PMC10966887 demonstra redução de **20% no MSE médio** ao substituir OLS/polinomial por Ridge em experimento de eye tracking móvel, especialmente em condições de dados ruidosos.

---

### Gargalo 4 — Teste de acurácia com apenas 5 pontos e 600ms de coleta

**Onde:** `accuracy.ts`

**O problema:**
O teste de validação coleta dados por apenas 600ms por ponto e usa apenas 5 posições (4 cantos + centro). Em contexto clínico, isso é insuficiente para:
- Avaliar precisão em regiões intermediárias (onde a maioria dos botões de CAA está)
- Detectar deriva temporal (o sistema piora ao longo de uma sessão longa?)
- Produzir um número em graus angulares, que é a unidade usada na literatura e nos dispositivos Tobii para comparação

**Por que acontece:**
O teste atual é adequado como feedback rápido pós-calibração. Não foi projetado como ferramenta de validação clínica.

---

### Gargalo 5 — Ausência de detecção de piscada e de modo de seleção

**Onde:** nenhum arquivo atual

**O problema:**
Para uso em AAC, o usuário precisa de um mecanismo de seleção além do movimento do olhar. Os sistemas Tobii usam "dwell time" (fixação por X milissegundos) ou piscada intencional como clique. O IrisFlow atual move o cursor mas não tem mecanismo de ativação.

O Eye Aspect Ratio (EAR) já está matematicamente disponível com os landmarks presentes — é uma adição que não altera nada do pipeline atual.

---

### Gargalo 6 — Sem normalização inter-ocular explícita no espaço canônico

**Onde:** `main.ts`, cálculo de `ratioX` e `dy`

**O problema:**
Atualmente a compensação de pose é feita corretamente pela matriz `R^T`, mas não há canonicalização explícita pela distância inter-ocular. Se o usuário se aproxima ou afasta da câmera, `eyeWidthL` muda em pixels absolutos, o que afeta a estabilidade de `dy` (normalizado pela largura) e potencialmente de `ratioX`.

A canonicalização formal — `p_i ← (p_i - c) / (||p_263 - p_33|| + ε)` onde `c` é o centro inter-ocular — tornaria as features invariantes à distância da câmera.

---

## 6. Adições propostas — o que adicionar e onde encaixar

As adições a seguir são ordenadas por impacto na precisão final. Nenhuma delas altera o que já existe — todas se encaixam como módulos adicionais ou como etapas inseridas no pipeline após os pontos de integração existentes.

---

### Adição A — `kalman.ts` — Filtro de Kalman 2D

**Onde inserir:** `main.ts`, após o rolling buffer e antes do lerp  
**O que é:** Dois filtros de Kalman independentes (para X e Y), cada um mantendo estado de posição e velocidade estimados

**Equações do filtro (modelo posição-velocidade):**
```
Predição:
  x_pred = x + v
  P_pred = P + Q

Ganho de Kalman:
  K = P_pred / (P_pred + R)

Correção:
  residual = medição - x_pred
  x = x_pred + K * residual
  v = v * 0.8 + K * residual * 0.2   ← estimativa de velocidade
  P = (1 - K) * P_pred

Parâmetros:
  Q_x = 0.0015  (ruído de processo horizontal — movimentos mais rápidos)
  R_x = 0.008   (ruído de medição horizontal)
  Q_y = 0.0008  (ruído de processo vertical — movimentos menores)
  R_y = 0.012   (ruído de medição vertical — mais suavização)
```

**Ponto de integração em `main.ts`:**
```typescript
// ANTES (atual):
bufferX.push(targetX)
targetX = weightedBufferAvg(bufferX)
currentX = lerp(currentX, targetX, 0.05)

// DEPOIS (com Kalman adicionado):
bufferX.push(targetX)
targetX = weightedBufferAvg(bufferX)       ← mantém o buffer existente
const kalmanOut = kalmanGaze.update(targetX, targetY)  ← nova etapa
currentX = lerp(currentX, kalmanOut.x, 0.08)  ← fator levemente maior (Kalman já suavizou)
currentY = lerp(currentY, kalmanOut.y, 0.08)
```

**Impacto esperado:** redução de 30–50% no jitter de fixação, sem aumento perceptível de lag em sacadas.

---

### Adição B — `ridge.ts` — Ridge Regression polinomial de 2ª ordem

**Onde inserir:** `calibration.ts`, como segunda opção de `mapGaze` treinada na conclusão da calibração  
**O que é:** Dois modelos de regressão linear regularizada — um para X, um para Y — com base polinomial `[1, x, y, x², y², xy]`

**Fórmulas:**
```
Feature vector: φ(x, y) = [1, x, y, x², y², xy]

Sistema normal com regularização:
  (XᵀX + λI) β = Xᵀy

Onde:
  X = matriz de design (16 × 6)
  y = vetor alvo (screenX ou screenY dos 16 pontos)
  λ = 0.01 (força da regularização)

Predição:
  screenX̂ = φ(rawX, dy) · β_X
  screenŶ = φ(rawX, dy) · β_Y
```

**Ponto de integração em `calibration.ts`:**
```typescript
// Ao final de completeDynamicCalibration():
refineDynamicProfile()   ← mantido
ridgeModel = trainRidgeModel(profile, lambda=0.01)  ← novo

// Em mapGaze():
se ridgeModel existe → usa predictRidge(ridgeModel, ratioX, dy)
senão               → usa bilinear atual (fallback preservado)
```

**Impacto esperado:** redução de 20% no MSE, especialmente nas bordas e cantos da tela onde a bilinear atual distorce mais.

---

### Adição C — Canonicalização inter-ocular

**Onde inserir:** `main.ts`, após a etapa `toHead()` e antes do cálculo de `ratioX`/`dy`  
**O que é:** Normalização das coordenadas dos landmarks pela distância inter-ocular, tornando as features invariantes à distância da câmera

**Fórmula (baseada em Arxiv 2603.12388):**
```
c = (p_33 + p_263) / 2          ← centro inter-ocular
s = ||p_263 - p_33||            ← distância inter-ocular
p_i_norm = (p_i - c) / (s + ε) ← coordenada normalizada
```

**Ponto de integração:**
```typescript
// Após toHead(), antes dos cálculos de ratio:
const eyeCenter = { x: (eyeOuterL.x + eyeOuterR.x) / 2, y: (eyeOuterL.y + eyeOuterR.y) / 2, z: 0 }
const iod = Math.sqrt(...) // distância inter-ocular
// Normaliza irisL, irisR, eyeOuterL, etc. por iod
```

**Impacto esperado:** estabilização do mapeamento quando o usuário muda de posição (aproxima ou afasta da câmera), reduzindo drift de sessão longa.

---

### Adição D — Eye Aspect Ratio (EAR) para detecção de piscada e dwell time

**Onde inserir:** novo módulo `dwell.ts`, integrado em `main.ts`  
**O que é:** Dois mecanismos de seleção necessários para AAC

**EAR (Eye Aspect Ratio):**
```
EAR = (||P2 - P6|| + ||P3 - P5||) / (2 × ||P1 - P4||)

Landmarks MediaPipe para olho direito:
  P1=33, P4=133 (cantos horizontais)
  P2=160, P6=144 (pálpebra superior/inferior pares externos)
  P3=158, P5=153 (pálpebra superior/inferior pares internos)

Threshold: EAR < 0.18 por ≥ 3 frames consecutivos = piscada intencional
```

**Dwell time:**
```
se cursor permanece em raio R de um alvo por T ms → dispara seleção
  R = 40px (configurável)
  T = 800ms (configurável pelo terapeuta)
```

---

### Adição E — Métricas de acurácia em graus angulares

**Onde inserir:** `accuracy.ts`, como complemento ao erro em pixels atual  
**O que é:** Conversão do erro de pixels para graus angulares (unidade comparável com Tobii)

**Fórmula:**
```
ângulo (graus) = arctan(erro_px / distância_estimada_px)

distância_estimada_px:
  - 60cm de distância típica
  - DPI do monitor (pode ser estimado: window.screen.width / largura física)
  - Ou usar o diâmetro da íris como referência: íris ≈ 11.7mm → usa landmarks 474 e 476
```

---

## 7. Metas de desempenho mensuráveis

As metas abaixo são os critérios objetivos que definem o sucesso da implementação. Cada meta tem fonte de referência, método de medição e valor mínimo aceitável.

---

### Meta 1 — Erro angular médio (MAE) ≤ 1.5°

**O que mede:** desvio médio entre o ponto que o usuário olha e onde o cursor é posicionado, expresso em graus de ângulo visual  
**Método de medição:** 9 pontos de validação (grade 3×3) após calibração completa, 1000ms de coleta por ponto, distância estimada pela íris  
**Valor alvo:** ≤ 1.5°  
**Referência:** Labvanced (webcam alta-resolução + CNN): 1.4° (PMC11289017). Considerando webcam comum, 1.5° é realista com as adições propostas  
**Baseline atual estimado:** 3–4° sem Kalman e Ridge

---

### Meta 2 — Erro em pixels médio ≤ 45px em 1920×1080

**O que mede:** erro euclidiano em pixels na resolução mais comum de monitors de uso clínico  
**Método de medição:** mesmo teste de 9 pontos, calculado diretamente em pixels  
**Valor alvo:** ≤ 45px (equivale a ~1.5° a 60cm com monitor 24")  
**Referência:** Tobii Eye Tracker 5 entrega ~25px. Meta de 45px representa qualidade "boa" aceitável para AAC com botões ≥ 90px  
**Baseline atual:** 80–120px estimados (sem Ridge/Kalman)

---

### Meta 3 — Latência ponta a ponta ≤ 80ms

**O que mede:** tempo entre o movimento do olho e a atualização visível do cursor  
**Método de medição:** gravar tela + câmera sincronizadas, medir frame-a-frame o delay entre inicio da sacada e atualização do cursor  
**Valor alvo:** ≤ 80ms (2 frames a 25fps + tempo de processamento)  
**Referência:** Tobii sistemas: ~35ms. A latência adicional do browser e do MediaPipe tasks é de ~25–40ms  
**Baseline atual:** já adequado. A adição do Kalman não aumenta latência perceptível.

---

### Meta 4 — Taxa de amostragem efetiva ≥ 25 Hz

**O que mede:** quantas estimativas de gaze por segundo o sistema produz em hardware comum  
**Método de medição:** contador de frames em `predictWebcam` por 10 segundos  
**Valor alvo:** ≥ 25 Hz em hardware de nível médio (Core i5/M1, sem GPU dedicada)  
**Referência:** Tobii sistemas: 60 Hz. 25 Hz é o mínimo para dwell time responsivo  
**Baseline atual:** estimado 25–30 Hz com GPU delegate ativo

---

### Meta 5 — Estabilidade em fixação: desvio padrão ≤ 20px

**O que mede:** quanto o cursor tremula quando o usuário está olhando fixamente para um ponto  
**Método de medição:** usuário olha fixamente para o centro por 5 segundos; calcular `std(x)` e `std(y)` das posições do cursor  
**Valor alvo:** `sqrt(std_x² + std_y²) ≤ 20px`  
**Referência:** Tobii: ~8–12px. 20px é aceitável para botões ≥ 60px  
**Impacto esperado das adições:** Kalman reduz tremor em ~50%

---

### Meta 6 — Robustez a movimento de cabeça: degradação ≤ 30px ao mover ±15°

**O que mede:** quanto a precisão piora quando o usuário vira a cabeça levemente (comportamento normal durante uso)  
**Método de medição:** fixar olhar no centro enquanto vira cabeça ±15° em yaw; medir delta do cursor  
**Valor alvo:** cursor não se desloca mais que 30px do centro  
**Impacto esperado da canonicalização inter-ocular:** melhora direta nesta métrica

---

### Meta 7 — Tempo de calibração ≤ 5 minutos

**O que mede:** tempo total desde início da calibração até o sistema estar pronto para uso  
**Método de medição:** cronometrar a experiência completa (16 pontos estáticos + fase dinâmica)  
**Valor alvo:** ≤ 5 minutos (incluindo eventuais retentativas)  
**Baseline atual:** já adequado — calibração atual leva ~3–4 minutos no caminho feliz

---

### Meta 8 — EAR threshold: 0 falsos positivos em 30 segundos de uso normal

**O que mede:** o sistema não deve registrar piscadas/seleções quando o usuário está apenas olhando normalmente (piscadas involuntárias não devem ativar)  
**Método de medição:** 30 segundos de uso sem intenção de selecionar; contar eventos de seleção disparados  
**Valor alvo:** 0 falsos positivos  
**Referência:** EAR < 0.18 por ≥ 3 frames consecutivos — piscadas normais duram 100–400ms (~3–12 frames a 30fps)

---

## 8. Critérios de aceitação clínica

As metas acima são técnicas. Para que o IrisFlow seja considerado apto para uso em contexto de terapia ocupacional ou fonoaudiologia assistiva, são necessários critérios adicionais:

**Reprodutibilidade entre sessões:** o perfil de calibração salvo em localStorage deve produzir resultados dentro de ±15px do desempenho original quando a câmera e o usuário estão na mesma posição. Isso valida que o usuário não precisa recalibrar a cada sessão.

**Degradação aceitável com iluminação variável:** o sistema deve manter erro ≤ 2° em condições de iluminação de 200–1500 lux (típico de ambientes clínicos e domésticos). Abaixo de 200 lux, uma mensagem de alerta deve ser exibida.

**Documentação de limitações para o terapeuta:** o painel de controle deve exibir a métrica de precisão em graus angulares (não apenas pixels), o número da sessão atual, e um indicador de qualidade do sinal de landmarks (percentual de frames com face detectada nos últimos 5 segundos).

**Ausência de dados sensíveis transmitidos:** o vídeo da câmera e os dados de gaze nunca devem sair do dispositivo. Toda a inferência já ocorre no browser (MediaPipe Tasks Vision via WASM). Isso deve ser documentado explicitamente para conformidade com LGPD/HIPAA.

---

*Documento elaborado com base na análise completa do código-fonte do IrisFlow e nas seguintes referências científicas: Arxiv 1605.05272, Arxiv 1907.04325, PMC10966887, PMC11289017, Frontiers in Robotics and AI 11:1369566 (2024), Arxiv 2508.19544.*
