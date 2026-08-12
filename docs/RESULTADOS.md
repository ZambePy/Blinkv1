# RESULTADOS — Sprint 6

> **Como preencher.** Este documento é a saída do plano de sprints. Compara o
> estado final contra o `BASELINE.md` (Sprint 0). Reforço da regra do plano:
> **toda linha compara-se contra a Sprint 0**, não contra a sprint anterior.
> Ganhos ≤ 10% são ruído do protocolo — reporte, mas não celebre.
>
> Os dados vêm do botão **Testar precisão** em Configurações. Cada execução
> baixa um JSON com `result` + `meta` + `diagnostics` (erro e jitter por ponto).
> Arquive-os em `docs/historico/` para preservar rastreabilidade além da
> tabela-resumo abaixo.

## Configuração final (pós Sprints 1–5)

| Item | Valor |
|---|---|
| Regressor | Ridge (`REGRESSOR_MODE = 'ridge'`) + RLS online opcional (flag em Configurações) |
| Dimensões por olho | ~37 (após Sprint 3 — 12 termos de interação, 6 de 2ª ordem) |
| Grade de calibração | 13 pontos simétricos (Sprint 1.3) |
| Coleta por ponto | 1200 ms centro → 2000 ms canto (Sprint 2) |
| Suavização | preset trocável: `estavel` / `balanceado` / `responsivo` (Sprint 5) |
| Recalibração implícita | RLS com μ=0.99, rampa 1..50 amostras, rejeição de outlier a 15% (Sprint 4) |
| Filtros de qualidade | brightness/contrast/blur/confidence reais no crop dos olhos (Sprint 1.1) |
| Clamp binocular | após média (Sprint 1.2) — sem viés de borda |

## Matriz principal (13 pontos, C1 = boa+parada+sem óculos, 0 min)

Preencher com **todas as sprints ativas** (S0 = valores do BASELINE.md).

| Sprint | mean (px) | median | p90 | jitter RMS | erro @40 min | Δ mean vs S0 |
|---|---|---|---|---|---|---|
| S0 baseline (código pré-Sprint 1) |  |  |  |  |  | — |
| S1 bugs corrigidos                |  |  |  |  |  |  |
| S2 amostragem perimetrica         |  |  |  |  |  |  |
| S3 interações de 2ª ordem         |  |  |  |  |  |  |
| S4 RLS online                     |  |  |  |  |  |  |
| S5 filtro (preset balanceado)     |  |  |  |  |  |  |

## Ablação

Ganhos das sprints são raramente aditivos. Este bloco isola a contribuição
individual **com as outras sprints ativas**:

1. Ligar todas as sprints (config final).
2. Desligar uma sprint por vez (via feature flag, reverter grade, reverter
   COLLECTION_MS, etc.) e reexecutar o teste no C1.
3. Comparar Δ contra "todas ligadas".

| Sprint desligada | mean (px) | Δ vs todas ligadas | Interpretação |
|---|---|---|---|
| — (todas ligadas)        |  | 0 (ref) | |
| Só S1 desligada          |  |  | efeito dos bug fixes |
| Só S2 desligada          |  |  | efeito da amostragem perimetrica |
| Só S3 desligada          |  |  | efeito das interações extras |
| Só S4 desligada          |  |  | efeito do RLS online |
| Só S5 desligada          |  |  | efeito do preset de filtro |

Interpretação esperada:

- Se S3 desligada não muda nada em C1 mas piora C2 → interações realmente
  compensam pose, mantê-las.
- Se S4 desligada piora `erro @40 min` mas não `@0 min` → RLS está corrigindo
  deriva. Correto.
- Se S1 desligada mudar > 15% qualquer métrica → os bugs contaminavam a
  baseline mais do que se supunha. Reveja BASELINE.md.

## Métricas operacionais

| Métrica | Valor | Observações |
|---|---|---|
| Tempo total de calibração (13 pontos) |  | Sprint 2 elevou o teto de 1500 ms para 2000 ms nos cantos |
| Taxa de falha por ponto (média) |  | Antes da Sprint 1.1 os filtros de qualidade não filtravam nada |
| FPS médio (40 min contínuos) |  | Sprint 1.1 adicionou análise de crop; medir custo real |
| Amostras online aceitas em 40 min |  | Log `[calib] Online sample rejeitada` mede taxa de rejeição |

## Análise final

Preencher com narrativa curta após rodar tudo:

- O que melhorou de forma clara (Δ > 10% vs S0 e reproduzível entre C1..C4)?
- O que não melhorou / piorou? Alguma sprint deve ser revertida?
- Qual preset de filtro está sendo entregue como padrão para o usuário-alvo?
- A curva de deriva 0/20/40 min com RLS ligado ficou compatível com "erro
  aos 40 min ≈ erro aos 0 min"?

## Decisão sobre encoder aprendido

Este documento é o insumo direto para decidir se vale investir em encoder
aprendido (L2CS ou encoder de landmarks) — sem ele, essa decisão é palpite.

- **Se** o pipeline pós-Sprint 5 já entrega < 40 px médios (≈ 1.0°) em C1 e
  < 80 px em C2, **provavelmente não vale** o passivo de licença de L2CS.
- **Se** C2/C3 ainda ficam > 100 px, o Ridge está saturando o teto que features
  geométricas conseguem representar. Aí a trilha paralela de coleta de dados
  (documentada no plano) vira caminho crítico.
