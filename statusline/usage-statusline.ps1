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
$Tick  = [char]9648
$Blank = [char]9649

function Get-DefaultOr([string]$Value, [string]$Default) {
    if ([string]::IsNullOrEmpty($Value)) { $Default } else { $Value }
}

# Threshold color for a usage percentage: green, yellow >=70, red >=90.
function Get-UsageColor([int]$Pct) {
    if ($Pct -ge 90) { "$Esc[31m" } elseif ($Pct -ge 70) { "$Esc[33m" } else { "$Esc[32m" }
}

# 10-cell fill bar, 1 cell = 10%, ceiling so any nonzero usage shows one
# cell. Filled cells in the threshold color, empty cells dim.
function Get-FillBar([int]$Pct) {
    $Cells = [Math]::Min(10, [int][Math]::Ceiling($Pct / 10.0))
    $Color = Get-UsageColor $Pct
    return "$Color$("$Tick" * $Cells)$Esc[0m$Esc[90m$("$Blank" * (10 - $Cells))$Esc[0m"
}

# Compact token count: 101889 -> 102k, 1000000 -> 1M.
function Format-Tokens([long]$N) {
    if ($N -ge 1000000) {
        $M = $N / 1000000.0
        if ($M -eq [Math]::Floor($M)) { return ('{0}M' -f [long]$M) }
        return ('{0:0.0}M' -f $M)
    }
    if ($N -ge 1000) { return ('{0}k' -f [long][Math]::Round($N / 1000.0)) }
    return [string]$N
}

# --- 1. stdin -> JSON (malformed/empty => $null, display degrades) ---
$Status = $null
try {
    $Raw = [Console]::In.ReadToEnd()
    if (-not [string]::IsNullOrWhiteSpace($Raw)) { $Status = $Raw | ConvertFrom-Json }
} catch { $Status = $null }

# --- 2. display pieces: repo@branch · model · effort · ctx bar+tokens ·
#        5h bar · 7d bar · cost ---
$Pieces = @()
if ($Status) {
    # Location: repo@branch when cwd is in a git checkout (worktrees show
    # their own dir name), bare folder name otherwise, short SHA when
    # detached. Git runs through cmd /c with 2>nul — under EAP Stop, a
    # PowerShell-level stderr redirect of a native command throws.
    try {
        $Dir = $(if ($Status.workspace -and $Status.workspace.current_dir) { [string]$Status.workspace.current_dir } else { [string]$Status.cwd })
        if ($Dir -and (Test-Path -LiteralPath $Dir)) {
            $Loc = ''
            $Top = & cmd /c "git -C `"$Dir`" rev-parse --show-toplevel 2>nul"
            if ($LASTEXITCODE -eq 0 -and $Top) {
                $Loc = Split-Path -Leaf ([string]$Top)
                $Branch = & cmd /c "git -C `"$Dir`" branch --show-current 2>nul"
                if ($LASTEXITCODE -eq 0 -and [string]::IsNullOrEmpty($Branch)) {
                    $Branch = & cmd /c "git -C `"$Dir`" rev-parse --short HEAD 2>nul"
                    if ($LASTEXITCODE -ne 0) { $Branch = '' }
                }
                if ($Branch) { $Loc = "$Loc@$Branch" }
            } else {
                $Loc = Split-Path -Leaf $Dir
            }
            if ($Loc) { $Pieces += $Loc }
        }
    } catch { }
    if ($Status.model -and $Status.model.display_name) { $Pieces += [string]$Status.model.display_name }
    if ($Status.effort -and $Status.effort.level) { $Pieces += [string]$Status.effort.level }
    $CW = $Status.context_window
    if ($CW -and $null -ne $CW.used_percentage) {
        $CtxPct = [int]$CW.used_percentage
        $Counts = ''
        if ($CW.current_usage -and $null -ne $CW.context_window_size) {
            $U = $CW.current_usage
            $Used = [long]0
            foreach ($F in @($U.input_tokens, $U.output_tokens, $U.cache_creation_input_tokens, $U.cache_read_input_tokens)) {
                if ($null -ne $F) { $Used += [long]$F }
            }
            $Counts = ' ' + (Format-Tokens $Used) + '/' + (Format-Tokens ([long]$CW.context_window_size))
        }
        $Pieces += "ctx $(Get-FillBar $CtxPct)$Counts $(Get-UsageColor $CtxPct)$CtxPct%$Esc[0m"
    }
    if ($Status.rate_limits) {
        foreach ($Win in @(
            @{ Key = 'five_hour'; Label = '5h'; Fmt = 'HH:mm' },
            @{ Key = 'seven_day'; Label = '7d'; Fmt = 'ddd' }
        )) {
            $W = $Status.rate_limits.($Win.Key)
            if ($W -and $null -ne $W.used_percentage) {
                $Pct = [int]$W.used_percentage
                $When = ''
                if ($null -ne $W.resets_at) {
                    $When = "$Arrow" + [DateTimeOffset]::FromUnixTimeSeconds([long]$W.resets_at).ToLocalTime().ToString($Win.Fmt)
                }
                $Pieces += "$($Win.Label) $(Get-FillBar $Pct) $(Get-UsageColor $Pct)$Pct%$Esc[0m$When"
            }
        }
    }
    if ($Status.cost -and $null -ne $Status.cost.total_cost_usd) {
        $Pieces += ('$' + ('{0:0.00}' -f [double]$Status.cost.total_cost_usd))
    }
}

# --- 3. emit. Never blank: a blank statusline is indistinguishable from a
#        crashed one (cold review F4) — degrade to sentinel. ---
if ($Pieces.Count -eq 0) { $Pieces = @('[statusline]') }
[Console]::Write(($Pieces -join " $Dot "))

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
