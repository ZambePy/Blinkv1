# IrisFlow 👁️ lasers

Um projeto de experimento utilizando MediaPipe FaceMesh para rastreamento de íris. Ao mover os olhos, um "laser" acompanha o movimento da sua pupila pela tela, ignorando os movimentos gerais da cabeça.

## Como rodar o projeto localmente

Siga os passos abaixo para testar em sua máquina:

1. **Instale as dependências:**
   No terminal, dentro da pasta do projeto, rode:
   ```bash
   npm i
   ```

2. **Inicie o servidor de desenvolvimento:**
   Em seguida, inicie o Vite rodando:
   ```bash
   npm run dev
   ```

3. **Acesse no navegador:**
   Abra a URL que aparecer no terminal (geralmente `http://localhost:5173/`).
   **Nota:** Lembre-se de dar permissão para uso da webcam!

## Tecnologias utilizadas
- Vite (Vanilla TypeScript)
- MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)
- CSS Moderno (Efeitos de Glow / Box Shadow)
- Electron + `onnxruntime-node` (empacotamento desktop e inferência do encoder CNN)

## Executando como app desktop

O IrisFlow também roda como aplicativo Electron local, com a mesma UI/lógica
do web app (renderer) e uma ponte de inferência ONNX rodando no processo
main (Node), para acesso nativo a execution providers de GPU (CUDA/DirectML/
CoreML) sem as limitações de sandbox do browser.

Separação de processos:
- **renderer** (`src/`, `index.html`): UI, MediaPipe, calibração, teclado —
  inalterado, sem acesso a Node (`contextIsolation: true`, `nodeIntegration:
  false`, `sandbox: true`).
- **preload** (`electron/preload.ts`): expõe `window.irisflowAPI` via
  `contextBridge`, único ponto de contato entre renderer e main.
- **main** (`electron/main.ts`, `electron/inference/encoderRunner.ts`): cria a
  janela, permissiona a câmera e roda a inferência do encoder CNN via
  `onnxruntime-node`.

### Rodar em desenvolvimento

```bash
npm run electron:dev
```

Isso sobe o servidor Vite normal, compila `electron/` (main + preload) em
modo watch e abre a janela do Electron apontando para o dev server — a
câmera e o MediaPipe funcionam exatamente como no `npm run dev`.

> Se o Electron abrir e fechar sozinho sem UI, verifique se a variável de
> ambiente `ELECTRON_RUN_AS_NODE` não está setada no seu shell — ela faz o
> binário do Electron rodar como Node puro, sem `app`/`BrowserWindow`.

### Gerar o instalador

```bash
npm run electron:build
```

Builda o renderer (`vite build`), compila `electron/` para produção e roda o
`electron-builder`, gerando o instalador em `release/` (NSIS no Windows, DMG
no macOS, AppImage no Linux).

### Onde colocar o modelo do encoder CNN

Quando o encoder CNN for treinado e exportado para ONNX, coloque o arquivo em:

```
resources/models/gaze_encoder.onnx
```

Esse caminho é incluído no pacote final via `extraResources` do
electron-builder (não é baixado em runtime). Enquanto o arquivo não existir,
`encoderRunner` loga um aviso e retorna `null` — o pipeline de geometria +
Ridge continua funcionando normalmente sem o encoder. A integração do
resultado do encoder com `fusion.ts` é uma tarefa futura.
