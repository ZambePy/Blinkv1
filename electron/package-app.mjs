/**
 * package-app.mjs - Empacotamento final via electron-builder (API programatica).
 *
 * Por que nao chamar electron-builder diretamente no npm script:
 *   electron-builder extrai o binario do Electron para <output>/win-unpacked.tmp
 *   e depois renomeia para win-unpacked. No Windows, quando o diretorio de output
 *   esta dentro de uma pasta sincronizada pelo OneDrive (ex: OneDrive\Desktop),
 *   o OneDrive bloqueia o rename com EPERM imediatamente apos criar o .tmp.
 *
 *   A solucao e sempre usar o diretorio temporario do sistema (os.tmpdir()) como
 *   output — que fica em AppData\Local\Temp, fora do escopo de sincronizacao do
 *   OneDrive. Isso e feito aqui via API programatica, de forma transparente para
 *   quem rodar npm run electron:build.
 *
 * Onde fica o instalador gerado:
 *   %TEMP%\irisflow-release\IrisFlow Setup X.Y.Z.exe   (Windows)
 *   /tmp/irisflow-release/IrisFlow-X.Y.Z.dmg           (macOS)
 *   /tmp/irisflow-release/IrisFlow-X.Y.Z.AppImage      (Linux)
 *
 *   O caminho exato e impresso ao final do build.
 */

import { build } from 'electron-builder';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(os.tmpdir(), 'irisflow-release');

// Motor de voz (clonagem local). E opcional no empacotamento: se a pasta gerada
// por voice-engine/build-voice-engine.ps1 existir, vai para resources/voice-engine;
// se nao, o app e empacotado sem ela e a tela de Voz avisa que o motor nao veio.
const motorDeVoz = path.join(__dirname, '..', 'voice-engine', 'dist', 'irisflow-voz');
const extraResources = fs.existsSync(motorDeVoz)
  ? [{ from: motorDeVoz, to: 'voice-engine', filter: ['**/*'] }]
  : [];
console.log(
  extraResources.length
    ? '[electron:package] motor de voz encontrado: sera incluido em resources/voice-engine'
    : '[electron:package] motor de voz NAO encontrado (voice-engine/dist/irisflow-voz): empacotando sem ele',
);

console.log('[electron:package] Iniciando empacotamento via electron-builder...');
console.log('[electron:package] Output (fora do OneDrive):', output);

const artifacts = await build({
  config: {
    // Sobrescreve apenas o diretorio de output; todo o resto vem do package.json "build".
    directories: { output },
    extraResources,
  },
});

console.log('\n[electron:package] Empacotamento concluido. Artefatos:');
for (const artifact of artifacts) {
  console.log('  ', artifact);
}
