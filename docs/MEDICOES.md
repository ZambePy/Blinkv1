# Medições de acurácia e precisão

Documento único de referência do projeto sobre medição: o protocolo, o que
cada métrica significa, como rodar uma sessão e como ler o relatório. Se algo
aqui divergir do código, o código (`src/accuracy.ts`, `src/accuracyProtocol.ts`,
`src/calibration.ts`) é a verdade e este arquivo precisa ser corrigido.

**Escopo desta versão (2026-09-06).** O protocolo foi enxugado para caber no
prazo do projeto. O que saiu está registrado na seção 3, com o custo de cada
corte — nenhuma medida desapareceu em silêncio. O que ficou é o que sustenta a
única pergunta que o produto precisa responder: **o dwell acerta o botão?**

---

## 1. O que é medido

| termo | significado | onde aparece |
|---|---|---|
| **acurácia** (erro) | distância entre o ponto que a pessoa olha e o que o sistema estima | `result.meanError` (px), `result.meanErrorDeg` (graus) |
| **precisão** (tremor) | dispersão das estimativas em torno da própria média com o olhar parado. Não depende de acertar o alvo | `jitterRMS`, `precisionSdX/Y`, `precisionS2S`, `bceaPx2`/`bceaDeg2` |
| **perda de dados** | fração dos quadros esperados que não virou amostra válida | `fracaoDeAmostrasValidas`, `pontosComPoucaAmostra`, `pontosNaoMedidos` |
| **viés** | erro assinado médio por eixo. Viés uniforme denuncia pose ou geometria, não ruído | `result.biasX`, `result.biasY` |
| **taxa de acerto** | fração das amostras dentro de um alvo de raio R. É o que o dwell sente | `result.hitRateByRadius` (R = 60, 100, 150, 200 px) |
| **alvo mínimo** | lado do botão quadrado que acomoda o erro desta pessoa | `alvoMinimoPx`, `alvoMinimoDeg` (seção 9) |

Acurácia, precisão e perda de dados são independentes (Niehorster et al.,
2026). Um sistema pode tremer pouco e estar 100 px à esquerda, estar centrado e
tremer muito, ou acertar nos poucos quadros que sobraram. O dwell precisa das
três.

### 1.1 As três medidas de precisão

| medida | campo | o que pega, o que perde |
|---|---|---|
| **STD** | `precisionSdX/Y`, `jitterRMS` | dispersão total, incluindo deriva lenta. Não distingue tremor de escorregão |
| **RMS-S2S** | `precisionS2S` | só o tremor rápido, o que o filtro combate. **Depende da taxa**: só compare rodadas com `sampleRateHz` parecido |
| **BCEA (68 %)** | `bceaPx2`, `bceaDeg2` | a **forma** da nuvem. Uma medida escalar esconde que o erro vertical é sistematicamente maior que o horizontal |

STD alto com RMS-S2S baixo = o olhar escorregou (pose, distância, filtro
convergindo). Os dois altos = ruído de imagem. Os dois bons com BCEA grande e
achatada = problema em um eixo só, e a decisão é mudar a proporção do botão.

`precisionDeg` é `jitterRMS` convertido no centro da tela — para comparar
dispersão entre sessões, prefira `bceaDeg2`.

### 1.2 Pixels versus graus

Erro em px depende do tamanho da tela; em graus, da distância. Para comparar
sessões use graus, e só quando as condições registradas forem as mesmas.

O erro angular é vetorial e ponto a ponto: alvo e predição são vistos do olho a
`distPx = distanciaCm × pxPorCm` do centro da tela, e o erro é o ângulo entre
os dois vetores (`erroAngularDeg` em `src/accuracy.ts`). Usa a excentricidade
real de cada alvo em vez de aproximar tudo por `atan(erroPx / distPx)`.

`pxPorCm` vem da diagonal física. Se ela for o valor assumido
(`geometry.source = 'default'`, 23,6″), o relatório marca `geometry.assumed =
true` e os graus são estimativa. Informe a diagonal real (`?diagonal=` na URL)
antes de qualquer sessão. Sem `meta.distanciaCm` e `meta.telaPolegadas` o
código cai em `ASSUMED_DIST_PX = 2268` (60 cm a 96 dpi).

Conversão de referência (Feit et al., 2017): a 65 cm, 1 cm ≈ 0,88°.

---

## 2. Protocolo do teste de precisão

Roda automaticamente ao fim de cada calibração, e sob demanda em
**Configurações → Testar precisão**.

**Pontos.** 13 alvos: grade 3×3 em 25/50/75 % da tela e 4 alvos de borda em
5/95 %. Deliberadamente disjunta da grade de calibração (~17/83 %) — validar
nas posições do treino mediria memorização. Coincidências vão para
`result.validationOverlap` (tolerância 2 % por eixo; o centro pertence às duas
por convenção).

**Ordem sorteada, com semente registrada.** Os 13 alvos são embaralhados
(`embaralharComSemente`, xorshift32). Em ordem fixa a pessoa antecipa o alvo e
a sacada antecipatória se mistura ao efeito de excentricidade. A semente vai
para `protocolo.sementeDaOrdem`, então a ordem é reproduzível.

**Tempo por ponto.** 2000 ms de coleta (`COLLECTION_MS`), os primeiros 600 ms
descartados (`ACCLIMATION_MS`) — medido na nossa própria curva, o erro nesse
trecho vale o dobro do regime estacionário (joelho em ~585 ms). Sobram
**1400 ms úteis**, ~42 amostras a 30 Hz. Menos de 8 amostras
(`MIN_SAMPLES_PER_POINT`) e o ponto não é medido, contando em
`pontosNaoMedidos`.

**Fração mínima de amostras.** `MIN_VALID_SAMPLE_RATIO = 0.8`. Abaixo disso o
ponto **não é descartado**: entra no relatório com o nome em
`pontosComPoucaAmostra`. Como a taxa é estimada do próprio ponto, o indicador
enxerga bem perda no começo e no fim da janela, e só parcialmente uma queda
uniforme — para essa, olhe `sampleRateHz`.

**Alvo de fixação.** Bullseye + crosshair com ponto escuro no centro; Thaler et
al. (2013) mediram menor dispersão com essa combinação. O alvo do teste e o da
calibração usam o mesmo desenho.

**Populações.** Não são as mesmas, e isso importa ao ler a seção 8:

| métricas | população |
|---|---|
| `meanError`, `medianError`, `p90Error`, `meanErrorX/Y`, `biasX/Y`, `errorPct`, `meanErrorDeg`, `bceaPx2/Deg2` | só os pontos **interiores** medidos |
| `jitterRMS`, `precisionSdX/Y`, `precisionS2S`, `jitterFilteredRMS`, `maxError` | **todos** os pontos medidos |
| `sampleMeanError`, `sampleMedianError`, `sampleP90Error`, `hitRateByRadius` | todas as amostras de todos os pontos medidos |

As bordas ficam fora da acurácia porque sofrem duas distorções opostas
(softClamp e geometria plana); `meanErrorEdge` existe separado e é a métrica
menos confiável do relatório. Nyström et al. (2013) e Feit et al. (2017)
relatam o mesmo padrão em rastreadores IR.

**Duas fontes de amostra.** O núcleo alimenta o teste com a predição **bruta**
(antes do filtro) e a **filtrada** (o que o cursor mostra). Acurácia e precisão
vêm da bruta; `jitterFilteredRMS` mostra quanto o filtro reduz o tremor
visível.

**Duração.** 13 × 2000 ms + 300 ms entre alvos + 1500 ms de preparo ≈ **31 s**.

