# probe.ps1 - temporary: logs hook stdin JSON for shape verification
try {
  $raw = [Console]::In.ReadToEnd()
  $dir = Join-Path $env:USERPROFILE '.claude'
  Add-Content -Path (Join-Path $dir 'hook-probe.log') -Value $raw
} catch {}
exit 0
