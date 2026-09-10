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
No **Modo Computador** o mesmo cursor sai do app e passa a controlar o Windows
inteiro (clicar, arrastar, rolar, digitar), e com a **voz personalizada** o
que o paciente diz sai na própria voz dele, recriada a partir de uma gravação
— tudo processado neste computador.

Duas pessoas usam o app: o **paciente**, que opera tudo pelo olhar em telas
de alvos grandes e alto contraste, e o **cuidador**, que usa mouse e teclado
para configurar, calibrar e acompanhar o rastreamento.

Nenhuma imagem, landmark facial, perfil de calibração, relatório, áudio de
referência da voz ou modelo sai do dispositivo. No Electron isso é imposto por
política de conteúdo (CSP), não só por disciplina de código. As únicas saídas
de rede são a conta IrisFlow (texto escolhido pelo paciente, alertas e números
agregados — ver `INTEGRACAO.md`) e o download, uma vez, dos pesos do modelo de
voz.

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
  computador/               Modo Computador: geometria (janela→tela→físico),
                            structs INPUT do Win32 e contrato IPC (puro, testado)
  voz/                      contrato da voz clonada (IPC e protocolo do motor)

frontend/src/               interface (React 19, Tailwind v4, HashRouter)
  pages/onboarding/         boas-vindas, calibração e teste
  pages/help/               tutorial passo a passo com prática de dwell
  pages/                    menu, teclado, frases, jogos, descanso, emergência...
  pages/settings/           configurações do cuidador, por seção
  pages/caregiver/          painel e guia do cuidador
  context/GazeContext.tsx   estado global de gaze, dwell e câmera
  components/ui/            GazeButton, GazeGrid, GazePageLayout e afins
  computador/               hook que liga o Modo Computador e manda o olhar ao main
  overlay/                  a SOBREPOSIÇÃO sobre o Windows (página própria,
                            `overlay.html`): cursor pequeno, barra de ações,
                            lupa, teclado; máquina de estados pura e testada
  services/voz/             `falar()`: voz clonada quando pronta, senão a do sistema
  pages/settings/VozScreen  Configurações → Voz personalizada (termo, importação)
  index.css                 tokens de design (cores, raios, tipografia)

electron/                   processo principal, preload e IPC de sistema
  computador/               sessão do Modo Computador, janela de sobreposição,
                            adaptadores de SO (Windows via koffi/user32, Linux via xdotool)
  voz/                      gerente do motor de voz (processo Python), cache, consentimento
  overlayPreload.ts         ponte estreita da sobreposição
voice-engine/               motor de voz local em Python (Chatterbox multilíngue):
                            preparo do áudio, síntese, protocolo JSON, testes, build
