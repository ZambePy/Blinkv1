# Ponto de referência — melhor erro registrado

> Este documento congela **em que condições** o número foi obtido. Sem essas
> condições, o número não é reproduzível — e um número não reproduzível não
> serve nem para comparar depois, nem para mostrar a investidor.
>
> Tag associada: `v0-melhor-erro` → commit `f9d9252`.

---

## Número de referência

- **Erro angular médio:** 1,0°
- **Erro em pixels médio:** 111 px
- **Data da medição:** [PREENCHER — ex.: 2026-08-15]
- **Commit medido:** `f9d9252` (branch `main`)

## Condições de captura

| # | Item | Valor |
|---|---|---|
| 1 | Commit / data | `f9d9252` / [PREENCHER data] |
| 2 | Erro angular e em px | 1,0° / 111 px |
| 3 | **Medido por amostra ou por ponto?** | [PREENCHER — muda o número em ~50%] |
| 4 | Resolução da tela | [PREENCHER — ex.: 1920×1080] |
| 5 | Resolução do vídeo (webcam) | [PREENCHER — ex.: 1280×720 @ 30 fps] |
| 6 | Distância olho→tela e método | [PREENCHER — ex.: 60 cm, fita métrica / estimativa] |
| 7 | Iluminação | [PREENCHER — ex.: luz natural indireta, sem contra-luz] |
| 8 | Óculos | [PREENCHER — sim / não / qual tipo] |
| 9 | Cabeça | [PREENCHER — parada apoiada / livre] |
| 10 | Webcam usada | [PREENCHER — marca/modelo] |

## Como reproduzir a medição

[PREENCHER — passo a passo mínimo:
 1. Rodar `npm run dev`
 2. Calibrar os 9 pontos
 3. Iniciar teste de precisão (X pontos, Y segundos por ponto)
 4. Ler o número no dashboard / console]

## Observações

- Este é o ponto que TODA mudança futura tem que ser comparada contra.
- Nenhuma alteração de sintonia entra ligada por default até termos como medir o efeito.
- Se em qualquer momento este número piorar sem explicação, `git bisect` a partir de `v0-melhor-erro`.
