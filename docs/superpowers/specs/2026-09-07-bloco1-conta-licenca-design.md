# Bloco 1 — Primeira abertura: conta, licença e consentimento

**Data:** 2026-09-07
**Escopo:** frontend (`frontend/src/`) apenas.
**Fora de escopo, intocável:** `src/` (pipeline de gaze), `electron/`, `GazeContext`,
calibração, `qualityAnalyzer`, `ridge`.

---

## 1. O problema

A primeira abertura do app hoje não existe como produto. O que há:

- `InitialSplash` é uma tela de marketing com dois botões ("Vamos começar?" e
  "Modo Desenvolvedor"). Não verifica nada.
- `LoginScreen` aceita qualquer e-mail e qualquer senha não-vazia e navega para
  `/tutorial`. Não há conta, não há licença, não há erro possível além de
  "campo vazio".
- `ProfileSelect` lista três perfis mock cravados no código
  (`Paciente A/B/C`) e a rota `/profiles` é órfã: nada navega para ela.
- `ProtectedRoute.tsx` existe e **não é usado**. O `App.tsx` define um
  `Protected` local que é literalmente `({ children }) => <>{children}</>`.
  Toda rota "protegida" é pública.
- Não há consentimento, não há vínculo de dispositivo, não há noção de plano.

O produto é vendido por assinatura, com contas criadas num site. O app precisa
saber de quem é a licença, se está paga, e a que computador está vinculada.

## 2. Premissas do domínio

Duas premissas moldam todas as decisões abaixo:

1. **O usuário final tem ELA/ALS.** Ele não digita, não mexe a cabeça, e muitas
   vezes está sozinho. Qualquer tela que o bloqueie sem saída é uma falha de
   segurança, não de UX. Quem opera o Bloco 1 é o **cuidador**, com teclado e
   mouse — este é o único momento do app onde isso vale.
2. **Privacidade é argumento de venda.** Imagem de câmera e dados de calibração
   nunca saem da máquina. Só as credenciais vão ao servidor. O termo de
   consentimento promete isso, então a arquitetura precisa cumprir.

## 3. Decisões

| # | Decisão | Razão |
|---|---|---|
| D1 | Contexto novo `LicenseContext`; nada de conta ou licença entra no `AuthContext` | Domínios distintos: conta/licença é remoto, perfil/PIN é local. O `AuthContext` muda só onde §4.4 descreve (perfis locais reais no lugar dos três mocks) e seu teste continua verde. |
| D2 | `LicenseService` como interface; só o mock é implementado agora | O backend tem apenas banco. Um adapter HTTP contra servidor inexistente seria a 6ª ocorrência do padrão "módulo pronto sem fio" já registrado no projeto. |
| D3 | Resultados em união discriminada, não `throw` | Cada motivo de falha tem tela e CTA próprios. `catch` + `instanceof` espalharia essa decisão pelos componentes. |
| D4 | Device ID = UUID em `localStorage`, gerado no primeiro boot | Não tocar em `electron/`. Limitação conhecida — ver §9. |
| D5 | Grace period offline de 7 dias | Perder comunicação por queda de Wi-Fi é inaceitável para o público-alvo. |
| D6 | Consentimento **antes** do cadastro de perfil | Explicar o destino dos dados antes de pedir nome e foto do paciente. |
| D7 | Modo Desenvolvedor mantido, visível | Pedido explícito: economiza tempo ao inspecionar o estado do produto. Ver §9 para a pendência de lançamento. |
| D8 | Perfis 100% locais, nunca enviados | Cumpre a promessa do termo (premissa 2). Só login/conta trafega. |
| D9 | Telas novas em i18n (pt-BR + en) desde o início | A tela de boas-vindas oferece escolha de idioma; sem tradução o botão é decorativo. Telas antigas ficam como estão. |
| D10 | Sem tela de cadastro no app; `/login` linka para o site | O cadastro é do site ("o mesmo do site"). Bloco 1 tem seis telas, não sete. |
| D11 | `deviceLimit` vem do payload do plano | O limite depende do plano assinado. Hoje o mock manda `1`; a tela se adapta a 2+ ou `null` sem mudança de código. |

