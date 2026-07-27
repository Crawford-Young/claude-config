# precompact-archive.ps1 - archive full transcript before compaction. Fail-open.
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $src = $payload.transcript_path
  if ($src -and (Test-Path $src)) {
    $dir = Join-Path $env:USERPROFILE '.claude\compact-archives'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $stamp = Get-Date -Format 'yyyy-MM-dd-HH-mm-ss'
    $sid = if ($payload.session_id) { $payload.session_id } else { 'unknown' }
    Copy-Item -Path $src -Destination (Join-Path $dir "$sid-$stamp.jsonl")
  }
} catch {
  try { Add-Content -Path (Join-Path $env:USERPROFILE '.claude\hook-errors.log') -Value "$(Get-Date -Format o) precompact-archive: $_" } catch {}
}
exit 0
