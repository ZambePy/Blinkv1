# Bloco 4 — Calibração e aferição: a moldura

**Data:** 2026-09-07
**Escopo:** frontend (`frontend/src/`). Do `src/` apenas **leitura** de
`calibration`, `calibrationGridDiagnosis` e `accuracy`.
**Fora de escopo, intocável:** `electron/`, a coleta da calibração,
`startAccuracyTest`.

---

## 1. O que já existe

O miolo funciona. O que falta é a moldura — e uma parte dela também já existe,
escondida dentro de um arquivo grande demais.

**`getCalibrationFitDiagnostics()`** entrega, prontos:

| Campo | O que é |
|---|---|
| `looErrorPx` | erro leave-one-target-out médio |
| `looByTarget` | LOO por alvo |
| `poseDrift` | deriva postural **entre** alvos, separada do ruído dentro de cada ponto |
| `gridDiagnosis` | veredito da grade, com `centroPx`, `periferiaPx`, `razao`, `piorAlvoPx` e mensagem pronta |

`gridDiagnosis` já distingue "a periferia saiu do alcance" de "a sessão inteira
está ruim". O veredito do cuidador é **tradução** disso, não medição nova.

**`CalibrationCheck.tsx` tem 1543 linhas e cinco estágios** (`tutorial`,
`calibrating`, `testing`, `transitioning`, `drift-warning`). A tela de
preparação que o pedido descreve é o estágio `tutorial`; o resultado está
embutido no `testing`.

**O `blocoDeMedicao` já é derivado e gravado.** O pedido supõe que ele "só
existe no tipo do relatório"; a suposição está desatualizada.
`registroDaSessao.ts` abre explicando por que ele deixou de ser manual:

> "O número do bloco ficava para anotação manual, e 'anotação manual' virou
> `blocoDeMedicao: undefined` em todo relatório."

Dos seis relatórios em `docs/medicoes/historico/`, quatro têm
`blocoDeMedicao: 1` gravado. A derivação funciona.

**O teste de precisão vive nas Configurações** (`startAccuracyTest`), separado
do estágio `testing` do `CalibrationCheck` — que é o diagnóstico pós-treino,
outra coisa.

## 2. Decisões

| # | Decisão | Razão |
|---|---|---|
| D1 | Extrair preparação e resultado do `CalibrationCheck` para rotas próprias | É o que o pedido descreve, e o arquivo com 1543 linhas e cinco estágios precisa disso. Não é refatoração oportunista: são exatamente as telas em questão. |
| D2 | A coleta (`calibrating`) fica intocada | Funciona, é a parte mais delicada, e nada no pedido a envolve. |
| D3 | O veredito traduz `gridDiagnosis` e `looErrorPx`; não inventa limiar | Um segundo critério ao lado do que já existe divergiria do primeiro no primeiro ajuste. |
| D4 | O motivo é dito antes do número | "Você se mexeu entre os alvos" é acionável; "LOO 87 px" não é. O número aparece também. |
| D5 | Refazer **nunca** é obrigatório | Mesmo no pior veredito dá para seguir. A decisão é do cuidador, que sabe coisas que o software não sabe. |
| D6 | `blocoDeMedicao` é exibido, **somente leitura** | Um campo digitável ao lado do derivado seria a primeira coisa a ficar vazia de novo. |
| D7 | Teste de precisão e relatório em rotas próprias | O relatório é o produto da medição, não um cartão de ajuste. O botão nas Configurações passa a navegar. |
| D8 | O export reaproveita o caminho existente | `/__/save-accuracy-report` com queda para download do navegador já está escrito e testado. |

## 3. Arquitetura

```
frontend/src/
  pages/calibration/
    PreparoDaCalibracao.tsx     rota /calibration/preparo
    ResultadoDaCalibracao.tsx   rota /calibration/resultado
    veredito.ts                 tradução pura do diagnóstico
  pages/relatorio/
    RelatorioDaSessao.tsx       rota /relatorio
```

`CalibrationCheck` perde o estágio `tutorial` e a apresentação do resultado;
mantém `calibrating`, `transitioning` e `drift-warning`.

### 3.1 `veredito.ts` — a tradução

```ts
export type VeredictoDaCalibracao = 'bom' | 'aceitavel' | 'refazer';

export interface LeituraDaCalibracao {
  veredicto: VeredictoDaCalibracao;
  /** Chave i18n do motivo. `null` quando não há o que explicar. */
  motivo: string | null;
  looErrorPx: number;
  /** Deriva postural entre alvos, em graus. */
  derivaGraus: number | null;
}

export function lerCalibracao(
  diag: CalibrationFitDiagnostics | null,
): LeituraDaCalibracao;
```

Pura, sem React: dá para testar a tabela de decisão inteira sem renderizar.

**Limiares.** Saem do que o core já usa, não de números novos:

| Condição | Veredito |
|---|---|
| `gridDiagnosis.veredicto` já reprova | `refazer` |
| deriva postural entre alvos acima de 3° | `refazer` — o motivo é movimento, não olhar |
| `looErrorPx` acima de 2× o LOO de uma sessão boa | `refazer` |
| `gridDiagnosis` acusa periferia | `aceitavel`, com o motivo da periferia |
| resto | `bom` |

Sem diagnóstico (`null`) devolve `aceitavel` com motivo `null` — nunca
`refazer`: reprovar por ausência de medição mandaria o paciente repetir a
calibração sem que nada estivesse errado.

### 3.2 Fluxo

```
/setup → /calibration-check → /calibration/resultado → /tutorial ou /menu
                                      │
                                      └─ refazer → /calibration-check
```

A preparação (`/calibration/preparo`) vem **antes** de `/calibration-check`. O
teste de precisão e o relatório ficam fora do caminho obrigatório:

