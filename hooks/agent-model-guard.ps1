# agent-model-guard.ps1 - guards WHICH MODEL an Agent dispatch runs on.
#
# Branch 1 (issue #3 / G4): a dispatch that omits model: on a type with no
# frontmatter model would silently inherit the session default model. Blocked.
#
# Branch 2 (P8 issue #4): an explicit fable dispatch without live user
# clearance. permissions.ask does NOT cover this - ask rules are inert under
# defaultMode auto (measured n=5, /feedback filed 2026-08-07). Clearance is
# granted by fable-clearance-grant.ps1 from the user's own prompt token.
# Speed bump plus audit trail, NOT a hard gate: the marker is a file and this
# model holds Write/Bash.
#
# The clearance is consumed HERE, at guard time. A dispatch that is later
# denied, or that errors on spawn, has still burned the single use.
#
# Block = exit 2 + stderr reason (shown to the model). Fail-open on script
# error - but scoped: a marker that will not parse reads as NO clearance, and a
# ledger that will not write never changes the verdict. Only a fault outside
# those two blocks turns the guard off.
try {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
  $payload = $raw | ConvertFrom-Json
  $ti = $payload.tool_input
  if ($null -eq $ti) { exit 0 }

  $type = "$($ti.subagent_type)"
  $explicitModel = "$($ti.model)"
  $model = $explicitModel
  $fromFrontmatter = $false

  if ($model -eq '' -and $type -ne '' -and $type -notmatch '[:\\/]') {
    $defPath = "C:/Users/young/code/claude-config/agents/$type.md"
    if (Test-Path $defPath) {
      $hit = Select-String -Path $defPath -Pattern '^model:' | Select-Object -First 1
      if ($null -ne $hit) {
        $model = ($hit.Line -replace '^model:\s*', '').Trim()
        $fromFrontmatter = $true
      }
    }
  }

  if ($model -match 'fable') {
    $clearPath = $env:FABLE_CLEARANCE_PATH
    if ([string]::IsNullOrEmpty($clearPath)) { $clearPath = Join-Path $env:USERPROFILE '.claude\fable-clearance.json' }
    $ledgerPath = $env:FABLE_LEDGER_PATH
    if ([string]::IsNullOrEmpty($ledgerPath)) { $ledgerPath = Join-Path $env:USERPROFILE '.claude\fable-dispatch.log' }

    $marker = $null
    $cleared = $false
    # Own try: an unreadable or malformed marker is NOT clearance, and must not
    # fall through to the outer catch (which would exit 0 and allow the dispatch).
    try {
      if (Test-Path $clearPath) {
        $marker = [System.IO.File]::ReadAllText($clearPath) | ConvertFrom-Json
        $age = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64]$marker.granted_epoch
        $cleared = ([int]$marker.uses_left -ge 1 -and $age -ge 0 -and $age -le 1800)
      }
    } catch {
      $marker = $null
      $cleared = $false
      try { Add-Content -Path (Join-Path $env:USERPROFILE '.claude\hook-errors.log') -Value "$(Get-Date -Format o) agent-model-guard marker unreadable: $_" } catch {}
    }

    $head = ("$($ti.prompt)" -replace '\s+', ' ').Trim()
    if ($head.Length -gt 120) { $head = $head.Substring(0, 120) }
    $verdict = 'BLOCK'
    if ($cleared) { $verdict = 'ALLOW' }
    # Own try: a ledger that will not write must never change the verdict.
    try {
      [System.IO.File]::AppendAllText($ledgerPath, "$(Get-Date -Format o)  $verdict  type=$type  model=$model  prompt=`"$head`"`r`n")
    } catch {
      try { Add-Content -Path (Join-Path $env:USERPROFILE '.claude\hook-errors.log') -Value "$(Get-Date -Format o) agent-model-guard ledger unwritable: $_" } catch {}
    }

    if ($cleared) {
      try {
        $marker.uses_left = 0
        [System.IO.File]::WriteAllText($clearPath, ($marker | ConvertTo-Json -Compress))
      } catch {
        try { Add-Content -Path (Join-Path $env:USERPROFILE '.claude\hook-errors.log') -Value "$(Get-Date -Format o) agent-model-guard consume failed: $_" } catch {}
      }
      exit 0
    }

    [Console]::Error.WriteLine("BLOCKED (P8 issue #4): fable dispatch '$type' has no live user clearance. Fable runs on usage-billed credits and requires per-run clearance (root CLAUDE.md, live-LLM-rounds rule). Present the lane, turn count, expected writes and cost, then ask the user to reply with the token FABLE OK. One token clears one dispatch for 30 minutes.")
    exit 2
  }

  if ($explicitModel -ne '') { exit 0 }
  if ($fromFrontmatter) { exit 0 }

  [Console]::Error.WriteLine("BLOCKED (issue #3/G4): Agent dispatch without model: on type '$type', which has no frontmatter model and would silently inherit the session default model. Set model: explicitly from the profile's sweet spot (claude-config/agents/profiles/).")
  exit 2
} catch {
  try { Add-Content -Path (Join-Path $env:USERPROFILE '.claude\hook-errors.log') -Value "$(Get-Date -Format o) agent-model-guard: $_" } catch {}
  exit 0
}
