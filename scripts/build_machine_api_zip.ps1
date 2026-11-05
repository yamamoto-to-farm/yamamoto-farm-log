param(
  [string]$Python = "python",
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) { $OutputPath = Join-Path $root "machine-api.zip" }
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("farm-machine-api-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $base = Join-Path $temp "sdk.zip"
  & (Join-Path $PSScriptRoot "build_shift_api_zip.ps1") -Python $Python -OutputPath $base
  $archive = Join-Path $temp "machine-api.zip"
  @'
import pathlib, sys, zipfile
root, base, archive = map(pathlib.Path, sys.argv[1:])
sources = {
    "lambda_function.py": root / "lambda" / "machine-api" / "lambda_function.py",
    "work_plans.py": root / "lambda" / "shift-api" / "lambda_function.py",
}
with zipfile.ZipFile(base) as original, zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
    for name in original.namelist():
        if name != "lambda_function.py":
            output.writestr(name, original.read(name))
    for name, source in sources.items():
        output.write(source, name)
with zipfile.ZipFile(archive) as check:
    names = check.namelist()
    assert check.testzip() is None
    assert len(names) == len(set(names))
    for name, source in sources.items():
        assert check.read(name) == source.read_bytes(), name
    assert "boto3/__init__.py" in names
    assert not any(name.startswith("test_") for name in names)
print(f"Verified machine API archive: {len(names)} entries, sources match")
'@ | & $Python -B - $root $base $archive
  if ($LASTEXITCODE -ne 0) { throw "Machine API archive validation failed." }
  [System.IO.File]::WriteAllBytes($OutputPath, [System.IO.File]::ReadAllBytes($archive))
  Get-Item -LiteralPath $OutputPath | Select-Object FullName, Length
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force
}
