param(
  [string]$Python = "python",
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) {
  $OutputPath = Join-Path $root "shift-api.zip"
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("farm-shift-api-" + [guid]::NewGuid().ToString("N"))
$package = Join-Path $temp "package"
New-Item -ItemType Directory -Path $package -Force | Out-Null
try {
  & $Python -m pip install --disable-pip-version-check --no-compile --target $package -r (Join-Path $root "lambda\shift-api\requirements.txt")
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
  Copy-Item -LiteralPath (Join-Path $root "lambda\shift-api\lambda_function.py") -Destination $package
  $archive = Join-Path $temp "shift-api.zip"
  $code = @'
import pathlib, sys, zipfile
package, archive = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
if not (package / "botocore" / "__init__.py").is_file():
    raise RuntimeError(f"SDK missing from {package}: {[p.name for p in package.iterdir()]}")
sys.path.insert(0, str(package))
import botocore.session
members = botocore.session.get_session().get_service_model("s3").operation_model("PutObject").input_shape.members
assert "IfMatch" in members and "IfNoneMatch" in members, "Conditional PutObject is unavailable"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    for path in sorted(package.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts:
            z.write(path, path.relative_to(package).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    names = z.namelist()
    assert len(names) == len(set(names))
    assert "lambda_function.py" in names and "boto3/__init__.py" in names
    assert not any(name.startswith("test_") for name in names)
print(f"Verified {len(names)} entries with conditional S3 writes")
'@
  $code | & $Python -B - $package $archive
  if ($LASTEXITCODE -ne 0) { throw "Archive build or validation failed." }
  [System.IO.File]::WriteAllBytes($OutputPath, [System.IO.File]::ReadAllBytes($archive))
  Get-Item -LiteralPath $OutputPath | Select-Object FullName, Length
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force
}
