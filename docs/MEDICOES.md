# Medições de acurácia e precisão

Este é o único documento de referência do projeto sobre medição. Ele descreve
o protocolo, o significado de cada métrica, como registrar e interpretar um
relatório e o hardware de referência. Se algo aqui divergir do código, o
código (`src/accuracy.ts`, `src/accuracyProtocol.ts`, `src/calibration.ts`)
é a verdade e este arquivo precisa ser corrigido.

## 1. O que é medido

| termo | significado | onde aparece |
|---|---|---|
| **acurácia** (erro) | distância entre o ponto que o paciente olha e o ponto que o sistema estima. Média das predições de um alvo contra a posição real do alvo. | `result.meanError` (px), `result.meanErrorDeg` (graus) |
| **precisão** (tremor) | dispersão das estimativas em torno da própria média enquanto o olhar está parado. Não depende de o sistema acertar o alvo. | `result.jitterRMS` (px), `result.precisionDeg` (graus) |
| **viés** | erro assinado médio por eixo. Um viés uniforme em todos os alvos denuncia deriva de pose ou geometria de tela errada, não ruído. | `result.biasX`, `result.biasY` |
| **taxa de acerto** | fração das amostras que caem dentro de um alvo de raio R centrado no ponto. É a métrica mais próxima do que o dwell sente. | `result.hitRateByRadius` (R = 60, 100, 150, 200 px) |

Acurácia e precisão são independentes: um sistema pode tremer pouco e estar
sempre 100 px à esquerda (preciso e inexato), ou estar centrado e tremer
muito (exato e impreciso). O dwell precisa dos dois.

### Pixels versus graus

O erro em pixels depende do tamanho da tela; o erro em graus depende da
distância. Para comparar duas sessões, use graus, e só compare quando as
condições registradas no relatório forem as mesmas.

O erro angular é calculado ponto a ponto, com vetores: o alvo e a predição
são vistos do olho, a uma distância `distPx = distanciaCm × pxPorCm` do
centro da tela, e o erro é o ângulo entre os dois vetores
(`erroAngularDeg` em `src/accuracy.ts`). Isso usa a excentricidade real de
cada alvo em vez de aproximar tudo por `atan(erroPx / distPx)`.

`pxPorCm` vem da diagonal física do monitor. Se a diagonal for o valor
assumido (`geometry.source = 'default'`, 23,6″), o relatório marca
`geometry.assumed = true` e os graus são uma estimativa, não uma medida.
Informe a diagonal real (`?diagonal=` na URL ou nas Configurações) antes de
qualquer sessão cujos graus serão registrados.

## 2. Protocolo do teste de precisão

O teste roda automaticamente ao fim de cada calibração.

**Pontos.** 13 alvos: uma grade 3×3 nas frações 25/50/75 % da tela
(interiores) e 4 alvos de borda a 5/95 %. A grade é fixa e deliberadamente
disjunta da grade de calibração, que é derivada do orçamento de
excentricidade (≤ 16°) e cai em torno de 17/83 %. Validar nas posições do
treino mediria memorização; o relatório grava em `result.validationOverlap`
qualquer coincidência entre as duas grades.

**Tempo por ponto.** 1400 ms de coleta. Os primeiros 600 ms são descartados
(`ACCLIMATION_MS`): é a sacada e a acomodação, e medido em sessões reais o
erro nesse trecho ainda vale o dobro do regime estacionário. Sobram ~800 ms
úteis, cerca de 24 amostras a 30 Hz. Um ponto com menos de 8 amostras
(`MIN_SAMPLES_PER_POINT`) não é medido e conta em `pontosNaoMedidos`.

**Populações.** Todas as métricas principais (`meanError`, `medianError`,
`p90Error`, viés, precisão) usam **só os pontos interiores** (`nInterior`),
porque as bordas sofrem de duas distorções em sentidos opostos (softClamp e
geometria plana). `meanErrorEdge` existe separado e é a métrica menos
confiável do relatório. `maxError` considera todos os pontos.

**Duas fontes de amostra.** O núcleo alimenta o teste com a predição
**bruta** (antes do filtro temporal) e com a predição **filtrada** (o que o
cursor mostra). Acurácia e precisão vêm da bruta; `jitterFilteredRMS` mostra
quanto o filtro reduz o tremor visível.

**Escala verbal.** `score` é derivado do `meanError` em pixels: Excelente
< 30, Bom < 60, Regular < 100, Ruim acima. É um rótulo para a tela do
paciente; para análise use os números.

