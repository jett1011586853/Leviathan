$ErrorActionPreference = 'Stop'
$previousProgressPreference = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'

$repository = if ($env:LEVIATHAN_INSTALL_REPOSITORY) {
    $env:LEVIATHAN_INSTALL_REPOSITORY
} else {
    'jett1011586853/Leviathan'
}
$installRoot = if ($env:LEVIATHAN_INSTALL_ROOT) {
    [IO.Path]::GetFullPath($env:LEVIATHAN_INSTALL_ROOT)
} else {
    Join-Path $env:LOCALAPPDATA 'Leviathan'
}
$releaseApiUrl = if ($env:LEVIATHAN_RELEASE_API_URL) {
    $env:LEVIATHAN_RELEASE_API_URL
} else {
    "https://api.github.com/repos/$repository/releases/latest"
}

$assetNames = @(
    'leviathan-windows-x64.exe',
    'leviathan-launcher.ps1',
    'leviathan-updater.ps1'
)
$checksumAssetName = 'SHA256SUMS'
$headers = @{
    Accept = 'application/vnd.github+json'
    'User-Agent' = 'Leviathan-Installer'
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

function Write-Utf8Json {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
}

function Remove-LegacyProfileCommand {
    $profilePath = [string]$PROFILE
    if (-not $profilePath -or -not (Test-Path -LiteralPath $profilePath)) {
        return
    }

    $startMarker = '# >>> Leviathan CLI >>>'
    $endMarker = '# <<< Leviathan CLI <<<'
    $content = Get-Content -LiteralPath $profilePath -Raw
    $pattern = '(?ms)^' + [regex]::Escape($startMarker) + '.*?^' + [regex]::Escape($endMarker) + '\s*'
    if ([regex]::IsMatch($content, $pattern)) {
        $updated = [regex]::Replace($content, $pattern, '')
        [IO.File]::WriteAllText($profilePath, $updated, (New-Object Text.UTF8Encoding($false)))
    }

    $existingAlias = Get-Alias -Name leviathan -ErrorAction SilentlyContinue
    if ($existingAlias -and $existingAlias.Definition -eq 'Start-Leviathan') {
        Remove-Item Alias:leviathan -Force -ErrorAction SilentlyContinue
        Remove-Item Function:Start-Leviathan -Force -ErrorAction SilentlyContinue
    }
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("leviathan-install-" + [guid]::NewGuid().ToString('N'))

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'The one-line installer currently supports Windows only.'
    }

    Write-Host 'Fetching the latest Leviathan release...'
    $release = Invoke-RestMethod -Uri $releaseApiUrl -Headers $headers -TimeoutSec 20
    $version = ([string]$release.tag_name).TrimStart('v')
    if (-not $version) {
        throw 'The latest Leviathan release does not have a version tag.'
    }

    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    $checksumPath = Join-Path $temporaryRoot $checksumAssetName
    Invoke-WebRequest -Uri (Get-ReleaseAssetUrl -Release $release -Name $checksumAssetName) -OutFile $checksumPath -Headers $headers -UseBasicParsing -TimeoutSec 120
    $checksumText = Get-Content -LiteralPath $checksumPath -Raw

    foreach ($name in $assetNames) {
        $destination = Join-Path $temporaryRoot $name
        Write-Host "Downloading $name..."
        Invoke-WebRequest -Uri (Get-ReleaseAssetUrl -Release $release -Name $name) -OutFile $destination -Headers $headers -UseBasicParsing -TimeoutSec 300

        $expectedHash = Get-ExpectedHash -ChecksumText $checksumText -Name $name
        $actualHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "Checksum verification failed for $name."
        }
    }

    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    $currentExecutable = Join-Path $installRoot 'leviathan.exe'
    if (Test-Path -LiteralPath $currentExecutable) {
        Copy-Item -LiteralPath $currentExecutable -Destination (Join-Path $installRoot 'leviathan.previous.exe') -Force
    }

    Copy-Item -LiteralPath (Join-Path $temporaryRoot 'leviathan-windows-x64.exe') -Destination $currentExecutable -Force
    Copy-Item -LiteralPath (Join-Path $temporaryRoot 'leviathan-launcher.ps1') -Destination (Join-Path $installRoot 'leviathan-launcher.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $temporaryRoot 'leviathan-updater.ps1') -Destination (Join-Path $installRoot 'leviathan-updater.ps1') -Force

    $state = [ordered]@{
        installedVersion = $version
        repository = $repository
        releaseApiUrl = $releaseApiUrl
        lastUpdateCheckUtc = [DateTime]::UtcNow.ToString('o')
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
        if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $binDirectory.TrimEnd('\') })) {
            $env:Path = "$binDirectory;$env:Path"
        }
    }

    if ($env:LEVIATHAN_INSTALL_SKIP_PROFILE_CLEANUP -ne '1') {
        Remove-LegacyProfileCommand
    }

    Write-Host ''
    Write-Host "Leviathan $version installed successfully." -ForegroundColor Green
    Write-Host 'Run Leviathan from any directory with:'
    Write-Host '  leviathan' -ForegroundColor Cyan
} finally {
    $ProgressPreference = $previousProgressPreference
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
