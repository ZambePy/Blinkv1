# Resultados — Semana de Precisão (D2 → D8)

Documento de consolidação da semana. Um único lugar para responder:

- O que foi ligado, e por quê?
- O que ficou desligado, e por quê?
- O que virou infraestrutura mas ainda precisa de dado humano para decidir?

Data: **2026-08-25**. Baseline referência: **57 px / 0,9°** (Rodada A, sem
óculos, cabeça parada — commit `f9d9252`, documentado em
`docs/PONTO-DE-REFERENCIA.md`).

---

> ## ⚠️ LEIA ANTES DE USAR QUALQUER NÚMERO DESTE DOCUMENTO
>
> **Tudo abaixo desta caixa descreve o vetor de features de 44 dims.**
>
> O commit `c3ade68` reduziu o vetor para 12 dims (`ACTIVE_FEATURE_SET = 'iris12'`).
> Os relatórios que embasaram as decisões desta semana — `ci-baseline-a2.report.json`
> e `ci-baseline-ablation.report.json` — foram gerados em **2026-08-26 às 14:38**,
> horas antes daquele commit, e com `featuresSource: "recorded"`: usaram as features
> gravadas no JSONL, que naquele momento eram as de 44 dims.
>
> Nada acusou a mudança. O replay seguia rodando e produzindo números como se o
> pipeline não tivesse mudado, porque o default era usar as features gravadas e não
> havia nenhuma verificação de compatibilidade.
>
> **Decisões que NÃO valem para a configuração atual:**
>
> | Decisão | Onde | Por que não vale |
> |---|---|---|
> | D3.2 — manter `expandFactor` em 1,4 | §Decisões | Varreu o parâmetro do crop do L2CS, cujo bloco angular nem entra mais no vetor ativo |
> | D4 — não remover nenhum grupo de features | §Decisões | A ablação media grupos (pose-linear, pose-cross, quadratic, l2cs) que `iris12` **já removeu** |
> | A2-5 — `isotropicLandmarks` OFF | §Flags | Medido sobre 44 dims; o efeito no vetor reduzido é desconhecido |
>
> Nenhuma dessas decisões foi *revertida* — elas apenas deixaram de ter medição que
> as sustente. Refazer a medição é o item que as reabilita.
>
> A partir de 0.1, três coisas impedem que isto se repita:
> `FEATURE_VECTOR_ID` no cabeçalho do JSONL, o replay abortando em incompatibilidade,
> e `recomputeFeatures` como padrão.

---

## 2.1 — o FOV não sai sozinho, e o sinal da íris é atenuado 6× no eixo vertical

Duas metades: uma corrigida, uma bloqueada com prova.

### A metade corrigida — a distância de calibração

A UI congelava a distância chamando `getCurrentCameraDistanceCm()` no instante
em que a calibração começa: **um quadro**, ainda na janela de preparo, antes de
qualquer alvo. Esse número vira a referência de toda a compensação de distância
da sessão.

| | valor |
|---|---|
| ruído quadro a quadro no preparo (σ) | 0,13 cm |
| erro típico de um quadro vs. a mediana dos aceitos | 0,11 cm |
| pior caso | 0,51 cm (1,1%) |

Na gravação de referência o custo é pequeno — mas é pequeno porque o usuário
ficou parado, e nada no código garantia isso. Agora a referência é a **mediana
sobre os quadros aceitos**, uma entrada por amostra (pontos com mais amostras
pesam mais), substituída em `completeCalibration` e só quando há medição: sem
FOV calibrado o valor configurado pelo cuidador continua sendo o melhor
disponível.

### A metade bloqueada — o FOV automático é impossível, e a prova é de uma linha

`estimateDistanceCm` prometia que "a Etapa 1 vai obtê-lo do sistema". Não vai:

    tamanho_px / largura_px = tamanho_cm / (2 · D · tan(FOV/2))

Uma equação, **duas incógnitas** (`D` e `FOV`). Nenhuma quantidade de quadros
resolve — todos trazem a mesma equação. E o browser não expõe o FOV, nem em
`getCapabilities()` nem em `getSettings()`.

O que funciona já existe: `deriveHorizontalFovDeg`, que fecha o sistema com uma
única medida de fita métrica, feita uma vez por hardware.

### A segunda equação que fecharia o sistema — e por que não fecha

A calibração conhece a tela: quando o usuário olha do alvo esquerdo para o
direito, o olho gira um ângulo determinado pela geometria, e a íris se desloca
`2R·sen θ` com `R ≈ 12 mm`. Medindo esse deslocamento em unidades da distância
cantal, `D` e `FOV` cancelam — e sobra uma equação independente.

Medido na gravação de referência (excursão da íris entre as colunas/linhas
extremas de alvos, em px de vídeo, IOD cantal 127,2 px):

| eixo | previsto a 60 cm | medido | atenuação | distância implícita |
|---|---|---|---|---|
| horizontal | 9,41 px | **5,66 px** | **0,60×** | 102 cm |
| vertical | 7,30 px | **1,20 px** | **0,16×** | 373 cm |

As duas estimativas discordam por **3,7×**. A rota está invalidada: o sinal da
íris não é a projeção geométrica pura que a dedução assume.

### Por que o eixo vertical perde 84% do sinal — a pálpebra

Da linha de cima para a de baixo da tela:

| medida | deslocamento |
|---|---|
| íris | +1,20 px |
| **pálpebra superior** | **+2,66 px** |
| abertura do olho | −3,03 px (13,21 → 10,18, **−23%**) |

A pálpebra desce **mais que o dobro** do que a íris, e a abertura encolhe 23%. A
íris fica progressivamente ocluída em cima e embaixo, e o centro estimado pelo
MediaPipe é arrastado pelo padrão de oclusão em vez de acompanhar o olho.

**Isto é um teto de precisão no eixo Y que nenhuma regressão remove.** O sinal
já chega atenuado 6× ao vetor de features; o modelo não pode recuperar o que o
landmark não carrega. Explica por que Y é sistematicamente o eixo pior, e é
candidato mais forte que qualquer coisa da Fase 1 para o gargalo real.

O eixo horizontal também perde 40%, mas 0,60× é uma escala aproximadamente
constante — algo que um modelo linear absorve no coeficiente. Uma atenuação de
0,16× que varia com a oclusão, não.

---

## 2.2 — o detector de piscada: estado global removido, e dois pontos cegos medidos

### O que foi corrigido

`extractFeatures` mutava um singleton de módulo (`_blinkDetector`). Como o limiar
de piscada é adaptativo — aprende o EAR de repouso dos quadros anteriores — a
função não era pura: o mesmo quadro podia sair `blinkDetected` true ou false
conforme o que tinha sido extraído antes no mesmo processo.

Isso importa porque o replay descarta quadro com piscada. Duas variantes que
filtram diferente alimentariam o detector com populações diferentes, o limiar
divergiria, e o conjunto de quadros medido mudaria por um motivo alheio ao que
se está medindo.

Agora o detector é injetável, o harness cria um por execução, e o app segue no
singleton. Baseline inalterado (**144,6 px**), como uma refatoração de pureza tem
que ser.

### Ponto cego 1 — o limiar "adaptativo" nunca adapta

| medida na gravação | valor |
|---|---|
| EAR de repouso (mediana) | **0,551** |
| `blinkRatio × repouso` | 0,44 |
| `thrMax` (clamp) | **0,22** |

0,44 está muito acima do clamp, então o limiar é **sempre 0,22**. Para adaptar
de fato, o repouso teria que cair em [0,125, 0,275]. O detector é, na prática,
um limiar fixo — e todo o mecanismo adaptativo é código morto para este usuário.

### Ponto cego 2 — repouso abaixo de `thrMax` trava o detector para sempre

O histórico só cresce com quadros de NÃO-piscada. Se o repouso do usuário já
está abaixo de 0,22, **todo** quadro é piscada, nada entra no histórico, o limiar
nunca sai do default, e o estado é absorvente.