**Se o teste travar.** Um vigia verifica a cadeia de quadros: 3000 ms sem
quadro é uma parada (`STALL_MS`); na terceira (`STALL_MAX`) o teste encerra
sozinho e grava relatório **parcial**, com `abortado` preenchido. Relatório com
`abortado` é registro de falha, não resultado.

**Cursor.** Escondido durante o teste: vendo o cursor a pessoa tenta
corrigi-lo, e o erro medido vira o do loop de perseguição. A flag
`?cursorNoTeste=1` o revela para diagnóstico ao vivo — **uma rodada com ela
ligada não é comparável com nenhuma outra**, e a flag fica registrada em
`pipeline.experiment`.

**Escala verbal.** `score` vem do `meanError` em px: Excelente < 30, Bom < 60,
Regular < 100, Ruim acima. Rótulo para a tela do paciente; para análise, os
números.

---

## 3. Limitações assumidas

Cortes deliberados, com o preço de cada um. Quem publicar um resultado nosso
precisa citar esta seção.

### 3.1 Iluminância (lux) — **fora do protocolo**

Não medimos lux. O campo `meta.luxAmbiente` continua no schema para relatórios
antigos, mas nenhuma tela o preenche.

**O que se perde:** ninguém fora da equipe consegue reproduzir a condição de
luz de uma sessão nossa. O método do Tobii varre 1 / 300 / 600 / 1000 lux; nós
não registramos nem um ponto.

**Por que isso é pior do que parece:** `meta.iluminacao` (`boa`/`ruim`) **não
cobre a lacuna**. Ele vem do check `lighting`, que lê o brilho do *recorte do
olho depois da exposição automática da câmera* — e a exposição automática
existe justamente para anular mudanças de luz. Medido em 2026-09-06: uma sala a
**43 lux** (≈ 1/7 da referência) produziu `brightness = 0.482` e o check
passou como **"Iluminação adequada"**. Leia `iluminacao: 'boa'` como *"o rosto
está bem exposto no frame"*, nunca como *"a sala está bem iluminada"*.

**Consequência prática:** ao diagnosticar erro alto e uniforme, a luz continua
sendo suspeita mesmo com o check verde. A assinatura de pouca luz é
`affine.explainedFraction` baixa (erro é ruído, não mapa), erro alto já no
centro, e alvos da linha inferior com zero amostras por perda de rosto.

### 3.2 FOV da câmera — fixado, não derivado

`cameraHorizontalFovDeg` tem default **69,7°**, o valor nominal da webcam de
referência, em vez de ser derivado por sessão com fita métrica.

**O que se perde:** `result.distanciaMedidaCm` passa a ser tão exato quanto o
valor nominal da lente. Como ele serve de *testemunha de movimento* (faixa
min–max larga = a pessoa se mexeu) e não entra no cálculo do erro angular, um
erro de escala não contamina nenhuma métrica — só desloca a faixa inteira.

O botão **Configurações → Calibrar campo de visão** continua disponível para
derivar o valor da câmera real.

### 3.3 Queixeira

O método do Tobii a torna obrigatória. Nossos usuários estão reclinados, muitas
vezes com controle cervical reduzido; uma queixeira mediria um sistema que
ninguém vai usar. O preço, documentado por Niehorster et al. (2018): sem
restrição, a variabilidade entre trials cresce e parte do erro é postura.
Compensamos **medindo** a postura em vez de travá-la — `poseDrift`,
`poseDeltaCalibToTestDeg` e `movimentoCabeca`.

### 3.4 Critérios de exclusão do Tobii

O método rejeita ponto com < 80 % de amostras válidas, SD > 1,5° ou offset
> 5°, e aprova o rastreador se 17 de 20 participantes passarem. Aplicado ao
nosso público, esse filtro removeria justamente quem mais precisa do sistema:
ptose, diplopia e sacadas degradadas são comuns na ELA tardia (OHSU). Mantemos
o limiar de 80 % como **marcador**, não filtro.

### 3.5 N pequeno

Não temos os 20 participantes do Tobii nem os 80 de Feit et al. Qualquer número
nosso é de N pequeno e deve ser lido com a distribuição por ponto à vista,
nunca só a média.

---

## 4. O plano de medição

Quatro sessões, uma pergunta cada. A primeira está feita; as outras três variam
**uma** coisa por vez em relação a ela. Uma quinta linha de investigação — a
deriva ao longo do tempo — está adiada e descrita em §4.5.

| # | condição | o que varia | métrica que responde | estado |
|---|---|---|---|---|
| **M1** | `filtro=oneEuro` | — (referência) | `meanErrorDeg`, `bceaDeg2`, `alvoMinimoPx` | ✅ **feita** (§4.1) |
| **M2** | `filtro=kalman` | filtro temporal | `jitterFilteredRMS` | ✅ feita (§4.2) |
| **M3** | `filtro=kalmanEma` | filtro temporal | `jitterFilteredRMS` | ✅ feita (§4.2) |
| **M4** | `oneEuro` + `lateralTranslationCompensation=true` | compensação de translação | `meanErrorDeg`, `biasX/Y` | ✅ feita (§4.3) |
| — | deriva em dois blocos | tempo desde o treino | `meanErrorDeg` entre blocos | **adiada** (§4.5) |

Regra comum às quatro: **recalibre entre condições.** Trocar filtro ou
compensação sem recalibrar mistura duas condições no mesmo modelo (§6). E
mantenha constante o que não é a variável: mesma pessoa, mesma posição, mesmo
viewport, mesma luz, `?diagonal=` sempre na URL.

### 4.1 M1 — referência com One Euro *(feita)*

`accuracy-report-1788736866711.json`, 2026-09-06.

```
http://127.0.0.1:4173/?preflight=1&debug=1&ep=webgpu&l2cs=448&filtro=oneEuro&diagonal=23.6
```

| | |
|---|---|
| erro | **74 px / 1,86°** (`score` Regular) |
| precisão | `jitterRMS` 21,8 px · `sdX/sdY` 15,3 / 13,1 · `bceaDeg2` 0,535 |
| perda de dados | nenhuma: 13/13 pontos, `fracaoValidas` 1,000, 29,5 Hz |
| ajuste | 9/9 alvos treinados, `train` 21,3 px, `loo` 67,8 px, `gridDiagnosis: ok` |
| centro / periferia | 54 px / 86 px (razão 1,59) |
| acerto | 40 % em 60 px · 64 % em 100 px · 84 % em 150 px |
| alvo mínimo | **209 px / 5,42°** |
| distância medida | 47,1 cm (45,9–47,8) — faixa estreita, pessoa parada |
| pipeline | WebGPU, 448², One Euro, sem fallback, stale 0,0 % |
| geometria | 23,6″ manual, `assumed: false`, 36,75 px/cm |

É a única rodada até aqui que passou em todos os critérios da §11. Todo número
das outras três medições é comparado contra esta linha.

### 4.2 M2 e M3 — os outros dois filtros

**Atenção ao que essas duas sessões podem e não podem mostrar.** O teste de
precisão calcula a predição chamando `mapGaze` diretamente
(`src/accuracy.ts`), e recebe a saída filtrada num canal separado que alimenta
só `jitterFilteredRMS`. Consequência, por construção:

- `meanError`, `meanErrorDeg`, `jitterRMS`, `precisionSdX/Y`, `bceaDeg2`,
  `hitRateByRadius` e `alvoMinimoPx` **não mudam com o filtro** — todos vêm da
  predição bruta;
- **só `jitterFilteredRMS` muda.** É o tremor do cursor que a pessoa vê e que o
  dwell consome.

Então a pergunta destas duas sessões não é "qual filtro é mais exato" — é
**"qual filtro tira mais tremor do cursor"**, medido pela razão
`jitterFilteredRMS / jitterRMS` (quanto menor, mais o filtro suaviza).

