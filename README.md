# IrisFlow

Tecnologia assistiva de rastreamento ocular com webcam comum, feita para
pessoas com Esclerose Lateral Amiotrófica (ELA) e outras condições severas de
restrição motora. Sem hardware especializado: uma webcam, um computador e
100 % do processamento local.

O produto entregue à família chama-se **IrisFlow Communicator** — é esse o nome
do instalador, do atalho, do `productName`, da janela e da tela de abertura.
**IrisFlow** continua sendo o nome da empresa, e é assim que o app se apresenta
onde o espaço é curto (barra compacta, rodapés) e ao longo desta documentação.
Os canais de IPC e as chaves de `localStorage` seguem com o prefixo `irisflow`
**de propósito**: renomeá-los apagaria a calibração, os perfis, o vocabulário e
o vínculo de quem já usa o app.

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
— tudo processado neste computador. Um **assistente de escrita** aprende as
palavras e as frases dessa pessoa e as oferece de volta, para que dizer o que
já foi dito custe uma fixação em vez de vinte.

Duas pessoas usam o app: o **paciente**, que opera tudo pelo olhar em telas
de alvos grandes e alto contraste, e o **cuidador**, que usa mouse e teclado
para configurar, calibrar e acompanhar o rastreamento.

A privacidade do produto se organiza em **três camadas**, e vale enunciá-las
nesta ordem porque é assim que elas são explicadas ao cuidador e ao paciente:

1. **O rastreamento é 100 % local e não sai nunca.** Imagens da câmera, marcos
   faciais, vetores de calibração e os registros brutos de sessão ficam neste
   computador. No Electron isso é imposto por política de conteúdo (CSP), não
   só por disciplina de código.
2. **O que o paciente escolheu dizer sai apenas quando há conta vinculada** — o
   texto que ele mandou falar, os alertas de socorro e os indicadores agregados
   da calibração vão para o celular do cuidador. Sem conta, nada disso existe;
   o app funciona inteiro offline. Ver `INTEGRACAO.md`.
3. **Dois módulos dependem de autorização expressa por funcionalidade, e
   revogável**: a **clonagem de voz**, porque o áudio de referência é dado
   biométrico, e o **chatbot integrado**. Este último hoje existe só na versão
   local — o assistente de escrita — e por isso não envia nada; o dia em que
   houver um modo de nuvem, ele passará pela mesma autorização separada que a
   voz tem hoje.

A única outra saída de rede do app é o download, uma vez, dos pesos do modelo
de voz, feito pelo processo Python fora do renderer.

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
O acompanhamento **de campo** durante a beta — quinze minutos por casa por
semana, seis perguntas e uma planilha — é outro documento, e de propósito:
[`docs/PROTOCOLO-SEMANAL.md`](docs/PROTOCOLO-SEMANAL.md). O de laboratório
responde qual pipeline erra menos; o semanal responde se a pessoa conseguiu
falar naquela semana.

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
  voz/requisitos.ts         faixas de hardware da voz clonada e em qual o
                            computador atual cai
  assistente/               motor do assistente de escrita: modelo aprendido
                            (palavras, bigramas, frases, respostas), sugestão de
                            palavra e de frase (puro, testado)

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
  services/assistente/      persistência do assistente (localStorage) e a porta
                            única que as telas usam para pedir sugestão
  utils/wordPredictor.ts    adaptador do preditor antigo sobre o motor novo;
                            migra o vocabulário `irisflow_user_words` uma vez
  services/apresentacao.ts  modo apresentação: corta a saída para a nuvem
  services/diagnostico/     relatório de suporte (JSON sem nada do paciente)
  pages/games/              jogos por fixação ocular (alvo, memória, desenho)
  index.css                 tokens de design (cores, raios, tipografia)

