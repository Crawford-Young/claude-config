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

  exit 0
} catch {
  try { Add-Content -Path (Join-Path $env:USERPROFILE '.claude\hook-errors.log') -Value "$(Get-Date -Format o) pretooluse-guard: $_" } catch {}
  exit 0
}