Se os números de acurácia vierem diferentes entre M1, M2 e M3, isso **não** é
efeito do filtro: é variação entre calibrações, e é a magnitude dessa variação
que diz quanto ruído existe em qualquer comparação entre sessões nossas.

```
http://127.0.0.1:4173/?preflight=1&debug=1&ep=webgpu&l2cs=448&filtro=kalman&diagonal=23.6
http://127.0.0.1:4173/?preflight=1&debug=1&ep=webgpu&l2cs=448&filtro=kalmanEma&diagonal=23.6
```

Confira `pipeline.runtime.filterEffective` no relatório antes de acreditar na
condição: `__irisflowExp.set` só vale depois do reload, e o painel de preflight
não confere isso (§5.2).

#### Resultado de M2 *(feita — 2026-09-07)*

`accuracy-report-1788740744920.json`, `filterEffective: kalman`.

| | M1 (One Euro) | M2 (Kalman) |
|---|---|---|
| `jitterRMS` (bruto) | 21,8 px | 58,3 px |
| **`jitterFilteredRMS`** | **21,7 px** | **185,8 px** |
| **razão filtrado/bruto** | **0,99** | **3,19** |
| mediana por ponto, bruto → filtrado | 18 → 22 px | 36 → **191 px** |
| pior ponto filtrado | 45 px | **426 px** |

**O Kalman amplifica o tremor do cursor em vez de reduzi-lo, e o faz nos 13
pontos** — o menor valor filtrado de M2 (31 px) é maior que a mediana de M1
(22 px), então não é um ponto ruim puxando a média.

Mecanismo provável: o Kalman modela posição **e velocidade**. O teste faz 13
sacadas entre alvos e cada uma é um degrau; o filtro prevê que o movimento
continua, ultrapassa e oscila enquanto assenta. Se o assentamento passa dos
600 ms de acomodação descartados, o overshoot entra na janela útil.

**Ressalvas.** M2 não é comparação limpa: `targetsSkipped` com 1 alvo (rodada
inválida pelo §11), `l2csValidFraction` 0,815 (o pior do dia; M1 teve 1,000),
`sampleRateHz` 17,5 contra 29,5, e a pessoa sentou 5 cm mais perto (41,9 contra
47,1 cm). O Kalman recebeu um sinal bruto 2,7× mais ruidoso. O que sobrevive a
isso é o **fator de amplificação dentro de cada sessão** — 5,3× em M2 contra
1,2× em M1 —, porque ele compara filtrado e bruto do mesmo sinal.

Os 3,44° de erro de M2 não dizem nada sobre o filtro: vêm da predição bruta.

**Conclusão operacional:** primeira evidência empírica a favor do One Euro como
filtro de produção. A diferença é grande demais para ser ruído de sessão. Para
publicar a comparação, uma repetição de M2 em sessão limpa (9/9 alvos,
`l2csValid` 1,0, ~30 Hz, mesma distância) tornaria o resultado defensável.

#### Resultado de M3 *(feita — 2026-09-07)*

`accuracy-report-1788741070521.json`, `filterEffective: kalmanEma`.

Sessão **limpa**, e é o que dá peso ao resultado: `l2csValidFraction` 1,000
(igual a M1), distância 48,4 cm (M1: 47,1), 13/13 pontos, e erro de 1,93°
contra os 1,86° de M1. A condição de entrada foi equivalente à da referência.

| | M1 One Euro | M2 Kalman | M3 Kalman+EMA |
|---|---|---|---|
| `jitterRMS` (bruto) | 21,8 px | 58,3 px | 34,4 px |
| **`jitterFilteredRMS`** | **21,7 px** | 185,8 px | **203,9 px** |
| **razão filtrado/bruto** | **0,99** | 3,18 | **5,93** |
| mediana/ponto, bruto → filtrado | 18 → 22 px | 36 → 191 px | 29 → **207 px** |
| pior ponto filtrado | 45 px | 426 px | 423 px |
| erro | 1,86° | 3,44° | 1,93° |
| `sampleRateHz` | 29,5 | 17,5 | 17,8 |

**O EMA adaptativo não corrige o overshoot do Kalman — piora.** 204 px de
tremor filtrado contra os 186 px do Kalman puro, com um sinal de entrada
melhor (34 px contra 58 px). A hipótese de que a zona morta seguraria o cursor
em movimento pequeno está refutada por medição.

**Confundidor registrado:** M2 e M3 rodaram a ~17,5 Hz e M1 a 29,5 Hz. Um
Kalman com modelo de velocidade extrapola `dt` à frente, e a 18 Hz isso é
~57 ms contra ~34 ms — o overshoot cresce na mesma proporção. Não dá para
separar taxa de filtro sem repetir as duas a 30 Hz. Para a decisão de produto
isso não muda nada: é nessa taxa que a máquina de referência roda.

#### Conclusão do bloco de filtros

**One Euro fica.** As duas alternativas amplificam o tremor do cursor por
fatores de 3 a 6, e a pior delas é justamente a mais elaborada. A escolha de
produção deixa de ser premissa e passa a ser resultado medido.

**Reprodutibilidade entre sessões:** M1 e M3 são calibrações independentes,
ambas com `l2csValid` 1,000, e deram **1,86° e 1,93°** — 0,07° de diferença. É
a primeira estimativa de variação entre sessões limpas que o projeto tem.
Serve de régua: diferença menor que ~0,1° entre duas sessões limpas não
significa nada.

**Achado colateral, e é uma limitação do relatório:** a razão de M1 é 0,99 — o
One Euro praticamente não reduz o `jitterRMS`. É esperado, porque `jitterRMS` é
dispersão em torno da média do ponto e inclui deriva lenta, que um passa-baixa
preserva por construção. A métrica que mostraria o ganho do One Euro é a
amostra-a-amostra (`precisionS2S`, 9,7 px em M1), mas ela só é calculada sobre
o sinal bruto. **Nenhuma métrica do relatório mede o benefício do filtro sobre
o dwell.**

**Limitação conhecida:** `hitRateByRadius` é calculado sobre as amostras
BRUTAS, mas o dwell real consome o cursor FILTRADO. A taxa de acerto do
relatório, portanto, subestima o efeito do filtro sobre o dwell. Nenhuma das
três sessões corrige isso; é o que temos.

### 4.3 M4 — compensação de translação lateral

```
http://127.0.0.1:4173/?preflight=1&debug=1&ep=webgpu&l2cs=448&filtro=oneEuro&diagonal=23.6&compTranslacao=1
```

`compTranslacao=0` na mesma URL volta à condição base. A flag vive no
localStorage, então tirar o parâmetro NÃO a desliga — é preciso mandar `0`.

Diferente das duas anteriores, esta **muda a predição**: a compensação é
aplicada dentro de `mapGaze`, depois da compensação de rotação e antes do
`softClamp`, usando o deslocamento do centro do rosto contra a referência
gravada na calibração. Logo acurácia, viés e alvo mínimo se movem.

A flag está **desligada por default** e nunca foi medida. As duas perguntas:

1. Ligada, o erro na posição de calibração piora? (custo de ter a compensação
   sempre ativa)
2. Ligada, o erro resiste a um deslocamento deliberado? (o benefício que ela
   promete)

A segunda pergunta exige mover a pessoa de propósito — e é o começo do
protocolo de reposicionamento que o produto pede. Como M4 é uma sessão só,
meça primeiro a pergunta 1 (posição fixa, comparável com M1 termo a termo), e
deixe a 2 para quando houver orçamento de sessão.

Compare contra M1: `meanErrorDeg`, `biasX`/`biasY`, `affine.gainX/gainY` e
`explainedFraction`. Registre `pipeline.experiment.lateralTranslationCompensation`
no relatório para provar qual condição rodou.

