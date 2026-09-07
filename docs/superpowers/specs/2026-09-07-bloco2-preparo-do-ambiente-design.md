# Bloco 2 — Preparo do ambiente

**Data:** 2026-09-07
**Escopo:** frontend (`frontend/src/`) apenas.
**Fora de escopo, intocável:** `src/` (pipeline de gaze), `electron/`.

---

## 1. O achado que reorganiza o bloco

O pedido descreve cinco telas de medição. A maior parte da medição **já
existe e já é testada** — o que falta é chegar ao cuidador.

`src/setupReadiness.ts` avalia hoje, com limiares próprios e testes:

| CheckId | Cobre |
|---|---|
| `face` | rosto detectado, confiança do detector |
| `distance` | distância olho→câmera, via fração da distância cantal |
| `centering` | rosto centralizado no frame |
| `headPose` | yaw/pitch da cabeça |
| `lighting` | brilho médio do recorte do olho |
| `contrast` | desvio-padrão da luminância |
| `glasses` | reflexo especular persistente em lente |
| `flicker` | cintilação de rede (50/60 Hz) |
| `resolution` | resolução do vídeo |
| `viewport` | janela do app não-maximizada |
| `distanceRange` | desvio em relação à distância de calibração |

Isso é o passo 3 e o passo 4 inteiros. O `ReadinessPanel` já renderiza esse
relatório — mas só é montado dentro do `CalibrationCheck`.

E `components/ui/FramingIndicator.tsx` está **órfão**: nada no app o importa.
É a sexta ocorrência do padrão "módulo pronto sem fio" registrado no projeto.

**Consequência para o desenho:** os passos 3 e 4 não escrevem medição nova.
Consomem `evaluateReadiness` e `snapshotFromDiagnostics`, e apresentam. Escrever
um segundo avaliador de iluminação ao lado do que já existe criaria dois
limiares para a mesma pergunta, divergindo no primeiro ajuste.

**O que de fato não existe:**

- Enumeração e escolha de câmera. Não há `enumerateDevices` em lugar nenhum.
- Medição de FPS. Nenhuma checagem de taxa de quadros no projeto.
- Tela de permissão de câmera.
- Campo de lux com onde ser preenchido.

## 2. Premissas

Herdadas do Bloco 1 e igualmente vinculantes:

1. **O usuário final tem ELA/ALS.** Nenhuma tela pode bloquear sem saída. Quem
   opera o preparo é o cuidador, com mouse e teclado.
2. **Nada de imagem sai da máquina.** O preview e as métricas vivem no
   renderer; o que se persiste são números e preferências, em `localStorage`.

## 3. Decisões

| # | Decisão | Razão |
|---|---|---|
| D1 | Wizard de 5 passos numa rota só (`/setup`) | Os passos 2–4 precisam da câmera viva. Cinco rotas remontariam o componente e reiniciariam o stream a cada passo — segundos de tela preta num fluxo cujo objetivo é medir estabilidade. |
| D2 | Passos 3 e 4 consomem `evaluateReadiness`; não reimplementam | Um segundo avaliador divergiria do primeiro no primeiro ajuste de limiar. |
| D3 | FPS medido por contagem de frames, não por `getSettings().frameRate` | O `frameRate` é o que a webcam alega. A contagem é o que ela entrega — e é essa que degrada o pipeline. |
| D4 | FPS baixo avisa, nunca bloqueia | Negar comunicação a alguém com ELA porque a webcam é barata é pior do que precisão ruim. |
| D5 | "Continuar" no passo 3 exige 3 s contínuos em verde | Sem a janela, o cuidador clica no instante de sorte e a calibração começa fora de posição. O contador zera ao piscar para amarelo. |
| D6 | Lux é opcional e nunca bloqueia | Exigir luxímetro para usar o produto é absurdo. Ver §7 sobre o que isso custa. |
| D7 | Roda 1× por perfil; atalho nas Configurações | O cuidador não refaz cinco telas todo dia. Trocar de sala ou de webcam é o caso de refazer. |
| D8 | O portão fica só em `/calibration-check` | O menu continua alcançável. Bloquear o app inteiro por preparo incompleto contradiz a premissa 1. |
| D9 | `FramingIndicator` órfão é ligado no passo 3 | Já existe, já faz o que o passo precisa. |

## 4. Arquitetura

```
frontend/src/
  pages/setup/
    SetupWizard.tsx              rota /setup — dona do passo e do stream
    passos.ts                    ordem, títulos e a regra de "pode avançar"
    steps/PermissaoCamera.tsx
    steps/EscolhaDaCamera.tsx
    steps/Posicionamento.tsx
    steps/Iluminacao.tsx
    steps/VerificacaoDoMonitor.tsx
  services/camera/
    devices.ts                   enumerar câmeras; medir FPS e resolução reais
  services/local/
    setupProfile.ts              persistência por perfil
  components/ui/
    Semaforo.tsx                 verde/amarelo/vermelho a partir de CheckStatus
```