```
Configurações → /relatorio (roda o teste e mostra)
```

## 4. As quatro telas

### 4.1 Preparação — `/calibration/preparo`

O que vai acontecer, quanto tempo leva, quantos alvos. Mais as duas instruções
que mudam o resultado:

- **"Olhe para o centro do alvo"** — não para a borda nem para o número.
- **"Pisque normalmente; não segure o piscar."** Segurar resseca o olho e
  degrada o landmark exatamente durante a coleta. A instrução ingênua ("não
  pisque") produz o pior resultado possível.

### 4.2 Calibração

Intocada.

### 4.3 Resultado — `/calibration/resultado`

O veredito em linguagem de cuidador, o motivo, e o número ao lado. Dois botões:
seguir e refazer — os dois sempre habilitados (D5).

Quando o motivo é deriva postural, a tela diz isso com todas as letras: o
problema não foi o olhar, foi a cabeça ter mudado de lugar entre os alvos, e
recalibrar sem corrigir a posição repete o resultado.

### 4.4 Relatório — `/relatorio`

Roda o teste de precisão e apresenta:

- Erro médio em **graus** (a métrica comparável entre setups).
- **Bloco de medição**, derivado e somente leitura: "2ª rodada contra esta
  calibração".
- Origem da diagonal do monitor (`edid` / `manual` / `default`) — um erro
  angular calculado sobre diagonal padrão não é comparável com um calculado
  sobre medida.
- Lux, quando preenchido no preparo.
- Botão de exportar, pelo caminho que já existe.

Quando o bloco é 1 e nunca houve um 2, a tela diz isso: a comparação entre
blocos que o campo existe para permitir ainda não aconteceu nesta calibração.

## 5. Testes

| Arquivo | Cobre |
|---|---|
| `pages/calibration/veredito.test.ts` | a tabela de decisão inteira; deriva alta vence LOO baixo; diagnóstico `null` não vira `refazer` |
| `pages/calibration/ResultadoDaCalibracao.test.tsx` | os três vereditos na tela; **refazer nunca é obrigatório**; o motivo aparece antes do número |
| `pages/calibration/PreparoDaCalibracao.test.tsx` | as instruções que importam estão lá; a de piscar não diz "não pisque" |
| `pages/relatorio/RelatorioDaSessao.test.tsx` | bloco exibido e **não editável**; origem da diagonal visível; export chamado |
| `App.router` (existente) | as rotas novas resolvem |

O guarda de tema recebe as telas novas.

Verificação: `cd frontend && npm run verify`.

## 6. Limitações conhecidas

1. **O limiar de "LOO alto" é calibrado contra poucas sessões.** As medições no
   repositório são de um setup só. O número vai precisar de revisão quando
   houver dados de outras máquinas — e está numa constante nomeada, não
   espalhado.
2. **Nenhum relatório existente tem bloco 2.** A contagem reinicia quando a
   calibração muda, e cada teste foi rodado após calibrar de novo. Não é
   defeito; significa que a sessão de dois blocos ainda não foi feita. A tela
   torna isso visível em vez de deixar implícito.
3. **O veredito não sabe se o paciente estava cansado.** Ele lê geometria e
   erro. Um "bom" numa sessão em que a pessoa estava exausta continua sendo
   "bom" — a leitura clínica é do cuidador.


---

## 7. Desvios da implementação

1. **A preparação virou cartão, não rota.** O estágio `tutorial` do
   `CalibrationCheck` já é a tela pré-início e carrega o `ReadinessPanel`, a
   escolha entre calibração completa e rápida, e o estado de carregamento do
   modelo. Extraí-lo perderia as três coisas; somar uma rota ao lado seria a
   duplicação que este projeto já acumulou vezes demais. O que faltava era
   **conteúdo**, e é isso que o cartão entrega.

2. **Os limiares saíram das seis sessões reais**, não da regra do §3.1. Medido
   em `docs/medicoes/historico/`:

   | | LOO (px) | deriva máx (°) | grade |
   |---|---|---|---|
   | melhor | 68 | 2,67 | `ok` |
   | mediana | 170 | — | — |
   | pior | 252 | 2,12 | `sessao_ruim` |

   A sessão com **3,47°** de deriva foi classificada pelo core como
   `periferia_fora_de_alcance`, não como ruim. O "deriva > 3° → refazer" que o
   §3.1 propunha reprovaria uma sessão que o próprio core aceita. A deriva
   passou a escolher o **motivo**; quem decide o veredito é `gridDiagnosis`.

   `LOO_BOM_PX = 110` rebaixa de bom para aceitável e **não** reprova: LOO alto
   com grade `ok` pode ser distância ou luz, e recalibrar não corrige nenhuma
   das duas.

3. **O relatório apresenta; não dispara.** O disparo nas Configurações resolve
   geometria, monta a `RunMeta`, deriva o bloco e registra no histórico
   clínico. Reproduzir aquilo na tela nova duplicaria um caminho delicado e já
   correto. Quem roda grava um resumo
   (`services/local/ultimoRelatorio.ts`), e a tela lê.

4. **O botão exporta um RESUMO, não o relatório.** O relatório canônico
   (`schema: irisflow.accuracy-report/2`) já é escrito pelo próprio
   `startAccuracyTest`, na raiz do projeto ou no download. O resumo tem schema
   próprio (`irisflow.accuracy-summary/1`) para ninguém confundir os dois numa
   análise posterior, e a tela diz em voz alta que o completo já foi salvo.

5. **O destino após o resultado vem no `state` da rota.** A regra "tutorial na
   primeira vez, menu depois" mora na calibração; reproduzi-la na tela de
   resultado criaria duas cópias dela.
