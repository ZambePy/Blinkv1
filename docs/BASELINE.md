# BASELINE — Sprint 0

> **Instruções para quem for medir.** Este documento é o ponto de comparação
> para todas as sprints seguintes. Cada mudança compara-se contra os números
> aqui, **nunca contra a sprint anterior**. Ganhos ≤ 10% são ruído do
> protocolo — não conclua nada a partir deles.
>
> Todas as métricas devem ser preenchidas rodando o botão **"Testar precisão"**
> na tela de Configurações (Sprint 0 entregou este botão). O botão coleta
> `meanError`, `medianError`, `p90Error`, `meanErrorX/Y`, `meanErrorDeg` e o
> novo `jitterRMS`, e exporta um JSON contendo esses valores + a `RunMeta`
> preenchida antes do teste. Cole o resumo aqui após cada execução; anexe o JSON
> à pasta `docs/historico/` se quiser preservar o detalhamento por ponto.

## Configuração medida

| Item | Valor |
|---|---|
| Regressor | Ridge (`REGRESSOR_MODE = 'ridge'` em `src/gazeRegressor.ts`) |
| λ do Ridge | seleção por CV leave-one-target-out em `RidgeRegressor.train` |
| Dimensões por olho | ~31 (`USE_COMPACT_FEATURES = true` em `src/featurePipeline.ts`) |
| Pontos de calibração | 13 (`CALIBRATION_POINTS` em `frontend/src/pages/onboarding/CalibrationCheck.tsx`) |
| Pontos de validação | 13 (`VALIDATION_POINTS` em `src/accuracy.ts`, independentes da calibração) |
| Janela de coleta por ponto (calibração) | 1500 ms + 400 ms de acomodação inicial |
| Janela de coleta por ponto (validação) | 1000 ms |
| Suavização | rolling buffer 6 frames (pesos 1..6) + OneEuro (`mincutoff=0.005`, `beta=1.5`) |
| Câmera | 1280×720 @ ~30 FPS via `getUserMedia` |
| Distância assumida usuário↔tela | 60 cm (`ASSUMED_DIST_PX ≈ 2268`) |

## Como reproduzir a medição

1. `npm run electron:dev` — sobe o Electron carregando o app React.
2. Complete a calibração de 13 pontos pela UI (`CalibrationCheck`).
3. Vá em **Configurações → Teste de precisão**, preencha:
   - Iluminação (boa / ruim)
   - Movimento da cabeça (parada / livre)
   - Óculos (sim / não)
   - Minutos de sessão (0 / 20 / 40) — mede a curva de deriva
4. Aperte **Testar precisão**. Um JSON é baixado com todas as métricas + `meta`.
5. Cole o resumo no bloco correspondente abaixo.

## Matriz de condições

Para cada condição, rodar a curva de deriva **sem recalibrar** aos 0, 20 e 40 min.

| ID | Iluminação | Cabeça | Óculos |
|----|------------|--------|--------|
| C1 | boa        | parada | não    |
| C2 | boa        | livre  | não    |
| C3 | ruim       | parada | não    |
| C4 | boa        | parada | sim (se aplicável) |

## Métricas registradas

> **Não editar em retrospectiva.** Se a configuração mudar (código, hardware,
> distância à tela), criar uma nova entrada de histórico em vez de sobrescrever.

### C1 — boa iluminação, cabeça parada, sem óculos

| Sessão | mean (px) | median (px) | p90 (px) | errX (px) | errY (px) | ° | jitter RMS (px) |
|--------|-----------|-------------|----------|-----------|-----------|---|-----------------|
| 0 min  |           |             |          |           |           |   |                 |
| 20 min |           |             |          |           |           |   |                 |
| 40 min |           |             |          |           |           |   |                 |

Observações:

### C2 — boa iluminação, cabeça livre, sem óculos

| Sessão | mean (px) | median (px) | p90 (px) | errX (px) | errY (px) | ° | jitter RMS (px) |
|--------|-----------|-------------|----------|-----------|-----------|---|-----------------|
| 0 min  |           |             |          |           |           |   |                 |
| 20 min |           |             |          |           |           |   |                 |
| 40 min |           |             |          |           |           |   |                 |

Observações:

### C3 — iluminação ruim, cabeça parada, sem óculos

| Sessão | mean (px) | median (px) | p90 (px) | errX (px) | errY (px) | ° | jitter RMS (px) |
|--------|-----------|-------------|----------|-----------|-----------|---|-----------------|
| 0 min  |           |             |          |           |           |   |                 |
| 20 min |           |             |          |           |           |   |                 |
| 40 min |           |             |          |           |           |   |                 |

Observações:

### C4 — boa iluminação, cabeça parada, com óculos

| Sessão | mean (px) | median (px) | p90 (px) | errX (px) | errY (px) | ° | jitter RMS (px) |
|--------|-----------|-------------|----------|-----------|-----------|---|-----------------|
| 0 min  |           |             |          |           |           |   |                 |
| 20 min |           |             |          |           |           |   |                 |
| 40 min |           |             |          |           |           |   |                 |

Observações:

## Critério de aceite (Sprint 0)

- Nenhuma célula das quatro tabelas em branco.
- Curva de deriva registrada para pelo menos C1 (mínimo indispensável).
- Divergências de documentação corrigidas: README, este arquivo e o código
  concordam em **~31 dims por olho** e **13 pontos de calibração**.

## Limitações desta baseline

- **`QualityFeatures` retorna constantes** — o filtro `detectorConfidence < 0.5`
  em `feedRawData` nunca dispara. Sprint 1.1 conserta.
- **Clamp `[0,1]` aplicado por olho antes da média binocular** — enviesa a
  média para o centro quando um olho satura. Sprint 1.2 conserta.
- **Grade de calibração assimétrica** (4-5-3 + 1 diagonal em `CalibrationCheck`)
  — borda inferior sub-amostrada. Sprint 1.3 troca por grade simétrica.

Cada um desses três itens contamina o número da baseline. Um ganho ≤ 10%
observado nas sprints seguintes pode simplesmente estar corrigindo esse ruído.