#### Resultado de M4 *(feita — 2026-09-07)*

`accuracy-report-1788741409103.json`, com
`pipeline.experiment.lateralTranslationCompensation: true` confirmado no
relatório.

| | M1 (compensação off) | M4 (compensação on) |
|---|---|---|
| erro | **1,86°** | **2,89°** |
| `biasX` / `biasY` | −40,2 / −45,0 px | +18,6 / **−96,7** px |
| `affine` gainX / gainY | 0,954 / 0,850 | 0,925 / 0,829 |
| `affine` offsetX / offsetY | +28 / −5 px | +81 / **+55** px |
| `explainedFraction` | 0,587 | 0,417 |
| `residualPx` | 30 px | 67 px |
| `trainErrorPx` | 21,3 px | 50,7 px |
| `looErrorPx` | 67,8 px | 123,3 px |
| condição de runtime | 29,5 Hz, `l2csValid` 1,000, 47,1 cm | 29,2 Hz, `l2csValid` 1,000, 47,9 cm |

**Conclusão: ligar a compensação de translação não melhora a acurácia em
posição fixa.** O erro subiu de 1,86° para 2,89°, muito além da régua de
reprodutibilidade de ~0,1° estabelecida por M1 e M3. A flag continua desligada
por default, e agora isso é resultado medido, não escolha por omissão.

A compensação **não quebra nada**: sem offsets absurdos, o mapa afim segue
coerente e o `gridDiagnosis` saiu `ok`. Ela é inerte-a-prejudicial na posição
de calibração, não instável.

**O que fica registrado como ressalva de leitura:** `trainErrorPx` mais que
dobrou (21,3 → 50,7 px), e esse número é calculado chamando os regressores
diretamente, **sem passar pela compensação** — então ele descreve a qualidade
das amostras de calibração, não o efeito da flag. Parte do 1,03° de diferença
vem daí. A decisão do operador foi tratar essa diferença como não material e
fechar a análise; quem for repetir a comparação deve mirar `trainErrorPx`
próximo de 21 px para isolar o efeito da compensação sozinha.

**A segunda pergunta de M4 continua sem resposta**, e não por interpretação:
ela exige deslocar a pessoa de propósito, e nenhuma sessão fez isso. Se a
compensação ajuda **sob reposicionamento** — que é o caso de uso que o produto
persegue — é medição que ainda não existe.

### 4.4 Como comparar as quatro

Todas contra M1, termo a termo. O que torna a comparação legítima:

- mesma pessoa, mesma distância, mesmo viewport, `?diagonal=` presente nas
  quatro;
- `geometry.assumed: false` nas quatro;
- `calibrationFit.targetsSkipped` vazio nas quatro — uma calibração incompleta
  não é comparável com nada;
- `pipeline.runtime` conferido: mesmo provider, mesmo recorte, sem fallback.

Com N = 1 por condição, uma diferença menor que a variação entre duas
calibrações da mesma condição não significa nada. Como não temos réplica, trate
qualquer diferença pequena como inconclusiva e diga isso ao relatar.

### 4.5 Adiado — deriva em dois blocos

**Não faz parte do plano das quatro sessões.** Fica registrado aqui porque o
número existe e a pergunta continua de pé.

O desenho: uma calibração, duas rodadas contra ela — T+1 min e T+10 min, sem
recalibrar, com a pessoa usando o app normalmente no intervalo. Varia só o
tempo. `meta.blocoDeMedicao` é derivado do instante do treino, então as rodadas
se numeram sozinhas (1, 2, 3…) e voltam a 1 quando se recalibra.

**Por que está adiado:** o desenho trata mudança de postura como contaminação a
ser segurada. Para o público-alvo, reposicionamento não é contaminação — é o
caso de uso. Um protocolo que mede a robustez a reposicionamento (postura como
variável independente, não como constante) responde a uma pergunta mais útil
para este produto, e M4 é o primeiro passo nessa direção.

Referências de magnitude, para quando a medição voltar: Nyström et al. (2013)
mediram ~0,23° de degradação entre 6 e 19 min; o estudo da *Vision* (2025)
trata correções afins como válidas por cerca de 10 min; Feit et al. relatam de
3 a 10 recalibrações por dia com 6 usuários com ELA.


## 5. Como rodar uma sessão

### 5.1 Build

Sempre reconstrua depois de mexer no código — o `preview` serve o bundle, não o
fonte.

```bash
npm --prefix frontend run build && npm --prefix frontend run preview
```

Confira o carimbo de build no canto da tela de calibração para descartar cache.

### 5.2 URL da condição

```
http://127.0.0.1:4173/?preflight=1&debug=1&ep=webgpu&l2cs=448&filtro=oneEuro&diagonal=23.6
```

| parâmetro | valores | efeito |
|---|---|---|
| `preflight=1` | | painel de verificação de prontidão |
| `debug=1` | | HUD com fps, latência e provider |
| `ep=` | `auto` · `webgpu` · `wasm` · `off` | onde o L2CS roda |
| `l2cs=` | `224` · `448` | lado do recorte facial |
| `filtro=` | `oneEuro` · `kalman` · `kalmanEma` | filtro temporal |
| `diagonal=` | polegadas | diagonal real do monitor (grava procedência `manual`) |
| `cursorNoTeste=` | `1` · `0` | cursor visível durante o teste (diagnóstico) |
| `compTranslacao=` | `1` · `0` | compensação de translação lateral da cabeça (M4) |

Os valores são gravados no localStorage e a página recarrega uma vez. Também
dá para usar `__irisflowExp.set({...})` + reload, ou `IRISFLOW_EXP_<chave>` no
Electron.

⚠️ O preflight tem checagem de "condição esperada" mas o painel **não passa
`condicaoEsperada`** — ela nunca roda. Confira à mão com `__irisflowExp.dump()`
no console (DevTools em janela separada: ancorado na lateral ele rouba viewport
e bloqueia o preflight).

### 5.3 Ambiente físico

- Monitor em **60 Hz**, brilho fixo e anotado.
- OneDrive e programas pesados pausados; o piso de fps é 15.
- Câmera de maior resolução disponível — abaixo de 1280 px de largura o
  preflight bloqueia.
- Janela **maximizada**. O preflight bloqueia com largura < 95 % da tela ou
  altura < 80 %.
- Luz **frontal difusa**, nunca contraluz. Não medimos lux (§3.1), mas a
  regra de posicionamento continua valendo: luminária atrás do monitor
  apontando para a pessoa, nunca atrás dela.
- A pessoa senta na posição que vai manter a sessão inteira. A calibração
  congela a distância, e deriva de pose entre calibrar e testar é a maior fonte
  de erro do pipeline.

### 5.4 Preflight

Vá para `/calibration-check` e espere ~12 s (o painel roda sozinho; há botão
"verificar" para repetir). O item `calibração — não há calibração ativa` é
**esperado** antes de calibrar: ele só fica verde depois do treino.

> **Todos os itens verdes exceto `calibração`.** Qualquer outro bloqueio se
> resolve antes de calibrar.

| item | bloqueia quando |
|---|---|
| `engine` | estado de erro |
| `geometria` | diagonal ou distância ≤ 0 |
| `viewport` | falta largura (DevTools ancorado, janela não maximizada) ou altura |
| `fps` | < 15 fps |
| `câmera` | < 1280 px de largura |
| `L2CS` | status ≠ `ready`, ou > 10 % de leituras obsoletas |
| `L2CS · fila` | submissões sem resposta e 0 Hz — worker travado |
| `filtro` | cadeia degradada por falta de geometria |
| `distância medida` | *(só atenção)* FOV não configurado |

Anote o viewport exato que o painel mostra: ele precisa ser o mesmo em todas as
rodadas da sessão.

