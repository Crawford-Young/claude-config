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

Write-Host "`nDone. Skills available in Claude Code immediately."