O comentário do módulo diz que `thrMax` existe "para não confundir olho
semi-fechado (ptose) com piscada". É exatamente o usuário com ptose que cai
neste buraco — e o público-alvo tem ELA, onde ptose é comum.

### A causa raiz dos dois: o EAR está na escala errada

Os landmarks do MediaPipe têm x normalizado pela LARGURA e y pela ALTURA. Num
vídeo 16:9 uma distância vertical vale 1,78× o que deveria, e o EAR — que é
vertical sobre horizontal — sai inflado pelo mesmo fator.

| EAR | mediana | p10 | mínimo |
|---|---|---|---|
| anisotrópico (o que o código vê) | **0,551** | 0,491 | 0,090 |
| isotrópico (pixels reais) | **0,314** | 0,280 | 0,065 |

Razão medida: **1,754**, contra 1,778 do 16:9.

0,314 é exatamente o EAR de olho aberto de manual, e os limiares 0,10/0,22
foram claramente escolhidos para essa escala. Alimentados com a escala
anisotrópica, `thrMax = 0,22` equivale a um EAR real de **0,124** — olho quase
fechado. Consequência: **0,16% dos quadros são classificados como piscada, onde
a escala correta daria 0,48%** — 3× menos.

Não é um quadro perdido aqui ou ali: piscada parcial e olho semicerrado entram
no regressor como fixação válida, que é precisamente o modo de falha descrito no
comentário de A2-4 como "indefensável".

**Corrigir a escala é mudança de pipeline e precisa da sua própria medição
antes/depois — fica como item próprio, não entra de carona nesta refatoração.**

---

## 2.3 — os três ângulos de Euler do fallback estavam trocados entre si

Quando não há `facialTransformationMatrixes`, o extractor deriva a pose dos
próprios landmarks. As três linhas eram:

| escrito | é de fato |
|---|---|
| `yaw = atan2(xAxis.y, xAxis.x)` | **roll** |
| `pitch = atan2(−xAxis.z, hypot(yAxis.z, zAxis.z))` | **yaw** |
| `roll = atan2(yAxis.z, zAxis.z)` | **pitch** |

Permutação cíclica. `xAxis` é a linha entre os cantos externos dos olhos: o
ângulo dela no plano da imagem é a inclinação da cabeça (roll), e o componente
z dela cresce quando a cabeça vira (yaw). Quem mede pitch é o eixo vertical
inclinando para perto ou longe da câmera.

### A causa: troca de frame, não três erros independentes

Os landmarks vêm em coordenadas de **imagem** (x direita, y para BAIXO, z
negativo em direção à câmera). A matriz facial vem em coordenadas **métricas**
(y para CIMA, z na direção do observador). Entre os dois há uma rotação de 180°
em torno de X:

    F = diag(1, −1, −1)        R_métrico = F · R_imagem

O fallback extraía Euler das coordenadas de imagem como se já fossem métricas.
Aplicando F — negar as linhas y e z de `R = [xAxis | yAxis | zAxis]` — valem as
MESMAS fórmulas do caminho da matriz, e os dois passam a concordar:

    pitch = asin(zAxis.y)      yaw = atan2(zAxis.x, −zAxis.z)
    roll  = atan2(−xAxis.y, −yAxis.y)

O teste exige concordância entre os dois caminhos em quatro rotações conhecidas
(yaw ±12°, roll 10°, pitch 8°) e que a cabeça de frente devolva zero nos três
eixos — o que a versão antiga não fazia: dava 3,4° de pitch com a cabeça reta.

### Alcance real: bug latente, não ativo

| | |
|---|---|
| `outputFacialTransformationMatrixes` | ligado em `engine.ts` |
| quadros da gravação com matriz válida | **3147 / 3147 (100%)** |
| quadros que caem no fallback | **0** |

Baseline inalterado: **144,6 px**. O fallback só rodaria se o MediaPipe deixasse
de entregar a matriz — e aí em silêncio, com a pose girada de eixo, alimentando
o gate de pose, a telemetria e as compensações de 1.3/1.4 com os eixos trocados.

Vale registrar que a versão antiga não era detectável pelos testes existentes
justamente porque nunca roda: nenhum caminho de produção a exercita. Foi
preciso construir rotações sintéticas com frame explícito para vê-la.

---

## 2.4 — qualidade fabricada: o gate inteiro nunca dispara, e a falha era invisível

### O gate não rejeita nada — medido

| critério | limiar | medido (min..max) | folga |
|---|---|---|---|
| `irisVisibility < 0,3` | 0,30 | 0,900 .. 1,000 | 3,0× |
| `detectorConfidence < 0,4` | 0,40 | 0,909 .. 1,000 | 2,3× |
| `brightness < 0,08` | 0,08 | 0,199 .. 0,260 | 2,5× |
| `brightness > 0,92` | 0,92 | máx. 0,260 | 3,5× |
| `contrast < 0,02` | 0,02 | 0,079 .. 0,106 | 4,0× |
| `blur > 0,85` | 0,85 | **sempre 0,000** | — |

As decisões gravadas confirmam: **514 aceitos, 103 rejeitados por acomodação,
zero por qualidade.** O gate só pega falha catastrófica — câmera tapada, escuro
total. Não é necessariamente errado (rejeitar quadro bom custa caro), mas o
comentário dizia que os limiares seriam "refinados com base nos valores
observados durante a coleta de baseline". A coleta aconteceu: são estes os
valores, e agora estão no código em vez de na intenção.

Apertá-los é mudança de pipeline e precisa de medição própria — não entrou aqui.

### O defeito de verdade: constantes que se passam por medição

O extractor preenchia a qualidade com constantes:

```
detectorConfidence: 1.0    brightnessEstimate: 0.5
contrastEstimate:   0.5    blurEstimate:       0.0
```

O `EyeQualityAnalyzer` deveria sobrescrevê-las com medida real, e no caminho
feliz sobrescreve. Mas ele tem três saídas, e duas fabricavam também:

| saída | devolvia | consequência |
|---|---|---|
| canvas sem contexto 2d | `confidence 1.0, brightness 0.5, contrast 0.5, blur 0.0` | passa nos **seis** critérios |
| crop degenerado (N=0) | `brightness 0.5, contrast 0.0, blur 0.5` | `contrast 0.0` reprova — acidentalmente correto |
| canvas tainted (`catch`) | só `{detectorConfidence}` | **correto** — omite o que não mediu |

Quando o analisador falhava, as constantes sobreviviam ao spread em `engine.ts`
e chegavam ao gate **indistinguíveis de medição**. E não são valores neutros:
`detectorConfidence: 1.0` afirma confiança máxima exatamente onde nada foi
medido.

O terceiro caso já fazia o certo. Os outros dois passaram a fazer igual, e os
campos de `QualityFeatures` viraram opcionais — ausente significa não medido.

### A segunda metade: o gate tratava ausência como aprovação

`quality.irisVisibilityPercentage < 0.3` e `quality.detectorConfidence < 0.4`
eram comparados sem guarda de tipo. `undefined < 0.3` é `false`, e `NaN < 0.3`
também — os dois passavam em silêncio. Agora cada critério só vale se o valor
foi medido, e a ausência gera **um** aviso por sessão nomeando o que faltou.

A escolha é aceitar o quadro quando a medida falta, não rejeitar: um browser com
canvas tainted deixaria o app inutilizável, e o público-alvo não tem como
contornar. Mas a degradação passa a ser visível em vez de silenciosa.

Baseline inalterado: **144,6 px** — como tem que ser, já que nenhum critério
disparava antes nem depois nesta gravação.

---

## 2.5 — o L2CS custava 91 MB para produzir uma constante que ninguém lia

### Nunca chegou ao modelo

O bloco angular do L2CS ocupa os índices **[37..43]** do vetor completo.
`ACTIVE_FEATURE_SET = 'iris12'` seleciona **[0..11]**. A saída é descartada
antes de qualquer regressão.

Enquanto isso o caminho custa, por sessão: **91 MB** de download do modelo ONNX,
um `getImageData` de 448² a 10 Hz, e uma consulta ao worker por quadro.