⚠️ Os painéis `preflight` e `debug` referenciam classes CSS (`.preflight*`,
`.hud*`) que não existem em nenhum arquivo. Sem estilo, renderizam no fluxo
normal e empurram a página para baixo. Clique em **"recolher"** depois de ler o
veredito.

### 5.5 Calibração e teste

Ver a seção 6 para o que a calibração faz. Na tela: escolha a condição óptica,
clique no botão de **9 pontos**, e a pessoa olha o centro escuro de cada alvo
até ele sumir (~26 s).

- **Não troque de janela durante a coleta** — perder o foco aborta a calibração.
- **Ao terminar o último alvo a tela congela ~11 s.** O diagnóstico de ajuste
  roda dentro do treino. É esperado; não clique em nada.
- Se aparecer o **diálogo de deriva** ou aviso de **alvos pulados**, escolha
  "Refazer calibração". "Continuar mesmo assim" mede um ajuste que o próprio
  app já sinalizou como contaminado.

O teste dispara sozinho 400 ms depois do treino. Durante os 31 s: ninguém fala,
ninguém entra na sala, ninguém mexe na luz. **Não saia da tela com o teste em
curso** — falta o `abortAccuracyTest` no unmount, e `isAccuracyTesting` fica
preso em `true`, sumindo com o painel de preflight pelo resto da sessão.

---

## 6. Calibração

- 9 alvos (completo) ou 4 (rápido), em ordem embaralhada pela UI, posicionados
  pelo orçamento de excentricidade (`MAX_ECCENTRICITY_DEG = 16`, que na tela de
  referência põe a grade em ~17/83 %). A ordem da calibração é sorteada mas
  **não tem semente registrada** — só o teste de precisão tem.
- Cada alvo descarta os primeiros 600 ms (`CALIBRATION_ACCLIMATION_MS`) e
  coleta de 1680 ms (centro) a 2800 ms (canto). Na grade real, ~2,3 s no centro
  e ~3,0 s nos cantos, ~26 s no total.
- **Não há mais gates de amostra.** Quadro com imagem ruim (olho escuro,
  estourado, borrado, pálpebra semifechada) e amostra com bloco L2CS zerado
  (leitura obsoleta ou implausível) **entram no treino**. Os critérios
  continuam sendo avaliados e contados — a contagem alimenta o console e
  `calibrationFit.l2csValidFraction` —, mas não rejeitam mais nada.
  **Por quê:** com os gates ligados, os alvos da linha inferior esgotavam as
  tentativas e eram PULADOS, e o modelo passava a extrapolar a região inteira,
  que é o modo de falha pior. **O preço:** um zero, depois do StandardScaler,
  vira z-score grande dizendo "olhando para o centro"; espere
  `l2csValidFraction < 1` como rotina.
- Um alvo que não coleta quadro nenhum também não é refeito — segue, e aparece
  em `calibrationFit.targetsSkipped`. **Alvo pulado continua invalidando a
  rodada**: um modelo sem parte da grade não é comparável.
- Treino: expansão polinomial de grau 2, StandardScaler e Ridge com penalidade
  anisotrópica, λ por validação cruzada leave-one-target-out, por olho. Os
  alvos são compensados pela pose de cada amostra (`poseCompensatedTargets`).
- O instante do treino é gravado e vira `protocolo.minutosDesdeCalibracao` e o
  número do bloco. Ele descreve o **modelo em uso**: descartar a calibração o
  zera, e ativar um perfil salvo instala o instante em que *aquele* perfil foi
  treinado.
- Recalibre **entre condições** (filtro, provider, tamanho do L2CS,
  compensação): é o que separa M1, M2, M3 e M4 umas das outras. Trocar a flag
  sem recalibrar mistura duas condições no mesmo modelo. Dentro de uma linha de
  medição que compara rodadas contra o MESMO modelo (§4.5), o oposto vale: não
  recalibre.

Nyström et al. (2013) mostram que a experiência de quem opera importa: a mesma
pessoa calibrada por operadores diferentes rende números diferentes. Registre
quem operou.

---

## 7. O relatório

`accuracy-report-<timestamp>.json` na raiz do projeto (via endpoint do Vite, em
dev e preview). Fora do Vite, o navegador baixa o arquivo. Nunca são apagados
pelo app.

A raiz é área de trabalho, não arquivo: `/accuracy-report-*.json` está no
`.gitignore` (ancorado na raiz), então um relatório recém-gravado **não é
versionado**. Para preservar um, mova para **`docs/medicoes/historico/`** — o
padrão do `.gitignore` não alcança essa pasta, e é lá que ficam os relatórios
citados na §14.

Esquema `irisflow.accuracy-report/2`:

| bloco | conteúdo |
|---|---|
| `timestamp`, `resolution` | quando e em que viewport |
| `abortado` | `null` no caminho normal; o motivo quando o vigia interrompeu. Preenchido = parcial |
| `protocolo` | `pontos`, `coletaMs`, `acomodacaoMs`, `janelaUtilMs`, `fracaoMinimaDeAmostras`, `ordem`, `sementeDaOrdem`, `minutosDesdeCalibracao` |
| `meta` | data, `blocoDeMedicao` (derivado), iluminação e movimento de cabeça (**medidos** da prontidão), óculos (do reflexo especular medido), minutos de sessão, distância, diagonal e procedência, escala do SO, `observacoes` |
| `pipeline` | `variant`, features, dimensões do L2CS, regressor, **snapshot completo das flags** (`experiment`) e `runtime` (provider efetivo, fallback, latência e staleness do L2CS, recorte, filtro, fps, resolução do vídeo) |
| `result` | as métricas da seção 8 |
| `diagnostics` | um objeto por ponto: posição real, predição média, erro por eixo, viés, graus, tremor, `bceaPx2`, `nSamples`, `nEsperado`, `fracaoValida`, pose média |
| `distanceRange` | distância de calibração e de teste, e se a compensação estava na faixa |
| `calibrationFit` | diagnóstico do ajuste (seção 10) |
| `geometry` | se a diagonal foi assumida, fonte, `distPx`, `pxPorCm`, escala, viewport e tela em px |

**`meta.observacoes` diz se a prontidão foi medida.** Quando há avaliação
recente, traz os valores medidos e a idade da leitura; quando não há, diz
explicitamente que iluminação e postura são o *default do schema*, não uma
medição. Antes, `'boa'`/`'parada'` eram gravados hardcoded com a mesma cara de
um valor medido.

---

## 8. Métricas de `result`

