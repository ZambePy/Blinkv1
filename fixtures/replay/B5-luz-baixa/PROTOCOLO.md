# B5 — Luz baixa / entardecer

**Motivação.** SPRINTSELA §11 lista "ao entardecer" — momento em que a
iluminação natural cai e a câmera aumenta o ganho, o que introduz ruído
por pixel e degrada o rastreamento fino de íris.

**Pré-requisito.** [`../PROTOCOLO_COMUM.md`](../PROTOCOLO_COMUM.md) + B1.

## Condições ambientais específicas

Sobrescreve o B1 nestes pontos:

| Variável | Alvo |
|---|---|
| Iluminação | **Baixa.** Apague o teto, luz apenas de uma lâmpada distante ou luz de rua entrando pela janela. Seu rosto deve ficar visível mas notavelmente mais escuro que no B1. |
| Hora do dia | Idealmente entre 18h30 e 20h30 (equinócio dá margem — luz natural que cai). Se estiver em outro horário, simule com lâmpada fraca. |
| Resto | Igual ao B1 (sem óculos, cabeça reta, ~60 cm). |

## Como confirmar que a luz está "baixa o suficiente"

Difícil objetivar sem lux-metro. Uma verificação prática: abra a webcam em
outro app antes de começar; se ele ainda está a 30 fps *e* a imagem parece
"nítida", provavelmente ainda não está no regime de baixa luz. Diminua mais.

## Resultado esperado

Este cenário testa **ruído no sinal**, não uma dificuldade estrutural (como
o B4). O One Euro Filter deve amortecer boa parte do jitter.

- `medianErrorPx(B5) < 1.7 × medianErrorPx(B1)` → OK
- Preste atenção em `p90ErrorPx` também: se a mediana ficou boa mas o p90 subiu
  muito, é jitter que o filtro amortece "em média" mas deixa passar picos —
  discutir preset do filtro em Fase 2.

## Onde salvar

```
fixtures/replay/B5-luz-baixa/B5-<YYYY-MM-DD>.jsonl
fixtures/replay/B5-luz-baixa/B5-<YYYY-MM-DD>.report.json
```
