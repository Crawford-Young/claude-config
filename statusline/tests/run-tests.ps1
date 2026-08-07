# run-tests.ps1 — plain assert runner (no framework; machine Pester is 3.4.0).
# Invokes usage-statusline.ps1 as a child process per test, exactly as the
# harness does, feeding fixtures via stdin.
$ErrorActionPreference = 'Stop'
# Decode child stdout as UTF-8 — default OEM CP437 turns U+2192 into 0x1A and
# makes the U+00B7 capture round-trip lossless while the real wire is broken
# (cold review F1). Must match the UTF8 write side in usage-statusline.ps1.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path (Split-Path -Parent $Here) 'usage-statusline.ps1'
$Fixtures = Join-Path $Here 'fixtures'
$Arrow = [char]8594
$Tick  = [char]9648
$Blank = [char]9649
$Dot   = [char]183

# Bar helper mirrors the script's spec: 10 cells, 1 cell = 10%,
# filled = min(10, ceil(pct/10)) so any nonzero usage shows one cell.
function Get-Bar([int]$Pct) {
    $n = [Math]::Min(10, [int][Math]::Ceiling($Pct / 10.0))
    return ("$Tick" * $n) + ("$Blank" * (10 - $n))
}

# ANSI-stripped view: layout asserted plain, colors asserted separately on raw.
function Get-Plain([string]$s) {
    return ($s -replace "$([char]27)\[[0-9;]*m", '')
}

$script:Pass = 0
$script:Fail = 0
function Assert-True([bool]$Cond, [string]$Name) {
    if ($Cond) { $script:Pass++; Write-Host "PASS  $Name" }
    else { $script:Fail++; Write-Host "FAIL  $Name" }
}

