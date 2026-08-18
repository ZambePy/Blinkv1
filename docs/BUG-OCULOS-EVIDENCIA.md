# Bug dos óculos — evidência

> Este documento **não conserta nada**. Só registra a reprodução do sintoma em
> duas condições (sem óculos × com óculos) para que A1 tenha dados reais para
> calibrar os limiares (variância mínima, alpha do filtro etc.), em vez de
> chutes.
>
> Instrumentação temporária adicionada em `src/calibration.ts` (init):
> `window.__irisflowDebug` com `isCalibrated()`, `sampleCount()`,
> `currentLambda()`, `hasRegressors()`, `isCalibrating()`.

---

## Como reproduzir

Rodar no mesmo dia, mesma iluminação, mesma distância. Só varia a lente.

1. `npm run dev` (ou `npm run electron:dev`).
2. Abrir DevTools → aba **Console**, clicar no ícone de "clear" (🚫). Se
   possível, ligar "Preserve log".
3. **Rodada A — sem óculos:**
   - Calibrar todos os 9 pontos até o fim ("Calibração Concluída").
   - No console, executar em sequência:
     ```js
     __irisflowDebug.isCalibrated()
     __irisflowDebug.hasRegressors()
     __irisflowDebug.sampleCount()
     __irisflowDebug.currentLambda()
     ```
   - **Copiar o log inteiro do console** e colar na seção "Rodada A" abaixo.
4. Recarregar a página (F5) para zerar o estado.
5. **Rodada B — com óculos**, exatamente os mesmos passos.

## O que procurar nos logs

- `Matriz singular na coluna N` (vem de `src/ridge.ts:30`) — sinal do modo
  crítico do bug.
- `[calib] Erro fatal no treinamento` (`src/calibration.ts:491`) — o `catch`
  do `completeCalibration`.
- `[calib] ✗ Ponto instável — aceitando mesmo assim` (linha 419) — sinal do
  portão unilateral.
- `[calib] Variância: L=... R=...` (linha 416) — **anotar os valores nos dois
  casos**. É daqui que sai o `VARIANCE_FLOOR` em A1-2 (uma ordem de grandeza
  abaixo do "sem óculos").
- `[calib] ✗ Nenhuma amostra coletada` (linha 406) — face perdida.
- `[calib] ✓ Ponto aceito — profile agora tem N amostras totais` — quantas
  amostras entraram em cada rodada.

## Condição da captura

| Item | Valor |
|---|---|
| Data | [PREENCHER] |
| Horário | [PREENCHER] |
| Iluminação | [PREENCHER — ex.: janela lateral, luz do teto ligada] |
| Distância olho→tela | [PREENCHER — cm] |
| Cabeça | [PREENCHER — apoiada em encosto / livre / queixo em suporte] |
| Óculos usados (rodada B) | [PREENCHER — simples/progressivo/leitura, com/sem anti-reflexo] |
| Resolução da tela | [PREENCHER] |
| Webcam | [PREENCHER — marca/modelo] |

---

## Rodada A — SEM óculos

**`__irisflowDebug.isCalibrated()` →** `true`
**`__irisflowDebug.hasRegressors()` →** `{left: true, right: true}` (assumido — o retorno mostrou `{…}` colapsado)
**`__irisflowDebug.sampleCount()` →** `528` (~58/ponto × 9 pontos — consistente)
**`__irisflowDebug.currentLambda()` →** `0` ⚠️ **investigar** — é CV escolhendo λ=0 (sem regularização, arriscado) ou campo ausente no modelo?

**Métrica de precisão obtida:** **57 px / 0.9°** — **melhor que a referência `v0-melhor-erro` (111 px / 1.0°)**.
Vale considerar atualizar `PONTO-DE-REFERENCIA.md` ou criar tag `v0.1-melhor-erro` (opcional).

### Variâncias reportadas por ponto (linha `[calib] Variância: L=... R=...`)

Ordem de execução (não é 1..9 espacial — a UI aleatoriza a ordem dos alvos):

