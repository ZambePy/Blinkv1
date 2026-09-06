# Remove os arquivos do design novo que a volta ao front-end antigo deixou órfãos.
# Rode na raiz do projeto: powershell -ExecutionPolicy Bypass -File .\apagar-frontend-novo.ps1

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$arquivos = @(
  'frontend\src\design\assets.ts',
  'frontend\src\pages\caregiver\CaregiverControls.tsx',
  'frontend\src\pages\caregiver\CaregiverPinGate.tsx',
  'frontend\src\pages\caregiver\caregiver.css',
  'frontend\src\pages\onboarding\CalibrationCheck.skipped.test.tsx',
  'frontend\src\pages\settings\CalibrationSection.tsx',
  'frontend\src\pages\settings\CaregiverSection.tsx',
  'frontend\src\pages\settings\DataSection.tsx',
  'frontend\src\pages\settings\DiagnosticsSection.tsx',
  'frontend\src\pages\settings\DisplaySection.tsx',
  'frontend\src\pages\settings\TrackingSection.tsx',
  'frontend\src\pages\settings\VoiceSection.tsx',
  'frontend\src\utils\experimentFlags.ts',
  'frontend\src\utils\speech.ts'
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
$pastas = @('frontend\src\pages\settings')
foreach ($p in $pastas) {
  if ((Test-Path -LiteralPath $p) -and -not (Get-ChildItem -LiteralPath $p -Recurse -Force | Where-Object { -not $_.PSIsContainer })) {
    Remove-Item -LiteralPath $p -Recurse -Force
    Write-Host "pasta vazia removida  $p"
  }
}

Write-Host ""
Write-Host "$removidos arquivo(s) removido(s). Em seguida: npm --prefix frontend run verify"
