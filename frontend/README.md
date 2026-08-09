# IrisGazer — Frontend

Plataforma assistiva de comunicação por rastreamento ocular (Eye Tracking) para pessoas com ELA, paralisia ou outras condições que limitam a comunicação verbal.

Este repositório contém o **frontend em React + TypeScript + Vite**, que consome um backend Python via HTTP e WebSocket (para dados de rastreamento ocular em tempo real).

## Stack

- **React 19** + **TypeScript** (strict)
- **Vite** (bundler, dev server)
- **React Router v7**
- **Tailwind CSS v4** + glassmorphism customizado
- **Lucide React** (ícones)
- **Vitest** + **Testing Library** (testes)
- **Oxlint** (linting)

## Requisitos

- Node.js 20+ e npm
- Backend IrisGazer rodando (HTTP + WebSocket) — opcional para desenvolvimento das telas

## Setup

```bash
npm install
cp .env.example .env      # ajuste as URLs se o backend rodar em outra porta
npm run dev
```

O dev server sobe em `http://localhost:5173` por padrão.

## Variáveis de ambiente

Todas prefixadas com `VITE_` (exigência do Vite) — ver `.env.example`.

| Variável | Descrição | Default |
| --- | --- | --- |
| `VITE_API_URL` | URL base da API HTTP | `http://localhost:8000/api` |
| `VITE_WS_URL` | URL do WebSocket de gaze data | `ws://localhost:8000/ws/tracker` |
| `VITE_CAREGIVER_PIN` | PIN de acesso ao painel do cuidador (**temporário — mover para backend antes de produção**) | `1234` |

## Scripts

| Comando | Ação |
| --- | --- |
| `npm run dev` | Sobe o dev server com HMR |
| `npm run build` | Type-check + build de produção |
| `npm run preview` | Serve o build local |
| `npm run lint` | Oxlint |
| `npm run type-check` | Só type-check (sem emitir) |
| `npm test` | Roda testes uma vez |
| `npm run test:watch` | Testes em modo watch |

## Estrutura

```
src/
├── App.tsx                # Roteamento + Providers + Suspense/Lazy
├── main.tsx               # Bootstrap + ErrorBoundary
├── config/env.ts          # Leitura de VITE_*
├── components/
│   ├── ErrorBoundary.tsx  # Captura erros de render
│   ├── DwellButton.tsx    # Botão com progresso de dwell (eye tracking)
│   ├── TTSButton.tsx      # Text-to-Speech (Web Speech API)
│   └── ui/                # PageHeader, PrimaryButton, BackButton, Card, ProtectedRoute
├── context/
│   ├── AuthContext.tsx      # Perfil ativo, cuidador, token, persistência
│   ├── SettingsContext.tsx  # Preferências do usuário (persistidas)
│   └── WebSocketContext.tsx # Conexão eye tracking com auto-reconnect
├── pages/                 # Uma pasta por domínio (auth, ai, caregiver, games, etc.)
├── utils/api.ts           # apiFetch (timeout, retry, ApiError) + endpoints tipados
└── test/setup.ts          # Setup do Vitest
```

## Roteamento

Rotas públicas: `/`, `/login`, `/tutorial`, `/profiles`.
Todas as demais são protegidas por `ProtectedRoute` — redirecionam para `/login` se não houver perfil ativo.

## Acessibilidade

- Foco visível global via `:focus-visible`
- `aria-*` em componentes interativos, `role`s semânticos (tablist, radiogroup, grid, alert, status)
- Skip link para conteúdo principal no MainMenu
- Respeita `prefers-reduced-motion`
- Textos alt em imagens, labels em inputs
- `DwellButton` fornece feedback visual de progresso (conic-gradient) respeitando `SettingsContext.dwellSpeed`

## Segurança — pendências para produção

1. **Autenticação real**: o PIN do cuidador é temporário via env var; deve migrar para backend com hash + JWT. O `AuthContext` já expõe `authToken` para preparar essa transição.
2. **HTTPS/WSS**: env vars usam `http://`/`ws://` em dev; usar `https://`/`wss://` em produção.
3. **XSS**: respostas do chatbot são inseridas como texto (React já escapa). Ao adicionar renderização Markdown, sanitizar com DOMPurify.
4. **LGPD**: a clonagem de voz é dado biométrico — política de retenção deve ser tratada no backend.

### `npm audit` — CVEs abertas conhecidas

- **`react-router` GHSA-qwww-vcr4-c8h2** (high) — CSRF bypass no **RSC mode**. **Não se aplica a este projeto**: rodamos CSR puro com Vite; RSC não é usado. Sem versão patch disponível ainda (range vulnerável: 7.12.0–8.2.0, sem release posterior). Reavaliar quando o time do react-router publicar fix.
- Auditoria de produção (`npm audit --omit=dev --audit-level=critical`) roda na CI e não bloqueia por essa CVE específica.

## Backend esperado

Endpoints consumidos por `src/utils/api.ts`:

- `POST /voice/clone` — multipart com arquivo de áudio
- `GET  /voice/status/:taskId`
- `POST /voice/synthesize`
- `POST /alerts/help` — usado por `EmergencyEscalation`
- `POST /alerts/iamok` — usado por `IAmOkScreen`
- `POST /chatbot/message` — usado por `ChatbotScreen`
- `POST /smart-home/action`
- WebSocket em `/ws/tracker` — envia `{ type: 'gaze_data', x, y }`

## Testes

Cobertura inicial em `AuthContext`, `SettingsContext` e `apiFetch`. Expandir para páginas críticas (Emergency, Keyboard) conforme o projeto amadurece.

## Contribuindo

- Antes de commitar: `npm run lint && npm run type-check && npm test`
- Convenção de commits: mensagem curta em português no imperativo (padrão do repositório)
