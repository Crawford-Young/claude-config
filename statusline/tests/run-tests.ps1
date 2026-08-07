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

function New-FakeCaveman([string]$Root, [string]$DirName, [string]$Badge) {
    $hooks = Join-Path (Join-Path $Root $DirName) 'hooks'
    New-Item -ItemType Directory -Path $hooks -Force | Out-Null
    $stub = '[Console]::Write("' + $Badge + '")'
    [System.IO.File]::WriteAllText((Join-Path $hooks 'caveman-statusline.ps1'), $stub)
    return (Join-Path $Root $DirName)
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

# ---- D1: full fixture renders both windows + badge ----
$tmp = New-TestTmp
$root = Join-Path $tmp 'cave'
New-FakeCaveman $root 'aaaa1111' '[FAKECAVEMAN]' | Out-Null
$out = Invoke-Statusline (Join-Path $Fixtures 'full.json') @{
    CLAUDE_USAGE_CAVEMAN_ROOT = $root
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp
}
$exp5h = [DateTimeOffset]::FromUnixTimeSeconds(1786074000).ToLocalTime().ToString('HH:mm')
$exp7d = [DateTimeOffset]::FromUnixTimeSeconds(1786618800).ToLocalTime().ToString('ddd')
Assert-True ($out.Contains('[FAKECAVEMAN]')) 'D1 badge present'
Assert-True ($out.Contains("5h 22%$Arrow$exp5h")) 'D1 five-hour segment'
Assert-True ($out.Contains("7d 4%$Arrow$exp7d")) 'D1 seven-day segment'
Assert-True ($script:LastExit -eq 0) 'D1 exit 0'

# ---- D2: no rate_limits => badge only, no segment ----
$tmp2 = New-TestTmp
$root2 = Join-Path $tmp2 'cave'
New-FakeCaveman $root2 'aaaa1111' '[FAKECAVEMAN]' | Out-Null
$out = Invoke-Statusline (Join-Path $Fixtures 'no-rate-limits.json') @{
    CLAUDE_USAGE_CAVEMAN_ROOT = $root2
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp2 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp2
}
Assert-True ($out.Contains('[FAKECAVEMAN]')) 'D2 badge present'
Assert-True (-not $out.Contains('5h ')) 'D2 no five-hour segment'
Assert-True ($script:LastExit -eq 0) 'D2 exit 0'

# ---- D3: malformed stdin => badge only, exit 0 ----
$tmp3 = New-TestTmp
$root3 = Join-Path $tmp3 'cave'
New-FakeCaveman $root3 'aaaa1111' '[FAKECAVEMAN]' | Out-Null
$out = Invoke-Statusline (Join-Path $Fixtures 'malformed.json') @{
    CLAUDE_USAGE_CAVEMAN_ROOT = $root3
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp3 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp3
}
Assert-True ($out.Contains('[FAKECAVEMAN]')) 'D3 badge present on malformed input'
Assert-True ($script:LastExit -eq 0) 'D3 exit 0'

# ---- D4: color thresholds (92 => red 31, 75 => yellow 33) ----
$tmp4 = New-TestTmp
$root4 = Join-Path $tmp4 'cave'
New-FakeCaveman $root4 'aaaa1111' '[FAKECAVEMAN]' | Out-Null
$out = Invoke-Statusline (Join-Path $Fixtures 'high-usage.json') @{
    CLAUDE_USAGE_CAVEMAN_ROOT = $root4
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp4 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp4
}
$esc = [char]27
Assert-True ($out.Contains("$esc[31m92%")) 'D4 five-hour red at 92'
Assert-True ($out.Contains("$esc[33m75%")) 'D4 seven-day yellow at 75'

# ---- C1: caveman root missing => segment only, exit 0 ----
$tmp5 = New-TestTmp
$out = Invoke-Statusline (Join-Path $Fixtures 'full.json') @{
    CLAUDE_USAGE_CAVEMAN_ROOT = (Join-Path $tmp5 'does-not-exist')
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp5 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp5
}
Assert-True (-not $out.Contains('FAKECAVEMAN')) 'C1 no badge'
Assert-True ($out.Contains('5h 22%')) 'C1 segment still renders'
Assert-True ($script:LastExit -eq 0) 'C1 exit 0'

# ---- D5: malformed stdin + no caveman => sentinel line, never blank ----
$tmpA = New-TestTmp
$out = Invoke-Statusline (Join-Path $Fixtures 'malformed.json') @{
    CLAUDE_USAGE_CAVEMAN_ROOT = (Join-Path $tmpA 'does-not-exist')
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmpA 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmpA
}
Assert-True ($out -eq '[statusline]') 'D5 sentinel on fully-degraded input'
Assert-True ($script:LastExit -eq 0) 'D5 exit 0'

# ---- C2: two hash dirs => newest LastWriteTime wins ----
$tmp6 = New-TestTmp
$root6 = Join-Path $tmp6 'cave'
$old = New-FakeCaveman $root6 'oldhash' '[OLDCAVE]'
New-FakeCaveman $root6 'newhash' '[NEWCAVE]' | Out-Null
(Get-Item $old).LastWriteTime = (Get-Date).AddDays(-30)
$out = Invoke-Statusline (Join-Path $Fixtures 'full.json') @{
    CLAUDE_USAGE_CAVEMAN_ROOT = $root6
    CLAUDE_USAGE_HISTORY_DIR  = (Join-Path $tmp6 'hist')
    CLAUDE_USAGE_THROTTLE_DIR = $tmp6
}
Assert-True ($out.Contains('[NEWCAVE]')) 'C2 newest hash dir wins'
Assert-True (-not $out.Contains('[OLDCAVE]')) 'C2 old hash dir ignored'

Write-Host ""
Write-Host "$($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
