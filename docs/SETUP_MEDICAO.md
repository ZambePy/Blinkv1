# Setup de medição — Dia 7 (`F8.1`)

> Documento operacional. O que conferir, em que ordem, e como saber que está certo.
> Complementa o protocolo do `F8.1`; não o substitui.

---

## O comando que substitui a lista de conferência

```js
__irisflowPreflight()
```

Roda no console do DevTools com o app aberto. Devolve uma tabela com veredito por item e uma linha final dizendo se pode começar.

Declarando a condição pretendida, ele também confere se as flags ativas são as certas:

```js
__irisflowPreflight({ filterMode: 'kalmanEma', l2csInputSize: 224 })
```

**Isto pega o erro mais provável do dia inteiro.** `__irisflowExp.set` só passa a valer depois de **recarregar a página**. Sem a conferência, esquecer o reload roda a condição *anterior* inteira sob o rótulo da nova — dado de aparência perfeita, atribuído à condição errada, e nada no relatório denuncia.

### Os três níveis

| | significa |
|---|---|
| ✅ `ok` | pronto |
| ⚠️ `atencao` | vale saber; a sessão é válida |
| ⛔ `bloqueio` | **o dado desta sessão vai para o lixo — não comece** |

A distinção existe para que `atencao` continue significando alguma coisa. Uma lista em que tudo é vermelho é uma lista que se aprende a ignorar.

### O que ele verifica

| item | bloqueia quando |
|---|---|
| engine | estado `'error'` |
| calibração | não há modelo ativo (a predição seria o fallback do nariz) |
| geometria | diagonal ou distância inválidas · ⚠️ quando estão no default (valor pode estar certo, procedência não fica gravada) |
| viewport | janela abaixo de 90% da tela — o erro é medido em px de viewport, e rodadas com viewports diferentes não são comparáveis |
| taxa de atualização | ⚠️ acima de 75 Hz, com o número de iterações desperdiçadas |
| L2CS | status ≠ `ready` (é o critério de descarte do próprio `F8.1`) · staleness > 10% |
| L2CS · fila | ⚠️ submissões sem resposta — evidência de fila travada |
| filtro | a cadeia degradou (`kalmanEma` sem geometria vira `kalman`) |
| condição | as flags ativas divergem da condição declarada |

---

## Os outros comandos

```js
__irisflowLatencia()   // tabela por estágio, ordenada por p95
__irisflowDiag()       // diagnóstico completo
__irisflowExp.set('l2csExecutionProvider', 'webgpu')   // exige RELOAD
__irisflowExp.reset()                                   // exige RELOAD
```

E o HUD visual: abrir qualquer tela com `?debug=1` (ex.: `http://localhost:5173/?debug=1`). O `stale` fica **vermelho** acima de 50%, e um contador `fila` aparece em laranja quando há submissão pendente.

---

## O monitor de referência

Mancer Valak 24 (`MCR-VLK24-BL01`), medido e conferido em 2026-09-03.

| propriedade | valor | por que importa aqui |
|---|---|---|
| **diagonal** | **23,6"** | O anúncio diz "24 pol" — é arredondamento. Confere com o `DEFAULT_SCREEN_DIAGONAL_IN` do código. |
| área ativa | 52,25 × 29,39 cm | |
| resolução | 1920 × 1080 | |
| px por cm | 36,75 | entra em `pxPerCm` e no erro em graus |
| pixel pitch | 0,2721 mm | confere com o padrão de 0,2715 mm para 23,6" FHD — confirma a diagonal por um caminho independente |
| **curvatura** | **R1650** | ver abaixo |
| **taxa** | **180 Hz** | ver abaixo |
| painel | VA, 4000:1, 300 cd/m² | brilho de tela altera o diâmetro da pupila |
| | Flicker-Free | sem PWM no backlight: um confundidor a menos para o `flickerDetector` (`B3.15`) |

### A curvatura AJUDA — e isso é contraintuitivo

O projeto modela a tela como um **plano a distância constante** (`distPx = distCm × pxPerCm`, um escalar). Não há tratamento de curvatura em lugar nenhum do código, e verificou-se que **não precisa haver**:

```
sagitta R1650:  20,8 mm  (a borda fica 2,1 cm mais perto que o centro)

                centro    borda     desvio do modelo de distância constante
PLANO           60,0 cm   65,44 cm  +9,1%
CURVO R1650     60,0 cm   63,54 cm  +5,9%
```

