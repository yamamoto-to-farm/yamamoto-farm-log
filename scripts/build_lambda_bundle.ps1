$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root "lambda-build"
$srcDir = Join-Path $root "src\gdd"
$zipPath = Join-Path $root "gdd.zip"

if (Test-Path $buildDir) {
    Remove-Item $buildDir -Recurse -Force
}

New-Item -ItemType Directory -Path $buildDir | Out-Null

python -m pip install -r (Join-Path $root "requirements.txt") -t $buildDir

Get-ChildItem -Path $srcDir -File | ForEach-Object {
    Copy-Item $_.FullName -Destination $buildDir
}

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $buildDir "*") -DestinationPath $zipPath -Force

Write-Host "Lambda bundle created at: $zipPath"
Write-Host "Set Handler to: app.lambda_handler"

