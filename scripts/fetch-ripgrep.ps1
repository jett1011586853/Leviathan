<#
.SYNOPSIS
  Downloads the ripgrep binary Leviathan's Grep and Glob tools need.

.DESCRIPTION
  Leviathan resolves ripgrep from (in order):
    1. LEVIATHAN_CODE_RIPGREP_PATH
    2. USE_BUILTIN_RIPGREP=0 -> system rg on PATH
    3. <build dir>\vendor\ripgrep\<arch>-win32\rg.exe
    4. <repo root>\vendor\ripgrep\<arch>-win32\rg.exe
    5. <Leviathan config home>\vendor\ripgrep\<arch>-win32\rg.exe

  Dist and dist-release builds never shipped the vendor directory, so Grep and
  Glob failed with ENOENT. This script downloads the official Windows build
  once and installs it into the config home (works for every launch mode) plus
  any vendor directories that already exist next to a build.

.PARAMETER Version
  ripgrep release to install. Defaults to the latest release.

.PARAMETER MirrorBase
  Optional download prefix for networks that cannot reach github.com
  directly, e.g. -MirrorBase "https://ghfast.top/". The GitHub API asset URL
  (api.github.com) is used first and works on most restricted networks.

.PARAMETER Force
  Re-download even when rg.exe is already present.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/fetch-ripgrep.ps1
#>
[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$MirrorBase = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 negotiates TLS 1.0 by default, which GitHub rejects.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}
catch {
  Write-Verbose "Could not raise TLS version: $_"
}

if (-not $IsWindows -and $env:OS -ne "Windows_NT") {
  Write-Error "This script only installs the Windows ripgrep build. On other platforms use your package manager."
}

switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
  "X64"   { $target = "x86_64-pc-windows-msvc"; $archDir = "x64-win32" }
  "Arm64" { $target = "aarch64-pc-windows-msvc"; $archDir = "arm64-win32" }
  default { throw "Unsupported architecture: $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$configHome = if ($env:LEVIATHAN_CONFIG_DIR) { $env:LEVIATHAN_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".leviathan" }

function Invoke-Curl {
  param([string[]]$CurlArgs)
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { throw "curl.exe is required (bundled with Windows 10 1803+)." }
  & $curl.Source @CurlArgs
  if ($LASTEXITCODE -ne 0) { throw "curl failed with exit code $LASTEXITCODE" }
}

function Get-ExistingRipgrep {
  $candidates = @()

  $onPath = Get-Command rg -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }

  # Leviathan's own config home, then binaries shipped with other tools.
  $candidates += (Join-Path $configHome "vendor\ripgrep\$archDir\rg.exe")
  $candidates += (Join-Path $env:USERPROFILE "scoop\shims\rg.exe")
  $candidates += (Join-Path $env:USERPROFILE ".cargo\bin\rg.exe")
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\rg.exe")
    $codexBin = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
    if (Test-Path $codexBin) {
      $candidates += Get-ChildItem -Path $codexBin -Recurse -Filter "rg.exe" -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
    }
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Get-ReleaseInfo {
  param([string]$RequestedVersion)
  $apiArgs = @(
    "-sS", "--max-time", "60",
    "-H", "User-Agent: leviathan-fetch-ripgrep",
    "https://api.github.com/repos/BurntSushi/ripgrep/releases/latest"
  )
  $release = (Invoke-Curl -CurlArgs $apiArgs) -join "`n" | ConvertFrom-Json
  $tag = if ($RequestedVersion) {
    if ($RequestedVersion.StartsWith("v")) { $RequestedVersion } else { "v$RequestedVersion" }
  }
  else { $release.tag_name }

  $assetName = "ripgrep-$($tag.TrimStart('v'))-$target.zip"
  $assetId = $null
  if ($release.tag_name -eq $tag) {
    $match = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
    if ($match) { $assetId = $match.id }
  }

  $directUrl = "${MirrorBase}https://github.com/BurntSushi/ripgrep/releases/download/$tag/$assetName"
  $apiUrl = if ($assetId) { "https://api.github.com/repos/BurntSushi/ripgrep/releases/assets/$assetId" } else { $null }

  return @{
    Tag       = $tag
    Name      = $assetName
    DirectUrl = $directUrl
    ApiUrl    = $apiUrl
  }
}

function Get-RipgrepArchive {
  param([hashtable]$Release, [string]$Destination)
  $attempts = @()
  if ($Release.ApiUrl) {
    $attempts += @{
      Label = "GitHub API asset"
      Args  = @(
        "-sSL", "--max-time", "900",
        "-H", "User-Agent: leviathan-fetch-ripgrep",
        "-H", "Accept: application/octet-stream",
        "-o", $Destination, $Release.ApiUrl
      )
    }
  }
  $attempts += @{
    Label = "direct release URL"
    Args  = @(
      "-sSL", "--max-time", "900",
      "-H", "User-Agent: leviathan-fetch-ripgrep",
      "-o", $Destination, $Release.DirectUrl
    )
  }

  foreach ($attempt in $attempts) {
    try {
      Write-Host "Downloading ripgrep $($Release.Tag) via $($attempt.Label)"
      Invoke-Curl -CurlArgs $attempt.Args
      if ((Test-Path $Destination) -and (Get-Item $Destination).Length -gt 100000) {
        return $true
      }
      Write-Warning "Download via $($attempt.Label) produced an incomplete file."
      Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    }
    catch {
      Write-Warning "Download via $($attempt.Label) failed: $_"
    }
  }
  return $false
}

$destinations = @(
  (Join-Path $configHome "vendor\ripgrep\$archDir"),
  (Join-Path $repoRoot "vendor\ripgrep\$archDir"),
  (Join-Path $repoRoot "src\utils\vendor\ripgrep\$archDir")
)

foreach ($distDir in @("dist", "dist-startup", "dist-release")) {
  $candidate = Join-Path $repoRoot $distDir
  if (Test-Path $candidate) {
    $destinations += Join-Path $candidate "vendor\ripgrep\$archDir"
  }
}

if (-not $Force) {
  $existing = $destinations | Where-Object { Test-Path (Join-Path $_ "rg.exe") } | Select-Object -First 1
  if ($existing) {
    Write-Host "ripgrep already present at $existing (use -Force to re-download)."
    & (Join-Path $existing "rg.exe") --version
    exit 0
  }
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("leviathan-ripgrep-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
  $sourceExe = $null

  # Prefer an rg.exe that already exists on the machine (other agent runtimes
  # and package managers ship one). This keeps the fix working offline.
  $localRg = Get-ExistingRipgrep
  if ($localRg) {
    Write-Host "Using existing ripgrep at $localRg"
    $sourceExe = $localRg
  }

  if (-not $sourceExe) {
    $release = Get-ReleaseInfo -RequestedVersion $Version
    $zipPath = Join-Path $tempRoot $release.Name
    if (-not (Get-RipgrepArchive -Release $release -Destination $zipPath)) {
      throw "Could not download ripgrep. Install it manually (winget install BurntSushi.ripgrep.MSVC) and either re-run this script or set LEVIATHAN_CODE_RIPGREP_PATH."
    }

    $extractRoot = Join-Path $tempRoot "extracted"
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

    $rgExe = Get-ChildItem -Path $extractRoot -Recurse -Filter "rg.exe" | Select-Object -First 1
    if (-not $rgExe) {
      throw "rg.exe was not found inside $($release.Name)"
    }
    $sourceExe = $rgExe.FullName
  }

  foreach ($destination in $destinations) {
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $destination "rg.exe") -Force
    Write-Host "Installed -> $(Join-Path $destination 'rg.exe')"
  }

  & (Join-Path $destinations[0] "rg.exe") --version
  Write-Host "Done. Restart Leviathan so the new binary is picked up."
}
finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
