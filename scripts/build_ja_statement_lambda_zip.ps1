$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $root "lambda\ja-statement-analysis"
$buildDir = Join-Path $env:TEMP ("ja-statement-lambda-" + [guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $root "ja-statement-analysis.zip"
$temporaryZip = Join-Path $env:TEMP ("ja-statement-" + [guid]::NewGuid().ToString("N") + ".zip")

try {
    New-Item -ItemType Directory -Path $buildDir | Out-Null
    python -m pip install --no-compile -r (Join-Path $sourceDir "requirements.txt") -t $buildDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install JA statement Lambda dependencies."
    }

    foreach ($file in @("lambda_function.py", "statement_parser.py", "classifier.py")) {
        Copy-Item (Join-Path $sourceDir $file) -Destination $buildDir
    }

    @'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

source, temporary, destination = map(Path, sys.argv[1:])
with ZipFile(temporary, "w", compression=ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(source).as_posix())
with temporary.open("rb") as source_file, destination.open("wb") as output:
    import shutil
    shutil.copyfileobj(source_file, output)
with ZipFile(destination) as archive:
    names = archive.namelist()
    if len(names) != len(set(names)) or archive.testzip() is not None:
        raise RuntimeError("Invalid Lambda archive")
    for name in ("lambda_function.py", "statement_parser.py", "classifier.py", "pypdf/__init__.py"):
        if name not in names:
            raise RuntimeError(f"Missing Lambda module: {name}")
print(f"Verified {len(names)} unique ZIP entries.")
'@ | python - $buildDir $temporaryZip $zipPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to build or verify JA statement Lambda ZIP."
    }
    Write-Host "Lambda bundle created at: $zipPath"
    Write-Host "Set Handler to: lambda_function.lambda_handler"
}
finally {
    if (Test-Path -LiteralPath $buildDir) {
        Remove-Item -LiteralPath $buildDir -Recurse -Force
    }
    if (Test-Path -LiteralPath $temporaryZip) {
        Remove-Item -LiteralPath $temporaryZip -Force
    }
}