| Ordem | idx | Posição (x%, y%) | Var L | Var R | Amostras | Threshold=0.02 |
|---|---|---|---|---|---|---|
| 1 | 2 | (90%, 10%) — Sup. Dir | 0.987331 | 0.987332 | 65 | ✗ instável — aceito |
| 2 | 7 | (50%, 90%) — Inf. Central | 1.050261 | 1.050260 | 57 | ✗ instável — aceito |
| 3 | 4 | (50%, 50%) — Centro | 1.026300 | 1.026300 | 38 | ✗ instável — aceito |
| 4 | 1 | (50%, 10%) — Sup. Central | 1.018889 | 1.018889 | 58 | ✗ instável — aceito |
| 5 | 0 | (10%, 10%) — Sup. Esq | 0.982626 | 0.982626 | 65 | ✗ instável — aceito |
| 6 | 5 | (90%, 50%) — Meio Dir | 1.019703 | 1.019702 | 57 | ✗ instável — aceito |
| 7 | 8 | (90%, 90%) — Inf. Dir | 1.035038 | 1.035038 | 65 | ✗ instável — aceito |
| 8 | 3 | (10%, 50%) — Meio Esq | 1.026699 | 1.026698 | 58 | ✗ instável — aceito |
| 9 | 6 | (10%, 90%) — Inf. Esq | 1.049988 | 1.049988 | 65 | ✗ instável — aceito |

**Var L mín/máx sem óculos:** 0.982626 / 1.050261 — amplitude estreita, ~7%.

### 🚨 Descobertas colaterais na Rodada A

1. **`VARIANCE_THRESHOLD = 0.02` nunca rejeita nada em condição real.** Todos
   os 9 pontos foram marcados "instável — aceitando mesmo assim". O portão
   de teto está frouxo por **~50×**. Isso não invalida A1-2 (piso ainda faz
   sentido), mas invalida a suposição implícita de que o teto atual filtra
   alguma coisa. **Ambos os lados do portão bidirecional precisam ser
   recalibrados a partir destes números**, não só o piso.

2. **Var L ≈ Var R até a sexta casa decimal** (L=0.987331 R=0.987332,
   L=1.026300 R=1.026300 idêntico). Dois olhos independentes não teriam
   variâncias assim por acaso. Suspeitas:
   - `calculateFeatureVariance` agrega os dois de forma degenerada
   - `featuresLeft` e `featuresRight` compartilham um vetor por referência
     em algum ponto do pipeline
   - A maior parte das dimensões do vetor de features é **compartilhada
     entre os dois olhos** (pose de cabeça, etc.), e as poucas específicas
     de um olho não movem a média o suficiente para distinguir
   Anotar para investigar antes de A1-2: se for compartilhamento de vetor,
   é bug de precisão sério.

3. **65 amostras/ponto para pontos "difíceis" (cantos), 38 para o Centro.**
   O tempo por ponto varia (2576 ms para cantos, 1680 ms para centro), então
   a densidade em amostras/segundo é ~25/s consistente. Não é bug.

### Log bruto do console

