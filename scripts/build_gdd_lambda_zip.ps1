$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root "src\gdd"
$zipPath = Join-Path $root "gdd.zip"

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

if (-not (Test-Path $srcDir)) {
    throw "Source directory not found: $srcDir"
}

Compress-Archive -Path (Join-Path $srcDir "*") -DestinationPath $zipPath -Force

Write-Host "Created: $zipPath"
Write-Host "Upload this zip to AWS Lambda and set Handler to: app.lambda_handler"
