# Integração do app desktop com o ecossistema IrisFlow

Este documento explica **como o app desktop conversa com o site e com o app do cuidador**,
arquivo por arquivo, para que você consiga mexer em pipeline, telas e regras sem quebrar a
comunicação. Os outros dois projetos têm o próprio `INTEGRACAO.md` com o lado deles.

```
SITE IRISFLOW V1 ──── cria a conta e a assinatura ────┐
                                                       ▼
                                          Supabase "Site Iris Flow"
                                          (um banco para os três)
                                                       ▲
PROJETO STARTUP (este) ── login único, licença, ───────┤──── irisflow-cuidador
                          pareamento, mensagens,       │     (celular: conversa,
                          socorro, sessões             │      alertas, relatórios,
                                                       │      ajuste remoto)
```

## 1. O que sai e o que entra

| Direção | O quê | Por onde | Quando |
| --- | --- | --- | --- |
| desktop → nuvem | e-mail + senha | Supabase Auth (`signInWithPassword`) | tela de Login (`/login`, Bloco 1) |
| nuvem → desktop | "pode usar?" (licença) | RPC `desktop_license()` no login; `desktop-sync {device.info}` (que embute `license_for_profile`) nas verificações seguintes | login, toda abertura (`LicenseContext.verificar`) |
| desktop → nuvem | vínculo deste computador | RPC `pair_device()` → devolve `device_key` (= `token` da licença) | login e transferência (`device-limit`) |
| desktop → nuvem | heartbeat (câmera ok, rastreador ok, calibrado) | Edge Function `desktop-sync` | a cada 30 s |
| desktop → nuvem | abertura/fechamento de sessão | `desktop-sync` `session.upsert` / `session.end` | ao vincular / ao fechar o app |
| desktop → nuvem | resumo da calibração + teste de precisão | `desktop-sync` `calibration.result` | fim do teste de precisão |
| desktop → nuvem | o que o paciente falou (teclado, frases, pictogramas, sim/não) | `desktop-sync` `message.send` | a cada fala |
| desktop → nuvem | pedido de socorro | `desktop-sync` `help.create` | botão de emergência |
| nuvem → desktop | mensagens do cuidador | realtime `postgres_changes` em `messages` (+ polling de reserva) | imediato |
| nuvem → desktop | ajuste remoto (tempo de fixação, suavização) e frases rápidas | realtime em `patient_settings` / `quick_phrases` + `settings.get` | imediato / na abertura |
| desktop → nuvem | "mensagem do cuidador foi falada" | `desktop-sync` `message.spoken` | após vocalizar |
| desktop → nuvem | rótulo da voz em uso ("Voz clonada (local)" / "pt-BR padrão") | `desktop-sync` `voice.status` (só texto; `update` em `patient_settings.voice`) | ao ligar os serviços e quando a voz muda |
| desktop → internet | download dos pesos do modelo de voz (Hugging Face), **uma vez** | processo Python (`voice-engine`), fora do renderer e da CSP | botão "Baixar o modelo" na tela de Voz |

**O que NUNCA sai:** imagem da câmera, marcos faciais, vetores de features, perfil de calibração,
relatório bruto (amostras), **áudio de referência da voz, modelo de voz e frases geradas**. Isso é garantido por três camadas: o código só envia o que está em
`frontend/src/cloud/sessao.ts` (resumo numérico), a CSP só libera a origem do Supabase em
`connect-src` (`src/electronSecurity.ts`), e a Edge Function só aceita colunas de uma lista
(`SESSION_FIELDS` em `irisflow-cuidador/supabase/functions/desktop-sync/index.ts`).

## 2. Mapa de arquivos

### Onde a integração se encaixa no que já existia

O Bloco 1 (`docs/superpowers/specs/2026-09-07-bloco1-conta-licenca-design.md`) definiu o
contrato `LicenseService` e deixou só o mock. A integração **implementa esse contrato sobre
o Supabase** — nenhuma tela do Bloco 1 mudou:

