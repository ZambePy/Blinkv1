# B1 — Baseline

**Motivação.** Referência. Sem essa gravação bem feita, os outros cenários
não têm com o que ser comparados. Comece por essa.

**Pré-requisito.** Leia [`../PROTOCOLO_COMUM.md`](../PROTOCOLO_COMUM.md) uma
vez antes.

## Condições ambientais específicas

| Variável | Alvo |
|---|---|
| Iluminação | Frontal, difusa, luz do dia OU luz de teto neutra. Sem janela atrás. |
| Óculos | **Não usar** (se você usa no dia-a-dia, este cenário é B1-baseline sem; o cenário B3 é com) |
| Distância à tela | ~60 cm (medir com fita se puder — é o valor assumido em `accuracy.ts`) |
| Pose da cabeça | Reta, olhando para o centro da tela; sem inclinação |
| Câmera | Alinhada com a testa, não muito abaixo (nada de laptop no colo) |
| Roupa | Neutra, sem estampa que confunda o detector de rosto |

## Resultado esperado

Se o baseline estiver **bom**, o report deve mostrar:

- `accuracy.medianErrorPx` < 200 px (em 1920×1080, ~10% da diagonal)
- `accuracy.medianErrorDeg` < 5°
- `frames.discarded / frames.totalInJsonl` < 10%

Se o baseline estiver **ruim** (>10° mediana), **pare**. Não faça os outros
cenários — o problema é upstream (câmera, iluminação, o próprio pipeline). Os
outros cenários só vão mascarar o defeito, não expor.

## Onde salvar

```
fixtures/replay/B1-baseline/B1-<YYYY-MM-DD>.jsonl
fixtures/replay/B1-baseline/B1-<YYYY-MM-DD>.report.json  ← commitar este
```

Se refizer no mesmo dia, adicione sufixo `-a`, `-b`, etc.
