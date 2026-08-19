# IrisFlow — Preparo de Terreno: Frentes A e B

> **Para o Claude Code:** leia o documento inteiro antes de escrever código. O repositório está em `f9d9252`, que é o **ponto de menor erro já registrado do projeto** (1° angular, 111 px). Esse ponto é o ativo mais valioso que existe aqui — protegê-lo é requisito de toda tarefa.
>
> **Esta fase não mede.** O script de medição vem depois que as duas frentes fecharem. O trabalho aqui é deixar o terreno em condição de a medição significar alguma coisa.

---

## Princípio orientador: isto é software de saúde

O IrisFlow é a única via de comunicação de alguém que não consegue falar nem se mover. Isso muda o que conta como bug.

Num app comum, degradar em silêncio é feio. Aqui é a falha mais grave possível: **o sistema diz que está funcionando enquanto entrega lixo, e o usuário não tem como reclamar.** Ele não pode dizer "o cursor está errado". Ele só consegue tentar de novo, falhar, e cansar.

Quatro regras que valem para tudo neste documento:

1. **Falhar alto, nunca em silêncio.** Todo caminho degradado tem que ser visível ao cuidador. Um `catch` que engole exceção e segue como se nada tivesse acontecido é defeito de segurança, não descuido de estilo.
2. **A comunicação nunca é bloqueada.** Nenhum modal, alerta ou tela de erro pode ficar entre o usuário e o botão de emergência. Nem durante recalibração, nem em estado degradado.
3. **O que a tela afirma tem que ser verdade.** Se a UI mostra "Calibração Concluída", `isCalibrated()` tem que ser `true`. Hoje isso não é garantido — e é a raiz do bug dos óculos.
4. **Nenhuma mudança de comportamento entra ligada por padrão nesta fase.** Correção de bug entra (bug é inequívoco). Ajuste de sintonia entra **atrás de flag, desligada**, porque você ainda não tem como medir se melhorou. Ligar antes de medir é como trocar a receita e jogar fora a antiga.

> **A regra 4 é a mais importante e a mais fácil de violar.** Você tem 1°/111 px em `f9d9252`. Se uma tarefa deste documento ligar algo por conta própria e o número piorar, você não vai saber qual das doze mudanças foi. Todo ajuste de sintonia é `false` por default até a fase de medição.

---

## Índice

