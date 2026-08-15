# B2 — Contraluz

**Motivação.** SPRINTSELA §12 lista "Iluminação variável destrói a estimativa"
como risco de probabilidade **alta**. Este cenário mede quão ruim fica quando
o rosto está subexposto por luz forte atrás.

**Pré-requisito.** [`../PROTOCOLO_COMUM.md`](../PROTOCOLO_COMUM.md) + tenha
feito o B1 antes (senão você não sabe o quanto é "pior que o baseline").

## Condições ambientais específicas

Sobrescreve o B1 nestes pontos:

| Variável | Alvo |
|---|---|
| Iluminação | **Janela atrás de você**, cortina aberta, dia claro. Se não tem janela, use uma lâmpada forte apontada para a nuca. |
| Iluminação frontal | Nenhuma (apagar luz do teto). O rosto deve ficar visivelmente escuro na câmera. |
| Resto | Igual ao B1 (sem óculos, cabeça reta, ~60 cm, câmera alinhada). |

Antes de gravar: abra o preview da câmera (algum app) e confirme que o
rosto está sub-exposto (silhueta escura contra luz clara).

## Resultado esperado

O erro **vai** subir em relação ao B1 — a pergunta é quanto.

- Se `medianErrorPx(B2) < 1.5 × medianErrorPx(B1)` → OK, pipeline tolera contraluz razoavelmente.
- Se `medianErrorPx(B2) > 2.5 × medianErrorPx(B1)` → o pipeline é frágil a
  contraluz; anotar como bug a atacar em Fase 1 ou Fase 2.

## Onde salvar

```
fixtures/replay/B2-contraluz/B2-<YYYY-MM-DD>.jsonl
fixtures/replay/B2-contraluz/B2-<YYYY-MM-DD>.report.json
```