```
LicenseContext (Bloco 1) ──usa──► licenseService (services/license/index.ts)
                                     ├─ mockLicenseService     (sem VITE_SUPABASE_URL)
                                     └─ supabaseLicenseService (com VITE_SUPABASE_URL)  ← NOVO
                                              │
                                              ├─ Supabase Auth, desktop_license(), pair_device(), revoke_device()
                                              └─ grava o vínculo no cofre (irisflow.vinculo)
CloudProvider (cloud/CloudContext.tsx) ──lê──► useLicense(): status active/grace + token
                                              → chave do computador → desktop-sync / realtime
```

### `frontend/src/services/license/`

| Arquivo | O que mudou |
| --- | --- |
| `supabaseLicenseService.ts` (**novo**) | `LicenseService` real. `login` → Auth + `desktop_license()` (+ `no-subscription` com `manageUrl`) + limite de computadores (Essencial: outro ativo → `device-limit` com `transferToken`) + `pair_device()`; o `token` da `ActiveLicense` **é a `device_key`**. `verify` → `desktop-sync {device.info}` com a chave (403 `device_revoked` → `revoked`; 401 → `invalid-token`; licença `allowed=false` → `expired`; rede/5xx/gateway → `unreachable`, que aciona a tolerância de 7 dias do `LicenseContext`). `transferDevice` → `pair_device()` (revoga o anterior no Essencial). `logout` → avisa o CloudProvider (fecha a sessão), `revoke_device()`, `signOut`, limpa o cofre. Testado em `supabaseLicenseService.test.ts` (13 casos). |
| `index.ts` | Escolhe `supabase` quando `nuvemConfigurada`, senão o mock. Exporta `licenseBackend`. |
| `types.ts` | `Account` ganhou `beneficiaryId?`/`beneficiaryName?` (o CloudProvider precisa do paciente para o filtro do realtime). Opcionais: o mock e os testes do Bloco 1 continuam iguais. |
| `mockLicenseService.ts`, `deviceId.ts` | **Inalterados.** O id local da máquina (`deviceId.ts`) vai para o banco como `devices.hostname`: é como o servidor reconhece "este mesmo computador" num novo login sem gastar uma ativação. |

### Camada `frontend/src/cloud/` — conversa, socorro, sessões

| Arquivo | Papel | Depende de | Quem usa |
| --- | --- | --- | --- |
| `config.ts` | Lê `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DESKTOP_SYNC_URL`, `VITE_SITE_URL`. Exporta `nuvemConfigurada`. **Sem as duas primeiras, licença = mock e o resto fica inerte.** | `.env.local` | tudo |
| `types.ts` | Tipos do contrato (`Message`, `PatientSettings`, `QuickPhrase`, `LicencaResposta`, `PareamentoResposta`, `VinculoLocal`, `ResumoDePrecisao`, `SessaoRemota`). snake_case = colunas do banco. | — | tudo |
| `armazenamento.ts` | `cofre`: `safeStorage` do Electron via `window.irisflowCloud`; fora do Electron, `localStorage`. Guarda a sessão do supabase-js, o vínculo (`irisflow.vinculo`) e a fila offline. `infoDoApp()`. | `electron/preload.ts` | `supabaseClient`, `supabaseLicenseService`, `desktopSync`, `CloudContext` |
| `supabaseClient.ts` | Cliente supabase-js único, sessão persistida no cofre. | `config`, `armazenamento` | `supabaseLicenseService`, `CloudContext` |
| `desktopSync.ts` | Cliente da Edge Function `desktop-sync`: headers `x-device-key` + JWT anônimo; **fila offline** para mensagem, socorro, calibração e fim de sessão; `drenar()`, `limparFila()`; só 401/403 com `unauthorized`/`device_revoked` contam como chave perdida (401 do gateway vai para a fila). | `config`, `armazenamento` | `CloudContext` |
| `sessao.ts` | `resumoDoRelatorio()` e `camposDeCalibracao()`: **o único lugar que decide o que do relatório de precisão sai do computador** (agregados; nunca amostras). | `@tracker/accuracy` (tipos) | `CloudContext` |
| `eventos.ts` | Barramento: telas emitem `fala`, `ajuda`, `calibracao`, `uso`; o provider escuta. Telas não importam Supabase. | — | telas do paciente, `CloudContext` |
| `CloudContext.tsx` | O provider. Segue `useLicense()`: `active`/`grace` + `token` → liga heartbeat, sessão, realtime e polling; `none`/`blocked` → encerra a sessão e desliga. Fala as mensagens do cuidador (TTS) e confirma (`message.spoken`), aplica ajustes remotos (dwell em ms, preset `-v2`), trata os eventos das telas. Chave recusada → limpa tudo e pede `reverificar()` ao LicenseContext (vira `revoked` → `/login`). `useCloud()` é inerte fora do provider. | tudo acima + `GazeContext`, `SettingsContext`, `LicenseContext`, `dwellMs` | `App.tsx`, telas |
| `CloudBanners.tsx` | Cartão "Mensagem do cuidador" com Ouvir de novo / Responder (dwell). | `CloudContext` | `App.tsx` |
| `CloudStatusLines.tsx` | Duas linhas na página **Conta e assinatura** (`/conta`): estado do celular do cuidador (tempo real / consulta periódica / offline, fila, não faladas) e onde as credenciais estão guardadas. Só com a nuvem configurada. | `CloudContext`, `services/license` | `pages/conta/ContaEAssinatura.tsx` |

