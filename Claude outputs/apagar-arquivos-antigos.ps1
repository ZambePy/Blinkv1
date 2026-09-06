# Remove os arquivos que deixaram de existir no projeto (renomeados, fundidos ou apagados).
# Rode na raiz do projeto: powershell -ExecutionPolicy Bypass -File .\apagar-arquivos-antigos.ps1
# Nada fora desta lista é tocado. Depois de rodar, pode apagar este script.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$arquivos = @(
  '.github\workflows\react-doctor.yml',
  'accuracy-report-1788579312251.json',
  'accuracy-report-1788580524778.json',
  'baseline.txt',
  'docs\ANALISE_README.md',
  'docs\DECISOES_PIPELINE.md',
  'docs\LATENCIA_L2CS.md',
  'docs\SETUP_MEDICAO.md',
  'docs\baseline_a28bdb0.json',
  'frontend\.github\dependabot.yml',
  'frontend\.github\workflows\ci.yml',
  'frontend\public\Boldonse-OFL.txt',
  'frontend\public\Boldonse.ttf',
  'frontend\public\favicon.svg',
  'frontend\public\icons.svg',
  'frontend\src\App.b2-12.test.tsx',
  'frontend\src\App.css',
  'frontend\src\assets\hero.png',
  'frontend\src\assets\react.svg',
  'frontend\src\assets\vite.svg',
  'frontend\src\components\DriftIndicator.test.tsx',
  'frontend\src\components\DriftIndicator.tsx',
  'frontend\src\components\GazeStatusBanner.p6-9.test.tsx',
  'frontend\src\components\TTSButton.tsx',
  'frontend\src\components\ui\Card.tsx',
  'frontend\src\components\ui\FramingIndicator.tsx',
  'frontend\src\components\ui\ProtectedRoute.tsx',
  'frontend\src\components\ui\SystemStatusHeader.tsx',
  'frontend\src\components\ui\hoverFocus.ts',
  'frontend\src\context\GazeContext.b1-8.test.tsx',
  'frontend\src\context\SettingsContext.b3-22.test.tsx',
  'frontend\tailwind.config.js',
  'src\a2.filter-blink.test.ts',
  'src\a3.invariants.test.ts',
  'src\accuracy.b2-10.test.ts',
  'src\accuracy.b3-6.test.ts',
  'src\calibration.a1-1.test.ts',
  'src\calibration.a1-2.test.ts',
  'src\calibration.b1-3-b1-5.test.ts',
  'src\calibration.b1-4.test.ts',
  'src\calibration.b2-9.test.ts',
  'src\calibration.b3-17.test.ts',
  'src\calibration.d4.test.ts',
  'src\calibration.d6.test.ts',
  'src\calibration.poseGate.test.ts',
  'src\calibration\calibration.worker.ts',
  'src\calibration\client.b3-10.test.ts',
  'src\calibration\client.test.ts',
  'src\calibration\client.ts',
  'src\calibration\regressorConfig.ts',
  'src\calibration\trainCore.test.ts',
  'src\calibration\trainCore.ts',
  'src\calibrationProfiles.a1-6.test.ts',
  'src\cameraTuner.b3-14.test.ts',
  'src\cameraTuner.b3-3.test.ts',
  'src\cameraTuner.exposure.test.ts',
  'src\capture\capture.worker.ts',
  'src\capture\captureWorker.test.ts',
  'src\capture\captureWorker.ts',
  'src\capture\frameRing.test.ts',
  'src\capture\frameRing.ts',
  'src\config\experiment.b3-13.test.ts',
  'src\displayGeometry.b2-11.test.ts',
  'src\distanceCorrection.test.ts',
  'src\distanceCorrection.ts',
  'src\electronSecurity.b3-30.test.ts',
  'src\extractor.b1-1.test.ts',
  'src\extractor.b2-6.test.ts',
  'src\extractor.b3-31.test.ts',
  'src\extractor.p5-4.test.ts',
  'src\extractor.spec11.test.ts',
  'src\flickerDetector.b3-15.test.ts',
  'src\interaction\dwell.b1-9.test.ts',
  'src\interaction\dwell.b2-5.test.ts',
  'src\interaction\dwell.b3-27.test.ts',
  'src\invariants.ts',
  'src\kernelRidge.test.ts',
  'src\kernelRidge.ts',
  'src\l2cs\client.b1-2.test.ts',
  'src\l2cs\client.b2-1.test.ts',
  'src\l2cs\decode.b3-1.test.ts',
  'src\l2cs\eyeRegion.test.ts',
  'src\l2cs\health.b2-2.test.ts',
  'src\mapeamento.p6-7-p6-8.test.ts',
  'src\oneEuroFilter.b2-15.test.ts',
  'src\oneEuroFilter.b3-5.test.ts',
  'src\pose\absoluteGaze.test.ts',
  'src\pose\absoluteGaze.ts',
  'src\pose\integracao.p5-8.test.ts',
  'src\pose\solvePnP.test.ts',
  'src\pose\solvePnP.ts',
  'src\poseCompensation.b3-12.test.ts',
  'src\preprocess\clahe.test.ts',
  'src\preprocess\clahe.ts',
  'src\preprocess\gamma.test.ts',
  'src\preprocess\gamma.ts',
  'src\preprocess\illumination.test.ts',
  'src\preprocess\illumination.ts',
  'src\preprocess\pipeline.test.ts',
  'src\preprocess\pipeline.ts',
  'src\preprocess\roiCache.test.ts',
  'src\preprocess\roiCache.ts',
  'src\qualityAnalyzer.a1-5.test.ts',
  'src\qualityAnalyzer.b3-2.test.ts',
  'src\recursiveRidge.b2-8.test.ts',
  'src\recursiveRidge.ts',
  'src\ridge.a1-3.test.ts',
  'src\ridge.axisscale.test.ts',
  'src\ridge.b2-7.test.ts',
  'src\ridge.b3-9.test.ts',
  'src\ridge.p6-6.test.ts',
  'src\setupReadinessAdapter.b3-16.test.ts',
  'src\telemetry\recorder.b3-28.test.ts',
  'src\testUtils\pipelineHarness.p7-6.test.ts',
  'src\tracker\engine.a1-4.test.ts',
  'src\tracker\engine.b1-6-b1-7.test.ts',
  'src\tracker\loopGuard.b2-4.test.ts',
  'tasks.md'
)

$removidos = 0
foreach ($a in $arquivos) {
  if (Test-Path -LiteralPath $a) {
    Remove-Item -LiteralPath $a -Force
    Write-Host "removido  $a"
    $removidos++
  }
}

# Pastas que ficam vazias depois da limpeza.
$pastas = @('src\pose', 'src\preprocess', 'src\capture', 'frontend\.github\workflows', 'frontend\.github', 'frontend\src\assets')
foreach ($p in $pastas) {
  if ((Test-Path -LiteralPath $p) -and -not (Get-ChildItem -LiteralPath $p -Recurse -Force | Where-Object { -not $_.PSIsContainer })) {
    Remove-Item -LiteralPath $p -Recurse -Force
    Write-Host "pasta vazia removida  $p"
  }
}

Write-Host ""
Write-Host "$removidos arquivo(s) removido(s). Em seguida: npm install; npm --prefix frontend install; npm test"
