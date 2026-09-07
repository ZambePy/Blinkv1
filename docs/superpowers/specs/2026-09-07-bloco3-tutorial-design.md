# Bloco 3 — Tutorial

**Data:** 2026-09-07
**Escopo:** frontend (`frontend/src/`). Do `src/` apenas **leitura** de
`interaction/dwellRing` e `interaction/dwell`.
**Fora de escopo, intocável:** `electron/`, pipeline de gaze.

---

## 1. O que existe hoje

`pages/help/TutorialScreen.tsx` são cinco cartões estáticos — "Comunicação",
"Teclado Virtual", "Controle do Computador", "Personalização", "Tudo Pronto".
Nenhuma interação, nenhuma menção a dwell, tempo de permanência ou botão de
emergência. É folheto de produto, não tutorial de uso.

O conteúdo não é aproveitável. A rota `/tutorial` é.

Duas coisas que o tutorial precisa ensinar já existem e nunca foram
apresentadas ao paciente:

- **O anel de dwell** (`src/interaction/dwellRing.ts`), com geometria pronta e
  testada.
- **O botão de emergência** (`context/EmergencyContext.tsx`), que flutua em toda
  tela de paciente. Ninguém é ensinado que ele está lá nem como aciona.

## 2. Premissas

1. **O usuário final tem ELA/ALS.** Nenhum passo reprova, nenhum tem tempo
   esgotado. Um tutorial que diz "errou" a quem está aprendendo a usar os
   próprios olhos como ponteiro é uma barreira, não uma ajuda.
2. **Prática só existe com olhar funcionando.** Sem calibração o dwell fica
   desligado, inclusive para emergência. Praticar antes seria praticar com o
   mouse.

## 3. Decisões

| # | Decisão | Razão |
|---|---|---|
| D1 | Wizard de 5 passos numa rota só (`/tutorial`) | O dwell precisa seguir ativo e configurado entre os passos; o slider do passo 3 tem de afetar a prática sem remontar nada. |
| D2 | Tutorial **depois** da calibração | É a única posição em que "sentir o tempo de permanência" é real. |
| D3 | `dwellSpeed` (enum) vira `dwellMs` (número), com migração | Três degraus não cobrem a distância entre ELA avançada e boa fixação. |
| D4 | Presets viram atalhos ao lado do slider, não um controle à parte | Dois controles para a mesma coisa é como limiares divergem. |
| D5 | Configurações usam o **mesmo** controle do tutorial | Idem. |
| D6 | A animação do passo 1 roda no tempo configurado do paciente | Animar 1,5 s com o dwell dele em 2,5 s ensina a coisa errada. |
| D7 | A prática nunca reprova | Premissa 1. Sem timeout, sem "tente de novo", sem pontuação. |
| D8 | O passo 4 permite acionar a emergência **de mentira** | Saber o que vai acontecer antes de precisar. Ver §6 para o isolamento. |
| D9 | Roda 1× por perfil; atalho nas Configurações | Mesmo mecanismo do preparo (Bloco 2). |

## 4. Arquitetura

```
frontend/src/
  pages/tutorial/
    TutorialWizard.tsx           rota /tutorial
    passos.ts                    ordem dos 5 passos
    steps/OQueEDwell.tsx         animação
    steps/PraticaGuiada.tsx      alvos
    steps/AjusteDoTempo.tsx      slider + alvo de teste
    steps/BotaoDeEmergencia.tsx  onde fica, como aciona, ensaio
    steps/Concluido.tsx
    AtalhoDeTutorial.tsx         cartão nas Configurações
  components/ui/
    AnelDeDwell.tsx              anel animado sobre a geometria do core
    AlvoDeDwell.tsx              alvo grande que completa por permanência
  services/local/
    tutorialProfile.ts           persistência por perfil
  dwellMs.ts                     faixa, presets e migração do enum
```

### 4.1 `dwellMs.ts` — a mudança de contrato

```ts
export const DWELL_MIN_MS = 400;
export const DWELL_MAX_MS = 4000;

export const PRESETS_DE_DWELL = [
  { id: 'lento',  ms: 2500 },
  { id: 'normal', ms: 1500 },
  { id: 'rapido', ms: 800  },
] as const;

/** Converte o enum antigo. Settings salvas antes da mudança continuam válidas. */
export function dwellMsDoLegado(speed: 'slow' | 'normal' | 'fast'): number;

/** Prende na faixa. Um `NaN` vindo de um slider não pode virar dwell infinito. */
export function limitarDwellMs(ms: number): number;
```

`SettingsContext` ganha `dwellMs: number` no lugar de `dwellSpeed`, com a
migração aplicada na leitura. `GazeContext` deixa de converter enum
(`DWELL_MS_BY_SPEED` some) e lê o número.

### 4.2 Persistência do tutorial

`localStorage`, chave `irisflow_tutorial_<profileId>`:

```ts
interface TutorialDoPerfil {
  version: number;
  completedAt: string;   // ISO 8601
  dwellMsEscolhido: number;
  ensaiouEmergencia: boolean;
}
```

`ensaiouEmergencia` é registrado porque é a diferença entre "o cuidador clicou
avançar" e "o paciente sabe onde o botão fica".