docs/MEDICOES.md            protocolo e métricas de medição
docs/medicoes/historico/    relatórios reais guardados
```

---

## Requisitos

Para desenvolver: Node.js 22.12 ou superior (o CI usa Node 24) e, só para o
motor de voz, **Python 3.11 (64 bits)** — ver [Voz personalizada](#voz-personalizada-clonagem-local).

### Hardware do paciente (tabela preliminar)

Os números abaixo são o ponto de partida para a tabela oficial que sai com o
lançamento; valem para o app inteiro, e a coluna da voz é o que muda o piso.

| componente | mínimo (rastreamento + comunicação) | mínimo com voz personalizada | recomendado |
|---|---|---|---|
| Sistema | Windows 10 64 bits (Modo Computador: Windows) | Windows 10/11 64 bits | Windows 11 |
| Webcam | 1280×720 @ 30 fps | idem | 1920×1080, campo de visão estreito, perto do rosto |
| Processador | quad-core com WebAssembly SIMD (Intel 8ª geração / Ryzen 2000 ou melhor) | 6 núcleos ou mais (a síntese em CPU usa todos menos um) | — |
| GPU | WebGL (MediaPipe) | WebGL; **NVIDIA com CUDA** deixa a síntese quase imediata | WebGPU para o L2CS (~2 s → ~50 ms por inferência) |
| Memória | 8 GB | **16 GB** (o modelo de voz ocupa 2–3 GB enquanto carregado) | 16 GB |
| Disco | 2 GB livres | 5 GB livres (pesos do modelo ~1,5 GB + cache de frases até 300 MB) | SSD |
| Ambiente | luz frontal difusa | idem | apoio de cabeça; monitor com diagonal conhecida |

O erro do rastreamento escala com o inverso da densidade de pixels sobre o
olho: uma lente mais estreita ou a câmera mais perto do rosto melhora a
precisão mais do que qualquer ajuste de software. A latência da voz
personalizada em CPU é de alguns segundos por frase nova; frases já ditas
saem do cache na hora (ver a seção da voz).

---

## Instalação e execução

```bash
npm install                      # inclui o `koffi` (FFI do Windows para o Modo Computador)
npm --prefix frontend install
```

O motor de voz é opcional para rodar o app; sem ele a tela de Voz explica o que
falta e o paciente fala com a voz do sistema. Para tê-lo em desenvolvimento
(Windows, PowerShell, dentro de `voice-engine/`):

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

O Electron acha o `.venv` sozinho (`voice-engine/.venv/Scripts/python.exe`); a
variável `IRISFLOW_PYTHON` aponta para outro interpretador se preciso. Use o
`.venv` mesmo: instalar no Python global mistura com pacotes de outros
projetos, e um `torchvision` de outra versão faz o modelo falhar ao carregar
("operator torchvision::nms does not exist"). Se isso acontecer no global,
`pip install --force-reinstall torchvision==0.21.0` resolve.

| comando | o que faz |
|---|---|
| `npm run dev` | interface em `http://localhost:5173` (desenvolvimento) |
| `npm run build` e `npm --prefix frontend run preview` | build de produção em `http://127.0.0.1:4173`; use este para medir |
| `npm run electron:dev` | app desktop em desenvolvimento |
| `npm run electron:build` | instalador (Windows NSIS, macOS DMG, Linux AppImage), gerado na pasta temporária do sistema para escapar do OneDrive; inclui o motor de voz se `voice-engine\dist\irisflow-voz\` existir |
| `voice-engine\build-voice-engine.ps1` | gera o executável do motor de voz (PyInstaller, modo pasta) para entrar no instalador |

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
   calibração; o cuidador acessa sua área por um botão discreto. Com a conta
   IrisFlow configurada, o primeiro passo é o **login** (`/login`) com o
   e-mail e a senha da assinatura feita no site.
2. **Tutorial** (`/tutorial`): como funciona, posicionamento, o que é o
   dwell, prática com três alvos, emergência, descanso e o que esperar da
   calibração.
3. **Calibração** (`/calibration-check`): preparação com verificação de
   prontidão, coleta dos alvos, revisão (deriva de pose, alvos ignorados) e
   teste de precisão. O botão de emergência fica compacto e sai de cima dos
   alvos.
4. **Menu** (`/menu`) e telas do paciente: teclado, frases rápidas,
   pictogramas, jogos, câmera, galeria, descanso, emergência, **conversa**
   (`/conversation`) com o celular do cuidador e **Computador**
   (`/virtual-mouse`), que liga o Modo Computador. O botão de emergência é um
   alerta local (som e tela) e, com a conta ligada, também chega ao celular.
5. **Área do cuidador** (`/settings`, `/settings/voice`, `/caregiver`,
   `/caregiver/guide`): configurações por seção (rastreamento, tela,
   calibração, voz personalizada, dados), painel com estado do rastreamento e
   alertas, guia de instalação e leitura do teste de precisão.

Regras da interface do paciente: alvos de no mínimo 160×120 px, nada se move
sob o olhar (sem `transform` em hover), uma ação principal por tela, zona de
descanso sem alvos, textos curtos e sem jargão.

### Conta IrisFlow (site + app do cuidador)

O app continua 100 % local por padrão (a licença usa o serviço simulado do
Bloco 1, com as contas de teste). Com `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY` em `frontend/.env.local` (os mesmos do site), o
serviço de licença passa a ser o real: o e-mail/senha da assinatura vale aqui,
condicionado ao pagamento; o que o paciente fala vai para o celular do
cuidador, as respostas do cuidador são faladas na tela, o socorro dispara
notificação e o resumo da calibração vai para os relatórios do app. **O que sai do computador é só texto escolhido
pelo paciente, alertas e números agregados** — nunca imagem, landmarks ou
perfil de calibração (a CSP só libera a origem do Supabase). Tudo isso está
descrito, arquivo por arquivo, em **`INTEGRACAO.md`**.

---

## Modo Computador (o cursor do IrisFlow sobre o Windows)

Inspirado no Windows Control do Tobii Dynavox e no OptiKey: o cursor de olhar
do app sai da janela e passa a valer para o sistema inteiro, com a mesma
lógica de dwell. Cartão **Computador** no menu → botão **Ativar controle pelo
olhar**.

O que acontece ao ligar:

- a janela do app se **esconde** (a câmera e o motor continuam rodando nela —
  `backgroundThrottling: false` impede o Chromium de congelar o loop) e o dwell
  do app é **suspenso**, para a tela oculta não clicar em nada;
- uma janela de **sobreposição** transparente, sempre no topo e atravessável
  pelo mouse cobre o monitor: nela ficam o cursor (encolhido para ~60 % do
  tamanho do app, sem descer de 24 px), o anel de progresso, uma **barra
  lateral** de ações e, quando abertos, a lupa e o teclado;
- cada amostra de olhar vai da janela do app ao processo principal, que a
  converte para o monitor (px CSS da janela → DIP da tela → px físicos, com
  `screen.dipToScreenPoint` no Windows, para a escala de 125/150 % e
  monitores múltiplos não virarem desvio) e a entrega à sobreposição.

Como se usa (modelo "arma e olha", o mesmo do Tobii):

1. um dwell na barra **arma** uma ação: Clicar, Duplo, Direito, Arrastar,
   Rolar ou Teclado. Nada acontece na tela enquanto nenhuma ação está armada —
   ler um parágrafo não clica;
2. o paciente olha o alvo. Sobre a área, o dwell é uma **fixação** (o olhar
   tem de ficar a menos de 35 px do ponto), não "qualquer lugar por 1,5 s";
3. com a **Lupa** ligada (padrão), a região em volta é ampliada 2,5× num
   painel e o segundo dwell, dentro dele, é o que clica — é o que faz o botão
   de fechar do Chrome ser alcançável com ~1° de erro;
4. a ação **desarma** depois de executar, salvo com **Fixar** ligado.
   **Arrastar** usa dois pontos (pressiona, interpola o movimento, solta);
   **Rolar** fixa uma âncora e rola enquanto o olhar está acima ou abaixo
   dela; o **Teclado** digita em qualquer programa (Unicode via `SendInput`,
   com acentos e ç); **Pausar** congela a área sem sair do modo.

Como se sai: botão verde **IrisFlow** na barra; botão vermelho **Socorro**
(abre a tela de emergência do app); **3 minutos sem rosto** encerram sozinhos;
o cuidador pode clicar na barra com o **mouse físico** (ela deixa de ser
atravessável enquanto o mouse está sobre ela) ou usar o atalho
**Ctrl+Alt+Shift+Esc**. Um vigia no processo principal também encerra se o
olhar parar de chegar por 6 s ou vier sem calibração por 10 s, e se a
resolução, a escala ou o monitor mudarem (a calibração deixa de valer).

Sistema: **Windows** completo (user32 `SetCursorPos`/`SendInput` via `koffi`,
sem compilar nada; limitação conhecida: janelas elevadas pelo UAC ignoram a
entrada de um processo comum). **Linux X11** com `xdotool` (Wayland não
permite que um programa mova o cursor de outro). **macOS** ainda sem adaptador
(exige helper assinado com permissão de Acessibilidade). Segurança: o renderer
não move nem clica nada diretamente — só o processo principal, que valida a
forma e o remetente de cada mensagem e aceita uma lista fechada de teclas.

Arquivos: `src/computador/*` (puro, testado), `electron/computador/*`,
`electron/overlayPreload.ts`, `frontend/overlay.html` + `frontend/src/overlay/*`,
`frontend/src/computador/*`, `frontend/src/pages/VirtualMouseScreen.tsx`.

---

## Voz personalizada (clonagem local)

A voz do paciente, recriada a partir de uma gravação e usada em tudo que ele
diz pelo IrisFlow (teclado, frases, pictogramas, respostas ao cuidador).
Alarmes de emergência e as mensagens lidas do cuidador continuam na voz do
sistema, de propósito. Tela: **Configurações → Voz personalizada**
(`/settings/voice`).

- **Modelo**: [Chatterbox multilíngue](https://github.com/resemble-ai/chatterbox)
  (Resemble AI, licença MIT), clonagem zero-shot com português entre os 23
  idiomas. Roda num processo Python ao lado do Electron (`voice-engine/`),
  falando JSON por linha em stdin/stdout. Os pesos (~1,5 GB) são baixados do
  Hugging Face **uma vez**, pela tela de Voz, para a pasta de dados do app;
  depois disso o motor é posto em modo offline.
- **Importação**: o cuidador aceita o **termo de consentimento** (voz é dado
  biométrico — LGPD art. 5º, II e art. 11 — e a pessoa clonada muitas vezes
  já não pode consentir por si), escolhe um arquivo (nota de voz, vídeo,
  áudio antigo; WAV/MP3/OGG/OPUS/FLAC direto, formatos de vídeo só com
  `ffmpeg` no PATH) e o motor prepara a referência: passa-altas, medição de
  relação sinal/ruído por percentis, redução de ruído quando precisa, corte
  de silêncios e escolha dos melhores ~12 s (o modelo condiciona nos
  primeiros 10 s). O app mostra a **qualidade** (boa / aceitável / fraca) e
  os avisos. Só a referência preparada fica no computador; o arquivo original
  não é copiado. Testado com três gravações reais (limpa, nota de voz,
  ruidosa): 24 dB, 36 dB e 17 dB de SNR — a terceira passou pela redução de
  ruído e saiu como "aceitável".
- **Ao falar**: `services/voz/falar()` procura a frase no **cache** local
  (por voz + texto); se está lá, toca na hora. Se não, pede a geração com um
  prazo de **2,5 s**: dentro dele sai clonada; passado o prazo, o app fala com
  a voz do sistema e deixa a geração terminar para o cache — a frase sai
  clonada na próxima vez. Uma fala nova cancela a anterior. O botão
  **Preparar frases rápidas** pré-sintetiza as frases e pictogramas padrão.
- **Custo**: em CPU comum, 3–8 s por frase nova (mais a carga do modelo na
  primeira frase da sessão); com GPU NVIDIA, abaixo de 1 s. O processo Python
  é encerrado depois de 15 min ocioso para devolver a memória. O motor só é
  iniciado quando há voz importada e ativa, ou quando a tela de Voz é aberta.
- **Plano**: o recurso é do plano **IrisFlow Voz** (`features.voz` da
  licença). Sem ele a tela explica e o paciente fala com a voz do sistema.
- **O que fica onde**: `%APPDATA%\IrisFlow\voz\` — `referencia.wav`,
  `referencia.json` (qualidade, avisos, consentimento aceito), `estado.json`,
  `cache\*.wav`, `modelos\` (HF_HOME). "Remover voz" apaga tudo menos os
  pesos do modelo.

- **Guarda de recursos**: o motor mede a memória antes de carregar e recusa
  com mensagem clara quando há menos de 4,5 GB livres (em vez de levar o
  computador para o swap); usa metade dos núcleos (1–4) e roda com prioridade
  abaixo do normal, para o rastreamento ocular não engasgar. A tela de Voz
  mostra a memória do computador e avisa quando ele está abaixo de 12 GB.
- **Testar o motor sozinho** (sem o Electron), dentro de `voice-engine\` com o
  `.venv` ativado:

  ```powershell
  python -m irisflow_voz --diagnostico                                  # versões, memória, modelo baixado
  python -m irisflow_voz --baixar                                       # pesos do modelo (~1,5 GB)
  python -m irisflow_voz --preparar "C:\caminho\voz.ogg" ref.wav         # preparo da referência
  python -m irisflow_voz --falar "Olá, esta é a minha voz." ref.wav fala.wav
  ```

  Sem argumentos o processo entra no modo protocolo (JSON por linha), que é
  como o Electron o usa. `HF_HOME` define onde os pesos ficam (o app usa
  `%APPDATA%\irisflow\voz\modelos`; no terminal, aponte para a mesma pasta
  para não baixar duas vezes).
- **Limpar tudo**: `voice-engine\limpar-voz.ps1` apaga voz importada, cache e
  pesos; com `-Ambiente` apaga também o `.venv` e o build.

Empacotar o motor para o instalador (Windows, uma vez por versão):

```powershell
cd voice-engine
.\build-voice-engine.ps1      # cria .venv, instala, roda PyInstaller → dist\irisflow-voz\
cd ..
npm run electron:build         # copia dist\irisflow-voz para resources\voice-engine
```

Testes do motor: `cd voice-engine; .\.venv\Scripts\python -m pytest -q tests`
(usa um dublê do modelo; `IRISFLOW_AUDIO_TESTE=<arquivo>` testa o preparo com
um áudio real).

---

## Verificação

```bash
npm test                              # núcleo (Vitest)
npx tsc --noEmit -p tsconfig.json     # tipos do núcleo
npx tsc --noEmit -p electron/tsconfig.json
npm --prefix frontend run verify      # lint, tipos, testes e build da interface
npm run electron:compile
cd voice-engine && python -m pytest -q tests   # motor de voz (dublê do modelo)
```

Tudo isso roda no CI (`.github/workflows/ci.yml`, Windows) a cada push.

Os testes do núcleo cobrem os módulos puros, onde os limiares e as leis de
controle vivem: calibração, Ridge, filtros, decodificação do L2CS, prontidão,
ajuste de câmera, geometria de tela, protocolo de medição, segurança do
Electron, geometria e structs Win32 do Modo Computador e protocolo da voz. Na
interface, a máquina de estados da sobreposição e a própria sobreposição são
testadas de ponta a ponta com uma ponte falsa (armar → lupa → clique no ponto
mapeado); `falar()` é testado com cache, prazo e substituição. O harness sintético (`src/testUtils/`) roda o pipeline inteiro sobre
trajetórias determinísticas e barra regressões contra um baseline versionado.

---

## Compatibilidade

| plataforma | estado |
|---|---|
| Windows 10/11 (Electron) | testado; lê a diagonal do monitor pelo EDID; Modo Computador e voz personalizada completos |
| Chromium (Chrome, Edge) | testado; sem acesso à geometria do sistema, sem Modo Computador nem voz personalizada |
| Linux (Electron) | não testado; Modo Computador em X11 via `xdotool`; motor de voz roda (Python) |
| macOS (Electron) | não testado; Modo Computador ainda sem adaptador (Acessibilidade) |

Os controles de câmera (`zoom`, `brightness`, `contrast`, `exposureMode`)
dependem do driver. O app sonda o que existe e, quando não consegue ajustar,
diz qual ajuste físico é necessário.

---

## Licença

GNU General Public License v3.0 — texto completo em [`LICENSE`](LICENSE).
Para uma tecnologia assistiva isso importa em concreto: quem depende dela
para se comunicar continua tendo direito ao código que a faz funcionar.
