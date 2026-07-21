# Open 3 elevated PowerShell shells, each in its own Windows Terminal window.
# Self-elevates once via UAC, then spawns 3 separate wt windows.

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

# `-w new` forces each invocation into its own new window instead of reusing one.
1..3 | ForEach-Object {
    Start-Process wt.exe -ArgumentList '-w', 'new', '-p', 'Windows PowerShell'
}
