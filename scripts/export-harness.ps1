#Requires -Version 5.1
<#
.SYNOPSIS
    Packages Claude Code agent harness + workspace MDs into a zip for machine transfer.

.PARAMETER OutputPath
    Destination zip path. Defaults to Desktop\claude-harness-<date>.zip

.PARAMETER IncludeCredentials
    Include .credentials.json (auth tokens). You will need to re-auth on the new machine
    if you omit this. Default: $false (omitted for safety).

.EXAMPLE
    .\export-harness.ps1
    .\export-harness.ps1 -OutputPath D:\transfer\harness.zip -IncludeCredentials
#>
param(
    [string]$OutputPath = "$env:USERPROFILE\code\claude-harness-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip",
    [switch]$IncludeCredentials
)

$ErrorActionPreference = "Stop"
$claudeSrc = "$env:USERPROFILE\.claude"
$codeSrc   = "$env:USERPROFILE\code"

Write-Host "Preparing export..."

$tempDir = Join-Path $env:TEMP "claude-harness-export-$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    # --- .claude config core ---
    $claudeDst = Join-Path $tempDir "claude"
    New-Item -ItemType Directory -Path $claudeDst | Out-Null

    Copy-Item "$claudeSrc\settings.json" "$claudeDst\settings.json" -ErrorAction SilentlyContinue

    if ($IncludeCredentials -and (Test-Path "$claudeSrc\.credentials.json")) {
        Copy-Item "$claudeSrc\.credentials.json" "$claudeDst\.credentials.json"
        Write-Warning "Credentials included - treat the zip as sensitive."
    }

    # --- Plugins ---
    if (Test-Path "$claudeSrc\plugins") {
        Copy-Item "$claudeSrc\plugins" "$claudeDst\plugins" -Recurse
    }

    # --- Custom skills ---
    if (Test-Path "$claudeSrc\skills") {
        Copy-Item "$claudeSrc\skills" "$claudeDst\skills" -Recurse
    }

    # --- Memory (projects) ---
    if (Test-Path "$claudeSrc\projects") {
        Copy-Item "$claudeSrc\projects" "$claudeDst\projects" -Recurse
    }

    # --- Workspace MDs ---
    $codeDst = Join-Path $tempDir "code"
    New-Item -ItemType Directory -Path $codeDst | Out-Null

    if (Test-Path "$codeSrc\CLAUDE.md") {
        Copy-Item "$codeSrc\CLAUDE.md" "$codeDst\CLAUDE.md"
    }
    if (Test-Path "$codeSrc\docs") {
        Copy-Item "$codeSrc\docs" "$codeDst\docs" -Recurse
    }

    # --- Manifest ---
    @{
        exportedBy    = $env:USERNAME
        exportedAt    = (Get-Date -Format "o")
        sourceProfile = $env:USERPROFILE
        sourceCode    = $codeSrc
        # Key used by Claude for this project directory (colon→dash, backslash→dash)
        projectKey    = ($codeSrc -replace ":", "-" -replace "\\", "-")
    } | ConvertTo-Json | Out-File "$tempDir\manifest.json" -Encoding utf8

    # --- Zip ---
    Compress-Archive -Path "$tempDir\*" -DestinationPath $OutputPath -Force
    Write-Host "Export complete: $OutputPath"
    Write-Host ""
    Write-Host "Transfer this zip to the new machine, then run:"
    Write-Host '  .\import-harness.ps1 -ZipPath <path-to-zip>'
}
finally {
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