| campo | unidade | população | como ler |
|---|---|---|---|
| `meanError`, `medianError`, `p90Error` | px | interiores | erro por ponto. A mediana resiste a um ponto ruim; o p90 mostra o pior caso típico |
| `meanErrorX`, `meanErrorY` | px | interiores | erro absoluto por eixo. Y costuma ser pior: o sinal vertical da íris é menor |
| `biasX`, `biasY` | px, assinado | interiores | predito − alvo. Grande e uniforme = pose ou geometria; pequeno com erro alto = ruído |
| `maxError` | px | todos | pior ponto |
| `errorPct` | % da diagonal | interiores | erro relativo ao tamanho da tela |
| `meanErrorDeg` | graus | interiores | acurácia angular; comparável entre sessões só se `geometry.assumed = false` |
| `meanErrorInner`, `meanErrorEdge` | px | interiores / bordas | separa centro de periferia |
| `jitterRMS` | px | todos | precisão STD: dispersão 2D em torno da média do ponto |
| `precisionSdX`, `precisionSdY` | px | todos | desvio-padrão por eixo. `sdY > sdX` é o esperado, e define a proporção do botão (seção 9) |
| `precisionS2S` | px | todos | tremor rápido, sem deriva lenta. Depende da taxa de amostragem |
| `precisionDeg` | graus | todos | `jitterRMS` convertido no centro da tela |
| `bceaPx2`, `bceaDeg2` | px², graus² | interiores | área da elipse de 68 %, média dos pontos. Enxerga anisotropia |
| `jitterFilteredRMS` | px | todos | tremor do cursor (saída filtrada) |
| `sampleMeanError`, `sampleMedianError`, `sampleP90Error` | px | todas as amostras | erro por amostra: é o que o dwell sente |
| `hitRateByRadius` | % | todas as amostras | fração dentro de alvos de 60/100/150/200 px |
| `sampleRateHz` | Hz | | amostras por segundo de janela útil; abaixo de ~20 a máquina está sobrecarregada |
| `fracaoDeAmostrasValidas` | 0–1 | pontos com ≥ 2 amostras | perda de dados do teste. Leia junto com `pontosNaoMedidos` |
| `pontosComPoucaAmostra` | lista | pontos com ≥ 2 amostras | abaixo de 80 % dos quadros esperados. Marcados, não removidos |
| `pontosMedidos`, `pontosNaoMedidos`, `nInterior`, `nEdge` | | | tamanho das populações; métrica com população zero é `null`, nunca 0 |
| `alvoMinimoPx`, `alvoMinimoDeg` | px, graus | | lado do botão que acomoda este usuário (seção 9) |
| `distanciaMedidaCm` | cm | | mediana, mín. e máx. da distância olho→câmera durante o teste |
| `affine` | | interiores | ganho, cisalhamento e offset de um mapa afim ajustado ao erro; `explainedFraction` alta = mapeamento coerente (recalibrar resolve), baixa = ruído |
| `poseDrift` | rad | | deriva de pose durante o teste, relativa ao primeiro ponto |
| `poseDeltaCalibToTestDeg` | graus | | pose média do teste menos a da calibração; explica viés uniforme |
| `validationOverlap` | | | coincidências entre as duas grades (deveria ser vazio) |

### 8.1 Distância: medida versus digitada

| campo | o que é | origem |
|---|---|---|
| `meta.distanciaCm` | distância olho→**tela** | **digitada** nas Configurações. É intenção; nenhum sensor mede a distância até a tela |
| `result.distanciaMedidaCm` | distância olho→**câmera**, mediana/mín./máx. | **medida** a cada amostra aceita, da distância interpupilar em px e do FOV (§3.2) |

O erro angular usa `meta.distanciaCm`, porque é a distância até a tela que
define a excentricidade dos alvos. `distanciaMedidaCm` é testemunha: faixa
min–max larga = a pessoa se moveu, e os graus daquela rodada valem menos. No
setup recomendado (câmera perto, tela longe) os dois números são
legitimamente diferentes — não os compare como se um confirmasse o outro.

---

## 9. Do erro medido ao tamanho dos botões

Regra de Feit et al. (2017):

```
S = 2 · (offset + 2σ)
```

`offset` é o erro médio (acurácia) e `σ` o desvio-padrão (precisão). O app
calcula em `tamanhoMinimoDeAlvo()` e reporta em `alvoMinimoPx`/`alvoMinimoDeg`,
usando o `meanError` dos interiores como offset e o **pior** eixo
(`max(precisionSdX, precisionSdY)`) como σ.

É o único número que combina as duas populações da seção 2: o offset vem só dos
interiores, o σ de todos os pontos medidos, bordas inclusive. É deliberado — um
botão de canto precisa acomodar a dispersão que existe no canto — mas quem
comparar `alvoMinimoPx` entre sessões precisa saber que ele carrega a periferia
dentro.

1. **É um piso, não uma meta.** Um botão menor obriga a pessoa a "mirar", que é
   o que o dwell não perdoa.
2. **Alvos mais altos que largos.** σ é maior em Y. Se `sdY > sdX` de forma
   consistente, a regra atual da interface do paciente (mínimo 160×120 px, mais
   larga que alta) está na proporção **oposta** à que a medição pede.
3. **Periferia pede mais.** Um botão de canto dimensionado pelo centro estará
   subdimensionado.
4. **Por usuário, não por média.** Feit et al. mediram variação de mais de 6×
   entre participantes; diferenças individuais explicaram 32,8 % da variância
   contra 8,3 % de iluminação e rastreador somados. Tamanho de alvo é
   configuração de pessoa, não constante do produto.

---

## 10. Diagnóstico do ajuste (`calibrationFit`)

| campo | como ler |
|---|---|
| `trainErrorPx` | erro nas próprias amostras de treino. Alto = o modelo não representa nem o treino |
| `looErrorPx`, `looByTarget` | erro leave-one-target-out. Comparar com o erro do teste separa "o modelo é o limite" de "algo mudou entre calibrar e testar". **`loo` muito acima de `train` = decorou ruído** |
| `poseMean`, `poseStd`, `poseDrift` | pose na calibração; a deriva **entre** alvos é a que importa (~4° já confunde pose com olhar) |
| `gridDiagnosis` | distingue "a periferia saiu do alcance" de "a sessão inteira está ruim" |
| `l2csValidFraction` | fração das amostras de treino com bloco L2CS válido. Com os gates removidos (§6), abaixo de 1 é rotina |
| `samplesPerTarget` | amostras por alvo; desequilíbrio grande enviesa o ajuste |
| `targetsPlanned`, `targetsTrained`, `targetsSkipped` | alvo pulado invalida a rodada |
| `lambda`, `dimsPerEye`, `polynomialFeatures`, `poseCompensatedTargets` | o que entrou no Ridge |

---

## 11. Como interpretar um resultado

1. `abortado`: preenchido = parcial. Pare aqui.
2. `geometry.assumed` e `meta.distanciaCm`: geometria assumida = graus são
   estimativa.
3. `result.fracaoDeAmostrasValidas` e `pontosComPoucaAmostra`: erro baixo sobre
   metade dos quadros não é erro baixo.
4. `calibrationFit.targetsSkipped`: qualquer alvo fora do treino invalida a
   comparação.
5. `pipeline.runtime.l2csFallback` e `l2csStalePct`: se o L2CS caiu para WASM
   ou ficou obsoleto, a sessão não mede a condição pretendida.
6. `calibrationFit.looErrorPx` contra `trainErrorPx`: distância grande entre os
   dois é overfitting — o modelo decorou ruído.
7. `result.biasX/Y` contra `poseDeltaCalibToTestDeg`: viés uniforme com delta
   de pose de alguns graus = a pessoa se mexeu entre calibrar e testar.
   Recalibrar resolve; nada no pipeline resolve.
8. `affine.explainedFraction`: alta = mapa errado (recalibrar); baixa = ruído
   (luz, resolução da câmera, distância). Ver §3.1 antes de descartar a luz.
9. `result.distanciaMedidaCm`: faixa min–max larga = a pessoa se moveu.
10. Só então `meanErrorDeg`, `bceaDeg2` e `precisionDeg`.

**Não existe limiar universal de "dado aceitável".** Niehorster et al. (2026)
retomam McConkie (1981) nisso: o que conta como qualidade suficiente depende da
pergunta. A nossa é operacional — o dwell acerta o botão? — e quem responde é
`hitRateByRadius` e `alvoMinimoPx`.

Para comparar duas condições (ex.: `oneEuro` contra `kalmanEma`): mesma pessoa,
mesma distância, recalibração entre elas, ao menos 3 repetições por condição,
ordem contrabalanceada. Compare `meanErrorDeg`, `bceaDeg2`, `sampleP90Error` e
`hitRateByRadius`, e registre a URL da condição.

---

## 12. Registro manual

Quase tudo agora é capturado pelo código. Sobra anotar, junto do nome do
arquivo:

```
2026-09-06  accuracy-report-1788735147497.json  bloco 1  webgpu/448/oneEuro
operador: __   brilho do monitor: __%   apoio: reclinado ~__°
pontos refeitos: __
```

Brilho do monitor, quem operou, apoio físico e pontos refeitos continuam fora
do alcance do código. Lux saiu do protocolo (§3.1).

### 12.1 Checklist de relato reprodutível

Baseado em Dunn et al. (2023).

| item | o que o guia pede | onde está |
|---|---|---|
| **A4** | frequência de amostragem e irregularidade | `result.sampleRateHz`; `diagnostics[].nEsperado` e `fracaoValida`; `runtime.fpsRender` |
| **A5** | restrição de cabeça | `meta.movimentoCabeca`; **nunca há queixeira** (§3.3); `poseDrift` e `poseDeltaCalibToTestDeg` |
| **A8** | iluminação | ⚠️ **não atendido** — ver §3.1. `meta.iluminacao` é o binário do frame, não do ambiente |
| **A9** | calibração: método, alvos, duração, critérios | §6; `calibrationFit`; `protocolo.minutosDesdeCalibracao`; `meta.blocoDeMedicao` |
| **A10** | incerteza / precisão | `jitterRMS`, `precisionSdX/Y`, `precisionS2S`, `bceaPx2/Deg2`, `precisionDeg` |
| **A11** | processamento do sinal | `pipeline.experiment`; `jitterFilteredRMS` contra `jitterRMS` |
| **A12** | perda de dados em % e distribuição | `fracaoDeAmostrasValidas`, `diagnostics[].fracaoValida`, `pontosComPoucaAmostra`, `pontosNaoMedidos` |
| **C1** | distância, faixa, dimensões da tela | `meta.distanciaCm`, `result.distanciaMedidaCm`, `meta.telaPolegadas` + `geometry.source`, `geometry.pxPorCm`, `geometry.viewportPx` |

Ao publicar, cite também: versão do app (`runtime.appVersion`), modelo da
câmera e resolução efetiva, provider do L2CS e se houve fallback, número de
sessões descartadas e por quê, e **a seção 3 inteira**.

---

## 13. Valores de comparação da literatura

Erro angular médio, salvo indicação.

| sistema / estudo | acurácia | contexto |
|---|---|---|
| WebGazer (webcam, browser) | 4,17° | referência clássica de webcam |
| FAZE / deep learning em navegador | 2,4° (STD 0,47°, ~30 fps) | distância pelo método do ponto cego |
| L2CS-Net (o modelo que usamos) | 3,92° em MPIIGaze; 10,41° em Gaze360 | erro do modelo isolado, em benchmark |
| WebET 3.0, 255 participantes | 92 % abaixo de 5,5°; 70 % abaixo de 3,0° | distribuição, não média — o formato certo para webcam |
| **IrisFlow, rodada válida de 2026-09-06** | **1,86°** | ver seção 14. Abaixo do L2CS-Net isolado em MPIIGaze |
| Feit et al. (2017), IR remoto, 80 participantes a 65 cm | 0,47 cm X / 0,57 cm Y (≈ 0,41° / 0,50°) | percentis X/Y: 25 % 0,15/0,20 cm · 50 % 0,31/0,45 · 75 % 0,58/0,78 · 90 % 0,93/1,19 cm. Perda média 7,9 % |
| Feit et al., 6 usuários com **ELA** | 90º percentil 1,32–1,67 cm | 3 a 10 recalibrações por dia |
| Tobii Pro Nano, validações **aceitas** | 0,54–0,69° | *Vision* 9(2):29, 2025 |
| EyeLink 1000Plus, validações **aceitas** | 0,75–0,86° | critério de boa validação: pior ponto ≤ 1,5° e erro médio ≤ 1,0° |

**Faixa honesta:** webcam 2–4°, infravermelho de laboratório 0,5–1°. A rodada
válida (1,86°) fica na borda boa da faixa de webcam e ainda uma ordem de
grandeza acima do IR.

O L2CS-Net sozinho erra 3,92° em MPIIGaze, e ficamos abaixo disso. Não é
contradição nem motivo para comemorar demais: o benchmark mede o modelo em
sujeitos e ambientes que ele nunca viu, enquanto aqui ele opera **calibrado
para uma pessoa, uma câmera e uma tela**, com o Ridge por olho corrigindo o
viés individual. É a comparação certa a fazer — desde que fique claro que
1,86° descreve este usuário neste posto de uso, não a acurácia do IrisFlow
para um usuário qualquer. Com N = 1, a distribuição por ponto (§8) diz mais que
a média.

**Por que não comparar com datasheet de fabricante.** Especificações são
medidas com queixeira, participante restrito e iluminação controlada.
Niehorster et al. (2018): em cinco rastreadores comerciais, rotação de *yaw*
causou perda de dados em ~50 % dos trials em alguns aparelhos, e *roll* produziu
offsets em **todos** os cinco. Comparar o nosso número com um datasheet é
comparar duas coisas diferentes.

---

## 14. Hardware de referência e histórico

| item | valor | consequência |
|---|---|---|
| Monitor Mancer Valak 24 (MCR-VLK24-BL01) | diagonal 23,6″, área ativa 52,25 × 29,39 cm, 36,75 px/cm em 1920×1080 | entra em `pxPorCm` e no erro angular; é o `default` do app |
| Curvatura R1650 | borda a 63,5 cm com o centro a 60 | o modelo trata a tela como plana; a curvatura reduz o desvio de 9 % para 6 % |
| 180 Hz | fixar em 60 Hz | o loop roda na taxa do monitor e a câmera a 30 fps |
| Câmera 1920×1080, FOV nominal 69,7° | erro interior 123 px | contra 144 px com 1280×960: o erro escala com o inverso da densidade de pixels sobre o olho |
| Distância nominal | 60 cm | premissa da grade de calibração e do harness sintético |

### 14.1 Sessões medidas

Os relatórios preservados vivem em `docs/medicoes/historico/`. As duas rodadas
descartadas por alvos pulados e o par de deriva foram apagados ao enxugar o
plano de medição: os números seguem aqui como registro, sem arquivo bruto por
trás — **não são reanalisáveis**.

| data | condição | erro | angular | `jitterRMS` | situação |
|---|---|---|---|---|---|
| 2026-09-05 | sem óculos, esquema antigo | 123 px | 3,18° | 38,1 px | `accuracy-report-1788579312251.json` |
| 2026-09-05 | óculos simples, esquema antigo | 144 px | 3,74° | 19,7 px | `accuracy-report-1788580524778.json` |
| 2026-09-06 20:21 | **M1, One Euro** | **74 px** | **1,86°** | 21,8 px | ✅ `accuracy-report-1788736866711.json` |
| 2026-09-06 19:22 | One Euro | 180 px | 4,58° | 43,2 px | descartada — 3 alvos fora do treino, incluindo o centro |
| 2026-09-06 19:52 | One Euro | 113 px | 2,85° | 38,2 px | descartada — 2 alvos da linha inferior sem amostra |
| 2026-09-07 00:25 | **M2, Kalman** | 136 px | 3,44° | 58,3 px | `accuracy-report-1788740744920.json` — filtro amplificou o tremor 3,19×; 1 alvo pulado |
| 2026-09-07 00:31 | **M3, Kalman+EMA** | 76 px | 1,93° | 34,4 px | `accuracy-report-1788741070521.json` — sessão limpa; filtro amplificou 5,93×; 1 alvo pulado |
| 2026-09-07 00:36 | **M4, compensação lateral** | 115 px | 2,89° | 36,0 px | `accuracy-report-1788741409103.json` — compensação não melhora em posição fixa; 1 alvo pulado |
| 2026-09-06 20:36 | deriva T+1 min | 87 px | 2,19° | 53,1 px | linha adiada (§4.5) |
| 2026-09-06 20:45 | deriva T+10 min | 152 px | 3,87° | 30,7 px | linha adiada (§4.5) |