### Telas alteradas ou novas

| Arquivo | O que mudou |
| --- | --- |
| `pages/caregiver/ConversationScreen.tsx` (**nova**, rota `/conversation`, protegida) | Conversa com o cuidador pelo olhar: histórico dos dois lados, Sim/Não, Repetir (TTS), Escrever (→ teclado), frases rápidas (as do cuidador, se houver). Sem vínculo, explica e leva ao `/login`. |
| `pages/MainMenu.tsx` | Módulo "Conversa" (6.º cartão) com contador de mensagens não faladas. |
| `pages/conta/ContaEAssinatura.tsx` | Recebe `<CloudStatusLines />` abaixo das linhas da licença. |
| `pages/KeyboardScreen.tsx`, `QuickPhrasesScreen.tsx`, `core/PictogramScreen.tsx`, `core/MyOptionsScreen.tsx` | Uma linha em cada `speak`: `emitirFalaDoPaciente(texto, kind)`. |
| `pages/output/EmergencyEscalation.tsx` | `emitirPedidoDeAjuda('emergencia', label)`; escalonamento vai como mensagem de sistema. |
| `pages/caregiver/IAmOkScreen.tsx` | "Estou bem" como mensagem de sistema. |
| `pages/onboarding/CalibrationCheck.tsx` | Ao **concluir** o teste (`continue`): `emitirResultadoDeCalibracao(result, meta, duração)`; `calibracaoIniciadaEmRef` marca o início da coleta. |
| `App.tsx` | `CloudProvider` dentro do `GazeProvider` (abaixo do `LicenseProvider`), `CloudBanners` no router, rota `/conversation` com `ProtectedRoute`. |
| `pages/auth/LoginScreen.tsx`, `ActivatedScreen.tsx`, `onboarding/InitialSplash.tsx`, `ConsentScreen.tsx`, `ProfileSelect.tsx`, `components/ui/ProtectedRoute.tsx`, `GraceBanner.tsx` | **Inalterados** — o Bloco 1 já previa trocar a implementação por baixo. |

### Electron e segurança

| Arquivo | O que mudou |
| --- | --- |
| `src/electronSecurity.ts` | `origemDaNuvem(url)` (só https) e `cspComNuvem(csp, ...urls)`: acrescenta `https://<host>` e `wss://<host>` **apenas** em `connect-src`. Testado. |
| `electron/main.ts` | IPC `irisflow:secure-get/set/remove` (cofre `safeStorage`, arquivo `userData/cloud-store.json`, chaves `irisflow.*`, até 2 MB) e `irisflow:app-info`. Em dev, lê `VITE_SUPABASE_URL`/`VITE_DESKTOP_SYNC_URL` de `frontend/.env.local` para o cabeçalho de CSP. |
| `electron/preload.ts` | Expõe `window.irisflowCloud`. |
| `frontend/vite.config.ts` | A `<meta>` de CSP do build recebe as origens lidas do `.env` (`loadEnv`). O `__BUILD_ID__` de vocês continua. |
| `frontend/.env.example` | Variáveis novas documentadas. |

