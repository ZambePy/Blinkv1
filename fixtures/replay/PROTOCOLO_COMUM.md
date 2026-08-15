# PROTOCOLO comum a todos os cenários (B1..B6)

Passos que se repetem em toda gravação. Cada cenário (B1..B6) só especifica as
**condições ambientais** próprias e o **resultado esperado** — a mecânica é
sempre esta.

Leia esse arquivo uma vez; depois cada `PROTOCOLO.md` de cenário só te
lembra o que muda.

---

## 0. Antes de começar

- **Notebook conectado à energia.** Bateria fraca reduz brilho da tela e pode
  ativar redução de frequência da câmera.
- **Feche apps pesados** (Chrome com muitas abas, editores de vídeo). O
  gravador tenta 30 fps; sob CPU baixa, os frames caem para 15 fps e a
  gravação sai enviesada.
- **Câmera limpa.** Passe o dedo no vidro. Sério.
- **Cabeça a ~60 cm da tela.** Essa é a distância assumida por
  `accuracy.ts` para converter erro em px → graus (`ASSUMED_DIST_PX=2268`,
  60 cm a 96 DPI). Se você grava mais perto/longe, o erro em graus fica
  enviesado.
- **Tela em modo escuro OU claro consistente.** Não mudar entre calibração
  e validação — o brilho reflete no rosto e altera o exposure.

## 1. Ligar o gravador

Abra o app IrisFlow, entre em **Configurações → Gravador de sessão**.

- Botão **Gravar**. O status vira "Gravando" e o contador de frames sobe.
- Não pare a gravação até o final do protocolo. **Todo o resto acontece
  com a gravação rodando.**

## 2. Calibração — 9 pontos

Do menu principal, entre em **Calibração**. Siga os 9 alvos:

- Olhe **fixo** para o alvo enquanto ele pisca. Não anote com a cabeça — só
  os olhos.
- Se um ponto for reprovado (dispersão alta), o próprio app pede pra repetir
  aquele ponto. Refaça só ele.
- **Não** refaça a calibração inteira só porque um ponto ficou ruim — isso
  polui o JSONL com dados de calibração fantasma.

Ao fim, a UI mostra "Calibração concluída".

## 3. Validação — 9 pontos (teste de precisão)

Ainda com a gravação rodando, vá em **Configurações → Teste de precisão** e
execute o teste padrão de 9 pontos.

- Mesmo comportamento: olhe fixo, não mexa a cabeça (a menos que o cenário
  peça — ver B4).
- O app já calcula o erro e mostra ao final; anote esse número — ele é a
  referência "online" contra a qual o `replay` offline vai ser comparado.

## 4. (Opcional, só B6) Uso livre

B6 pede permanecer olhando para pontos aleatórios da tela por ~10 min sem
recalibrar, para medir deriva temporal. Detalhes no protocolo do B6.

## 5. Parar gravação e exportar

- **Configurações → Gravador de sessão → Parar.**
- **Exportar JSONL.** O navegador vai baixar `irisflow-session-<timestamp>.jsonl`.
- **Verifique o contador de dropped frames.** Se > 0, algo (CPU, disco lento)
  fez o gravador rejeitar frames — a gravação é válida mas truncada.
  Se dropped > 5% dos frames, jogue fora e refaça.

## 6. Renomear e mover

Renomeie para o padrão:

```
<ID>-<YYYY-MM-DD>[-<sufixo>].jsonl
```

Exemplos:
- `B1-2026-08-15.jsonl` — primeira gravação B1 do dia
- `B1-2026-08-15-a.jsonl`, `B1-2026-08-15-b.jsonl` — múltiplas do mesmo dia

Mova para `fixtures/replay/<ID>-<slug>/`. Ex: `fixtures/replay/B1-baseline/`.

## 7. Rodar o replay

```bash
npm run replay -- \
  --jsonl fixtures/replay/B1-baseline/B1-2026-08-15.jsonl \
  --report fixtures/replay/B1-baseline/B1-2026-08-15.report.json
```

Confira os dois números principais no relatório:

- `accuracy.medianErrorPx` — deve bater com o número que o app mostrou ao
  final do teste online (± algumas unidades). Se divergir muito, o replay
  não está reproduzindo o pipeline — problema.
- `accuracy.medianErrorDeg` — em graus, mais interpretável. Meta da Fase 2
  do SPRINTSELA é **p95 < 4°** e deriva **< 1°/hora**.

## 8. Registrar no cenário

Cada pasta `<ID>-<slug>/` tem um `HISTORICO.md` (crie se não existir) para
anotar cada gravação: data, hora, condição observada, erro obtido, quem
gravou. Isso ajuda a explicar depois por que uma gravação está fora do padrão.

---

## Critérios objetivos de gravação inválida (jogue fora e refaça)

Uma gravação é **inválida** se qualquer um destes for verdade:

- `header.droppedFrames / header.frames > 0.05` (>5% de frames descartados)
- `accuracy.n < 30` no report (menos de 30 frames de validação)
- `accuracy.perPoint.length < 9` (algum ponto não teve nenhum frame válido)
- O erro online e o erro do replay divergem em mais de 20% (indica bug de
  reprodução ou algo mudou entre gravação e replay)

## Higiene de privacidade

- **Não grave ninguém sem consentimento.** Inclui gravações de calibração
  para teste — landmarks + features derivadas ainda são dado biométrico.
- **Não faça commit de `.jsonl` no repo público** salvo se for gravação
  sintética ou de teste próprio, com autorização explícita. Ver `.gitignore`.
