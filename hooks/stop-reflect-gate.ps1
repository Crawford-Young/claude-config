# stop-reflect-gate.ps1 - Stop hook: hard-block turn end when a recently-touched
# active checklist is fully ticked except its reflect line(s) (G48, 2026-08-08).
# The reflect duty is repeatedly missed when left to prose; this is the
# deterministic backstop. Block = exit 2 + stderr reason (Stop is blockable).
# HARD BLOCK by user decision (P4c spec): no stop_hook_active self-disarm - the
# platform's 8-consecutive-block cap is the escape hatch.
# Scope guards: 6h mtime window (cross-session exposure - hooks/README.md
# warn-rule override documented there); fenced code blocks excluded from
# checkbox counting. Fail-open (exit 0) on any script error.
try {
    $null = [Console]::In.ReadToEnd()
    $docsRoot = if ($env:STOP_GATE_DOCS_ROOT) { $env:STOP_GATE_DOCS_ROOT } else { 'C:/Users/young/code/docs' }
    $cutoff = (Get-Date).AddHours(-6)
    $patterns = @("$docsRoot/*/checklists/active/*.md", "$docsRoot/*/*/checklists/active/*.md")
    foreach ($pattern in $patterns) {
        foreach ($file in @(Get-Item -Path $pattern -ErrorAction SilentlyContinue)) {
            if ($file.LastWriteTime -lt $cutoff) { continue }
            $inFence = $false
            $ticked = 0
            $unticked = @()
            foreach ($line in @(Get-Content -Path $file.FullName -ErrorAction Stop)) {
                if ($line -match '^\s*(```|~~~)') { $inFence = -not $inFence; continue }
                if ($inFence) { continue }
                if ($line -match '^\s*- \[ \]') { $unticked += $line }
                elseif ($line -match '^\s*- \[x\]') { $ticked++ }
            }
            if ($ticked -eq 0 -or $unticked.Count -eq 0) { continue }
            $nonReflect = @($unticked | Where-Object { $_ -notmatch '(?i)reflect' })
            if ($nonReflect.Count -eq 0) {
                [Console]::Error.WriteLine("stop-reflect-gate: $($file.Name) is fully ticked except its reflect line(s) - run claude-md-management:reflect and tick it before ending the turn. If reflect is mid-dialogue (awaiting user input), tick the line with an in-progress annotation - the Reflect Log is the completion record (pattern ruled 2026-08-09 W1).")
                exit 2
            }
        }
    }
    exit 0
} catch {
    try {
        $log = Join-Path $env:USERPROFILE '.claude/hook-errors.log'
        Add-Content -Path $log -Value "[$(Get-Date -Format o)] stop-reflect-gate.ps1: $($_.Exception.Message)"
    } catch {}
    exit 0
}