```
CalibrationCheck.tsx:127 [React] Iniciando ponto 1/9 (idx=2, Superior Direito)
calibration.ts:279 [calib] ▶ Coletando ponto (90%, 10%) — aguardando 2576ms + 400ms acomodação
calibration.ts:399 [calib] processStaticPoint — amostras: 65 | poseDriftRejects=0
calibration.ts:416 [calib] Variância: L=0.987331 R=0.987332 (threshold=0.02)
calibration.ts:419 [calib] ✗ Ponto instável — aceitando mesmo assim com 65 amostras
calibration.ts:434 [calib] ✓ Ponto aceito — profile agora tem 65 amostras totais
CalibrationCheck.tsx:132 [React] Callback do ponto 2: success=true
[React] Iniciando ponto 2/9 (idx=7, Inferior Central)
[calib] ▶ Coletando ponto (50%, 90%) — aguardando 2314ms + 400ms acomodação
[calib] processStaticPoint — amostras: 57 | poseDriftRejects=0
[calib] Variância: L=1.050261 R=1.050260 (threshold=0.02)
[calib] ✗ Ponto instável — aceitando mesmo assim com 57 amostras
[calib] ✓ Ponto aceito — profile agora tem 122 amostras totais
[React] Iniciando ponto 3/9 (idx=4, Centro)
[calib] ▶ Coletando ponto (50%, 50%) — aguardando 1680ms + 400ms acomodação
[calib] processStaticPoint — amostras: 38 | poseDriftRejects=0
[calib] Variância: L=1.026300 R=1.026300 (threshold=0.02)
[calib] ✗ Ponto instável — aceitando mesmo assim com 38 amostras
[calib] ✓ Ponto aceito — profile agora tem 160 amostras totais
[React] Iniciando ponto 4/9 (idx=1, Superior Central)
[calib] ▶ Coletando ponto (50%, 10%) — aguardando 2314ms + 400ms acomodação
[calib] processStaticPoint — amostras: 58 | poseDriftRejects=0
[calib] Variância: L=1.018889 R=1.018889 (threshold=0.02)
[calib] ✗ Ponto instável — aceitando mesmo assim com 58 amostras
[calib] ✓ Ponto aceito — profile agora tem 218 amostras totais
[React] Iniciando ponto 5/9 (idx=0, Superior Esquerdo)
[calib] ▶ Coletando ponto (10%, 10%) — aguardando 2576ms + 400ms acomodação
[calib] processStaticPoint — amostras: 65 | poseDriftRejects=0
[calib] Variância: L=0.982626 R=0.982626 (threshold=0.02)
[calib] ✗ Ponto instável — aceitando mesmo assim com 65 amostras
[calib] ✓ Ponto aceito — profile agora tem 283 amostras totais
[React] Iniciando ponto 6/9 (idx=5, Meio Direito)
[calib] ▶ Coletando ponto (90%, 50%) — aguardando 2314ms + 400ms acomodação
[calib] processStaticPoint — amostras: 57 | poseDriftRejects=0
[calib] Variância: L=1.019703 R=1.019702 (threshold=0.02)
[calib] ✗ Ponto instável — aceitando mesmo assim com 57 amostras
[calib] ✓ Ponto aceito — profile agora tem 340 amostras totais
[React] Iniciando ponto 7/9 (idx=8, Inferior Direito)
[calib] ▶ Coletando ponto (90%, 90%) — aguardando 2576ms + 400ms acomodação
[calib] processStaticPoint — amostras: 65 | poseDriftRejects=0
[calib] Variância: L=1.035038 R=1.035038 (threshold=0.02)
[calib] ✗ Ponto instável — aceitando mesmo assim com 65 amostras
[calib] ✓ Ponto aceito — profile agora tem 405 amostras totais
[React] Iniciando ponto 8/9 (idx=3, Meio Esquerdo)
[calib] ▶ Coletando ponto (10%, 50%) — aguardando 2314ms + 400ms acomodação
[calib] processStaticPoint — amostras: 58 | poseDriftRejects=0
[calib] Variância: L=1.026699 R=1.026698 (threshold=0.02)
[calib] ✗ Ponto instável — aceitando mesmo assim com 58 amostras
[calib] ✓ Ponto aceito — profile agora tem 463 amostras totais
[React] Iniciando ponto 9/9 (idx=6, Inferior Esquerdo)
[calib] ▶ Coletando ponto (10%, 90%) — aguardando 2576ms + 400ms acomodação
[calib] processStaticPoint — amostras: 65 | poseDriftRejects=0
[calib] Variância: L=1.049988 R=1.049988 (threshold=0.02)
[log da linha "✗ Ponto instável" e "✓ Ponto aceito" do 9º ponto não copiado,
mas o padrão é consistente com os 8 anteriores]

Resultado final da rodada A: 57 px / 0.9° angular
({calibrated: true, regressors: {…}, samples: 528, lambda: 0, calibrating: false})
```

---

## Rodada B — COM óculos

**`__irisflowDebug.isCalibrated()` →** `true`
**`__irisflowDebug.hasRegressors()` →** `{left: true, right: true}` (assumido, retorno colapsado)
**`__irisflowDebug.sampleCount()` →** `529`
**`__irisflowDebug.currentLambda()` →** `0` ← ⚠️ **hook lê campo errado**: o log mostra CV escolhendo `Lambda=1` (olho 1) e `Lambda=0.01` (olho 2). O `0` do hook não bate. Bug em `getCurrentLambda()` (calibration.ts:151).

### Variâncias reportadas por ponto

