# Apaga TUDO que a voz personalizada criou neste computador.
#
#   .\limpar-voz.ps1              # voz importada, cache de frases e pesos do modelo
#   .\limpar-voz.ps1 -Ambiente    # idem + o ambiente Python (.venv) desta pasta
#                                 #   e um .venv criado por engano na raiz do projeto
#
# Onde as coisas ficam: o app grava em %APPDATA%\irisflow\voz (rodando pelo
# `npm run electron:dev`) ou %APPDATA%\IrisFlow\voz (instalado). O script
# limpa as duas. Nada fora dessas pastas é tocado.

param([switch]$Ambiente)

$ErrorActionPreference = 'Continue'

function Remover($caminho, $descricao) {
  if (Test-Path $caminho) {
    $tamanho = (Get-ChildItem $caminho -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    $mb = if ($tamanho) { [math]::Round($tamanho / 1MB) } else { 0 }
    Remove-Item -Recurse -Force $caminho
    Write-Host "[limpar] removido: $descricao ($caminho, ~$mb MB)"
  } else {
    Write-Host "[limpar] nao existia: $descricao ($caminho)"
  }
}

foreach ($app in @('irisflow', 'IrisFlow')) {
  $base = Join-Path $env:APPDATA "$app\voz"
  Remover (Join-Path $base 'referencia.wav')  'audio de referencia da voz'
  Remover (Join-Path $base 'referencia.json') 'metadados e consentimento'
  Remover (Join-Path $base 'estado.json')     'estado (voz ligada/desligada)'
  Remover (Join-Path $base 'cache')           'cache de frases geradas'
  Remover (Join-Path $base 'tmp')             'temporarios'
  Remover (Join-Path $base 'modelos')         'pesos do modelo (Hugging Face)'
}

if ($Ambiente) {
  $aqui = $PSScriptRoot
  Remover (Join-Path $aqui '.venv')                     'ambiente Python da voz'
  Remover (Join-Path $aqui 'build')                     'build do PyInstaller'
  Remover (Join-Path $aqui 'dist')                      'executavel gerado'
  Remover (Join-Path (Split-Path $aqui -Parent) '.venv') '.venv criado por engano na raiz do projeto'
  Get-ChildItem $aqui -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
}

Write-Host ''
Write-Host '[limpar] pronto. Abra o app: a tela de Voz volta ao estado inicial (modelo nao baixado, nenhuma voz).'
