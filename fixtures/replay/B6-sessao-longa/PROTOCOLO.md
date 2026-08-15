# B6 — Sessão longa (deriva temporal)

**Motivação.** SPRINTSELA §12 lista "Deriva de calibração ao longo do dia"
como risco de probabilidade **alta** e impacto **alto**. Este é o único
cenário que mede tempo — os outros são estáticos.

**Meta declarada** (SPRINTSELA §13 Fase 2): deriva < **1°/hora**.

**Pré-requisito.** [`../PROTOCOLO_COMUM.md`](../PROTOCOLO_COMUM.md) + B1
funcionando bem (senão, medir "deriva" em cima de um baseline ruim é ruído
sobre ruído).

## Condições ambientais específicas

Igual ao B1 — o objetivo é isolar a variável tempo, não empilhar dificuldades.

## Protocolo estendido (o diferente do B1)

Depois do passo 3 do `PROTOCOLO_COMUM.md` (validação inicial de 9 pontos),
**não pare a gravação.** Faça:

1. **T+0 (imediatamente após validação inicial)** — validação 9 pontos JÁ FEITA.
2. **Sessão de "uso livre"**: passe **~5 min** olhando para pontos aleatórios
   da tela, sem clicar em nada. Um jeito prático: abra um documento com muito
   texto e leia normalmente. Não recalibre nesse intervalo.
3. **T+5 min** — abra novamente o teste de precisão de 9 pontos. Faça o teste.
4. Sessão de "uso livre" **~5 min** de novo (total: 10 min de uso desde a
   calibração).
5. **T+10 min** — teste de precisão de 9 pontos pela terceira vez.
6. Parar gravação, exportar.

Resultado: o JSONL tem **3 blocos** de frames `target.kind='accuracy'`,
espaçados no tempo. O `captureTs` (em ms) permite separá-los depois.

## Análise pós-replay

O replay atual (Fase 0.2) trata todos os frames de precisão como um único
conjunto. **Para B6 isso subestima o erro** (mistura T+0, T+5, T+10).

Análise correta requer segmentar por `captureTs`. Enquanto isso, uma
aproximação: rode o replay três vezes com filtro manual do JSONL, cada uma
com apenas um bloco de accuracy. Comparar as três `medianErrorPx` mostra a
deriva.

Um script auxiliar de segmentação temporal deve entrar em Fase 0.4 ou 2.

## Resultado esperado (aproximação)

Sem recalibração implícita (Fase 4 do SPRINTSELA), esperado:

- `medianErrorDeg(T+10) - medianErrorDeg(T+0)` > 0 (alguma deriva positiva)
- Se essa diferença exceder ~0.17° (equivale a 1°/hora × 10 min), risco
  confirmado — precisa de recalibração implícita (SPRINTSELA §6.2).

## Onde salvar

```
fixtures/replay/B6-sessao-longa/B6-<YYYY-MM-DD>.jsonl
fixtures/replay/B6-sessao-longa/B6-<YYYY-MM-DD>.report.json
```