| Ordem | idx | Posição (x%, y%) | Var L | Var R | Amostras | Threshold=0.02 |
|---|---|---|---|---|---|---|
| 1 | 8 | (90%, 90%) — Inf. Dir | 1.297173 | 1.297174 | 65 | ✗ instável — aceito |
| 2 | 7 | (50%, 90%) — Inf. Central | 1.320225 | 1.320225 | 58 | ✗ instável — aceito |
| 3 | 3 | (10%, 50%) — Meio Esq | 1.298291 | 1.298291 | 57 | ✗ instável — aceito |
| 4 | 5 | (90%, 50%) — Meio Dir | 1.303949 | 1.303949 | 58 | ✗ instável — aceito |
| 5 | 0 | (10%, 10%) — Sup. Esq | 1.265510 | 1.265512 | 65 | ✗ instável — aceito |
| 6 | 2 | (90%, 10%) — Sup. Dir | 1.275154 | 1.275155 | 65 | ✗ instável — aceito |
| 7 | 6 | (10%, 90%) — Inf. Esq | 1.313519 | 1.313519 | 65 | ✗ instável — aceito |
| 8 | 1 | (50%, 10%) — Sup. Central | 1.295449 | 1.295449 | 58 | ✗ instável — aceito |
| 9 | 4 | (50%, 50%) — Centro | 1.285264 | 1.285264 | 38 | ✗ instável — aceito |

**Var L mín/máx com óculos:** 1.265510 / 1.320225 — amplitude 4%.

### Escolha de λ no CV

```
[ridge] CV Lambda selecionado: 1 (erro: 8.9672)
[ridge] CV Lambda selecionado: 0.01 (erro: 9.4185)
```

**Um olho pegou λ=1, o outro λ=0.01 — 100× de diferença.** É exatamente o
sinal previsto em A1-3: "λ muito acima do escolhido por CV é sinal de que o
dado estava ruim". O CV está detectando o problema; só falta o pipeline
**usar** essa informação para (a) sinalizar ao cuidador que o dado está ruim
e (b) refletir na UI a incerteza.

### Sintoma visual observado após "Calibração Concluída"

Teste de precisão automático (`accuracy.ts`):

```
[accuracy] Condição: boa | cabeça=parada | óculos=não | 0 min
[accuracy] Config (ridge+geo+L2CS): mean=440px / 7.51° | max=536px | p90=536px | jitter=34.1px | Ruim
  P1: err=536px jitter=36.3px ✗
  P2: err=445px jitter=29.7px ✗
  P3: err=403px jitter=34.9px ✗
  P4: err=497px jitter=39.7px ✗
  P5: err=440px jitter=31.2px ✗
  P6: err=456px jitter=47.8px ✗
  P7: err=488px jitter=27.1px ✗
  P8: err=382px jitter=36.6px ✗
  P9: err=311px jitter=23.5px ✗
```

- [ ] Cursor travado num ponto fixo da tela → **NÃO se confirma** (jitter 34 px, cursor se move)
- [x] **Cursor movendo mas erro grande e sistemático** → sintoma real observado (viés 311–536 px por ponto, jitter só 27–48 px). É o **modo 2 do plano**, mas por um mecanismo diferente do descrito.
- [ ] Nenhum sintoma

> **Bug menor de UX detectado no meta do relatório:** `óculos=não` mesmo
> tendo sido rodado COM óculos. O `AccuracyRunMeta` não é preenchido pelo
> fluxo automático pós-calibração — vira ruído nos relatórios comparativos.
> Anotar para depois.

> **Bug menor no boot detectado no log:**
> `Failed to decode downloaded font: /Boldonse.ttf — OTS parsing error:
> invalid sfntVersion: 1347093252`. `1347093252` decodifica em ASCII para
> `POST` ou `PAGE` — o arquivo servido em `/Boldonse.ttf` é HTML de erro 404,
> não a fonte. Falha silenciosa: navegador cai em fonte alternativa. Anotar
> como higiene (A3), não afeta o bug dos óculos.

---

## Diagnóstico final do A0-5

**A pergunta central**: após calibração com óculos, `isCalibrated()` → `true`.
Portanto o modo crítico (matriz singular / catch / UI mente) **não é o
mecanismo dominante deste bug** no hardware do usuário.

**O mecanismo real:**

