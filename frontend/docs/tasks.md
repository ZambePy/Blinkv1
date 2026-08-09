# Auditoria Técnica e Plano de Ação — IrisFlow Frontend

**Repositório analisado:** `IrisGazerFrontEnd-main` (React 19 + TypeScript + Vite 8 + React Router 7)
**Escopo:** revisão completa de código (30 telas, 3 contexts, 4 componentes compartilhados, script Python auxiliar), busca por bugs, telas mortas/quebradas, divergência com o backend real (`IrisGazer`), e recomendações de melhoria de performance e experiência.

---

## Veredito executivo

O frontend tem um volume de trabalho impressionante — 30 telas construídas, boa parte delas visualmente polida e mais completa que a especificação original (mini-jogos, chatbot, painel do cuidador, pictogramas, meditação guiada). **Mas existe um problema estrutural que precede qualquer outro:** nenhuma tela do sistema realmente implementa seleção por fixação ocular (dwell). O componente central criado para isso, `DwellButton`, é um `<button onClick>` disfarçado, e não é usado em lugar nenhum do app. Isso significa que, hoje, o IrisFlow funciona como um sistema **mouse/touch-only** — o que é exatamente o oposto da proposta de valor do produto para a banca e para o usuário final com ELA.

Esse ponto único, se corrigido, resolve por tabela boa parte dos achados críticos abaixo (itens 1–4). Os demais achados (telas mortas, botões sem função, contrato quebrado com o backend) são independentes e também precisam de correção, mas nenhum é tão urgente quanto este.

---

## 1. Achados críticos (bloqueiam a proposta de valor do produto)

### 1.1 `DwellButton` não implementa dwell — é um `onClick` com nome enganoso

**Arquivo:** `src/components/DwellButton.tsx`

```tsx
export const DwellButton: React.FC<DwellButtonProps> = ({
  dwellTime: _dwellTime,        // recebido, nunca usado
  onDwellClick,
  progressColor: _progressColor, // recebido, nunca usado
  activeColor: _activeColor,     // recebido, nunca usado
  children, className = '', ...props
}) => (
  <button className={className} onClick={onDwellClick} {...props}>
    {children}
  </button>
);
```

Os três props que dariam sentido ao componente (`dwellTime`, `progressColor`, `activeColor`) são recebidos e imediatamente descartados (renomeados com `_` só para silenciar o linter). Não há temporizador, não há barra de progresso, não há os três estágios de feedback (contorno → cor → progresso) que o próprio time documentou como padrão obrigatório no `roadmap.txt`/documento de especificação de UI.

**Evidência de que isso não é usado em lugar nenhum:**
```
$ grep -rl "DwellButton" src/pages src/components
src/components/DwellButton.tsx   ← só a própria definição
```

### 1.2 Nenhuma tela consome a coordenada de olhar (`gaze`) do `WebSocketContext`

**Arquivo:** `src/context/WebSocketContext.tsx`

O contexto recebe `gaze: {x, y}` do backend e usa isso **apenas** para desenhar um pontinho vermelho de debug fixo na tela (`position: fixed`). Nenhuma outra parte do código lê esse valor:

```
$ grep -rln "gaze" src/pages src/components src/context
src/context/WebSocketContext.tsx   ← só aqui
```

Ou seja: não existe, hoje, nenhum código que traduza "o olhar do usuário está sobre o botão X" em "o botão X entrou em estado de fixação". Esse é o elo que falta entre o backend (que já emite a predição) e a interface (que só reage a clique/hover de mouse).

### 1.3 Todo feedback visual de seleção depende de `:hover`/`:active` — inúteis sem cursor de mouse

**Arquivo:** `src/index.css` (classes `.action-card`, `.key-btn`, `.btn-pill`)

```css
.action-card:hover { transform: translateY(-6px) scale(1.03); ... }
.key-btn:hover { background: #f0f7ff; border-color: #1B54A8; ... }
```

