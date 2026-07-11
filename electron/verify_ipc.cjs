'use strict';
// Roda com: npx electron electron/verify_ipc.cjs
// Testa o boundary IPC+contextBridge real para encoder:infer.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const ort = require('onnxruntime-node');

const FACE_LEN = 224 * 224 * 3;
const EYE_LEN  = 112 * 112 * 3;
const RECT_LEN = 12;

function resolveModelPath() {
  // __dirname = .../electron/ — model fica um nivel acima
  return path.join(__dirname, '..', 'resources', 'models', 'gaze_encoder.onnx');
}

async function loadSession(modelPath) {
  for (const provider of ['dml', 'cpu']) {
    try {
      const s = await ort.InferenceSession.create(modelPath, { executionProviders: [provider] });
      console.log(`[verify] sessao ONNX carregada com provider "${provider}"`);
      return s;
    } catch (e) {
      console.warn(`[verify] provider "${provider}" falhou: ${e.message}`);
    }
  }
  return null;
}

app.whenReady().then(async () => {
  const modelPath = resolveModelPath();
  console.log(`[verify] modelo em: ${modelPath}`);
  console.log(`[verify] modelo existe: ${fs.existsSync(modelPath)}`);

  if (!fs.existsSync(modelPath)) {
    console.error('[verify] ERRO FATAL: modelo nao encontrado');
    app.quit();
    return;
  }

  const session = await loadSession(modelPath);
  if (!session) {
    console.error('[verify] ERRO FATAL: sessao ONNX nao carregou com nenhum provider');
    app.quit();
    return;
  }

  // Handler IPC identico ao main.ts real.
  ipcMain.handle('encoder:infer', async (_event, input) => {
    try {
      const faceArr  = input.face     instanceof Float32Array ? input.face     : Float32Array.from(input.face);
      const leftArr  = input.leftEye  instanceof Float32Array ? input.leftEye  : Float32Array.from(input.leftEye);
      const rightArr = input.rightEye instanceof Float32Array ? input.rightEye : Float32Array.from(input.rightEye);
      const rectArr  = input.rect     instanceof Float32Array ? input.rect     : Float32Array.from(input.rect);

      console.log(`[verify][main] input recebido — face.length=${faceArr.length} leftEye.length=${leftArr.length}`);

      const feeds = {
        face:      new ort.Tensor('float32', faceArr,  [1, 224, 224, 3]),
        left_eye:  new ort.Tensor('float32', leftArr,  [1, 112, 112, 3]),
        right_eye: new ort.Tensor('float32', rightArr, [1, 112, 112, 3]),
        rect:      new ort.Tensor('float32', rectArr,  [1, 12]),
      };
      const results = await session.run(feeds);
      const output  = results['embedding'];
      if (!output) {
        console.error('[verify][main] output "embedding" ausente');
        return null;
      }
      const result = Float32Array.from(output.data);
      console.log(`[verify][main] inferencia ok — embedding.length=${result.length}, first3=[${result[0]},${result[1]},${result[2]}]`);
      // Serializa como number[] — identico ao fix em main.ts.
      return Array.from(result);
    } catch (err) {
      console.error('[verify][main] erro na inferencia:', err);
      return null;
    }
  });

  const preloadPath = path.join(__dirname, '..', 'dist-electron', 'preload.cjs');
  console.log(`[verify] preload em: ${preloadPath}`);
  console.log(`[verify] preload existe: ${fs.existsSync(preloadPath)}`);

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Pagina minima — apenas o suficiente para o preload rodar.
  win.loadURL('about:blank');

  win.webContents.once('dom-ready', async () => {
    console.log('[verify] renderer dom-ready, disparando teste...');
    try {
      // executeJavaScript usa structured clone: Float32Array sobrevive de volta ao main.
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const r = await window.irisflowAPI.runEncoderInference({
            face:     new Float32Array(${FACE_LEN}),
            leftEye:  new Float32Array(${EYE_LEN}),
            rightEye: new Float32Array(${EYE_LEN}),
            rect:     new Float32Array(${RECT_LEN})
          });
          return {
            jsType:         Object.prototype.toString.call(r),
            isFloat32Array: r instanceof Float32Array,
            length:         r != null ? r.length : null,
            first3:         r != null ? [r[0], r[1], r[2]] : null
          };
        })()
      `);
      console.log('[verify] RESULTADO BRUTO:', JSON.stringify(result));
      if (result && result.isFloat32Array && result.length === 256) {
        console.log('[verify] PASSOU — Float32Array(256) recebido corretamente via IPC+contextBridge');
      } else {
        console.log('[verify] FALHOU — valor retornado nao e Float32Array(256)');
      }
    } catch (err) {
      console.error('[verify] erro em executeJavaScript:', err.message ?? err);
    }
    app.quit();
  });

  win.webContents.on('console-message', (_e, _level, msg) => {
    console.log(`[renderer-console] ${msg}`);
  });
});

app.on('window-all-closed', () => app.quit());
