[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$LeviathanArgs
)

$ErrorActionPreference = 'Stop'
$installRoot = $PSScriptRoot
$executablePath = Join-Path $installRoot 'leviathan.exe'
$updaterPath = Join-Path $installRoot 'leviathan-updater.ps1'
$statePath = Join-Path $installRoot 'install-state.json'
$pendingPath = Join-Path $installRoot 'pending-update.json'
$updatesRoot = Join-Path $installRoot 'updates'

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

function Write-InstallState {
    param([Parameter(Mandatory = $true)]$State)

    $json = $State | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($statePath, $json, (New-Object Text.UTF8Encoding($false)))
}

function Apply-PendingUpdate {
    if (-not (Test-Path -LiteralPath $pendingPath)) {
        return $false
    }

    $mutex = New-Object Threading.Mutex($false, 'Local\LeviathanUpdater')
    $hasMutex = $false
    try {
        $hasMutex = $mutex.WaitOne(0)
        if (-not $hasMutex) {
            return $false
        }

        $pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json
        $pendingDirectory = [IO.Path]::GetFullPath([string]$pending.directory)
        $allowedRoot = [IO.Path]::GetFullPath($updatesRoot).TrimEnd('\') + '\'
        if (-not $pendingDirectory.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Rejected an update outside the Leviathan updates directory.'
        }

        $newExecutable = Join-Path $pendingDirectory 'leviathan-windows-x64.exe'
        $newLauncher = Join-Path $pendingDirectory 'leviathan-launcher.ps1'
        $newUpdater = Join-Path $pendingDirectory 'leviathan-updater.ps1'
        foreach ($requiredFile in @($newExecutable, $newLauncher, $newUpdater)) {
            if (-not (Test-Path -LiteralPath $requiredFile)) {
                throw "Pending update is missing $requiredFile."
            }
        }

        $nextExecutable = Join-Path $installRoot 'leviathan.next.exe'
        $previousExecutable = Join-Path $installRoot 'leviathan.previous.exe'
        Copy-Item -LiteralPath $newExecutable -Destination $nextExecutable -Force
        if (Test-Path -LiteralPath $previousExecutable) {
            Remove-Item -LiteralPath $previousExecutable -Force
        }
        if (Test-Path -LiteralPath $executablePath) {
            Move-Item -LiteralPath $executablePath -Destination $previousExecutable -Force
        }
        try {
            Move-Item -LiteralPath $nextExecutable -Destination $executablePath -Force
        } catch {
            if (Test-Path -LiteralPath $previousExecutable) {
                Move-Item -LiteralPath $previousExecutable -Destination $executablePath -Force
            }
            throw
        }

        Copy-Item -LiteralPath $newLauncher -Destination (Join-Path $installRoot 'leviathan-launcher.ps1') -Force
        Copy-Item -LiteralPath $newUpdater -Destination $updaterPath -Force

        $state = Read-InstallState
        $state | Add-Member -NotePropertyName installedVersion -NotePropertyValue ([string]$pending.version) -Force
        Write-InstallState -State $state

        Remove-Item -LiteralPath $pendingPath -Force
        Remove-Item -LiteralPath $pendingDirectory -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Updated Leviathan to $($pending.version)." -ForegroundColor Green
        return $true
    } catch {
        Write-Warning "Leviathan could not apply its pending update: $($_.Exception.Message)"
        return $false
    } finally {
        if ($hasMutex) {
            $mutex.ReleaseMutex()
        }
        $mutex.Dispose()
    }
}

function Test-UpdateCheckDue {
    if ($env:LEVIATHAN_DISABLE_AUTO_UPDATE -eq '1') {
        return $false
    }

    $state = Read-InstallState
    if (-not $state.lastUpdateCheckUtc) {
        return $true
    }
    try {
        $lastCheck = [DateTime]::Parse([string]$state.lastUpdateCheckUtc).ToUniversalTime()
        return ([DateTime]::UtcNow - $lastCheck).TotalHours -ge 6
    } catch {
        return $true
    }
}

[void](Apply-PendingUpdate)

$manualUpdate =
    $LeviathanArgs.Count -eq 1 -and
    @('update', 'upgrade') -contains $LeviathanArgs[0].ToLowerInvariant()

if ($manualUpdate) {
    if (-not (Test-Path -LiteralPath $updaterPath)) {
        throw 'The Leviathan updater is not installed.'
    }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $updaterPath -InstallRoot $installRoot -Force
    [void](Apply-PendingUpdate)
    exit $LASTEXITCODE
}

if ((Test-UpdateCheckDue) -and (Test-Path -LiteralPath $updaterPath)) {
    $updaterArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$updaterPath`" -InstallRoot `"$installRoot`" -Quiet"
    Start-Process -FilePath powershell.exe -ArgumentList $updaterArguments -WindowStyle Hidden | Out-Null
}

if (-not (Test-Path -LiteralPath $executablePath)) {
    throw "Leviathan executable was not found at $executablePath."
}

$env:LEVIATHAN_CODE_INSTALL_ROOT = $installRoot
& $executablePath @LeviathanArgs
exit $LASTEXITCODE
