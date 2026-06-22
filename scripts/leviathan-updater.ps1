[CmdletBinding()]
param(
    [string]$InstallRoot = $PSScriptRoot,
    [switch]$Force,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$previousProgressPreference = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'
$statePath = Join-Path $InstallRoot 'install-state.json'
$pendingPath = Join-Path $InstallRoot 'pending-update.json'
$updatesRoot = Join-Path $InstallRoot 'updates'
$assetNames = @(
    'leviathan-windows-x64.exe',
    'leviathan-launcher.ps1',
    'leviathan-updater.ps1'
)
$checksumAssetName = 'SHA256SUMS'
$headers = @{
    Accept = 'application/vnd.github+json'
    'User-Agent' = 'Leviathan-Updater'
}

function Read-InstallState {
    if (-not (Test-Path -LiteralPath $statePath)) {
        return [pscustomobject]@{}
    }
    try {
        return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    } catch {
        return [pscustomobject]@{}
    }
}

function Write-Utf8Json {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
}

function Get-ReleaseAssetUrl {
    param(
        [Parameter(Mandatory = $true)]$Release,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $asset = $Release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $asset -or -not $asset.browser_download_url) {
        throw "The latest Leviathan release does not contain $Name."
    }
    return [string]$asset.browser_download_url
}

function Get-ExpectedHash {
    param(
        [Parameter(Mandatory = $true)][string]$ChecksumText,
        [Parameter(Mandatory = $true)][string]$Name
    )

    foreach ($line in ($ChecksumText -split "`r?`n")) {
        if ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$' -and $Matches[2] -eq $Name) {
            return $Matches[1].ToUpperInvariant()
        }
    }
    throw "SHA256SUMS does not contain a hash for $Name."
}

$mutex = New-Object Threading.Mutex($false, 'Local\LeviathanUpdater')
$hasMutex = $false
$downloadRoot = $null

try {
    $hasMutex = $mutex.WaitOne(0)
    if (-not $hasMutex) {
        exit 0
    }

    $state = Read-InstallState
    $state | Add-Member -NotePropertyName lastUpdateCheckUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    Write-Utf8Json -Path $statePath -Value $state

    $repository = if ($state.repository) { [string]$state.repository } else { 'jett1011586853/Leviathan' }
    $releaseApiUrl = if ($state.releaseApiUrl) {
        [string]$state.releaseApiUrl
    } else {
        "https://api.github.com/repos/$repository/releases/latest"
    }

    $release = Invoke-RestMethod -Uri $releaseApiUrl -Headers $headers -TimeoutSec 20
    $latestVersionText = ([string]$release.tag_name).TrimStart('v')
    $installedVersionText = if ($state.installedVersion) { [string]$state.installedVersion } else { '0.0.0' }
    $latestVersion = [version]$latestVersionText
    $installedVersion = [version]$installedVersionText
    if ($latestVersion -le $installedVersion) {
        if (-not $Quiet) {
            Write-Host "Leviathan $installedVersionText is already up to date."
        }
        exit 0
    }

    if (Test-Path -LiteralPath $pendingPath) {
        try {
            $existingPending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
            if ([version]([string]$existingPending.version) -ge $latestVersion) {
                if (-not $Quiet) {
                    Write-Host "Leviathan $($existingPending.version) is ready to install on the next launch."
                }
                exit 0
            }
        } catch {
            Remove-Item -LiteralPath $pendingPath -Force -ErrorAction SilentlyContinue
        }
    }

    New-Item -ItemType Directory -Path $updatesRoot -Force | Out-Null
    $downloadRoot = Join-Path $updatesRoot ("$latestVersionText-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null

    $checksumPath = Join-Path $downloadRoot $checksumAssetName
    Invoke-WebRequest -Uri (Get-ReleaseAssetUrl -Release $release -Name $checksumAssetName) -OutFile $checksumPath -Headers $headers -UseBasicParsing -TimeoutSec 120
    $checksumText = Get-Content -LiteralPath $checksumPath -Raw

    foreach ($name in $assetNames) {
        $destination = Join-Path $downloadRoot $name
        Invoke-WebRequest -Uri (Get-ReleaseAssetUrl -Release $release -Name $name) -OutFile $destination -Headers $headers -UseBasicParsing -TimeoutSec 300
        $expectedHash = Get-ExpectedHash -ChecksumText $checksumText -Name $name
        $actualHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "Checksum verification failed for $name."
        }
    }

    $pending = [ordered]@{
        version = $latestVersionText
        directory = $downloadRoot
        downloadedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
    $pendingTemporaryPath = "$pendingPath.tmp"
    Write-Utf8Json -Path $pendingTemporaryPath -Value $pending
    Move-Item -LiteralPath $pendingTemporaryPath -Destination $pendingPath -Force
    $downloadRoot = $null

    if (-not $Quiet) {
        Write-Host "Downloaded Leviathan $latestVersionText. It will be applied on the next launch." -ForegroundColor Green
    }
} catch {
    if (-not $Quiet) {
        Write-Warning "Leviathan update check failed: $($_.Exception.Message)"
    }
    exit 1
} finally {
    $ProgressPreference = $previousProgressPreference
    if ($downloadRoot -and (Test-Path -LiteralPath $downloadRoot)) {
        Remove-Item -LiteralPath $downloadRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($hasMutex) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