### E o que produzia era uma constante

Medido em `fixtures/replay/ci-baseline.jsonl`:

| | |
|---|---|
| quadros com bloco `l2cs` | 3147 |
| marcados **`valid`** | **1563** |
| valores distintos de yaw | **1** |
| o valor | **−1,4315 rad = −82,0°** |

É a assinatura do crop preto — o bug de `sourceDimensions` (desde corrigido):
o modelo inferia sobre imagem vazia e devolvia sempre a mesma resposta.

`isGazePlausible` (±0,61 rad) zerava o bloco, então o vetor de features não foi
contaminado. Mas o contador `l2csFramesValid` seguia subindo, a UI seguia
dizendo "pronto", e o diagnóstico seguia mostrando −82°. **A falha era invisível
no nível do sistema.**

### O guarda que faltava

`isGazePlausible` pega ângulo fora da faixa fisiológica. Não pega o modo de
falha que ocorreu de verdade — e não pegaria se a imagem preta tivesse produzido
0,3 rad em vez de −1,43, o que é sorte, não projeto.

`L2CSHealthMonitor` acusa saída idêntica bit a bit por dezenas de quadros
(~6 s a 10 Hz). Micro-sacadas e ruído do modelo garantem variação num olho
humano; constância exata é hardware ou pipeline quebrado, nunca fisiologia. Ao
acusar, o status vira `error` e o console explica o quê.

### Desligado, não removido

`EXPERIMENT.enableL2CS` nasce `false`. Não é remoção porque o L2CS **nunca foi
avaliado funcionando** — todas as medições anteriores foram feitas com o crop
preto. Ligar a flag junto com um `--feature-set` que inclua o bloco é como essa
avaliação vai ser feita.

Baseline inalterado: **144,6 px** — o replay já não usava o bloco.

### Um bug que a mudança quase criou

`l2csReady = l2csStatus === 'ready'` é o booleano que **destrava o botão de
começar a calibração**. Com o caminho desligado o status vira `'disabled'`, e
sem tratar isso o usuário ficaria preso na tela de pré-calibração para sempre,
esperando um modelo que ninguém pediu para carregar. `'disabled'` agora libera
tanto quanto `'ready'`.

---

## 3.1 — o posto efetivo é 2,2, e a redundância NÃO é o problema

### O espectro

Autovalores da matriz de correlação das features de calibração (Jacobi, 12x12):

| | `iris12` (12 dims) | `iris12+pose` (15) |
|---|---|---|
| posto efetivo (razão de participação) | **2,20** | 2,84 |
| autovalores > 1% do maior | 4 | 5 |
| componentes para 99% da variância | 4 | 5 |
| número de condição | 3,58 x 10^5 | 6,86 x 10^5 |

Autovalores do `iris12`: 6,42 · 4,89 · 0,51 · 0,16 · 0,010 · 0,002 · ...

Doze dimensões carregam ~2,2 dimensões de informação. Faz sentido pela
construção: `relX = offsetX / largura` com largura quase constante é múltiplo
escalar de `offsetX`; e os quatro pontos do contorno da íris transladam juntos,
duplicando o offset.

### A hipótese era que isso desperdiçava capacidade. É falso.

Projetando nas k primeiras componentes principais:

| variante | lambda | treino | LOO/alvo | accuracy | delta |
|---|---|---|---|---|---|
| `iris12` completo | 0,01 | 41,1 | 96,9 | **144,6** | — |
| PCA k=2 | 0,1 | 257,4 | 379,6 | 262,9 | **+81,7%** |
| PCA k=3 | 0,215 | 149,5 | 297,7 | 190,8 | +31,9% |
| PCA k=4 | 0,0215 | 69,7 | 123,7 | 181,8 | +25,7% |
| PCA k=6 | 0,0001 | 50,6 | 93,5 | 151,7 | +4,9% |
| PCA k=8 | 0,0001 | 48,6 | 107,1 | 148,2 | +2,4% |
| PCA k=12 (rotação pura) | 0,0001 | 35,9 | 93,1 | 132,8 | −8,2% |

**Truncar piora em todo k.** Mesmo k=6, que captura mais de 99,9% da variância,
custa 4,9%.

A razão é que PCA ordena por VARIÂNCIA, não por relevância ao alvo — e aqui o
sinal de olhar mora nas direções de baixa variância. É coerente com o orçamento
de pixels já conhecido: a íris percorre ~5,7 px de vídeo entre as colunas
extremas de alvos, enquanto pose, escala e ruído produzem variação muito maior.
**Descartar variância pequena descarta exatamente o sinal.**

### Os −8,2% de k=12 eram o lambda, não a rotação

Com lambda fixo nos dois lados:

| | lambda = 0,0001 | lambda = 0,01 |
|---|---|---|
| features cruas | 134,5 px | 146,7 px |
| PCA k=12 | 132,7 px | 132,8 px |

A rotação vale 1,8 px. O resto era o CV ter escolhido lambda diferente para cada
uma. E isso levantou a pergunta que rendeu.

### O achado que rendeu: o lambda era escolhido em fração de tela

A varredura de lambda nas features cruas é **monótona**:

| lambda | 0,0001 | 0,001 | 0,00464 | **0,01** | 0,1 | 1 |
|---|---|---|---|---|---|---|
| accuracy | 134,5 | 139,3 | 143,2 | **146,7** | 158,2 | 187,7 |
| LOO/alvo | 85,8 | **81,4** | 84,3 | 89,0 | 120,0 | 218,7 |

O CV escolhia 0,01 — pior que 0,001 no próprio critério LOO por alvo, que é o
que ele deveria estar otimizando.

A causa é uma conflação de unidades, a mesma família de um erro que já apareceu
antes neste projeto: `selectLambdaCV` somava `dx^2 + dy^2` com `screenX/screenY`
em **fração de tela**. Fração de tela não é uma grandeza única — numa tela 16:9
uma unidade de x vale 1920 px e uma de y vale 1080. O erro em X entrava
ponderado por (1080/1920)^2 = 0,32 do que vale para o usuário.

### Resultado

| variante | lambda | treino | LOO/alvo | accuracy | mediana | p90 |
|---|---|---|---|---|---|---|
| CV em fração de tela (antes) | 0,01 | 41,1 | 96,9 | **144,6** | 71,3 | 410,1 |
| **CV em pixels (novo default)** | 0,00464 | 38,3 | **92,5** | **140,7** | **67,0** | 415,3 |

**−2,7%.** Modesto, mas melhora nos DOIS critérios — e o LOO por alvo é
independente do teste de precisão, então não é ajuste na base de avaliação. É
correção de unidade, não sintonia.

### O que eu afirmei e a medição derrubou

Propus que o CV super-regularizava por ser dominado pelo eixo Y, que tem sinal
6x atenuado (2.1). **Não se sustenta.** Uma varredura em dados sintéticos com
ruído assimétrico mostra a ponderação escolhendo lambda **maior**, não menor: a
direção depende de qual eixo é mais difícil no conjunto. O que está estabelecido
é que a unidade estava errada e que corrigi-la melhora esta gravação nos dois
critérios. O porquê da direção, não.

Pelo mesmo motivo, lambda = 0,0001 — que mede melhor de todos — **não** foi
adotado: escolhê-lo pelo teste de precisão seria ajustar na base de avaliação, o
erro que 1.2 documentou.

---

## 1.4 — translação lateral: o FOV cancela, e o efeito está abaixo do ruído

`src/translationCompensation.ts` corrige a cabeça que DESLIZA, efeito
independente da que gira (1.3). Se o olho passa de `e₀` para `e₀ + t` e o usuário
olha para o mesmo ponto, o modelo — ajustado em `e₀` — prevê `S − t`. A correção
é somar `t`, **exatamente `t`**, sem escalar por distância: tela e olho transladam
no mesmo plano, então mover o olho 1 cm move o ponto olhado 1 cm.

### O campo de visão cancela — a tarefa não precisa dele

