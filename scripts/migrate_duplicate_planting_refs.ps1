param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$logs = Join-Path $Root "logs"
$duplicatePath = Join-Path $logs "planting\planting-ref-duplicates.csv"
$seedPath = Join-Path $logs "seed\all.csv"
$summaryRoot = Join-Path $logs "summary"
$indexPath = Join-Path $Root "deploy\data\summary-index.json"

if (-not (Test-Path $duplicatePath)) { throw "重複監査CSVがありません: $duplicatePath" }
if (-not (Test-Path $seedPath)) { throw "播種CSVがありません: $seedPath" }

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Safe-FileName([string]$Name) {
  $value = [string]$Name
  $value = $value.Normalize([Text.NormalizationForm]::FormKC)
  $value = $value -replace '[()（）]', ''
  $value = $value -replace '・', '_'
  $value = $value -replace '[^\p{L}\p{N}_-]', '_'
  $value = $value -replace '_+', '_'
  return ($value -replace '^_+|_+$', '')
}

function Read-CsvRows([string]$Path) {
  if (-not (Test-Path $Path)) { return @() }
  return @(Import-Csv -Path $Path -Encoding UTF8)
}

function Write-CsvRows([string]$Path, [object[]]$Rows) {
  if (@($Rows).Count -eq 0) { return }
  $csv = $Rows | ConvertTo-Csv -NoTypeInformation | Out-String
  Write-Utf8NoBom $Path ($csv.TrimEnd("`r", "`n") + "`r`n")
}

$seedRows = Read-CsvRows $seedPath
$seedDateByRef = @{}
foreach ($row in $seedRows) {
  if ($row.seedRef) { $seedDateByRef[[string]$row.seedRef] = [string]$row.seedDate }
}

$duplicateRows = Read-CsvRows $duplicatePath
$migrations = @{}
foreach ($group in ($duplicateRows | Group-Object plantingRef)) {
  $definitions = @($group.Group | Sort-Object @{ Expression = { $seedDateByRef[[string]$_.seedRef] } }, seedRef)
  if ($definitions.Count -lt 2) { continue }

  $oldRef = [string]$group.Name
  $newRows = @{}
  for ($i = 0; $i -lt $definitions.Count; $i++) {
    $row = $definitions[$i]
    $suffix = "{0}-{1}-{2}" -f $row.seedRef, $row.trayType, ($i + 1)
    $newRows[[string]$row.seedRef] = "$oldRef-$suffix"
  }
  $migrations[$oldRef] = [pscustomobject]@{
    OldRef = $oldRef
    Definitions = $definitions
    NewBySeedRef = $newRows
    PrimarySeedRef = [string]$definitions[0].seedRef
    PrimaryRef = $newRows[[string]$definitions[0].seedRef]
  }
}

Write-Output "移行対象グループ: $($migrations.Count)"
$migrations.Values | ForEach-Object {
  Write-Output "[$($_.OldRef)] 古い播種: $($_.PrimarySeedRef) -> $($_.PrimaryRef)"
  $_.Definitions | Select-Object seedRef, trayType, quantity | Format-Table -AutoSize | Out-String | Write-Output
}

if (-not $Apply) {
  Write-Output "確認モードです。実際に変更する場合は -Apply を指定してください。"
  exit 0
}

$backupRoot = Join-Path ([IO.Path]::GetTempPath()) ("yamamoto-farm-log-migration-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
Copy-Item -Path $logs -Destination $backupRoot -Recurse -Force
Write-Output "バックアップ: $backupRoot"

# 参照を持つCSVを更新。seedRefを持つ行は播種ロット別、それ以外は古い播種日側へ寄せる。
Get-ChildItem $logs -Recurse -Filter *.csv | Where-Object { $_.FullName -notmatch 'security|planting-ref-|\\backup\\' } | ForEach-Object {
  $path = $_.FullName
  $rows = Read-CsvRows $path
  if (@($rows).Count -eq 0) { return }
  $headers = @($rows[0].PSObject.Properties.Name)
  if ($headers -notcontains "plantingRef") { return }

  foreach ($row in $rows) {
    $oldRef = [string]$row.plantingRef
    if (-not $migrations.ContainsKey($oldRef)) { continue }
    $migration = $migrations[$oldRef]
    $seedRef = [string]$row.seedRef
    if ($seedRef -and $migration.NewBySeedRef.ContainsKey($seedRef)) {
      $row.plantingRef = $migration.NewBySeedRef[$seedRef]
    } else {
      $row.plantingRef = $migration.PrimaryRef
    }
  }
  Write-CsvRows $path $rows
  Write-Output "更新: $($path.Substring($Root.Length + 1))"
}

# サマリーJSONを古い作付けから播種ロット単位へ分割する。
$index = Get-Content $indexPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
foreach ($migration in $migrations.Values) {
  $oldFiles = @(Get-ChildItem $summaryRoot -Recurse -Filter "$(Safe-FileName $migration.OldRef).json")
  if ($oldFiles.Count -eq 0) { continue }
  $oldFile = $oldFiles[0]
  $oldSummary = Get-Content $oldFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  $primaryDef = $migration.Definitions[0]
  $newSummaryFiles = @()

  foreach ($definition in $migration.Definitions) {
    $newRef = $migration.NewBySeedRef[[string]$definition.seedRef]
    $isPrimary = $newRef -eq $migration.PrimaryRef
    $summary = $oldSummary | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $summary.plantingRef = $newRef
    $summary.planting.seedRef = [string]$definition.seedRef
    $summary.planting.quantity = [int]$definition.quantity
    $summary.planting.trayType = [int]$definition.trayType

    if (-not $isPrimary) {
      $summary.harvest = [pscustomobject]@{ count = 0; totalAmount = 0; firstDate = $null; lastDate = $null }
      $summary.shipping = [pscustomobject]@{ count = 0; totalWeight = 0; firstDate = $null; lastDate = $null }
      $summary.lifecycle.phase = "in-cultivation"
      $summary.lifecycle.hasHarvest = $false
      $summary.lifecycle.discardedFully = $false
      $summary.lifecycle.discardTotalQuantity = 0
      $summary.lifecycle.endDate = ""
      $summary.lifecycle.statusText = "栽培中"
    }

    $fieldKey = Safe-FileName $summary.planting.field
    $year = [string]$summary.planting.plantDate.Substring(0, 4)
    $dir = Join-Path $summaryRoot "$fieldKey\$year"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $fileName = "$(Safe-FileName $newRef).json"
    $target = Join-Path $dir $fileName
    Write-Utf8NoBom $target (($summary | ConvertTo-Json -Depth 30) + "`r`n")
    $newSummaryFiles += $fileName

    if (-not $index.ContainsKey($fieldKey)) { $index[$fieldKey] = @{} }
    if (-not $index[$fieldKey].ContainsKey($year)) { $index[$fieldKey][$year] = @() }
    $index[$fieldKey][$year] = @($index[$fieldKey][$year] | Where-Object { $_ -ne "$(Safe-FileName $migration.OldRef).json" } | Where-Object { $_ -ne $fileName }) + $fileName | Sort-Object -Unique
  }

  Remove-Item $oldFile.FullName -Force
}

Write-Utf8NoBom $indexPath (($index | ConvertTo-Json -Depth 30) + "`r`n")
Write-Output "summary-index更新: $($indexPath.Substring($Root.Length + 1))"
Write-Output "移行完了。バックアップを保持しています: $backupRoot"
