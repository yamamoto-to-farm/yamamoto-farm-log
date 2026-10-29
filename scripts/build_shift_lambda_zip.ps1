$ErrorActionPreference = "Stop"

# シフト案生成 Lambda のデプロイ用 zip を作る。
# 依存パッケージ（timetree-exporter ほか）を同梱する。boto3 はランタイム提供のため含めない。

$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root "lambda\shift"
$buildDir = Join-Path $env:TEMP "shift-lambda-build"   # GDrive同期の影響を避けるためTEMPでビルド
$zipPath = Join-Path $root "shift.zip"

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
if (Test-Path $buildDir) { Remove-Item $buildDir -Recurse -Force }
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

# Lambda (Linux, Python 3.13) 用のホイールを取得する（Windowsバイナリ混入を防ぐ）
python -m pip install timetree-exporter --target $buildDir --quiet `
    --platform manylinux2014_x86_64 --implementation cp --python-version 3.13 `
    --only-binary=:all:
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Copy-Item (Join-Path $srcDir "lambda_function.py") $buildDir
Copy-Item (Join-Path $srcDir "shift_tool.py") $buildDir

# テスト・キャッシュ・コンソールスクリプトは含めない
Get-ChildItem $buildDir -Recurse -Directory -Filter "__pycache__" |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $buildDir "bin") -Recurse -Force -ErrorAction SilentlyContinue

Compress-Archive -Path (Join-Path $buildDir "*") -DestinationPath $zipPath -Force
Remove-Item $buildDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Created: $zipPath"
Write-Host "Upload this zip to AWS Lambda and set Handler to: lambda_function.lambda_handler"
