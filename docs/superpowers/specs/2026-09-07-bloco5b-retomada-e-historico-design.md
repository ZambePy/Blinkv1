# Bloco 5B — Retomada rápida e histórico por perfil

**Data:** 2026-09-07
**Escopo:** frontend (`frontend/src/`). Do `src/` apenas **leitura** de
`accuracy` (a matemática) e `calibration` (o carimbo).
**Fora de escopo, intocável:** `startAccuracyTest`, o relatório canônico,
`blocoDeMedicao`, a coleta da calibração, `electron/`.

---

## 1. O dado que define os limites

Seis sessões reais em `docs/medicoes/historico/`, todas de um setup:

| | Erro angular | LOO (px) |
|---|---|---|
| melhor | **1,86°** | 68 |
| mediana | 3,18° | — |
| pior | **3,74°** | 252 |

**n = 6.** Isso impede um limiar absoluto honesto: "reprovar acima de 3°"
reprovaria metade das sessões reais; "acima de 4°" nunca dispararia.

E há um limite mais duro, anterior ao desenho: **com 3 alvos detecta-se falha
grosseira, não degradação sutil.** Três pontos dão estimativa com ruído grande
demais para separar 2,5° de 3,2°. O que eles pegam bem é o que mudou muito —
pessoa diferente, monitor movido, paciente 20 cm mais longe, perfil trocado.

**Consequência para o produto:** a checagem responde *"algo mudou muito desde
que calibramos?"*, não *"a precisão hoje é boa?"*. A tela diz isso com todas as
letras. Um número de 3 pontos apresentado como medição vira dado ruim no
acompanhamento clínico, e ninguém consegue distingui-lo depois.

## 2. Decisões

| # | Decisão | Razão |
|---|---|---|
| D1 | A checagem **não** usa `startAccuracyTest` | Aquele é instrumento de medição: escreve o relatório canônico e incrementa o bloco. Rodando todo dia, gravaria um relatório por dia e corromperia a contagem de blocos que o Bloco 4 arrumou. |
| D2 | Mas **reaproveita a matemática** (`erroAngularDeg`, `agregarErros`) | Já são exportadas e puras. Uma segunda fórmula de erro divergiria da primeira. |
| D3 | Veredito **relativo à própria referência**, não absoluto | Robusto a setup — o problema com n=6 de uma máquina só. |
| D4 | A referência é a **primeira checagem contra aquele `calibTs`** | Mesma grandeza medida do mesmo jeito. Amarrada ao carimbo, como o `blocoDeMedicao` já faz. |
| D5 | Limiar de **1,6×** a referência | Com 3 alvos o ruído é grande; limiar apertado alarmaria à toa. |
| D6 | Nunca obriga a recalibrar | Mesma premissa dos blocos anteriores. |
| D7 | Histórico migra para o perfil ativo, **marcado como herdado** | Preserva o dado sem fingir que a atribuição é certa. |
| D8 | A tela nunca chama o resultado da checagem de "precisão" | §1. |

## 3. Arquitetura

```
frontend/src/
  pages/retomada/
    ChecagemRapida.tsx        rota /retomada — os 3 alvos e o enquadramento
    veredictoDaChecagem.ts    regra pura: referência × medido → veredito
  services/local/
    referenciaDaChecagem.ts   guarda a referência por calibTs
  pages/historico/
    HistoricoDeSessoes.tsx    rota /historico
```

`utils/clinicalLogger.ts` ganha separação por perfil e a marca de herdado.

### 3.1 `veredictoDaChecagem.ts`

```ts
export const FATOR_DE_ALERTA = 1.6;

export type VeredictoDaChecagem = 'seguir' | 'atencao' | 'recalibrar';

export interface EntradaDaChecagem {
  /** Erro medido nos 3 alvos, em graus. `null` = não deu para medir. */
  erroDeg: number | null;
  /** Erro da primeira checagem contra esta calibração. `null` = é a primeira. */
  referenciaDeg: number | null;
  rostoEnquadrado: boolean;
  distanciaNaFaixa: boolean;
}

export function veredictoDaChecagem(e: EntradaDaChecagem): {
  veredicto: VeredictoDaChecagem;
  motivo: string | null;
};
```

Regras, em ordem:

1. Rosto não enquadrado ou distância fora da faixa → `recalibrar`, com o motivo
   sendo a posição. Não adianta medir olhar de quem não está no lugar.