electron/                   processo principal, preload e IPC de sistema
  computador/               sessão do Modo Computador, janela de sobreposição,
                            adaptadores de SO (Windows via koffi/user32, Linux via xdotool)
  voz/                      gerente do motor de voz (processo Python), cache, consentimento
  overlayPreload.ts         ponte estreita da sobreposição
voice-engine/               motor de voz local em Python (Chatterbox multilíngue):
                            preparo do áudio, síntese, protocolo JSON, testes, build
build/                      ícone do aplicativo (icon.ico, icon.png), gerado do
                            símbolo oficial e consumido pelo electron-builder
docs/MEDICOES.md            protocolo e métricas de medição (laboratório)
docs/PROTOCOLO-SEMANAL.md   acompanhamento semanal das casas da beta (campo)
docs/ROTEIRO-DE-TESTE.md    roteiro de teste manual, em blocos
docs/medicoes/historico/    relatórios reais guardados
docs/medicoes/beta-semanal-modelo.csv   planilha modelo do protocolo semanal
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

Para a **voz clonada** especificamente, a tabela que vale — e que o app mostra
na tela, com a faixa deste computador destacada — é a de
[Requisitos de hardware da voz](#requisitos-de-hardware-da-voz), derivada de
`src/voz/requisitos.ts`.

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
   calibração, voz personalizada, sugestões de escrita, dados), painel com
   estado do rastreamento e alertas, guia de instalação e leitura do teste de
   precisão. É também de onde saem o **modo apresentação** e o **relatório de
   suporte**, descritos adiante.

Regras da interface do paciente: alvos de no mínimo 160×120 px, nada se move
sob o olhar (sem `transform` em hover), uma ação principal por tela, zona de
descanso sem alvos, textos curtos e sem jargão.

### Lazer e jogos

O cartão **Lazer** do menu reúne o que não é comunicação: **Estoura Bolhas**,
**Siga o Alvo**, **Jogo da Memória**, **Desenho**, **Notícias** e
**Meditação**. Os quatro primeiros foram reescritos para funcionar **por
fixação ocular** — antes eram esboços controlados por mouse, isto é,
inutilizáveis exatamente pela pessoa para quem o app existe. O Desenho pinta na
posição do olhar, assinando `useGaze().subscribe` diretamente em vez de esperar
por eventos de ponteiro. Notícias e Meditação já existiam como rotas, mas eram
órfãs: nenhum caminho da interface levava até elas, e agora estão no menu.

Um bug do **Siga o Alvo** merece registro porque falseava o único retorno que o
jogo dá: o placar subia sozinho, sem o paciente acertar nada. Corrigido — a
pontuação agora exige a fixação sobre o alvo.

### Conta IrisFlow (site + app do cuidador)

O app continua 100 % local por padrão (a licença usa o serviço simulado do
Bloco 1, com as contas de teste). Com `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY` em `frontend/.env.local` (os mesmos do site) — que
**já estão gravados neste repositório de trabalho**, apontando para o projeto
Supabase real —, o serviço de licença passa a ser o real: o e-mail/senha da assinatura vale aqui,
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

> **Recurso experimental.** A tela de Voz e a seção correspondente em
> Configurações trazem um selo dizendo isso, e ele não é formalidade jurídica:
> a qualidade da voz depende da gravação de referência, a primeira frase de
> cada sessão é lenta em CPU e há computadores em que o recurso simplesmente
> não vale a pena. É melhor que a família saiba disso antes de baixar 1,5 GB de
> modelo do que descubra depois.

### Requisitos de hardware da voz

A tabela abaixo vive em `src/voz/requisitos.ts` (testada) e é mostrada na
própria tela de Voz, com a faixa do computador atual **destacada** — o cuidador
vê onde a máquina dele cai antes de decidir. Os números vêm da medição no
computador de referência e dos limites já codificados no motor, não de
estimativa de marketing.

