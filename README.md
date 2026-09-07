# IrisFlow

Tecnologia assistiva de rastreamento ocular com webcam comum, feita para
pessoas com Esclerose Lateral Amiotrófica (ELA) e outras condições severas de
restrição motora. Sem hardware especializado: uma webcam, um computador e
100 % do processamento local.

![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)
![ONNX Runtime](https://img.shields.io/badge/ONNX%20Runtime-Web-005CED?logo=onnx&logoColor=white)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Tasks%20Vision-00897B?logo=google&logoColor=white)
[![CI](https://github.com/ZambePy/demo01/actions/workflows/ci.yml/badge.svg)](https://github.com/ZambePy/demo01/actions/workflows/ci.yml)
[![Licença: GPL v3](https://img.shields.io/badge/licen%C3%A7a-GPLv3-blue.svg)](LICENSE)

---

## O que o sistema faz

O IrisFlow estima o ponto da tela para onde a pessoa está olhando e converte
fixações prolongadas (*dwell*) em cliques. Com isso o paciente escreve num
teclado, fala frases prontas, pede ajuda, joga e descansa, usando só os olhos.

Duas pessoas usam o app: o **paciente**, que opera tudo pelo olhar em telas
de alvos grandes e alto contraste, e o **cuidador**, que usa mouse e teclado
para configurar, calibrar e acompanhar o rastreamento.

Nenhuma imagem, landmark facial, perfil de calibração ou relatório sai do
dispositivo. No Electron isso é imposto por política de conteúdo (CSP), não só
por disciplina de código.

---

## Pipeline

```
Webcam (getUserMedia, até 1920×1080)
  │
  ├─ Ajuste da câmera em malha fechada ─ zoom / brilho / contraste / exposição,
  │     guiado pelo tamanho do rosto no quadro. Roda uma vez, na abertura da
  │     câmera (até 14 iterações); ao convergir — e só com o brilho dentro da
  │     faixa boa — trava exposição, balanço de branco e foco em manual
  │
  ├─ MediaPipe FaceLandmarker ─ 478 landmarks 3D + matriz de pose da cabeça
  │
  ├─ L2CS-Net (ONNX, Web Worker) ─ yaw / pitch do olhar, com no máximo uma
  │     submissão a cada 100 ms e uma inferência em voo por vez: 100 ms é o
  │     teto da cadência, e em WASM quem manda é a latência da rede. Nos
  │     quadros sem leitura nova o último ângulo é reusado; passada a
  │     tolerância de idade (400 ms a 2,5 s, derivada da latência medida) a
  │     leitura vira inválida e o bloco angular entra zerado.
  │     WebGPU quando disponível, WASM como reserva; o provider efetivo, a
  │     latência e a fração de leituras obsoletas vão para os diagnósticos e
  │     para o relatório
  │
  ├─ Vetor de features por olho ─ 4 dimensões de íris + 2 do L2CS = 6
  │     expansão polinomial (grau 2) → 27 dimensões por olho → StandardScaler
  │     → Ridge por olho, com λ por eixo e penalidade branqueada pelo ruído
  │     intra-fixação. Sem L2CS (`?ep=off`) são 4 dimensões → 14
  │
  ├─ Fusão binocular ─ ponderada pela abertura de cada olho, pela
  │     confiabilidade medida no treino e pela dominância ocular configurada
  │
  ├─ Compensação de cabeça ─ na saída, depois da fusão: primeiro a distância
  │     (escala em torno do centro da tela), depois a pose (d·tan Δ). A de
  │     translação lateral existe e vem por último, desligada por padrão
  │     (`lateralTranslationCompensation`). Só a de pose também é aplicada aos
  │     ALVOS de treino; a de distância é exclusiva da inferência
  │
  ├─ softClamp ─ Hermite cúbico nos 2 % de cada borda, para o ponto caber na
  │     tela sem salto de velocidade. É a última etapa dentro de `mapGaze`,
  │     depois das compensações
  │
  ├─ Filtro temporal ─ One Euro (produção); Kalman e Kalman+EMA disponíveis
  │     para comparação (`filterMode`). Vem depois de tudo isso, no engine
  │
  └─ Interação ─ dwell, cursor, emergência, varredura opcional, fallback
        quando o olhar se perde
```

A **calibração** apresenta 9 alvos (ou 4 no modo rápido) posicionados por um
orçamento de excentricidade angular (≤ 16°). Cada alvo descarta os primeiros
600 ms — sacada e acomodação — e coleta em seguida uma janela útil que cresce
com a excentricidade, de 1680 ms no centro a 2800 ms nos cantos. Amostras com
imagem ruim ou leitura do L2CS inválida são rejeitadas; um alvo que retenha
menos de 15 amostras é refeito. O Ridge é treinado por olho, com λ escolhido
por eixo em validação cruzada leave-one-target-out — cada fold deixa de fora
um alvo inteiro, não uma amostra.

Ao fim, um **teste de precisão** de 13 pontos (grade 3×3 interior mais 4
bordas) mede a qualidade do modelo. Os alvos aparecem em **ordem sorteada**,
com a semente gravada no relatório; cada um coleta 2000 ms, dos quais os
primeiros 600 ms de sacada e acomodação são descartados — sobram **1400 ms
úteis**, ~42 amostras a 30 Hz. Um ponto que receba menos de 80 % dos quadros
esperados é marcado, não removido; abaixo de 8 amostras ele entra no relatório
como não medido. As métricas saem da predição crua, antes do filtro temporal —
a dispersão do cursor filtrado é reportada à parte. O relatório JSON traz
acurácia (erro médio em px e em graus, viés por eixo), as três medidas de
precisão que a literatura pede juntas (desvio-padrão por eixo, RMS
amostra-a-amostra e BCEA de 68 %), perda de dados, taxa de acerto por raio de
alvo, a distância medida durante o teste e o **tamanho mínimo de botão** que o
erro daquela pessoa exige. O protocolo completo, o significado de cada
métrica, o checklist de relato e as referências estão em [`docs/MEDICOES.md`](docs/MEDICOES.md).

---

## Estrutura do repositório

```
src/                        núcleo do pipeline (TypeScript puro, testado com Vitest)
  tracker/engine.ts         loop principal, estados, diagnósticos, recuperação de falhas
  calibration.ts            coleta, treino, inferência, perfis e diagnóstico de ajuste
  accuracy.ts               teste de precisão e relatório de sessão
  accuracyProtocol.ts       tempos do protocolo de medição
  extractor.ts              features de íris e bloco angular; conjunto ativo
  featurePipeline.ts        fronteira consumida pelo engine
  ridge.ts, scaler.ts       Ridge anisotrópico com CV de λ; padronização
  calibration/polynomial.ts expansão polinomial
  l2cs/                     worker ONNX, recorte, decodificação, staleness e saúde
  filters/                  One Euro, Kalman 2D, EMA adaptativa, hold na piscada
  interaction/              dwell, cursor, varredura, clique por piscada, fallback
  poseCompensation.ts       compensação geométrica de pose
  distanceCompensation.ts   compensação de distância
  cameraTuner.ts            lei de controle do ajuste da câmera
  setupReadiness.ts         prontidão do posto (distância, luz, reflexo, postura)
  qualityAnalyzer.ts        brilho, contraste, borrão e reflexo por quadro
  flickerDetector.ts        cintilação da rede elétrica
  displayGeometry.ts        geometria física da tela (EDID via WMI)
  diagnostics/preflight.ts  verificação antes de medir
  config/experiment.ts      flags de experimento (localStorage, URL, ambiente)
  telemetry/                gravação JSONL e cronometragem por estágio
  testUtils/                harness sintético e baseline de regressão
  electronSecurity.ts       permissões, navegação e CSP do Electron

frontend/src/               interface (React 19, Tailwind v4, HashRouter)
  pages/onboarding/         boas-vindas, calibração e teste
  pages/help/               tutorial passo a passo com prática de dwell
  pages/                    menu, teclado, frases, jogos, descanso, emergência...
  pages/settings/           configurações do cuidador, por seção
  pages/caregiver/          painel e guia do cuidador
  context/GazeContext.tsx   estado global de gaze, dwell e câmera
  components/ui/            GazeButton, GazeGrid, GazePageLayout e afins
  index.css                 tokens de design (cores, raios, tipografia)

electron/                   processo principal, preload e IPC de sistema
docs/MEDICOES.md            protocolo e métricas de medição
docs/medicoes/historico/    relatórios reais guardados
```

---

## Requisitos

Node.js 22.12 ou superior (o CI usa Node 24).

| componente | mínimo | recomendado |
|---|---|---|
| Webcam | 1280×720 @ 30 fps | 1920×1080, campo de visão estreito, montada perto do rosto |
| Processador | quad-core com WebAssembly SIMD | — |
| GPU | WebGL (MediaPipe) | WebGPU (o L2CS cai de ~2 s para ~50 ms por inferência) |
| Memória | 8 GB | — |
| Ambiente | luz frontal difusa | apoio de cabeça; monitor com diagonal conhecida |

O erro do rastreamento escala com o inverso da densidade de pixels sobre o
olho: uma lente mais estreita ou a câmera mais perto do rosto melhora a
precisão mais do que qualquer ajuste de software.

---

## Instalação e execução

```bash
npm install
npm --prefix frontend install
```

| comando | o que faz |
|---|---|
| `npm run dev` | interface em `http://localhost:5173` (desenvolvimento) |
| `npm run build` e `npm --prefix frontend run preview` | build de produção em `http://127.0.0.1:4173`; use este para medir |
| `npm run electron:dev` | app desktop em desenvolvimento |
| `npm run electron:build` | instalador (Windows NSIS, macOS DMG, Linux AppImage), gerado na pasta temporária do sistema para escapar do OneDrive |

### Modelos

| modelo | arquivo | origem |
|---|---|---|
| L2CS-Net | `frontend/public/models/l2cs/l2cs_gaze360.onnx` (92 MB, não versionado) | treinado em Gaze360; 90 bins por eixo; entrada 224² ou 448² (padrão 448²) |
| Face Landmarker | `frontend/public/mediapipe/models/face_landmarker.task` | MediaPipe Tasks Vision, 478 landmarks com íris |
| ONNX Runtime Web | `frontend/public/ort/` | binários WASM/WebGPU carregados pelo worker |

Sem o arquivo `.onnx` o app roda com as 4 features de íris (`?ep=off`).

### Flags de experimento

Definidas em `src/config/experiment.ts` e lidas uma vez no boot, de três
fontes: `localStorage` (`irisflow.experiment`), parâmetros de URL
(`?ep=`, `?l2cs=`, `?filtro=`, `?diagonal=`) e variáveis de ambiente
`IRISFLOW_EXP_<chave>` no Electron. Pelo console: `__irisflowExp.set({...})`
seguido de reload. A tela de Configurações do cuidador expõe as mesmas
opções e avisa quando falta recarregar.

| flag | padrão | opções |
|---|---|---|
| `l2cs` | `auto` | `auto` · `webgpu` · `wasm` · `off` |
| `l2csInputSize` | `448` | `224` · `448` |
| `filterMode` | `oneEuro` | `oneEuro` · `kalman` · `kalmanEma` |
| `geometricPoseCompensation` | `true` | |
| `polynomialFeatures` | `true` | |
| `cursorSizePx` | `48` | 24–128 |
| `blinkClick`, `scanningMode`, `dwellRingOnCursor` | `false` | |
| `gazeLostFallback` | `true` | |

---

## Fluxo de uso

1. **Boas-vindas** (`/`): o paciente escolhe entre o tutorial e ir direto à
   calibração; o cuidador acessa sua área por um botão discreto.
2. **Tutorial** (`/tutorial`): como funciona, posicionamento, o que é o
   dwell, prática com três alvos, emergência, descanso e o que esperar da
   calibração.
3. **Calibração** (`/calibration-check`): preparação com verificação de
   prontidão, coleta dos alvos, revisão (deriva de pose, alvos ignorados) e
   teste de precisão. O botão de emergência fica compacto e sai de cima dos
   alvos.
4. **Menu** (`/menu`) e telas do paciente: teclado, frases rápidas,
   pictogramas, jogos, câmera, galeria, descanso, emergência. O botão de
   emergência é um alerta local (som e tela); o app não envia mensagens.
5. **Área do cuidador** (`/settings`, `/caregiver`, `/caregiver/guide`):
   configurações por seção (rastreamento, tela, calibração, voz, dados),
   painel com estado do rastreamento e alertas, guia de instalação e leitura
   do teste de precisão.

Regras da interface do paciente: alvos de no mínimo 160×120 px, nada se move
sob o olhar (sem `transform` em hover), uma ação principal por tela, zona de
descanso sem alvos, textos curtos e sem jargão.

---

## Verificação

```bash
npm test                              # núcleo (Vitest)
npx tsc --noEmit -p tsconfig.json     # tipos do núcleo
npx tsc --noEmit -p electron/tsconfig.json
npm --prefix frontend run verify      # lint, tipos, testes e build da interface
npm run electron:compile
```

Tudo isso roda no CI (`.github/workflows/ci.yml`, Windows) a cada push.

Os testes do núcleo cobrem os módulos puros, onde os limiares e as leis de
controle vivem: calibração, Ridge, filtros, decodificação do L2CS, prontidão,
ajuste de câmera, geometria de tela, protocolo de medição e segurança do
Electron. O harness sintético (`src/testUtils/`) roda o pipeline inteiro sobre
trajetórias determinísticas e barra regressões contra um baseline versionado.

---

## Compatibilidade

| plataforma | estado |
|---|---|
| Windows 10/11 (Electron) | testado; lê a diagonal do monitor pelo EDID |
| Chromium (Chrome, Edge) | testado; sem acesso à geometria do sistema |
| Linux / macOS | não testado; o núcleo é agnóstico, o IPC de sistema é do Windows |

Os controles de câmera (`zoom`, `brightness`, `contrast`, `exposureMode`)
dependem do driver. O app sonda o que existe e, quando não consegue ajustar,
diz qual ajuste físico é necessário.

---

## Licença

GNU General Public License v3.0 — texto completo em [`LICENSE`](LICENSE).
Para uma tecnologia assistiva isso importa em concreto: quem depende dela
para se comunicar continua tendo direito ao código que a faz funcionar.
