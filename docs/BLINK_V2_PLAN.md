# BLINK V2 — PIPELINE FINAL DE ESTIMAÇÃO DE OLHAR

## A Filosofia Final do Blink
A pergunta do sistema não deve ser:
> "Onde este frame diz que o usuário está olhando?"

Deve ser:
> "Dadas a câmera, a tela, a geometria da cabeça, os olhos, o L2CS, a qualidade do frame, o histórico temporal e o perfil deste usuário, qual é a estimativa mais confiável do ponto que ele está tentando olhar?"

A nova fase transforma o Blink de um simples *Eye Tracker* para um **Motor de Intenção Assistiva (Intention Engine)** focado no usuário ELA, mantendo os blocos que já funcionam (MediaPipe, L2CS, Ridge) mas integrando `setup-awareness`, `geometry-awareness`, `uncertainty` e `personalization`.

---

## 🏛 ARQUITETURA PROPOSTA (Pipeline Completo)

```text
                         CAMERA
                           │
                           ▼
                 CAMERA OBSERVABILITY
                           │
                           ▼
                    FACE LANDMARKS
                           │
         ┌─────────────────┼──────────────────┐
         │                 │                  │
         ▼                 ▼                  ▼
     HEAD POSE         EYE GEOMETRY        BLINK
         │                 │                  │
         └─────────────────┼──────────────────┘
                           ▼
                        L2CS-Net
                     yaw / pitch / conf
                           │
                           ▼
                    SETUP ESTIMATOR
                           │
             ┌─────────────┼──────────────┐
             │             │              │
          CAMERA         USER           SCREEN
          geometry       geometry       geometry
             │             │              │
             └─────────────┼──────────────┘
                           ▼
                 GEOMETRIC NORMALIZATION
                           │
                           ▼
                    FEATURE FUSION
                           │
                           ▼
                      QUALITY GATE
                           │
                           ▼
                    OUTLIER REJECTION
                           │
                           ▼
               PERSONALIZED WEIGHTED RIDGE
                           │
                           ▼
                     BIAS CORRECTION
                           │
                           ▼
                 GAZE + UNCERTAINTY
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           DRIFT        TEMPORAL      USER PROFILE
         DETECTION       MODEL
              │            │
              └────────────┼────────────┘
                           ▼
                  ADAPTIVE ONE EURO
                           │
                           ▼
                    FINAL GAZE POINT
                           │
                           ▼
                   INTENTION ENGINE
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
      FIXATION          DWELL             SACCADE
         │                 │
         └─────────────────┼─────────────────┘
                           ▼
                     GAZE CONTEXT
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
        NAVIGATION      AAC/VOICE      EMERGENCY
```

---

## 📂 ESTRUTURA DO CÓDIGO FONTE

### O que manter (Fundação)
O repositório já possui excelente infraestrutura, não reescreveremos:
`MediaPipe`, `L2CS`, `extractCompactFeatures`, `EyeQualityAnalyzer`, `StandardScaler`, `Ridge`, `OneEuro`, `GazeContext`, `ONNX Worker`, Infra de Replay e Telemetria.

### O que evoluir (Refatoração)
- `calibration.ts`: Evoluir de *3x3 fixo* para *Coarse → Validate → Adaptive Refinement → Personalized Model*.
- `ridge.ts`: Evoluir de *Ridge clássico* para *Weighted Ridge + Regularização Anisotrópica + Uncertainty Estimation*.
- `extractor.ts`: Adicionar extração de *Head Pose*, *Face Scale*, *Eye Observability* e *Temporal Features*.
- `oneEuroFilter.ts`: Adicionar parâmetros de filtro *Confidence-aware* e *Uncertainty-aware*.
- `qualityAnalyzer.ts`: Expandir para *Frame Quality + Observability + Tracking Health*.

### O que ADICIONAR (Novos Módulos em `src/tracker/`)
```text
src/tracker/
    cameraState.ts          # Resolução real, FOV, DPR, pixels disponíveis pros olhos
    observability.ts        # Avaliação de qualidade do frame (0 a 1)
    headPose.ts             # 6DoF (Yaw, Pitch, Roll, Tx, Ty, Tz)
    screenGeometry.ts       # Viewport, DPR, normalização geométrica da tela
    setupEstimator.ts       # Geometria Câmera vs Tela vs Usuário
    canonicalization.ts     # Normalização de head pose, eye geometry e escala
    featureFusion.ts        # Concatenação inteligente das features 
    gazeUncertainty.ts      # Estimativa do σx e σy
    driftDetector.ts        # Monitoramento de drift temporal (postura mudou?)
    biasCorrection.ts       # Correção pós-Ridge de viés sistemático
    fixationDetector.ts     # Motor de repouso intencional
    intentionEngine.ts      # Dwell adaptativo, Histerese, Saccades
    userProfile.ts          # Aprendizado de características crônicas do usuário ELA
```

---

## 🚀 PLANO DE IMPLEMENTAÇÃO DE 7 DIAS

