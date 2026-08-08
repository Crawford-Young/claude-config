# otel-receiver-spawn.ps1 - SessionStart hook: lazy-spawn the local OTel receiver
# (OTel usage-attribution wave 2026-08-07). Reads no stdin - payload unused.
# Port probe: 100ms cap; a false negative merely spawns a doomed second instance
# that exits itself on EADDRINUSE (harmless). Fail-open: errors append to
# ~/.claude/hook-errors.log, never block session start.
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', 4318, $null, $null)
    $listening = $async.AsyncWaitHandle.WaitOne(100) -and $client.Connected
    $client.Close()
    if (-not $listening) {
        Start-Process -FilePath 'node' `
            -ArgumentList '"C:/Users/young/code/claude-config/telemetry/otel-receiver.mjs"' `
            -WindowStyle Hidden
    }
} catch {
    try {
        $log = Join-Path $env:USERPROFILE '.claude/hook-errors.log'
        Add-Content -Path $log -Value "[$(Get-Date -Format o)] otel-receiver-spawn.ps1: $($_.Exception.Message)"
    } catch {}
}
exit 0