Todo o feedback de "isso está prestes a ser selecionado" é implementado como pseudo-classes CSS de mouse. Sem um cursor real sobre o elemento (que não existe em uso por gaze puro), essas classes nunca disparam. Isso reforça o achado 1.1/1.2: o sistema de feedback em três estágios documentado no próprio material de referência do time não existe na prática, em nenhuma tela.

### 1.4 O contrato de WebSocket do frontend não bate com o backend real (`IrisGazer`)

**Arquivo:** `src/context/WebSocketContext.tsx` + `endpoints.txt`

O frontend espera:
```
ws://localhost:8000/ws/tracker
→ {"type":"gaze_data","x":<float>,"y":<float>}
→ {"type":"calibration_status","status":"ok"|"failed","accuracy":<float>}
→ {"type":"blink","duration":<float>}
← {"action":"start_calibration"}
← {"action":"telemetry_game_data","target_x":...,"target_y":...,"error_margin":...}
```

O backend `IrisGazer` (verificado diretamente no código-fonte do outro repositório) implementa:
```
ws://.../ws/gaze
→ {"type":"pred","x_px":...,"y_px":...}
```
com handshake de tela (`{"type":"screen","w":...,"h":...}`) e uma rota **separada** `ws_calibration.py` para o fluxo de calibração — não mensagens dentro do mesmo canal de tracking.

**Como esses dois sistemas estão hoje, eles não conseguem conversar.** `endpoints.txt` parece ter sido escrito como uma proposta de contrato desejado pelo frontend, sem consulta ao que o backend já implementa. Isso precisa ser resolvido com uma reunião de alinhamento de contrato antes de qualquer tentativa de integração — ver Fase 0 do plano de ação.

### 1.5 WebSocket sem reconexão, sem tratamento de erro, URL fixa no código

**Arquivo:** `src/context/WebSocketContext.tsx`

```tsx
const socket = new WebSocket('ws://localhost:8000/ws/tracker'); // hardcoded
socket.onopen = ...
socket.onmessage = ...
socket.onclose = () => setIsConnected(false); // e para por aqui
// não há socket.onerror
// não há retry/backoff
// useEffect roda uma única vez ([]), nunca tenta reabrir a conexão
```

Se o backend cair ou reiniciar (bem provável num setup de kiosk/kit local), o app fica permanentemente desconectado até um reload manual da página — que um usuário controlando o sistema só com o olhar não consegue fazer sozinho. Não há também nenhuma URL configurável por variável de ambiente (`import.meta.env`), então build de produção e desenvolvimento usam o mesmo `localhost:8000` fixo.

---

## 2. Achados de alta prioridade (telas quebradas, mortas ou com botões sem função)

### 2.1 Duas telas de Configurações conflitantes — a que está no ar não usa o estado global

Existem **dois arquivos** `SettingsScreen.tsx`:

| Arquivo | Roteado em `App.tsx`? | Usa `SettingsContext`? |
|---|---|---|
| `src/pages/SettingsScreen.tsx` | **Sim** (`/settings`) | **Não** — usa `useState` local próprio |
| `src/pages/settings/SettingsScreen.tsx` | Não (código morto) | Sim, mas descarta `updateSettings` (`const { settings, updateSettings: _updateSettings }`) |

Resultado prático: o `dwellSpeed` que o usuário ajusta na tela de Configurações **nunca é salvo** (é estado de componente, se perde ao navegar) e, mesmo que fosse salvo, nada no app leria `settings.dwellSpeed` para ajustar o tempo de fixação — porque, como visto no item 1.1, não existe temporizador de fixação implementado em lugar nenhum.

A segunda tela órfã (`pages/settings/SettingsScreen.tsx`) tem conteúdo **completamente diferente** — painel de Mouse Virtual e Backup/Restauração — sugerindo que duas pessoas do time criaram implementações concorrentes da mesma rota e só uma foi conectada ao roteador. Vale decidir qual conteúdo é o definitivo e mesclar, não descartar nenhum dos dois às cegas.

### 2.2 `SettingsContext` define configurações que nunca são lidas

**Arquivo:** `src/context/SettingsContext.tsx`

