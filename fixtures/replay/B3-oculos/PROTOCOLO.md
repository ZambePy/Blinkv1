# B3 — Com óculos

**Motivação.** SPRINTSELA §11 lista explicitamente. Óculos introduzem:
- Reflexo especular na lente que pode ser confundido com pupila/íris
- Distorção geométrica ao redor da armação
- Oclusão parcial dos landmarks periorbitais quando a armação é grossa

**Pré-requisito.** [`../PROTOCOLO_COMUM.md`](../PROTOCOLO_COMUM.md) + B1 já
feito. **Pule este cenário se você não tem óculos** — não faz sentido gravar
"com óculos" usando óculos falsos, os reflexos e a geometria não batem.

## Condições ambientais específicas

Sobrescreve o B1 nestes pontos:

| Variável | Alvo |
|---|---|
| Óculos | **Colocar os óculos de uso normal.** Não emprestar de outra pessoa (grau errado altera a acomodação e afeta o olhar). |
| Iluminação | Igual ao B1 (frontal, difusa). Se sua iluminação frontal cria reflexo forte no vidro, aumente o ângulo da tela ou incline levemente a cabeça — mas anote no `HISTORICO.md`. |
| Resto | Igual ao B1. |

## Resultado esperado

Similar ao B2: espera-se erro maior que o B1.

- `medianErrorPx(B3) < 1.5 × medianErrorPx(B1)` → OK
- `medianErrorPx(B3) > 2.5 × medianErrorPx(B1)` → óculos derruba muito, anotar

Vale também comparar `perPoint`: se apenas certos pontos (ex: bordas superiores)
ficaram muito piores, o problema pode ser reflexo específico da armação
projetado nesses ângulos.

## Onde salvar

```
fixtures/replay/B3-oculos/B3-<YYYY-MM-DD>.jsonl
fixtures/replay/B3-oculos/B3-<YYYY-MM-DD>.report.json
```