### 4.3 Onde entra no fluxo

`CalibrationCheck` termina em `navigate('/menu')`. Passa a ir para `/tutorial`
quando o perfil ainda não o concluiu, e a `/menu` quando já concluiu.

Não há portão: o tutorial **não bloqueia** nada. Quem não quiser fazer, pula —
travar o acesso à comunicação por um tutorial contradiz a premissa 1.

## 5. Os cinco passos

### 5.1 O que é olhar para clicar

Animação em laço: o olhar pousa, o anel enche, o clique acontece. Desenhada com
`geometriaDoAnel` do core — o mesmo anel que o paciente vai ver de verdade, e
não um desenho parecido que divergiria no primeiro ajuste.

Roda no `dwellMs` configurado (D6). Um texto curto abaixo diz o tempo em
segundos, porque "1,5 s" é a informação que o cuidador precisa para decidir se
está bom.

`prefers-reduced-motion` respeitado: com a preferência ligada, a animação vira
três quadros estáticos com legenda.

### 5.2 Prática guiada

Quatro alvos grandes, um por vez. Sem contagem, sem pontuação, sem tempo
esgotado.

Depois de cada acerto, um retorno sobre o **tempo até o clique**:

| Situação | Mensagem |
|---|---|
| Clique veio bem antes do olhar estabilizar | "Está disparando rápido. Quer aumentar o tempo?" |
| Paciente ficou muito além do necessário | "Você segurou mais que o preciso. Dá para diminuir." |
| Dentro do esperado | "Bom. Foi assim que deve parecer." |

A sugestão é sugestão: leva ao passo 3, não muda nada sozinha.

### 5.3 Ajuste do tempo

Slider de 400 a 4000 ms com um alvo de teste ao lado, que responde ao valor
corrente na hora. Os três presets aparecem como botões de atalho.

O valor é gravado em `settings.dwellMs` a cada mudança — sem "salvar", porque
o teste ao lado já é a confirmação.

### 5.4 Botão de emergência

Mostra o botão na posição real em que ele aparece, explica que o acionamento
exige dwell mais longo e passa por confirmação, e oferece **um ensaio**.

O ensaio é o ponto do passo: saber o que vai acontecer antes de precisar. Ver
§6 sobre o isolamento.

### 5.5 Concluído

Diz que dá para refazer a qualquer momento em Ajustes, e o atalho existe de
fato — `AtalhoDeTutorial`, ao lado do `AtalhoDePreparo` nas Configurações.

## 6. O ensaio de emergência — isolamento

O risco é concreto: um ensaio que vaze vira alerta real para um cuidador que
não está lá esperando.

O `EmergencyContext` ganha um modo de ensaio explícito. Quando ligado:

- `triggerEmergencyImmediately` **retorna antes** de qualquer envio.
- A navegação para `/emergency` não acontece.
- O retorno visual e o som acontecem, porque é o que o paciente precisa
  reconhecer depois.

O modo é ligado só pelo passo 4, e desligado ao desmontar — inclusive se o
componente cair por erro, via `finally` no efeito de limpeza.

O teste que importa afirma que **nenhuma chamada de rede acontece** durante o
ensaio, com o módulo de API espionado. Um teste que só verifique "não navegou"
passaria com o alerta sendo enviado.

## 7. Testes

| Arquivo | Cobre |
|---|---|
| `dwellMs.test.ts` | migração dos três valores legados; limites da faixa; `NaN` e infinito presos |
| `services/local/tutorialProfile.test.ts` | por perfil; versão; storage corrompido |
| `pages/tutorial/passos.test.ts` | ordem; voltar sempre livre |
| `components/ui/AnelDeDwell.test.tsx` | usa a geometria do core; progresso 0 e 1; `NaN` não enche o anel |
| `steps/PraticaGuiada.test.tsx` | **nunca reprova**: sem timeout, sem estado de erro; as três mensagens de retorno |
| `steps/AjusteDoTempo.test.tsx` | slider grava em ms; presets; valor fora da faixa é preso |
| `steps/BotaoDeEmergencia.test.tsx` | **o ensaio não faz chamada de rede**; o modo desliga ao desmontar |
| `TutorialWizard.test.tsx` | navegação; conclusão persiste; pular é possível |
| `AtalhoDeTutorial.test.tsx` | leva ao wizard; não apaga o registro |
| `SettingsContext` (existente) | a migração do enum não perde a configuração do usuário |

O guarda de tema (`pages/temaEscuro.test.tsx`) recebe as telas novas.

Verificação: `cd frontend && npm run verify`.

## 8. Limitações conhecidas

1. **O retorno da prática é heurístico.** "Disparou rápido demais" compara o
   instante do clique com a estabilização da fixação; é um indício, não uma
   medida de conforto. A decisão continua sendo do cuidador.
2. **O tutorial não detecta que o paciente piorou.** ELA é progressiva e o
   `dwellMs` bom hoje pode não ser o de daqui a três meses. Nada reavalia
   sozinho; quem refaz é o cuidador, pelo atalho.
3. **O ensaio de emergência não exercita o caminho real.** Ele prova que o
   paciente sabe acionar, não que o alerta chega. Testar a entrega ponta a
   ponta exige o backend, que não existe.