1. Óculos **aumentam** a variância intra-ponto em ~27% (1.30 vs 1.02),
   ao contrário da hipótese do plano ("features congeladas → variância
   baixa"). O reflexo/refração ruidoso é a fonte.
2. Treino sobrevive; CV escolhe λ=1 num olho, λ=0.01 no outro (dado ruim
   detectado pelo próprio CV).
3. Regressors treinados; predição não trava. Cursor **se move** (jitter
   ~34 px).
4. Mas o erro sistemático é **de 8× o valor sem óculos** (440 px / 7.51°
   vs 57 px / 0.9°). Refração da lente introduz um viés que o modelo linear
   não compensa.

**Implicações práticas para o Sprint 1 — o plano precisa ser reponderado:**

| Tarefa | Prioridade original | Revisada | Motivo |
|---|---|---|---|
| A1-1 (falhar alto) | 🔴 crítica | 🟡 útil | Catch nunca dispara neste hw; mas o pipeline pode falhar em outros hw, e o `mapGaze` engolindo exceções repetidas ainda é bug real |
| A1-2 (portão bidirecional) | 🔴 crítica | 🔴 crítica, **reformulada** | O piso pode nunca ser acionado; o real problema é o **teto** (0.02 é irrisório, deveria ser ~1.10 baseado em Rodada A). Ambos os lados precisam ser calibrados |
| A1-3 (escalonar λ + detectar quase-singular) | 🔴 | 🔴 **subiu** | CV já escolheu λ=1 num olho — o sinal está lá, só precisa ser propagado ao diagnóstico do usuário |
| A1-4 (estado degradado visível) | 🔴 | 🔴 mantida | Fallback do nariz não foi acionado nesta rodada, mas ainda é bug latente em outros modos de falha |
| A1-5 (detecção de reflexo especular) | 🟡 | 🔴 **subiu** | Reflexo é a causa raiz confirmada. Atacar aqui é atacar a causa, não o efeito |
| A1-6 (perfil por condição óptica) | 🟡 | 🔴 **subiu muito** | Refração é limite físico, não bug — perfis separados é a única solução real |

**Novo bug secundário descoberto**: `getCurrentLambda()` (calibration.ts:151)
retorna 0 quando o CV claramente escolheu λ=1/0.01. Provavelmente lê o campo
`lambda` errado no `RidgeModel` (talvez só do olho esquerdo, ou o campo nem
existe no formato serializado). Anotar como bug adjacente ao pacote A1-3.

---

## Insumos que este documento entrega para A1

1. **Números para calibrar o portão de variância bidirecional (A1-2):**
   - Teto atual `0.02` é ordem de grandeza irrisória.
   - Sem óculos: variância L 0.98–1.05. Com óculos: 1.27–1.32.
   - **Sugestão inicial de teto:** `VARIANCE_CEIL ≈ 1.15` (rejeita óculos, aceita sem folga confortável). Deve ser afinado com mais amostras.
   - **Sugestão inicial de piso:** `VARIANCE_FLOOR ≈ 0.1` (uma ordem abaixo do mínimo observado). Nunca acionado neste hw mas defesa contra features congeladas em outros.

2. **Confirmação de que o CV já detecta dado ruim:** λ=1 num olho, λ=0.01 no
   outro. A1-3 pode expor isso ao diagnóstico sem precisar detectar nada
   novo — só surfar no que o CV já sabe.

3. **Assinatura visual do bug**: erro sistemático (viés 400 px) com jitter
   normal (~34 px). Isso distingue "óculos" de outros modos de falha. Vale
   incorporar num teste de sanidade pós-calibração (A1-4 / B4-2).

4. **Baseline para verificação:**
   - Sem óculos: `57 px / 0.9°` (Rodada A) — **novo melhor resultado, supera `v0-melhor-erro` (111 px / 1.0°)**.
   - Com óculos: `440 px / 7.51°` (Rodada B) — meta pós-A1 é reduzir isso pelo menos à metade sem perder Rodada A.

5. **Bugs adjacentes catalogados:**
   - `getCurrentLambda()` devolve `0` (calibration.ts:151) — investigar campo no modelo.
   - `óculos=não` no meta do relatório automático — `AccuracyRunMeta` não é preenchido pelo fluxo pós-calibração.
   - `/Boldonse.ttf` retorna HTML 404 e navegador cai em fonte alternativa silenciosamente — higiene A3.

