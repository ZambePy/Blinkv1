# BASELINE — pós-Sprint 1/2 (10/08/2026)

Referência inicial de precisão do IrisFlow imediatamente após:

- **Sprint 1** — limpeza (CNN/SVR/fusão removidas, Ridge como único regressor).
- **Sprint 2** — integração do React ao tracker no mesmo processo (fim do WebSocket).

Este documento é o ponto de comparação para as Sprints 4, 5 e 6. Toda mudança
posterior no regressor, no vetor de features ou na calibração deve reportar o
delta contra esta linha de base — não contra a versão anterior.

## Configuração medida

| Item | Valor |
|---|---|
| Regressor | Ridge (`REGRESSOR_MODE = 'ridge'` em `src/gazeRegressor.ts`) |
| λ do Ridge | 1.0 (hardcoded — alvo da Sprint 4) |
| Dimensões por olho | 260 (76 landmarks + 9 mutuais + pose + iris offset) |
| Pontos de calibração | 9 (grade 3×3, `TARGET_POINTS` em `calibration.ts`) |
| Janela de coleta por ponto | 1500 ms, sem descarte inicial |
| Suavização | rolling buffer 6 frames + OneEuro (min_cutoff/beta padrão) |
| Câmera | 1280×720 @ ~30 FPS via `getUserMedia` |
| Distância assumida usuário↔tela | 60 cm (`ASSUMED_DIST_PX ≈ 2268`) |

## Como reproduzir a medição

O harness (`src/accuracy.ts`, `startAccuracyTest`) sobrepõe 9 pontos em grade
3×3 e coleta ~1 s por ponto usando `mapGaze` sobre as features cruas alimentadas
por `feedAccuracyRaw` — hoje chamado dentro de `src/tracker/engine.ts` a cada
frame com face detectada.

Para rodar dentro do app React:

1. `npm run electron:dev` — sobe o Electron carregando o app React (Vite em
   `frontend/`).
2. Complete a calibração de 9 pontos pela UI.
3. Invoque `startAccuracyTest(cb)` no console DevTools:
   ```js
   const { startAccuracyTest } = await import('/@fs/…/src/accuracy.ts');
   startAccuracyTest((r) => console.log('[accuracy]', r));
   ```
4. Registre o `AccuracyResult` retornado (JSON) nesta seção abaixo.

## Métricas registradas

> Preencher após rodar o harness. **Não editar em retrospectiva** — se a
> configuração mudar, criar uma nova entrada. Cada linha é um snapshot.

### Execução #1 — a preencher

- Data / hora:
- Usuário / condições de iluminação:
- Erro euclidiano médio (px):
- Mediana (px):
- p90 (px):
- Erro por eixo — X (px):
- Erro por eixo — Y (px):
- Jitter em fixação (RMS, px):
- Ângulo visual médio (°, `error_px / ASSUMED_DIST_PX × 180/π`):
- Observações (Y saturado? algum ponto muito ruim?):

## Limitações desta baseline

- **A grade de teste é igual à de calibração** — o harness reusa o mesmo grid
  3×3. A Sprint 3 completa exige grade independente (13 pontos ≠ 9); os números
  aqui **subestimam** o erro fora dos pontos calibrados.
- **λ não foi selecionado por CV** — está em 1.0 fixo. A Sprint 4 fará a busca.
- **`QualityFeatures` retorna constantes** — não há rejeição de amostra ruim.
- **9 pontos.** A Sprint 6 sobe para 13.

Estes três itens juntos significam que qualquer melhora medida contra este
baseline deve ser conservadora: um ganho ≤ 10% pode ser ruído do protocolo. A
Sprint 3 completa arruma isso.
