# fixtures/replay/

> Diretório de gravações determinísticas do pipeline para replay offline. As
> gravações NÃO vão pro Git por padrão (`.gitignore` cobre `*.jsonl` — motivo:
> tamanho + o JSONL contém landmarks/features, dados biométricos). Este
> README fica versionado.

## Para que servem

Toda medição de "melhorou ou piorou" desde D2 (ver `ROADMAP.md`) usa uma
gravação daqui como fonte determinística. Sem elas, comparar duas configurações
do pipeline (ex.: `isotropicLandmarks: on/off` em D3, ou preset do filtro em
D4) exigiria uma nova calibração humana + nova sessão de accuracy test para
cada configuração — cada uma introduzindo ruído de iluminação, postura e
fadiga que se acumula sobre o efeito medido. Gravação fixa + replay isola o
efeito da flag do resto.

## Como produzir uma gravação (roteiro do D2)

Ao produzir a fixture de referência para as sprints D3–D7, siga este roteiro
exato — desvio de roteiro entre gravações torna comparações inválidas:

1. Rodar o app em dev: `npm run dev` (ou `npm run electron:dev`).
2. Abrir **Configurações** (`SettingsScreen`), rolar até **Gravador de
   sessão** (perto do fim). Clicar **Iniciar gravação** — o singleton do
   `recorder` (ver `src/telemetry/recorder.ts`) começa a empurrar frames.
3. Ir para **Calibração** e concluir os 9 pontos normalmente. O gravador
   registra `target.kind = 'calibration'` em cada frame de coleta e a
   `sampleDecision` que o pipeline aplicou (aceito/rejeitado por
   acomodação/qualidade/pose_drift), permitindo o replay reproduzir o
   filtro exatamente igual ao ao vivo.
4. O teste de precisão automático dispara logo depois. O gravador registra
   `target.kind = 'accuracy'` durante a janela útil de cada ponto (após
   os 400 ms de acomodação).
5. Após o teste terminar (overlay diagnóstico visível), fechar o overlay
   com Espaço e opcionalmente continuar em uso livre por 1-2 minutos —
   isso alimenta as sprints D5/D7 com dado de movimento controlado.
6. Voltar a **Configurações** → **Gravador de sessão** → **Parar gravação**
   → **Exportar JSONL**. O browser faz download de
   `irisflow-recording-<timestamp>.jsonl`.
7. Mover o arquivo para este diretório com um nome estável (ver convenção
   abaixo).

### Convenção de nomes

`YYYY-MM-DD_<condicao>_<comprimento>.jsonl`

Ex.: `2026-08-23_sem-oculos_calib+precisao.jsonl`

- `condicao`: `sem-oculos`, `com-oculos`, `oculos-progressivo`.
- `comprimento`: `calib+precisao` (só calibração + accuracy test); ou
  `calib+precisao+2min-livre` (com uso livre gravado depois).

### Condições recomendadas

- Cabeça parada, sem apoio de queixo — casa com o baseline em
  `docs/PONTO-DE-REFERENCIA.md`.
- Iluminação de casa/trabalho normal, sem contra-luz forte na tela nem
  reflexo direto no olho.
- Distância olho→tela ~60 cm. Anotar o valor real medido com fita métrica
  no nome do arquivo se possível (`_60cm`).
- Óculos: se aplicável, ANOTAR no nome do arquivo — misturar condições
  numa mesma comparação invalida o número.

## Como consumir uma gravação

### Replay direto (números para uma variante):

```bash
node scripts/replay.mjs --jsonl fixtures/replay/<seu-arquivo>.jsonl
# saída: JSON com meanErrorPx, medianErrorPx, p90ErrorPx, perPoint, ...
```

### Baseline comparativo (várias variantes de uma vez):

```bash
node frontend/scripts/measure_baseline.mjs --jsonl fixtures/replay/<seu-arquivo>.jsonl
# saída: tabela comparando 4 variantes (baseline, +recompute-features, estavel, responsivo)
```

Com `--out relatorio.json` também salva o agregado em disco para diff futuro.

## Estado atual da pasta (2026-08-26)

Primeira fixture real gravada em 2026-08-26 pelo operador:

- **`ci-baseline.jsonl`** — 97 MB, 455 frames, condição `oculos_simples`,
  produzida pelo fluxo de auto-gravação (calibração + accuracy test).
  Gitignorada por default (biometria + tamanho); commitada com
  `git add -f` se o operador decidir versionar.
- **`ci-baseline.report.json`** — snapshot esperado pro gate do CI
  (D8.1). VAI pro Git. Baseline observado nessa fixture: 150,3 px /
  3,72° (`baseline (balanceado-v2, features gravadas)`), 5 variantes
  rodadas — 4 verdes + 1 falha documentada (`--recompute-features` vs
  bloco L2CS — ver ROADMAP §8.1).

### Fluxo novo de auto-gravação (Electron, desde 2026-08-26)

Não precisa mais iniciar/parar manualmente pelo `SettingsScreen` pra
produzir uma fixture. Clicar em **Começar** (9 pontos) ou
**Recalibração rápida** na tela de calibração já dispara o gravador; ao
fechar o overlay do accuracy test, o `.jsonl` é escrito automaticamente
na raiz do projeto com nome
`irisflow-recording-<YYYY-MM-DD_HH-mm-ss>_<condicao>_calib+precisao.jsonl`.
O operador move pra `fixtures/replay/` e (se for a nova baseline)
renomeia pra `ci-baseline.jsonl`. Em browser puro (`npm run dev`) o
mesmo fluxo cai no download do browser (`~/Downloads/`).

Guardas:
- Auto-gravação **cede** se houver gravação manual pré-existente do
  `SettingsScreen` — cuidador quem manda.
- Calibração falha (matriz singular, etc.) → gravação descartada.
- Fechar janela no meio → gravação órfã é limpa no unmount.

O fluxo manual (SettingsScreen → Gravador de sessão) segue existindo pra
casos especiais (gravação só de uso livre, sem calibração no meio).

## Gate de regressão em CI (D8.1)

Quando a fixture existir, o CI passa a gate-ar regressões automaticamente.
Nomes esperados pelo `.github/workflows/ci.yml` (step `Baseline regression gate`):

- **`fixtures/replay/ci-baseline.jsonl`** — a gravação de referência (não
  vai para o Git por padrão; adicionar com `git add -f` quando produzida,
  ou publicar via LFS/artefato se o tamanho for grande).
- **`fixtures/replay/ci-baseline.report.json`** — snapshot esperado
  produzido por `node frontend/scripts/measure_baseline.mjs --jsonl
  ci-baseline.jsonl --out ci-baseline.report.json`. Este arquivo **VAI**
  para o Git — é o "esperado" contra o qual cada PR será comparado.

Enquanto essa dupla não estiver commitada, o step de gate no CI vira
no-op e apenas loga "pulando gate — pendência humana". O smoke test da
CLI continua rodando em toda execução (garante que os scripts não
regridem por conta própria).

Para regravar o baseline (regressão intencional/melhoria esperada):

```bash
node frontend/scripts/measure_baseline.mjs \
  --jsonl fixtures/replay/ci-baseline.jsonl \
  --out fixtures/replay/ci-baseline.report.json
git add fixtures/replay/ci-baseline.report.json
git commit -m "chore(baseline): atualizar snapshot — <razão>"
```

A tolerância default é **15%** — chutada, não medida. Recalibrar com
`--tolerance-pct` quando houver histórico de N execuções da mesma
fixture com variância mensurada (ver comentário no topo de
`check_baseline_regression.mjs`).
