# subagentstop-log.ps1 - one line per subagent stop; nudge net for perf-MD write-as-you-go. Fail-open.
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $sid = if ($payload.session_id) { $payload.session_id } else { '?' }
  Add-Content -Path (Join-Path $env:USERPROFILE '.claude\subagent-stops.log') -Value "$(Get-Date -Format o) subagent-stop session=$sid"
} catch {}
exit 0
