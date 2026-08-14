$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$varietiesPath = Join-Path $root "deploy\data\varieties.json"
$detailPath = Join-Path $root "deploy\data\variety-detail.json"

$varieties = Get-Content $varietiesPath -Raw -Encoding UTF8 | ConvertFrom-Json
$current = Get-Content $detailPath -Raw -Encoding UTF8 | ConvertFrom-Json

$defaultGdd = [ordered]@{
    mode = "simple"
    targetGdd = $null
    dapRange = $null
    expectedCropType = $null
    seasonCorrection = [ordered]@{
        lowSun = $null
        lowTemp = $null
    }
}

$defaultDetail = [ordered]@{
    maker = ""
    sowingPeriod = ""
    harvestPeriod = ""
    bestGrowth = ""
    coldTolerance = ""
    features = ""
    memo = ""
    gdd = $defaultGdd
}

$next = [ordered]@{}
foreach ($item in $varieties) {
    $name = [string]$item.name
    if ([string]::IsNullOrWhiteSpace($name)) {
        continue
    }

    $previous = $current.PSObject.Properties[$name]
    $detail = [ordered]@{}
    $gddDetail = [ordered]@{}
    foreach ($property in $defaultDetail.Keys) {
        if ($property -eq "gdd") {
            foreach ($gddProperty in $defaultGdd.Keys) {
                $gddDetail[$gddProperty] = $defaultGdd[$gddProperty]
            }
            continue
        }
        $detail[$property] = $defaultDetail[$property]
    }

    if ($null -ne $previous -and $null -ne $previous.Value) {
        foreach ($property in $previous.Value.PSObject.Properties) {
            $detail[$property.Name] = $property.Value
        }
        $existingGdd = $previous.Value.PSObject.Properties["gdd"]
        if ($null -ne $existingGdd -and $null -ne $existingGdd.Value) {
            foreach ($gddProperty in $existingGdd.Value.PSObject.Properties) {
                $gddDetail[$gddProperty.Name] = $gddProperty.Value
            }
        }
    }

    $detail["gdd"] = $gddDetail
    $next[$name] = $detail
}

$json = $next | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($detailPath, $json + [Environment]::NewLine, $utf8NoBom)

Write-Host "Synchronized $($next.Count) variety detail entries: $detailPath"
