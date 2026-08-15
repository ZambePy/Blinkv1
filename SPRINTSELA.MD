# Pipeline de Rastreamento Ocular com L2CS-Net para Comunicação Assistiva em ELA

**Documento de arquitetura de software**
Contexto: front-end existente em JS/TS · execução via *sidecar* local · teclado virtual com seleção por *dwell* · webcam comum, sem GPU dedicada

---

## Sumário

1. [A ideia central em uma página](#1-a-ideia-central-em-uma-página)
2. [O que o L2CS-Net faz — e o que ele NÃO faz](#2-o-que-o-l2cs-net-faz--e-o-que-ele-não-faz)
3. [O orçamento de erro: por que isso define todo o resto](#3-o-orçamento-de-erro-por-que-isso-define-todo-o-resto)
4. [Arquitetura de processos](#4-arquitetura-de-processos)
5. [O pipeline camada por camada](#5-o-pipeline-camada-por-camada)
6. [Calibração](#6-calibração)
7. [A máquina de estados do dwell](#7-a-máquina-de-estados-do-dwell)
8. [Adaptações específicas para ELA](#8-adaptações-específicas-para-ela)
9. [Orçamento de latência e desempenho](#9-orçamento-de-latência-e-desempenho)
10. [Contratos de dados (TypeScript)](#10-contratos-de-dados-typescript)
11. [Métricas, telemetria e testes](#11-métricas-telemetria-e-testes)
12. [Riscos e mitigações](#12-riscos-e-mitigações)
13. [Roadmap em fases](#13-roadmap-em-fases)
14. [Fontes](#14-fontes)

---

## 1. A ideia central em uma página

Se você guardar só uma coisa deste documento, guarde esta:

> **Um sistema de rastreamento ocular assistivo não é "um modelo de IA". É uma cadeia de transformações onde o modelo é apenas um elo — e provavelmente nem é o elo que mais determina a experiência do usuário.**

A cadeia completa é:

```
webcam → imagem → rosto detectado → recorte normalizado → L2CS-Net
   → ângulos de olhar (yaw, pitch)
   → ponto na tela (x, y)                     ← calibração por usuário
   → ponto estabilizado                       ← filtragem temporal
   → "está olhando para a tecla K"            ← geometria + histerese
   → "selecionou a tecla K"                   ← máquina de estados de dwell
   → letra na caixa de texto                  ← camada de aplicação
```

Cada seta é um ponto onde erro pode ser **introduzido** ou **absorvido**. A engenharia boa aqui consiste em absorver, nas camadas de cima, o erro que o modelo inevitavelmente comete embaixo.

**Analogia:** imagine que o L2CS-Net é uma bússola presa na testa da pessoa. Ela te diz *para qual direção* a pessoa está olhando, com uma margem de erro de alguns graus. Mas você quer saber *em que ponto da parede* ela está olhando. Para isso você precisa saber (a) onde a bússola está no espaço, (b) onde a parede está, e (c) que essa bússola específica tem um pequeno desvio pessoal que precisa ser medido. Se a parede estiver longe, um erro minúsculo de ângulo vira um erro enorme de posição.

---

## 2. O que o L2CS-Net faz — e o que ele NÃO faz

### 2.1 Como o modelo funciona (em linguagem simples)

O L2CS-Net (*L2CS = **L**earning **2** **C**hained **S**oftmaxes*) recebe **uma imagem do rosto inteiro** e devolve **dois ângulos**:

- **yaw** — quanto o olhar está desviado para a esquerda/direita
- **pitch** — quanto o olhar está desviado para cima/baixo

A sacada do artigo é *como* ele prevê esses ângulos. Em vez de pedir para a rede cuspir um número contínuo direto (regressão pura, que é instável), ele:

1. Usa uma **ResNet-50** como espinha dorsal para extrair características visuais do rosto.
2. Divide-se em **duas cabeças independentes** — uma só para yaw, outra só para pitch. Elas compartilham a mesma espinha dorsal, mas aprendem separadamente. Isso importa porque yaw e pitch têm dinâmicas visuais diferentes.
3. Cada cabeça faz uma **classificação em faixas (bins)**: "o ângulo está na faixa 42? na 43?". Na implementação oficial do Gaze360 são **90 faixas de 4° cada**, cobrindo ±180°.
4. Aplica **softmax** e depois calcula o **valor esperado** dessas faixas — ou seja, tira uma média ponderada. Isso reconverte a classificação grosseira num valor contínuo e suave.
5. Treina com uma **perda combinada**: entropia cruzada (para acertar a faixa) **+** erro quadrático médio (para refinar dentro da faixa). Na fórmula do artigo: `CLS(y,p) = H(y,p) + β · MSE(y,p)`.

**Por que essa combinação é boa:** a classificação dá robustez (a rede não precisa acertar o número exato, só a região certa) e a regressão dá precisão (refina dentro da região). É o melhor dos dois mundos, e é exatamente por isso que esse modelo tem bom desempenho em ambiente não controlado — que é o seu caso.

### 2.2 A acurácia que você pode esperar

| Dataset de treino | Erro angular médio | Significado |
|---|---|---|
| MPIIGaze | **3,92°** | Cenário de laptop, cabeça relativamente frontal |
| Gaze360 (frontal 180°) | **10,41°** | Cenário selvagem, cobertura de 360° |

**Consequência prática direta:** se você usar o checkpoint do **Gaze360** (que é o mais divulgado no repositório), o erro é de ~10°. Como você vai ver na seção 3, 10° numa tela de notebook é **um terço da largura da tela**. Isso é inutilizável para um teclado.

> **Decisão de arquitetura #1:** use o modelo treinado/afinado para o regime **MPIIFaceGaze** (rosto próximo, monitor à frente), não o Gaze360. E, idealmente, faça *fine-tuning* com dados coletados no seu próprio setup.

### 2.3 O que ele NÃO faz — o mal-entendido mais caro do projeto

**O L2CS-Net não devolve um ponto na tela.** Ele devolve uma *direção*.

Para converter direção em ponto, você precisa de três coisas que o modelo não fornece:

1. **De onde parte o raio de olhar** — a posição 3D dos olhos em relação à câmera.
2. **Onde está a tela** — a geometria entre o plano da câmera e o plano do monitor.
3. **O desvio pessoal do usuário** — todo mundo tem um deslocamento sistemático entre o eixo óptico (o que a rede vê) e o eixo visual (para onde a pessoa realmente está olhando). Esse desvio é individual e é a maior fonte de erro corrigível.

Os itens 1 e 2 são geometria. O item 3 é **calibração** — e é a camada mais importante do sistema inteiro. É comum um sistema sair de 6° para 2° só com uma calibração bem feita.

### 2.4 O passo que quase todo projeto pula: normalização de imagem

O artigo diz que segue o procedimento padrão de **normalização de dados** (Zhang et al.): antes de entrar na rede, a imagem passa por uma câmera virtual que remove a rotação de *roll* da cabeça e padroniza a distância aparente do rosto.

O código de exemplo do repositório **não faz isso** — ele só recorta o rosto e redimensiona para 224×224. Funciona, mas joga fora precisão.

> **Decisão de arquitetura #2:** implemente a normalização geométrica completa antes da inferência, e a desnormalização (rotacionar o vetor de olhar de volta ao espaço real da câmera) depois. Este é um dos maiores ganhos de acurácia disponíveis, e não custa quase nada de CPU.

### 2.5 Uma otimização que quase ninguém faz: re-binning

O modelo Gaze360 usa 90 faixas de 4° cobrindo ±180°. Mas numa tela de notebook o usuário **nunca** olha além de ±20°. Você está gastando 90% da capacidade de resolução do modelo numa faixa de ângulos que nunca vai acontecer.

> **Decisão de arquitetura #3 (alto impacto, médio esforço):** ao fazer *fine-tuning*, redefina as faixas para cobrir apenas ±30° com faixas de 1°. Você passa de uma resolução nativa de 4° para 1° — uma melhora de 4× na granularidade da saída, sem mudar uma linha da arquitetura.

---

## 3. O orçamento de erro: por que isso define todo o resto

Esta é a conta mais importante do projeto. Erro angular vira erro em pixels dependendo da distância e do tamanho da tela.

**Setup de referência: notebook 15,6" (1920×1080), usuário a 60 cm.**
Tela física: 34,5 × 19,4 cm. Campo de visão horizontal: 32°. **1 grau ≈ 1,05 cm ≈ 58 pixels.**

| Erro angular | Erro em cm | Erro em pixels | % da largura da tela |
|---|---|---|---|
| 1,0° | 1,0 cm | 58 px | 3,0% |
| 2,0° | 2,1 cm | 116 px | 6,1% |
| 3,0° | 3,1 cm | 175 px | 9,1% |
| **3,92°** (MPIIGaze) | 4,1 cm | 228 px | 11,9% |
| 6,0° | 6,3 cm | 349 px | 18,2% |
| **10,41°** (Gaze360) | 10,9 cm | 606 px | **31,6%** |

**Agora a consequência de design.** Uma regra prática segura para *dwell* é que a **tecla precisa ter no mínimo o dobro do erro típico** de largura (assim o ponto cai dentro da tecla certa mesmo com o erro no pior caso):

| Erro efetivo | Tamanho mínimo da tecla | Grade viável na tela |
|---|---|---|
| 1,0° | 2,1 cm | 16 × 9 = **144 células** |
| 1,5° | 3,1 cm | 10 × 6 = **60 células** |
| 2,0° | 4,2 cm | 8 × 4 = **32 células** |
| 3,0° | 6,3 cm | 5 × 3 = **15 células** |
| 4,0° | 8,4 cm | 4 × 2 = **8 células** |

**Leia essa tabela ao contrário.** Ela não te diz qual teclado desenhar depois de treinar o modelo. Ela te diz: **primeiro meça o erro real do seu sistema com o seu usuário, e só então desenhe o teclado.** Um teclado QWERTY completo (~40 teclas) exige erro efetivo abaixo de ~1,8°. Se você medir 3°, seu teclado precisa ter no máximo ~15 células — o que significa **teclado hierárquico** (grupos de letras que se expandem) ou **teclado ambíguo com predição de palavras**.

> **Decisão de arquitetura #4:** o layout do teclado é uma **saída** da medição de erro, não uma escolha estética. Construa o teclado com número de colunas/linhas configurável em tempo de execução, e ajuste-o por usuário a partir da calibração.

---

## 4. Arquitetura de processos

Você escolheu *sidecar* local. Aqui está o desenho.

```
┌─────────────────────────────────────────────────────────────┐
│  Aplicação desktop (Tauri ou Electron)                      │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Front-end — TypeScript (seu código atual)         │     │
│  │                                                     │     │
│  │  • Captura de vídeo (getUserMedia)                 │     │
│  │  • Renderização do teclado (Canvas/WebGL)          │     │
│  │  • Filtro temporal + máquina de estados de dwell   │     │
│  │  • Fluxo de calibração (UI)                        │     │
│  │  • Predição de palavras + TTS                      │     │
│  └────────────────────┬───────────────────────────────┘     │
│                       │                                      │
│              WebSocket local (ws://127.0.0.1:PORTA)         │
│              mensagens binárias, sem TLS, sem rede           │
│                       │                                      │
│  ┌────────────────────▼───────────────────────────────┐     │
│  │  Sidecar de visão — Python ou Rust                 │     │
│  │                                                     │     │
│  │  Thread A: recebe frame, detecta/rastreia rosto    │     │
│  │  Thread B: normaliza + inferência L2CS (ONNX RT)   │     │
│  │  Thread C: publica resultados + métricas de saúde  │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Por que essa divisão

| Fica no TS (front) | Fica no sidecar (visão) |
|---|---|
| Tudo que é **interação e estado do usuário** | Tudo que é **pesado e numérico** |
| Filtro, dwell, histerese, layout, predição | Detecção, normalização, rede neural |
| Precisa rodar a 60 Hz junto com o render | Roda a 15–25 Hz de forma desacoplada |
| Debug fácil, iteração rápida | Otimização de baixo nível, ONNX Runtime |

**A regra de ouro:** a máquina de estados de *dwell* **nunca** deve depender da chegada de um frame novo. Ela roda no `requestAnimationFrame` do front, consumindo a última posição conhecida. Se o sidecar travar por 200 ms, a barra de progresso do dwell não pode congelar de forma visível — ela deve continuar (com o último ponto válido) ou abortar de forma limpa e explícita. Nunca "pular".

### Contrapressão (backpressure) — regra crítica

O sidecar processa mais devagar do que a câmera produz. **Nunca enfileire frames.** Sempre descarte.

```
Frame chega → sidecar está ocupado? → DESCARTA o frame, não enfileira
                                    → registra "frame descartado" na telemetria
```

Se você enfileirar, a latência cresce sem limite e o usuário vê o cursor perseguindo onde ele estava há 2 segundos. Para comunicação assistiva isso é pior do que não ter cursor nenhum. **Latência constante e previsível vale mais que taxa de quadros alta.**

### Escolha de linguagem do sidecar

- **Python (FastAPI + `onnxruntime` + OpenCV)** — comece por aqui. Ecossistema pronto, você aproveita o código de referência do L2CS diretamente, e o GIL não é problema porque o ONNX Runtime libera o GIL durante a inferência. Custo: instalador maior (~200 MB com dependências).
- **Rust (`ort` + `image`)** — migre depois, se o empacotamento ou o consumo de memória incomodarem. Binário único, ~20 MB, inicialização quase instantânea.

Não comece em Rust. Você vai iterar muito no pipeline de visão nos primeiros meses, e iterar em Python é 5× mais rápido.

---

## 5. O pipeline camada por camada

### Camada 1 — Captura

**Responsabilidade:** produzir frames com timestamp confiável e condições fotométricas estáveis.

O que fazer:

- Resolução de captura **640×480 ou 800×600** é suficiente. O que importa é a resolução *do rosto* no recorte, não da imagem toda. Se o rosto ocupa 200×200 px na imagem, você já tem material suficiente para um crop de 224×224. Capturar em 1080p só queima CPU no redimensionamento.
- Fixe **30 fps**. Não peça 60 — você não vai processar tudo mesmo, e frames em excesso só geram descarte.
- **Desligue o ajuste automático** sempre que possível (`exposureMode: 'manual'`, `whiteBalanceMode: 'manual'`). A oscilação do auto-exposure é uma das maiores fontes de instabilidade em modelos baseados em aparência: a rede vê a face escurecer e acha que o olhar mudou. Faça um "aquecimento" de 3 s no início da sessão, deixe o auto convergir, e então trave os valores.
- **Cada frame carrega um timestamp monotônico** (`performance.now()` ou o `timestamp` do `VideoFrame`). Isso é obrigatório para o filtro temporal funcionar corretamente quando a taxa de quadros varia.
- Use `MediaStreamTrackProcessor` / `VideoFrame` (WebCodecs) em vez de desenhar em `<canvas>` e ler pixels. Evita uma cópia GPU→CPU cara por frame.

**Requisitos físicos do setup** — documente isso para o cuidador, porque vale mais que qualquer otimização de software:

- Câmera **centralizada abaixo ou acima da tela**, presa junto com a tela (se a tela move e a câmera não, a calibração se perde).
- **Sem janela ou luz forte atrás do usuário** (contraluz destrói a detecção de face).
- Iluminação frontal difusa. Uma luminária LED barata apontada para o teto na frente do usuário resolve 80% dos problemas de iluminação.
- Distância de 50–70 cm, estável. Se o usuário está reclinado numa cadeira, a tela deve estar montada em braço articulado que acompanha.

### Camada 2 — Detecção e rastreio da face

**Responsabilidade:** localizar o rosto e os pontos de referência, com o menor custo possível.

O código de referência do L2CS usa **RetinaFace**. É preciso, mas pesado demais para rodar a cada frame em CPU.

> **Decisão de arquitetura #5:** substitua por **detecção esparsa + rastreio denso**.
>
> - **Detecção completa** (BlazeFace / MediaPipe Face Detector) só quando: (a) a sessão inicia, (b) o rastreio foi perdido, (c) a cada N segundos como verificação de sanidade.
> - **Rastreio** entre detecções: o **MediaPipe Face Landmarker** (468 pontos) propaga a região de interesse quadro a quadro a um custo muito menor. É o mesmo mecanismo que o MediaPipe usa internamente.

O que essa camada entrega:

| Saída | Para que serve |
|---|---|
| Caixa do rosto | Recorte de entrada da rede |
| 468 landmarks 3D | Pose da cabeça, posição dos olhos, detecção de piscada |
| Matriz de pose da cabeça (R, t) | Normalização geométrica + origem do raio de olhar |
| Escore de qualidade | Portão de confiança (seção 7) |

A pose da cabeça vem de `solvePnP` (OpenCV) usando um modelo 3D canônico de face e os landmarks 2D detectados, com as **intrínsecas da câmera**. Se você não tiver as intrínsecas calibradas, estime: `fx = fy ≈ largura_da_imagem`, centro óptico no centro da imagem. É uma aproximação grosseira mas funcional; calibrar de verdade (tabuleiro de xadrez, 20 fotos) melhora perceptivelmente e é um investimento de 30 minutos por modelo de webcam.

### Camada 3 — Normalização

**Responsabilidade:** entregar à rede sempre "o mesmo tipo de imagem", independentemente de onde a cabeça está.

Este é o passo da seção 2.4. A ideia em linguagem simples: em vez de dar à rede a imagem crua do rosto (que muda de tamanho, inclinação e perspectiva conforme a pessoa se mexe), você **finge que existe uma câmera virtual** sempre à mesma distância do rosto, sempre alinhada, sempre sem inclinação lateral.

O procedimento:

1. Estime o centro do rosto em 3D (a partir do `solvePnP`).
2. Construa uma matriz de rotação `R` que (a) aponta a câmera virtual para o centro do rosto e (b) zera o *roll* da cabeça.
3. Construa uma matriz de escala `S` que coloca o rosto a uma distância virtual fixa (tipicamente 600 mm).
4. Aplique a transformação `M = S · R · K⁻¹` como *warp* perspectivo na imagem. Resultado: recorte 224×224 canônico.
5. **Guarde `R`.** Você vai precisar dela para desfazer a transformação.

Depois da inferência, **desnormalize**: converta os ângulos `(yaw, pitch)` em vetor unitário 3D, aplique `R⁻¹`, e você tem o vetor de olhar no espaço real da câmera.

```
vetor_normalizado = [ -cos(pitch)·sin(yaw),  -sin(pitch),  -cos(pitch)·cos(yaw) ]
vetor_real        = R⁻¹ · vetor_normalizado
```

> **Atenção às convenções de sinal.** Cada implementação usa uma. Não confie na fórmula acima cegamente: valide empiricamente pedindo para alguém olhar para os quatro cantos da tela e conferindo se o vetor aponta para o lado certo. Isso vai te economizar dois dias de depuração.

### Camada 4 — Inferência L2CS-Net

**Pré-processamento** (idêntico ao treino, sem exceção):

```
recorte 224×224 → BGR para RGB → escala [0,1]
  → normalização ImageNet: média (0.485, 0.456, 0.406), desvio (0.229, 0.224, 0.225)
  → tensor NCHW float32
```

**Pós-processamento:**

```
logits_yaw   (90 valores) → softmax → Σ(p_i · i) · 4 − 180  →  graus  → radianos
logits_pitch (90 valores) → softmax → Σ(p_i · i) · 4 − 180  →  graus  → radianos
```

**Sinal de confiança de graça:** a **entropia** da distribuição softmax te diz o quão certa a rede está. Distribuição concentrada num pico = confiante. Distribuição espalhada = a rede não sabe (rosto ocluso, movimento borrado, olho fechado). Use isso como entrada do portão de confiança na camada 7. **É o sinal de qualidade mais barato e mais útil que você tem, e a maioria dos projetos ignora.**

**Otimização para CPU** — em ordem de custo/benefício:

| # | Otimização | Ganho esperado | Esforço |
|---|---|---|---|
| 1 | Exportar para **ONNX** + ONNX Runtime com `graph_optimization_level=ALL` | 1,5–2× | Baixo |
| 2 | Fixar `intra_op_num_threads` no nº de núcleos físicos | 10–20% | Trivial |
| 3 | **Quantização dinâmica INT8** dos pesos | 2–3× | Baixo |
| 4 | Executar em taxa desacoplada (15 Hz em vez de 30 Hz) | 2× de folga de CPU | Baixo |
| 5 | **Destilar** para uma espinha dorsal leve (MobileNetV3 / EfficientNet-Lite) mantendo as duas cabeças e a perda do L2CS | 5–10× | **Alto** |

Sobre o item 5: essa é a jogada de médio prazo. A contribuição do artigo L2CS é a **estratégia de saída** (duas cabeças + faixas + softmax + perda combinada), não a ResNet-50 especificamente. Você pode trocar a espinha dorsal por algo 10× mais leve e recuperar quase toda a acurácia via destilação (treinar o modelo pequeno para imitar as *distribuições softmax* do grande, não só o ângulo final). Numa webcam comum sem GPU, isso é a diferença entre 15 Hz e 60 Hz.

Mas **não faça isso na fase 1.** Primeiro prove que o pipeline inteiro funciona com o modelo grande a 15 Hz.

> **Insight importante:** para *dwell* de 600–800 ms, **15 Hz é perfeitamente suficiente**. Você não precisa de 60 Hz. 15 Hz te dá ~10 amostras dentro de um dwell — mais que o bastante para decidir com confiança. Não otimize velocidade de inferência antes de otimizar acurácia; é o erro de priorização mais comum nesse tipo de projeto.

### Camada 5 — Geometria: do ângulo ao ponto na tela

Você tem duas rotas. **Recomendo a híbrida.**

**Rota A — Geométrica pura (interseção raio-plano)**

```
origem  = posição 3D entre os olhos (do solvePnP), no referencial da câmera
direção = vetor de olhar desnormalizado
plano   = plano da tela no referencial da câmera (exige medir a geometria câmera↔tela)
ponto   = interseção(origem + t·direção, plano)  →  converte metros para pixels
```

*Vantagem:* fisicamente correta, generaliza para qualquer posição de cabeça.
*Desvantagem:* exige conhecer a geometria câmera↔tela (que muda a cada notebook) e é extremamente sensível a erro na estimativa de profundidade — a profundidade da webcam mono é notoriamente ruim.

**Rota B — Mapeamento aprendido (regressão)**

Treine, durante a calibração, uma função que leva diretamente de características para pixels:

```
entrada: [ yaw, pitch, head_yaw, head_pitch, head_roll, x_face, y_face, escala_face ]
saída:   [ x_tela, y_tela ]
modelo:  regressão polinomial de 2ª ordem com regularização ridge
```

*Vantagem:* absorve automaticamente a geometria da tela, o desvio pessoal do usuário **e** os vieses sistemáticos do modelo — tudo de uma vez. É simples, rápido e surpreendentemente eficaz.
*Desvantagem:* só vale para a faixa de posições cobertas na calibração. Se a cabeça sair muito dessa faixa, degrada rápido.

**Rota híbrida (recomendada):** use a Rota A como *estimativa base* e a Rota B para aprender o **resíduo** (a correção). Assim você tem a generalização da geometria mais a precisão da calibração pessoal.

```
ponto_final = ponto_geométrico + correção_aprendida(características)
```

Um detalhe que faz muita diferença: **inclua as variáveis de pose da cabeça como entrada da regressão.** É o que permite o sistema tolerar a cabeça se mover um pouco entre calibração e uso — situação garantida quando o cuidador reposiciona o usuário na cadeira.

Referência de acurácia realista: sistemas webcam de qualidade nessa arquitetura reportam **3,2–3,3° com cabeça parada** e **~5,1° com movimento de cabeça** — contra ~0,9° de um Tobii dedicado com infravermelho. Calibre suas expectativas por esses números, não pelos 3,92° do artigo (que são medidos em condições de laboratório).

### Camada 6 — Filtragem e estabilização

**Este é o elo com melhor retorno sobre investimento do projeto inteiro.** Um ponto de olhar cru pisca, treme e salta. Filtragem bem feita transforma um sinal inutilizável num sinal confortável — e custa quase nada de CPU.

#### 6.1 Filtro 1€ (One Euro Filter)

Não use média móvel. Não use suavização exponencial de constante fixa. Use o **Filtro 1€** (Casiez et al., CHI 2012).

A ideia, em linguagem simples: **suavize muito quando o sinal está parado, e pouco quando está se movendo rápido.**

- Quando o usuário está **fixando** uma tecla, a velocidade do ponto é baixa → o filtro suaviza pesado → o tremor some, o ponto fica estável e cravado na tecla.
- Quando o usuário **muda** de tecla, a velocidade dispara → o filtro afrouxa → o ponto acompanha o salto sem atraso perceptível.

Isso resolve o dilema clássico *tremor vs. atraso* que média móvel não resolve (média móvel sempre te faz escolher um dos dois males). São ~40 linhas de TypeScript, dois parâmetros para ajustar (`minCutoff` e `beta`), e a melhora subjetiva é dramática.

#### 6.2 Classificação de fixação vs. sacada

O olho humano não se move suavemente — ele salta (**sacadas**, 30–80 ms) e para (**fixações**, 200–600 ms). Só as fixações carregam intenção.

Implemente um classificador por **dispersão (I-DT)**: se os últimos ~150 ms de amostras couberem dentro de um círculo pequeno, é fixação; senão, é sacada.

Por que isso importa mais do que parece:

- **Nunca acumule tempo de dwell durante uma sacada.** Se você acumular, o olhar passando por cima de uma tecla a caminho de outra vai acionar seleções falsas — é exatamente o problema de Midas Touch, que a literatura sobre ELA identifica como um dos principais obstáculos práticos desses dispositivos.
- Você pode **resetar o filtro 1€** no início de uma sacada detectada, eliminando totalmente o atraso de transição entre teclas.

#### 6.3 Portão de confiança e tratamento de piscadas

Nem todo frame produz uma estimativa utilizável. Defina explicitamente quando **não** emitir:

| Condição | Como detectar | Ação |
|---|---|---|
| Piscada | Razão de aspecto do olho (EAR) dos landmarks abaixo do limiar | **Congela** o último ponto válido por até 400 ms |
| Rosto perdido | Detector falhou | Congela por 300 ms, depois entra em estado "sem rastreio" |
| Rede insegura | Entropia do softmax alta | Reduz o peso da amostra no filtro |
| Cabeça muito girada | \|head_yaw\| > 30° | Marca baixa confiança, avisa na UI |
| Movimento borrado | Variância do laplaciano do recorte baixa | Descarta a amostra |

**A regra de ouro:** durante uma piscada, o modelo produz lixo — e lixo não filtrado faz o cursor voar para o canto da tela e disparar uma seleção errada. **Congelar é sempre melhor que emitir uma estimativa ruim.** Congelar causa uma pausa que o usuário entende; um salto causa uma seleção errada que o usuário precisa desfazer.

Em ELA isso é ainda mais crítico: **ptose palpebral** (pálpebra caída) e **olho seco por má função palpebral** são achados documentados, e ambos fazem o EAR ficar cronicamente baixo. Seu limiar de piscada precisa ser **calibrado por usuário**, não fixo no código — senão o sistema vai achar que a pessoa está piscando o tempo todo.

---

## 6. Calibração

Se você tiver que escolher **uma única coisa** para caprichar neste projeto, escolha a calibração. Ela vale mais que o modelo.

### 6.1 Calibração explícita (o fluxo inicial)

**Desenho recomendado:**

- **9 pontos** dispostos em grade 3×3, cobrindo bem as bordas (não só o centro — as bordas é que revelam a não-linearidade).
- **1,5 a 2 s por ponto**, com um alvo que **encolhe** para atrair e prender a fixação (um ponto que diminui de tamanho é muito mais eficaz para segurar o olhar do que um ponto estático).
- **Descarte os primeiros 400 ms** de cada ponto (tempo de sacada + acomodação).
- **Valide durante a coleta:** se a dispersão das amostras de um ponto for alta demais, repita **aquele ponto** — nunca a calibração inteira. Refazer tudo é exaustivo e é uma das causas documentadas de abandono desses dispositivos.
- Ajuste a regressão polinomial (Rota B da camada 5).
- **Termine com validação:** mostre 4 pontos novos, meça o erro real, e **exiba o resultado ao cuidador em linguagem clara**: *"Precisão: boa — teclado de até 24 teclas recomendado"*. Esse número deve ir direto para o dimensionamento do teclado (seção 3).

**Cuidados de acessibilidade no fluxo:** ele precisa poder ser abortado a qualquer momento, ser retomável de onde parou, e nunca prender o usuário numa tela da qual ele não consegue sair sozinho. Um usuário com ELA que fica preso numa tela de calibração está sem meio de comunicação até alguém aparecer.

### 6.2 Recalibração implícita — o diferencial do seu produto

Aqui está a melhor ideia deste documento.

**Toda seleção bem-sucedida por dwell é um ponto de calibração de graça.** Se o usuário fixou por 700 ms e selecionou a tecla "A", e depois **não desfez** a ação, você sabe com alta confiança que ele estava olhando para o centro da tecla "A". Você tem um par (características → posição verdadeira) sem pedir nada a ele.

Implemente:

1. Guarde as amostras de cada seleção confirmada e não desfeita, junto com o centro da tecla escolhida.
2. Mantenha uma janela deslizante dos últimos ~200 pares.
3. Reajuste o **termo de deslocamento** (bias) do modelo continuamente e com passo pequeno. Não reajuste os coeficientes polinomiais de ordem alta em tempo real — só o deslocamento e, no máximo, o ganho.
4. Se o deslocamento acumulado ultrapassar um limite (ex.: 2°), **avise** discretamente: *"A precisão mudou — deseja recalibrar?"*

**Por que isso é grande:** o *drift* — a deriva lenta da calibração ao longo da sessão, causada por mudança de postura, fadiga, mudança de iluminação — é o que faz esses sistemas piorarem ao longo do dia e o que obriga o usuário a chamar o cuidador. Recalibração implícita ataca isso sem custo nenhum de esforço para o usuário. É o tipo de coisa que separa um protótipo de um produto usável.

### 6.3 Perfis persistentes

Salve por usuário: coeficientes de calibração, limiar de EAR, tempo de dwell preferido, layout do teclado, histórico de erro. Um usuário com ELA usa o mesmo dispositivo todo dia, na mesma cadeira. **Recalibrar do zero toda sessão é uma falha de produto, não uma necessidade técnica.** Carregue o perfil e ofereça uma "recalibração rápida" de 3 pontos (~6 s) que apenas corrige o deslocamento.

---

## 7. A máquina de estados do dwell

Toda a interação vive aqui. Modele explicitamente, não com `if`s espalhados.

```
                  ┌──────────────┐
        ┌────────►│   OCIOSO     │  sem alvo sob o olhar
        │         └──────┬───────┘
        │                │ olhar entra num alvo
        │                ▼
        │         ┌──────────────┐
        │         │  PAIRANDO    │  alvo detectado, aguardando estabilizar
        │         └──────┬───────┘
        │  saiu          │ fixação confirmada (I-DT estável por ~100 ms)
        │  (histerese)   ▼
        ├────────┌──────────────┐
        │        │  ACUMULANDO  │  barra de progresso visível e crescendo
        │        └──────┬───────┘
        │               │ progresso atinge 100%
        │               ▼
        │        ┌──────────────┐
        │        │  CONFIRMADO  │  dispara ação + feedback sonoro/visual
        │        └──────┬───────┘
        │               ▼
        │        ┌──────────────┐
        └────────┤  REFRATÁRIO  │  ~300 ms ignorando entrada
                 └──────────────┘
```

### Detalhes que decidem se funciona ou não

**Histerese nas fronteiras.** Uma tecla, uma vez ativa, mantém uma **margem de tolerância** (ex.: +15% da sua área) antes de ser abandonada. Sem isso, um ponto oscilando exatamente na fronteira entre duas teclas alterna entre elas e o dwell nunca completa — a experiência mais frustrante possível. **Área de entrada menor que a área de saída. Sempre.**

**Decaimento suave, não reset abrupto.** Se o olhar sai do alvo por 80 ms e volta, o progresso não deve zerar. Faça o progresso **decair** (a ~2× a velocidade de acumulação) em vez de resetar. Isso perdoa micro-sacadas e tremor, que são frequentes.

**Período refratário.** Depois de uma seleção, ignore entrada por ~300 ms. Sem isso o usuário seleciona a mesma tecla duas vezes antes de conseguir mover o olhar.

**Dwell dinâmico.** A revisão sistemática sobre sistemas de dwell dinâmico mostra ganhos consistentes sobre dwell fixo. Aplicações práticas:

| Situação | Ajuste no dwell |
|---|---|
| Tecla provável segundo o preditor de linguagem | **Reduzir** (ex.: 500 ms) |
| Tecla improvável | **Aumentar** (ex.: 900 ms) |
| Ação destrutiva (apagar tudo, sair) | **Aumentar muito** (1500 ms) + confirmação |
| Usuário acertando muito (poucos "desfazer") | Reduzir gradualmente a linha de base |
| Muitos "desfazer" recentes | Aumentar a linha de base |
| Sinal de fadiga (sessão longa, tremor crescente) | Aumentar |

**Faixa recomendada de partida:** 700 ms de linha de base, ajustável pelo usuário entre 300 e 2000 ms. Sempre exponha o controle — a variação entre pessoas com ELA é enorme, e nenhum valor padrão serve para todo mundo.

**Feedback visual do progresso.** Anel circular preenchendo ao redor da tecla, com o próprio alvo aumentando levemente. Requisitos: (a) tem que ser **linear e previsível** — o usuário precisa aprender a antecipar o momento do disparo; (b) tem que ser **visível na periferia**, porque o olhar está no centro do alvo; (c) precisa de **feedback sonoro** curto no disparo, porque a confirmação visual compete com o próximo alvo.

**Zona de descanso.** Reserve uma área grande e neutra (rodapé ou lateral) onde nada acontece. O usuário precisa de um lugar seguro para "pousar" o olhar enquanto pensa. Sem isso, ele fica preso escolhendo entre olhar para algo que vai disparar ou fechar os olhos. Essa é a mitigação mais simples e mais eficaz do Midas Touch.

**"Desfazer" sempre grande e sempre disponível.** Erro vai acontecer. O custo de desfazer é o que determina se o usuário confia no sistema.

---

## 8. Adaptações específicas para ELA

Esta seção é o que diferencia seu projeto de um demo genérico de eye tracking. A literatura clínica documenta bem os obstáculos práticos; aqui está a tradução deles em requisitos de engenharia.

### 8.1 Deficiências oculomotoras são a regra, não a exceção

Achados documentados em ELA avançada: **redução da amplitude de movimento ocular**, **perseguição e sacadas mais lentas e imprecisas**, **ptose**, **olho seco**, **diplopia**, **fotossensibilidade**, **nistagmo** e **redução de acuidade visual para perto** (relatos de 20/60 e 20/90 corrigidos).

Requisitos derivados:

| Achado clínico | Requisito de engenharia |
|---|---|
| Amplitude de olhar reduzida | Layout **configurável para usar só a região central da tela**. Não assuma que as bordas são alcançáveis. Descubra a amplitude útil na calibração e desenhe dentro dela. |
| Sacadas lentas e imprecisas | Aumentar a janela de estabilização; tolerar trajetórias de aproximação longas; nunca penalizar demora em chegar ao alvo |
| Ptose (pálpebra caída) | Limiar de EAR **por usuário**; nunca exigir piscada como comando de seleção |
| Olho seco / piscadas longas | Congelamento tolerante (até 400 ms) sem perder o estado do dwell |
| Acuidade reduzida | **Fonte mínima 32 px**, alto contraste (≥ 7:1), sem cinza sobre cinza, sem depender de cor para distinguir estados |
| Fotossensibilidade | Tema escuro por padrão, brilho controlável, nunca usar animação piscante |
| Assimetria entre os olhos | Se possível, permitir estimar o olhar de um olho só (o L2CS usa o rosto inteiro, o que na verdade **ajuda** aqui — ele não quebra se um olho estiver comprometido) |

### 8.2 Progressão da doença

ELA é progressiva. O sistema que funciona hoje pode não funcionar em seis meses.

- **Nunca acople o layout ao modelo.** O número de teclas, o tempo de dwell e o tamanho da fonte devem ser **dados de perfil**, ajustáveis sem redeploy.
- **Preveja degradação graciosa de modalidade.** Quando a precisão cair abaixo de um limiar, o sistema deve **oferecer automaticamente** um layout mais simples: de teclado completo → grade 3×3 → varredura direcional (4 direções + centro) → varredura com switch único. Um caminho de degradação planejado é o que mantém a comunicação viva quando o corpo muda.
- **A literatura recomenda intervenção precoce** — introduzir o dispositivo enquanto a fala ainda está em 100–125 palavras/minuto melhora o aprendizado e a adoção. Isso é um argumento de produto: seu sistema deve ser útil e agradável **antes** de ser indispensável, senão o usuário nunca vai aprender a usá-lo.

### 8.3 Fadiga

Fadiga ocular por uso prolongado é documentada como limitante prático de uso.

- Monitore indicadores de fadiga: aumento da dispersão em fixação, aumento da taxa de dwell abortado, aumento da taxa de desfazer, aumento da duração das piscadas.
- Reaja **automaticamente e discretamente**: aumentar o dwell, aumentar as teclas, reduzir a densidade do layout. Não avise em pop-up ("você parece cansado") — é condescendente e atrapalha.
- Ofereça **modo de pausa** acionável com um dwell longo numa área grande, que suspende toda detecção. O usuário precisa poder "desligar" e descansar sem que o sistema fique disparando.

### 8.4 Fator cuidador

Documentado: até 40% dos pacientes têm déficits cognitivos e 40–60% apresentam apatia significativa; treinamento insuficiente é causa frequente de não uso; e o prazo médio entre aquisição e entrega do dispositivo chegou a 93 dias num estudo alemão.

Requisitos:

- **Setup em menos de 2 minutos por uma pessoa não técnica.** Se exigir mexer em configuração de câmera, ninguém vai usar.
- **Diagnóstico visual na tela do cuidador**: uma barra "Qualidade do rastreio: boa / regular / ruim" com a causa em linguagem natural (*"muita luz atrás do usuário"*, *"rosto muito distante"*). Não mostre números de erro angular ao cuidador.
- **Recuperação automática.** Se o rastreio se perder, o sistema volta sozinho. Não exija reinício.
- **Modo de emergência sempre acessível**: uma frase pré-gravada ("preciso de ajuda") disparável com o gesto mais robusto possível, independente da calibração estar boa.

### 8.5 A alavanca de velocidade que não é o modelo

Quero ser direto sobre isso: **predição de palavras aumenta mais a velocidade de comunicação do que qualquer melhoria de acurácia do modelo.**

Um usuário digitando letra a letra com dwell de 700 ms atinge uns 5–8 palavras/minuto. Com predição de palavras boa (n-gramas + vocabulário pessoal + completar frase), o mesmo usuário chega a 15–20. Nenhuma otimização do L2CS-Net te dá 2× de velocidade de comunicação. A predição dá.

Priorize: **um preditor de linguagem em português com vocabulário pessoal adaptativo**, frases frequentes do usuário salvas, e complementação de frase inteira. Isso, mais o dwell dinâmico guiado pelo preditor (seção 7), é onde está o ganho real de experiência.

---

## 9. Orçamento de latência e desempenho

### 9.1 Orçamento de latência (do fóton ao pixel)

| Etapa | Alvo | Observação |
|---|---|---|
| Exposição + transferência da câmera | 33 ms | Fixo, 30 fps. Não dá para melhorar sem outra câmera |
| Transferência para o sidecar | 2–5 ms | Memória compartilhada é melhor que serializar |
| Detecção/rastreio de face | 8–15 ms | Só rastreio na maioria dos frames |
| Normalização (warp) | 1–2 ms | Barato |
| **Inferência L2CS (ResNet-50 INT8, CPU)** | **30–60 ms** | O gargalo |
| Geometria + calibração | < 1 ms | |
| WebSocket de volta ao front | 1–3 ms | Localhost |
| Filtro 1€ + máquina de estados | < 1 ms | |
| Renderização | 16 ms | Um quadro a 60 Hz |
| **Total ponta a ponta** | **~90–135 ms** | |

**Isso é aceitável?** Para dwell, sim, com folga. O dwell dura 700 ms; 120 ms de latência representa 17% dele, o que é imperceptível na prática. Para um cursor de mouse contínuo seria ruim — mais uma razão pela qual o teclado por zonas foi a escolha certa.

**O que realmente importa não é a latência média, é a variância.** 120 ms constantes são confortáveis; oscilar entre 80 e 400 ms é insuportável, porque o usuário não consegue construir um modelo mental do sistema. Meça o **percentil 95**, não a média. Prefira travar o pipeline numa taxa fixa (ex.: 15 Hz) e ter latência estável, em vez de correr o máximo possível com latência errática.

### 9.2 Estratégia de degradação sob carga

Defina explicitamente o que sacrificar quando a CPU não dá conta, em ordem:

1. Reduzir a taxa de inferência (15 Hz → 10 Hz)
2. Reduzir a resolução de captura
3. Aumentar o intervalo entre detecções completas de face
4. Aumentar o tempo de dwell (compensa a menor taxa de amostragem)
5. Reduzir o número de teclas do layout
6. Avisar o cuidador que o dispositivo está no limite

**Nunca** degrade silenciosamente até o ponto em que as seleções ficam erradas. É melhor um sistema visivelmente mais lento do que um sistema que erra sem avisar.

---

## 10. Contratos de dados (TypeScript)

Definir esses tipos cedo evita retrabalho grande. Note que **quase todo campo carrega uma medida de confiança** — isso não é excesso de zelo, é o que permite as camadas de cima tomarem decisões seguras.

```ts
/** Uma estimativa bruta produzida pelo sidecar de visão. */
export interface GazeSample {
  /** Timestamp monotônico da CAPTURA do frame, não da chegada da mensagem. */
  readonly captureTs: number;
  readonly emitTs: number;

  /** Saída direta do L2CS-Net, em radianos, no espaço normalizado. */
  readonly yaw: number;
  readonly pitch: number;

  /** Entropia do softmax de cada cabeça. Baixo = confiante. */
  readonly yawEntropy: number;
  readonly pitchEntropy: number;

  /** Pose da cabeça no referencial da câmera (radianos + milímetros). */
  readonly head: {
    yaw: number; pitch: number; roll: number;
    tx: number;  ty: number;   tz: number;
  };

  /** Caixa do rosto normalizada [0,1] — útil para o mapeamento aprendido. */
  readonly faceBox: { x: number; y: number; w: number; h: number };

  /** Razão de aspecto dos olhos, para detecção de piscada. */
  readonly ear: { left: number; right: number };

  readonly quality: TrackingQuality;
}

export type TrackingQuality =
  | { kind: 'ok'; score: number }              // score em [0,1]
  | { kind: 'blink' }
  | { kind: 'face_lost' }
  | { kind: 'low_light' }
  | { kind: 'motion_blur' }
  | { kind: 'head_out_of_range'; headYawDeg: number };

/** Ponto na tela, já calibrado e filtrado. Isto é o que a UI consome. */
export interface GazePoint {
  readonly x: number;              // px, espaço da tela
  readonly y: number;
  readonly confidence: number;     // [0,1]
  readonly state: 'fixation' | 'saccade' | 'held' | 'invalid';
  /** Raio estimado do erro em px — a UI usa para dimensionar o cursor. */
  readonly errorRadius: number;
  readonly ts: number;
}

/** Estado da interação de dwell. */
export type DwellState =
  | { kind: 'idle' }
  | { kind: 'hovering'; targetId: string; since: number }
  | { kind: 'dwelling'; targetId: string; progress: number; requiredMs: number }
  | { kind: 'confirmed'; targetId: string; at: number }
  | { kind: 'refractory'; until: number };

/** Resultado da calibração — alimenta o dimensionamento do teclado. */
export interface CalibrationResult {
  readonly model: CalibrationModel;
  readonly meanErrorDeg: number;
  readonly p95ErrorDeg: number;
  /** Região da tela onde o usuário consegue olhar de forma confiável. */
  readonly usableRegion: { x: number; y: number; w: number; h: number };
  /** Grade máxima recomendada, derivada de p95ErrorDeg. */
  readonly recommendedGrid: { cols: number; rows: number };
  readonly capturedAt: number;
}
```

**Duas observações de projeto embutidas acima:**

- `errorRadius` na `GazePoint` permite que o cursor **mostre sua própria incerteza** (um círculo que cresce quando o sistema está menos confiante). Usuários entendem isso intuitivamente e ajustam o comportamento — é honestidade de interface.
- `recommendedGrid` na `CalibrationResult` é a materialização da seção 3: o teclado é derivado da medição, automaticamente.

---

## 11. Métricas, telemetria e testes

**O erro mais comum em projetos de eye tracking é otimizar o que é fácil de medir (erro angular) em vez do que importa (o usuário consegue se comunicar).** Meça os dois.

### Métricas de sistema

| Métrica | Alvo |
|---|---|
| Erro angular médio (validação) | < 2,5° |
| Erro angular p95 | < 4° |
| Latência ponta a ponta p95 | < 150 ms |
| Taxa de rastreio perdido | < 2% do tempo de sessão |
| Deriva de calibração por hora | < 1° |
| Taxa de inferência efetiva | ≥ 12 Hz |

### Métricas de usuário (as que importam)

| Métrica | Por que |
|---|---|
| **Palavras por minuto** | A métrica final. Tudo mais é meio |
| **Taxa de seleção correta** | % de seleções não desfeitas em 3 s |
| **Taxa de dwell abortado** | Alta = teclas pequenas demais ou dwell longo demais |
| **Tempo até a primeira seleção** | Mede o custo de entrada da sessão |
| **Seleções por minuto ao longo da sessão** | A queda revela fadiga |
| **Frequência de recalibração** | Cada uma é uma interrupção da comunicação |

### Testes: o conjunto de regressão gravado

Isto é engenharia de software, e é o que vai te salvar:

> **Grave sessões de vídeo cruas com marcação de verdade conhecida** (a pessoa olhando para alvos em posições conhecidas), em condições variadas: bem iluminado, contraluz, cabeça inclinada, com óculos, ao entardecer. Guarde num conjunto versionado.
>
> **Nenhuma mudança no modelo ou no pipeline entra sem reprocessar esse conjunto e comparar as métricas.**

Sem isso, você vai fazer uma "melhoria" que ajuda no seu setup e quebra no do usuário, e vai levar semanas para descobrir. Com um usuário com ELA dependendo do sistema para se comunicar, esse ciclo de descoberta é inaceitável.

Complementos:

- **Testes unitários** do filtro 1€, da máquina de estados de dwell e do modelo de calibração — todos são funções puras e testáveis com sinais sintéticos.
- **Teste de fuzzing do dwell**: injete trajetórias de olhar sintéticas ruidosas e verifique que nenhuma sequência dispara seleções não intencionais.
- **Teste de fumaça de latência** em CI: falha se o p95 regredir mais de 15%.

---

## 12. Riscos e mitigações

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Acurácia insuficiente para um teclado útil | **Alta** | Alto | Layout hierárquico + predição de palavras. Dimensione o teclado a partir da calibração medida, não da estética. Fine-tuning com dados próprios |
| Modelo Gaze360 usado por engano (erro de 10°) | Média | Alto | Fixar o checkpoint MPIIFaceGaze/afinado no código. Teste automatizado que verifica o erro de validação no boot |
| Latência instável em máquinas fracas | Alta | Médio | Taxa de inferência fixa + descarte de frames + degradação planejada (9.2) |
| Deriva de calibração ao longo do dia | **Alta** | Alto | Recalibração implícita (6.2) + recalibração rápida de 3 pontos |
| Ptose quebra a detecção de piscada | Média | Alto | Limiar de EAR por usuário, calibrado. Nunca usar piscada como comando |
| Midas Touch (seleções não intencionais) | **Alta** | Alto | Zona de descanso + I-DT (não acumular em sacada) + histerese + desfazer proeminente |
| Progressão da doença invalida o setup | Certa | Alto | Layouts como dados de perfil + caminho de degradação de modalidade planejado (8.2) |
| Iluminação variável destrói a estimativa | Alta | Médio | Travar exposição + orientação física ao cuidador + dado de treino aumentado com variação fotométrica |
| Empacotamento do sidecar Python fica pesado | Média | Baixo | Aceitável na fase 1. Migrar para Rust se virar problema real |
| Abandono do dispositivo por fricção de uso | Média | **Crítico** | Setup < 2 min, perfis persistentes, recuperação automática, modo emergência |

---

## 13. Roadmap em fases

### Fase 0 — Instrumentação (1–2 semanas)
Antes de otimizar qualquer coisa, construa a régua.
Gravador de sessões · reprodutor offline do pipeline · painel de métricas · conjunto de regressão inicial com 5–10 gravações.
**Critério de saída:** você consegue rodar o pipeline inteiro sobre um vídeo gravado e obter um número de erro.

### Fase 1 — Caminho completo, sem otimizar (3–4 semanas)
Sidecar Python com o modelo original (mesmo lento) · normalização geométrica correta · calibração de 9 pontos com regressão polinomial · filtro 1€ · máquina de estados de dwell · teclado de 12 teclas.
**Critério de saída:** uma pessoa sem deficiência consegue digitar uma frase. Meça o erro real.

### Fase 2 — Precisão (4–6 semanas)
Fine-tuning com re-binning para ±30° · dados coletados no setup real · recalibração implícita · classificador de fixação/sacada · portão de confiança completo.
**Critério de saída:** erro p95 abaixo de 4°, deriva abaixo de 1°/hora.

### Fase 3 — Experiência assistiva (4–6 semanas)
Dwell dinâmico · predição de palavras em português · perfis persistentes · painel do cuidador · caminho de degradação de layout · modo emergência · TTS.
**Critério de saída:** teste com um usuário real com ELA, sessão de 30 min sem intervenção técnica.

### Fase 4 — Desempenho (3–4 semanas)
Quantização INT8 · destilação para espinha dorsal leve · possível migração do sidecar para Rust · empacotamento e instalador.
**Critério de saída:** roda confortavelmente num notebook de entrada.

> **Note a ordem.** Desempenho é a **última** fase, não a primeira. É contraintuitivo, mas 15 Hz com erro de 2° é infinitamente mais útil que 60 Hz com erro de 6°. Otimize acurácia e experiência primeiro; velocidade só quando o resto estiver provado.

---

## 14. Fontes

**Modelo e visão computacional**

- [L2CS-Net: Fine-Grained Gaze Estimation in Unconstrained Environments (arXiv:2203.03339)](https://arxiv.org/pdf/2203.03339)
- [L2CS-Net — implementação oficial em PyTorch (GitHub)](https://github.com/Ahmednull/L2CS-Net)
- [L2CS-Net — pipeline.py (pré-processamento e decodificação de bins)](https://github.com/Ahmednull/L2CS-Net/blob/main/l2cs/pipeline.py)
- [Offset Calibration for Appearance-Based Gaze Estimation via Gaze Decomposition (WACV 2020)](https://openaccess.thecvf.com/content_WACV_2020/papers/Chen_Offset_Calibration_for_Appearance-Based_Gaze_Estimation_via_Gaze_Decomposition_WACV_2020_paper.pdf)
- [Webcam-based gaze estimation for computer screen interaction (Frontiers in Robotics and AI, 2024)](https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2024.1369566/full)
- [Filtro 1€ — implementações de referência (Casiez et al.)](https://github.com/casiez/OneEuroFilter)
- [Noise Filtering Using 1€ Filter — explicação didática](https://jaantollander.com/post/noise-filtering-using-one-euro-filter/)

**Interação por dwell**

- [The effects of dynamic dwell time systems on the usability of eye-tracking technology: a systematic review and meta-analyses (Human–Computer Interaction, 2025)](https://www.tandfonline.com/doi/full/10.1080/07370024.2025.2497236)
- [A Multimodal Interface to Resolve the Midas-Touch Problem in Gaze Controlled Wheelchair (EMBC 2017)](https://pure.ulster.ac.uk/files/11614091/meena_embc17.pdf)

**ELA e comunicação assistiva**

- [Communication Matters — Pitfalls and Promise of Hightech Communication Devices in Palliative Care of Severely Physically Disabled Patients With ALS (Frontiers in Neurology, 2018)](https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2018.00603/full)
- [SSVEP BCI and Eye Tracking Use by Individuals With Late-Stage ALS and Visual Impairments (Frontiers in Human Neuroscience, 2020)](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2020.595890/full)
- [The eye-tracking computer device for communication in amyotrophic lateral sclerosis (Acta Neurologica Scandinavica, 2014)](https://pubmed.ncbi.nlm.nih.gov/24350578/)

**Infraestrutura**

- [ONNX Runtime — inferência e otimização](https://onnxruntime.ai/docs/tutorials/accelerate-pytorch/resnet-inferencing.html)
- [onnxruntime-web (npm)](https://www.npmjs.com/package/onnxruntime-web)