A tarefa foi descrita como "usar `latestFaceCenter` + o FOV calibrado". O FOV não
é necessário. Com `D` a distância câmera→rosto e `tanH = tan(FOV_h/2)`:

    X_cm = 2 · Δx_norm · D · tanH          (deslocamento do nariz)
    IOD_cm = 2 · iod_norm · D · tanH       (a mesma relação, para os olhos)

Dividindo, `D` e `tanH` somem dos dois lados:

    X_cm = IOD_cm · Δx_norm · larguraVideo / iod_px

Medir o deslocamento do nariz **em unidades da distância interocular** e
multiplicar pela distância interocular física. Sobra uma única suposição — a
distância cantal de 9,0 cm — e ela é muito menos incerta que o FOV, que é justamente o parâmetro
duvidoso do setup (a webcam declara 90°, número que fabricantes costumam dar na
diagonal e inflar).

Isso importa além de 1.4: qualquer correção que dependesse do FOV herdaria essa
incerteza. Esta não depende.

### Quanto a cabeça de fato translada

| janela | amplitude X | amplitude Y | p90 do desvio |
|---|---|---|---|
| calibração (514 frames) | 0,70 cm | 0,76 cm | 0,33 / 0,38 cm |
| teste de precisão (455 frames) | **0,36 cm** | **0,21 cm** | 0,14 / 0,09 cm |

A 36,8 px/cm, os 0,36 cm do teste inteiro são **13 px** de tela, contra 144,6 px
de erro. Coerente com 1.1: a cabeça do usuário-alvo fica parada.

### Tabela — mesma gravação, mesmo filtro

| variante | meanErrorInner | mediana | p90 | Δ |
|---|---|---|---|---|
| sem compensação | 144,6 px | 71,3 | 410,1 | — |
| **1.4 translação lateral** | **136,5 px** | 61,0 | — | **−5,6%** |
| 1.3 + 1.4 juntas | 161,7 px | 91,4 | 431,6 | +11,8% |

Reproduzível com `npm run replay -- --translation-compensation`.

### O mesmo controle de 1.3, e o mesmo veredito

A correção aplicada tem média (−6,4, −19,9) px e amplitude (13,7, 8,2) px. A
média domina a variação, o que já sugere deslocamento fixo com outro nome:

| variante | meanErrorInner | mediana | Δ |
|---|---|---|---|
| sem nada | 144,6 px | 71,3 | — |
| 1.4 translação lateral (usa o rosto) | 136,5 px | 61,0 | −5,6% |
| **CONTROLE: deslocamento fixo (−6,4, −19,9) px** | **137,1 px** | 61,9 | **−5,2%** |

Dos 8,1 px de ganho, **7,5 px são remoção de viés** que um deslocamento fixo
reproduz sem olhar o rosto. Sobram ~0,6 px vindos de rastrear a translação de
verdade — dentro do ruído, e coerente com os 13 px de amplitude física medidos.

Diferente de 1.3, 1.4 não piora. Mas também não está validada: a gravação não
tem translação suficiente para testá-la.

`lateralTranslationCompensation` fica **desligada**, com o módulo implementado,
testado (13 testes) e ligado em `mapGaze` e no harness.

### Ligar 1.3 e 1.4 juntas é pior que qualquer uma sozinha

+11,8%, contra +5,6% de 1.3 sozinha. As duas correções apontam para o mesmo
viés sistemático e o corrigem duas vezes. É mais um indício de que ambas estão
medindo o viés, não o efeito que modelam.

### Pista sobre a distância assumida, que 2.1 tem que resolver

A estimativa de distância câmera→rosto na gravação dá **45,3 cm**, não os 60 cm
que `ASSUMED_DIST_PX = 2268` embute. O ganho geométrico de 1.3 seria então
29 px/grau em vez de 39,6 — na direção do fator ~0,5 que a varredura de 1.3
achou como ótimo em Y (16–24 px/grau), mas **acima** dele: a distância explica
parte do excesso, não todo.

E a estimativa depende do FOV de 90° declarado pelo fabricante; com 60° reais
ela viraria ~68 cm, invertendo a conclusão. **Não é conclusão, é a razão pela
qual calibrar o FOV virou pré-requisito** — ver 2.1, onde essa tentativa foi
feita e o que a bloqueou está medido.

---

## 1.3 — a compensação geométrica está implementada, e esta gravação não consegue testá-la

`src/poseCompensation.ts` aplica `d · tan(Δ)` na saída, contra a pose média das
amostras que treinaram o modelo. Sem coeficiente ajustado — era esse o ponto,
depois de 1.2 mostrar que ajustar um coeficiente de pose produz memorização.

Os sinais **não** foram escolhidos por medirem melhor. Vêm da convenção com que
`extractor.ts` extrai os ângulos: a coluna 2 da matriz facial é a direção do
nariz `f`, com `yaw = atan2(f_x, f_z)` e `pitch = asin(−f_y)`. Virar a cabeça
para a própria esquerda dá yaw maior e X de tela menor (sinal negativo em X);
nariz para baixo dá pitch maior e Y de tela maior (sinal positivo em Y).

### Tabela — mesma gravação, mesmo filtro

| variante | meanErrorInner | mediana | p90 | Δ vs baseline |
|---|---|---|---|---|
| sem compensação | **144,6 px** | 71,3 | 410,1 | — |
| geometria pura (ganho 1,0) | **152,8 px** | 80,8 | 427,8 | **+5,6%** |
| só em X (yaw), ganho 1,0 | 147,2 px | — | — | +1,8% |
| só em Y (pitch), ganho 1,0 | 148,8 px | — | — | +2,9% |

A geometria pura piora. Reproduzível com `npm run replay -- --pose-compensation`.

### Varredura de ganho — e por que o ótimo não pode ser embarcado

| ganho | só X (yaw) | só Y (pitch) |
|---|---|---|
| 0,2 | 144,4 (−0,1%) | 138,0 (−4,6%) |
| 0,4 | 144,6 (−0,0%) | **134,6 (−6,9%)** |
| 0,6 | 145,1 (+0,3%) | 135,2 (−6,5%) |
| 0,8 | 146,0 (+0,9%) | 140,1 (−3,1%) |
| 1,0 | 147,2 (+1,8%) | 148,8 (+2,9%) |

Os dois eixos discordam: X não ganha nada em ganho nenhum, Y tem ótimo em ~0,4.
Isso **refuta** a explicação mais natural para o excesso — um erro de escala nos
ângulos de pose (por exemplo, intrínsecos de câmera errados no MediaPipe, com a
webcam de 90° de FOV) afetaria os dois eixos pelo mesmo fator.

Escolher 0,4 pela medição seria ajustar um parâmetro livre na própria gravação
em que se está avaliando — o erro que 1.2 documentou. Não entra no produto.

### O controle que fecha a questão

Se a pose é quase constante durante o teste, `d · tan(Δ)` degenera em um
deslocamento FIXO, e qualquer ganho seria remoção de viés disfarçada de
geometria. O desvio médio de pose no teste é yaw +0,76° e pitch −2,43° — de
fato quase constante. Então:

| variante | meanErrorInner | Δ |
|---|---|---|
| sem nada | 144,6 px | — |
| compensação geométrica, só Y, ganho 0,4 | 134,6 px | −6,9% |
| **CONTROLE: deslocamento fixo (0, −36) px, sem pose** | **133,4 px** | **−7,8%** |

Um deslocamento constante, **sem usar pose nenhuma**, é melhor que a
compensação ajustada. A pose não contribuiu com nada.

### Conclusão

**Esta gravação não consegue testar compensação de pose.** Não porque a
compensação seja errada, mas porque a gravação não tem o sinal necessário: a
pose durante o teste de precisão é essencialmente um deslocamento fixo em
relação à calibração, não uma variável. Testar de verdade exige uma gravação com
movimento de cabeça deliberado DURANTE o teste.

`geometricPoseCompensation` fica **desligada** por default, com o módulo
implementado, testado (14 testes) e ligado tanto em `mapGaze` quanto no harness,
para que essa gravação possa ser feita e medida sem reescrever nada.