### DIA 0 — Auditoria Técnica e Revisão (Pré-requisito)
- **Auditoria de Performance:** Analisar o loop principal (rAF) em `engine.ts`, checar memory leaks e stales do Worker L2CS.
- **Revisão de Integração React:** Checar dependências no `GazeContext.tsx` e fluxos de re-render.
- **Cobertura Testes (`vitest`):** Avaliar estado da suíte e adicionar *smoke tests* no Engine.

### DIA 1 — Instrumentação e Observabilidade (Medir e Observar)
**Meta:** Saber o estado exato antes de alterar a matemática.
- Implementar `CameraState`, `ScreenState` e `ObservabilityScore`.
- Monitorar a variável crítica: *Pixels efetivos sobre os olhos* (não a mera resolução da câmera).
- Expor `HeadPoseState` (6DoF) diretamente do MediaPipe.

### DIA 2 — Head Pose + Setup Estimator
**Meta:** Representar matematicamente a relação Câmera → Usuário → Tela.
- Estimar câmera (`captureWidth`, `FOV`), face (`faceScale`, `estimatedDepth`) e monitor (`viewport`, `devicePixelRatio`).
- Criar mapa geométrico completo da cena 3D a partir da webcam.

### DIA 3 — Canonicalization e Feature Fusion
**Meta:** Fazer variações posturais parecerem canônicas ao estimador.
- Normalizar offsets (ex: `irisOffsetX / eyeWidth` e não pixels absolutos).
- Projetar `Feature Fusion`: juntar olhos, l2cs, pose da cabeça, qualidade e velocidade temporal num *array* de regressão unificado.
- Realizar *Ablation Study* para provar utilidade das features inseridas.

### DIA 4 — Weighted Personalized Ridge
**Meta:** Rejeitar ruído organicamente na matriz.
- Implementar `Weighted Ridge` onde cada amostra recebe `weight = f(qualityScore)`.
- Aplicar *Outlier Rejection* e gerenciar incertezas em eixos isolados (*Regularização Anisotrópica ΣW*).
- Calibração passa a predizer coord. normalizadas (0 a 1) e não px absolutos.

### DIA 5 — Adaptive Calibration
**Meta:** Menos esforço, mais precisão. 
- Calibração Coarse (5 a 7 alvos grandes), checagem do *Error Map*, seguida de coleta apenas onde o erro é alto.
- Micro-recalibrações invisíveis durante o uso do paciente (1 a 3 alvos) baseadas em interações precisas para curar *Drift*.
- Seleção estrita de amostras de calibração (*Top 10-20* frames estáveis ao invés de usar todos ruidosamente).

### DIA 6 — Uncertainty e Temporal Drift
**Meta:** Reconhecer a dúvida.
- O *Gaze Output* retorna `x`, `y`, `confidence`, mas também `σx`, `σy` (incerteza distribuída).
- `OneEuroFilter2D` recebe parâmetros variáveis: muita suavização quando incerteza for alta/estável; pouca quando baixa/rápida.
- Criação de predições temporais de inércia para separar intenção de jitter.

### DIA 7 — Intention Engine e Perfilamento
**Meta:** Assistividade nativa.
- Separar o rastreamento ocular cru da intenção. 
- **Fixation Detector:** Ignorar *saccades* e atestar interesse legítimo.
- **Dwell Adaptativo & Histerese:** Dwell flexível (ex: 600ms - 1500ms baseado na estabilidade do usuário) com área imantada para impedir flicker (A→B→A).
- **Emergency Target Seguro:** Modos críticos não travam mesmo sob `LOW_CONFIDENCE`.

---

## 🧪 MATRIZ DE TESTES E MÉTRICAS

Não aceitaremos um "funciona" empírico. A *Feature Fusion* e o *Ridge Ponderado* passarão por:

**Matriz Obrigatória (Comparando Baseline vs Nova Arquitetura):**
1. **Distância:** 40cm, 50cm, 60cm, 70cm, 80cm
2. **Câmera:** 720p vs 1080p
3. **Head Pose:** Rotações a 0°, 10°, 20°
4. **Posição Cabeça:** Centro, Esquerda, Direita, Cima, Baixo
5. **Tela e UI:** Viewports diversos, Scaling/DPR de 1.0 a 2.0
6. **Luz e Óculos:** Side light, backlight, low light, com e sem óculos.

**Métricas Matemáticas:**
- Angular Error, MAE, RMSE, P50, P90.

**Blink Performance Score (BPS):**
Para interface assistiva, a usabilidade ganha da matemática. Nosso BPS interno penaliza falhas pragmáticas:
*(Gaze Accuracy + Fixation Precision + Robustness) - (False Activations + Latency + Calibration Burden).*

---

## 🚨 PRIORIDADE ABSOLUTA
Caso seja necessário fatiar entregas urgentes, esta é a ordem estratégica irrevogável:

1. `Head Pose`
2. `Setup / Screen Geometry`
3. `Feature Fusion`
4. `Weighted Personalized Ridge`
5. `Adaptive Calibration`
6. `Uncertainty`
7. `Drift Detection`
8. `Adaptive OneEuro`
9. `Fixation / Hysteresis`
10. `Intent Engine`

*Evoluir o que existe é muito superior a treinar novos modelos isolados do zero.*