## 3. Como preparar uma sessão

Uma sessão de medição só vale se as condições forem as mesmas do início ao
fim e estiverem registradas.

1. **Build de produção, não dev-server.** No dev-server o fps oscila e a
   latência medida não representa o produto.
   ```bash
   npm --prefix frontend run build && npm --prefix frontend run preview
   ```
2. **Abra uma URL que declara a condição** e maximize a janela (sem DevTools:
   ele rouba viewport e invalida o preflight):
   ```
   http://127.0.0.1:4173/?preflight=1&debug=1&ep=webgpu&l2cs=448&filtro=oneEuro&diagonal=23.6
   ```
   | parâmetro | valores | efeito |
   |---|---|---|
   | `preflight=1` | | painel de verificação de prontidão |
   | `debug=1` | | HUD com fps, latência e provider |
   | `ep=` | `auto` · `webgpu` · `wasm` · `off` | onde o L2CS roda (`auto` tenta GPU e cai para WASM; o provider efetivo fica no relatório) |
   | `l2cs=` | `224` · `448` | lado do recorte facial |
   | `filtro=` | `oneEuro` · `kalman` · `kalmanEma` | filtro temporal (One Euro é o de produção) |
   | `diagonal=` | polegadas | diagonal real do monitor |

   Os parâmetros são gravados e a página recarrega uma vez. Os mesmos valores
   podem ser definidos pelo console com `__irisflowExp.set({...})` seguido de
   reload, ou pela variável de ambiente `IRISFLOW_EXP_<chave>` no Electron.
3. **Espere o preflight ficar verde** (~15 s com o rosto na câmera). Ele
   bloqueia quando: engine em erro, câmera abaixo de 1280 px de largura, fps
   abaixo de 15, L2CS sem `ready` ou com mais de 10 % de leituras obsoletas,
   viewport reduzido, ou quando as flags ativas divergem da condição
   declarada. "Atenção" não invalida a sessão; "bloqueio" invalida.
4. **Ambiente físico.** Monitor em 60 Hz, brilho fixo e anotado, luz frontal
   difusa estável (a exposição da câmera fica em automático até convergir;
   mudar a luz no meio muda a condição), OneDrive e outros programas pesados
   pausados, câmera de maior resolução disponível.
5. **Sente na posição que vai manter a sessão inteira.** A calibração
   congela a distância. Deriva de pose entre calibrar e testar é a maior
   fonte de erro do pipeline; o relatório a registra em
   `poseDeltaCalibToTestDeg`.

## 4. Calibração (o que precede a medição)

- 9 alvos (modo completo) ou 4 (modo rápido), em ordem embaralhada, posicionados
  pelo orçamento de excentricidade da tela em uso.
- Cada alvo descarta os primeiros 600 ms e precisa de pelo menos 15 amostras
  aceitas (`MIN_ACCEPTED_SAMPLES`). Amostras são rejeitadas por qualidade de
  imagem (olho escuro, estourado, borrado, pálpebra semifechada) e por bloco
  L2CS inválido (leitura obsoleta ou implausível); a tela diz qual foi a
  causa e a contagem. A deriva de pose entre alvos é medida ao fim da
  calibração e, se for grande, a tela recomenda refazer.
- Um alvo que esgota as tentativas é pulado e o relatório grava isso em
  `calibrationFit.targetsSkipped`. A tela avisa e recomenda refazer: um
  modelo treinado sem a linha de baixo prediz a linha de baixo por extrapolação.
- Treino: expansão polinomial de grau 2, StandardScaler e Ridge com penalidade
  anisotrópica, λ escolhido por validação cruzada leave-one-target-out, por
  olho. Os alvos de treino são compensados pela pose de cada amostra
  (`poseCompensatedTargets`), a mesma compensação geométrica aplicada na
  inferência.
- Recalibre entre condições. Trocar filtro, provider ou tamanho do L2CS
  sem recalibrar mistura duas condições no mesmo modelo.

## 5. O relatório

Ao terminar, o teste grava `accuracy-report-<timestamp>.json` na raiz do
projeto (pelo endpoint do Vite, em dev e preview). Fora do Vite (Electron
empacotado) o navegador baixa o arquivo. Os relatórios nunca são apagados
pelo app. Para guardar um, mova para `docs/medicoes/historico/`.

Esquema `irisflow.accuracy-report/2`:

| bloco | conteúdo |
|---|---|
| `timestamp`, `resolution` | quando e em que viewport |
| `meta` | condição declarada pela UI: data, iluminação, óculos, cabeça parada/livre, minutos de sessão, distância (cm), diagonal (″), procedência da diagonal, fator de escala do SO |
| `pipeline` | `variant`, conjunto de features, dimensões do L2CS, regressor, **snapshot completo das flags** (`experiment`) e `runtime` (provider efetivo, se houve fallback, latência e staleness do L2CS, tamanho do recorte, filtro efetivo e preset, fps, resolução do vídeo) |
| `result` | as métricas da seção 6 |
| `diagnostics` | um objeto por ponto: posição real, predição média, erro por eixo, viés, erro em graus, tremor (RMS, SD por eixo, RMS amostra-a-amostra), tremor filtrado, número de amostras, pose média |
| `distanceRange` | distância de calibração e de teste, e se a compensação de distância estava dentro da faixa |
| `calibrationFit` | diagnóstico do ajuste (seção 7) |
| `geometry` | se a diagonal foi assumida, fonte, `distPx`, `pxPorCm`, escala, viewport e tela em px |

## 6. Métricas de `result`

| campo | unidade | população | como ler |
|---|---|---|---|
| `meanError`, `medianError`, `p90Error` | px | interiores | erro por ponto (média das predições contra o alvo). A mediana resiste a um ponto ruim; o p90 mostra o pior caso típico |
| `meanErrorX`, `meanErrorY` | px | interiores | erro absoluto por eixo. Y costuma ser pior: o sinal vertical da íris é menor |
| `biasX`, `biasY` | px, assinado | interiores | predito − alvo. Grande e uniforme = pose ou geometria; pequeno com erro alto = ruído |
| `maxError` | px | todos | pior ponto |
| `errorPct` | % da diagonal do viewport | interiores | erro relativo ao tamanho da tela |
| `meanErrorDeg` | graus | interiores | acurácia angular; só comparável entre sessões se `geometry.assumed = false` |
| `meanErrorInner`, `meanErrorEdge` | px | interiores / bordas | separa o centro da periferia |
| `jitterRMS` | px | interiores | precisão: dispersão 2D em torno da média do próprio ponto |
| `precisionSdX`, `precisionSdY` | px | interiores | desvio-padrão por eixo |
| `precisionS2S` | px | interiores | RMS amostra-a-amostra: tremor rápido, sem a deriva lenta |
| `precisionDeg` | graus | interiores | `jitterRMS` convertido |
| `jitterFilteredRMS` | px | interiores | tremor do cursor (saída filtrada) |
| `sampleMeanError`, `sampleMedianError`, `sampleP90Error` | px | todas as amostras | erro por amostra, não por média do ponto: é o que o dwell sente |
| `hitRateByRadius` | % | todas as amostras | fração dentro de alvos de 60/100/150/200 px |
| `sampleRateHz` | Hz | | amostras por segundo de janela útil; abaixo de ~20 a máquina está sobrecarregada |
| `pontosMedidos`, `pontosNaoMedidos`, `nInterior`, `nEdge` | | | tamanho das populações; qualquer métrica com população zero é `null`, nunca 0 |
| `affine` | | interiores | ganho, cisalhamento e offset de um mapa afim ajustado ao erro; `explainedFraction` alta = o erro é um mapeamento coerente (recalibrar resolve), baixa = ruído |
| `poseDrift` | rad | | deriva de pose durante o teste, relativa ao primeiro ponto |
| `poseDeltaCalibToTestDeg` | graus | | pose média do teste menos pose média da calibração; explica viés uniforme |
| `validationOverlap` | | | pontos de validação que coincidiram com alvos de calibração (deveria ser vazio) |

## 7. Diagnóstico do ajuste (`calibrationFit`)

| campo | como ler |
|---|---|
| `trainErrorPx` | erro do modelo nas próprias amostras de treino. Alto = o modelo não representa nem o treino (features ruins, poucos alvos) |
| `looErrorPx`, `looByTarget` | erro leave-one-target-out: generalização estimada só com dados de calibração. Comparar com o erro do teste é o que separa "o modelo é o limite" de "algo mudou entre calibrar e testar" |
| `poseMean`, `poseStd`, `poseDrift` | pose durante a calibração; a deriva **entre** alvos é a que importa (~4° já confunde pose com olhar) |
| `gridDiagnosis` | distingue "a periferia saiu do alcance" de "a sessão inteira está ruim" |
| `l2csValidFraction` | fração das amostras de treino com bloco L2CS válido; abaixo de 1 o treino viu zeros onde a inferência vê valores. `null` quando o conjunto ativo não usa o L2CS |
| `samplesPerTarget` | amostras aceitas por alvo; desequilíbrio grande enviesa o ajuste |
| `targetsPlanned`, `targetsTrained`, `targetsSkipped` | alvos pulados pela UI; qualquer alvo pulado pede recalibração |
| `lambda`, `dimsPerEye`, `polynomialFeatures`, `poseCompensatedTargets` | o que de fato entrou no Ridge |