| faixa | memória | núcleos | o que esperar |
|---|---|---|---|
| **Abaixo do mínimo** | menos de 8 GB | qualquer | a voz clonada não é recomendada; o paciente fala com a voz do sistema |
| **Mínimo** | 8 a 12 GB | 4 | funciona com os outros programas fechados; a primeira frase pode passar de um minuto e o computador fica lento enquanto o modelo carrega |
| **Recomendado** | 16 GB | 8 | primeira frase em cerca de meio minuto; as frases do dia a dia saem do cache, sem espera |
| **Folgado** | 32 GB ou mais | 12 ou mais | frases novas saem em poucos segundos mesmo fora do cache |

A memória **livre** decide o caso extremo: não adianta ter 32 GB instalados se
30 estão ocupados — o modelo não carrega. Fora isso vale a pior das duas
colunas.

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
  prazo de **4 s**: dentro dele sai clonada; passado o prazo, o app fala com
  a voz do sistema e deixa a geração terminar para o cache — a frase sai
  clonada na próxima vez. Em CPU isso significa que **a primeira vez de cada
  frase nova costuma sair na voz do sistema** e a segunda na clonada; por
  isso, logo depois de importar a voz, o app pré-sintetiza em segundo plano
  os pictogramas, as frases rápidas **e as 30 frases mais usadas pelo próprio
  paciente** (botão **Preparar frases rápidas** refaz quando quiser). Uma fala
  nova cancela a anterior.

  As frases do paciente entraram nessa lista para resolver um sintoma
  concreto e confuso de diagnosticar: *"a voz clonada funcionou uma vez no
  teclado e não funcionou nos pictogramas"*. O cache era pré-aquecido só com os
  textos de fábrica, então a voz saía clonada nas frases que a equipe testava e
  falhava justamente nas que a pessoa usa o dia inteiro — que são as dela.
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

## Assistente de escrita (o chatbot integrado, na versão local)

Este é o "chatbot integrado" que o roteiro de produto pede, implementado como
**sugestão que roda inteira no dispositivo**. A escolha é deliberada e tem três
razões que um serviço de nuvem não conseguiria pagar hoje: mandar conversa de
saúde para fora do computador, custo por usuário ativo, e dependência de
internet numa tela que precisa funcionar sempre — inclusive quando a operadora
cai e a pessoa precisa pedir ajuda.

O motor puro vive em `src/assistente/` e a persistência em
`frontend/src/services/assistente/`. Ele aprende quatro coisas com **este**
paciente, e nenhuma sai daqui:

- **palavras** — quantas vezes ele usou cada uma;
- **bigramas** — que palavra costuma vir depois de outra;
- **frases inteiras** — com frequência e recência, porque recência desempata;
- **respostas às perguntas do cuidador** — o que ele respondeu a cada pergunta.

A quarta é a que transforma predição de palavra em conversa. Quando o cuidador
pergunta "quer água?" pela décima vez, a resposta que o paciente deu nas nove
anteriores fica a uma fixação de distância.

Onde aparece: **sugestão de palavra no teclado**, **sugestão de frase inteira
no teclado** e **sugestão de frase inteira na tela de Conversa**. Em
Configurações há liga/desliga e um botão **apagar aprendizado** — o modelo é
JSON puro no `localStorage` justamente para que exportar, auditar e apagar seja
trivial.

`frontend/src/utils/wordPredictor.ts` continua existindo, mas virou
**adaptador** do motor novo: as telas e os testes que já importavam
`learnWord`, `learnBigram`, `learnSentence` e `getPredictions` seguem
funcionando, e o vocabulário antigo (`irisflow_user_words`,
`irisflow_user_bigrams`) é **migrado uma única vez** na primeira leitura —
ninguém perde o que já tinha ensinado ao app. Para código novo, use
`services/assistente` diretamente: é ele que sugere frases, onde está a
economia real de fixações.

