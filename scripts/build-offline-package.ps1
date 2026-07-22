[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputRoot) {
    $OutputRoot = Join-Path $repoRoot 'artifacts\offline'
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$buildId = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$packageName = "Leviathan-$version-windows-x64-offline-$buildId"
$stageDirectory = Join-Path $OutputRoot $packageName
$zipPath = "$stageDirectory.zip"

if (-not $SkipBuild) {
    & bun run build:release
    if ($LASTEXITCODE -ne 0) { throw 'Leviathan release build failed.' }
    & bun run build:game-capture
    if ($LASTEXITCODE -ne 0) { throw 'Leviathan game capture build failed.' }
}

$sources = [ordered]@{
    (Join-Path $repoRoot 'dist-release\leviathan.exe') = 'leviathan-windows-x64.exe'
    (Join-Path $repoRoot 'native\game-capture\target\release\leviathan-game-capture.exe') = 'leviathan-game-capture-windows-x64.exe'
    (Join-Path $repoRoot 'node_modules\@img\sharp-win32-x64\lib\libvips-42.dll') = 'libvips-42.dll'
    (Join-Path $repoRoot 'node_modules\@img\sharp-win32-x64\lib\libvips-cpp-8.17.3.dll') = 'libvips-cpp-8.17.3.dll'
    (Join-Path $repoRoot 'scripts\leviathan-launcher.ps1') = 'leviathan-launcher.ps1'
    (Join-Path $repoRoot 'scripts\leviathan-updater.ps1') = 'leviathan-updater.ps1'
    (Join-Path $repoRoot 'scripts\leviathan-offline-installer.ps1') = 'install-offline.ps1'
    (Join-Path $repoRoot 'scripts\install-leviathan-offline.cmd') = 'install.cmd'
    (Join-Path $repoRoot 'scripts\README-OFFLINE.txt') = 'README.txt'
}

foreach ($sourcePath in $sources.Keys) {
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Required package input is missing: $sourcePath"
    }
}

New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null
foreach ($entry in $sources.GetEnumerator()) {
    Copy-Item -LiteralPath $entry.Key -Destination (Join-Path $stageDirectory $entry.Value) -Force
}
[IO.File]::WriteAllText((Join-Path $stageDirectory 'VERSION'), $version, [Text.Encoding]::ASCII)

$hashedAssets = @(
    'leviathan-windows-x64.exe',
    'leviathan-game-capture-windows-x64.exe',
    'libvips-42.dll',
    'libvips-cpp-8.17.3.dll',
    'leviathan-launcher.ps1',
    'leviathan-updater.ps1'
)
$checksumLines = foreach ($name in $hashedAssets) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $stageDirectory $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $name"
}
[IO.File]::WriteAllLines((Join-Path $stageDirectory 'SHA256SUMS'), $checksumLines, [Text.Encoding]::ASCII)

$previousPath = $env:PATH
try {
    $env:PATH = "$stageDirectory;$env:PATH"
    & (Join-Path $stageDirectory 'leviathan-windows-x64.exe') --help | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Packaged Leviathan executable failed its startup smoke test.'
    }
} finally {
    $env:PATH = $previousPath
}

Compress-Archive -LiteralPath $stageDirectory -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$zipPath.sha256", "$zipHash  $([IO.Path]::GetFileName($zipPath))`r`n", [Text.Encoding]::ASCII)

$allowedOutputRoot = $OutputRoot.TrimEnd('\') + '\'
$resolvedStageDirectory = [IO.Path]::GetFullPath($stageDirectory)
if (-not $resolvedStageDirectory.StartsWith($allowedOutputRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove a staging directory outside the offline output root.'
}
Remove-Item -LiteralPath $resolvedStageDirectory -Recurse -Force

Write-Host "Offline package: $zipPath" -ForegroundColor Green
Write-Host "SHA-256: $zipHash"