### 4.1 De onde vêm os dados

Tudo alcançável sem tocar no pipeline:

- `useGaze().getCameraStream()` → `MediaStream` para o preview.
- `useGaze().getDiagnostics()` → `EngineDiagnostics`.
- `snapshotFromDiagnostics(diag, lerViewport())` → `ReadinessSnapshot`.
- `evaluateReadiness(snap, ctx)` → `ReadinessReport` com os 11 checks.
- `getCurrentCameraDistanceCm()` (via `@tracker/calibration`) → distância em cm.
- `window.irisflowSystem.getMonitorSizes()` → EDID, já lido pelo `SettingsContext`.

Amostragem a 2 Hz, como o `ReadinessPanel` faz — a 30 Hz os textos piscam e
ninguém lê. O `FramingIndicator` mantém os seus 10 Hz, porque é desenho e não
texto.

### 4.2 `services/camera/devices.ts`

```ts
export interface CameraDevice {
  deviceId: string;
  label: string;      // vazio antes da permissão; o navegador esconde
}

export interface CameraCapacidade {
  larguraPx: number;
  alturaPx: number;
  /** Medido contando frames, não o que o track alega. */
  fpsMedido: number;
  /** O que a webcam alega, para comparação. `null` quando não informa. */
  fpsDeclarado: number | null;
}

export type QualidadeDeFps = 'boa' | 'baixa' | 'ruim';

export function listarCameras(): Promise<CameraDevice[]>;
export function medirCapacidade(deviceId: string, ms?: number): Promise<CameraCapacidade>;
export function classificarFps(fps: number): QualidadeDeFps;
```

Limiares: `>= 24` boa, `>= 15` baixa, abaixo disso ruim. O pipeline assume 30
fps em vários pontos (o detector de flicker, as janelas de baseline da
calibração); a 15 fps toda janela temporal vale metade dos quadros.

`medirCapacidade` conta frames por ~3 s usando
`requestVideoFrameCallback` quando disponível, com queda para `requestAnimationFrame`
mais comparação de `currentTime` — em `rAF` puro a contagem satura no refresh
do monitor e uma webcam de 15 fps mediria 60.

### 4.3 `services/local/setupProfile.ts`

`localStorage`, chave `irisflow_setup_<profileId>`:

```ts
interface PreparoDoPerfil {
  version: number;          // sobe quando os passos mudam e o preparo precisa ser refeito
  completedAt: string;      // ISO 8601
  cameraDeviceId: string | null;
  fpsMedido: number | null;
  luxAmbiente: number | null;
  monitorDiagonalIn: number | null;
  monitorOrigem: 'edid' | 'manual';
}
```

Por perfil, e não global: dois pacientes na mesma casa podem usar o mesmo PC em
salas diferentes, com luz diferente.

### 4.4 Fluxo entre passos

```
1 Permissão ─▶ 2 Câmera ─▶ 3 Posicionamento ─▶ 4 Iluminação ─▶ 5 Monitor ─▶ /calibration-check
```

Voltar é livre. Avançar tem regra por passo (§5). O stream abre no passo 1 e
vive até o wizard desmontar.

## 5. Os cinco passos

### 5.1 Permissão de câmera

Explica **antes** do prompt: para onde a imagem vai (lugar nenhum), por que é
necessária, e que o paciente não precisa fazer nada ainda.

Uma peculiaridade do Electron que muda esta tela: o processo principal já
concede `media` para origem local (`setPermissionRequestHandler` →
`permitirPermissao`). **O prompt do navegador não aparece.** Quando a câmera
falha aqui, quem está bloqueando é a privacidade do Windows, não o app.

Então a tela tem três estados: explicando, concedida, e negada-pelo-sistema —
esta última com o caminho literal (Configurações → Privacidade → Câmera) como
**texto**, não como botão. Ver §7.

### 5.2 Escolha da câmera

Lista os `videoinput` de `enumerateDevices`, com preview ao vivo do dispositivo
selecionado. Para o escolhido mostra resolução e FPS medido, com o veredito de
`classificarFps`.

Quando há uma câmera só, a tela ainda aparece — é onde o FPS é medido, e essa é
a informação que o pedido quer entregar "antes, não no relatório". Mas ela
avança sozinha se o FPS for bom, para não virar um clique inútil.

### 5.3 Posicionamento

O passo mais importante. Mostra ao mesmo tempo:

