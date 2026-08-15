# Conjunto de regressão gravado (Fase 0.3 do SPRINTSELA.MD)

Este diretório abriga as gravações `.jsonl` que compõem o conjunto de regressão
do IrisFlow. Cada gravação captura uma sessão real (calibração + validação) em
uma condição ambiental específica.

**Por que isso existe.** SPRINTSELA §11 (Testes) e §13 (Fase 0):

> Grave sessões de vídeo cruas com marcação de verdade conhecida (a pessoa
> olhando para alvos em posições conhecidas), em condições variadas: bem
> iluminado, contraluz, cabeça inclinada, com óculos, ao entardecer. Guarde
> num conjunto versionado.
>
> **Nenhuma mudança no modelo ou no pipeline entra sem reprocessar esse
> conjunto e comparar as métricas.**

Sem esse conjunto, é impossível saber se uma "melhoria" no pipeline degradou
outro cenário — o mesmo defeito que o SPRINTSELA classifica como "falha
silenciosa, o pior defeito possível".

## Cenários

Numerados conforme minha decomposição do texto do SPRINTSELA em condições
reproduzíveis. Faltando algum? Adicione uma pasta nova seguindo o padrão.

| ID | Cenário | Motivação (do SPRINTSELA) |
|----|---------|---------------------------|
| **B1** | Baseline (iluminação frontal boa, sem óculos, cabeça reta) | Referência para comparação — sem essa não dá pra medir se os outros regridem |
| **B2** | Contraluz (janela atrás) | §12 Risco "Iluminação variável destrói a estimativa" |
| **B3** | Com óculos | §11 lista explícita |
| **B4** | Cabeça inclinada / pose lateral | §11 lista explícita + §6 pose da cabeça como entrada da regressão |
| **B5** | Luz baixa / entardecer | §11 "ao entardecer" |
| **B6** | Sessão longa (~10 min após calibração) | §12 Risco "Deriva de calibração ao longo do dia" |

## Como gerar uma gravação

Cada cenário tem seu próprio `PROTOCOLO.md`. Antes de qualquer um, leia
[`PROTOCOLO_COMUM.md`](./PROTOCOLO_COMUM.md) — ele descreve os passos que
TODOS compartilham (calibração, validação, exportação, nomenclatura).

Ordem sugerida: comece pelo **B1**. Se o baseline não ficar bom, os outros
cenários vão mascarar defeitos do baseline em vez de expor problemas próprios.

## Como rodar o replay

Depois de gravar e salvar o `.jsonl` na pasta do cenário:

```bash
npm run replay -- --jsonl fixtures/replay/B1-baseline/B1-2026-08-15.jsonl --report fixtures/replay/B1-baseline/B1-2026-08-15.report.json
```

O `.report.json` contém as métricas (mediana/p90 em px e graus, por-ponto). A
Fase 0.4 (bench, ainda por vir) vai comparar reports contra um baseline
tolerando ≤10% de regressão.

## Política de storage — importante

Arquivos `.jsonl` **não são commitados por padrão**. Motivos:

- **Tamanho.** Uma sessão B6 (10 min a 30 fps) pesa ~50 MB. Seis cenários viram
  ~200 MB no `.git` — inaceitável para um repo comum.
- **Privacidade.** Landmarks e features são dado biométrico. Não deve virar
  público em um repo Git sem controle.

Se quiser versionar uma gravação específica (ex: um "gold standard" B1), use
`git add -f fixtures/replay/B1-baseline/B1-YYYY-MM-DD.jsonl` explicitamente.
Alternativas para o conjunto completo:

- **Git LFS** — solução padrão quando o conjunto crescer. Não configurado ainda.
- **Storage externo** (Drive/pen drive compartilhada) — mais simples, funciona
  desde já.

Os `.report.json` são pequenos (~2 KB) e **podem** ser commitados — servem de
snapshot histórico de acurácia. Ver `.gitignore` local.
