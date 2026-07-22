[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$packageRoot = $PSScriptRoot
$installRoot = if ($env:LEVIATHAN_INSTALL_ROOT) {
    [IO.Path]::GetFullPath($env:LEVIATHAN_INSTALL_ROOT)
} else {
    Join-Path $env:LOCALAPPDATA 'Leviathan'
}
$assetMap = [ordered]@{
    'leviathan-windows-x64.exe' = 'leviathan.exe'
    'leviathan-game-capture-windows-x64.exe' = 'leviathan-game-capture.exe'
    'libvips-42.dll' = 'libvips-42.dll'
    'libvips-cpp-8.17.3.dll' = 'libvips-cpp-8.17.3.dll'
    'leviathan-launcher.ps1' = 'leviathan-launcher.ps1'
    'leviathan-updater.ps1' = 'leviathan-updater.ps1'
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

function Write-Utf8Json {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'The offline installer currently supports Windows only.'
}

$checksumPath = Join-Path $packageRoot 'SHA256SUMS'
$versionPath = Join-Path $packageRoot 'VERSION'
if (-not (Test-Path -LiteralPath $checksumPath)) {
    throw 'The offline package is missing SHA256SUMS.'
}
if (-not (Test-Path -LiteralPath $versionPath)) {
    throw 'The offline package is missing VERSION.'
}

$checksumText = Get-Content -LiteralPath $checksumPath -Raw
foreach ($assetName in $assetMap.Keys) {
    $sourcePath = Join-Path $packageRoot $assetName
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "The offline package is missing $assetName."
    }
    $expectedHash = Get-ExpectedHash -ChecksumText $checksumText -Name $assetName
    $actualHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "Checksum verification failed for $assetName."
    }
}

$version = (Get-Content -LiteralPath $versionPath -Raw).Trim()
if (-not $version) {
    throw 'The offline package VERSION is empty.'
}

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$currentExecutable = Join-Path $installRoot 'leviathan.exe'
if (Test-Path -LiteralPath $currentExecutable) {
    Copy-Item -LiteralPath $currentExecutable -Destination (Join-Path $installRoot 'leviathan.previous.exe') -Force
}

foreach ($entry in $assetMap.GetEnumerator()) {
    Copy-Item -LiteralPath (Join-Path $packageRoot $entry.Key) -Destination (Join-Path $installRoot $entry.Value) -Force
}

$state = [ordered]@{
    installedVersion = $version
    repository = 'jett1011586853/Leviathan'
    releaseApiUrl = 'https://api.github.com/repos/jett1011586853/Leviathan/releases/latest'
    lastUpdateCheckUtc = [DateTime]::UtcNow.ToString('o')
    installedFrom = 'offline-package'
}
Write-Utf8Json -Path (Join-Path $installRoot 'install-state.json') -Value $state

$binDirectory = Join-Path $installRoot 'bin'
New-Item -ItemType Directory -Path $binDirectory -Force | Out-Null
$launcherPath = Join-Path $installRoot 'leviathan-launcher.ps1'
$shim = "@echo off`r`npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $binDirectory 'leviathan.cmd'), $shim, [Text.Encoding]::ASCII)

if ($env:LEVIATHAN_INSTALL_SKIP_PATH -ne '1') {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $pathEntries = @($userPath -split ';' | Where-Object { $_ })
    if (-not ($pathEntries | Where-Object { $_.TrimEnd('\') -ieq $binDirectory.TrimEnd('\') })) {
        $newUserPath = (@($binDirectory) + $pathEntries) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
    }
}

Write-Host ''
Write-Host "Leviathan $version installed successfully from the offline package." -ForegroundColor Green
Write-Host "Install directory: $installRoot"
Write-Host 'Open a new PowerShell window, enter a workspace, and run:'
Write-Host '  leviathan' -ForegroundColor Cyan