`dwellSpeed`, `eyeDominance` e `voiceGender` existem no tipo `Settings` e são persistidos em `localStorage`, mas:
```
$ grep -rn "settings\.\(dwellSpeed\|eyeDominance\|voiceGender\)" src/pages
(nenhum resultado)
```
Nenhuma tela lê esses valores. `TTSButton` recebe um `voiceProfileId` opcional mas nunca é chamado com o valor de `settings.voiceGender`/`voiceProfileId` — a seleção de voz feminina/masculina/clonada, hoje, não afeta a fala em nenhuma tela.

### 2.3 Rota `/virtual-mouse` referenciada mas nunca registrada — link quebrado

**Arquivos:** `src/pages/MainMenu.tsx` (define `route: '/virtual-mouse'`) × `src/App.tsx` (não declara essa rota)

Clicar no card "Mouse Virtual (PC)" na aba Sistema do menu principal leva a uma página em branco. Não existe `<Route path="*">` de fallback, então qualquer URL inválida (essa ou outras futuras) também resulta em tela branca sem forma de o usuário voltar sozinho.

### 2.4 Duas telas de onboarding inteiras, construídas e nunca alcançadas

**Arquivos:** `src/pages/onboarding/CalibrationCheck.tsx`, `src/pages/WelcomeScreen.tsx`

O fluxo real de navegação (rastreado em todos os `navigate(...)` do onboarding) é:
```
InitialSplash (4s) → /login → (submit) → /tutorial → (fim) → /profiles → (seleciona) → /menu
```
`/calibration-check` e `/welcome` **nunca são chamadas por nenhum botão** — são acessíveis apenas se alguém digitar a URL manualmente. É uma coincidência notável que sejam exatamente as duas telas que o material de referência de UI do próprio projeto (seção 5.1) apontou como necessárias: verificação de calibração antes do menu, e uma pausa de boas-vindas para o usuário se posicionar diante da câmera. Foram construídas — com boa qualidade — e depois ficaram órfãs no roteamento.

Vale notar também que `CalibrationCheck.tsx`, mesmo se conectada, hoje **não fala com o backend** — a barra de progresso é um `setInterval` decorativo que sempre chega a 100% em ~3 segundos, independente da qualidade real do rastreamento. Não envia `start_calibration` nem escuta `calibration_status`.

### 2.5 Botões visualmente prontos sem nenhuma ação (`onClick` vazio ou ausente)

| Tela | Botão | Estado |
|---|---|---|
| `MyOptionsScreen.tsx` | Favoritos, Contatos, Chamadas, Adicionar Novo | `onClick={() => {}}` nos 4 cards |
| `SettingsScreen.tsx` (rota ativa) | "Gravar Amostra", "Upload de Áudio (.wav)" | sem `onClick` |
| `CaregiverDashboard.tsx` | "Mal" / "Bem" (humor), "Salvar Diário" | sem `onClick` |

`MyOptionsScreen` é particularmente importante: é exatamente a tela que o documento de especificação original sugeriu como fonte de frases dinâmicas/favoritas para "Frases Rápidas" — hoje é uma vitrine sem nenhuma função ligada.

### 2.6 Telas de alerta declaram sucesso sem confirmar que o alerta foi enviado

**Arquivos:** `src/pages/caregiver/IAmOkScreen.tsx`, `src/pages/output/EmergencyEscalation.tsx`

`IAmOkScreen` mostra "Sinal enviado aos cuidadores com sucesso!" a partir puramente de um `setTimeout` local — **não há nenhuma chamada de rede** nessa tela.

`EmergencyEscalation` chama de fato `api.sendHelpAlert(...)`, mas:
```tsx
api.sendHelpAlert('usuario_atual').catch(e => console.log('Erro de rede esperado no mock', e));
```
o erro é engolido em `console.log`, e a UI já mostrou "ALERTA ENVIADO!" antes mesmo da resposta do `fetch` chegar — o sucesso é assumido incondicionalmente. **Para uma tela de emergência médica, esse é o pior tipo de bug possível**: o paciente vê a confirmação mesmo quando o alerta não saiu, e não há retry nem fallback (ex.: repetir o alarme sonoro, tentar canal alternativo) se a rede falhar.

