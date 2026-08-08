# subagentstop-log.ps1 - one line per subagent stop; nudge net for perf-MD write-as-you-go. Fail-open.
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $sid = if ($payload.session_id) { $payload.session_id } else { '?' }
  # G42 (2026-08-08): size-cap trim - log is append-only ASCII lines (ISO date +
  # session id), so a PS round-trip is safe here (P2 precedent: the CLAUDE.md
  # round-trip rule targets UTF-8 text-file mutation). Fail-open: trim errors
  # never block the real append below. Worst case a concurrent SubagentStop
  # append landing between Get-Content and Set-Content loses <=1 line -
  # accepted for a diagnostic log (cold review m2).
  try {
    $log = Join-Path $env:USERPROFILE '.claude\subagent-stops.log'
    if ((Test-Path $log) -and ((Get-Item $log).Length -gt 512KB)) {
      $tail = Get-Content $log -Tail 200
      Set-Content -Path $log -Value $tail
    }
  } catch {}
  Add-Content -Path (Join-Path $env:USERPROFILE '.claude\subagent-stops.log') -Value "$(Get-Date -Format o) subagent-stop session=$sid"
} catch {}
exit 0
