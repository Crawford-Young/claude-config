# usage-statusline.ps1 — Claude Code statusLine entry point.
# stdin: statusline JSON (documented, code:statusline.md). stdout: one line,
# caveman badge + 5h/7d rate-limit segment. Also appends a throttled usage
# sample to the history log (Task 2). Fail-open: display renders even when
# parsing or logging fails; never exits non-zero.
# PS 5.1 target. ASCII-only source; display glyphs from code points.
$ErrorActionPreference = 'Stop'
# Claude Code decodes statusline stdout as UTF-8; PS 5.1 default on redirected
# stdout is the OEM code page (CP437), which mangles the arrow/dot glyphs
# (cold review F1 — U+2192 becomes 0x1A, U+00B7 becomes invalid byte 0xFA).
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$Esc   = [char]27
$Arrow = [char]8594
$Dot   = [char]183

function Get-DefaultOr([string]$Value, [string]$Default) {
    if ([string]::IsNullOrEmpty($Value)) { $Default } else { $Value }
}

# --- 1. stdin -> JSON (malformed/empty => $null, display degrades) ---
$Status = $null
try {
    $Raw = [Console]::In.ReadToEnd()
    if (-not [string]::IsNullOrWhiteSpace($Raw)) { $Status = $Raw | ConvertFrom-Json }
} catch { $Status = $null }

# --- 2. caveman badge. Child process is mandatory: the plugin script calls
#        `exit`, which would terminate an in-process caller. ---
$Badge = ''
try {
    $CaveRoot = Get-DefaultOr $env:CLAUDE_USAGE_CAVEMAN_ROOT (Join-Path $HOME '.claude\plugins\cache\caveman\caveman')
    if (Test-Path $CaveRoot) {
        $CaveScript = Get-ChildItem -Path $CaveRoot -Directory |
            Sort-Object LastWriteTime -Descending |
            ForEach-Object { Join-Path $_.FullName 'hooks\caveman-statusline.ps1' } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($CaveScript) {
            $Badge = (@(& powershell -NoProfile -ExecutionPolicy Bypass -File $CaveScript) -join '')
        }
    }
} catch { $Badge = '' }

# --- 3. usage segment ---
$Segment = ''
if ($Status -and $Status.rate_limits) {
    $Parts = @()
    foreach ($Win in @(
        @{ Key = 'five_hour'; Label = '5h'; Fmt = 'HH:mm' },
        @{ Key = 'seven_day'; Label = '7d'; Fmt = 'ddd' }
    )) {
        $W = $Status.rate_limits.($Win.Key)
        if ($W -and $null -ne $W.used_percentage) {
            $Pct = [int]$W.used_percentage
            $Color = $(if ($Pct -ge 90) { "$Esc[31m" } elseif ($Pct -ge 70) { "$Esc[33m" } else { '' })
            $ResetCode = $(if ($Color) { "$Esc[0m" } else { '' })
            $When = ''
            if ($null -ne $W.resets_at) {
                $When = "$Arrow" + [DateTimeOffset]::FromUnixTimeSeconds([long]$W.resets_at).ToLocalTime().ToString($Win.Fmt)
            }
            $Parts += "$($Win.Label) $Color$Pct%$ResetCode$When"
        }
    }
    if ($Parts.Count -gt 0) { $Segment = $Parts -join " $Dot " }
}

# --- 4. emit. Never blank: a blank statusline is indistinguishable from a
#        crashed one (cold review F4) — degrade to model name, then sentinel. ---
$Pieces = @($Badge, $Segment) | Where-Object { $_ }
if ($Pieces.Count -eq 0) {
    $Fallback = $(if ($Status -and $Status.model -and $Status.model.display_name) { [string]$Status.model.display_name } else { '[statusline]' })
    $Pieces = @($Fallback)
}
[Console]::Write(($Pieces -join ' | '))

# --- 5. history sample: Task 2 ---
exit 0
