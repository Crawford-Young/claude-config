# usage-statusline.ps1 — Claude Code statusLine entry point.
# stdin: statusline JSON (documented, code:statusline.md). stdout: one line,
# 5h/7d rate-limit fill bars. Also appends a throttled usage sample to the
# history log (Task 2). Fail-open: display renders even when parsing or
# logging fails; never exits non-zero.
# PS 5.1 target. ASCII-only source; display glyphs from code points.
$ErrorActionPreference = 'Stop'
# Claude Code decodes statusline stdout as UTF-8; PS 5.1 default on redirected
# stdout is the OEM code page (CP437), which mangles the arrow/dot glyphs
# (cold review F1 — U+2192 becomes 0x1A, U+00B7 becomes invalid byte 0xFA).
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$Esc   = [char]27
$Arrow = [char]8594
$Dot   = [char]183
$Full  = [char]9608
$Empty = [char]9617

function Get-DefaultOr([string]$Value, [string]$Default) {
    if ([string]::IsNullOrEmpty($Value)) { $Default } else { $Value }
}

# --- 1. stdin -> JSON (malformed/empty => $null, display degrades) ---
$Status = $null
try {
    $Raw = [Console]::In.ReadToEnd()
    if (-not [string]::IsNullOrWhiteSpace($Raw)) { $Status = $Raw | ConvertFrom-Json }
} catch { $Status = $null }

# --- 2. usage segment: 8-cell fill bar per window ---
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
            # Ceiling so any nonzero usage shows at least one filled cell.
            $Cells = [Math]::Min(8, [int][Math]::Ceiling($Pct / 12.5))
            $Bar = ("$Full" * $Cells) + ("$Empty" * (8 - $Cells))
            $Color = $(if ($Pct -ge 90) { "$Esc[31m" } elseif ($Pct -ge 70) { "$Esc[33m" } else { '' })
            $ResetCode = $(if ($Color) { "$Esc[0m" } else { '' })
            $When = ''
            if ($null -ne $W.resets_at) {
                $When = "$Arrow" + [DateTimeOffset]::FromUnixTimeSeconds([long]$W.resets_at).ToLocalTime().ToString($Win.Fmt)
            }
            $Parts += "$($Win.Label) $Color$Bar $Pct%$ResetCode$When"
        }
    }
    if ($Parts.Count -gt 0) { $Segment = $Parts -join " $Dot " }
}

# --- 3. emit. Never blank: a blank statusline is indistinguishable from a
#        crashed one (cold review F4) — degrade to model name, then sentinel. ---
if (-not $Segment) {
    $Segment = $(if ($Status -and $Status.model -and $Status.model.display_name) { [string]$Status.model.display_name } else { '[statusline]' })
}
[Console]::Write($Segment)

# --- 5. history sample (throttled >= 60s/session; fail-open) ---
# State file read via Get-Content is a single ASCII epoch line, not a UTF-8
# text round-trip (the CLAUDE.md rule targets text-file mutation).
try {
    if ($Status -and $Status.session_id) {
        $HistoryDir  = Get-DefaultOr $env:CLAUDE_USAGE_HISTORY_DIR (Join-Path $HOME '.claude\usage-history')
        $ThrottleDir = Get-DefaultOr $env:CLAUDE_USAGE_THROTTLE_DIR $env:TEMP
        $NowEpoch = [DateTimeOffset]::Now.ToUnixTimeSeconds()
        $StateFile = Join-Path $ThrottleDir ('claude-usage-throttle-' + $Status.session_id + '.txt')
        $ShouldLog = $true
        if (Test-Path $StateFile) {
            $Last = 0L
            $FirstLine = Get-Content -LiteralPath $StateFile -TotalCount 1 -ErrorAction SilentlyContinue
            if ([long]::TryParse([string]$FirstLine, [ref]$Last)) {
                if (($NowEpoch - $Last) -lt 60) { $ShouldLog = $false }
            }
        }
        if ($ShouldLog) {
            if (-not (Test-Path $HistoryDir)) { New-Item -ItemType Directory -Path $HistoryDir -Force | Out-Null }
            $RL = $Status.rate_limits
            $CW = $Status.context_window
            $Sample = [ordered]@{
                ts                    = [DateTimeOffset]::Now.ToString('o')
                session_id            = $Status.session_id
                cwd                   = $Status.cwd
                model_id              = $(if ($Status.model) { $Status.model.id } else { $null })
                effort                = $(if ($Status.effort) { $Status.effort.level } else { $null })
                five_hour_pct         = $(if ($RL -and $RL.five_hour) { $RL.five_hour.used_percentage } else { $null })
                five_hour_resets_at   = $(if ($RL -and $RL.five_hour) { $RL.five_hour.resets_at } else { $null })
                seven_day_pct         = $(if ($RL -and $RL.seven_day) { $RL.seven_day.used_percentage } else { $null })
                seven_day_resets_at   = $(if ($RL -and $RL.seven_day) { $RL.seven_day.resets_at } else { $null })
                cost_usd              = $(if ($Status.cost) { $Status.cost.total_cost_usd } else { $null })
                context_pct           = $(if ($CW) { $CW.used_percentage } else { $null })
                context_window_size   = $(if ($CW) { $CW.context_window_size } else { $null })
                cache_read_tokens     = $(if ($CW -and $CW.current_usage) { $CW.current_usage.cache_read_input_tokens } else { $null })
                cache_creation_tokens = $(if ($CW -and $CW.current_usage) { $CW.current_usage.cache_creation_input_tokens } else { $null })
                exceeds_200k          = $Status.exceeds_200k_tokens
            }
            $LogFile = Join-Path $HistoryDir ([DateTimeOffset]::Now.ToString('yyyy-MM') + '.jsonl')
            [System.IO.File]::AppendAllText($LogFile, (($Sample | ConvertTo-Json -Compress) + "`n"))
            [System.IO.File]::WriteAllText($StateFile, [string]$NowEpoch)
        }
    }
} catch { }
exit 0