### Achado colateral que merece investigação própria

O viés vertical de **+36 px** entre calibração e teste de precisão é real e
constante. Ele responde por quase todo o ganho do controle. Não foi corrigido
com uma constante mágica — de onde ele vem é uma pergunta em aberto, e
mascará-lo agora esconderia a causa.

### Estado do critério de aceite da Fase 1

−30% em `meanErrorInner` **não foi atingido**, por 1.1, 1.2 nem 1.3. As três
tarefas atacavam a deriva de pose por três vias diferentes, e as três mediram
que a pose não é o gargalo nesta gravação:

| via | resultado medido |
|---|---|
| 1.1 rejeitar frames por pose | gate inerte: cabeça parada dentro do ponto (0,3°) |
| 1.2 ajustar coeficiente de pose | +8,6%: coeficiente vira atalho para o alvo |
| 1.3 compensar por geometria | +5,6%; e um deslocamento fixo bate a versão ajustada |

O gargalo está em outro lugar. As candidatas com evidência independente são as
da Fase 3: colinearidade do `iris12` (posto efetivo ~4 sobre 12 dims) e
densidade de alvos. E o viés vertical acima.

---

## 1.2 — pose como feature ajustada piora tudo. O coeficiente aprendido diz por quê.

O plano previa que devolver a pose ao vetor recuperaria a deriva medida em 1.1.
Foi medido; não recupera. Piora em **todas** as métricas.

### Tabela — `fixtures/replay/ci-baseline.jsonl`, `balanceado-v2`, features recomputadas

| conjunto | λ | erro de treino | LOO por alvo | meanErrorInner | p90 | Δ vs iris12 |
|---|---|---|---|---|---|---|
| `iris12` (12 dims) | 0,01 | **41,1 px** | **96,9 px** | **144,6 px** | 410,1 | — |
| `iris12+pose` (15) | 0,01 | 59,0 px | 151,3 px | **157,1 px** | 441,4 | **+8,6%** |
| `iris12+posecross` (21) | 0,1 | 61,0 px | 151,7 px | **159,6 px** | 466,1 | **+10,3%** |

`meanErrorEdge` segue ausente: esta gravação só tem a grade interior.

Reproduzível com `npm run replay -- --feature-set <conjunto>` (exige features
recomputadas; o harness rejeita a combinação com `--use-recorded-features`,
porque as features gravadas já vieram projetadas pelo build que gravou).

### Por que não é ruído: o LOO por alvo

`iris12` erra 41,1 px no treino e 96,9 px quando um alvo INTEIRO sai do ajuste.
Com pose, 59,0 e 151,3. A distância entre treino e LOO cresce de 2,4× para 2,6×
— e os dois níveis sobem. Não é overfitting clássico (o treino também piorou):
é o ajuste inteiro ficando pior.

O LOO é por ALVO, nunca por amostra aleatória. Amostras do mesmo alvo são quase
idênticas, então segurar algumas delas mede interpolação dentro do aglomerado.
Com uma feature correlacionada com a ordem de apresentação — que é o caso da
pose, r ≈ 0,96 — o split aleatório premiaria exatamente a memorização.

### O teste decisivo: o coeficiente aprendido não é geometria

A geometria prevê o que a pose deveria valer. Com o olho parado na órbita e a
cabeça girando Δ, o ponto olhado se desloca `d · tan(Δ)`: **≈ 38,5 px por grau**
na tela de referência. Os pixels são quadrados, então esse ganho é **o mesmo nos
dois eixos** — yaw→X e pitch→Y deveriam ter a mesma magnitude.

| conjunto | yaw → X | pitch → Y | esperado |
|---|---|---|---|
| `iris12+pose` | **−83,6 px/grau** | **+11,9 px/grau** | ±38,5 nos dois |
| `iris12+posecross` | **−97,4 px/grau** | **−4,7 px/grau** | ±38,5 nos dois |

Os dois eixos diferem entre si por um fator de **7×**, quando a geometria exige
que sejam iguais. Esse argumento não depende de convenção de sinal, e é
conclusivo: **o modelo não aprendeu compensação de pose.** Ele usou a pose como
atalho para separar aglomerados de alvo, o que funciona no treino e não
sobrevive fora dele.

### Dois motivos para o atalho existir, ambos medidos

1. **Confundimento.** A pose deriva monotonicamente com a ORDEM de coleta
   (r ≈ 0,96) e a ordem dos alvos é fixa, então a pose vira um relógio que
   identifica o alvo. O coeficiente "certo" nem é identificável: as features de
   íris já explicam o alvo, e não sobra resíduo geométrico para a pose explicar.
2. **Extrapolação.** O teste de precisão vem DEPOIS da calibração e a deriva
   continua. **84,4% dos frames de precisão têm pitch fora da faixa vista no
   treino** (até 0,97° além). Um coeficiente errado, extrapolado, erra mais.

### Hipótese que eu levantei e a medição derrubou

Suspeitei que a penalidade anisotrópica Σ_W deixaria a pose quase livre, por ela
ter variância intra-alvo quase nula (0,3° numa sessão de cabeça parada).
**Falso.** A diagonal normalizada de Σ_W dá à pose peso 0,42–1,05 — em torno da
média. O que de fato acontece é menor e em outra direção: como `withinTargetPenalty`
normaliza por `trace/d`, acrescentar dimensões de baixa variância intra-alvo
endurece a penalidade das demais — as features de íris passam de 0,21–4,36 para
0,22–4,67 (+7% com pose) e 0,25–5,67 (+30% com posecross). Contribui para o
treino piorar com λ constante, mas não explica sozinho os +8,6%.

λ não mudou entre `iris12` e `iris12+pose` (0,01 nos dois), então a degradação
não vem de o CV endurecer a regularização.

### Consequência para 1.3

O problema não é que a pose seja irrelevante — 1.1 mediu 91 px em X e 151 px em
Y de deriva real. O problema é **ajustar** o coeficiente a partir de dados onde
ele não é identificável.

1.3 não ajusta nada: aplica `d · tan(Δ)` com o ganho geométrico conhecido,
na saída. Sem coeficiente livre, não há o que memorizar, e a extrapolação é
correta por construção. Esta é agora a via principal para o critério de aceite
da Fase 1, e `ACTIVE_FEATURE_SET` permanece `iris12`.

### Correção de comentário

`extractor.ts` justificava a remoção da pose dizendo que "a pose já entra via
offset". É falso: `offsetX/offsetY` são medidos **no frame da cabeça** (os
landmarks são rotacionados pela matriz facial antes da medição), construção que
os torna deliberadamente INVARIANTES à rotação da cabeça — e por isso mesmo
incapazes de carregá-la. O comentário foi substituído pela derivação correta e
pela tabela acima.

---

## 1.1 — o gate de pose não era o gargalo. A medição diz onde ele está.

A hipótese da Fase 1.1 era: o gate de deriva de pose usa como referência o
primeiro frame de CADA ponto, então a cabeça pode migrar entre alvos sem nunca
violá-lo; apertar a tolerância e ancorá-la na sessão recuperaria precisão.

A primeira metade estava certa. A segunda estava errada, e o harness mostra por quê.

**Fixture criada para poder medir isto:** `npm run replay -- --regate-pose`
reaplica o gate offline sobre a pose gravada por frame, em vez de honrar
`sampleDecision.accepted` do JSONL. Sem ela o replay é estruturalmente cego a
mudanças no gate — reproduz as decisões gravadas e reporta "sem diferença"
quando na verdade não mediu nada. (Regra do plano: sem fixture, a tarefa é criar
a fixture primeiro.)

### Tabela — `fixtures/replay/ci-baseline.jsonl`, filtro `balanceado-v2`, features recomputadas

