# agent-model-guard.ps1 - blocks Agent dispatches that omit model: on a type
# with no frontmatter model, which would silently inherit the session default
# (claude-fable-5). Issue #3 / G4 companion. Explicit fable dispatches are
# handled by the Agent(model:...) ask rules, not here.
# Block = exit 2 + stderr reason (shown to the model). Fail-open on script error.
try {
  $raw = [Console]::In.ReadToEnd()
  $payload = $raw | ConvertFrom-Json
  $ti = $payload.tool_input
  if ($null -eq $ti) { exit 0 }
  if ($null -ne $ti.model -and "$($ti.model)" -ne '') { exit 0 }

  $type = "$($ti.subagent_type)"
  if ($type -ne '' -and $type -notmatch '[:\\/]') {
    $defPath = "C:/Users/young/code/claude-config/agents/$type.md"
    if ((Test-Path $defPath) -and (Select-String -Path $defPath -Pattern '^model:' -Quiet)) { exit 0 }
  }

  [Console]::Error.WriteLine("BLOCKED (issue #3/G4): Agent dispatch without model: on type '$type', which has no frontmatter model and would inherit the fable session default. Set model: explicitly from the profile's sweet spot (claude-config/agents/profiles/).")
  exit 2
} catch {
  try { Add-Content -Path (Join-Path $env:USERPROFILE '.claude\hook-errors.log') -Value "$(Get-Date -Format o) agent-model-guard: $_" } catch {}
  exit 0
}
