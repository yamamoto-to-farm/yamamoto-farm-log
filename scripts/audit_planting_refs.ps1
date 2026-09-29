param(
  [string]$InputPath = "logs/planting/all.csv",
  [string]$OutputPath = "logs/planting/planting-ref-duplicates.csv"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $InputPath)) {
  throw "定植CSVが見つかりません: $InputPath"
}

$rows = @(Import-Csv -Path $InputPath -Encoding UTF8)
$report = foreach ($group in ($rows | Where-Object { $_.plantingRef } | Group-Object plantingRef)) {
  $distinct = @($group.Group | Select-Object date, plantDate, field, variety, seedRef, quantity, trayType -Unique)
  if ($distinct.Count -gt 1) {
    foreach ($row in $distinct) {
      [pscustomobject]@{
        plantingRef = $group.Name
        duplicateCount = $group.Count
        distinctDefinitionCount = $distinct.Count
        date = $row.date
        plantDate = $row.plantDate
        field = $row.field
        variety = $row.variety
        seedRef = $row.seedRef
        quantity = $row.quantity
        trayType = $row.trayType
      }
    }
  }
}

$parent = Split-Path -Parent $OutputPath
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent | Out-Null
}

if (@($report).Count -gt 0) {
  $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
  Write-Output "重複候補: $(@($report).Count) 行"
  Write-Output "出力: $OutputPath"
} else {
  "plantingRef,duplicateCount,distinctDefinitionCount,date,plantDate,field,variety,seedRef,quantity,trayType" | Set-Content -Path $OutputPath -Encoding UTF8
  Write-Output "重複候補はありません"
}