### 2.7 Sem controle de acesso nas rotas do cuidador

**Arquivo:** `src/App.tsx` (rotas planas, sem guarda) + `src/context/AuthContext.tsx`

`AuthContext` já modela `isCaregiver: boolean`, mas nenhuma rota verifica esse valor antes de renderizar. `/caregiver`, `/settings` (que tem seu próprio PIN duplicado — ver 2.8) e qualquer tela sensível são acessíveis diretamente pela URL, sem checagem. Quando a seleção por fixação ocular for implementada (item 1.1), isso se torna um risco real: o próprio paciente, com o olhar, pode alcançar telas destinadas apenas ao cuidador.

### 2.8 PIN de cuidador hardcoded e duplicado em dois lugares diferentes

**Arquivos:** `src/context/AuthContext.tsx` (`loginCaregiver`) e `src/pages/SettingsScreen.tsx` (formulário de PIN próprio, `if (pin === '1234')`)

Existem duas implementações independentes de "validar PIN do cuidador", nenhuma chamando a outra, ambas com o mesmo PIN fixo `1234` cravado no código-fonte (visível em texto claro, inclusive citado como dica na mensagem de erro: `alert('PIN incorreto. (Dica: 1234)')`). Nenhuma validação passa pelo backend.

### 2.9 `LoginScreen` não autentica nada — só navega

**Arquivo:** `src/pages/auth/LoginScreen.tsx`

```tsx
const handleLogin = (e: React.FormEvent) => {
  e.preventDefault();
  navigate('/tutorial'); // aceita qualquer email/senha
};
```
Não chama `loginCaregiver` nem `selectProfile`. Depois do "login", `currentProfile` continua `null` e `isCaregiver` continua `false` pelo resto da sessão — o app nunca sabe quem está logado.

---

## 3. Mini-jogos: implementados, mas sem eye tracking nenhum

Os três jogos existentes são funcionalmente jogos de clique, apesar do cabeçalho do menu dizer "Mini-Jogos com Eye Tracking":

- **`BubblePopGame.tsx`** — a instrução na tela literalmente diz **"Clique na bolha!"**. Não há dwell, não há leitura de `gaze`.
- **`FollowTarget.tsx`** — o alvo se move sozinho a cada 3 segundos via `setInterval`, e a pontuação (`score`) incrementa tanto no timer quanto no clique. Ou seja, o placar mede tempo decorrido, não precisão de fixação — o oposto do que o jogo deveria medir.
- **`MemoryGame.tsx`** — jogo da memória clássico por clique, sem gaze.

Nenhum dos três envia telemetria para a ação `telemetry_game_data` descrita em `endpoints.txt`, então a ideia de "calibração disfarçada" (usar os jogos para monitorar a qualidade do rastreamento ao longo do tempo) documentada no material de referência do projeto não está implementada em nenhum grau.

---

## 4. Duas implementações de "eye tracking" que não se conversam

**Arquivo:** `python_scripts/virtual_mouse.py`

Existe um script Python **paralelo e independente** do backend `IrisGazer`: usa MediaPipe Face Mesh cru (não o Face Landmarker Tasks API que o backend usa), lê apenas o landmark 473 (íris esquerda), aplica um fator de sensibilidade fixo (`* 1.5 - screen*0.25`) sem qualquer calibração por usuário, e move o cursor do sistema operacional via `pyautogui`. O clique por piscar está deixado como comentário/TODO, nunca implementado.

Nada no React chama esse script. O toggle "Mouse Virtual" na tela de Configurações órfã (`pages/settings/SettingsScreen.tsx`) é só um `useState` boolean local com o comentário `// Aqui no futuro chamaremos o WebSocket`. E o card "Mouse Virtual (PC)" do menu principal aponta para a rota quebrada `/virtual-mouse` (item 2.3).

**Recomendação:** este script deveria ser aposentado em favor do pipeline real (`IrisGazer`, que tem CNN treinada, calibração por usuário e filtro de suavização) — manter os dois é confuso e o script cru tem precisão muito inferior ao modelo treinado.

---

## 5. Achados médios / polimento

