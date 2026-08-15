# B4 — Cabeça inclinada / pose lateral

**Motivação.** SPRINTSELA §6 diz explicitamente:

> Inclua as variáveis de pose da cabeça como entrada da regressão. É o que
> permite o sistema tolerar a cabeça se mover um pouco entre calibração e
> uso — situação garantida quando o cuidador reposiciona o usuário na cadeira.

Este cenário mede se o pipeline atual já compensa isso, ou se um giro leve
já destrói a precisão.

**Pré-requisito.** [`../PROTOCOLO_COMUM.md`](../PROTOCOLO_COMUM.md) + B1.

## Condições ambientais específicas

Sobrescreve o B1 nestes pontos:

| Variável | Alvo |
|---|---|
| Pose da cabeça | Calibrar **normalmente reto** (como no B1). Depois, para a validação, incline a cabeça **~15°** para o lado (ombro esquerdo). Manter essa inclinação durante os 9 pontos de validação. |
| Resto | Igual ao B1. |

**Detalhe importante.** A calibração é feita reta; a validação é feita
inclinada. Isso simula a situação real do parágrafo do SPRINTSELA: o usuário
foi calibrado com uma pose, depois é reposicionado.

Se você inverter (calibrar inclinado, validar reto), o resultado é uma outra
coisa — e nesse caso renomeie o arquivo para `B4-invertido-...` para não
confundir análises futuras.

## Resultado esperado

Este é o cenário que provavelmente vai regredir mais. O SPRINTSELA cita como
justificativa exata para incluir pose da cabeça nas features — se seu pipeline
já faz isso bem, o erro sobe pouco.

- `medianErrorPx(B4) < 2 × medianErrorPx(B1)` → pipeline tolera pose razoavelmente
- `medianErrorPx(B4) > 3 × medianErrorPx(B1)` → prioridade Fase 1: melhorar as
  features de pose ou adicionar normalização geométrica

## Onde salvar

```
fixtures/replay/B4-cabeca-inclinada/B4-<YYYY-MM-DD>.jsonl
fixtures/replay/B4-cabeca-inclinada/B4-<YYYY-MM-DD>.report.json
```