### Dependência nova

`@supabase/supabase-js` em `frontend/package.json`. Rode `npm --prefix frontend install` no PC
(o `package-lock.json` não foi gravado de volta — o `npm install` do Windows o atualiza).

Para o Modo Computador: `koffi` no `package.json` da **raiz** (`npm install`). Para a voz: Python
3.11 e `voice-engine/requirements.txt` (ver README).

### Modo Computador e voz personalizada — como se encaixam

Nenhum dos dois passa pela nuvem. Estão aqui porque compartilham a mesma regra de comunicação
interna do app (renderer sandboxed ⇄ processo principal por IPC validado) e porque a voz manda
um rótulo ao app do cuidador.

```
Modo Computador
  frontend/src/pages/VirtualMouseScreen.tsx ── useModoComputador() ── window.irisflowSystem.desktop
        │ (olhar do GazeContext, 30–60 Hz; dwell do app SUSPENSO)              │ IPC (preload.ts)
        ▼                                                                       ▼
  electron/computador/sessao.ts ── converte (src/computador/geometria.ts) ── sobreposição
        │ executa ações                                                         │ overlay.html
        ▼                                                                       ▼
  electron/computador/controle.ts → windows.ts (koffi/user32) | linux.ts   frontend/src/overlay/*
                                                                             (maquina.ts decide,
                                                                              Overlay.tsx desenha,
                                                                              overlayPreload.ts liga)

Voz personalizada
  telas → frontend/src/services/voz/falar()
             ├─ cache/geração: window.irisflowVoz.sintetizar → electron/voz/index.ts → sidecar.ts
             │                                                     └─ voice-engine/ (Python, Chatterbox)
             └─ reserva: services/voz/sistema.ts (speechSynthesis)
  CloudContext → `voice.status` → desktop-sync → patient_settings.voice → app do cuidador (Ajustes → Voz)
```

| Arquivo | Papel | Toque com cuidado |
| --- | --- | --- |
| `src/computador/protocolo.ts` | Lista fechada de ações, motivos de saída, canais IPC e validadores de forma. | Adicionar ação = adicionar aqui, no `executar` do `sessao.ts` e na `maquina.ts`. |
| `src/computador/geometria.ts` | janela → sobreposição → tela → físico; tamanho do cursor no sistema; lupa. | Tudo o que envolve DPI/multi-monitor. Testado. |
| `src/computador/entradaWindows.ts` | Structs `INPUT` e constantes do Win32. | Layout verificado (40 bytes em x64). |
| `electron/computador/sessao.ts` | Sessão: sobreposição, vigia (6 s sem olhar / 10 s sem calibração), atalho Ctrl+Alt+Shift+Esc, lupa via `desktopCapturer`, arrasto interpolado, mouse físico na barra. | Checa remetente de toda mensagem. |
| `frontend/src/overlay/maquina.ts` | Máquina "arma → olha → executa"; fixar; pausar; teclado; rolagem. | Puro e testado; mude aqui a UX do modo. |
| `frontend/src/overlay/Overlay.tsx` | Dwell com fixação (35 px), cursor/anel, barra, lupa, teclado. | Recebe config por push **e** por `pronto`. |
| `frontend/src/context/GazeContext.tsx` | `suspenderDwell(true/false)`: o dispatcher do app não clica enquanto a janela está oculta. | Sem isto o botão flutuante de emergência dispararia às cegas. |
| `src/voz/protocolo.ts` | Estado do motor, resultados, protocolo JSON do sidecar, `classificarReferencia` (espelhado em Python). | Mudou a regra de qualidade? Mude nos dois lados (testes cobrem). |
| `electron/voz/index.ts` | Pasta `userData/voz`, consentimento obrigatório, cache LRU 300 MB, `soCache`, sondagem só quando preciso. | Handlers só aceitam a janela do app. |
| `electron/voz/sidecar.ts` | Processo Python: fila de um pedido, timeouts, reinício (3 quedas), ocioso 15 min, UTF-8. | |
| `voice-engine/irisflow_voz/` | `audio.py` (preparo: SNR por percentis, ruído, 12 s), `motor.py` (Chatterbox, condicionais em cache, offline), `__main__.py` (protocolo). | `tests/` com dublê do modelo. |
| `frontend/src/services/voz/index.ts` | `falar()` cache-first com prazo de 2,5 s e "última vence"; gate por `plan.features.voz`. | Telas chamam só `falar`. |
| `frontend/src/pages/settings/VozScreen.tsx` | Termo de consentimento (texto em `TERMO_DE_CONSENTIMENTO`), download, importação, amostra, cache, remover. | |
| `frontend/src/services/license/types.ts` | `Plan.features` (novo, opcional) vem de `planoDe` no serviço real. | Ausente = liberado (mock/cache antigo). |

