# IrisFlow

IrisFlow é uma tecnologia assistiva de rastreamento ocular (*eye tracking*) desenvolvida para pessoas com Esclerose Lateral Amiotrófica (ELA) e outras condições severas de restrição motora. O sistema permite navegação, comunicação e lazer utilizando apenas o movimento dos olhos através de uma webcam comum, sem hardware especializado.

Todo o processamento — visão computacional, machine learning e calibração — ocorre **100% localmente** no dispositivo, sem enviar nenhum dado para a nuvem.

---

## 🧠 Pipeline de Rastreamento Ocular

O pipeline combina MediaPipe com L2CS-Net e regressão Ridge treinada em tempo real:

```
Câmera (getUserMedia)
    │
    ├── MediaPipe FaceLandmarker ──→ 478 landmarks 3D normalizados [0..1]
    │
    ├── L2CS-Net (ONNX, Web Worker) ──→ yaw / pitch do olhar (cadência 100ms)
    │       ⚠️ Núcleo obrigatório do pipeline — não é fallback. O worker deve
    │       estar 'ready' antes de iniciar a calibração.
    │
    ├── extractCompactFeatures ──→ ~44 dims/olho
    │   (offsets de íris, cantos, EAR, pose 3D, interações + bloco angular L2CS)
    │
    ├── EyeQualityAnalyzer ──→ brightness / contrast / blur / specularRatio
    │   (filtra frames ruins antes de armazenar na calibração)
    │
    ├── Calibração (grade 3×3, 9 pontos)
    │   StandardScaler + RidgeRegressor por CV leave-one-target-out
    │   Soft clamp nas bordas | Correção RBF pós-Ridge
    │
    ├── OneEuroFilter2D ──→ suavização adaptativa jitter × lag
    │
    └── GazeContext (React) ──→ Cursor Dwell | Navegação | EmergencyEscalation
```

**Menor erro registrado:** 57 px / 0.9° (Rodada A, sem óculos, cabeça parada — commit `f9d9252`).

---

## 🌟 Funcionalidades

- **Calibração CAA:** Fundo preto, ponto âmbar de alta visibilidade, linguagem direta sem jargão técnico. Modo completo em grade 3×3 (9 pontos) com filtragem automática de frames de baixa qualidade e detecção de reflexo especular; modo rápido opcional (4 cantos) para recalibração pontual sem repetir a coleta inteira (D6).
- **Dwell Click:** Seleção de elementos mantendo o olhar fixo por tempo configurável. Bloqueio automático em estado degradado (exceto botão de emergência).
- **Estado Degradado:** Quando o pipeline perde sinal por >500ms, o cursor muda de cor e o dwell é pausado, evitando cliques acidentais.
- **Módulos de Comunicação:** Frases rápidas, teclado virtual preditivo, pictogramas.
- **Lazer:** Jogos adaptados (Estoura Bolhas, Memória, Desenho) e relaxamento.
- **Botão de Emergência:** Sempre acessível, com dwell reduzido e prioridade máxima.

---

## 🛠️ Tecnologias

| Camada | Tecnologias |
|--------|-------------|
| Frontend | React 19, TypeScript, Vite, React Router, CSS nativo |
| Visão | `@mediapipe/tasks-vision` (WASM offline), L2CS-Net ONNX Runtime Web |
| ML (calibração) | Ridge Regression, StandardScaler, OneEuroFilter — TypeScript puro |
| Desktop | Electron + Node.js (`electron-builder`) |

---

## 🚀 Como Rodar

### Desenvolvimento (Web)

```bash
npm install
npm --prefix frontend install
npm run dev
```

Acesse `http://localhost:5173`. O motor de rastreamento e calibração funcionam via webcam do navegador.

### Electron (Desktop)

```bash
npm run electron:dev
```

Necessário para o módulo de controle de mouse do sistema operacional.

### Gerar Instalador

```bash
npm run electron:build
```

O instalador final é gerado em `release/`.

### Testes

```bash
npm test                      # Raiz (Vitest)     — 228 testes
npm --prefix frontend test    # Frontend (Vitest) — 105 testes
```

---

## 📂 Estrutura