| # | Tela/Arquivo | Problema |
|---|---|---|
| 5.1 | `MeditationScreen.tsx` | A animação de respiração agenda uma cadeia recursiva de `setTimeout` (`cycle()` chamando `cycle()`) que **não é cancelada** ao sair da tela — só `setScale(1)` roda no cleanup. Navegar para fora no meio do ciclo deixa o timer rodando em segundo plano e gera `setState` em componente desmontado. |
| 5.2 | `KeyboardScreen.tsx` | Campo de texto usa `whiteSpace: nowrap; overflow: hidden` sem auto-scroll até o cursor — frases longas ficam invisíveis exatamente no momento em que o usuário mais precisa reler antes de apertar FALAR. |
| 5.3 | `KeyboardScreen.tsx` / `TTSButton.tsx` | Duas implementações independentes de `speechSynthesis` (a tela não reaproveita o componente `TTSButton`) — nenhuma das duas lê `settings.voiceGender`/`voiceProfileId`, então a troca de voz configurada não tem efeito em nenhum ponto real de fala. |
| 5.4 | `BackButton.tsx` vs. botões "Voltar" locais | `BackButton` usa `navigate(-1)` (histórico do navegador); várias telas implementam seu próprio botão "Voltar" com `navigate('/menu')` fixo. Duas filosofias de retorno coexistindo — `navigate(-1)` também quebra silenciosamente se a tela for aberta direto (histórico vazio). |
| 5.5 | `GalleryScreen.tsx` | Fotos de exemplo são links fixos do Unsplash (banco de imagens genérico), não fotos do próprio paciente — esvazia o propósito terapêutico de uma galeria pessoal, e depende de internet, contrariando o princípio de operação 100% offline do projeto. |
| 5.6 | `NewsScreen.tsx`, `ChatbotScreen.tsx` | Conteúdo/resposta totalmente mockados (3 notícias fixas; chatbot ecoa a mensagem do usuário via `setTimeout`). Aceitável como scaffold, mas deve ficar marcado como stub, não como feature pronta. |
| 5.7 | `ChatbotScreen.tsx` | Entrada de texto é um `<input>` HTML comum — não há caminho do teclado virtual do próprio app até esse campo. O único usuário que não pode usar teclado físico não consegue operar a tela do assistente feito para ele. |
| 5.8 | `MainMenu.tsx` | Cresceu para 4 abas × 3–6 itens (15 destinos). Escolha de IA válida, mas se afasta do princípio "poucos alvos grandes" que o próprio material de referência do projeto define como boa prática — vale ser uma decisão de design explícita, документada, não um desvio silencioso. |
| 5.9 | Roteamento geral | Sem `<Route path="*">` — qualquer URL inválida deixa a tela em branco sem saída. |

---

## 6. Plano de ação priorizado

### Fase 0 — Alinhamento de contrato (antes de qualquer código novo)

1. Reunir o `endpoints.txt` do frontend e o código real de `server/ws_gaze.py` + `server/ws_calibration.py` do `IrisGazer` numa sessão única de definição de contrato. Decidir a versão final de: nome da rota WS, formato das mensagens (`pred`/`x_px`/`y_px` vs. `gaze_data`/`x`/`y`), handshake de tela, e onde a calibração acontece (mesmo canal ou canal separado).
2. Documentar o contrato final em um único lugar (ex.: `docs/api-contract.md`, já mencionado no material de referência do projeto) e apontar tanto o front quanto o back para ele. `endpoints.txt` deve ser descontinuado ou atualizado para refletir a decisão, não a proposta original.
3. Adicionar a URL do WebSocket/API como variável de ambiente (`VITE_WS_URL`, `VITE_API_BASE`), nunca hardcoded.

### Fase 1 — O núcleo de interação por gaze (a peça que faltava)