| variante | meanErrorInner | p90 | amostras de treino | rejeitados por pose | Δ vs baseline |
|---|---|---|---|---|---|
| gravado (baseline 0.4) | **144,6 px** | 410,1 | 514 | — | — |
| gate 1,0°/ponto (novo) | **144,6 px** | 410,1 | 514 | 0 | **+0,0%** |
| gate 4,98°/ponto (antigo) | **144,6 px** | 410,1 | 514 | 0 | **+0,0%** |
| gate 0,5°/ponto | **144,7 px** | 410,6 | 475 | 39 | **+0,0%** |

`meanErrorEdge` não aparece: a gravação só tem a grade interior 25/50/75. O anel
de bordas de 0.3 existe apenas no teste ao vivo e entra na próxima gravação.

### Por que o gate é inerte

| grandeza | medido |
|---|---|
| dispersão de pose DENTRO de cada ponto (p90) | yaw 0,09–0,30° · pitch 0,16–0,26° |
| deriva ENTRE alvos (amplitude das medianas) | yaw 2,38° · pitch 3,92° · roll 1,15° |
| correlação da pose com a ORDEM de coleta | yaw **+0,961** · pitch **−0,925** |

A cabeça fica parada dentro de cada ponto — 0,3° é ruído de landmark, não
movimento. Isso é coerente com o perfil do usuário-alvo (ELA: a cabeça não se
mexe por vontade própria), e significa que **um gate por ponto não tem o que
rejeitar**, em qualquer tolerância entre 0,75° e 4,98°.

O que existe é deriva postural lenta ao longo da sessão, quase perfeitamente
linear no tempo (r ≈ 0,96). A 38,5 px/grau na tela de referência são **91 px em
X e 151 px em Y** de inconsistência entre o primeiro e o último alvo — da mesma
ordem do erro total de 144,6 px.

### Por que gatear isso não funciona

Um gate só sabe apagar frames. A deriva não está dentro dos pontos, está entre
eles: cada alvo é internamente consistente e sistematicamente deslocado em
relação aos vizinhos. Ancorar o gate num baseline de sessão apagou **509 dos 514
frames** — ou seja, apagou alvos inteiros dos extremos da sessão, que é
exatamente a informação de que o modelo mais precisa.

Deriva entre alvos é para **modelar**, não para rejeitar. Isso é 1.2 (pose no
vetor de features) e 1.3 (compensação geométrica na saída).

> ⚠️ **Achado para 1.2.** A pose está correlacionada com a ORDEM de coleta
> (r ≈ 0,96), e a ordem dos alvos é fixa. Logo a pose está indiretamente
> correlacionada com a POSIÇÃO do alvo (corr(alvoX, yaw) = −0,46). Um modelo que
> receba pose como feature pode usá-la como atalho para adivinhar o alvo, e o
> erro de treino cai sem que nada tenha sido aprendido. **1.2 precisa ser medido
> com LOO por alvo, nunca por split aleatório**, e a ordem de apresentação dos
> alvos deveria ser aleatorizada em gravações futuras.

### O que 1.1 entregou, já que não entregou precisão

- `--regate-pose` no harness — sem isto, nenhuma mudança de gate é mensurável.
- Correção de vazamento de estado: `startCalibrationMode` não zerava
  `isCollecting`. Quem abandonasse a calibração no meio de um alvo e recomeçasse
  seguia coletando contra o alvo antigo, com o timeout daquele ponto pendente.
- `MIN_ACCEPTED_SAMPLES = 15`: um ponto com 3 amostras entrava no treino ao lado
  de outros com ~60, sem nenhum sinal. Agora é refeito.
- `getSessionPoseDrift()` + aviso ao operador acima de 60 px-equivalentes,
  distinguindo deriva monótona (escorregar na cadeira → apoiar a nuca) de
  errática (refazer a calibração).
- Tolerância documentada com a medição que a justifica, em vez do 0,087 herdado
  sem procedência.

**O critério de aceite da Fase 1 (−30% em `meanErrorInner`) não foi atingido por
1.1 e não podia ter sido.** Ele permanece aberto para 1.2/1.3, que atacam a
deriva medida aqui.

---

## Baseline verdadeiro do pipeline atual (0.4)

Primeiro número gerado pelo código de hoje, para a configuração de hoje.

**Arquivo:** `baseline-iris12.report.json` — reproduzível com:

```bash
npm run replay -- --jsonl fixtures/replay/ci-baseline.jsonl --filter balanceado-v2 --report baseline-iris12.report.json
```

| variante | vetor | mean | mediana | p90 | max |
|---|---|---|---|---|---|
| **baseline-iris12** (balanceado-v2, recomputado) | `iris12:12` | **144,6 px** | 71,3 | 410,1 | 1014,8 |
| ci-baseline-a2 (balanceado-v2, features gravadas) | 44 dims | 150,3 px | 76,4 | 470,9 | — |

O vetor de 12 dims sai ligeiramente melhor que o de 44 nesta gravação, e a diferença
é maior na cauda (p90: 410 contra 471) do que na média. Mesma gravação, mesmo harness,
mesmo filtro — a comparação é legítima.

### Três ressalvas sobre este baseline

**1. Não mede borda.** O anel de 4 cantos adicionado em 0.3 só existe no teste ao vivo.
O replay reexecuta os alvos que estão gravados no JSONL, e a gravação tem apenas a
grade interior 25/50/75. `meanErrorEdge` só aparece depois de uma calibração nova
feita no app.

**2. Os graus não são comparáveis com o teste ao vivo.** O replay converte pixels em
graus com `ASSUMED_DIST_PX = 2268` (60 cm a 96 DPI, hardcoded), enquanto o teste ao
vivo usa a geometria configurada — 2205 px para 23,6" a 60 cm. São 2,9% de diferença
na distância assumida, o que faz 144,6 px virar 3,59° no replay e 3,75° ao vivo.
**Compare em pixels.**

**3. Não é o mesmo número do teste ao vivo, e nem deveria ser.** O relatório
`accuracy-report-1787858613170` mede 103 px na mesma configuração de código. As duas
medidas diferem porque a gravação é de outra sessão, com outro posto de uso — a
gravação tem brilho 0,236 e rosto ocupando 9,9% do frame; a sessão ao vivo mais
recente tem 0,496 e 15,4%. O replay serve para comparar VARIANTES do pipeline sob
dados idênticos, não para prever o erro de campo.

---

**Regras que governaram a semana (de `PLANO-FRENTES-A-B.md`):**

1. Fail loud, não silent.
2. Emergência nunca bloqueada.
3. UI não pode mentir sobre estado.
4. Nada liga por padrão sem número que justifique.

---

## Resumo executivo

- **8 sprints implementadas** (D2 → D8). Toda infra planejada foi entregue.
- **Nenhuma flag nova foi ligada por padrão** — regra 4 mantida.
  `isotropicLandmarks`, `lockCameraExposure` e `applyDistanceCorrection`
  seguem `false`, esperando gravação real para decisão.
- **333 testes passando** (26 arquivos raiz · 228 testes; 19 arquivos frontend
  · 105 testes) — +174 testes novos ao longo da semana.
- **Baseline de 57 px / 0,9° preservado.** Nenhuma mudança de comportamento
  no caminho feliz — todas as extensões (correção de distância, ablação,
  drift, fadiga) são opt-in ou puramente diagnósticas.
- **Uma pendência humana única atravessa D2 → D8:** gravar 1 fixture de
  20-40 min via `SettingsScreen → Gravador de sessão`. Sem ela, as decisões
  numéricas de D3.1/D3.2, D4.3, D5.1, D5.2, D7.1, D7.3 e o gate de CI de
  D8.1 ficam suspensas.

---

## Decisões tomadas nesta semana

### Ligadas por default

