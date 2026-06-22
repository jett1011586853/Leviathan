[CmdletBinding()]
param(
    [string]$ProfilePath = $PROFILE
)

$ErrorActionPreference = 'Stop'

$launcherPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'start-leviathan.ps1')).Path
$escapedLauncherPath = $launcherPath.Replace("'", "''")
$startMarker = '# >>> Leviathan CLI >>>'
$endMarker = '# <<< Leviathan CLI <<<'

$profileDirectory = Split-Path -Parent $ProfilePath
if ($profileDirectory) {
    New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $ProfilePath)) {
    New-Item -ItemType File -Path $ProfilePath -Force | Out-Null
}

$block = @"
$startMarker
function Start-Leviathan {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromRemainingArguments = `$true)]
        [string[]]`$LeviathanArgs
    )

    & '$escapedLauncherPath' @LeviathanArgs
}
Set-Alias -Name leviathan -Value Start-Leviathan -Scope Global
$endMarker
"@

$content = Get-Content -LiteralPath $ProfilePath -Raw -ErrorAction SilentlyContinue
if ($null -eq $content) {
    $content = ''
}

$markerPattern = '(?ms)^' + [regex]::Escape($startMarker) + '.*?^' + [regex]::Escape($endMarker) + '\s*'
if ([regex]::IsMatch($content, $markerPattern)) {
    $updatedContent = [regex]::Replace($content, $markerPattern, $block + [Environment]::NewLine)
} else {
    $separator = if ($content.Length -gt 0 -and -not $content.EndsWith([Environment]::NewLine)) {
        [Environment]::NewLine
    } else {
        ''
    }
    $updatedContent = $content + $separator + $block + [Environment]::NewLine
}

Set-Content -LiteralPath $ProfilePath -Value $updatedContent -Encoding UTF8

Write-Host "Installed the Leviathan command in $ProfilePath"
Write-Host 'Reload PowerShell with: . $PROFILE'
