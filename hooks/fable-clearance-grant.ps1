# fable-clearance-grant.ps1 - UserPromptSubmit hook. Grants ONE fable-dispatch
# clearance when the user's own prompt carries the token "FABLE OK".
# Paired consumer: agent-model-guard.ps1 (PreToolUse/Agent). P8 issue #4.
#
# This is NOT a hard gate. The marker is a file and the model holds Write/Bash.
# The asymmetry is that the normal path runs off a UserPromptSubmit payload,
# which only the user's own typing produces. Value = friction + audit trail.
# Fail-open on script error.
try {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
  $payload = $raw | ConvertFrom-Json
  $prompt = "$($payload.prompt)"
  if ($prompt -cnotmatch '\bFABLE OK\b') { exit 0 }

  $path = $env:FABLE_CLEARANCE_PATH
  if ([string]::IsNullOrEmpty($path)) { $path = Join-Path $env:USERPROFILE '.claude\fable-clearance.json' }

  $head = ($prompt -replace '\s+', ' ').Trim()
  if ($head.Length -gt 120) { $head = $head.Substring(0, 120) }

  $now = Get-Date
  $marker = [ordered]@{
    granted_at    = $now.ToString('o')
    granted_epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    uses_left     = 1
    prompt_head   = $head
  }
  [System.IO.File]::WriteAllText($path, ($marker | ConvertTo-Json -Compress))
  Write-Output "fable clearance granted: 1 dispatch, expires $($now.AddMinutes(30).ToString('HH:mm')). Not a hard gate - audit trail at fable-dispatch.log."
  exit 0
} catch {
  try { Add-Content -Path (Join-Path $env:USERPROFILE '.claude\hook-errors.log') -Value "$(Get-Date -Format o) fable-clearance-grant: $_" } catch {}
  exit 0
}