**A porta para a nuvem fica aberta e explícita.** O tipo `ModoDoAssistente` já
prevê `'nuvem'` ao lado de `'local'`, para que as telas tratem o caso desde
agora e a troca futura não vire uma varredura pelo código inteiro. Só `'local'`
está implementado. Ligar o modo de nuvem exigirá **autorização expressa por
funcionalidade, revogável — o mesmo regime da clonagem de voz**, porque aí sim
a conversa do paciente passaria a sair do dispositivo.

---

## Modo apresentação e relatório de suporte

Duas ferramentas do cuidador que existem por motivos práticos, ambas em
Configurações.

**Modo apresentação** (`frontend/src/services/apresentacao.ts`). Numa
demonstração para clínica ou investidor, alguém vai olhar para o botão de
socorro — e, sem este modo, esse olhar dispara um pedido de emergência de
verdade: notificação no celular de um cuidador real, linha no histórico de
alertas, escalonamento se ninguém responder. Ligado, o modo **corta a saída
para a nuvem no barramento `cloud/eventos.ts`** (nem fala, nem alerta, nem
calibração, nem contador saem do computador), troca o nome do paciente por
"Paciente demonstração" e mantém uma **faixa fixa na tela**, para que ninguém
na plateia confunda demonstração com uso real. O que ele **não** faz é simular
dados: as telas continuam mostrando o estado verdadeiro do rastreamento, da
calibração e da voz. Uma demonstração que inventa números não prova nada a quem
entende do assunto e mente para quem não entende.

**Relatório de suporte**
(`frontend/src/services/diagnostico/relatorioDeSuporte.ts`). Um botão que salva
um JSON para a família anexar quando algo dá errado, sem precisar saber abrir
console nenhum. Ele traz versão do app, plataforma, núcleos, memória, tela,
resumo das calibrações, contadores de uso, tamanho do modelo do assistente,
estado do motor de voz e os **últimos 40 erros e avisos** do console.

A regra que governa o conteúdo é dura e **tem teste que a segura**: nenhuma
frase escrita pelo paciente, nenhuma imagem e nenhum vetor de calibração entram
no arquivo. Um relatório de diagnóstico é exatamente onde uma promessa de
privacidade costuma ser quebrada em silêncio. Se alguém precisar do conteúdo
para depurar, a resposta certa é reproduzir o problema, não exportar a vida de
comunicação de uma pessoa por e-mail.

---

## Instalador

O ícone do aplicativo está em `build/icon.ico` e `build/icon.png`, gerados do
símbolo oficial e apontados em `package.json` → `build.win.icon`,
`build.mac.icon` e `build.linux.icon`, além da própria `BrowserWindow`. O NSIS
deixou de ser instalação silenciosa: `oneClick: false`, com escolha da pasta de
instalação e atalho **IrisFlow Communicator**.

### SmartScreen: o aviso do Windows, e as três saídas

O instalador **não é assinado**. Consequência, dita sem rodeio: na primeira
execução o Windows vai mostrar a tela azul *"O Windows protegeu o
computador"*, e o botão para prosseguir fica escondido atrás de **"Mais
informações"**. Isso não é sintoma de defeito no build — é o comportamento
padrão para qualquer executável novo sem reputação acumulada.

Há três saídas, e a escolha é de negócio, não técnica:

1. **Conviver com o aviso durante a beta.** Custo zero. Exige instruir a
   família, por escrito e com captura de tela, a clicar em *Mais informações →
   Executar assim mesmo*. É o que vale enquanto o público é conhecido e pequeno.
2. **Certificado de assinatura de código OV** (validação da organização). O
   aviso não some de imediato: o certificado passa a **acumular reputação** no
   SmartScreen conforme as instalações acontecem, e isso leva algum tempo.
3. **Certificado EV** (validação estendida). Remove o aviso desde a primeira
   instalação, mas custa mais que o OV e exige **token físico** (ou HSM) para
   guardar a chave, o que também complica assinar em CI.

Os preços variam por autoridade certificadora e por prazo, e mudam com
frequência; consulte na hora de decidir em vez de confiar em número escrito
aqui.

