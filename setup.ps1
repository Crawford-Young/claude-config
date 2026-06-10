# setup.ps1 — Wire skills from this repo into ~/.claude/skills via directory junctions (Windows)
# Run from the repo root: .\setup.ps1

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillsDir = Join-Path $repo "skills"
$claudeSkills = "$env:USERPROFILE\.claude\skills"

if (-not (Test-Path $claudeSkills)) {
    New-Item -ItemType Directory -Force -Path $claudeSkills | Out-Null
}

Get-ChildItem $skillsDir -Directory | ForEach-Object {
    $name = $_.Name
    $target = $_.FullName
    $junction = Join-Path $claudeSkills $name

    if (Test-Path $junction) {
        $item = Get-Item $junction -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Write-Host "Already linked: $name (skipping)"
            return
        }
        Write-Warning "$junction exists and is not a junction. Remove it manually first."
        return
    }

    New-Item -ItemType Junction -Path $junction -Target $target | Out-Null
    Write-Host "Linked: $name"
}

# --- Workspace standards (CLAUDE.md + reference docs) ---
# File symlinks require Developer Mode (Settings > System > For developers) or an elevated shell.
$code = "$env:USERPROFILE\code"
$wsRepo = Join-Path $repo "workspace"
New-Item -ItemType Directory -Force "$code\docs" | Out-Null

function Link-Item($linkPath, $targetPath, $kind) {
    if (Test-Path $linkPath) {
        $item = Get-Item $linkPath -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Write-Host "Already linked: $linkPath (skipping)"
            return
        }
        Write-Warning "$linkPath exists and is not a link. Remove it manually first."
        return
    }
    New-Item -ItemType $kind -Path $linkPath -Target $targetPath | Out-Null
    Write-Host "Linked: $linkPath"
}

Link-Item "$code\CLAUDE.md" "$wsRepo\CLAUDE.md" SymbolicLink
Get-ChildItem "$wsRepo\docs" -File -Filter *.md | ForEach-Object {
    Link-Item "$code\docs\$($_.Name)" $_.FullName SymbolicLink
}
Get-ChildItem "$wsRepo\docs" -Directory | ForEach-Object {
    Link-Item "$code\docs\$($_.Name)" $_.FullName Junction
}

Write-Host "`nDone. Skills and workspace standards available immediately."
