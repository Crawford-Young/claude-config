# gate-output-filter.ps1 - G36 pilot: verbose gate output to file, filtered lines to context.
# Fail-open. Rewrite only when safe: gate pattern + existing EXIT echo + no redirection/pipe.
# Pattern source: code:costs.md worked example (research/usage-limits.md F10).
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($payload.tool_name -ne 'Bash') { exit 0 }
  $cmd = $payload.tool_input.command
  if (-not $cmd) { exit 0 }
  $gates = '^(pnpm (run )?(test|lint|typecheck)|vitest run|npx tsc\b|just check)'
  if (-not ($cmd -match $gates) -or ($cmd -match '[>|]') -or -not ($cmd -match ';\s*echo EXIT:')) { exit 0 }
  $logDir = ($env:TEMP -replace '\\', '/') + '/claude-gate-logs'
  $log = "$logDir/$([DateTimeOffset]::Now.ToUnixTimeSeconds()).log"
  $parts = $cmd -split ';\s*echo EXIT:', 2
  $filter = "grep -aE '(FAIL|PASS|ERROR|error|failed|passed|Tests|Statements|Branches|Functions|Lines)' `"$log`" | head -80"
  $newCmd = "mkdir -p `"$logDir`"; { $($parts[0]) ; } > `"$log`" 2>&1; echo EXIT:$($parts[1]); $filter; echo FULL_LOG:$log"
  @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; updatedInput = @{ command = $newCmd } } } | ConvertTo-Json -Depth 5 -Compress
  exit 0
} catch { exit 0 }
