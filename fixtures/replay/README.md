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

## Estado atual da pasta (2026-08-23, D2)

Nenhum arquivo `.jsonl` real ainda. O D2 estabeleceu a infraestrutura de
medição (script + wiring + `PONTO-DE-REFERENCIA.md` consolidado), mas **a
gravação em si depende de uma sessão física com webcam** — o agente que
implementou D2 não tem acesso à câmera. É a única tarefa manual do D2 que
precisa ser feita pelo operador humano antes de iniciar D3.

Ao produzir a fixture, atualizar este README para listar o arquivo, incluir
o link para o primeiro relatório do `measure_baseline.mjs` como snapshot
inicial, e commitar `*.report.json` (o gitignore permite via `!*.report.json`).
