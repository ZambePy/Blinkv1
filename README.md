# IrisFlow

Sistema de rastreamento ocular assistivo via webcam comum, projetado para comunicação alternativa (AAC) com pacientes com ELA e outras condições que comprometem a mobilidade. Todo o processamento ocorre localmente no dispositivo — nenhum dado de vídeo ou olhar é transmitido.

## Arquitetura atual

O pipeline combina detecção facial por MediaPipe, extração de features geométricas, inferência de um encoder CNN treinado no MPIIFaceGaze, fusão via PCA, e um regressor Ridge personalizado por calibração.

```
Webcam (1280×720)
    │
    ├── MediaPipe FaceLandmarker (WASM + modelo empacotados localmente)
    │     └── 478 landmarks 3D normalizados
    │
    ├── extractor.ts  →  258 features geométricas por olho (76+9 landmarks × 3 + 3 ângulos)
    │
    ├── eyeCrop.ts    →  4 tensores: face[224,224,3] + olhoE[112,112,3] + olhoD[112,112,3] + rect[12]
    │     │
    │     └── encoder CNN (gaze_encoder.onnx, onnxruntime-node no processo main do Electron)
    │           └── embedding: 256 floats  →  PCA (18 componentes)  →  fusão: 276 dims (não ativo)
    │
    ├── calibration.ts  →  9 pts estáticos + fase dinâmica  →  StandardScaler + Ridge
    │
    ├── KalmanEMASmoother + rolling buffer 6 frames + Lerp
    │
    └── cursor (div#laser) + teclado virtual (dwell 500ms)
```

**Modo de produção atual:** `FEATURE_MODE='geometry_only'` / `REGRESSOR_MODE='ridge'` — o pipeline geométrico puro (258 dims → Ridge) está ativo. O encoder CNN e a fusão PCA (276 dims) estão implementados e inferindo em paralelo mas ainda não conectados ao regressor de produção.

Para documentação técnica detalhada do pipeline, veja [IRISFLOW_PIPELINE_TECNICO.md](./IRISFLOW_PIPELINE_TECNICO.md).

## Tecnologias

- **Runtime:** Vite + TypeScript (renderer), Electron (processo main e empacotamento)
- **Detecção facial:** `@mediapipe/tasks-vision ^0.10.35` (WASM, offline)
- **Inferência CNN:** `onnxruntime-node ^1.20.0` (processo main do Electron, providers: DML/CoreML/CUDA/CPU)
- **ML de treino:** Python — TensorFlow 2.19.0, tf2onnx, scikit-learn (veja `python_ml/requirements.txt`)
- **Dataset CNN:** MPIIFaceGaze (15 sujeitos, licença não-comercial)

## Rodar em modo web (sem encoder CNN)

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173`. A câmera, o MediaPipe, a calibração e o cursor funcionam normalmente. O encoder CNN não fica disponível neste modo (requer Electron) — o pipeline de geometria + Ridge opera como fallback.

## Rodar como app Electron (com encoder CNN)

### Desenvolvimento

```bash
npm run electron:dev
```

Sobe o servidor Vite, compila `electron/` em modo watch e abre a janela do Electron apontando para o dev server. O encoder CNN (`resources/models/gaze_encoder.onnx`) deve estar presente para a inferência ONNX funcionar.

> Se o Electron abrir e fechar imediatamente, verifique se `ELECTRON_RUN_AS_NODE` não está setada no shell.

### Gerar instalador

```bash
npm run electron:build
```

Executa `vite build`, compila `electron/` para produção, e roda o `electron-builder`. Gera o instalador em `release/` (NSIS no Windows, DMG no macOS, AppImage no Linux).

### Onde colocar o modelo do encoder

Após treinar e exportar o encoder CNN (veja seção abaixo), copie o arquivo ONNX para:

```
resources/models/gaze_encoder.onnx
```

Este caminho é empacotado via `extraResources` do electron-builder. Se o arquivo não existir, o `encoderRunner` loga um aviso e o pipeline de geometria + Ridge continua funcionando sem o encoder.

## Pipeline de treino Python (encoder CNN)

Requer Python com as dependências de `python_ml/requirements.txt`.

```bash
cd python_ml
pip install -r requirements.txt

# 1. Pré-processar o dataset MPIIFaceGaze (necessário ter os dados raw em datasets/)
python preprocess.py

# 2. Treinar a CNN
python train_cnn.py                 # treino completo
python train_cnn.py --benchmark     # estimar tempo antes de treinar
python train_cnn.py --resume        # retomar de checkpoint

# 3. Exportar o encoder para ONNX
python export_onnx.py               # gera checkpoints/gaze_encoder.onnx

# 4. Treinar o PCA para fusão de features (opcional — para modo fused)
python train_pca.py
```

**Nota de licença:** o dataset MPIIFaceGaze é disponibilizado para uso não-comercial apenas. O uso do modelo derivado em contexto comercial requer substituição do dataset.

## Testes

```bash
npm test
```

Os testes cobrem: paridade geométrica de `eyeCrop.ts` vs `preprocess.py`, paridade de embeddings ONNX vs Keras, testes do `KernelRidgeRegressor`, e testes de calibração com dados sintéticos.

## Issues conhecidas

Veja a seção ["Issues conhecidas e pendências"](./IRISFLOW_PIPELINE_TECNICO.md#11-issues-conhecidas-e-pendências) no documento técnico. As principais:

- **Pesos de calibração dinâmica não propagados:** `DynamicSample.weight` (3.0 para fixações) é descartado ao treinar o Ridge — contribui para erro de validação acima da meta.
- **Fonte Inter via Google Fonts:** `style.css` faz chamada de rede para `fonts.googleapis.com`. Em ambiente offline, a UI usa fallback do browser mas funciona normalmente.
- **`REGRESSOR_MODE` e `FEATURE_MODE` são constantes em código:** mudar de modo requer rebuild.
- **KernelRidge não persiste no `localStorage`:** se `REGRESSOR_MODE='kernel_ridge'` fosse ativado, a calibração seria perdida a cada reload.