## 3. Fluxos, passo a passo

### 3.1 Primeira abertura com a nuvem configurada

1. `InitialSplash` → `bootDestination` → `/intro` → `/login` (fluxo do Bloco 1, inalterado).
2. `LoginScreen` → `useLicense().entrar(email, senha)` → `supabaseLicenseService.login`:
   1. `signInWithPassword` — erro vira `invalid-credentials`, `offline`, `server-down` ou `rate-limited`.
   2. `desktop_license()` — `allowed=false` ou conta sem paciente → `no-subscription` (+ `manageUrl`).
   3. Essencial com outro computador ativo → `device-limit` (lista + `transferToken`);
      a tela leva a `/activated` para confirmar a transferência.
   4. `pair_device(p_beneficiary_id, p_name, p_os, p_app_version, p_hostname=deviceId local)`
      → `ActiveLicense { token: device_key, account.beneficiaryId, plan }` e vínculo no cofre.
3. `LicenseContext` grava `irisflow_license` e vira `active` → `/activated` → `/consent` → `/profiles`
   (Bloco 1) e, em paralelo, o **`CloudProvider`** vê `active` + `token` e liga os serviços
   (`iniciarServicos`: conversa, ajustes, pendentes, `session.upsert`, realtime, fila).

### 3.2 Aberturas seguintes

`LicenseContext.verificar()` → `supabaseLicenseService.verify(token, deviceId)` →
`desktop-sync {device.info}`: computador ainda vinculado + licença do dono liberada → `active`;
sem rede → `unreachable` → `grace` por até 7 dias (`GraceBanner`); revogado/expirado → `blocked`
→ `/login`. O `CloudProvider` acompanha o status.

### 3.3 Mensagem do cuidador

Realtime `INSERT` em `messages` com `sender='cuidador'` → `receberDoCuidador(m)` → entra na lista,
`mostrarNaTela` (banner 15 s), `falar()` (TTS pt-BR), `message.spoken` → `naoFaladas` cai. Um
`Set` de ids em fala impede duplicata (realtime × polling). Se o realtime não estiver
`SUBSCRIBED`, um poll de 20 s chama `messages.pending`; o heartbeat também traz
`pending_messages`.

### 3.4 Fala do paciente

Tela → `emitirFalaDoPaciente(texto, kind)` → `CloudProvider` (evento `fala`) → aparece
imediatamente na conversa (id local) → `message.send` → id do servidor substitui o local.
Sem rede: fica na fila e sai quando a rede volta (`online` → `drenar()`).

### 3.4-b Voz do paciente

Tela → `falar(texto)` (`services/voz`) → se a voz clonada está pronta, ativa e liberada pelo
plano: `sintetizar(texto, {soCache})` → tocou; senão gera com prazo de 2,5 s (dentro: clonada;
fora: voz do sistema agora, geração termina para o cache). Em paralelo a tela emite
`emitirFalaDoPaciente` como antes — a nuvem recebe o texto, nunca o áudio. Mensagens do cuidador
e alarmes usam `falarComVozDoSistema` diretamente.

### 3.5 Emergência

