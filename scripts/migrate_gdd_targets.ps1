$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$varietiesPath = Join-Path $root "deploy\data\varieties.json"
$detailPath = Join-Path $root "deploy\data\variety-detail.json"
$targetsPath = Join-Path $root "deploy\data\gdd-targets.json"

$varieties = Get-Content $varietiesPath -Raw -Encoding UTF8 | ConvertFrom-Json
$detail = Get-Content $detailPath -Raw -Encoding UTF8 | ConvertFrom-Json
$currentTargets = if (Test-Path $targetsPath) {
    Get-Content $targetsPath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
    [pscustomobject]@{}
}

$targets = [ordered]@{}
foreach ($item in $varieties) {
    $name = [string]$item.name
    if ([string]::IsNullOrWhiteSpace($name)) { continue }

    $previous = $currentTargets.PSObject.Properties[$name]
    if ($null -ne $previous -and $null -ne $previous.Value) {
        $targets[$name] = $previous.Value
        continue
    }

    $detailEntry = $detail.PSObject.Properties[$name]
    $legacyGdd = if ($null -ne $detailEntry) { $detailEntry.Value.gdd } else { $null }
    $defaultTarget = if ($null -ne $legacyGdd -and $null -ne $legacyGdd.targetGdd) { $legacyGdd.targetGdd } else { $null }

    $targets[$name] = [ordered]@{
        mode = "effective"
        defaultTargetGdd = $defaultTarget
        targets = [ordered]@{}
    }

    if ($null -ne $detailEntry -and $null -ne $legacyGdd) {
        $detailEntry.Value.gdd.PSObject.Properties.Remove("targetGdd")
    }
}

$targetJson = $targets | ConvertTo-Json -Depth 10
$detailJson = $detail | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($targetsPath, $targetJson + [Environment]::NewLine, $utf8NoBom)
[System.IO.File]::WriteAllText($detailPath, $detailJson + [Environment]::NewLine, $utf8NoBom)

Write-Host "Migrated $($targets.Count) varieties to $targetsPath"
