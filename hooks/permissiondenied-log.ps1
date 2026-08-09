# permissiondenied-log.ps1 - G70 pilot: auto-mode denial visibility. Fail-open, never blocks.
# PS 5.1 host: all writes via [System.IO.File] UTF8-no-BOM (Set-Content=ANSI mojibake; same-path pipe rotation self-clobbers).
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $dir = "$HOME/.claude/logs"
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $f = "$dir/permission-denied.jsonl"
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $line = @{
    ts    = (Get-Date).ToString('o')
    tool  = if ($payload.tool_name) { $payload.tool_name } else { 'UNKNOWN(field absent)' }
    input = if ($payload.tool_input) { $payload.tool_input | ConvertTo-Json -Compress -Depth 3 } else { 'UNKNOWN(field absent)' }
  } | ConvertTo-Json -Compress
  [System.IO.File]::AppendAllText($f, $line + "`n", $utf8)
  $lines = [System.IO.File]::ReadAllLines($f)
  if ($lines.Count -gt 1000) { [System.IO.File]::WriteAllLines($f, ($lines | Select-Object -Last 500), $utf8) }
  exit 0
} catch { exit 0 }