## 8. Como interpretar um resultado

Ordem de leitura sugerida:

1. `geometry.assumed` e `meta.distanciaCm`: se a geometria foi assumida, os
   graus são estimativa.
2. `pipeline.runtime.l2csFallback` e `l2csStalePct`: se o L2CS caiu para WASM
   ou ficou obsoleto, o bloco angular foi zerado em parte das amostras e a
   sessão não mede a condição pretendida.
3. `calibrationFit.targetsSkipped` e `l2csValidFraction`: um modelo treinado
   incompleto não é comparável.
4. `result.biasX/Y` contra `poseDeltaCalibToTestDeg`: viés uniforme com
   delta de pose de alguns graus = a pessoa se mexeu entre calibrar e testar.
   Recalibrar resolve; nada no pipeline resolve.
5. `affine.explainedFraction`: alta = mapa errado (recalibrar); baixa = ruído
   (olhar luz, resolução da câmera, distância).
6. Só então `meanErrorDeg` e `precisionDeg`.

Para comparar duas condições (por exemplo `filtro=oneEuro` contra
`kalmanEma`): mesma pessoa, mesma luz, mesma distância, recalibração entre
elas, pelo menos 3 repetições por condição, ordem contrabalanceada (fadiga
ocular cresce ao longo da sessão). Compare `meanErrorDeg`, `precisionDeg`,
`sampleP90Error` e `hitRateByRadius`, e registre a URL da condição.

## 9. Registro manual

O código não captura: brilho do monitor, descrição da luz do ambiente,
apoio de cabeça sim/não, hora do dia, e qualquer ponto refeito na calibração
(qual e por quê). Anote junto do nome do arquivo.

Modelo de linha de registro:

```
2026-09-05  accuracy-report-1788579312251.json  webgpu/448/oneEuro  23,6"  60 cm  sem óculos  luz de janela lateral  brilho 40%  sem apoio  erro 3,18°  precisão ~1,0°
```

## 10. Hardware de referência

| item | valor | consequência |
|---|---|---|
| Monitor Mancer Valak 24 (MCR-VLK24-BL01) | diagonal 23,6″ (o "24" é arredondamento), área ativa 52,25 × 29,39 cm, 36,75 px/cm em 1920×1080 | entra em `pxPorCm` e no erro angular; é o `default` do app |
| Curvatura R1650 | borda a 63,5 cm quando o centro está a 60 | o modelo trata a tela como plana; a curvatura reduz o desvio de 9 % para 6 % |
| 180 Hz | fixar em 60 Hz | o loop roda na taxa do monitor e a câmera a 30 fps; acima disso é carga sem trabalho |
| Câmera 1920×1080 | erro interior 123 px | contra 144 px na mesma sessão com 1280×960: o erro escala com o inverso da densidade de pixels sobre o olho |
| Distância nominal | 60 cm | premissa da grade de calibração e do harness sintético |

Histórico de medições reais em `docs/medicoes/historico/` (esquema anterior
ao `/2`; ambas as sessões de 2026-09-05 foram feitas com a diagonal informada
manualmente, 448², WebGPU e One Euro):

| arquivo | condição | erro | erro angular | precisão | nota |
|---|---|---|---|---|---|
| `accuracy-report-1788579312251.json` | sem óculos | 123 px | 3,18° | 38,1 px | imediatamente após calibração |
| `accuracy-report-1788580524778.json` | óculos simples | 144 px | 3,74° | 19,7 px | imediatamente após calibração |

## 11. Harness sintético

`src/testUtils/pipelineHarness.ts` roda o pipeline completo sobre
trajetórias sintéticas determinísticas (centro, bordas, cantos, transições,
perda de rosto, deriva de pose de 5°) e compara com
`src/testUtils/harness-baseline.json`. É o gate de regressão dos testes
(`npm test`), não uma medida de acurácia real: os números só têm sentido
relativos ao baseline. Para regenerar o baseline, com revisão do diff:

```bash
IRISFLOW_WRITE_BASELINE=1 npx vitest run src/testUtils/writeBaseline.test.ts
```