⚠️ As duas de 2026-09-05 são de um esquema anterior ao `/2` e de um protocolo
anterior a este documento (janela útil ~800 ms, ordem fixa, sem BCEA, sem
fração de amostras válidas). Valem como ordem de grandeza, não para comparação
ponto a ponto.

O detalhamento de M1 está na §4.1.

### 14.2 Medição preliminar de deriva *(linha adiada)*

Registro do que foi observado antes de a deriva sair do plano (§4.5). Uma
calibração, duas rodadas: T+1 min e T+10 min, com a pessoa saindo da cadeira no
intervalo.

O erro subiu 1,68° (2,19° → 3,87°), e a leitura é que o aumento foi **postura,
não deriva do modelo**: a precisão *melhorou* (`jitterRMS` 53 → 31 px) enquanto
a acurácia piorou — combinação que só um offset sistemático produz, já que
degradação de sinal pioraria as duas. O viés vertical inverteu 190 px, a
distância medida subiu de 47,3 para 51,5 cm, e o mapa afim ficou *mais*
explicável (`explainedFraction` 0,55 → 0,60). Dentro de cada rodada a faixa de
distância foi de ±1 cm: o movimento aconteceu entre elas.

O par não era limpo — `geometry.assumed: true`, viewport mudou de 1920 para
1914 px, 1 alvo pulado na calibração e `sampleRateHz` 17,9 na primeira rodada.
Serve como indicação, não como medida.

**Por que isso motivou adiar a linha inteira:** um protocolo que trata
reposicionamento como contaminação a ser segurada responde à pergunta errada
para este produto. M4 (§4.3) é o primeiro passo na direção certa.

### 14.3 Estado atual

**As quatro medições do plano (§4) estão feitas.** Resultado consolidado:

| medição | condição | erro | métrica-chave | conclusão |
|---|---|---|---|---|
| **M1** | One Euro | **1,86°** | razão filtro 0,99 | referência do projeto |
| **M2** | Kalman | 3,44° | razão filtro **3,18** | amplifica o tremor do cursor |
| **M3** | Kalman + EMA | 1,93° | razão filtro **5,93** | amplifica ainda mais; o EMA não corrige |
| **M4** | compensação lateral | 2,89° | — | não melhora em posição fixa |

**O que o projeto pode afirmar a partir daqui:**

1. **Acurácia de 1,86°**, reproduzida em 1,93° numa segunda calibração
   independente — dentro da faixa de webcam da literatura (2–4°) e abaixo do
   erro do L2CS-Net isolado em MPIIGaze (3,92°). Ver a ressalva de N = 1 em
   §13.
2. **One Euro é o filtro correto**, por medição e não por premissa: as duas
   alternativas pioram o tremor do cursor por fatores de 3 a 6.
3. **A compensação de translação lateral fica desligada**, por medição: não
   melhora a acurácia em posição fixa.
4. **Reprodutibilidade entre sessões limpas: ~0,1°.** É a régua para julgar
   qualquer diferença futura.

**Três coisas que ficaram por medir, e é honesto listá-las:**

- **Robustez a reposicionamento.** A segunda pergunta de M4 (§4.3) exige
  deslocar a pessoa de propósito; nenhuma sessão fez isso. É a medição mais
  relevante para o caso de uso do produto e ela não existe.
- **Deriva ao longo do tempo** (§4.5), adiada.
- **O efeito do filtro sobre o dwell.** Nenhuma métrica do relatório o mede:
  `hitRateByRadius` é calculado sobre o sinal bruto e o dwell consome o
  filtrado (§4.2).

**Padrão aberto: a linha inferior da grade.** Sete das nove calibrações do
período deixaram alvos de `y = 0,95` fora do treino, e nunca outra linha. Com
os gates de amostra removidos (§6), um alvo só fica de fora se não coletar
quadro nenhum — é perda de rosto quando o olhar desce, não rejeição de
amostra. Continua sendo o problema mais barato de atacar: cada alvo recuperado
tira uma extrapolação do modelo, e as quatro medições acima foram feitas com
esse déficit presente em três delas.

---

## 15. Harness sintético

`src/testUtils/pipelineHarness.ts` roda o pipeline completo sobre trajetórias
sintéticas determinísticas (centro, bordas, cantos, transições, perda de rosto,
deriva de pose de 5°) e compara com `src/testUtils/harness-baseline.json`. É o
gate de regressão de `npm test`, não uma medida de acurácia real: os números só
têm sentido relativos ao baseline. Para regenerar, com revisão do diff:

```bash
IRISFLOW_WRITE_BASELINE=1 npx vitest run src/testUtils/writeBaseline.test.ts
```

---

## 16. Referências

- Tobii, *Accuracy and precision test method for remote eye trackers*, v2.1.1 —
  https://stemedhub.org/resources/3311/download/Tobii_Test_Specifications_Accuracy_and_PrecisionTestMethod_version_2_1_1_.pdf
- Dunn et al. (2023), *Minimal reporting guideline for research involving eye
  tracking*, Behavior Research Methods —
  https://link.springer.com/article/10.3758/s13428-023-02187-1
- Niehorster et al. (2026), *The fundamentals of eye tracking, Part 7:
  Determining data quality*, Behavior Research Methods —
  https://link.springer.com/article/10.3758/s13428-026-03039-4
  (ETDQualitizer: https://github.com/dcnieho/ETDQualitizer)
- Feit et al. (CHI 2017), *Toward Everyday Gaze Input* —
  https://cs.stanford.edu/~merrie/papers/everyday_eyetracking.pdf
- Nyström et al. (2013), *The influence of calibration method and eye physiology
  on eyetracking data quality* —
  https://link.springer.com/article/10.3758/s13428-012-0247-4
- Niehorster et al. (2018), *The impact of slippage on the data quality of
  head-worn / remote eye trackers* —
  https://link.springer.com/article/10.3758/s13428-017-0863-0
- Thaler et al. (2013), *What is the best fixation target?*, Vision Research —
  https://pubmed.ncbi.nlm.nih.gov/23099046/
- *Vision* 9(2):29 (2025) — https://www.mdpi.com/2411-5150/9/2/29
- Papoutsaki et al. (2016), *WebGazer*, IJCAI —
  https://cs.brown.edu/people/apapouts/papers/ijcai2016webgazer.pdf
- FAZE, Behavior Research Methods —
  https://link.springer.com/article/10.3758/s13428-023-02190-6
- iMotions, *WebET 3.0 validation study* (255 participantes) —
  https://imotions.com/blog/learning/product-news/webcam-eye-tracking-validation-study/
- Abdelrahman et al. (2022), *L2CS-Net* — https://arxiv.org/abs/2203.03339
- *Webcam-based online eye-tracking for behavioral research*, Judgment and
  Decision Making —
  https://www.cambridge.org/core/journals/judgment-and-decision-making/article/webcambased-online-eyetracking-for-behavioral-research/B726E77B68A76577F9BC6BB8F1EBC6E4
- OHSU, *SSVEP-BCI and Eye Tracking Use by Individuals with Late-Stage ALS and
  Visual Impairments* —
  https://www.ohsu.edu/sites/default/files/2021-04/SSVEP-BCI-and-Eye-Tracking-Use-by-Individuals-with-Late-Stage-ALS-and-Visual-Impairments.pdf
- **Retratado, não citado como fonte:** Holmqvist et al. (2023) —
  https://link.springer.com/article/10.3758/s13428-021-01762-8
