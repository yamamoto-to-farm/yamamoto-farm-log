$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$detailPath = Join-Path $root "deploy\data\variety-detail.json"
$detail = Get-Content $detailPath -Raw -Encoding UTF8 | ConvertFrom-Json

foreach ($property in $detail.PSObject.Properties) {
    if ($null -eq $property.Value.gdd) {
        $property.Value | Add-Member -MemberType NoteProperty -Name gdd -Value ([pscustomobject]@{
            mode = "effective"
            targetGdd = $null
            dapRange = $null
            expectedCropType = $null
            seasonCorrection = [pscustomobject]@{
                lowSun = $null
                lowTemp = $null
            }
        })
    } else {
        $property.Value.gdd.mode = "effective"
    }
}

$json = $detail | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($detailPath, $json + [Environment]::NewLine, $utf8NoBom)

Write-Host "Migrated $($detail.PSObject.Properties.Count) variety GDD settings to effective: $detailPath"
