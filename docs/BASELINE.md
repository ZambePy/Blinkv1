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

## Erro conhecido — teste de precisão silencioso (hotfix 12/08/2026)

Durante a primeira execução real do botão "Testar precisão" com o pipeline
pós-Sprints 1–5, o resultado veio absurdo: **mean = 609 px, jitter = 189 px,
score "Ruim"** em condição C1 (boa/parada/sem óculos). Investigação
identificou que **`accuracy.ts` referenciava classes CSS que não existiam
no bundle React** (`.accuracy-overlay`, `.accuracy-dot`, `.diagnostic-overlay`,
etc.). O overlay era inserido no DOM invisível; o teste rodava ~17 s
silenciosamente enquanto o usuário permanecia olhando para a tela de
Configurações. O JSON exportado media distância entre "onde o usuário
estava olhando na UI" e "onde o ponto-fantasma existia no código" — sem
relação com precisão real do modelo.

**Correção:** bloco CSS adicionado em `frontend/src/index.css` (overlay
fullscreen escuro + dot azul-ciano pulsante + card diagnóstico ao final).
Todo relatório JSON gerado *antes* deste hotfix (arquivos com timestamp
anterior a `2026-08-12T23:15Z`) deve ser descartado.

## Segunda execução — teste real (12/08/2026, C1, 0 min)

Com o overlay visível, o teste rodou de verdade. Resultado:

- meanError = **248 px** (~2,5× menor que o run inválido); meanErrorDeg = 6,24°
- medianError = 316 px; p90 = 440 px; maxError = 467 px
- meanErrorX = 220 px; **meanErrorY = 83 px** (Y é 3× melhor que X)
- jitter RMS = 482 px (inflado — ver nota abaixo)

Padrão espacial claro nas predições:

- **P10** (canto inf-direito): erro 11 px — modelo é capaz de precisão excelente.
- **P3, P9, P12, P1**: 63–108 px — operacional para dwell click em botões grandes.
- **P4, P6, P8** (coluna esquerda, y ≠ topo): erro 366, 440, 467 px.
  Predições X colapsam sistematicamente para X≈620-734 quando o alvo está
  em X=287. Coluna direita tem viés semelhante mas menos intenso.

**Hipótese principal — colinearidade yaw da cabeça ↔ offset horizontal
da íris.** Durante a calibração, o usuário move levemente a cabeça ao
mudar o olhar (natural, mesmo tentando ficar parado). O Ridge vê yaw e
offsetX variarem juntos e não consegue atribuir a contribuição de cada.
Na validação, se a pose da cabeça em cada ponto não bate exatamente com
a pose observada na calibração daquele ponto, o modelo responde com a
média das duas explicações → cursor puxado para o centro.

**Nota sobre jitter.** O `accuracy.ts` original coletava a partir de t=0
sem descartar a fase de sacada; ~200 ms de cada janela de 1000 ms era
movimento sacádico, não fixação. Isso inflava o `jitterRMS` reportado.

## Hotfix aplicado (12/08/2026, pós-primeiro teste real)

1. **`src/accuracy.ts`** — descarta os primeiros 400 ms de cada ponto
   (paridade com o protocolo da calibração). `COLLECTION_MS` foi de 1000
   para 1400 ms; a janela útil continua sendo 1000 ms mas agora começa
   apenas após a acomodação.
2. **`src/tracker/engine.ts`** — `yaw`, `pitch`, `roll` da cabeça viajam
   junto do objeto `quality` para `feedRawData`.
3. **`src/calibration.ts`** — dentro da janela de coleta de cada ponto,
   `feedRawData` fixa a pose do primeiro frame aceito como baseline e
   rejeita amostras cujo yaw/pitch/roll se afaste mais de ~5° (0,087 rad)
   desse baseline. Métrica `poseDriftRejects` é logada em
   `processStaticPoint` para diagnóstico do quanto está sendo filtrado.

Estas mudanças atacam a hipótese de colinearidade mas não a eliminam
integralmente. Se o segundo run pós-hotfix ainda mostrar o padrão de
colapso da coluna esquerda, a origem é ergonomia da calibração (usuário
precisa manter cabeça travada de forma mais rígida), não do regressor —
e vale ativar a recalibração implícita (Sprint 4, flag OFF por padrão) e
medir a curva de convergência.