| Item | Origem | Motivo |
|------|--------|--------|
| `balanceado-v2` como preset default do `measure_baseline` | D3.2 | Casa com o default do engine desde D1-1 → números comparáveis 1:1 com o accuracy test ao vivo. |
| `getSessionUptimeMs()` no `AUTO_TEST_META` (auto pós-calibração) | D2.2 | Substitui `minutosDeSessao: 0` hardcoded — a curva de drift do ROADMAP era impossível sem isso. |
| `applyUptimeToRunMetaIfDefault` no accuracy test manual (SettingsScreen) | D7.2 | Mesmo motivo, agora no fluxo manual. Preserva override do cuidador. |
| Condição óptica selecionável na tela de calibração | D6.2 | Antes o perfil salvo sempre saía com `opticalCondition: 'desconhecido'`. |
| `<DriftIndicator />` montado no App | D6.3 | Cuidador enxerga o viés de sessão que o D1-3 estava absorvendo silenciosamente. |
| `<FatigueIndicator />` montado no App | D7.4 | Taxa de piscadas já era medida (D1-4) mas não estava conectada a nenhuma ação. |
| Modo rápido de calibração (4 cantos) na UI | D6.1+D6.2 | Recalibração <15s (papel — meta) contra ~19-29s do modo completo. |

### Ficaram desligadas — dependem de fixture

| Flag | Estado | Espera |
|------|--------|--------|
| `EXPERIMENT.isotropicLandmarks` | `false` | Sweep OFF vs ON via `measure_baseline.mjs --a2-flags` sobre a fixture. Só liga se houver melhora sem regressão. |
| `EXPERIMENT.lockCameraExposure` | `false` | Medição AO VIVO (afeta apenas `ImageCapture.applyConstraints`, não afeta replay). Fora do sweep. |
| `EXPERIMENT.applyDistanceCorrection` | `false` | Gravação com movimento controlado (aproximação/afastamento). |
| `EXPERIMENT.expandFactor` (variação do 1.4 default) | `1.4` | Sweep AO VIVO (6 sessões, roteiro em `frontend/scripts/sweep_expand_factor.md` — replay não pode variar porque não persiste pixels). |
| Remoção de qualquer grupo de features (pose-linear/cross/quadratic/l2cs) | Nada removido | Ablação em `measure_baseline.mjs --ablation` produz números; mas N=1 gravação não justifica remover feature. |

### Decisões conservadoras registradas

- **Cadência do L2CS mantida em 100 ms; staleness em 500 ms.** D3.4
  documentou a decisão. Base: usuários-alvo (ELA, memory
  `project_target_users_als.md`) não fazem movimento rápido de cabeça — a
  premissa "head-still" torna a cadência atual seguramente adequada.
  Revisitar se `stalePct > 15%` sustentado *E* houver ganho de erro
  comprovado.
- **Detecção de outlier em nível de ponto é apenas sinalização.** D4.2
  registra em `StoredCalibrationProfile.quality.outlierTargets` e loga; NÃO
  retreina, NÃO bloqueia. MAD com N~9 é frágil — o próprio log fala isso.
- **Modo rápido usa o mesmo vetor de features do modo completo.** D6.1
  discutiu (e rejeitou por ora) reduzir o vetor no modo rápido — reduzir
  invalidaria todos os perfis salvos, custo alto pra ganho incerto. Backlog
  se o modo rápido mostrar precisão sistematicamente pior: adicionar 1
  ponto central (variante de 5), NÃO reduzir o vetor.

---

## Sprint-a-sprint

### D2 — Loop de medição

**Entregas:**

- `docs/PONTO-DE-REFERENCIA.md` sem nenhum `[PREENCHER]` — todos os 10 campos
  consolidados a partir da Rodada A de `docs/BUG-OCULOS-EVIDENCIA.md`.
- `AUTO_TEST_META` do auto-test pós-calibração deixou de ser hardcode.
  `frontend/src/utils/autoTestMeta.ts` — função pura testável;
  `minutosDeSessao` vem do uptime do engine; `oculos` deriva da condição
  óptica ativa.
- `frontend/scripts/measure_baseline.mjs` — wrapper de `scripts/replay.mjs`
  para varrer variantes de configuração sobre a MESMA gravação.
- `fixtures/replay/README.md` — roteiro passo-a-passo para produzir a fixture.

**Pendência humana:** gravar a fixture (a única tarefa manual de D2, ver
`fixtures/replay/README.md`).

**Testes novos (12):** `frontend/src/utils/autoTestMeta.test.ts` — cobre
uptime, arredondamento, negativo, mapeamento de condição óptica.

### D3 — Endurecer o uso do L2CS-Net

**Entregas:**

- D3.1: `frontend/scripts/l2cs_axis_validation.mjs` reescrito. 5 poses
  (adicionou `look_down`, `look_left`); veredicto por PAR (simetria); aceita
  `--dirs` para consistência entre distâncias.
- D3.2: Presets v2 do OneEuroFilter (`estavel-v2`/`balanceado-v2`/
  `responsivo-v2`) no replay — resolve a limitação declarada no comentário
  do próprio `measure_baseline.mjs`.
- D3.3: `confidence` da softmax exposta como diagnóstico (novo campo em
  `L2CSGaze`, `RecordedL2CS`, `EngineDiagnostics.l2cs`). NÃO consome
  downstream — respeitando regra 4.
- D3.4: Decisão "manter cadência 100 ms + staleness 500 ms" documentada.

**Pendências humanas:**

- Capturar 5 fotos (idealmente ×2 distâncias) e rodar D3.1.
- Rodar sweep de `expandFactor` ao vivo (6 sessões, roteiro em
  `frontend/scripts/sweep_expand_factor.md`).

**Testes novos (9):** `src/l2cs/decode.test.ts` (+7 para
`decodeAngleWithConfidence`); `src/l2cs/client.test.ts` (+2 para
`getAverageConfidence`).

### D4 — Outliers Ridge + ablação de features

**Entregas:**

- D4.1: `detectOutlierPoints` em `src/calibration.ts` — função pura
  testável, LOO com MAD escalado por 1.4826, piso absoluto de 15% (calibrado
  empiricamente contra a extrapolação natural de LOO nos cantos da grade 3×3).
- D4.2: Wiring em `StoredCalibrationProfile.quality.outlierTargets` +
  `__irisflowDebug.outlierTargets()`. Apenas sinaliza.
- D4.3: `scripts/replay.mjs --drop-features <grupos>` (pose-linear |
  pose-cross | pose-quadratic | l2cs); `measure_baseline.mjs --ablation`
  anexa 4 variantes de ablação.

**Pendência humana:** rodar `measure_baseline.mjs --ablation` quando a
fixture existir.

**Testes novos (7):** `src/calibration.d4.test.ts` — todos os regimes de
input (poucos alvos, features vazias, ruído idêntico, 1 outlier isolado).

### D5 — Head pose validation + correção de distância

**Entregas:**

- D5.1: Variante combinada "sem pose alguma" anexada em
  `measure_baseline.mjs` (herda D4.3, adiciona o número que D5 pede).
- D5.2: `src/distanceCorrection.ts` novo — função pura + wiring reversível
  em `calibration.ts` (`calibrationRefDistance` capturada no treino) +
  `engine.ts` (passa `cameraDistanceEstimate` a `mapGaze`).
  `EXPERIMENT.applyDistanceCorrection: false` (regra 4). Escala IN-PLACE
  apenas dims dependentes de offset ([0..3] iris + [25..30] pose·offset
  1ª ordem + [31..34] pose²·offset); NÃO escala pose linear ([22..24]),
  pose·scale ([35..36]), nem bloco L2CS ([37..43]) — todas invariantes a
  distância em ângulo.
- Achado teórico honesto preservado no código: correção é heurística de 1ª
  ordem; solução completa (Structure-from-Motion) fica no §8 do ROADMAP como
  backlog explícito.

**Pendência humana:** gravar sessão de movimento controlado
(aproximação/afastamento) para comparar `applyDistanceCorrection` OFF vs ON.

**Testes novos (19):** `src/distanceCorrection.test.ts` — 8 sobre
`computeDistanceCorrectionRatio` (guards, clamps, inputs inválidos); 11
sobre `applyDistanceCorrectionToFeatures` (dims corretas escaladas, sinal
preservado, vetor curto tolerado).

### D6 — Recalibração rápida + drift indicator

**Entregas:**

