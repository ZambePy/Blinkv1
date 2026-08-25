# Sweep de `EXPERIMENT.expandFactor` — roteiro humano (D3, ROADMAP §5)

## Por que este documento existe e não é um script

`EXPAND_FACTOR = 1.4` (em `src/l2cs/crop.ts:13`) controla o tamanho do crop
facial antes do resize 448² que alimenta o L2CS. O ROADMAP §5 pede varrer
`{1.0, 1.2, 1.4, 1.6, 1.8, 2.0}` e comparar o erro final. **Não dá pra fazer
isso via replay**: o gravador não persiste pixels do vídeo (por privacidade
e tamanho — ver `src/telemetry/types.ts:7-9`); o JSONL só carrega o
*resultado* do L2CS (`yaw`, `pitch`, `valid`, `confidence`) que foi calculado
ao vivo com o `expandFactor` da sessão. Trocar `expandFactor` sem
re-executar o L2CS não muda nada no replay.

Consequência: o sweep tem que ser feito **ao vivo, uma sessão por valor**.
Isso é caro (recalibrar 6 vezes é ~2-3 min por rodada + fadiga), então
maximizamos o valor de cada rodada seguindo o roteiro abaixo.

## Roteiro (fazer numa única sessão, mesma iluminação e postura)

Para cada valor v em `[1.0, 1.2, 1.4, 1.6, 1.8, 2.0]`:

1. Abrir o console do browser em `http://localhost:5173/` (dev do frontend).
2. Rodar:
   ```js
   __irisflowExp.set('expandFactor', v)   // ex.: 1.0, 1.2, ...
   ```
3. Recarregar a página (F5) — o snapshot só é lido no boot (ver
   `src/config/experiment.ts:75`).
4. Confirmar em `__irisflowExp.dump()` que o valor foi aplicado.
5. **Iniciar gravação** em `SettingsScreen` → **Gravador de sessão** →
   *Iniciar*.
6. Fazer calibração completa (9 pontos) + teste de precisão (dispara
   automático ao final).
7. **Parar gravação** → **Exportar JSONL**.
8. Nomear o arquivo `sweep-expand_<v>_<condicao>.jsonl`, ex.:
   `sweep-expand_1.4_sem-oculos.jsonl`. Colocar em `fixtures/replay/`.
9. Voltar ao passo 1 com o próximo valor. **Não trocar de posição/iluminação
   entre rodadas** — se trocar, a comparação vira ruído.

Ao final, rodar sobre cada arquivo:

```bash
node scripts/replay.mjs --jsonl fixtures/replay/sweep-expand_1.0_sem-oculos.jsonl --filter balanceado-v2 > report_1.0.json
node scripts/replay.mjs --jsonl fixtures/replay/sweep-expand_1.2_sem-oculos.jsonl --filter balanceado-v2 > report_1.2.json
# ... para os 6 valores
```

E consolidar os `meanErrorPx` / `meanErrorDeg` numa tabela para decidir o
valor definitivo.

## Como reverter

```js
__irisflowExp.reset()  // ou: __irisflowExp.set('expandFactor', 1.4)
```

## Se decidir mudar o default

- Trocar `EXPAND_FACTOR = 1.4` em `src/l2cs/crop.ts:13`.
- Trocar `expandFactor: 1.4` em `src/config/experiment.ts:50`.
- Incrementar `RECORDING_FORMAT_VERSION` em `src/telemetry/types.ts:11`
  (mudança de `expandFactor` invalida o bloco L2CS de perfis salvos — mesma
  regra de `isotropicLandmarks`).
- Atualizar `docs/PONTO-DE-REFERENCIA.md` com o novo baseline pós-mudança.

## Backlog

- **Automatizar via replay** exigiria persistir os pixels do crop 448² já
  computado no JSONL (~600 KB por frame RGBA cru, ~0,1 MB comprimido) —
  suficiente para 30-60 min de sessão em disco. Trade-off: escopo enorme
  contra 1 tarde de sweep manual. Não vale a pena até haver um segundo
  parâmetro que também precise varrer sem recalibrar.