function New-TestTmp {
    $d = Join-Path $env:TEMP ("usage-sl-test-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $d -Force | Out-Null
    return $d
}

function Invoke-Statusline([string]$FixturePath, [hashtable]$EnvVars) {
    foreach ($k in $EnvVars.Keys) { Set-Item -Path ("Env:" + $k) -Value $EnvVars[$k] }
    try {
        $raw = [System.IO.File]::ReadAllText($FixturePath)
        $out = $raw | & powershell -NoProfile -ExecutionPolicy Bypass -File $Script
        $script:LastExit = $LASTEXITCODE
        return (@($out) -join "`n")
    } finally {
        foreach ($k in $EnvVars.Keys) { Remove-Item -Path ("Env:" + $k) -ErrorAction SilentlyContinue }
    }
}

# ---- D1: full fixture renders model/effort, ctx bar with token counts,
#          both rate windows as bars, and session cost ----
# ctx tokens = sum of current_usage fields in full.json:
# 2 + 2062 + 726 + 99099 = 101,889 -> "102k"; window 1,000,000 -> "1M".
$tmp = New-TestTmp
$out = Invoke-Statusline (Join-Path $Fixtures 'full.json') @{
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp
}
$plain = Get-Plain $out
$exp5h = [DateTimeOffset]::FromUnixTimeSeconds(1786074000).ToLocalTime().ToString('HH:mm')
$exp7d = [DateTimeOffset]::FromUnixTimeSeconds(1786618800).ToLocalTime().ToString('ddd')
$esc = [char]27
Assert-True ($plain.Contains("Fable 5 $Dot high")) 'D1 model/effort prefix'
Assert-True ($plain.Contains("ctx $(Get-Bar 10) 102k/1M 10%")) 'D1 ctx bar with token counts'
Assert-True ($plain.Contains("5h $(Get-Bar 22) 22%$Arrow$exp5h")) 'D1 five-hour bar segment'
Assert-True ($plain.Contains("7d $(Get-Bar 4) 4%$Arrow$exp7d")) 'D1 seven-day bar segment'
Assert-True ($plain.Contains('$3.13')) 'D1 session cost'
Assert-True ($out.Contains("$esc[32m")) 'D1 green fill below 70'
Assert-True (-not $out.Contains('CAVE')) 'D1 no caveman badge'
Assert-True ($script:LastExit -eq 0) 'D1 exit 0'

# ---- D2: no rate_limits => prefix/ctx/cost only, no rate bars ----
$tmp2 = New-TestTmp
$out = Invoke-Statusline (Join-Path $Fixtures 'no-rate-limits.json') @{
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp2 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp2
}
Assert-True ((Get-Plain $out) -eq "Fable 5 $Dot high $Dot ctx $(Get-Bar 10) 102k/1M 10% $Dot `$3.13") 'D2 prefix-only fallback'
Assert-True (-not $out.Contains('5h ')) 'D2 no five-hour segment'
Assert-True ($script:LastExit -eq 0) 'D2 exit 0'

# ---- D3: malformed stdin => sentinel line, never blank, exit 0 ----
$tmp3 = New-TestTmp
$out = Invoke-Statusline (Join-Path $Fixtures 'malformed.json') @{
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp3 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp3
}
Assert-True ($out -eq '[statusline]') 'D3 sentinel on malformed input'
Assert-True ($script:LastExit -eq 0) 'D3 exit 0'

# ---- D4: color thresholds (92 => red 31, 75 => yellow 33) + quartered layout ----
$tmp4 = New-TestTmp
$out = Invoke-Statusline (Join-Path $Fixtures 'high-usage.json') @{
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp4 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp4
}
$plain4 = Get-Plain $out
Assert-True ($plain4.Contains("5h $(Get-Bar 92) 92%")) 'D4 five-hour full bar at 92'
Assert-True ($plain4.Contains("7d $(Get-Bar 75) 75%")) 'D4 seven-day 8-cell bar at 75'
Assert-True ($out.Contains("$esc[31m")) 'D4 red present at 92'
Assert-True ($out.Contains("$esc[33m")) 'D4 yellow present at 75'
Assert-True ($script:LastExit -eq 0) 'D4 exit 0'

# ---- H1: full fixture appends one schema-complete sample ----
$tmp7 = New-TestTmp
$hist7 = Join-Path $tmp7 'hist'
$out = Invoke-Statusline (Join-Path $Fixtures 'full.json') @{
    CLAUDE_USAGE_HISTORY_DIR  = $hist7
    CLAUDE_USAGE_THROTTLE_DIR = $tmp7
}
$logFile = Join-Path $hist7 ([DateTimeOffset]::Now.ToString('yyyy-MM') + '.jsonl')
Assert-True (Test-Path $logFile) 'H1 log file created'
$lines = @([System.IO.File]::ReadAllLines($logFile))
Assert-True ($lines.Count -eq 1) 'H1 exactly one line'
$s = $lines[0] | ConvertFrom-Json
Assert-True ($s.session_id -eq '4ebbd908-ff44-4647-a06b-2f807203d3b8') 'H1 session_id'
Assert-True ($s.five_hour_pct -eq 22) 'H1 five_hour_pct'
Assert-True ($s.seven_day_pct -eq 4) 'H1 seven_day_pct'
Assert-True ($s.cache_read_tokens -eq 99099) 'H1 cache_read_tokens'
Assert-True ($s.model_id -eq 'claude-fable-5') 'H1 model_id'
Assert-True ($null -ne $s.ts) 'H1 ts present'
$stateFile = Join-Path $tmp7 'claude-usage-throttle-4ebbd908-ff44-4647-a06b-2f807203d3b8.txt'
Assert-True (Test-Path $stateFile) 'H1 throttle state written'

# ---- H2: recent state file suppresses append; stale one allows it ----
$tmp8 = New-TestTmp
$hist8 = Join-Path $tmp8 'hist'
$state8 = Join-Path $tmp8 'claude-usage-throttle-4ebbd908-ff44-4647-a06b-2f807203d3b8.txt'
$nowEpoch = [DateTimeOffset]::Now.ToUnixTimeSeconds()
[System.IO.File]::WriteAllText($state8, [string]($nowEpoch - 30))
Invoke-Statusline (Join-Path $Fixtures 'full.json') @{
    CLAUDE_USAGE_HISTORY_DIR  = $hist8
    CLAUDE_USAGE_THROTTLE_DIR = $tmp8
} | Out-Null
$logFile8 = Join-Path $hist8 ([DateTimeOffset]::Now.ToString('yyyy-MM') + '.jsonl')
Assert-True (-not (Test-Path $logFile8)) 'H2 30s-old state suppresses sample'
[System.IO.File]::WriteAllText($state8, [string]($nowEpoch - 120))
Invoke-Statusline (Join-Path $Fixtures 'full.json') @{
    CLAUDE_USAGE_HISTORY_DIR  = $hist8
    CLAUDE_USAGE_THROTTLE_DIR = $tmp8
} | Out-Null
Assert-True ((Test-Path $logFile8) -and (@([System.IO.File]::ReadAllLines($logFile8)).Count -eq 1)) 'H2 120s-old state allows sample'

# ---- H3: no rate_limits still logs a sample with nulls ----
$tmp9 = New-TestTmp
$hist9 = Join-Path $tmp9 'hist'
Invoke-Statusline (Join-Path $Fixtures 'no-rate-limits.json') @{
    CLAUDE_USAGE_HISTORY_DIR  = $hist9
    CLAUDE_USAGE_THROTTLE_DIR = $tmp9
} | Out-Null
$logFile9 = Join-Path $hist9 ([DateTimeOffset]::Now.ToString('yyyy-MM') + '.jsonl')
Assert-True (Test-Path $logFile9) 'H3 sample logged without rate_limits'
$s9 = @([System.IO.File]::ReadAllLines($logFile9))[0] | ConvertFrom-Json
Assert-True ($null -eq $s9.five_hour_pct) 'H3 five_hour_pct null'
Assert-True ($null -ne $s9.cost_usd) 'H3 cost_usd still captured'

Write-Host ""
Write-Host "$($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
