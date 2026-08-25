# Ponto de referência — melhor erro registrado

> Este documento congela **em que condições** o número foi obtido. Sem essas
> condições, o número não é reproduzível — e um número não reproduzível não
> serve nem para comparar depois, nem para mostrar a investidor.
>
> Tags associadas:
>   - `v0-melhor-erro` → commit `f9d9252` — número de referência histórico.
>   - `v0-menor-erro-oculos` → sessão adendo, adiante — melhor erro **com óculos**.
>
> **D2 (2026-08-23) — consolidação:** dados abaixo consolidados a partir da
> Rodada A e do adendo em `docs/BUG-OCULOS-EVIDENCIA.md` (2026-08-22, commit
> `5503091`), Sprint 1 do `PLANO-FRENTES-A-B.md` fechado. Todos os campos
> foram preenchidos com o que já era observável nos logs e no hardware do
> usuário; nada foi inventado.

---

## Número de referência (Rodada A, sem óculos)

- **Erro angular médio:** 0,9° (**supera** `v0-melhor-erro` = 1,0°)
- **Erro em pixels médio:** 57 px (**supera** `v0-melhor-erro` = 111 px)
- **Data da medição:** 2026-08-22
- **Commit medido:** `5503091` (branch `main`) — mesma sessão dos logs de
  Rodada A em `BUG-OCULOS-EVIDENCIA.md`. A tag `v0-melhor-erro` (`f9d9252`,
  111 px / 1,0°) fica como marco histórico anterior; o novo baseline não foi
  re-tagueado ainda para não fragmentar as referências de terceiros.

## Condições de captura (Rodada A)

| # | Item | Valor |
|---|---|---|
| 1 | Commit / data | `5503091` / 2026-08-22 |
| 2 | Erro angular e em px | 0,9° / 57 px |
| 3 | **Medido por amostra ou por ponto?** | **Por ponto** (média das predições por alvo — é o que `accuracy.ts:finishTest` reporta como `meanError`). Métricas por amostra (`sampleMeanError`, `sampleP90Error`) já são calculadas pelo mesmo fluxo mas não são o número acima. Ver S1-3 no plano anterior. |
| 4 | Resolução da tela | 1920×1080 (`__irisflowExp.dump()`, valor lido pelo `accuracy.ts` via `document.documentElement.clientWidth/Height`) |
| 5 | Resolução do vídeo (webcam) | 1280×720 @ 30 fps (constraint fixo em `GazeContext.tsx:400`: `width: 1280, height: 720, frameRate: { ideal: 30, min: 24 }`) |
| 6 | Distância olho→tela e método | ~60 cm — **estimada visualmente**, não medida com fita. É o valor pedido ao usuário na tela pré-calibração (`CalibrationCheck.tsx:245` — "📏 50 a 60 cm da tela"). Melhoria pendente: S1-2 do plano anterior (distância medida por frame via `faceMatrix[14]`); esta rodada usou a estimativa antiga. |
| 7 | Iluminação | Ambiente residencial, luz do teto ligada, sem contra-luz forte. Metadata reportada como `iluminacao: 'boa'` no relatório (default hardcoded do `AUTO_TEST_META`; D2.2 remove esse hardcoding). |
| 8 | Óculos | **Não** (Rodada A é justamente a rodada sem óculos; ver Rodada B para o caso com óculos). |
| 9 | Cabeça | Livre, sem apoio de queixo. Usuário instruído em `CalibrationCheck.tsx:247` — "Olhos abertos, cabeça parada. Mova só os olhos ao seguir o ponto." |
| 10 | Webcam usada | Webcam integrada do notebook do usuário (marca/modelo específico não catalogado — considerar registrar em `docs/` num próximo ciclo se comparar hardware). |

## Como reproduzir a medição

1. `npm run dev` (ou `npm run electron:dev`).
2. Verificar que o modelo L2CS carrega (status "ready" em ~10-15 s na
   primeira vez — a UI de pré-calibração bloqueia o botão "Começar" até lá).
3. Percorrer o fluxo de calibração pela `CalibrationCheck` (9 pontos em
   grade 3×3, ordem aleatória por sessão, tempo por ponto escalado pela
   distância ao centro — cantos coletam ~65 amostras, centro ~38).
4. O teste de precisão automático dispara imediatamente após "Calibração
   Concluída" (`CalibrationCheck.tsx:runAccuracyTestThenExit`), usando a
   grade 3×3 em 25/50/75% (disjunta da grade de calibração — sem
   sobreposição, o número mede generalização, não memorização).
5. Ler `meanError` (px) e `meanErrorDeg` (°) no console (`[accuracy]
   Config (...): mean=...px / ...° | ...`) ou no overlay diagnóstico.
6. O relatório JSON é escrito automaticamente na raiz do projeto pelo
   endpoint `/__/save-accuracy-report` (só existe no dev server); em build
   de produção, cai no fluxo de download do browser (`accuracy-report-<ts>.json`).

## Observações

- Este é o ponto que TODA mudança futura tem que ser comparada contra.
- Nenhuma alteração de sintonia entra ligada por default até termos como
  medir o efeito (Regra 4 do projeto).
- Se em qualquer momento este número piorar sem explicação, `git bisect` a
  partir de `v0-melhor-erro`.
- **Distância digitada, não medida.** O número angular em graus assume
  60 cm; se o usuário estava a 55 ou 65 cm, o grau muda ±8%. Trocar por
  medida real é a tarefa S1-2 do `PLANO-SPRINTS.md` original (herdada como
  D5.2 no `ROADMAP.md` — correção de distância por frame via `faceMatrix[14]`).
- **Amostra de 1 usuário.** Todo o baseline vem de um único operador e um
  único hardware. Uma segunda pessoa é o dado de maior valor marginal (§8
  do `ROADMAP.md`, backlog não escondido).

---

## Adendo — melhor erro **com óculos** (sessão pós-Sprint 1)

Após as correções do Sprint 1 (matriz singular, aspect ratio isotrópico,
resets do OneEuroFilter), uma nova rodada **com óculos** igualou o baseline
sem óculos:

- **Erro angular médio:** 0,98°
- **Erro em pixels médio:** 57 px
- **Erro máximo:** 104 px
- **Taxa de acerto em alvo de 150 px:** 97 %
- **Classificação:** Bom
- **Tag:** `v0-menor-erro-oculos`

Por ponto: P1 33 · P2 47 · P3 59 · P4 5 · P5 73 · P6 29 · P7 104 · P8 90 · P9 77 (px).

Este número **substitui a expectativa** de que "com óculos vai ser pior":
com o pipeline corrigido, a diferença desapareceu para este usuário nesta
condição específica de iluminação.
