# IrisFlow — Pipeline Técnico (estado real do código)

**Versão:** 3.1 — correções de parâmetros SVR, remoção de referências à fase dinâmica, atualização de issues  
**Data:** 2026-07-13  
**Classificação:** Documento interno de engenharia  
**Contexto:** Tecnologia assistiva — rastreamento ocular via webcam para comunicação alternativa (AAC) para pacientes com ELA e outras condições motoras

> **Nota de versão:** Esta versão substitui completamente a v1.0 (pipeline bilinear de 16 pontos),
> que descrevia uma arquitetura anterior que não existe mais no código. Todos os números e
> comportamentos abaixo foram verificados diretamente nos arquivos-fonte citados.

---

## Sumário

1. [Captura e detecção facial](#1-captura-e-detecção-facial)
2. [Extração de features geométricas](#2-extração-de-features-geométricas)
3. [Extração de tensores para CNN](#3-extração-de-tensores-para-cnn)
4. [Arquitetura e treinamento da CNN](#4-arquitetura-e-treinamento-da-cnn)
5. [Exportação ONNX e inferência em tempo real](#5-exportação-onnx-e-inferência-em-tempo-real)
6. [Fusão de features](#6-fusão-de-features)
7. [Calibração](#7-calibração)
8. [Regressor de personalização](#8-regressor-de-personalização)
9. [Validação pós-calibração](#9-validação-pós-calibração)
10. [Output final — suavização e cursor](#10-output-final--suavização-e-cursor)
11. [Issues conhecidas e pendências](#11-issues-conhecidas-e-pendências)

---

## 1. Captura e detecção facial

**Arquivos:** `src/main.ts` (função `initMediaPipe`, linha 139; `startCamera`, linha 163; `predictWebcam`, linha 180)

### MediaPipe FaceLandmarker

O `FaceLandmarker` do pacote `@mediapipe/tasks-vision` (versão `^0.10.35`) é inicializado com:

```typescript
faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: `${_mediapipeBase}/models/face_landmarker.task`,
    delegate: "GPU"
  },
  outputFaceBlendshapes: false,
  outputFacialTransformationMatrixes: true,
  runningMode: "VIDEO",
  numFaces: 1
});
```

**Assets empacotados localmente** (`public/mediapipe/`):
- WASM: `public/mediapipe/wasm/` — copiados de `node_modules/@mediapipe/tasks-vision/wasm/` em build-time
- Modelo: `public/mediapipe/models/face_landmarker.task` (float16, 3.6 MB)
  - Origem original: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- Todos os assets são servidos localmente; nenhuma chamada de rede ocorre para o MediaPipe em runtime

**Câmera:** resolução solicitada `1280×720`, `facingMode: "user"`. O loop de inferência roda via `requestAnimationFrame` e chama `detectForVideo` apenas quando o timestamp do frame muda (`lastVideoTime !== video.currentTime`).

**Saída por frame:** array de 478 landmarks 3D normalizados [0,1] + matriz de transformação facial 4×4 (column-major, usada para pose da cabeça).

**Diagnósticos em runtime:**
- FPS medido e exibido no painel de controle
- Qualidade de sinal: % de frames com face detectada nos últimos 5 s
- Iluminação: análise de luminância via thumbnail 32×18 a cada 3 s; alerta se média < 40

---

## 2. Extração de features geométricas

**Arquivos:** `src/extractor.ts` (função `extractEyeFeatures`, linha 108); `src/featurePipeline.ts` (função `extractFeatures`, linha 35)

### Normalização de pose (extractor.ts:113–148)

Os 478 landmarks são transformados para o espaço canônico da cabeça antes de qualquer extração:

1. **Eixos de referência:** construídos a partir dos cantos externos dos olhos (landmarks 33 e 263) e do topo da cabeça (landmark 10)
2. **Rotação R^T:** cada ponto é transladado para o centro inter-ocular e rotacionado pela transposta da matriz de rotação (equivalente à inversa para matrizes ortogonais)
3. **Normalização por distância inter-ocular:** divide todos os pontos rotacionados pela norma `||rightCornerRot - leftCornerRot||`, tornando as features invariantes à distância da câmera

### Construção do vetor de features

Após a normalização, três grupos de landmarks são extraídos:

| Grupo | Constante | Nº de índices | Dimensões (×3 coords) |
|---|---|---|---|
| Landmarks do olho esquerdo | `LEFT_EYE_INDICES` | 76 | 228 floats |
| Landmarks do olho direito | `RIGHT_EYE_INDICES` | 76 | 228 floats |
| Landmarks mútuos (compartilhados) | `MUTUAL_INDICES` | 9 | 27 floats por olho |

Os ângulos de Euler (yaw, pitch, roll) são calculados a partir da `facialTransformationMatrix` quando disponível (extractor.ts:177–186), ou estimados dos próprios landmarks caso contrário. Os 3 ângulos são appended a cada vetor.

**Vetor final por olho:**
- 76 landmarks específicos × 3 = 228 floats
- 9 landmarks mútuos × 3 = 27 floats
- 3 ângulos (yaw, pitch, roll) = 3 floats
- **Total: 258 floats por olho**

Confirmado pelo comentário em `featurePipeline.ts:8`: `~258 dims por olho`.

### Detecção de piscada (extractor.ts:192–217)

O Eye Aspect Ratio (EAR) é calculado para cada olho usando os landmarks de pálpebra. Um histórico dos últimos 50 frames é mantido; o threshold é adaptativo (80% da média do histórico, mínimo de 15 amostras). Se `ear < threshold`, o frame é descartado pelo pipeline (`predictWebcam:213`).

### FEATURE_MODE

`featurePipeline.ts:18` define `FEATURE_MODE: FeatureMode = 'geometry_only'` como constante de compilação. Em modo `geometry_only`, apenas as 258 features geométricas por olho chegam ao regressor. O vetor fundido (`fusedLeft/Right`) é calculado mas não usado na predição enquanto este modo estiver ativo.

---

## 3. Extração de tensores para CNN

**Arquivo:** `src/eyeCrop.ts` (função principal `extractCrops`, linha 229)

A cada frame, 4 tensores são extraídos da imagem de vídeo para alimentar o encoder CNN:

### Tensores de entrada

| Tensor | Dimensões | Origem |
|---|---|---|
| `face` | `[224, 224, 3]` = 150.528 floats | Convex hull de todos os 478 landmarks (min/max x,y) |
| `leftEye` | `[112, 112, 3]` = 37.632 floats | Bbox dos índices [33, 133, 159, 145] + margem EYE_MARGIN=0.4 |
| `rightEye` | `[112, 112, 3]` = 37.632 floats | Bbox dos índices [362, 263, 386, 374] + margem + **flipH=true** |
| `rect` | `[12]` floats | Coords normalizadas das 3 bboxes (face, le, re) por imgW/imgH |

**Normalização de pixel:** RGBA → RGB float32, dividido por 255.0. Ordem `[0,1]`.

**Face bbox** (`eyeCrop.ts:93`): min/max de todos os 478 landmarks em pixels, com `Math.trunc` (equivale ao `int()` do Python) e clamp nos limites da imagem. Replica `preprocess.py` exatamente.

**Eye bbox** (`eyeCrop.ts:71`): centro + half_width/height × (1 + EYE_MARGIN=0.4), com `Math.trunc` antes do clamp. O olho direito é espelhado horizontalmente (`flipH=true`) para paridade com o pipeline de treino Python.

**Vetor rect** (`eyeCrop.ts:122`): 12 floats na ordem `[fw/W, fh/H, fx1/W, fy1/H, le_w/W, le_h/H, le_x1/W, le_y1/H, re_w/W, re_h/H, re_x1/W, re_y1/H]`. Mesma ordem do `preprocess.py`.

**Paridade com Python:** a equivalência geométrica entre `eyeCrop.ts` e `preprocess.py` é verificada por testes de paridade em `src/eyeCrop.geometry.test.ts`, `src/eyeCrop.pixel.test.ts`, e validada pelo script `python_ml/validate_eyecrop_parity.py`.

**OffscreenCanvas cacheado:** os 3 canvas (face 224×224, olhos 112×112) são reutilizados entre frames para evitar alocação. O log de falhas (`_failLog`) registra até 200 entradas de frames inválidos e pode ser exportado via `window.__exportEyeCropLog()` no console do DevTools.

---

## 4. Arquitetura e treinamento da CNN

**Arquivo:** `python_ml/train_cnn.py`

> **Aviso de licença:** O dataset MPIIFaceGaze usado no treinamento é disponibilizado para uso
> **não-comercial apenas** (licença acadêmica). O uso do modelo derivado em contexto comercial
> requer substituição do dataset por dados com licença compatível.

### Dataset

- **MPIIFaceGaze** — 15 sujeitos (p00–p14), imagens de rosto + anotações de coordenada de olhar na tela
- Localização pré-processada: `python_ml/datasets/prototype_nc_mpiifacegaze/processed/`
- Formato: TFRecord (splits `train.tfrecord`, `val.tfrecord`)
- Gerado por `python_ml/preprocess.py`

### Arquitetura (GazeFollower-inspired)

```
Entradas:
  face      : (None, 224, 224, 3)
  left_eye  : (None, 112, 112, 3)
  right_eye : (None, 112, 112, 3)
  rect      : (None, 12)

Ramos:
  face branch:      Conv(32)+BN+ReLU+MaxPool  →  Conv(64)+BN+ReLU+MaxPool  →  Conv(128)+BN+ReLU+MaxPool  →  GAP  →  128 floats
  left_eye branch:  Conv(32)+BN+ReLU+MaxPool  →  Conv(64)+BN+ReLU+MaxPool  →  GAP  →  64 floats
  right_eye branch: Conv(32)+BN+ReLU+MaxPool  →  Conv(64)+BN+ReLU+MaxPool  →  GAP  →  64 floats

Concat: [128 + 64 + 64 + 12] = 268 floats

Head:
  Dense(256, activation='relu', name='embedding')  →  256 floats  [extraído para ONNX]
  Dense(2,   activation='sigmoid', name='gaze_xy') →  (gaze_x, gaze_y) em [0,1]

Loss: MSE  |  Optimizer: Adam(lr=1e-3)
```

### Processo de treino

| Hiperparâmetro | Valor |
|---|---|
| Batch size | 32 (reduzível para 16 se RAM apertada) |
| Learning rate | 1e-3 (com ReduceLROnPlateau factor=0.5, patience=5, min_lr=1e-6) |
| Max epochs | 100 (EarlyStopping patience=10 sobre val_loss) |
| Augmentation | brightness jitter ±0.15, contrast jitter ×[0.85,1.15] — correlacionado entre branches |
| Shuffle buffer | 2048 amostras |

**Execução:** CPU puro (TF ≥ 2.11 no Windows não suporta GPU). Checkpoints em `python_ml/checkpoints/`:
- `gaze_cnn_best.keras` — melhor val_loss (restaurado pelo EarlyStopping)
- `gaze_cnn_last.keras` — salvo a cada epoch (para `--resume`)
- `training_log.csv` — histórico de métricas por epoch
- `checkpoint_state.json` — último epoch concluído (para `--resume`)

**Ambiente Python requerido** (`python_ml/requirements.txt`):
- `tensorflow==2.19.0`, `protobuf>=4.25.3,<5`, `numpy==2.1.3`, `mediapipe==0.10.14`
- `scikit-learn==1.7.2`, `opencv-python==4.10.0.84`, `tf2onnx` (para export)

---

## 5. Exportação ONNX e inferência em tempo real

**Arquivos:** `python_ml/export_onnx.py` (exportação); `electron/inference/encoderRunner.ts` (inferência); `electron/main.ts` (boot e IPC)

### Exportação (export_onnx.py)

1. Carrega `gaze_cnn_best.keras`
2. Constrói submodelo: mesmas entradas, output = camada `"embedding"` (256 floats) — descarta `gaze_xy`
3. Converte via `tf2onnx.convert.from_keras` (opset 17)
4. Valida com `onnx.checker`
5. Salva em `python_ml/checkpoints/gaze_encoder.onnx`

Resultado de paridade Sprint 3 (2026-07-10): `max abs diff (Keras vs ONNX) = 5.48e-07` — aprovado (critério: < 1e-4).

Versões usadas na exportação: TensorFlow 2.19.0, tf2onnx 1.17.0, onnx 1.22.0.

### Rota do modelo para produção

O arquivo `gaze_encoder.onnx` deve ser copiado de `python_ml/checkpoints/` para `resources/models/`:

```
resources/models/gaze_encoder.onnx   ← dev (electron/main.ts:15)
process.resourcesPath/models/         ← produção empacotada (electron/main.ts:14)
```

Em desenvolvimento, o caminho é `app.getAppPath()/resources/models/gaze_encoder.onnx`.

### Inferência em tempo real (encoderRunner.ts)

**Carregamento:** a sessão ONNX é carregada no boot do Electron (`electron/main.ts:59`, `ensureSession()`), não na primeira chamada — garante latência previsível desde o primeiro frame.

**Execution providers** por plataforma:
- Windows: `['dml', 'cpu']`
- macOS: `['coreml', 'cpu']`
- Linux: `['cuda', 'cpu']`

Se o modelo não existir em disco, `encoderRunner` loga um aviso e retorna `null` — o pipeline de geometria + Ridge continua funcionando sem o encoder.

**Fluxo IPC** (fire-and-forget, assíncrono):
1. Renderer (`main.ts:231`) chama `window.irisflowAPI.runEncoderInference(cropInput)`
2. Preload (`electron/preload.ts`) encaminha via `ipcRenderer.invoke('encoder:infer', input)`
3. Main process executa `runEncoderInference` com onnxruntime-node
4. Embedding (256 floats) serializado como `number[]` para cruzar o boundary IPC+contextBridge+sandbox
5. Preload reconstrói `Float32Array` no renderer
6. Resultado armazenado em `_lastEmbedding` (buffer de 1 frame) — usado no próximo `requestAnimationFrame`

**Latência IPC:** medida em runtime e logada a cada 20 chamadas no formato `[IPC] round-trip n=N | avg=Xms | last=Xms | min=Xms | max=Xms | p50(last20)=Xms`. Não há valor fixo documentado — depende do hardware e do execution provider ativo.

---

## 6. Fusão de features

**Arquivo:** `src/fusion.ts`; modelo: `public/models/embedding_pca.json`; treinamento: `python_ml/train_pca.py`

### Pipeline de redução

```
embedding CNN (256 dims)
    │
    ├── mean_  (256 floats, carregados de embedding_pca.json)
    └── components_ (18 × 256 floats, carregados de embedding_pca.json)
                     ↓
              PCA projected (18 dims)
                     │
              concat com geometryFeatures (258 dims)
                     ↓
              vetor fundido (18 + 258 = 276 dims por olho)
```

**Modelo PCA:** `n_components = 18` (confirmado pelo campo `n_components` em `embedding_pca.json` e verificado em `fusion.ts:48`). O modelo é carregado via `loadPCA()` na inicialização (`main.ts:361`) e fica disponível como singleton `_pca`.

**Custo por frame:** multiplicação de matriz 18×256 = 4.608 operações — negligível no frame loop (estimado < 0.1 ms).

**Tratamento de null:** se o embedding for null (encoder não carregado, eyeCrop retornou null, ou IPC falhou), `buildFusedFeatureVector` retorna `null` explicitamente — nunca preenche com zeros silenciosamente.

### Modos disponíveis (`FEATURE_MODE` em featurePipeline.ts:18)

| Modo | Valor em produção | Vetor de entrada ao regressor |
|---|---|---|
| `'geometry_only'` | **Ativo** | 258 dims por olho |
| `'fused'` | Não ativo | 276 dims por olho |

**Importante:** FEATURE_MODE é uma constante em código-fonte (`featurePipeline.ts:18`). Mudar para `'fused'` sem re-fazer o fit do StandardScaler e re-treinar o regressor produzirá resultados incorretos — o scaler atual foi ajustado sobre vetores de 258 dims.

---

## 7. Calibração

**Arquivo:** `src/calibration.ts`

### Fluxo geral

A calibração é composta por duas fases sequenciais, seguidas de treino dos scalers e regressores:

```
Pré-calibração (checklist) → Calibração estática (9 pontos) → Treino → Teste de validação
```

### Calibração estática (9 pontos)

Grade 3×3 definida em `TARGET_POINTS` (calibration.ts):

| Ponto | screenX | screenY |
|---|---|---|
| Canto Superior Esquerdo | 0.05 | 0.05 |
| Superior Centro | 0.50 | 0.05 |
| Canto Superior Direito | 0.95 | 0.05 |
| Médio Esquerdo | 0.05 | 0.50 |
| Centro | 0.50 | 0.50 |
| Médio Direito | 0.95 | 0.50 |
| Canto Inferior Esquerdo | 0.05 | 0.95 |
| Inferior Centro | 0.50 | 0.95 |
| Canto Inferior Direito | 0.95 | 0.95 |

Por ponto:
- Transição visual: `TRANSITION_MS = 1000ms`
- Coleta de features: `COLLECTION_MS = 1500ms` (`startCollection`)
- **Descarte de frames finais:** Para emular o comportamento do GazeFollower e evitar ruído quando o olho começa a se mover para o próximo ponto, os últimos 3 frames de cada ponto (`DROP_FRAMES = 3`) são sumariamente descartados.
- Verificação de **variância**: threshold `0.0005`. Se excedido em qualquer olho (ex: piscar muito ou distração), o ponto é reiniciado com feedback visual.

> **Nota:** A fase de calibração dinâmica ("bolinha animada") foi completamente removida nesta versão para otimizar o tempo e a precisão do modelo SVR.

### Treino dos regressores

A função `trainScalersAndRegressors` (calibration.ts) é executada logo após os 9 pontos:

1. `featureScalerLeft/Right.fit(trainFeatures)` — fit do StandardScaler sobre as features.
2. `featureScalerLeft/Right.transform(...)` — normalização z-score.
3. `createRegressor(REGRESSOR_MODE)` → treina o regressor selecionado (atualmente SVR).

**Persistência:** `saveProfile()` serializa dinamicamente o modelo correto de acordo com o `REGRESSOR_MODE` (suportando Ridge, KernelRidge e SVR) para o `localStorage` (`calibrationProfile`). O modelo é carregado automaticamente na próxima sessão via `loadProfile()`.

---

## 8. Regressor de personalização

**Arquivos:** `src/gazeRegressor.ts` (interface e modos), `src/ridge.ts` (Ridge), `src/kernelRidge.ts` (KernelRidge)

### Interface `GazeRegressor`

```typescript
interface GazeRegressor {
  train(features: number[][], targetsX: number[], targetsY: number[]): void;
  predict(features: number[]): { x: number; y: number };
}
```

### Modo ativo (`REGRESSOR_MODE` em gazeRegressor.ts)

| Modo | Valor em produção | Implementação |
|---|---|---|
| `'svr'` | **Ativo** | `SVRRegressor` em `svr.ts` (baseado no GazeFollower) |
| `'ridge'` | Standby | `RidgeRegressor` em `ridge.ts` |
| `'kernel_ridge'` | Standby | `KernelRidgeRegressor` em `kernelRidge.ts` |

### Support Vector Regression (SVR)

Inspirado diretamente na arquitetura do GazeFollower:
- Implementado via biblioteca `libsvm-js` (SVR nativo no JavaScript).
- **Kernel RBF:** `C = 100.0`, `gamma = 0.005`, `epsilon = 0.001` (confirmado em `svr.ts:11`).
- Dois modelos SVR independentes treinados por sessão: `svmX` e `svmY`, predizendo os eixos separadamente a partir das features fundidas ou geométricas da CNN.
- Extremamente resistente a outliers em comparação com o Ridge Regression anterior.
- **Serialização:** Suportada nativamente. Os vetores de suporte são exportados pela biblioteca e salvos via JSON.

---

## 9. Validação pós-calibração

**Arquivo:** `src/accuracy.ts`

Disparada automaticamente ao final de cada calibração (`runAccuracyTest`, calibration.ts:496).

### Grade de validação

9 pontos em grade 3×3 (`VALIDATION_POINTS`, accuracy.ts:34–44):

| Ponto | screenX | screenY |
|---|---|---|
| Superior Esq | 0.10 | 0.10 |
| Superior Centro | 0.50 | 0.10 |
| Superior Dir | 0.90 | 0.10 |
| Médio Esq | 0.10 | 0.50 |
| Centro | 0.50 | 0.50 |
| Médio Dir | 0.90 | 0.50 |
| Inferior Esq | 0.10 | 0.90 |
| Inferior Centro | 0.50 | 0.90 |
| Inferior Dir | 0.90 | 0.90 |

**Coleta por ponto:** `COLLECTION_MS = 1000ms` (accuracy.ts:46). Durante o teste, o buffer de suavização é reduzido de 6 para 3 frames e o Kalman é desativado para medir o regressor com mínimo lag.

### Configs comparadas

| Config | Regressor | Features |
|---|---|---|
| A (produção) | SVR (`REGRESSOR_MODE='svr'`) | geometry (258 dims) |
| B (dev) | KernelRidge | geometry (258 dims) |
| C (dev) | KernelRidge | fused (276 dims) |

### Métricas computadas

- **Erro Euclidiano** em pixels por ponto e média
- **Erro máximo** em pixels
- **Erro angular** (graus): `arctan(meanError / 2268px)` — assume 60 cm de distância, 96 DPI
- **Classificação:** Excelente (<30px), Bom (<60px), Regular (<100px), Ruim (≥100px)
- Resultado persistido em `localStorage` para exibição após reload

**Limiar de produção** (accuracy.ts:411, diagnostic overlay): ≤ 45 px / ≤ 1.5° — visualizado com flag `✗` por ponto na tabela de comparação.

---

## 10. Output final — suavização e cursor

**Arquivo:** `src/main.ts` (bloco após `calibration.mapGaze`, linha 280–354); `src/oneEuroFilter.ts` (filtro ativo — `src/kalman.ts` existe mas não é usado)

### Pipeline de suavização (em ordem de aplicação)

```
predição bruta (x, y)
    │
    ├── rolling buffer ponderado (6 frames)
    │     pesos: [1, 2, 3, 4, 5, 6] (mais recente = maior peso)
    │     durante teste de precisão: buffer reduzido para 3 frames
    │
    ├── Filtro OneEuro (1€) 2D
    │     Substitui o antigo Filtro de Kalman.
    │     Altamente adaptativo: elimina jitter (tremor) em baixas velocidades
    │     (fixações) sem causar lag (arrasto) durante sacadas rápidas.
    │     DESATIVADO durante teste de precisão para medição fiel.
    │
    └── Lerp (interpolação linear frame-a-frame)
          fator=0.08 (normal), 0.02 (teclado visível), 0.25 (teste de precisão)
```

### Cursor

O elemento `<div id="laser">` é posicionado via `style.left` / `style.top` em pixels absolutos. Oculto (`display: none`) durante a calibração para não distrair o olhar do usuário.

### Dwell time e piscada

O módulo `dwell.ts` e o `DwellManager` do teclado virtual recebem a posição corrente do cursor. O `dwellManager.update(currentX, currentY)` verifica colisões com teclas e dispara seleções após 800ms de fixação. Atualizado apenas quando `!calibration.isCalibrating`.

### Teclado virtual

`KeyboardUI` (montado em `#app`), integrado com `DwellManager`. Quando o teclado está visível, o EMA alpha é reduzido para 0.05 e o lerp para 0.02 — aumentando a suavização para facilitar seleção de teclas pequenas.

---

## 11. Issues conhecidas e pendências

### Issue 1 — Dependência de rede: Google Fonts

**Arquivo:** `src/style.css:1`

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
```

A fonte Inter é carregada de `fonts.googleapis.com` a cada carregamento da aplicação. Em ambientes offline ou com bloqueio de rede, a UI cai para a fonte de fallback do sistema (sans-serif genérica) mas funciona normalmente. Para operação 100% offline é necessário servir a fonte localmente ou remover o import.

### Issue 2 — FEATURE_MODE e REGRESSOR_MODE são constantes de compilação

**Arquivos:** `src/featurePipeline.ts:18`, `src/gazeRegressor.ts:15`

```typescript
export const FEATURE_MODE: FeatureMode = 'geometry_only';  // featurePipeline.ts:18
export const REGRESSOR_MODE: RegressorMode = 'svr';         // gazeRegressor.ts:15
```

Não existe caminho de configuração em runtime (UI de configurações, variável de ambiente, arquivo externo de config). Mudar o modo de operação exige editar o código-fonte e fazer rebuild. Isso vale tanto para trocar o regressor quanto para ativar o modo `fused`.

### Issue 3 — Modo `fused` não pode ser ativado sem preparação adicional

**Arquivos:** `src/featurePipeline.ts:6–16` (comentários inline), `src/fusion.ts`

O vetor fundido (276 dims = 18 PCA + 258 geo) é computado internamente mas não propagado ao regressor enquanto `FEATURE_MODE='geometry_only'`. Os comentários em `featurePipeline.ts:14` listam os pré-requisitos para ativação:

1. Re-fit do `featureScalerLeft/Right` sobre vetores de 276 dims (o scaler atual foi ajustado sobre 258 dims durante a calibração estática).
2. Troca ou re-treino do regressor sobre o espaço de 276 dims.

Ativar `FEATURE_MODE='fused'` sem esses pré-requisitos produzirá predições incorretas sem lançar erro explícito.

### Nota: status verificado da issue de calibração dinâmica

Documentação anterior e o README referenciavam uma issue de "DynamicSample.weight calculado mas não propagado ao treino". Após leitura direta do código em 2026-07-13:

- O tipo `DynamicSample` e qualquer campo `weight` **não existem** em nenhum arquivo de `src/` (verificado por grep em todo o diretório).
- A fase de calibração dinâmica foi removida no commit `b9b1ff4` ("remoção da calibração dinâmica pra fins de teste").
- `currentGazePhase()` em `calibration.ts:91–94` nunca retorna `'dynamic'`; o literal existe no union type `GazeLogPhase` (linha 79) por completude formal, mas o próprio comentário da linha 75 documenta que esse valor nunca ocorre na prática.
- `CalibrationPoint` (calibration.ts:7–15) não possui campo `weight`.

**Conclusão:** esta issue não é uma pendência ativa no código atual. O README.md foi atualizado como parte desta revisão para remover a referência ao código removido.

---

*Documento atualizado com base em leitura direta dos arquivos-fonte em 2026-07-13. Todos os números de dimensões, contagens de pontos e valores de hiperparâmetros foram verificados no código, não inferidos de conversas anteriores.*