`EmergencyEscalation.triggerAlert` → `emitirPedidoDeAjuda('emergencia', label)` →
`help.create {kind, message, session_id}` → a Edge Function grava `help_requests` e dispara o push
do Expo para o celular do cuidador (tela de emergência no app). Sem rede: fila, nunca descartado.

### 3.6 Calibração e teste de precisão

`CalibrationCheck` → ação `continue` → `emitirResultadoDeCalibracao` →
`calibration.result { session_id, calibration: camposDeCalibracao(), report: resumoDoRelatorio() }`
→ `sessions.calibration_*`, `precision_*`, `hit_rate_*`, `accuracy_report`, `calibration_at`;
`devices.calibrated = true`. O app do cuidador mostra em **Relatórios → sessão**.

### 3.7 Ajuste remoto

Cuidador muda "tempo de fixação" ou "suavização" no app → `patient_settings` → realtime →
`aplicarAjustesRemotos`: `dwell_ms` 800/1500/2500 → `updateSettings({dwellSpeed: fast/normal/slow})`;
`filter_preset` → `setFilterPreset('<preset>-v2')`. Só aplica quando `updated_at` mudou.

### 3.8 Sair / desvincular

`/conta` → "Sair desta máquina" (Bloco 1) → `LicenseContext.sair()` → `supabaseLicenseService.logout()`:
dispara `irisflow:cloud-antes-de-sair` (o CloudProvider fecha a sessão com `session.end` enquanto
a chave vale), `revoke_device`, `signOut`, apaga vínculo e fila; o LicenseContext zera a licença
e o provider desliga. Se o **cuidador** desvincular pelo celular ou pelo site, a Edge Function
devolve `403 device_revoked` → `aoPerderCredencial` → tudo limpo + `reverificar()` → `revoked` →
`/login`.

## 4. O que você pode mudar sem quebrar a comunicação

- **Pipeline / engine / calibração:** nada aqui depende de como o olhar é estimado. O único ponto
  de contato é `emitirResultadoDeCalibracao(result, meta, s)` em `CalibrationCheck`; se você mudar
  o formato de `AccuracyResult`, ajuste `frontend/src/cloud/sessao.ts` (e o teste
  `sessao.test.ts`) — e, se mudar as chaves do resumo, `AccuracySummary` no app do cuidador.
- **Telas do paciente:** pode redesenhar à vontade. Mantenha as chamadas `emitirFalaDoPaciente` /
  `emitirPedidoDeAjuda` onde a fala/socorro acontece. Novas telas que "falam" só precisam dessa
  linha.
- **Menu / rotas:** a conversa é `/conversation`; o banner navega para lá. Se renomear a rota,
  atualize `CloudBanners.tsx` e `MainMenu.tsx`.
- **Contrato com o banco:** qualquer mudança de coluna/ação exige mexer nos três lugares — este
  `desktopSync.ts`/`types.ts`, a Edge Function `desktop-sync` e a migração SQL. Os testes
  `desktopSync.test.ts` e `CloudContext.test.tsx` fixam os nomes atuais.
- **Regra de licença:** mora no banco (`license_for_profile()` / `desktop_license()`). O desktop
  só decide a tolerância offline (`LicenseContext`, 7 dias). Mudou a regra de negócio? Mude o SQL.
- **Modo Computador:** a UX (o que cada botão faz, prazos da lupa, rolagem) vive em
  `frontend/src/overlay/maquina.ts` + `Overlay.tsx`; o que o sistema aceita fazer vive em
  `src/computador/protocolo.ts` + `electron/computador/sessao.ts`. Trocar o pipeline de olhar não
  toca em nada disso: o hook só reassina `useGaze().subscribe`.
- **Voz:** trocar o modelo (outro TTS local) é reescrever `voice-engine/irisflow_voz/motor.py`
  mantendo os comandos `status` / `baixar_modelo` / `preparar_referencia` / `falar`; o Electron e
  as telas não mudam. Trocar por um serviço em nuvem seria outra implementação de
  `services/voz/local.ts` — mas aí o áudio de referência sairia do computador, e o termo de
  consentimento teria de dizer isso.
