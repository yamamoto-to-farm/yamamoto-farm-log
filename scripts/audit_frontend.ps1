param(
  [switch]$FailOnIssue
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$deploy = Join-Path $root "deploy"
$issues = New-Object System.Collections.Generic.List[string]

function Add-Issue([string]$message) {
  $issues.Add($message) | Out-Null
}

Get-ChildItem -Path $deploy -Recurse -Filter *.json | ForEach-Object {
  try {
    Get-Content -Path $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
  } catch {
    Add-Issue "JSON syntax: $($_.FullName.Replace($root + '\', '')) => $($_.Exception.Message)"
  }
}

Get-ChildItem -Path $deploy -Recurse -File | Where-Object { $_.Name -match '\(\d+\)|backup|バックアップ' } | ForEach-Object {
  Add-Issue "Backup file in deploy: $($_.FullName.Replace($root + '\', ''))"
}

Get-ChildItem -Path $deploy -Recurse -Include *.js,*.html | ForEach-Object {
  $rel = $_.FullName.Replace($root + '\', '')
  $text = Get-Content -Path $_.FullName -Raw -Encoding UTF8
  if ($text -match 'toISOString\(\)\.slice\(0\s*,\s*10\)') { Add-Issue "UTC date slice: $rel" }
  if ($text -match 'new Date\(\)\.toISOString\(\)') { Add-Issue "Direct toISOString: $rel" }
  if ($text -match '(line|lines\[0\]|headers)\.split\(\s*["'']\s*,\s*["'']\s*\)') { Add-Issue "Ad-hoc CSV split: $rel" }
}

Get-ChildItem -Path $deploy -Recurse -Filter *.html | ForEach-Object {
  $html = $_
  $text = Get-Content -Path $html.FullName -Raw -Encoding UTF8
  [regex]::Matches($text, '(?:src|href)=["'']([^"'']+)["'']') | ForEach-Object {
    $src = $_.Groups[1].Value
    if ($src -match '^(https?:|#|mailto:|tel:|data:)' -or $src -match '^\$\{') { return }
    $clean = ($src -split '[?#]')[0]
    if ([string]::IsNullOrWhiteSpace($clean)) { return }
    if ($clean.StartsWith('/')) {
      $target = Join-Path $deploy $clean.TrimStart('/')
    } else {
      $target = Join-Path $html.DirectoryName $clean
    }
    if (-not (Test-Path $target)) {
      Add-Issue "Missing local ref: $($html.FullName.Replace($root + '\', '')) => $src"
    }
  }
}

if ($issues.Count -gt 0) {
  $issues | ForEach-Object { Write-Host $_ }
  if ($FailOnIssue) {
    Write-Host "AUDIT_FAILED $($issues.Count) issue(s)"
    exit 1
  }
  Write-Host "AUDIT_FOUND $($issues.Count) issue(s)"
  exit 0
}

Write-Host "AUDIT_OK"