4. Reescrever `DwellButton` de verdade: receber a posição de gaze (via contexto), detectar quando o ponto está sobre o elemento (bounding box + tolerância), rodar um temporizador configurável (`dwellTime`, vindo de `SettingsContext.dwellSpeed`), expor os três estágios visuais (hover/contorno → progresso → confirmação), e permitir "desistência" se o olhar sair do alvo antes do tempo completar.
5. Trocar todos os `onClick` diretos do app pelo `DwellButton` corrigido, começando pelas telas mais usadas: `MainMenu`, `KeyboardScreen`, `QuickPhrasesScreen`, `PictogramScreen`. Manter compatibilidade com clique de mouse/toque como método alternativo (não excludente) — importante também para o cuidador operar por mouse.
6. Conectar `SettingsContext` de verdade: eliminar a tela de Configurações duplicada (decidir entre as duas, mesclar o conteúdo relevante de ambas), fazer o seletor de temporizador escrever em `updateSettings`, e fazer o novo `DwellButton` ler `settings.dwellSpeed`.
7. Implementar a reconexão do WebSocket (retry com backoff, `onerror` tratado) e um indicador visual de status de conexão sempre visível — hoje `isConnected` existe no estado mas não aparece em lugar nenhum da UI.

### Fase 2 — Consertar o que está quebrado

8. Registrar a rota `/virtual-mouse` (ou remover o card do menu até a funcionalidade existir) e adicionar `<Route path="*">` com uma tela de fallback amigável.
9. Reconectar `CalibrationCheck` e `WelcomeScreen` ao fluxo real de onboarding (`/profiles → /calibration-check → /welcome → /menu`), e então ligar `CalibrationCheck` ao WebSocket real (enviar `start_calibration`, escutar o status genuíno em vez do `setInterval` decorativo).
10. Corrigir `EmergencyEscalation` e `IAmOkScreen` para só mostrar "enviado com sucesso" após confirmação real da API, com estado de erro/retry visível se a chamada falhar. Isso é o item de maior risco do documento inteiro — uma tela de emergência não pode mentir sobre o envio.
11. Adicionar guarda de rota simples (`isCaregiver` de `AuthContext`) nas telas `/caregiver` e `/settings`; unificar o PIN em um único lugar (`AuthContext.loginCaregiver`), remover a validação duplicada de `SettingsScreen`, e (quando o backend permitir) validar o PIN no servidor em vez de no cliente.
12. Conectar `LoginScreen` a `AuthContext` de verdade (`loginCaregiver`/`selectProfile`) antes de navegar adiante.
13. Implementar as ações vazias: os 4 cards de `MyOptionsScreen` (mesmo que como CRUD simples em `localStorage` numa primeira versão), os botões de humor e "Salvar Diário" do `CaregiverDashboard`, "Gravar Amostra"/"Upload de Áudio" da tela de voz.

### Fase 3 — Mini-jogos com gaze de verdade

14. Reescrever `FollowTarget` para medir o que o nome promete: distância entre `gaze.{x,y}` e o centro do alvo, ao longo do tempo, como métrica de precisão — não um contador de cliques/tempo.
15. Trocar o clique de `BubblePopGame` e `MemoryGame` por dwell (reaproveitando o `DwellButton` da Fase 1), com a instrução de texto atualizada ("Olhe para a bolha" em vez de "Clique na bolha!").
16. Emitir a telemetria `telemetry_game_data` (ou o equivalente decidido na Fase 0) a cada rodada, fechando o ciclo "jogo como calibração disfarçada" que já está documentado como objetivo.

### Fase 4 — Polimento

17. Corrigir o vazamento de timer do `MeditationScreen` (cancelar a cadeia de `setTimeout` no cleanup, ou trocar por `setInterval` único).
18. Auto-scroll do campo de texto do teclado virtual até o cursor.
19. Unificar a síntese de voz num único hook/serviço (`useSpeak()`), usado por `TTSButton`, `KeyboardScreen` e `EmergencyEscalation`, já lendo `settings.voiceGender`/`voiceProfileId` — deixa a integração futura de voz clonada (item já presente no `SettingsContext`) plugável em um único ponto.
20. Padronizar o comportamento de "Voltar" (escolher `navigate(-1)` ou destino fixo, não os dois) e documentar a escolha.
21. Substituir as fotos de exemplo do `GalleryScreen` por um mecanismo de upload local (mesmo que simples) — ou, no mínimo, deixar claro na UI que são fotos de demonstração.