### Atualização automática

Na beta os bugs vão aparecer, e "baixe o instalador de novo e passe pelo
SmartScreen outra vez" não é um pedido que uma família atende duas vezes. Por
isso o app traz o `electron-updater` (`electron/atualizacao.ts`), com uma
política deliberadamente simples: **baixa sozinho, nunca reinicia sozinho**.
Reiniciar no meio de uma frase de quem se comunica por fixação ocular é perder
a frase. A versão baixada entra quando o cuidador clica em *Reiniciar agora*
na faixa que aparece no canto da tela (botão de mouse, sem alvo de olhar), ou
sozinha na próxima vez que o app fechar.

Onde o app procura versões novas **não está no código**. No empacotamento,
`electron/package-app.mjs` lê a variável `IRISFLOW_UPDATE_URL` e grava o
endereço em `resources/atualizacao.json`; sem a variável, o app sai com a
atualização desligada e diz isso em Configurações e no log. O servidor esperado
é o provedor *generic* do electron-updater: um diretório HTTP estático com o
`latest.yml` e o instalador — os dois saem lado a lado em
`%TEMP%\irisflow-release` ao final do `npm run electron:build`. Qualquer
hospedagem estática serve (um bucket com acesso público de leitura, um GitHub
Release, uma pasta num site). O fluxo de publicar uma correção fica, então:
subir a versão em `package.json`, empacotar com `IRISFLOW_UPDATE_URL` definida
e copiar `latest.yml` + `IrisFlow Setup X.Y.Z.exe` para aquele endereço. Os
apps abertos verificam 20 segundos depois de abrir e a cada seis horas.

Atualização não assinada tem o mesmo aviso do SmartScreen na instalação, mas o
`electron-updater` instala pelo NSIS já aprovado uma vez, o que na prática
elimina o clique em "executar assim mesmo" a partir da segunda versão.

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

**Estado medido nesta versão:** o núcleo passa em **1402 testes (mais 1 pulado)
distribuídos em 132 arquivos**, e a interface em **799 testes em 97 arquivos** —
**2201 testes ao todo**. `tsc --noEmit` termina **sem nenhum erro** nos dois
projetos, o do núcleo (`tsconfig.json`) e o do Electron
(`electron/tsconfig.json`).

Os testes do núcleo cobrem os módulos puros, onde os limiares e as leis de
controle vivem: calibração, Ridge, filtros, decodificação do L2CS, prontidão,
ajuste de câmera, geometria de tela, protocolo de medição, segurança do
Electron, geometria e structs Win32 do Modo Computador, protocolo da voz, as
faixas de hardware da voz (`voz/requisitos.ts`) e o motor do assistente de
escrita (`assistente/`). Na interface, a máquina de estados da sobreposição e a
própria sobreposição são testadas de ponta a ponta com uma ponte falsa (armar →
lupa → clique no ponto mapeado); `falar()` é testado com cache, prazo e
substituição; o modo apresentação é testado pelo que ele promete — que os
eventos `fala`, `ajuda` e `uso` **não** saem do barramento enquanto está
ligado —; e o relatório de suporte tem teste dedicado a garantir que nenhuma
frase do paciente, imagem ou vetor de calibração entre no arquivo. Os jogos por
fixação ocular também têm testes próprios, incluindo o do placar do Siga o Alvo
que antes subia sozinho. O harness sintético (`src/testUtils/`) roda o pipeline
inteiro sobre trajetórias determinísticas e barra regressões contra um baseline
versionado.

---

## Compatibilidade

| plataforma | estado |
|---|---|
| Windows 10/11 (Electron) | testado; lê a diagonal do monitor pelo EDID; Modo Computador completo e voz personalizada completa, esta ainda **experimental** |
| Chromium (Chrome, Edge) | testado; sem acesso à geometria do sistema, sem Modo Computador nem voz personalizada. O assistente de escrita funciona (é só renderer) |
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
