$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root "lambda-build"
$srcDir = Join-Path $root "lambda\gdd"
$zipPath = Join-Path $root "gdd.zip"
$zipPathInLambda = Join-Path (Join-Path $root "lambda") "gdd\gdd.zip"

if (Test-Path $buildDir) {
    & cmd /c "rmdir /s /q \"$buildDir\""
}

New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

python -m pip install -r (Join-Path $root "requirements.txt") -t $buildDir

Get-ChildItem -Path $srcDir -File | Where-Object { $_.Extension -ne ".zip" } | ForEach-Object {
    Copy-Item $_.FullName -Destination $buildDir
}

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

if (Test-Path $zipPathInLambda) {
    Remove-Item $zipPathInLambda -Force
}

Compress-Archive -Path (Join-Path $buildDir "*") -DestinationPath $zipPath -Force
Copy-Item -Path $zipPath -Destination $zipPathInLambda -Force

Write-Host "Lambda bundle created at: $zipPath"
Write-Host "Lambda folder package created at: $zipPathInLambda"
Write-Host "Set Handler to: app.lambda_handler"