A curva puxa a borda para perto e **aproxima a realidade do modelo** — o desvio cai de 9,1% para 5,9%, cerca de um terço melhor do que num monitor plano do mesmo tamanho.

Os 5,9% restantes são viés sistemático: o código usa 60 cm onde a distância real à borda é 63,5, então o **erro angular de borda sai superestimado em ~6%**.

⚠️ **Isso soma com o achado do `softClamp`**, que trunca o erro de borda na direção *oposta* (otimista, em px). Duas distorções em sentidos contrários, em métricas diferentes — não se cancelam, só ficam difíceis de interpretar. **Ler `meanErrorEdge` com reserva.**

### 180 Hz: fixar em 60 Hz para as sessões

O `requestAnimationFrame` roda na taxa do monitor; a câmera roda a 30 fps. A 180 Hz são **6 callbacks por quadro de câmera, 5 deles sem trabalho nenhum** (83% desperdiçados; a 60 Hz seriam 50%).

O bug de instrumentação que isso causava — `loop.total` menor que suas próprias partes, documentado em `docs/LATENCIA_L2CS.md` — **já está corrigido**, então as métricas em si estão seguras. O que sobra é carga: o thread principal já está em 42,3 ms medidos contra um orçamento de 33 ms.

Um pipeline de 30 fps não ganha nada acima de 60 Hz. O `preflight` avisa (⚠️, não bloqueia) com o número de iterações desperdiçadas.

---

## Ordem recomendada de abertura

1. **Monitor em 60 Hz** e brilho fixado — anotar o valor do brilho junto das condições.
2. **Digitar a diagonal real** nas Configurações. Mesmo quando o default está correto, digitá-la é o que faz o relatório gravar a geometria como *medida* em vez de *assumida*.

   ⚠️ **O campo já mostra o default.** Olhar, conferir mentalmente e seguir em frente **não marca nada**: o `onChange` do input só dispara quando o valor MUDA. Apague e redigite.

   Alternativa pelo console, se preferir (é o mesmo efeito, escrito direto no armazenamento local — **recarregue depois**):

   ```js
   (() => {
     const k = 'irisflow_settings';
     const s = JSON.parse(localStorage.getItem(k) || '{}');
     localStorage.setItem(k, JSON.stringify({
       ...s,
       schemaVersion: 1,
       screenDiagonalIn: 23.6,          // ← a SUA diagonal
       screenGeometrySource: 'manual',
     }));
     console.log('geometria gravada — RECARREGUE a página.');
   })()
   ```

   Isto não vem preenchido de fábrica de propósito: o default de 23,6" vale para todo mundo que usar o app, e marcá-lo como `'manual'` por default faria o relatório afirmar que um humano verificou a geometria de alguém com um monitor de 27" que nunca tocou no campo. Um valor errado rotulado como verificado é bem menos recuperável que um valor certo rotulado como assumido.
3. **Maximizar / tela cheia.**
4. **Calibrar.**
5. `__irisflowPreflight({ ...condição desta rodada })` — e só começar com ✅.
6. Abrir o HUD com `?debug=1` e deixar visível durante a sessão.

Entre condições: `__irisflowExp.set(...)` → **recarregar** → calibrar de novo → `__irisflowPreflight` com a condição nova.

---

## O que continua sendo responsabilidade do operador

Coisas que o código **não** verifica, e por quê:

| item | por quê |
|---|---|
| **Diagonal do EDID** | O escape `\w` está corrigido, mas o caminho continua morto acima dele: `systemAccessGranted` nunca é setado porque não existe UI de consentimento. A diagonal **não** será preenchida sozinha. |
| **`signConvention` do L2CS em 224²** | Foi medido em 448² e nunca revalidado. Nenhum código lê esse metadado. **Mitigação de protocolo: calibrar cada condição de C8 separadamente** — com calibração própria por braço, uma inversão de sinal é absorvida pelo Ridge. |
| **Iluminação ambiente** | O `setupReadiness` mede, mas não tem chamador de produção; o relatório do fluxo automático grava `iluminacao: 'boa'` fixo. Anotar à mão. |
| **Ordem contrabalanceada das condições** | Fadiga ocular cresce ao longo da sessão. Quadrado latino, como o `F8.1` pede. |
