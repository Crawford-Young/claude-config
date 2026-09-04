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

# --- Agents (subagent defs) ---
$agentsDir = Join-Path $repo "agents"
$claudeAgents = "$env:USERPROFILE\.claude\agents"
Link-Item $claudeAgents $agentsDir Junction

$domains = 'web', 'games', 'apps'

Link-Item "$code\CLAUDE.md" "$wsRepo\CLAUDE.md" SymbolicLink

# Path-scoped rules (.claude/rules) — junction so ancestor rules load workspace-wide (G34)
New-Item -ItemType Directory -Force "$code\.claude" | Out-Null
Link-Item "$code\.claude\rules" "$wsRepo\.claude\rules" Junction

# Domain standards — one CLAUDE.md symlink per domain folder
foreach ($domain in $domains) {
    New-Item -ItemType Directory -Force "$code\$domain" | Out-Null
    Link-Item "$code\$domain\CLAUDE.md" "$wsRepo\$domain\CLAUDE.md" SymbolicLink
}

# Universal reference docs at the docs root
Get-ChildItem "$wsRepo\docs" -File -Filter *.md | ForEach-Object {
    Link-Item "$code\docs\$($_.Name)" $_.FullName SymbolicLink
}

# Domain reference docs — real directories in the docs repo, individual file symlinks inside.
# NEVER junction the whole directory: ~/code/docs/<domain>/ also holds the docs repo's own
# project folders, and a junction would relocate them into this repo.
foreach ($domain in $domains) {
    $src = Join-Path "$wsRepo\docs" $domain
    if (-not (Test-Path $src)) { continue }
    New-Item -ItemType Directory -Force "$code\docs\$domain" | Out-Null
    Get-ChildItem $src -File -Filter *.md | ForEach-Object {
        Link-Item "$code\docs\$domain\$($_.Name)" $_.FullName SymbolicLink
    }
}

# Cross-domain reference directories (brand) stay whole-directory junctions
Get-ChildItem "$wsRepo\docs" -Directory | Where-Object { $_.Name -notin $domains } | ForEach-Object {
    Link-Item "$code\docs\$($_.Name)" $_.FullName Junction
}

Write-Host "`nDone. Skills and workspace standards available immediately."