## 4. Arquitetura

```
frontend/src/
  services/license/
    types.ts               contrato: Account, Plan, ActiveLicense, LoginResult, LicenseService
    deviceId.ts            UUID estável em localStorage + nome legível da máquina
    mockLicenseService.ts  implementação de teste, cobre todos os estados
    index.ts               seleciona a implementação (hoje só 'mock')
  context/
    LicenseContext.tsx     estado de boot, persistência, grace period
  pages/onboarding/
    InitialSplash.tsx      (reescrita) splash + verificação
    IntroScreen.tsx        (nova) boas-vindas + idioma
    ConsentScreen.tsx      (nova) termo + checkbox
  pages/auth/
    LoginScreen.tsx        (reescrita) 5 estados de erro
    ActivatedScreen.tsx    (nova) plano, validade, vínculo, transferência
    ProfileSelect.tsx      (reescrita) perfis locais reais + criação
  components/ui/
    ProtectedRoute.tsx     (ligado de verdade, substitui o `Protected` no-op)
```

### 4.1 Contrato — `services/license/types.ts`

```ts
export interface Account {
  email: string;
  name?: string;
}

export interface Plan {
  id: string;
  name: string;               // "IrisFlow Familiar"
  validUntil: string | null;  // ISO 8601; null = vitalício
  deviceLimit: number | null; // null = sem limite
}

export interface DeviceBinding {
  deviceId: string;
  deviceName: string;         // "PC do Gabriel — Windows"
  boundAt: string;            // ISO 8601
}

export interface ActiveLicense {
  account: Account;
  plan: Plan;
  token: string;
  devicesUsed: number;
  thisDevice: DeviceBinding;
}

export type LoginFailure =
  | { reason: 'invalid-credentials' }
  | { reason: 'no-subscription'; account: Account; manageUrl: string }
  | { reason: 'device-limit'; account: Account; plan: Plan; devices: DeviceBinding[] }
  | { reason: 'offline' }
  | { reason: 'server-down' }
  | { reason: 'rate-limited'; retryAfterSeconds: number };

export type LoginResult =
  | { ok: true; license: ActiveLicense }
  | ({ ok: false } & LoginFailure);

export type VerifyResult =
  | { ok: true; license: ActiveLicense }
  | { ok: false; reason: 'expired' | 'revoked' | 'device-unbound' | 'invalid-token' }
  | { ok: false; reason: 'unreachable' };  // rede — dispara o grace period

export interface LicenseService {
  login(email: string, password: string, device: DeviceBinding): Promise<LoginResult>;
  verify(token: string, deviceId: string): Promise<VerifyResult>;
  transferDevice(token: string, device: DeviceBinding): Promise<LoginResult>;
  logout(token: string): Promise<void>;
}
```

`unreachable` é separado dos demais motivos de `verify` de propósito: só ele
aciona o grace period. `expired` e `revoked` são respostas do servidor e
bloqueiam de imediato.

### 4.2 Contrato HTTP (documentado, **não implementado agora**)

Quando o backend existir, o adapter implementa `LicenseService` sobre estes
endpoints, usando o `apiFetch` que já existe em `utils/api.ts`:

| Método | Rota | Corpo | Respostas |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password, device }` | `200` licença · `401` credencial · `402` sem assinatura + `{ manageUrl }` · `409` limite + `{ devices }` · `429` + `Retry-After` |
| POST | `/auth/verify` | `{ token, deviceId }` | `200` licença · `401` token inválido · `403` + `{ code: expired \| revoked \| device-unbound }` |
| POST | `/auth/device/transfer` | `{ token, device }` | igual ao login |
| POST | `/auth/logout` | `{ token }` | `204` |

Falha de rede ou timeout do `apiFetch` mapeia para `offline`; `5xx` mapeia para
`server-down`.

### 4.3 `LicenseContext`

Persistência em `localStorage`, chave `irisflow_license`:

```ts
{ account, plan, token, deviceId, boundAt, lastVerifiedAt }
```

Estado exposto:

```ts
type LicenseStatus =
  | 'checking'   // boot em andamento
  | 'active'     // verificada agora
  | 'grace'      // não verificou, mas o cache ainda vale (< 7 dias)
  | 'none'       // nunca ativou
  | 'blocked';   // expirou, foi revogada, ou o grace estourou
```

Ações: `login`, `transferDevice`, `logout`, `recheck`.

**Regra do grace period.** No boot, se `verify` devolve `unreachable`:
`Date.now() - lastVerifiedAt < 7 dias` → `grace` (app libera, com aviso
discreto e persistente). Caso contrário → `blocked`, com a tela explicando que
é preciso conectar à internet uma vez.

### 4.4 Consentimento e perfis

Duas chaves de `localStorage`, ambas locais e nunca enviadas:

- `irisflow_consent` → `{ version: 1, acceptedAt: ISO, acceptedByEmail }`.
  A `version` existe para que uma futura mudança de texto force nova aceitação.
- `irisflow_profiles` → `Profile[]` com
  `{ id, name, age?, condition?, avatarDataUrl?, createdAt }`.
  A foto vira data URL redimensionada (máx. 256 px) — nunca um caminho de
  arquivo, que quebraria ao mover a imagem.

O `Profile` do `AuthContext` ganha os campos opcionais `age`, `condition`,
`createdAt`. Campos opcionais não quebram o contexto nem seus testes; a lista
`mockProfiles` cravada some, substituída pela leitura de `irisflow_profiles`.

## 5. Fluxo

```
                    ┌──────────────┐
   boot ───────────▶│  /  splash   │  verifica licença (1–2,5 s)
                    └──────┬───────┘
             active/grace  │  none/blocked
                ┌──────────┴──────────┐
                ▼                     ▼
        consentimento?          já viu o intro?
          não │ sim              não │ sim
              ▼   ▼                  ▼   ▼
        /consent  perfil?         /intro  /login
                  não │ sim          │
                      ▼   ▼          ▼
              /profiles  /menu    /login ─▶ /activated ─▶ /consent ─▶ /profiles