```
src/                    # Core do pipeline de rastreamento
  tracker/engine.ts     # Loop rAF principal e estados do sistema
  calibration.ts        # Coleta, treino e inferência de gaze
  extractor.ts          # Extração de features (landmarks + L2CS)
  ridge.ts              # Regressão Ridge com CV lambda
  oneEuroFilter.ts      # Filtro temporal adaptativo (A2-1: presets v2 em espaço normalizado)
  l2cs/                 # Worker L2CS-Net (ONNX) + bloco angular
  qualityAnalyzer.ts    # Filtros de qualidade por frame
  calibrationProfiles.ts # Perfis por condição óptica (A1-6)
  invariants.ts         # Invariantes explícitas do sistema (A3-1)

frontend/src/
  pages/                # Telas do sistema (Calibração, Menu, Jogos, Teclado…)
  context/GazeContext.tsx # Estado global de gaze e dwell
  components/           # Componentes otimizados para interação ocular

docs/
  PIPELINE-ARQUITETURA.md  # Arquitetura detalhada de cada etapa
  AUDITORIA-SPRINT-0.md    # Auditoria de catch/null silenciosos
  PONTO-DE-REFERENCIA.md   # Baseline de precisão (condições controladas)
  RESULTADOS-D2-D8.md      # Consolidação da semana de precisão (D2 → D8)

PLANO-FRENTES-A-B.md   # Roadmap técnico e regras de desenvolvimento
ROADMAP.md             # Sprints D2–D8 (semana de precisão) com status FEITO por sprint
```

---

## 📋 Estado Atual do Desenvolvimento

**Sprint 0 (Auditoria):** ✅ Concluída  
**Sprint 1 (Robustez do Backend):** ✅ Concluída — A1-1 a A1-6 implementados  
**Sprint 5 (Precisão + Higiene):** ✅ Concluída — A2-1 a A2-7 atrás de flag; A3-1, A3-2 concluídos  
**Semana de Precisão (D2 → D8):** ✅ Concluída (2026-08-25) — ver `docs/RESULTADOS-D2-D8.md`

Fixes recentes (Sprint 5):
- A2-1: One Euro Filter em espaço normalizado (`filterInNormalizedSpace`, presets `-v2`)
- A2-2: `LowPassFilter` — primeira amostra não puxada para a origem
- A2-3: `setParams` muta parâmetros sem descartar estado filtrado
- A2-4: `BlinkDetector` encapsula detecção de piscada com média só de não-piscadas e clamping [0.10, 0.22]
- A2-5: Correção de anisotropia de aspect ratio (`isotropicLandmarks`, atrás de flag)
- A2-6: Trava exposição da câmera após aquecimento de 2s (`lockCameraExposure`, atrás de flag)
- A2-7: Persistência de perfis de calibração em localStorage com invalidação por contexto
- A3-1: `src/invariants.ts` — 5 invariantes críticas instrumentadas
- A3-2: Código morto removido (kalman.ts, src/assets/, public/ raiz), README corrigido

Entregas da Semana de Precisão (D2 → D8) — resumo:
- D2: Loop de medição repetível (`measure_baseline.mjs`, fixture JSONL, `AUTO_TEST_META` auto)
- D3: L2CS endurecido — presets v2 no replay, `confidence` da softmax como diagnóstico, decisão sobre cadência
- D4: Detecção de outlier em nível de ponto (LOO+MAD) + ablação de features via `--drop-features`
- D5: Correção geométrica de distância câmera-rosto (`EXPERIMENT.applyDistanceCorrection`, off por default)
- D6: Modo rápido de calibração (4 cantos), UI de condição óptica, indicador de drift ao cuidador
- D7: Sweep de flags A2 no replay (`--a2-flags`), curva de drift temporal (`--drift-curve`), aviso de fadiga
- D8: Gate de regressão de precisão no CI, `docs/RESULTADOS-D2-D8.md` consolidado

Nenhuma flag nova foi ligada por padrão — todas as decisões numéricas
sobre flags (`isotropicLandmarks`, `lockCameraExposure`,
`applyDistanceCorrection`) aguardam gravação real, documentada em
`docs/RESULTADOS-D2-D8.md`.

---

## 🤝 Privacidade

O IrisFlow não envia imagens, dados faciais ou calibração para a nuvem. Toda inferência ocorre localmente. Nenhuma telemetria é coletada.