- Distância em cm, ao vivo, de `getCurrentCameraDistanceCm()`.
- O `FramingIndicator` (hoje órfão), que desenha o enquadramento.
- Semáforo dos checks `face`, `distance`, `centering`, `headPose`.
- Altura da tela: instrução textual, porque não há como medi-la — a câmera não
  sabe onde o monitor está. Fingir medição aqui seria pior que instruir.

"Continuar" fica desabilitado até **3 s contínuos sem nenhum check em `warn` ou
`fail`**. Um contador visível mostra o progresso, e ele **zera** ao sair do
verde: sem isso o cuidador clica no instante de sorte.

### 5.4 Iluminação

Semáforo de `lighting`, `contrast`, `glasses` e `flicker`, com as mensagens
acionáveis que o `evaluateReadiness` já produz ("sem janela atrás", "sem luz
direta nos óculos" saem daí).

Mais o campo **lux ambiente**, opcional. Ao lado dele, uma linha explicando por
que ele existe apesar de haver um check automático: o check mede o recorte do
olho **depois** da exposição automática da webcam, então aprova uma sala escura.
Sem o lux a sessão não é reproduzível por terceiros.

`warn` não bloqueia neste passo — iluminação ruim piora a precisão, não impede a
sessão, e a decisão é do cuidador.

### 5.5 Verificação do monitor

Mostra a diagonal lida do EDID e deixa corrigir à mão, gravando em
`SettingsContext.screenDiagonalIn` com `monitorOrigem`.

Quando o EDID não responde — não-Windows, driver genérico, monitor sem dado — o
campo aparece **vazio pedindo o valor**, com a explicação de que sem ele o erro
angular do relatório é estimativa. Preencher um número plausível e apresentá-lo
como medido é o pior resultado possível aqui.

## 6. Testes

TDD. Cada arquivo é escrito antes da implementação correspondente.

| Arquivo | Cobre |
|---|---|
| `services/camera/devices.test.ts` | lista só `videoinput`; contagem de FPS; os três limiares de `classificarFps`; `enumerateDevices` ausente não lança |
| `services/local/setupProfile.test.ts` | grava por perfil, isola perfis, versão que invalida, storage corrompido |
| `pages/setup/passos.test.ts` | ordem; regra de avanço de cada passo; voltar é sempre livre |
| `pages/setup/steps/Posicionamento.test.tsx` | **o contador de 3 s zera ao sair do verde**; "Continuar" travado antes disso |
| `pages/setup/steps/EscolhaDaCamera.test.tsx` | FPS baixo avisa e **não** bloqueia; uma câmera só ainda mede |
| `pages/setup/steps/Iluminacao.test.tsx` | lux opcional não bloqueia; mensagens do `evaluateReadiness` chegam à tela |
| `pages/setup/steps/VerificacaoDoMonitor.test.tsx` | EDID ausente deixa o campo vazio, sem chutar; correção manual grava `origem: 'manual'` |
| `pages/setup/SetupWizard.test.tsx` | navegação; o stream não reinicia entre passos; conclusão persiste |
| `pages/setup/portao.test.tsx` | `/calibration-check` desvia para `/setup` sem preparo; menu continua livre |

Verificação: `cd frontend && npm run verify`.

O guarda de tema (`pages/temaEscuro.test.tsx`) ganha as telas novas na lista —
o tema padrão do app é o escuro, e foi assim que o Bloco 1 quebrou.

## 7. Limitações conhecidas

Registradas de propósito.

1. **O app não consegue abrir as configurações de privacidade do Windows.**
   Precisaria de `shell.openExternal('ms-settings:privacy-webcam')` no processo
   principal, e `electron/` está fora do escopo. O caminho aparece como texto
   selecionável — mesma limitação dos links do Bloco 1.
2. **FPS medido é aproximado.** Contagem de frames sofre com carga de CPU e
   janela em segundo plano. Serve para separar "30" de "15", não para aferir.
3. **Altura da tela não é medida.** A câmera não sabe onde o monitor está. O
   passo 3 instrui; não verifica.
4. **O lux vai continuar vazio na maioria das sessões** (D6). A diferença é que
   agora fica vazio por escolha do cuidador, e não por não haver onde digitar.
   `accuracy.ts` tirou `luxAmbiente` do protocolo em 2026-09-06; este bloco
   devolve o campo à UI sem devolvê-lo à obrigatoriedade.
5. **O preparo não é reavaliado sozinho.** Trocar a webcam ou mudar de sala não
   dispara nada; quem refaz é o cuidador, pelo atalho nas Configurações
   (`pages/setup/AtalhoDePreparo.tsx`, montado em `SettingsScreen`). O atalho
   mostra quando o preparo foi feito e com que câmera, que é como o cuidador
   percebe que o ambiente mudou — mas quem nota a mudança é ele, não o app.