- [SPRINT 0 — Auditoria](#sprint-0--auditoria-do-estado-atual)
- [FRENTE A — Backend](#frente-a--backend-precisão-e-robustez)
- [FRENTE B — Frontend](#frente-b--frontend-ux-para-o-paciente-com-ela)
- [Rota de sprints](#rota-de-sprints)

---

# SPRINT 0 — Auditoria do estado atual

> Nenhuma alteração funcional. Se alguma tarefa daqui revelar algo que contradiz este documento, **pare e reporte** em vez de seguir.

### 🚦 Gate de validação do SPRINT 0

Para dar o sprint por fechado (e liberar SPRINT 1), **todos os itens abaixo têm que ser verdade**:

1. ✅ Tag `v0-melhor-erro` existe em `f9d9252` (local **e** empurrada para `origin`).
2. ✅ `docs/PONTO-DE-REFERENCIA.md` existe e as 10 condições estão preenchidas com valores reais (não `[PREENCHER]`).
3. ✅ `npm install && npm --prefix frontend install && npm test && npm run build && npm run electron:compile` roda limpo em clone do zero.
4. ✅ `docs/AUDITORIA-SPRINT-0.md` lista todos os `catch` / `return null` / `?? 0` / `|| 0` com severidade e "usuário percebe?".
5. ✅ Inventário de estado mutável de módulo no mesmo doc, com "reset em…" e "se não resetar…" preenchidos.
6. ✅ `docs/BUG-OCULOS-EVIDENCIA.md` com **logs brutos** das rodadas A/B e a resposta `isCalibrated()` pós-óculos.
7. ✅ Nenhuma alteração funcional de comportamento neste sprint (só instrumento e docs). `git diff v0-melhor-erro..HEAD -- src/ frontend/src/` deve mostrar apenas: hook temporário `__irisflowDebug`.

Status atual: 1 (parcial — falta push), 2 (parcial — falta dados de condição em `PONTO-DE-REFERENCIA.md`), 3 ✅, 4 ✅, 5 ✅, 6 ✅ **fechado com achado importante — hipótese central do plano refutada; A1 repriorizado**, 7 ✅.

**Bloco final do SPRINT 0:** pronto para SPRINT 1 do ponto de vista de código. Itens 1 e 2 do gate são administrativos e podem ser fechados sem alterar código (empurrar tag + preencher condições).

## A0-1 🔴 Congelar o ponto de referência ✅ FEITO

> **Status:** tag `v0-melhor-erro` criada em `f9d9252` (local). `docs/PONTO-DE-REFERENCIA.md` criado como template com 10 campos (7 obrigatórios do plano + 3 auxiliares). Campos `[PREENCHER]` aguardam dados reais do responsável pela medição. **Push da tag para origin pendente** — ação de estado compartilhado, aguardando autorização.

Antes de tocar em qualquer linha:

```bash
git tag -a v0-melhor-erro -m "1,0° angular / 111 px — melhor resultado registrado. Referência para toda comparação futura."
git push origin v0-melhor-erro
```

Crie `docs/PONTO-DE-REFERENCIA.md` registrando **a condição em que o número foi obtido**, não só o número:

- commit, data
- erro angular e em px, e **se foi medido por amostra ou por ponto** (isso muda o número em ~50 %)
- resolução da tela e do vídeo
- distância olho→tela e como foi obtida (fita métrica ou estimativa)
- iluminação, óculos, cabeça parada ou livre
- webcam usada

Sem essas condições, o número não é reproduzível — e um número não reproduzível não serve nem para você comparar depois, nem para mostrar a investidor.

**Aceite:** tag criada e empurrada; documento existe com as 7 condições preenchidas.

## A0-2 🔴 Verificar que o projeto compila e testa ✅ FEITO

> **Status:** todos os 4 comandos passaram em `f9d9252`. `npm test` → 12 arquivos, 69 testes verdes em 4,87 s. `npm run build` → Vite ok em 4,29 s. `npm run electron:compile` → ok em 7 ms. Resultados detalhados em `docs/AUDITORIA-SPRINT-0.md`. Vulnerabilidades de `npm audit` e peer conflict `vite × @vitest/mocker` registradas como não-bloqueantes para depois.

Clone limpo, do zero:

```bash
npm install && npm --prefix frontend install
npm test
npm run build
npm run electron:compile
```

Registre em `docs/AUDITORIA-SPRINT-0.md`: o que passou, o que falhou, e a saída do erro quando falhar. **Não conserte nada ainda** — só documente. A ordem importa: consertar antes de mapear é como você perde a noção do que estava quebrado.

## A0-3 🔴 Varredura de degradação silenciosa ✅ FEITO

> **Status:** varredura completa em `src/` e `frontend/src/`. Os **3 pontos pré-mapeados do plano se confirmam exatamente** neste commit. Achados adicionais em `docs/AUDITORIA-SPRINT-0.md` — destaques 🔴 fora do trio já mapeado: (a) `mapGaze` em `calibration.ts:602` que silencia todas as exceções depois da primeira e reforça o bug do fallback; (b) `accuracy.ts:296` com `|| 0` que pode devolver "erro zero" quando na verdade não há amostra; (c) `GazeContext.tsx:302` que engole falha de câmera sem propagar para a UI; (d) `EmergencyEscalation.tsx:46` — `catch` no envio de alerta, precisa de retry/confirmação (vai para B4-1).

Esta é a tarefa mais importante do Sprint 0, e ataca diretamente a regra 1.

Procure **todo** ponto onde uma falha é engolida:

```bash
grep -rn "catch" src/ frontend/src/ --include=*.ts --include=*.tsx
grep -rn "return null\|return { x: 0, y: 0 }\|?? 0\||| 0" src/ --include=*.ts
```

Para cada ocorrência, preencha uma linha em `docs/AUDITORIA-SPRINT-0.md`:

| Arquivo:linha | O que pode falhar | O que acontece hoje | O usuário percebe? | Severidade |
|---|---|---|---|---|

**Já mapeei três para você começar** (verificados neste commit):

| Local | Problema |
|---|---|
| `src/calibration.ts:487-495` | `completeCalibration` captura exceção do treino, loga no console e **chama `onComplete()` mesmo assim**. A UI mostra "Calibração Concluída" com `isCalibrated() === false`. |
| `src/tracker/engine.ts:474-476` | Quando `mapGaze` devolve `null`, o engine cai num fallback que mapeia a **posição do nariz** para a tela. Nenhuma mudança de estado, nenhum aviso. O cursor "funciona" mas não está rastreando o olhar. |
| `src/calibration.ts:418-422` | Ponto de calibração com variância acima do limiar é **aceito assim mesmo**, só com um `console.warn`. |

Esses três, encadeados, são o bug dos óculos. Ver A1.

## A0-4 🟡 Inventário de estado mutável ✅ FEITO

> **Status:** inventário completo em `docs/AUDITORIA-SPRINT-0.md`. Confirmado A2-4 (`earHistory` como `const` mutável de módulo sem reset, sem encapsulamento — deriva de precisão progressiva ao longo da sessão). Nota importante: o plano cita `latest`/`lastSubmitMs` do `l2cs/client` como suspeitos, mas na verdade estão dentro de `createL2CSClient()` (per-instância, não módulo — falso positivo). Três padrões de risco em `calibration.ts`: (1) três caminhos parciais de reset em vez de um `resetCalibrationState()` único; (2) `isCalibrating` / `isAccuracyTesting` exportados e mutados de dentro; (3) `earHistory`. Também descoberto: `isAccuracyTesting = true` pode ficar preso se a UI desmontar no meio de um teste → cursor invisível pelo resto da sessão sem explicação (🟡 novo).

Todo `let` e `const` mutável de escopo de módulo em `src/`. Para cada um: quem escreve, quem lê, quando é resetado, e o que acontece se **não** for resetado.

Comece por: `earHistory` (extractor), `profile` / `isCalibrating` / `isCollecting` / `regressorLeft` / `regressorRight` (calibration), `latest` / `lastSubmitMs` (l2cs/client), `isAccuracyTesting` (accuracy).

Estado de módulo que atravessa sessões é a fonte clássica de "funcionou ontem e hoje não". A tabela vai revelar bugs — é o objetivo do exercício.

## A0-5 🔴 Reproduzir o bug dos óculos com evidência ✅ FEITO — **hipótese do plano refutada parcialmente**

> **Status:** Rodadas A (sem óculos) e B (com óculos) capturadas com log completo. Resultados em `docs/BUG-OCULOS-EVIDENCIA.md`. **Resumo:**
> - Sem óculos: 57 px / 0.9° | variâncias 0.98–1.05 | `isCalibrated=true`
> - Com óculos: **440 px / 7.51°** (8× pior) | variâncias 1.27–1.32 | `isCalibrated=true`
>
> **A hipótese central do plano — "óculos → features congeladas → matriz singular → catch → cursor no nariz" — NÃO se confirma neste hardware.** O mecanismo real é o oposto: óculos **aumentam** a variância (+27%) e introduzem um viés sistemático de 400 px. Treino sobrevive; CV escolhe λ=1 num olho e λ=0.01 no outro (sinal de dado ruim que o CV já detecta mas não é propagado).
>
> **Bugs adjacentes descobertos:**
> - `getCurrentLambda()` retorna 0 quando CV escolhe 1/0.01 — lê campo errado no modelo (calibration.ts:151).
> - `óculos=não` no meta do relatório automático — `AccuracyRunMeta` não é preenchido pelo fluxo pós-calibração.
> - `/Boldonse.ttf` retorna HTML 404 e navegador cai em fonte alternativa silenciosamente — higiene (A3).
> - Portão de teto `VARIANCE_THRESHOLD=0.02` **nunca rejeita nada em condição real** (todas as variâncias observadas ≥ 0.98). Ordem de grandeza irrisória.
>
> **Repriorização do Sprint 1 aplicada nas seções A1 abaixo** (marcadores ⬆️/⬇️/🔄).

Não conserte. **Documente.**

1. Rode a calibração completa **sem óculos**. Salve o log do console inteiro.
2. Rode **com óculos**. Salve o log.
3. Compare, procurando especificamente por:
   - `Matriz singular na coluna N` (vem de `src/ridge.ts:30`)
   - `[calib] Erro fatal no treinamento`
   - `[calib] ✗ Ponto instável`
   - `[calib] Variância: L=... R=...` — **anote os valores nos dois casos**
4. Logo após a calibração com óculos, no console: `__irisflowDebug?.isCalibrated?.()` ou equivalente. Se não existir, exponha temporariamente `calibration.isCalibrated()` em `window`.

**A pergunta que fecha o diagnóstico:** depois da calibração com óculos, `isCalibrated()` devolve `true` ou `false`?

**Aceite:** `docs/BUG-OCULOS-EVIDENCIA.md` com os dois logs, os valores de variância comparados, e a resposta a essa pergunta.

---

# FRENTE A — Backend: precisão e robustez

## A1 — O bug dos óculos

### A hipótese, com a cadeia causal completa

Lendo o código deste commit, existe um caminho que produz **exatamente** o sintoma que você descreve — cursor parado num ponto fixo da tela:

```
Óculos → reflexo especular na lente
   ↓
MediaPipe degrada os landmarks de íris (468–477); eles congelam
ou grudam num prior em vez de seguir a pupila
   ↓
Durante a calibração, várias colunas do vetor de features ficam
praticamente CONSTANTES entre os 9 pontos
   ↓
ΦᵀΦ fica singular  →  solveLinear lança "Matriz singular" (ridge.ts:30)
   ↓
completeCalibration captura, loga, e chama onComplete() (calibration.ts:487)
   ↓
UI mostra "Calibração Concluída".  regressorLeft/Right continuam null.
   ↓
mapGaze devolve null em todo frame
   ↓
engine cai no fallback do nariz (engine.ts:474):
     targetX = (1 − landmarks[1].x) · vw
     targetY = landmarks[1].y · vh
   ↓
Com a cabeça parada, o nariz não se move  →  CURSOR FIXO NUM PONTO
```

A variante sem exceção dá o mesmo sintoma por outro caminho: se as features não chegarem a ser singulares mas ficarem quase constantes, o Ridge não tem sinal para aprender e passa a prever essencialmente o termo de viés — um ponto fixo perto da média dos alvos.

**Nos dois casos o desfecho é idêntico: um ponto fixo na tela.** Por isso o A0-5 pede o valor de `isCalibrated()` — é ele que distingue os dois ramos e diz qual corrigir primeiro.

### O defeito estrutural que permitiu isso

`src/calibration.ts:418` rejeita ponto com variância **alta demais**:

```ts
if (avgVarLeft > VARIANCE_THRESHOLD || avgVarRight > VARIANCE_THRESHOLD) { ... }
```

**Não existe verificação de variância baixa demais.** O portão é unilateral. Ele foi desenhado contra o usuário inquieto, e não enxerga o caso oposto — features congeladas — que é justamente a assinatura dos óculos. Um sensor travado passa por "estável" nesse teste.

---

### A1-1 🟡 Falhar alto quando o treino falha ⬇️ REPRIORIZADO (A0-5)

> **Nota A0-5:** o `catch` de `completeCalibration` **não dispara neste hardware** (treino sobrevive mesmo com óculos). A tarefa continua correta (é bug real: `_dimErrorLogged` silencia exceções repetidas do `mapGaze`), mas não é a raiz do sintoma dos óculos observado. Fazer, mas depois de A1-2/A1-3/A1-5/A1-6.

`completeCalibration` não pode mais chamar `onComplete()` como se tudo tivesse dado certo.

```ts
export type CalibrationOutcome =
  | { ok: true }
  | { ok: false; reason: 'singular_matrix' | 'insufficient_samples' | 'degenerate_features' | 'unknown'; detail: string };
```

`completeCalibration(onComplete?: (outcome: CalibrationOutcome) => void)`. Quando falha: **não** marcar como calibrado, e devolver o motivo para a UI.

A UI precisa mostrar uma tela de falha com linguagem que o cuidador entenda e com uma ação concreta:

> **Não foi possível calibrar**
> O sistema não conseguiu distinguir os movimentos dos seus olhos.
> A causa mais comum é reflexo nos óculos.
>
> • Incline a tela um pouco para baixo
> • Reduza luzes atrás de você
> • Se possível, tente sem os óculos para comparar
>
> [Tentar novamente]  [Ajuda]

⚠️ Essa tela **não pode bloquear o caminho de emergência**. Botão de emergência sempre visível nela.

---

### A1-2 🔴 Portão de variância bidirecional 🔄 REFORMULADO (A0-5) ✅ FEITO

> **Nota A0-5:** o hardware do usuário mostrou o **oposto** da hipótese do plano — óculos causam variância **alta** (1.30), não baixa. O piso (`VARIANCE_FLOOR`) continua fazendo sentido como defesa, mas o principal é **calibrar o teto**: hoje `VARIANCE_THRESHOLD=0.02` nunca rejeita nada (todas as variâncias observadas ≥ 0.98). **Sugestão inicial:**
> - `VARIANCE_CEIL ≈ 1.15` (rejeita óculos = 1.27+, aceita sem = 1.05− com folga)
> - `VARIANCE_FLOOR ≈ 0.10` (defesa contra features congeladas em outro hw)
> - Trocar o número mágico `0.02` — investigar se era ordem de grandeza errada desde o início (features não normalizadas?) ou se veio de outra unidade.
> - **Também investigar por que Var L ≈ Var R até a 6ª casa decimal** (L=0.987331 R=0.987332). Dois olhos independentes não fariam isso — suspeita de compartilhamento de vetor de features ou agregação degenerada em `calculateFeatureVariance`.
>
> **Status ✅:**
> - **Mistério do Var L ≈ Var R resolvido**: `extractor.ts:156-218` monta `featuresLeft` e `featuresRight` com **muita sobreposição literal** — `MUTUAL_INDICES × 3` + `[yaw, pitch, roll]` + várias outras dimensões idênticas. ~80% do vetor é compartilhado, então a média das variâncias por dim sai praticamente igual. **Não é bug — é decorrência do design**. Documentado inline em `processStaticPoint`.
> - `VARIANCE_THRESHOLD = 0.02` marcado como `VARIANCE_THRESHOLD_LEGACY_UNUSED` com nota de por que nunca operou.
> - Novos `INTRA_POINT_VARIANCE_FLOOR = 0.10` e `INTRA_POINT_VARIANCE_CEIL = 1.15` derivados dos números reais de A0-5.
> - `processStaticPoint` continua **aceitando** pontos fora da faixa (preserva o comportamento antigo de não gerar infinite retry loop em usuários inquietos), mas com **log distinto por tipo de breach** (`⚠ Ponto com variância BAIXA/ALTA`) e contadores `varianceFloorBreaches`/`varianceCeilBreaches` reset em `startCalibrationMode`/`clearCalibration`.
> - **Nova função pura exportada `countDeadFeatures(features, targets, eps)`** — implementa exatamente o que o plano descreveu: variância ENTRE médias de alvos, por dimensão. Retorna `{ deadCount, totalDims, deadIndices }`.
> - **Preflight em `trainScalersAndRegressors`**: se `deadCount / totalDims > 0.30` em qualquer olho, **`throw new Error('degenerate_features: ...')`** antes do fit/scaler/solveLinear. Log claro com percentuais L/R. Hoje o catch de `completeCalibration` engole (A1-1 pendente), mas quando A1-1 for feito a propagação para a UI já está pronta.
> - `__irisflowDebug.varianceBreaches()` e `__irisflowDebug.deadFeatures()` expostos no console.
> - **7 testes novos** em `src/calibration.a1-2.test.ts` para `countDeadFeatures`: correlação com alvo, feature constante, ruído intra-alvo alto mas média igual, único alvo, features vazias, eps configurável, cenário 9 pontos × 30 dims disparando o corte de 30%.
> - **Total: 14 arquivos, 84 testes verdes**. Build + electron:compile ok.
> - **Sem mudança de comportamento no caminho feliz** (variâncias sem óculos ficam entre 0.10 e 1.15). Preserva baseline de 57 px / 0.9°.

Adicione o piso que falta:

```ts
// Variância ALTA = usuário inquieto (já tratado). Variância BAIXA é o oposto
// e é pior: features congeladas passam por "estáveis" no teste antigo. É a
// assinatura de reflexo em óculos travando os landmarks de íris — e leva a
// ΦᵀΦ singular no treino.
const VARIANCE_FLOOR = /* calibrar com os dados do A0-5 */;
```

Meça a variância típica **sem óculos** no A0-5 e coloque o piso uma ordem de grandeza abaixo. Não invente o número: derive dos seus logs.

Verificação adicional, mais direta que a variância agregada — **variância entre pontos, não dentro do ponto**:

```ts
// Uma feature útil VARIA entre alvos diferentes. Se a variância entre as
// médias dos 9 pontos for ~0, aquela dimensão não carrega informação de
// olhar nenhuma. Muitas dimensões nessa condição = features degeneradas.
function countDeadFeatures(profile: CalibrationPoint[]): number
```

Se mais de ~30 % das dimensões estiverem mortas, aborte com `reason: 'degenerate_features'` **antes** de tentar treinar. Falhar cedo com diagnóstico é muito melhor que falhar tarde com exceção genérica.

---

### A1-3 🔴 Treino que não explode ⬆️ SUBIU (A0-5) ✅ FEITO

> **Nota A0-5:** o CV **já detecta** o dado ruim — escolheu λ=1 num olho e λ=0.01 no outro (100× diferença) na rodada com óculos. Erro final: 440 px. O sinal existe, só precisa ser (a) exposto ao diagnóstico e (b) usado para bloquear a UI de declarar "Calibração Concluída" quando λ_max/λ_min > 10. **Bug adjacente descoberto**: `getCurrentLambda()` retorna 0 apesar do log `[ridge] CV Lambda selecionado: 1` — corrigir junto com esta tarefa, provavelmente lê o campo errado no modelo (calibration.ts:151).
>
> **Status ✅:**
> - `RidgeModel` ganhou `lambda: number` e `nearSingularCols: number[]` (persistem na serialização — cabe em A2-7 depois).
> - `solveLinear` recebe out-param `nearSingularCols` e popula com colunas cujo pivô < 1e-6 (mas ≥ 1e-12). Limiar `NEAR_SINGULAR_PIVOT = 1e-6` centralizado.
> - `trainRidgeModel` propaga λ efetivo e a união (não interseção) de colunas quase-singulares dos dois solves (X e Y).
> - `RidgeRegressor.train` escalona λ × 10 até 3 tentativas se o treino final lançar. Warn com o λ efetivo vs. o do CV. Warn separado quando `nearSingularCols.length > 0`.
> - `getCurrentLambda()` corrigido — agora lê `model.lambda` real. Nova `getLambdaDiagnostics()` retorna `{left, right, ratio, nearSingularLeft, nearSingularRight}`.
> - `trainScalersAndRegressors` loga `⚠ λ discrepante entre olhos` quando ratio > 10 (o caso exato observado em A0-5).
> - `__irisflowDebug.lambdaDiag()` exposto no console.
> - **8 testes novos** em `src/ridge.a1-3.test.ts`. Total: 13 arquivos, 77 testes verdes. Build e electron:compile ok.
> - **Sem mudança de comportamento no caminho feliz** — escalonamento só dispara quando o treino atual lançaria (regra 4 do plano preservada).

Mesmo com os portões, `solveLinear` não deve derrubar o treino. Duas defesas:

**(a) Escalonar λ para trás.** Se `solveLinear` lançar, tente de novo com λ × 10, até 3 vezes. Regularização maior torna `(ΦᵀΦ + λI)` inversível. Registre o λ efetivamente usado — λ muito acima do escolhido por CV é sinal de que o dado estava ruim, e isso precisa aparecer no diagnóstico.

**(b) Detectar quase-singularidade antes.** Em `solveLinear`, o pivô já é comparado a `1e-12`. Acrescente um aviso quando ficar abaixo de `1e-6` — quase-singular ainda "resolve", mas com coeficientes gigantes que produzem predições selvagens. **É provavelmente o que gera erro grande e instável em vez de cursor travado.**

```ts
// Pivô minúsculo resolve numericamente mas gera β enorme: uma variação
// mínima na feature vira um salto de meia tela na predição. Sintoma:
// cursor "explodindo" em vez de travado.
if (Math.abs(d) < 1e-6) { degenerateColumns.push(col); }
```

---

### A1-4 🔴 Estado degradado visível

`src/tracker/engine.ts:474` — o fallback do nariz é a segunda metade do bug.

Ele existe por um bom motivo (não travar o cursor), mas precisa ser **honesto**:

1. Novo estado no engine: `'degraded'`, distinto de `'tracking'`.
2. Entra em `degraded` quando `mapGaze` devolve `null` por mais de ~500 ms seguidos.
3. Enquanto degradado: o cursor muda de aparência (contorno tracejado, cor distinta) e **o dwell fica desabilitado**.

O ponto 3 é o mais importante e o menos óbvio: **em estado degradado, permitir clique é pior que não permitir.** O cursor está sobre o nariz, não sobre o olhar; qualquer seleção é aleatória. Um usuário com ELA disparando seleções aleatórias em uma tela de comunicação pode enviar a mensagem errada para o cuidador.

4. Indicador persistente e discreto para o cuidador: *"Rastreamento indisponível — recalibre"*, com ação.

⚠️ **Exceção obrigatória:** o botão de emergência continua acionável em estado degradado, com dwell mais longo para reduzir falso positivo. É melhor um alarme falso ocasional que um pedido de socorro impossível.

---

### A1-5 🔴 Detecção de reflexo especular ⬆️⬆️ SUBIU (A0-5)

> **Nota A0-5:** reflexo/refração é a **causa raiz confirmada** — óculos aumentaram variância em +27% e introduziram viés de 400 px. Atacar aqui é atacar a causa, não o efeito. Mesmo se A1-2 e A1-3 blindarem a decisão, sem detectar o reflexo o usuário fica preso num loop de "recalibrar → falha → recalibrar". Deve ser feito em paralelo com A1-2/A1-3.

Ataca a causa em vez do efeito. `src/qualityAnalyzer.ts` já recorta a região dos olhos e calcula luminância — falta só olhar para o que interessa.

Reflexo de lente é um **cluster pequeno de pixels quase saturados** dentro do crop ocular:

```ts
// Fração de pixels com luminância > 0.95 na região ocular. Pele e esclera
// raramente saturam sob exposição correta; lente refletindo a tela, sim.
// Sinal barato: o histograma de luminância já está sendo percorrido.
specularRatio: number;
```

Uso:

- `specularRatio` alto e persistente durante a calibração → **avise antes de começar**, não depois de 25 s perdidos. Aqui a prevenção vale mais que a rejeição.
- Entra como feature de qualidade e, mais tarde, como peso de amostra.
- Aparece no indicador de enquadramento (B1-6) como *"Reflexo detectado nos óculos — incline a tela"*.

O limiar sai dos dados do A0-5, comparando com e sem óculos. **Não chute.**

---

### A1-6 🔴 Perfil de calibração por condição óptica ⬆️⬆️⬆️ SUBIU MUITO (A0-5)

> **Nota A0-5:** refração das lentes introduz **viés sistemático de 400 px**, não jitter. Isso é limite físico — nenhum ajuste de portão de variância, regularização ou filtro compensa. **Perfis separados é a única solução real** para o usuário que às vezes usa e às vezes não usa óculos. Sobe para prioridade máxima do Sprint 1 junto com A1-5.

Óculos mudam a geometria óptica de verdade — não é só reflexo. Lentes corretivas refratam o raio de luz, e **lentes progressivas ou bifocais refratam de forma diferente conforme a região da lente pela qual você olha**. Isso é um deslocamento de olhar dependente da direção, que nenhum modelo linear global compensa bem.

Consequência prática: **um perfil calibrado sem óculos não vale com óculos, e vice-versa.**

Implemente perfis nomeados por condição:

```ts
interface CalibrationProfileMeta {
  id: string;
  label: string;            // "Com óculos de leitura", "Sem óculos"
  createdAt: string;
  opticalCondition: 'sem_oculos' | 'oculos_simples' | 'oculos_progressivo' | 'desconhecido';
}
```

Na seleção de perfil, o cuidador escolhe a condição atual. Isso resolve o caso real: o paciente usa óculos à tarde para leitura e não usa de manhã.

⚠️ Se a condição for `oculos_progressivo`, registre no perfil e **não prometa a mesma precisão**. Progressivas são um limite físico do método, não um bug a corrigir. Ser honesto sobre isso na UI é melhor que o usuário achar que o sistema está quebrado.

---

## A2 — Precisão

> **Todas as tarefas de A2 entram atrás de flag, desligadas.** São correções que a análise indica serem certas, mas você tem 1°/111 px e não pode medir ainda. Implementadas e desligadas, elas estarão prontas para a fase de medição decidir uma por uma.

### A2-1 🔴 O One Euro Filter está praticamente inativo

Este é o achado técnico mais forte deste documento.

`src/oneEuroFilter.ts`, a 30 fps:

```
alpha = cutoff / (cutoff + 4,775)
cutoff = mincutoff + beta · |velocidade|
```

E a velocidade está em **pixels por segundo**, porque `engine.ts` filtra coordenadas já convertidas para pixel.

Com o preset padrão (`balanceado`: mincutoff 0,02, beta 1,5):

| Situação | velocidade | cutoff | **alpha** |
|---|---|---|---|
| suavizar de verdade exigiria | < 3,2 px/s | < 4,8 | < 0,50 |
| fixação com jitter de ±30 px | ~277 px/s | ~416 | **0,989** |

**Com alpha ≈ 0,99 o filtro repassa o sinal quase intacto.** O preset `estavel` (beta 0,5) dá 0,967 — igualmente inerte; a suavização que ele tem vem toda do `useRollingBuffer`.

Dois efeitos: o jitter que você vê hoje é essencialmente não filtrado; e como a velocidade é px/s, **o filtro depende da resolução da tela**, então duas máquinas não são comparáveis.

**Correção:** filtrar em coordenadas normalizadas `[0,1]`, antes da conversão para pixel. Ponto de partida: `mincutoff ≈ 0,5`, `beta ≈ 2,0`.

**Flag:** `filterInNormalizedSpace: false` por default. Os presets antigos ficam; os novos entram como `balanceado-v2` etc.

> Curiosidade que vale registrar: você atingiu 1°/111 px **com o filtro praticamente desligado**. Isso significa que a predição bruta do seu pipeline já é boa. Ligar o filtro de verdade deve reduzir jitter sem custo de exatidão — mas é exatamente o tipo de afirmação que só a medição confirma.

### A2-2 🟡 `LowPassFilter` inicia puxando para zero

```ts
constructor(alpha: number, initval: number = 0) {
  this.y = initval;                          // nunca fica null
}
filter(value) {
  if (this.y === null) { result = value; }   // ramo morto
  else { result = this.a * value + (1 - this.a) * this.y; }
}
```

A primeira amostra vira `a·value + (1−a)·0` — **puxada para a origem, o canto superior esquerdo**. Hoje o efeito é pequeno porque `alpha ≈ 0,99`; assim que A2-1 for ligada, vira um salto visível.

**Correção:** `y: number | null = null` e `initval` default `null`. **Sem flag** — é bug puro, e corrigi-lo com o filtro inerte não muda nada mensurável.

### A2-3 🟡 `setParams` descarta o estado

`OneEuroFilter2D.setParams` cria instâncias novas (`x = null`, `dx = null`, `lasttime = -1`), apesar do comentário afirmar que preserva o estado. Trocar preset em uso faz o cursor saltar.

**Correção:** `setParams` na própria `OneEuroFilter`, mutando os campos. Corrija o comentário. **Sem flag.**

### A2-4 🟡 `earHistory` é estado global de módulo

`src/extractor.ts:105`. O limiar de piscada é `média(earHistory) × 0,8`, e a média é realimentada pelos próprios frames de piscada: quanto mais o usuário pisca — fadiga progressiva, que é a regra em ELA — mais o limiar cai e menos piscadas são detectadas. Frame de olho semifechado entra no regressor como fixação válida.

**É deriva de precisão por construção, ao longo da sessão.**

**Correção:** encapsular em `class BlinkDetector` com `reset()`; calcular a média **apenas sobre frames de não-piscada**, quebrando a realimentação; clampar o limiar em `[0,10; 0,22]`. **Sem flag** — o comportamento atual é indefensável.

### A2-5 🟡 Anisotropia de aspect ratio

O MediaPipe normaliza `x` pela largura e `y` pela altura. Em 1920×1080 as escalas diferem por 1,78×. Mas `src/extractor.ts` calcula distâncias euclidianas misturando as duas, inclusive `interEyeDistRaw` — que **normaliza os 478 pontos rotacionados**, sendo a escala de referência do vetor inteiro.

Quando a cabeça inclina, o vetor entre os cantos dos olhos gira nesse espaço distorcido e seu comprimento medido muda mesmo com a distância física constante. **A escala de normalização oscila com a inclinação da cabeça.**

**Correção:** converter para unidades isotrópicas antes de qualquer distância (multiplicar `x` e `z` por `videoWidth/videoHeight`).

⚠️ **Isto muda os valores das features.** Perfis salvos ficam incompatíveis; incremente `RECORDING_FORMAT_VERSION`. **Flag `isotropicLandmarks: false`** — é a mudança de maior impacto potencial e de maior risco para o seu 1°.

### A2-6 🟢 Travar exposição da câmera

`getUserMedia` hoje não restringe `frameRate` nem `exposureMode`. O auto-exposure reage à luz ambiente ao longo de 30 minutos, e o brilho do crop é entrada direta do L2CS.

**Correção:** pedir `frameRate: { ideal: 30, min: 24 }` e, **após ~2 s de aquecimento**, aplicar `exposureMode/focusMode/whiteBalanceMode = 'manual'` quando o driver suportar. Travar de imediato congelaria uma exposição ainda não convergida.

Registre no diagnóstico se travou ou não — nem toda webcam expõe essas capabilities, e essa informação muda a interpretação de qualquer medida futura.

**Bônus para os óculos:** exposição travada reduz a variação do reflexo especular, que hoje muda conforme a câmera reajusta o ganho.

### A2-7 🟡 Persistir o perfil de calibração

`loadProfile()` sempre devolve `false`; `saveProfile()` é no-op. Toda sessão exige recalibração completa.

Para o usuário-alvo isso é custo real. Para você, é atrito que vai te desgastar na fase de medição.

A infraestrutura já existe: `StandardScaler` tem `getParams`/`setParams`, `gazeRegressor` tem `ridgeModelFromRegressor`/`ridgeRegressorFromModel`. É ligação, não invenção.

**Invalidar sempre dizendo o motivo:** dimensão do vetor diferente, resolução de tela ou de vídeo diferente, `experiment` diferente, perfil com mais de 24 h (aí ofereça revalidação rápida, não bloqueio).

Integre com A1-6: perfis por condição óptica.

## A3 — Higiene

### A3-1 🟢 Invariantes explícitas

`src/invariants.ts` com `assertInvariant(cond, code, detail)`, contando ocorrências e expondo `getInvariantViolations()`. Em `NODE_ENV=test` lança; em produção conta.

Instrumente: `FEATURE_DIM` (vetor do mesmo tamanho entre calibração e inferência), `FINITE_FEATURES` (nenhum `NaN`/`Infinity`), `SCALER_FITTED`, `SCREEN_UNCHANGED`, `CALIBRATION_CLAIMED_OK` (a UI só declara sucesso se `isCalibrated()`).

O último é a tradução direta da regra 3 em código.

### A3-2 🟢 Código morto e documentação

- `src/kalman.ts` — zero importadores; apagar
- `src/assets/` — zero importadores; apagar
- `public/` da raiz duplica `frontend/public/`; apagar após confirmar o empacotamento
- README descreve o L2CS como *fallback* quando ele é o núcleo obrigatório, cita "13 pontos" (são 9), "React 18" (é 19) e `python_ml/` (não existe)

Um item por commit, com `npm test && npm run build` entre cada um.

---

# FRENTE B — Frontend: UX para o paciente com ELA

## B0 — Auditoria de UX

### B0-1 🔴 Inventário das telas contra critérios objetivos

Existem 25 telas em `frontend/src/pages/`. Nenhuma foi avaliada contra um critério explícito.

Para cada uma, preencha `docs/AUDITORIA-UX.md`:

| Tela | Alvos | Menor alvo (px / ° ) | Espaçamento mínimo | "Voltar" na posição canônica? | Emergência acessível? | Contraste ≥ 4,5:1? | Operável só com olhar? |
|---|---|---|---|---|---|---|---|

**O critério de tamanho, com base na literatura.** Um estudo ergonômico de interação por olhar encontrou o **alvo ótimo em 256×256 px a 63,5 cm — 6,63° de ângulo visual — com 97 % de acerto, contra 82 % para alvos de 3,36°**.

Na sua tela (1920×1080, ~60 cm), 1° ≈ 40 px. Portanto:

| | ângulo | px |
|---|---|---|
| Alvo mínimo aceitável | 5,0° | **200 px** |
| Alvo recomendado | 6,6° | **264 px** |
| Espaçamento mínimo entre alvos | 1,5° | **60 px** |
| O que o app usa hoje | 3,8° | 150 px |

**Seus alvos de 150 px estão abaixo do mínimo da literatura**, na faixa em que a taxa de acerto cai de 97 % para 82 %. Com o erro real de p90 (que é bem maior que a média de 1°), a situação é pior que isso.

### B0-2 🔴 Revisar o tempo de dwell

`GazeContext.tsx:20` — `slow: 2500, normal: 1500, fast: 800` ms.

O mesmo estudo encontrou o **ótimo em 600 ms**, com carga de tarefa de 28,55 contra **51,02 a 800 ms** — quase o dobro. Tempo de reação de 0,362 s contra 0,680 s.

**Dwell mais longo não é mais confortável. É mais cansativo.** Isso é contraintuitivo e vale internalizar: o usuário precisa *sustentar* a fixação o tempo todo, e sustentar fixação é trabalho muscular e atencional. Prolongar o dwell para compensar imprecisão troca um problema por outro pior.

O caminho certo para reduzir seleção acidental **não é aumentar o dwell** — é aumentar o alvo, adicionar histerese e exigir fixação real.

⚠️ **Ressalva honesta:** esse estudo é com participantes saudáveis e rastreador de qualidade. Não copie os 600 ms às cegas para ELA. Mas o `normal: 1500 ms` de hoje é quase certamente longo demais, e a decisão precisa ser testada com o usuário real. Deixe o parâmetro configurável e registre a escolha.

### B0-3 🟡 Auditoria de segurança clínica

Percorra cada tela perguntando: **se o rastreamento falhar agora, o usuário fica preso aqui?**

Mapeie: telas sem saída sem rastreamento; qualquer modal que bloqueie a emergência; qualquer fluxo em que o usuário possa disparar uma ação irreversível por engano; ações destrutivas sem confirmação (e confirmação sem escape).

Isto é análise de risco de uso — a prática que a norma de engenharia de usabilidade para dispositivos médicos (IEC 62366) formaliza. Mesmo que o IrisFlow não seja registrado como dispositivo hoje, fazer essa análise agora custa pouco e é exatamente o que uma auditoria futura vai pedir.

> **Sinalização, não tarefa:** vale descobrir cedo se um software de comunicação assistiva se enquadra como dispositivo médico na ANVISA. A resposta afeta a V2, não a V1, mas descobrir isso depois de vender é caro. Uma consulta a um regulatório leva uma tarde.

---

## B1 — Design system de interação ocular

> Hoje cada tela reimplementa seus próprios botões e espaçamentos. Isso significa que ajustar o tamanho mínimo exige mexer em 25 arquivos — e que uma tela vai ficar para trás. Centralizar é pré-requisito de tudo que vem depois.

### B1-1 🔴 Tokens dimensionados em ângulo, não em pixel

Pixel não é a unidade certa. O que importa é o **ângulo visual**, que depende da distância e da densidade da tela.

```ts
// frontend/src/design/gazeMetrics.ts
// A unidade de projeto é o GRAU DE ÂNGULO VISUAL, não o pixel: o mesmo alvo
// de 200 px é confortável a 60 cm e minúsculo a 90 cm. Convertemos uma vez,
// no boot, a partir da geometria real, e todo o resto do design system
// consome os tokens em px já resolvidos.
export const GAZE_TOKENS = {
  targetMinDeg: 5.0,
  targetRecommendedDeg: 6.6,
  spacingMinDeg: 1.5,
  restZoneMinDeg: 8.0,
};
export function degToPx(deg: number, distanceCm: number, pxPerCm: number): number;
```

Emita como CSS custom properties (`--gaze-target-min`, `--gaze-spacing-min`) para o CSS consumir sem recalcular.

### B1-2 🔴 `GazeButton` canônico

Um componente, todas as telas. Encapsula o padrão de feedback de fixação em três estágios que a literatura de AAC recomenda e que o app hoje implementa de forma inconsistente:

1. **Entrada** — contorno destacado assim que o olhar entra
2. **Progresso** — anel preenchendo, proporcional ao dwell
3. **Confirmação** — flash + som opcional

Requisitos:

- Tamanho mínimo aplicado pelo próprio componente; alvo menor que `targetMinDeg` **falha em desenvolvimento** com aviso no console
- Área de acionamento maior que a área visual (~1,2×), fora do espaçamento
- Suporte a `disabled` que **remove do dwell** (`data-no-dwell`)
- O anel de progresso **nunca regride** — congela durante a graça, não volta a zero. Regressão visual é lida como "o sistema não me viu"
- Contraste ≥ 4,5:1 e o estado **nunca comunicado só por cor** (WCAG 1.4.1) — parte dos usuários tem alteração de percepção de cor por idade ou medicação

### B1-3 🟡 Layout em grade segura

```tsx
<GazeGrid columns={3} rows={2} />
```

Calcula o tamanho de célula a partir do viewport e dos tokens, e **avisa se a combinação pedida produzir alvos abaixo do mínimo**. Isso transforma "esta tela tem botões pequenos demais" de um bug de revisão em um erro de compilação lógica.

Regra de conteúdo: **máximo 6 alvos por tela** para telas do paciente. O protótipo de referência do LAIS/UFRN usa 4 a 6, e a literatura de fixação recomenda ficar em torno disso. Mais que isso exige varredura hierárquica (B3-2).

### B1-4 🔴 Posições canônicas

Duas coisas na mesma posição em **todas** as telas do paciente:

- **Voltar** — canto superior esquerdo, sempre
- **Emergência** — canto fixo, sempre visível, **nunca coberta por modal**

O valor está na constância: o usuário aprende a posição uma vez e não gasta busca visual depois. Enforce com um layout compartilhado, não com disciplina.

### B1-5 🟡 Zona de descanso

Hoje a tela inteira é potencialmente clicável, então o usuário **nunca pode simplesmente olhar** sem risco de acionar algo. É fadiga cognitiva permanente e um dos maiores incômodos relatados em sistemas de dwell.

Faixa neutra, visualmente distinta, com `data-no-dwell="true"`, presente em todas as telas do paciente. Mínimo `restZoneMinDeg`.

### B1-6 🟡 Indicador de enquadramento

Componente reutilizável mostrando distância estimada (via distância interocular) contra a faixa ideal, centralização do rosto, e — integrando com A1-5 — **aviso de reflexo nos óculos**.

Visível antes da calibração e sob demanda. Boa parte dos problemas de precisão em campo é o usuário fora da posição em que calibrou; tornar isso visível ao cuidador é mais barato que qualquer melhoria de algoritmo.

---

## B2 — Aplicar o design system

### B2-1 🔴 Migrar as telas do paciente

Ordem por criticidade de comunicação:

1. `MainMenu` — hub, é onde o usuário mais passa
2. `QuickPhrasesScreen` — caminho mais rápido entre necessidade e fala
3. `KeyboardScreen` — maior custo de tempo e atenção
4. `PictogramScreen` — usuários em estágio mais avançado
5. `EmergencyEscalation` — criticidade máxima, complexidade baixa
6. `MyOptionsScreen`, `IAmOkScreen`

Uma tela por commit, com print antes/depois no commit.

### B2-2 🟡 Separar telas de cuidador

`SettingsScreen`, `CaregiverDashboard`, `LoginScreen`, e as de diagnóstico **não são operadas por olhar**. Elas podem usar controles densos, tipografia menor, formulários — e devem, porque otimizá-las para olhar prejudica quem as usa de fato com mouse.

Marque com um layout distinto para a diferença ser visível de imediato, e proteja o acesso com PIN (B4-3).

### B2-3 🟢 Revisar as telas de lazer

Os jogos (`BubblePop`, `Memory`, `Drawing`, `FollowTarget`) têm requisitos diferentes: alvos podem ser menores porque errar não tem custo. **Mas o botão de sair, não** — esse segue o padrão. Um usuário preso num jogo sem conseguir sair é falha de segurança, não de UX.

---

## B3 — Telas e funcionalidades novas

### B3-1 🔴 Predição de palavras — a maior alavanca isolada de UX

Faça a conta com os números de hoje: escrever "banheiro" letra por letra são 8 seleções × 1,5 s = **12 segundos**, sem contar correções. Com predição decente, 2 ou 3 seleções — **cerca de 4 segundos**.

> **Uma redução de 3× no número de seleções vale muito mais para o usuário do que ir de 1° para 0,8° de erro.** Se você só tiver fôlego para uma funcionalidade nova nesta rodada, é esta.

Implementação para a V1, sem depender de nuvem:

- N-gramas de português brasileiro, embarcados
- Aprendizado do vocabulário do próprio usuário, com peso maior (nomes de familiares, medicamentos, termos do cuidado — nada disso está num corpus genérico)
- 3 a 5 sugestões, como `GazeButton` de tamanho pleno
- Predição da **próxima palavra** depois do espaço, não só completar a atual

⚠️ Sugestão deve ser **estável**: reordenar a lista enquanto o usuário está fixando é a pior coisa possível — ele seleciona o que não queria. Congele a lista durante um dwell em andamento.

### B3-2 🟡 Teclado por varredura hierárquica

Alternativa ao QWERTY em tela cheia para quando a precisão estiver ruim ou o usuário cansado. Seleciona grupo de letras (6 alvos grandes), depois a letra (6 alvos grandes).

Dobra o número de seleções, mas **cada uma é muito mais confiável**. Com alvos de 6,6° em vez de 2°, a taxa de acerto sobe o suficiente para compensar. Ofereça como modo alternativo, comutável pelo cuidador — não substitua o layout atual.

### B3-3 🟡 Modo descanso

O usuário não está sempre se comunicando. Sem um modo de descanso, o sistema segue interpretando fixações involuntárias como comandos durante a TV, a visita, o cochilo.

Tela neutra, de baixo estímulo, reativada por gesto deliberado (fixação longa num alvo único e grande). Reduz seleção acidental e fadiga, e é uma das poucas funcionalidades que melhora a experiência *não usando* o sistema.

### B3-4 🟡 Lembretes e rotina

Medicação, hidratação, mudança de posição, fisioterapia. Configurado pelo cuidador, exibido como notificação discreta, confirmável com uma fixação.

⚠️ **Notificação nunca rouba o foco durante uma composição de mensagem.** Enfileire e mostre depois. Interromper alguém que leva 40 s para escrever uma frase é cruel.

### B3-5 🟢 Histórico para o cuidador e a equipe clínica

Frases mais usadas, horários de maior atividade, evolução da qualidade de calibração ao longo das semanas.

O último item tem valor clínico real: degradação progressiva da precisão pode refletir progressão da doença — controle ocular, ptose palpebral, postura. É informação para a equipe de saúde, não só telemetria de produto.

⚠️ Dado de saúde sob a LGPD. Consentimento específico, finalidade declarada, exclusão efetiva. **Local por padrão**, exportação só por ação explícita do cuidador.

---

## B4 — Segurança e confiança

### B4-1 🔴 Caminho de emergência à prova de falha

Requisitos, todos verificáveis:

- Acionável a partir de **qualquer** tela, incluindo estado degradado (A1-4)
- Nunca coberto por modal, toast ou tela de erro
- Dwell próprio, mais longo (reduz falso positivo) mas **sempre disponível**
- Confirmação visível e cancelável dentro de uma janela curta
- Escalonamento se o cuidador não responder (`EmergencyEscalation` já existe — auditar contra estes requisitos)

**Teste manual obrigatório:** desconecte a webcam no meio de uma sessão e verifique que a emergência continua acionável por teclado/mouse pelo cuidador.

### B4-2 🟡 Aviso de estado degradado

Contraparte de A1-4 no front: indicador discreto, persistente e acionável. Nunca modal.

Linguagem para o cuidador, não para o desenvolvedor: *"Rastreamento impreciso — recalibre"*, não *"hull ratio 2.4"*.

### B4-3 🟡 PIN para o modo cuidador

Configurações, dashboard e dados clínicos atrás de PIN numérico, digitado por mouse ou teclado. Evita que o usuário altere parâmetros sensíveis por fixação prolongada acidental — e é requisito de proteção de dado de saúde.

### B4-4 🟢 Onboarding do cuidador

A pessoa que instala provavelmente não é técnica. Um guia curto: posicionar a câmera, ajustar a iluminação, o que fazer se a calibração falhar (incluindo o caso dos óculos), como reajustar.

**Menos chamados de suporte, e um usuário que não fica travado esperando.**

---

# Rota de sprints

Uma pessoa não roda duas frentes em paralelo de verdade. A alternância abaixo respeita as dependências e evita que você fique preso num contexto só.

| Sprint | Frente | Foco | Entregável |
|---|---|---|---|
| **0** | A+B | Auditoria | `PONTO-DE-REFERENCIA.md`, `AUDITORIA-SPRINT-0.md`, `BUG-OCULOS-EVIDENCIA.md`, `AUDITORIA-UX.md` |
| **1** | **A** | Bug dos óculos | A1-1 a A1-4 — falha alta, portão bidirecional, treino robusto, estado degradado |
| **2** | **B** | Design system | B1-1 a B1-4 — tokens, `GazeButton`, grade, posições canônicas |
| **3** | **A** | Óculos, parte 2 + higiene | A1-5, A1-6, A3-1, A3-2 |
| **4** | **B** | Migração das telas | B2-1, B2-2 — telas do paciente e separação do cuidador |
| **5** | **A** | Precisão (tudo desligado) | A2-1 a A2-7 atrás de flag |
| **6** | **B** | Predição de palavras | B3-1 — a maior alavanca de UX |
| **7** | **B** | Telas novas e segurança | B3-2 a B3-5, B4-1 a B4-4 |
| **8** | A+B | Consolidação | tudo verde, flags documentadas, pronto para medir |

### Por que esta ordem

**Sprint 1 é A e não é negociável.** O bug dos óculos não é imprecisão — é o sistema afirmando que funciona quando não funciona. Em software de saúde isso vem antes de qualquer coisa, inclusive de estética.

**Sprint 2 é B porque o design system é infraestrutura.** Fazer telas novas antes dele significa refazê-las depois. Toda tela migrada antes do sistema existir é retrabalho.

**Sprint 5 concentra a precisão.** Reunir todas as mudanças de sintonia num sprint só, todas desligadas, prepara a fase de medição: você vai ligar uma de cada vez e ver o efeito isolado. Espalhá-las pelos sprints tornaria impossível atribuir o resultado.

**Sprint 6 antes do 7** porque predição de palavras muda a percepção do produto mais que qualquer tela nova. Se o cronograma apertar, corte do 7, nunca do 6.

### O que fazer se atrasar

Ordem de corte, do primeiro a sair para o último:

1. B3-5 (histórico)
2. B3-2 (teclado por varredura)
3. B3-4 (lembretes)
4. A2-5 (isotropia) — é a de maior risco para o seu 1° e a que mais precisa de medição para valer
5. **Nada mais.** Sprints 0, 1, 2 e 6 e as tarefas B4 são o piso.

### Regras que valem em todos os sprints

- **`npm test` verde a cada commit.**
- **Um commit por tarefa**, prefixo `[A1-2]` ou `[B1-3]`.
- **Nenhuma flag de A2 ligada por default.** Nenhuma exceção.
- **Print antes/depois em todo commit de frente B.**
- Se um achado deste documento não se confirmar no código, **pare e reporte** em vez de inventar trabalho.

---

## Depois: a fase de medição

Quando as duas frentes fecharem, o próximo passo é o script de medição — isolado do ecossistema do projeto, escrevendo num diretório próprio, com um manifesto por sessão registrando a condição que produziu cada número.

Duas coisas que este preparo de terreno já deixa prontas para aquele momento:

- **as flags de A2 desligadas**, para serem ligadas uma a uma e medidas isoladamente;
- **as invariantes de A3-1**, que dizem se uma sessão foi saudável — sem elas você não sabe distinguir "o parâmetro piorou" de "aquela sessão teve um bug".

Não comece a medir antes de fechar as duas frentes. Medir um sistema que ainda vai mudar produz números que envelhecem em uma semana — e você já tem um número bom em `v0-melhor-erro` para servir de âncora até lá.

---

## Referências

- Tamanho de alvo e tempo de dwell ótimos — [MDPI, *Improving Eye–Computer Interaction Interface Design*](https://www.mdpi.com/1995-8692/12/3/21)
- Parâmetros de dwell em interação por olhar — [Designing for the eye, ACM](https://dl.acm.org/doi/10.1145/2414536.2414609)
- Conteúdo acessível para usuários de rastreamento ocular — [BOIA](https://www.boia.org/blog/creating-accessible-content-for-people-who-use-eye-tracking-devices)
- MediaPipe Iris, limitações de rastreamento de íris — [Google Research](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/)
