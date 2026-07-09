param(
  [string]$RootPath = ".",
  [switch]$AllowEmpty
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Convert-SafeFileName {
  param([string]$Name)

  if ($null -eq $Name) { return "" }

  $s = [string]$Name
  $s = $s.Normalize([Text.NormalizationForm]::FormKC)
  $s = $s -replace "[()（）]", ""
  $s = $s -replace "・", "_"
  $s = $s -replace "[^\p{L}\p{N}_-]", "_"
  $s = $s -replace "_+", "_"
  $s = $s.Trim("_")
  return $s
}

function Get-StringList {
  param([object]$Value)

  $list = @()

  if ($null -eq $Value) {
    return ,$list
  }

  if ($Value -is [System.Array]) {
    foreach ($v in $Value) {
      $t = [string]$v
      $t = $t.Trim()
      if ($t) { $list += $t }
    }
    return ,$list
  }

  $text = ([string]$Value).Trim()
  if (-not $text) {
    return ,$list
  }

  $parts = $text -split "[、,／/]"
  foreach ($p in $parts) {
    $t = ([string]$p).Trim()
    if ($t) { $list += $t }
  }

  return ,$list
}

function Join-Normalized {
  param([object]$Value)

  $raw = Get-StringList -Value $Value
  if ($raw.Count -eq 0) { return "" }

  $seen = [System.Collections.Generic.HashSet[string]]::new()
  $out = [System.Collections.Generic.List[string]]::new()

  foreach ($item in $raw) {
    if ($seen.Add($item)) {
      [void]$out.Add($item)
    }
  }

  return [string]::Join("／", $out)
}

function Escape-CsvCell {
  param([string]$Value)

  if ($null -eq $Value) { $Value = "" }
  if ($Value -match '[",\r\n]') {
    return '"' + ($Value -replace '"', '""') + '"'
  }
  return $Value
}

$root = Resolve-Path -LiteralPath $RootPath
$fieldsPath = Join-Path $root "deploy/data/fields.json"
$weedingDir = Join-Path $root "logs/weeding"
$outPath = Join-Path $weedingDir "all.csv"

if (-not (Test-Path -LiteralPath $fieldsPath)) {
  throw "fields.json not found: $fieldsPath"
}

$fieldsJson = Get-Content -LiteralPath $fieldsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$rows = [System.Collections.Generic.List[object]]::new()
$sourceFileCount = 0

foreach ($field in $fieldsJson) {
  $fieldName = ([string]$field.name).Trim()
  if (-not $fieldName) { continue }

  $safe = Convert-SafeFileName -Name $fieldName
  if (-not $safe) { continue }

  $sourcePath = Join-Path $weedingDir ($safe + ".json")
  if (-not (Test-Path -LiteralPath $sourcePath)) { continue }
  $sourceFileCount++

  $doc = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -eq $doc.years) { continue }

  foreach ($yearProp in $doc.years.PSObject.Properties) {
    $yearNode = $yearProp.Value
    if ($null -eq $yearNode -or $null -eq $yearNode.entries) { continue }

    foreach ($entry in $yearNode.entries) {
      $date = ([string]$entry.date).Trim()
      if (-not $date) { continue }

      $workersValue = $null
      if ($null -ne $entry.workers) {
        $workersValue = $entry.workers
      } else {
        $workersValue = $entry.worker
      }

      $worker = Join-Normalized -Value $workersValue
      $machine = Join-Normalized -Value $entry.machine

      $row = [PSCustomObject]@{
        date = $date
        worker = $worker
        field = $fieldName
        machine = $machine
      }
      [void]$rows.Add($row)
    }
  }
}

if ($sourceFileCount -eq 0 -and -not $AllowEmpty) {
  throw "No weeding source JSON found under: $weedingDir"
}

$sorted = $rows | Sort-Object -Property @{Expression='date'; Ascending=$true}, @{Expression='worker'; Ascending=$true}, @{Expression='field'; Ascending=$true}, @{Expression='machine'; Ascending=$true}

$lines = [System.Collections.Generic.List[string]]::new()
[void]$lines.Add("date,worker,field,machine")

foreach ($r in $sorted) {
  $line = @(
    (Escape-CsvCell -Value ([string]$r.date))
    (Escape-CsvCell -Value ([string]$r.worker))
    (Escape-CsvCell -Value ([string]$r.field))
    (Escape-CsvCell -Value ([string]$r.machine))
  ) -join ","
  [void]$lines.Add($line)
}

if (-not (Test-Path -LiteralPath $weedingDir)) {
  New-Item -Path $weedingDir -ItemType Directory | Out-Null
}

$content = [string]::Join("`n", $lines) + "`n"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($outPath, $content, $utf8NoBom)

Write-Host "regenerated:" $outPath
Write-Host "source files:" $sourceFileCount
Write-Host "rows:" $rows.Count