---

## 7. Sugestões de melhoria e novas funcionalidades

Pensando em performance do ecossistema e em qualidade de vida/lazer do usuário, além de terminar o que já foi começado:

### Performance e robustez
- **Error boundary global** no `App.tsx` — hoje qualquer exceção não tratada em uma tela derruba o app inteiro sem tela de recuperação; crítico para um usuário que não consegue "simplesmente fechar e reabrir" sozinho.
- **Memoização das listas grandes** (`MENU_DATA`, `PHRASES`, `PICTOGRAMS`) — hoje são recriadas a cada render; sem impacto perceptível ainda, mas vale corrigir antes de crescerem.
- **Pré-carregamento de vozes do `speechSynthesis`** — em alguns navegadores a lista de vozes carrega de forma assíncrona (`onvoiceschanged`) e a primeira chamada de `speak()` pode sair na voz errada ou falhar silenciosamente; nenhuma tela trata esse evento hoje.
- **Modo offline explícito:** já que o produto se propõe local-first, vale um indicador de "sem conexão com o backend" that gate as telas que dependem de rede (alertas, clonagem de voz, casa inteligente), evitando os falsos-positivos do item 2.6 em qualquer tela futura.

### Lazer e engajamento do usuário
- **Rotação de conteúdo em `GalleryScreen`/`NewsScreen`:** depois de resolvido o item 5.5, considerar exibir a foto/notícia do dia automaticamente na tela de Boas-vindas ou no modo Descanso, dando ao app uma sensação de "vivo" mesmo sem interação.
- **Placar/progresso persistente dos mini-jogos:** hoje o placar reseta a cada visita; guardar histórico simples (melhor tempo, sequência de acertos) em `localStorage` já daria sensação de progresso sem exigir backend.
- **Modo "Rádio"/música ambiente:** trivial de implementar com `<audio>` e uma lista de faixas locais, e é um pedido comum em tecnologia assistiva para preencher momentos sem comunicação ativa.
- **Leitura cronometrada** (do documento de referência original, ainda não implementada): destacar palavras de um texto conforme o olhar avança na linha — uma vez que o gaze real estiver conectado (Fase 1), essa tela reaproveita a mesma leitura de coordenada dos mini-jogos e serve tanto como lazer quanto como verificação indireta da suavização do backend em uso real de leitura.
- **Favoritar frases direto de `QuickPhrasesScreen`:** um botão de "favoritar" em cada cartão, alimentando o `MyOptionsScreen` (item 13) — fecha o ciclo que o material de referência original já desenhava entre as duas telas.

### Qualidade de vida do cuidador
- **Indicador de última atividade do paciente** no `CaregiverDashboard` — quando foi a última interação registrada, útil para perceber se o sistema (ou o paciente) parou de responder.
- **Exportar o diário de sintomas** (uma vez funcional) em PDF/CSV para levar à consulta médica — reaproveita a mesma ideia de "Exportar Backup (JSON)" já presente na tela de Configurações órfã.

---

## 8. O que já está bem feito (para não jogar fora)

Vale registrar o que funciona e deve ser preservado durante as correções:

- `EmergencyEscalation`: poucos alvos grandes, alarme sonoro nativo via `AudioContext`, TTS em volume/tom de alerta, botão de cancelar — arquitetura de tela correta, só falta consertar a confirmação de envio (item 2.6).
- `PictogramScreen`: única tela de CAA visual totalmente funcional ponta a ponta (seleção → texto → fala).
- `CalibrationCheck` e `WelcomeScreen`: qualidade visual e de conteúdo altas — o problema é exclusivamente de roteamento (item 2.4), não de implementação.
- Uso consistente da identidade visual da marca (`#1B54A8`, tipografia Boldonse) em praticamente todas as telas nomeadas.
- `SettingsContext` já modela corretamente o campo `voiceGender: 'cloned'`, antecipando a funcionalidade de clonagem de voz sugerida para o roadmap — só falta ninguém ler esse campo ainda (item 5.3).