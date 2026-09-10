# Gera o executável do motor de voz para o instalador do IrisFlow (Windows).
#
# Rode UMA vez nesta pasta, num PowerShell, com Python 3.11 instalado:
#   .\build-voice-engine.ps1
#
# Saída: voice-engine\dist\irisflow-voz\irisflow-voz.exe (+ pasta de bibliotecas).
# O electron-builder copia essa pasta para `resources\voice-engine\` do app
# (ver "extraResources" no package.json da raiz). Sem ela o app abre normalmente
# e a tela "Voz personalizada" informa que o motor não veio neste build.
#
# Os PESOS do modelo (~1,5 GB) não entram no executável: são baixados na
# primeira vez, pela tela de Voz, para a pasta de dados do app.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$py = if (Get-Command py -ErrorAction SilentlyContinue) { 'py -3.11' } else { 'python' }

if (-not (Test-Path .\.venv)) {
  Write-Host '[voz] criando ambiente virtual (.venv)...'
  Invoke-Expression "$py -m venv .venv"
}
.\.venv\Scripts\Activate.ps1

python -c "import sys; assert sys.version_info[:2] == (3, 11), 'Use Python 3.11 (64 bits)'"
python -m pip install --upgrade pip
pip install -r requirements.txt pyinstaller

Write-Host '[voz] verificando importações...'
python -c "import chatterbox, librosa, soundfile, noisereduce; print('ok')"

Write-Host '[voz] empacotando com PyInstaller (modo pasta)...'
pyinstaller --noconfirm --clean `
  --name irisflow-voz `
  --console `
  --collect-all chatterbox `
  --collect-all librosa `
  --collect-all perth `
  --collect-data soundfile `
  --hidden-import irisflow_voz `
  --hidden-import irisflow_voz.audio `
  --hidden-import irisflow_voz.motor `
  --paths . `
  entrada.py

Write-Host ''
Write-Host "[voz] pronto: $PSScriptRoot\dist\irisflow-voz\irisflow-voz.exe"
Write-Host '[voz] teste rápido:  echo {"id":1,"cmd":"status"} | .\dist\irisflow-voz\irisflow-voz.exe'