- D6.1: Backend `startCalibrationMode({ quick })`;
  `CALIBRATION_TARGETS_QUICK` (4 cantos) e `CALIBRATION_TARGETS_FULL` (9
  pontos 3×3) exportados; `getCalibrationTargets()` devolve a lista ativa.
- D6.2: `CalibrationCheck.tsx` ganhou `<select>` de condição óptica e
  botão secundário "Recalibração rápida (4 pontos)". Perfil salvo agora
  reflete a escolha real do cuidador (não mais `'desconhecido'` fixo).
- D6.3: `frontend/src/components/DriftIndicator.tsx` — banner azul opt-in,
  polling 1 Hz de `getSessionBias()`. Regras: `samples >= 20`, `|bias| >=
  5%`, nunca em `/calibration-check` ou `/emergency`, nunca em rotas de
  cuidador ou públicas, cede prioridade ao `isDegraded` (B4-2).

**Pendência humana:** medir tempo de coleta real e erro pós-recalibração
rápida vs. completa.

**Testes novos (16):** `src/calibration.d6.test.ts` (+7); `frontend/src/
components/DriftIndicator.test.tsx` (+9).

### D7 — Sessões longas: drift, fadiga

**Entregas:**

- D7.1: Override de `EXPERIMENT` via env-var (`IRISFLOW_EXP_<key>=<value>`).
  `measure_baseline.mjs --a2-flags` (2 variantes: `isotropicLandmarks` OFF
  vs ON). `lockCameraExposure` fica FORA do sweep — só afeta câmera ao vivo
  (limitação declarada em código).
- D7.2: `applyUptimeToRunMetaIfDefault` no fluxo manual de accuracy
  (SettingsScreen). Preserva override manual do cuidador.
- D7.3: `--time-window <startSec,endSec>` no `scripts/_replay_impl.ts` (só
  filtra frames de accuracy — calibração é preservada, é pré-requisito do
  modelo). `--drift-curve <windows>` no `measure_baseline.mjs`; default
  `0-5,20-25,40-45` min.
- D7.4: `frontend/src/components/FatigueIndicator.tsx` — banner verde
  opt-in, polling 10s de `getRecentBlinkRatePerMinute`. Sustained detection
  (3 polls acima do limiar 25/min = ~30s); histerese de 5/min. Mesmas
  regras de rota do DriftIndicator. Cede ao `isDegraded` (nunca empilha
  avisos).

**Pendências humanas:** gravar 1 sessão contínua ~40 min; rodar
`--a2-flags` e `--drift-curve` sobre a fixture; medição ao vivo de
`lockCameraExposure`.

**Testes novos (30):** `src/config/experiment.test.ts` (+8);
`frontend/src/utils/autoTestMeta.test.ts` (+7 sobre
`applyUptimeToRunMetaIfDefault`); `frontend/src/utils/driftWindows.test.ts`
(+13); `frontend/src/components/FatigueIndicator.test.tsx` (+10).

### D8 — Consolidação

**Entregas:**

- D8.1: `frontend/scripts/check_baseline_regression.mjs` (nova CLI, com a
  lógica pura extraída em `checkBaselineDecision.mjs` para poder ser
  testada sem imports Node). Compara `meanErrorPx` da variante-baseline
  entre dois relatórios do `measure_baseline`; falha se current excede
  baseline + tolerância (default 15%, preliminar). Step de CI condicional
  adicionado ao `frontend/.github/workflows/ci.yml`: smoke test das CLIs
  roda sempre; gate real roda apenas quando `fixtures/replay/ci-baseline.jsonl`
  e `ci-baseline.report.json` estão commitados.
- D8.2: **este documento** + atualização do `README.md`.
- D8.3: Sanity check final (testes + build + electron:compile). Conserto
  colateral de 4 warnings de TS pré-existentes (unused vars em
  `PhotoCaptureScreen.tsx` + `accuracy.ts:112`) que quebravam o build
  desde antes de D2 — parte da consolidação de "build limpo". Timeout do
  teste flaky `qualityAnalyzer.a1-5.test.ts` aumentado para 15s (o teste
  fica intermitente sob load pesado por conta de jsdom+canvas 3.2.3;
  runs isolados <500ms).
- D8.4: `§8` do ROADMAP expandido em duas subseções (8.1 backlog técnico
  original + 8.2 novas pendências humanas emergentes de D3-D7, agrupadas
  por origem para o próximo operador não precisar caçar).

**Testes novos (11):** `frontend/src/utils/checkBaselineRegression.test.ts`
sobre `decideRegression` (boundary conditions, invalid inputs, tolerância 0).

---

## Estado ao fim da semana

- **Raiz:** 26 arquivos · 228 testes verdes (+1 arquivo, +18 testes vs. fim
  do D7 — D8.1 adicionou pouco na raiz; a maior parte cresceu no frontend).
- **Frontend:** 19 arquivos · 105 testes verdes (+1 arquivo, +11 testes vs.
  fim do D7 — `checkBaselineRegression.test.ts` de D8.1).
- **Total:** 333 testes verdes.
- **Build (`npm run build`):** limpo.
- **Electron:compile (`npm run electron:compile`):** limpo.

Novos testes ao longo da semana: **+174** (12 D2 + 9 D3 + 7 D4 + 19 D5 +
16 D6 + 30 D7 + 11 D8 + calibração/e2e residuais deixados pela mesma semana).

---

## Backlog explícito consolidado (não escondido)

**Pendências humanas atravessando toda a semana** (dependem de sessão
física com webcam — o agente não tem acesso):

1. **Fixture de calibração+accuracy (D2.4).** Base de tudo. Sem ela, D3.1,
   D3.2, D4.3, D5.1, D5.2, D7.1, D7.3 e o gate de CI de D8.1 ficam
   suspensos. Roteiro em `fixtures/replay/README.md`.
2. **5 fotos ×2 distâncias (D3.1).** Para validar axis symmetry do L2CS.
3. **Sweep ao vivo de `expandFactor` (D3.2, 6 sessões).** Roteiro em
   `frontend/scripts/sweep_expand_factor.md`.
4. **Fixture longa ~40 min (D7).** Base para curva de drift + sweep A2.
5. **Sessão de movimento controlado (D5.2).** Para decidir
   `applyDistanceCorrection`.
6. **Medição ao vivo de `lockCameraExposure` (D7.1).** Impossível via
   replay.
7. **Tempo real de coleta e erro pós-recalibração rápida vs. completa
   (D6).** Só com usuário real.

**Backlog técnico registrado no §8 do ROADMAP:**

- Reconstrução 3D de cabeça / Structure-from-Motion (solução completa que
  a literatura usa para deslocamento lateral).
- Retreinar ou substituir o L2CS-Net (fora de escopo de 1 semana).
- RANSAC clássico (com N=9 alvos, MAD é mais adequado — D4 escolheu MAD
  intencionalmente).
- Investigação do revert de `f78b6bd` (ordenação raster + gate de deriva
  entre pontos).
- Automação completa da curva de deriva (pipeline contínuo, múltiplos
  usuários, análise estatística).
- Validação em outro hardware/webcam.

---

## Como usar isto

Se você é o próximo agente/desenvolvedor a tocar neste código:

1. Se precisar decidir sobre uma flag: consulte a tabela "Ficaram
   desligadas" primeiro. Se a flag está lá, os números que a decisão
   precisa vêm de rodar `measure_baseline.mjs` sobre a fixture com o
   sweep apropriado.
2. Se precisar entender uma decisão passada: cada sprint em §D2-D8 tem os
   comentários canônicos no código que citam explicitamente a razão.
3. Se precisar produzir a fixture: `fixtures/replay/README.md` tem o
   roteiro passo-a-passo. Nomear o arquivo como
   `fixtures/replay/ci-baseline.jsonl` (mais o snapshot `.report.json`)
   ativa o gate de CI automaticamente.
4. Se o gate de CI falhar num PR: `check_baseline_regression.mjs` explica
   o delta e as 3 ações possíveis. Regressão intencional exige regravar o
   snapshot baseline + justificar no PR.