2. Sem medição (`erroDeg === null`) → `recalibrar`, motivo "não deu para medir".
3. Primeira checagem (`referenciaDeg === null`) → `seguir`. Ela **estabelece** a
   referência; não há com o que comparar, e reprovar aqui reprovaria uma
   calibração recém-feita.
4. `erroDeg > referenciaDeg × FATOR_DE_ALERTA` → `atencao`.
5. Resto → `seguir`.

Pura, sem React nem DOM: a tabela de decisão inteira testável sem câmera.

### 3.2 `referenciaDaChecagem.ts`

`localStorage`, chave `irisflow_referencia_checagem`:

```ts
interface ReferenciaDaChecagem {
  /** A calibração a que esta referência pertence. */
  calibTs: number;
  erroDeg: number;
  em: string;   // ISO 8601
}
```

Amarrada ao `calibTs`: quando a calibração muda, a referência antiga não vale e
é descartada — comparar contra o modelo anterior mediria a diferença entre dois
modelos, não a deriva do posto de uso.

### 3.3 Fluxo

```
2ª abertura em diante, com calibração salva:
  splash → /retomada → (seguir) → /menu
                     → (recalibrar) → /calibration-check
```

O portão fica no `bootDestination`: com calibração válida e tutorial concluído,
o destino passa a ser `/retomada` em vez de `/menu`. Uma vez por dia — rodar a
cada abertura seria fricção diária sem ganho.

## 4. A checagem, na tela

Três fases, ~15 s no total:

1. **Enquadramento** (~5 s): usa `evaluateReadiness`, que já existe, e o
   `FramingIndicator`. Espera rosto + distância na faixa.
2. **Três alvos** (~9 s): um por vez, centro e dois cantos opostos. Coleta
   amostras via `useGaze().subscribe` e calcula com `erroAngularDeg`.
3. **Veredito**: um dos três, com o que oferecer.

O texto nunca diz "precisão". Diz "confere se algo mudou desde a calibração".

**Pular está sempre disponível.** Um paciente que precisa falar agora não pode
ser detido por 15 s de verificação.

## 5. Histórico por perfil

`clinicalLogger` passa a gravar sob `irisflow_clinical_data_<profileId>`.

**Migração:** o conteúdo da chave global vai para o perfil ativo na primeira
leitura, com `herdado: true` em cada registro. A tela mostra esses com uma marca
e a legenda "antes da separação por paciente — pode incluir medições de outro
paciente desta máquina".

A chave global é preservada, não apagada: se a atribuição estiver errada, o dado
original ainda existe para ser reatribuído à mão.

**A tela** lista as medições em ordem decrescente, cada uma com data e erro em
graus, e uma barra proporcional ao erro. Sem biblioteca de gráfico: uma lista
com barras lê bem, não adiciona dependência e funciona no tema escuro sem
configuração extra.

Quando há menos de duas medições, a tela diz que ainda não há evolução para
mostrar — em vez de desenhar uma linha de um ponto só.

## 6. Testes

| Arquivo | Cobre |
|---|---|
| `veredictoDaChecagem.test.ts` | a tabela inteira; **primeira checagem nunca reprova**; posição ruim vence erro bom; `null` não vira aprovação |
| `referenciaDaChecagem.test.ts` | amarrada ao `calibTs`; calibração nova descarta a antiga; storage corrompido |
| `ChecagemRapida.test.tsx` | pular está disponível em qualquer fase; a tela **não** usa a palavra "precisão"; os três vereditos |
| `clinicalLogger.test.ts` (existente) | separação por perfil; migração marca herdado; a chave global **não** é apagada |
| `HistoricoDeSessoes.test.tsx` | ordem decrescente; marca de herdado visível; menos de duas medições não desenha evolução |

Verificação: `cd frontend && npm run verify`.

## 7. Limitações conhecidas

1. **A checagem não mede precisão** (§1). Detecta mudança grosseira. Está dito
   na tela e é a limitação mais importante deste bloco.
2. **O fator de 1,6× não foi validado contra falha real.** Ele é derivado do
   ruído esperado de 3 pontos, não de sessões em que a calibração de fato
   estragou — não existem no repositório. Vai precisar de revisão quando
   houver.
3. **A migração do histórico supõe um paciente.** Se houve mais de um antes da
   separação, a curva do perfil ativo recebe medições que não são dele. A tela
   marca; não corrige.
4. **A referência não expira.** Uma calibração usada por três meses compara
   contra uma referência de três meses atrás. Como a calibração em si também
   não expira, o par é coerente — mas nenhum dos dois envelhece sozinho.
