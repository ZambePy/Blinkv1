# Bug dos óculos — evidência

> Este documento **não conserta nada**. Só registra a reprodução do sintoma em
> duas condições (sem óculos × com óculos) para que A1 tenha dados reais para
> calibrar os limiares (variância mínima, alpha do filtro etc.), em vez de
> chutes.
>
> Instrumentação temporária adicionada em `src/calibration.ts` (init):
> `window.__irisflowDebug` com `isCalibrated()`, `sampleCount()`,
> `currentLambda()`, `hasRegressors()`, `isCalibrating()`.

---

## Como reproduzir

Rodar no mesmo dia, mesma iluminação, mesma distância. Só varia a lente.

1. `npm run dev` (ou `npm run electron:dev`).
2. Abrir DevTools → aba **Console**, clicar no ícone de "clear" (🚫). Se
   possível, ligar "Preserve log".
3. **Rodada A — sem óculos:**
   - Calibrar todos os 9 pontos até o fim ("Calibração Concluída").
   - No console, executar em sequência:
     ```js
     __irisflowDebug.isCalibrated()
     __irisflowDebug.hasRegressors()
     __irisflowDebug.sampleCount()
     __irisflowDebug.currentLambda()
     ```
   - **Copiar o log inteiro do console** e colar na seção "Rodada A" abaixo.
4. Recarregar a página (F5) para zerar o estado.
5. **Rodada B — com óculos**, exatamente os mesmos passos.

## O que procurar nos logs

- `Matriz singular na coluna N` (vem de `src/ridge.ts:30`) — sinal do modo
  crítico do bug.
- `[calib] Erro fatal no treinamento` (`src/calibration.ts:491`) — o `catch`
  do `completeCalibration`.
- `[calib] ✗ Ponto instável — aceitando mesmo assim` (linha 419) — sinal do
  portão unilateral.
- `[calib] Variância: L=... R=...` (linha 416) — **anotar os valores nos dois
  casos**. É daqui que sai o `VARIANCE_FLOOR` em A1-2 (uma ordem de grandeza
  abaixo do "sem óculos").
- `[calib] ✗ Nenhuma amostra coletada` (linha 406) — face perdida.
- `[calib] ✓ Ponto aceito — profile agora tem N amostras totais` — quantas
  amostras entraram em cada rodada.

## Condição da captura

| Item | Valor |
|---|---|
| Data | [PREENCHER] |
| Horário | [PREENCHER] |
| Iluminação | [PREENCHER — ex.: janela lateral, luz do teto ligada] |
| Distância olho→tela | [PREENCHER — cm] |
| Cabeça | [PREENCHER — apoiada em encosto / livre / queixo em suporte] |
| Óculos usados (rodada B) | [PREENCHER — simples/progressivo/leitura, com/sem anti-reflexo] |
| Resolução da tela | [PREENCHER] |
| Webcam | [PREENCHER — marca/modelo] |

---

## Rodada A — SEM óculos

**`__irisflowDebug.isCalibrated()` →** [PREENCHER: true ou false]
**`__irisflowDebug.hasRegressors()` →** [PREENCHER: {left, right}]
**`__irisflowDebug.sampleCount()` →** [PREENCHER: número]
**`__irisflowDebug.currentLambda()` →** [PREENCHER: número]

### Variâncias reportadas por ponto (linha `[calib] Variância: L=... R=...`)

| Ponto | Var L | Var R |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |

### Log bruto do console

```
[PREENCHER com o console log inteiro da rodada A]
```

---

## Rodada B — COM óculos

**`__irisflowDebug.isCalibrated()` →** [PREENCHER: true ou false]
**`__irisflowDebug.hasRegressors()` →** [PREENCHER: {left, right}]
**`__irisflowDebug.sampleCount()` →** [PREENCHER: número]
**`__irisflowDebug.currentLambda()` →** [PREENCHER: número]

### Variâncias reportadas por ponto

| Ponto | Var L | Var R |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |

### Log bruto do console

```
[PREENCHER com o console log inteiro da rodada B]
```

### Sintoma visual observado no cursor após "Calibração Concluída"

- [ ] Cursor travado num ponto fixo da tela → **modo 1 do bug** (matriz singular / regressors null / fallback do nariz)
- [ ] Cursor movendo mas erro grande e "explodindo" → **modo 2 do bug** (quase-singular, coeficientes gigantes)
- [ ] Nenhum sintoma → hipótese não se confirma neste hardware/luz; **parar e reportar**

---

## Diagnóstico

A pergunta que fecha o A0-5, em uma linha:

> **Após a calibração com óculos, `__irisflowDebug.isCalibrated()` devolveu…**
>
> - `true` → o problema é **não-crítico** (regressors treinaram, mas quase-singulares → coeficientes ruins). Prioridade: A1-3 (escalonar λ) e A2-1 (filtro).
> - `false` → o problema é **crítico** (matriz singular, catch engoliu, UI mentiu). Prioridade: A1-1 (falhar alto) e A1-2 (portão bidirecional).

**Resposta observada:** [PREENCHER]

---

## Insumos que este documento entrega para A1

- Valor de referência de `VARIANCE_THRESHOLD` a usar como piso (`VARIANCE_FLOOR = mínimo(Var L, Var R sem óculos) / 10` como ponto de partida).
- Confirmação de qual dos dois modos do bug ocorre em campo.
- Baseline do sintoma visual, para verificar depois se A1-1..A1-4 realmente eliminaram.
