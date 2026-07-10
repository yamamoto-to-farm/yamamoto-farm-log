$ErrorActionPreference = 'Stop'

function Normalize-Worker([object]$raw){
  if($null -eq $raw){ return '' }
  if($raw -is [System.Collections.IEnumerable] -and -not ($raw -is [string])){
    return (@($raw) | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) -join '／'
  }
  $txt = "$raw".Trim()
  if(-not $txt){ return '' }
  if($txt -match '[、,]'){
    return (($txt -split '[、,]') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join '／'
  }
  return $txt
}

function Parse-FieldTokens([string]$fieldText){
  if(-not $fieldText){ return @() }
  return @($fieldText -split '[／/]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Build-EntryMap([string]$folder){
  $map = @{}
  $dir = "logs/$folder"
  if(-not (Test-Path $dir)){ return $map }

  Get-ChildItem $dir -File -Filter '*.json' | ForEach-Object {
    $fieldName = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
    try { $obj = Get-Content $_.FullName -Raw | ConvertFrom-Json -Depth 50 } catch { return }
    if(-not $obj.years){ return }

    foreach($yearProp in $obj.years.PSObject.Properties){
      foreach($entry in @($yearProp.Value.entries)){
        if(-not $entry){ continue }
        $date = "$($entry.date)".Trim()
        if(-not $date){ continue }
        $worker = Normalize-Worker $entry.workers
        $machine = "$($entry.machine)".Trim()
        $workType = "$($entry.workType)".Trim()
        $method = ''
        if($folder -eq 'weeding'){
          $spray = "$($entry.sprayMethod)".Trim()
          $mow = "$($entry.mowingMethod)".Trim()
          $method = if($spray){ $spray } elseif($mow){ $mow } else { '' }
        }

        $key = "{0}|{1}|{2}|{3}" -f $date,$worker,$machine,$fieldName
        if(-not $map.ContainsKey($key)){
          $map[$key] = [pscustomobject]@{ workType=$workType; method=$method }
        }
      }
    }
  }

  return $map
}

function Get-ResolvedInfo($row, $entryMap, [string]$folder){
  $date = "$($row.date)".Trim()
  $worker = Normalize-Worker $row.worker
  $machine = "$($row.machine)".Trim()
  $fields = Parse-FieldTokens "$($row.field)"

  $hits = @()
  foreach($f in $fields){
    $k = "{0}|{1}|{2}|{3}" -f $date,$worker,$machine,$f
    if($entryMap.ContainsKey($k)){ $hits += $entryMap[$k] }
  }

  $workType = "$($row.workType)".Trim()
  $method = "$($row.method)".Trim()

  if($workType -like '無効なパラメーターです -*'){
    $workType = ($workType -replace '^無効なパラメーターです\s*-\s*','').Trim()
  }

  if($method -eq 'System.Object[]'){ $method = '' }

  if(-not $workType -and $hits.Count -gt 0){
    $workType = ($hits | ForEach-Object { $_.workType } | Where-Object { $_ } | Select-Object -Unique | Select-Object -First 1)
  }

  if($folder -eq 'weeding' -and -not $method -and $hits.Count -gt 0){
    $method = ($hits | ForEach-Object { $_.method } | Where-Object { $_ } | Select-Object -Unique | Select-Object -First 1)
  }

  return [pscustomobject]@{ workType = "$workType".Trim(); method = "$method".Trim() }
}

function Rewrite-AllCsv([string]$folder){
  $path = "logs/$folder/all.csv"
  if(-not (Test-Path $path)){ Write-Output "skip $folder (missing)"; return }

  $rows = @()
  try { $rows = @(Import-Csv $path) } catch { Write-Output "skip $folder (invalid csv)"; return }
  if($rows.Count -eq 0){
    Set-Content -Path $path -Value 'date,worker,field,machine,workType,method' -Encoding UTF8
    Write-Output "rewrote ${folder}: 0 rows"
    return
  }

  $map = Build-EntryMap $folder

  $outRows = foreach($r in $rows){
    $resolved = Get-ResolvedInfo $r $map $folder
    [pscustomobject]@{
      date = "$($r.date)".Trim()
      worker = "$($r.worker)".Trim()
      field = "$($r.field)".Trim()
      machine = "$($r.machine)".Trim()
      workType = $resolved.workType
      method = if($folder -eq 'weeding'){ $resolved.method } else { '' }
    }
  }

  $csv = $outRows | ConvertTo-Csv -NoTypeInformation
  $csv[0] = 'date,worker,field,machine,workType,method'
  Set-Content -Path $path -Value ($csv -join "`n") -Encoding UTF8
  Write-Output "rewrote ${folder}: $($outRows.Count) rows"
}

Rewrite-AllCsv 'tillage'
Rewrite-AllCsv 'weeding'