- **Contas de teste do mock** (`admin@irisflow.com` etc.) continuam valendo **sem** as variáveis
  da nuvem. Com elas, só contas criadas no site entram.

## 5. O que falta para ligar de verdade (checklist)

1. **Banco**: aplicar, nesta ordem, `SITE IRISFLOW V1/supabase/schema.sql` (já aplicado),
   `irisflow-cuidador/supabase/migrations/20260904_caregiver_app.sql` e
   `SITE IRISFLOW V1/supabase/migrations/20260908_integracao_ecossistema.sql`.
2. **Edge Function**: na pasta `irisflow-cuidador`, `supabase functions deploy desktop-sync`
   (o `config.toml` já desliga `verify_jwt`).
3. **Desktop**: `frontend/.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
   (os mesmos do site); `npm --prefix frontend install`; `npm --prefix frontend run build`
   (a CSP do build passa a incluir a origem).
4. **Conta de teste**: crie pelo site (cadastro → avaliação). O mesmo e-mail/senha entra no desktop
   e no app do cuidador.
5. **Push** (opcional agora): `eas init` no app do cuidador para o socorro chegar como notificação.
6. **Modo Computador**: `npm install` na raiz (instala o `koffi`); rodar `npm run electron:dev`,
   calibrar, abrir Computador → Ativar; conferir num monitor com escala 125/150 % que o clique cai
   onde o olhar está (lupa ligada) e que Ctrl+Alt+Shift+Esc e o mouse físico na barra encerram.
7. **Voz**: Python 3.11 → `pip install -r voice-engine/requirements.txt` (num `.venv` dentro de
   `voice-engine/`) → Configurações → Voz personalizada → Baixar o modelo → Importar áudio (com
   o termo) → Ouvir amostra. Para o instalador: `voice-engine\build-voice-engine.ps1` antes de
   `npm run electron:build`. A síntese real com o modelo **não foi executada aqui** (o ambiente de
   desenvolvimento não alcança o Hugging Face); o preparo do áudio foi testado com as três
   gravações enviadas e o restante do fluxo com um dublê do modelo.
8. **Edge Function**: reimplantar `desktop-sync` (ganhou a ação `voice.status`).

## 6. Verificação feita

- Modo Computador e voz (9/set): `tsc` do Electron, `tsc -b` e lint da interface, **744 testes em
  87 arquivos** (novos: geometria e structs Win32, protocolo da voz, máquina da sobreposição e
  sobreposição de ponta a ponta, hook do modo, `falar()` com cache/prazo/substituição, tela de Voz),
  `vite build` com as duas páginas (`index.html` e `overlay.html`, CSP em ambas), 9 testes Python do
  motor (dublê do modelo) e o preparo real dos três áudios de teste. Revisão independente com 21
  achados, todos tratados (dwell do app suspenso no modo, saída por vigia/atalho/mouse físico,
  UTF-8 no sidecar, prazo da voz, `voice.status` sem criar linha com defaults, motor sondado só
  quando preciso, offline do Hugging Face, lupa por monitor, arrasto interpolado, entre outros).

- Sobre o estado do projeto de 8/set (Blocos 1–5 incluídos): lint 0 erros, `tsc -b`, **704 testes
  em 82 arquivos** (novos: 13 do `supabaseLicenseService`, 22 da camada cloud, 5 da conversa),
  `vite build` (CSP conferida com e sem `VITE_SUPABASE_URL`), `tsc` do Electron, testes do núcleo.
- SQL testado num PostgreSQL 16 limpo com shim de `auth.uid()`: cadastro → licença → pareamento
  (Essencial revoga o anterior) → hash da chave confere → revogação → pagamento pago/falho →
  carência → `register_charge` proibido para `authenticated`.
- Revisão independente cruzando os três projetos; os 18 achados foram corrigidos (JWT anônimo no
  gateway, preset `-v2`, licença fresca prevalece, retry do webhook, upsert de sessão escopado,
  canal realtime único, fala sem duplicata, sessão reaberta ao voltar a rede, fila limpa ao sair,
  `quick_phrases` no realtime, entre outros).
