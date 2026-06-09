#Requires -Version 5.1
<#
.SYNOPSIS
    Restores Claude Code agent harness + workspace MDs on a new Windows machine.

.PARAMETER ZipPath
    Path to the zip produced by export-harness.ps1.

.PARAMETER CodeRoot
    Where to restore ~/code files. Defaults to $env:USERPROFILE\code.

.PARAMETER Force
    Overwrite existing files without prompting.

.EXAMPLE
    .\import-harness.ps1 -ZipPath D:\transfer\claude-harness-20260522.zip
    .\import-harness.ps1 -ZipPath .\harness.zip -CodeRoot C:\Users\john\code -Force
#>
param(
    [Parameter(Mandatory)]
    [string]$ZipPath,
    [string]$CodeRoot = "$env:USERPROFILE\code",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$claudeDst = "$env:USERPROFILE\.claude"

if (-not (Test-Path $ZipPath)) {
    Write-Error "Zip not found: $ZipPath"
    exit 1
}

Write-Host "Extracting..."
$tempDir = Join-Path $env:TEMP "claude-harness-import-$(Get-Random)"
Expand-Archive -Path $ZipPath -DestinationPath $tempDir

try {
    # --- Read manifest ---
    $manifest = $null
    $manifestPath = Join-Path $tempDir "manifest.json"
    if (Test-Path $manifestPath) {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        Write-Host "Exported by: $($manifest.exportedBy) at $($manifest.exportedAt)"
        Write-Host "Source code root: $($manifest.sourceCode)"
    }

    $claudeSrc = Join-Path $tempDir "claude"

    # --- settings.json ---
    $settingsSrc = Join-Path $claudeSrc "settings.json"
    if (Test-Path $settingsSrc) {
        $settingsDst = Join-Path $claudeDst "settings.json"
        if ((Test-Path $settingsDst) -and -not $Force) {
            $choice = Read-Host "settings.json exists. Overwrite? [y/N]"
            if ($choice -ne 'y') { Write-Host "Skipped settings.json" } else {
                Copy-Item $settingsSrc $settingsDst -Force
                Write-Host "Restored settings.json"
            }
        } else {
            Copy-Item $settingsSrc $settingsDst -Force
            Write-Host "Restored settings.json"
        }

        # Warn if settings reference old username
        $oldUser = if ($manifest) { Split-Path $manifest.sourceProfile -Leaf } else { $null }
        if ($oldUser -and ($oldUser -ne $env:USERNAME)) {
            Write-Warning "settings.json may contain hardcoded paths for user '$oldUser'."
            Write-Warning "Search and replace '$oldUser' with '$env:USERNAME' in settings.json."
        }
    }

    # --- Credentials (optional) ---
    $credSrc = Join-Path $claudeSrc ".credentials.json"
    if (Test-Path $credSrc) {
        if (-not $Force) {
            $choice = Read-Host ".credentials.json found (auth tokens). Import? [y/N]"
        }
        if ($Force -or $choice -eq 'y') {
            Copy-Item $credSrc "$claudeDst\.credentials.json" -Force
            Write-Host "Restored .credentials.json"
        } else {
            Write-Host "Skipped credentials - run 'claude' on the new machine to re-authenticate."
        }
    }

    # --- Plugins ---
    $pluginsSrc = Join-Path $claudeSrc "plugins"
    if (Test-Path $pluginsSrc) {
        $pluginsDst = Join-Path $claudeDst "plugins"
        if (-not (Test-Path $pluginsDst)) { New-Item -ItemType Directory -Path $pluginsDst | Out-Null }
        Copy-Item "$pluginsSrc\*" $pluginsDst -Recurse -Force
        Write-Host "Restored plugins"
    }

    # --- Custom skills ---
    $skillsSrc = Join-Path $claudeSrc "skills"
    if (Test-Path $skillsSrc) {
        $skillsDst = Join-Path $claudeDst "skills"
        if (-not (Test-Path $skillsDst)) { New-Item -ItemType Directory -Path $skillsDst | Out-Null }
        Copy-Item "$skillsSrc\*" $skillsDst -Recurse -Force
        Write-Host "Restored custom skills"
    }

    # --- Memory (projects) ---
    # Claude keys project memory by path: C:\Users\young\code -> C--Users-young-code
    # We need to remap the old key to the new machine's key.
    $projectsSrc = Join-Path $claudeSrc "projects"
    if (Test-Path $projectsSrc) {
        $newKey      = ($CodeRoot -replace ":", "-" -replace "\\", "-")
        $projectsDst = Join-Path $claudeDst "projects\$newKey"
        if (-not (Test-Path $projectsDst)) {
            New-Item -ItemType Directory -Path $projectsDst -Force | Out-Null
        }

        # Copy memory files from the exported key directory
        $exportedKeys = Get-ChildItem $projectsSrc -Directory
        foreach ($keyDir in $exportedKeys) {
            $memSrc = Join-Path $projectsSrc $keyDir.Name
            # Copy all files (memory/*.md, MEMORY.md) into the new key directory
            Get-ChildItem $memSrc -Recurse -File | ForEach-Object {
                $rel    = $_.FullName.Substring($memSrc.Length).TrimStart('\')
                $target = Join-Path $projectsDst $rel
                $parent = Split-Path $target -Parent
                if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
                Copy-Item $_.FullName $target -Force
            }
        }
        Write-Host "Restored memory (projects) -> $projectsDst"
    }

    # --- Workspace MDs ---
    $codeSrc = Join-Path $tempDir "code"
    if (Test-Path $codeSrc) {
        if (-not (Test-Path $CodeRoot)) { New-Item -ItemType Directory -Path $CodeRoot -Force | Out-Null }

        if (Test-Path "$codeSrc\CLAUDE.md") {
            Copy-Item "$codeSrc\CLAUDE.md" "$CodeRoot\CLAUDE.md" -Force
            Write-Host "Restored CLAUDE.md -> $CodeRoot"
        }
        if (Test-Path "$codeSrc\docs") {
            Copy-Item "$codeSrc\docs" $CodeRoot -Recurse -Force
            Write-Host "Restored docs/ -> $CodeRoot\docs"
        }
    }

    Write-Host ""
    Write-Host "Import complete."
    Write-Host "Run 'claude' to verify - re-authenticate if credentials were skipped."
}
finally {
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
