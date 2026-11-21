# ==============================================================================
# Pulse v1.2.0 Local Signed Release Builder
# ==============================================================================
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1
#
# Requirements:
#   - Private key at "$HOME\.tauri\pulse.key"
#   - User password entered interactively (never stored or echoed)
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

# 1. Read metadata from tauri.conf.json
$TauriConfPath = Join-Path $ProjectRoot "src-tauri\tauri.conf.json"
if (-not (Test-Path $TauriConfPath)) {
    Write-Error "Could not find tauri.conf.json at $TauriConfPath"
    exit 1
}

$TauriConf = Get-Content -Path $TauriConfPath -Raw | ConvertFrom-Json
$Version = $TauriConf.version
$Endpoint = $TauriConf.plugins.updater.endpoints[0]

# Extract GitHub repo base URL from updater endpoint (e.g., https://github.com/Kanad-Shee/pulse)
$RepoBase = $Endpoint -replace '/releases/.*$', ''

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "   Pulse Local Signed Release Builder v$Version" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "Target Version   : $Version"
Write-Host "Updater Endpoint : $Endpoint"
Write-Host "Repository Base  : $RepoBase"

# 2. Check for private signing key
$KeyPath = Join-Path $HOME ".tauri\pulse.key"
if (-not (Test-Path $KeyPath)) {
    Write-Error "Private key not found at $KeyPath. Please ensure your Tauri private key is placed at $KeyPath."
    exit 1
}
Write-Host "Found signing key: $KeyPath" -ForegroundColor Green
$PrivateKey = Get-Content -Path $KeyPath -Raw

# 3. Prompt securely for password
Write-Host "`nEnter password for Tauri private signing key:" -ForegroundColor Yellow
$SecurePass = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePass)
$PlainPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

try {
    # Set environment variables for Tauri CLI bundler
    $env:TAURI_SIGNING_PRIVATE_KEY = $PrivateKey.Trim()
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $PlainPass

    Write-Host "`n[1/4] Running Tauri build (npm run tauri build)..." -ForegroundColor Cyan
    npm.cmd run tauri build
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed with exit code $LASTEXITCODE"
    }

    Write-Host "`n[2/4] Verifying build bundle artifacts..." -ForegroundColor Cyan
    $BundleNsisDir = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis"
    $TargetArtifactDir = Join-Path $ProjectRoot "release-artifacts\v$Version"

    if (-not (Test-Path $TargetArtifactDir)) {
        New-Item -ItemType Directory -Path $TargetArtifactDir -Force | Out-Null
    }

    # Locate the setup installer and its signature
    $InstallerName = "Pulse_${Version}_x64-setup.exe"
    $SigName = "Pulse_${Version}_x64-setup.exe.sig"

    $InstallerPath = Join-Path $BundleNsisDir $InstallerName
    $SigPath = Join-Path $BundleNsisDir $SigName

    if (-not (Test-Path $InstallerPath)) {
        $FoundExe = Get-ChildItem -Path $BundleNsisDir -Filter "*setup.exe" | Select-Object -First 1
        if ($FoundExe) {
            $InstallerPath = $FoundExe.FullName
            $InstallerName = $FoundExe.Name
            $SigPath = "$InstallerPath.sig"
            $SigName = "$InstallerName.sig"
        }
    }

    if (-not (Test-Path $InstallerPath)) {
        throw "Installer executable not found in $BundleNsisDir"
    }
    if (-not (Test-Path $SigPath)) {
        throw "Signature file not found: $SigPath. Ensure signing key and password were correct."
    }

    Write-Host "`n[3/4] Copying artifacts to $TargetArtifactDir..." -ForegroundColor Cyan
    Copy-Item -Path $InstallerPath -Destination (Join-Path $TargetArtifactDir $InstallerName) -Force
    Copy-Item -Path $SigPath -Destination (Join-Path $TargetArtifactDir $SigName) -Force

    # Also locate and copy the MSI installer if generated
    $BundleMsiDir = Join-Path $ProjectRoot "src-tauri\target\release\bundle\msi"
    if (Test-Path $BundleMsiDir) {
        $MsiFiles = Get-ChildItem -Path $BundleMsiDir -Filter "*$Version*.msi"
        if (-not $MsiFiles) {
            $MsiFiles = Get-ChildItem -Path $BundleMsiDir -Filter "*.msi"
        }
        foreach ($msi in $MsiFiles) {
            Write-Host "  Found MSI installer: $($msi.Name)" -ForegroundColor Green
            Copy-Item -Path $msi.FullName -Destination (Join-Path $TargetArtifactDir $msi.Name) -Force
        }
    }

    Write-Host "`n[4/4] Generating latest.json for auto-updater..." -ForegroundColor Cyan
    $SignatureString = (Get-Content -Path $SigPath -Raw).Trim()
    $PubDate = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    $DownloadUrl = "$RepoBase/releases/download/v$Version/$InstallerName"

    $LatestManifest = [ordered]@{
        "version"   = $Version
        "notes"     = "Pulse v$Version release - 100% local, zero-cloud Windows voice-to-text with auto-updates, dynamic island overlay, and multi-model support."
        "pub_date"  = $PubDate
        "platforms" = @{
            "windows-x86_64" = @{
                "signature" = $SignatureString
                "url"       = $DownloadUrl
            }
        }
    }

    $JsonContent = $LatestManifest | ConvertTo-Json -Depth 5
    $LatestJsonPath = Join-Path $TargetArtifactDir "latest.json"
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($LatestJsonPath, $JsonContent, $Utf8NoBom)

    Write-Host "`n===================================================" -ForegroundColor Green
    Write-Host "   Release v$Version Build & Artifact Packaging Complete!" -ForegroundColor Green
    Write-Host "===================================================" -ForegroundColor Green
    Write-Host "Artifacts generated in: $TargetArtifactDir"
    Get-ChildItem -Path $TargetArtifactDir | ForEach-Object {
        Write-Host "  - $($_.Name)" -ForegroundColor White
    }
    Write-Host "`nTo publish this release on GitHub:"
    Write-Host "1. Git tag & push: git tag v$Version; git push origin v$Version"
    Write-Host "2. Create GitHub Release matching tag 'v$Version'."
    Write-Host "3. Upload all files from '$TargetArtifactDir' to the Release."
}
finally {
    # Securely clear sensitive credentials from environment
    $PlainPass = $null
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    Write-Host "`n[Security] Cleared TAURI_SIGNING_PRIVATE_KEY and password from environment." -ForegroundColor Gray
}