```

Cada passo do caminho feliz avança sozinho; o splash só decide o **primeiro**
destino. Uma vez ativado, reabrir o app cai direto no `/menu`.

## 6. Telas

### 6.1 `/` — Splash / verificação
Logo, texto "verificando licença", indicador de progresso. Piso de 1 s (evita o
flash) e teto de 2,5 s (depois disso, segue pelo caminho do grace period).
Mantém o botão Modo Desenvolvedor, que grava `irisflow_dev_mode` em
`sessionStorage` e vai direto ao `/menu`, como hoje.

### 6.2 `/intro` — Boas-vindas
Rota nova: `/welcome` já existe e é outra coisa (transição de 5 s pós-login).
Uma tela: o produto em uma frase, os dois papéis (paciente usa com o olhar,
cuidador configura), o `LanguageSwitcher` que já existe, botão "Começar".
Grava `irisflow_intro_seen` para não repetir.

### 6.3 `/login` — Login / ativação
E-mail + senha. Os cinco estados existem de verdade, cada um com CTA próprio:

| Estado | Mensagem | CTA |
|---|---|---|
| `invalid-credentials` | E-mail ou senha incorretos | "Esqueci minha senha" → site |
| `no-subscription` | Conta sem assinatura ativa | "Gerenciar assinatura no site" → `manageUrl` |
| `device-limit` | Já ativada em outro computador | "Transferir para este" → `/activated` |
| `offline` | Sem conexão | "Tentar de novo" |
| `server-down` | Servidor indisponível | "Tentar de novo" + horário da tentativa |
| `rate-limited` | Tentativas demais | "Tentar de novo" desabilitado, com contagem regressiva de `retryAfterSeconds` |

Rodapé com "Criar conta" → site. Erro em `role="alert"`; botão em estado
`loading` com `aria-busy`; nunca dois envios simultâneos.

### 6.4 `/activated` — Dispositivo vinculado
Nome do plano, validade por extenso ("válida até 14 de março de 2027"),
`deviceName` e a frase "este computador foi vinculado à sua conta". Quando
`deviceLimit` > 1, mostra "1 de 2 dispositivos". Na variante de transferência,
lista a máquina atualmente ativa e pede confirmação explícita antes de
derrubá-la.

### 6.5 `/consent` — Termo de privacidade
Texto curto e direto: as imagens da câmera e a calibração nunca saem deste
computador; só o login vai ao servidor. Checkbox obrigatório — o botão de
avançar fica `disabled` até marcar. Grava versão e data.

### 6.6 `/profiles` — Perfil do paciente
Lista os perfis locais e um cartão "Novo paciente" que abre o formulário: nome
(obrigatório), idade (opcional), condição (opcional, com "prefiro não
informar"), foto (opcional, via `<input type="file">` local). Selecionar um
perfil navega para `/calibration-check`, como já faz hoje.

## 7. Portão de rotas

`ProtectedRoute` passa a ser usado no lugar do `Protected` no-op do `App.tsx`.
Ordem de verificação, com `<Navigate replace>`:

1. `irisflow_dev_mode` ativo → passa direto (D7).
2. licença `checking` → tela de carregamento.
3. licença `none` ou `blocked` → `/login`.
4. consentimento ausente → `/consent`.
5. perfil não selecionado → `/profiles`.
6. `requireCaregiver` e não é cuidador → `/menu` (comportamento atual).

## 8. Testes

TDD: cada arquivo abaixo é escrito antes da implementação correspondente.

| Arquivo | Cobre |
|---|---|
| `services/license/mockLicenseService.test.ts` | os seis motivos de falha e o caminho feliz |
| `services/license/deviceId.test.ts` | estabilidade entre chamadas; geração quando o storage está vazio |
| `context/LicenseContext.test.tsx` | boot, persistência, **grace period nas bordas de 7 dias**, `blocked` após estouro |
| `pages/onboarding/InitialSplash.test.tsx` | destino escolhido para cada estado; piso e teto de tempo |
| `pages/auth/LoginScreen.test.tsx` | cada estado renderiza a mensagem e o CTA certos; sem envio duplo |
| `pages/auth/ActivatedScreen.test.tsx` | plano/validade; confirmação explícita na transferência |
| `pages/onboarding/ConsentScreen.test.tsx` | não avança sem o checkbox; grava versão e data |
| `pages/auth/ProfileSelect.test.tsx` | criar, listar, persistir, selecionar |
| `components/ui/ProtectedRoute.test.tsx` | a ordem de redirecionamento do §7, incluindo o bypass de dev |

Comando de verificação: `cd frontend && npm run verify`
(`lint` + `type-check` + `test` + `build`).

Duas armadilhas já registradas no projeto e que valem aqui:
`tsc --noEmit -p frontend/tsconfig.json` sai 0 sempre — usar `npm run type-check`;
e um `throw` dentro de listener do DOM derruba o Vitest com exit 1 mesmo com
todos os testes verdes.

## 9. Limitações conhecidas

Registradas de propósito, não são descuidos:

1. **Device ID é apagável.** Limpar os dados do app faz o mesmo PC parecer outro
   e consome uma ativação. A correção é o machine GUID via IPC do Electron, que
   está fora do escopo deste bloco (D4).
2. **Modo Desenvolvedor pula a licença.** Mantido a pedido (D7). **Pendência de
   lançamento:** remover, ou condicionar a `import.meta.env.DEV`, antes de
   qualquer build distribuído.
3. **Senha trafega para o mock em memória.** Nada é persistido, mas o adapter
   real precisa de HTTPS obrigatório — a ser afirmado por teste quando o adapter
   existir.
4. **`services/license/index.ts` só tem uma implementação.** Assumido: é o ponto
   de troca projetado (D2), não um módulo órfão.

---

## 10. Desvios da implementação

Cinco pontos em que o código ficou diferente do desenho acima. Registrados aqui
porque o spec é o documento de referência, e um spec que mente é pior que
nenhum.

1. **`transferToken` no contrato (§4.1).** O desenho tinha
   `transferDevice(token, device)`, mas em `device-limit` o login *falhou* —
   não existe token de sessão. A falha passou a carregar um `transferToken` de
   curta duração. Sem ele, ou `transferDevice` pediria a senha de novo, ou
   aceitaria transferir o vínculo de quem só conhece um `deviceId`.

2. **Links externos não funcionam no app empacotado.** O `electron/main.ts`
   nega toda abertura de janela (`setWindowOpenHandler` → `deny`) e filtra
   `will-navigate`. Os links "Gerenciar assinatura", "Esqueci minha senha" e
   "Criar conta" são âncoras corretas, mas **não abrem nada** no Electron. A
   tela mostra a URL como texto selecionável ao lado, para não virar botão
   morto. A correção é `shell.openExternal` no processo principal — fora do
   escopo, que proibia tocar no back.

3. **O teto de 2,5 s do splash saiu.** Um teto na tela significaria navegar sem
   saber o estado da licença, e não há destino correto nessa situação. O limite
   de tempo pertence à camada de serviço (`apiFetch` já tem `timeoutMs`), onde
   um estouro vira `unreachable` e o período de tolerância decide. O splash
   ficou só com o piso de 900 ms, contra o efeito de piscar.

4. **`GraceBanner` como componente.** O §4.3 falava em "aviso discreto" sem
   nomear onde. Virou `components/ui/GraceBanner.tsx`, montado uma vez no
   `App.tsx`, com `pointer-events: none` para não atravessar a comunicação do
   paciente.

5. **Modo Desenvolvedor pelo módulo `devMode`.** O splash antigo gravava
   `irisflow_dev_mode` direto no `sessionStorage`, o que não dispara o evento
   que o `GazeContext` escuta — o cursor de gaze continuava ligado no modo
   desenvolvedor. Agora usa `setDevMode()`, que já existia.

6. **As telas nasceram no tema errado.** O tema padrão do app é o **escuro**
   (`SettingsContext`: `theme: 'dark'`), e as seis telas foram construídas com
   fundo claro cravado — inclusive sobrescrevendo, inline, o `background` que a
   própria classe `.glass-card` já aplicava pelo token. Com texto em
   `var(--color-text-base)`, que no escuro vira `#f8fafc`, o resultado era
   título branco sobre cartão branco: texto invisível, não apenas apagado.
   Corrigido usando `--settings-bg`, `--color-card-bg` e tokens novos de tinta
   (`--tint-ok/warn/danger/info-*`) e de campo (`--field-bg`, `--field-border`),
   definidos nos dois temas em `index.css`. `pages/temaEscuro.test.tsx` varre o
   código-fonte das sete telas e falha se qualquer cor só-clara voltar — varre a
   fonte, e não a árvore renderizada, porque metade das cores vive em ramos que
   o estado padrão não monta.

7. **`LOGIN_PADRAO` — conta de acesso ao produto.** `admin@irisflow.com` /
   `irisflow2026`, plano sem vencimento e sem limite de máquina. Serve para
   percorrer o fluxo **real** (splash → login → ativação → termo → perfil), ao
   contrário do Modo Desenvolvedor, que o pula. **Pendência de lançamento junto
   com o Modo Desenvolvedor:** é credencial fixa no código do cliente e sai
   antes de qualquer build distribuído.
