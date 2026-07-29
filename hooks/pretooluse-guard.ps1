# pretooluse-guard.ps1 - blocks documented CLAUDE.md incident classes.
# Block = exit 2 + stderr reason (shown to the model). Fail-open on script error.
try {
  $raw = [Console]::In.ReadToEnd()
  $payload = $raw | ConvertFrom-Json
  $cmd = $payload.tool_input.command
  if (-not $cmd) { exit 0 }

  $textExt = '\.(md|ts|tsx|js|jsx|mjs|json|yml|yaml|gd|css|html|txt)\b'
  if ($cmd -match '(Set-Content|Out-File|Add-Content)' -and $cmd -match $textExt) {
    [Console]::Error.WriteLine("BLOCKED (CLAUDE.md Code Quality): never write text files via PowerShell Set-Content/Out-File/Add-Content - mojibake/BOM risk. Use the Edit or Write tool.")
    exit 2
  }

  $gates = '(just check|pnpm (run )?(test|lint|typecheck)|vitest|(npx )?tsc\b|playwright test)'
  if ($cmd -match $gates -and $cmd -match '\|\s*(tail|head)\b') {
    [Console]::Error.WriteLine("BLOCKED (CLAUDE.md Code Quality): gate commands run unpiped - a pipe reports the pipe's exit code, not the gate's. Run without | tail/head and append: ; echo EXIT:`$?")
    exit 2
  }

  if ($cmd -match 'git add\s+(-[a-zA-Z]*A[a-zA-Z]*\b|--all\b)') {
    [Console]::Error.WriteLine("BLOCKED (CLAUDE.md Commit Policy): stage with explicit paths, never git add -A/--all - concurrent-session sweep risk.")
    exit 2
  }

  # Relocation gate on claude-config commits. WARN, never block: the gate audits the whole
  # ~/code tree, so it can go red on another session's in-flight edits, and blocking would
  # wedge a commit on a failure its author did not cause. CI cannot cover this - the gate
  # needs sibling repos and ~/.claude junctions that no runner has (see .github/workflows/ci.yml).
  # Flip to exit 2 once the gate is reliably green; until then a warning at commit time is the
  # only moment anyone is positioned to act on it.
  if ($cmd -match 'git\b.*\bcommit\b' -and ($cmd -match 'claude-config' -or $payload.cwd -match 'claude-config')) {
    $gate = 'C:/Users/young/code/claude-config/scripts/verify-relocation.mjs'
    if (Test-Path $gate) {
      $out = & node $gate 2>&1
      if ($LASTEXITCODE -ne 0) {
        $summary = ($out | Select-String -Pattern '^(FAIL|ABORT|UNREACHABLE)' | Select-Object -First 3) -join '; '
        [Console]::Error.WriteLine("WARNING (not blocking): verify-relocation.mjs exits $LASTEXITCODE. $summary  Run it before assuming this commit is clean - a relocated rule may be lost.")
      }
    }
  }

  exit 0
} catch {
  try { Add-Content -Path (Join-Path $env:USERPROFILE '.claude\hook-errors.log') -Value "$(Get-Date -Format o) pretooluse-guard: $_" } catch {}
  exit 0
}
