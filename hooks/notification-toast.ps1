# notification-toast.ps1 - Notification hook: Windows toast for WezTerm
# (WezTerm gets no native Claude Code desktop notifications - G53, 2026-08-07).
# Fail-open: errors append to ~/.claude/hook-errors.log, never block.
try {
    $raw = [Console]::In.ReadToEnd()
    $message = 'Claude Code needs attention'
    try {
        $payload = $raw | ConvertFrom-Json
        if ($payload.message) { $message = [string]$payload.message }
    } catch {}

    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $template.GetElementsByTagName('text')
    [void]$texts.Item(0).AppendChild($template.CreateTextNode('Claude Code'))
    [void]$texts.Item(1).AppendChild($template.CreateTextNode($message))
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {
    try {
        $log = Join-Path $env:USERPROFILE '.claude/hook-errors.log'
        Add-Content -Path $log -Value "[$(Get-Date -Format o)] notification-toast.ps1: $($_.Exception.Message)"
    } catch {}
}
exit 0
