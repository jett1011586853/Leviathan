import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { getCachedPowerShellPath } from '../../utils/shell/powershellDetection.js'
import type { ComputerUseAction } from './constants.js'

export type ComputerUseInput = {
  action: ComputerUseAction
  hwnd?: string
  x?: number
  y?: number
  to_x?: number
  to_y?: number
  text?: string
  key?: string
  button?: 'left' | 'right' | 'middle'
  scroll_x?: number
  scroll_y?: number
  duration_ms?: number
  max_image_dimension?: number
}

export type ComputerUseWindow = {
  hwnd: string
  title: string
  processName: string
  processId: number
  bounds: { x: number; y: number; width: number; height: number }
  blockedReason?: string
}

export type ComputerUseScreenshot = {
  dataUrl: string
  mediaType: 'image/png'
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  originX: number
  originY: number
  scale: number
  hwnd?: string
}

export type ComputerUseOutput = {
  ok: boolean
  action: ComputerUseAction
  message: string
  windows?: ComputerUseWindow[]
  window?: ComputerUseWindow
  screenshot?: ComputerUseScreenshot
}

export async function runWindowsComputerUse(
  input: ComputerUseInput,
  signal?: AbortSignal,
): Promise<ComputerUseOutput> {
  const psPath = await getCachedPowerShellPath()
  if (!psPath) {
    throw new Error('PowerShell is required for Windows Computer Use.')
  }

  const payloadBase64 = Buffer.from(JSON.stringify(input), 'utf16le').toString(
    'base64',
  )
  const script = `${buildPowerShellScript(
    payloadBase64,
  )}\nWrite-Output '__LEVIATHAN_COMPUTER_USE_FLUSH__'`
  const result = await execFileNoThrowWithCwd(
    psPath,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
    {
      abortSignal: signal,
      cwd: undefined,
      input: script,
      maxBuffer: 25 * 1024 * 1024,
      preserveOutputOnError: true,
      stdin: 'pipe',
      timeout: Math.max(15_000, input.duration_ms ?? 0),
    },
  )

  if (result.code !== 0) {
    throw new Error(
      [
        'Computer Use failed.',
        result.stderr.trim(),
        result.stdout.trim(),
        result.error,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  const stdout = result.stdout
    .replace(/\r?\n?__LEVIATHAN_COMPUTER_USE_FLUSH__\s*$/u, '')
    .replace(/\r?\n?__LEVIATHAN_COMPUTER_USE_END__\s*$/u, '')
  try {
    return JSON.parse(stdout) as ComputerUseOutput
  } catch (error) {
    throw new Error(
      `Computer Use returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }\nstdout:\n${stdout.slice(0, 1000)}\nstderr:\n${result.stderr.slice(
        0,
        1000,
      )}`,
    )
  }
}

export function buildPowerShellScript(payloadBase64: string): string {
  return `
$ErrorActionPreference = 'Stop'
$payloadJson = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${payloadBase64}'))
$payload = $payloadJson | ConvertFrom-Json

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class LeviathanUser32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
}
"@

function Write-Result($result) {
  $result | ConvertTo-Json -Depth 12 -Compress
}

function Get-Hwnd {
  param([object]$Value)
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
    return [IntPtr]::Zero
  }
  return [IntPtr]([Int64]([string]$Value))
}

function Get-WindowTitle {
  param([IntPtr]$Hwnd)
  $length = [LeviathanUser32]::GetWindowTextLength($Hwnd)
  if ($length -le 0) { return '' }
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][LeviathanUser32]::GetWindowText($Hwnd, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Get-WindowBounds {
  param([IntPtr]$Hwnd)
  $rect = New-Object LeviathanUser32+RECT
  if (-not [LeviathanUser32]::GetWindowRect($Hwnd, [ref]$rect)) {
    throw "Could not read window bounds for hwnd $Hwnd"
  }
  return [pscustomobject]@{
    x = $rect.Left
    y = $rect.Top
    width = [Math]::Max(0, $rect.Right - $rect.Left)
    height = [Math]::Max(0, $rect.Bottom - $rect.Top)
  }
}

function Get-BlockReason {
  param([string]$ProcessName, [string]$Title)
  if ($null -eq $ProcessName) { $ProcessName = '' }
  if ($null -eq $Title) { $Title = '' }
  $name = $ProcessName.ToLowerInvariant()
  $titleText = $Title.ToLowerInvariant()
  $blockedProcesses = @(
    'cmd', 'codex', 'conhost', 'opencode', 'powershell', 'pwsh', 'windowsterminal',
    'openconsole', 'lockapp', 'securityhealthhost', 'securityhealthsystray',
    'msmpeng', 'smartscreen', 'credentialui', '1password', 'bitwarden',
    'keepass', 'lastpass'
  )
  if ($blockedProcesses -contains $name) {
    return 'Blocked for safety: terminal, credential, or security application.'
  }
  if ($titleText -match 'password|one-time|otp|captcha|security|windows security') {
    return 'Blocked for safety: credential, CAPTCHA, or security-related window.'
  }
  return $null
}

function Get-WindowInfo {
  param([IntPtr]$Hwnd)
  $title = Get-WindowTitle $Hwnd
  $bounds = Get-WindowBounds $Hwnd
  $pidValue = [uint32]0
  [void][LeviathanUser32]::GetWindowThreadProcessId($Hwnd, [ref]$pidValue)
  $processName = ''
  try {
    if ($pidValue -ne 0) {
      $processName = (Get-Process -Id ([int]$pidValue) -ErrorAction Stop).ProcessName
    }
  } catch {
    $processName = ''
  }
  $blockedReason = Get-BlockReason $processName $title
  $info = [ordered]@{
    hwnd = ([Int64]$Hwnd).ToString()
    title = $title
    processName = $processName
    processId = [int]$pidValue
    bounds = $bounds
  }
  if ($blockedReason) {
    $info.blockedReason = $blockedReason
  }
  return [pscustomobject]$info
}

function Assert-WindowSafe {
  param([IntPtr]$Hwnd)
  if ($Hwnd -eq [IntPtr]::Zero) { return $null }
  $info = Get-WindowInfo $Hwnd
  if ($info.blockedReason) {
    throw $info.blockedReason
  }
  return $info
}

function List-Windows {
  $items = New-Object System.Collections.Generic.List[object]
  $callback = [LeviathanUser32+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [LeviathanUser32]::IsWindowVisible($hWnd)) { return $true }
    $title = Get-WindowTitle $hWnd
    if ([string]::IsNullOrWhiteSpace($title)) { return $true }
    try {
      $info = Get-WindowInfo $hWnd
      if ($info.bounds.width -gt 0 -and $info.bounds.height -gt 0) {
        $items.Add($info)
      }
    } catch {}
    return $true
  }
  [void][LeviathanUser32]::EnumWindows($callback, [IntPtr]::Zero)
  return $items
}

function Activate-Window {
  param([IntPtr]$Hwnd)
  $info = Assert-WindowSafe $Hwnd
  [void][LeviathanUser32]::ShowWindow($Hwnd, 9)
  Start-Sleep -Milliseconds 80
  [void][LeviathanUser32]::SetForegroundWindow($Hwnd)
  Start-Sleep -Milliseconds 120
  return $info
}

function Resolve-Point {
  param([IntPtr]$Hwnd, [double]$X, [double]$Y)
  if ($Hwnd -eq [IntPtr]::Zero) {
    return [pscustomobject]@{ x = [int][Math]::Round($X); y = [int][Math]::Round($Y) }
  }
  $bounds = Get-WindowBounds $Hwnd
  return [pscustomobject]@{
    x = [int][Math]::Round($bounds.x + $X)
    y = [int][Math]::Round($bounds.y + $Y)
  }
}

function Invoke-MouseClick {
  param([string]$Button, [int]$Count)
  $down = 0x0002
  $up = 0x0004
  if ($Button -eq 'right') {
    $down = 0x0008
    $up = 0x0010
  } elseif ($Button -eq 'middle') {
    $down = 0x0020
    $up = 0x0040
  }
  for ($i = 0; $i -lt $Count; $i++) {
    [LeviathanUser32]::mouse_event([uint32]$down, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [LeviathanUser32]::mouse_event([uint32]$up, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
  }
}

function Escape-SendKeysText {
  param([string]$Text)
  $builder = New-Object System.Text.StringBuilder
  foreach ($ch in $Text.ToCharArray()) {
    $code = [int][char]$ch
    switch ($code) {
      13 { break }
      10 { [void]$builder.Append('{ENTER}'); break }
      9 { [void]$builder.Append('{TAB}'); break }
      default {
        switch ($ch) {
          '+' { [void]$builder.Append('{+}'); break }
          '^' { [void]$builder.Append('{^}'); break }
          '%' { [void]$builder.Append('{%}'); break }
          '~' { [void]$builder.Append('{~}'); break }
          '(' { [void]$builder.Append('{(}'); break }
          ')' { [void]$builder.Append('{)}'); break }
          '{' { [void]$builder.Append('{{}'); break }
          '}' { [void]$builder.Append('{}}'); break }
          '[' { [void]$builder.Append('{[}'); break }
          ']' { [void]$builder.Append('{]}'); break }
          default { [void]$builder.Append($ch); break }
        }
      }
    }
  }
  return $builder.ToString()
}

function Convert-KeySpec {
  param([string]$Key)
  if ([string]::IsNullOrWhiteSpace($Key)) {
    throw 'key is required for press_key'
  }
  $raw = $Key.Trim()
  if ($raw.StartsWith('{') -or $raw.StartsWith('^') -or $raw.StartsWith('%') -or $raw.StartsWith('+')) {
    return $raw
  }
  $parts = $raw -split '\\+'
  $mods = ''
  $mainParts = New-Object System.Collections.Generic.List[string]
  foreach ($part in $parts) {
    $p = $part.Trim().ToLowerInvariant()
    switch ($p) {
      { $_ -in @('ctrl', 'control', 'control_l', 'control_r') } { $mods += '^'; break }
      { $_ -in @('alt', 'alt_l', 'alt_r', 'option') } { $mods += '%'; break }
      { $_ -in @('shift', 'shift_l', 'shift_r') } { $mods += '+'; break }
      default { $mainParts.Add($part.Trim()); break }
    }
  }
  if ($mainParts.Count -eq 0) {
    throw "No non-modifier key found in '$Key'"
  }
  $main = ($mainParts -join '+').Trim()
  $lower = $main.ToLowerInvariant()
  $named = @{
    'enter' = '{ENTER}'; 'return' = '{ENTER}'; 'tab' = '{TAB}';
    'escape' = '{ESC}'; 'esc' = '{ESC}'; 'space' = ' ';
    'backspace' = '{BACKSPACE}'; 'delete' = '{DELETE}'; 'del' = '{DELETE}';
    'left' = '{LEFT}'; 'right' = '{RIGHT}'; 'up' = '{UP}'; 'down' = '{DOWN}';
    'home' = '{HOME}'; 'end' = '{END}'; 'pageup' = '{PGUP}'; 'pagedown' = '{PGDN}';
    'insert' = '{INSERT}'; 'ins' = '{INSERT}';
    'period' = '.'; 'comma' = ','; 'slash' = '/'; 'backslash' = '\\';
  }
  if ($named.ContainsKey($lower)) {
    return $mods + $named[$lower]
  }
  if ($lower -match '^f([1-9]|1[0-2])$') {
    return $mods + '{' + $lower.ToUpperInvariant() + '}'
  }
  if ($main.Length -eq 1) {
    return $mods + $main
  }
  return $mods + '{' + $main.ToUpperInvariant() + '}'
}

function Capture-Screenshot {
  param([IntPtr]$Hwnd, [int]$MaxDimension)
  if ($MaxDimension -le 0) { $MaxDimension = 1400 }
  if ($Hwnd -eq [IntPtr]::Zero) {
    $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $originX = $screen.Left
    $originY = $screen.Top
    $width = $screen.Width
    $height = $screen.Height
  } else {
    $info = Assert-WindowSafe $Hwnd
    $bounds = $info.bounds
    $originX = $bounds.x
    $originY = $bounds.y
    $width = $bounds.width
    $height = $bounds.height
  }
  if ($width -le 0 -or $height -le 0) {
    throw 'Screenshot target has no visible area.'
  }
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($originX, $originY, 0, 0, $bitmap.Size)
  $graphics.Dispose()

  $scale = [Math]::Min(1.0, [double]$MaxDimension / [double]([Math]::Max($width, $height)))
  $finalBitmap = $bitmap
  if ($scale -lt 1.0) {
    $newWidth = [Math]::Max(1, [int][Math]::Round($width * $scale))
    $newHeight = [Math]::Max(1, [int][Math]::Round($height * $scale))
    $finalBitmap = New-Object System.Drawing.Bitmap $newWidth, $newHeight
    $g2 = [System.Drawing.Graphics]::FromImage($finalBitmap)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.DrawImage($bitmap, 0, 0, $newWidth, $newHeight)
    $g2.Dispose()
    $bitmap.Dispose()
  }

  $stream = New-Object System.IO.MemoryStream
  $finalBitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  $finalWidth = $finalBitmap.Width
  $finalHeight = $finalBitmap.Height
  $finalBitmap.Dispose()

  $out = [ordered]@{
    dataUrl = 'data:image/png;base64,' + [Convert]::ToBase64String($bytes)
    mediaType = 'image/png'
    width = $finalWidth
    height = $finalHeight
    originalWidth = $width
    originalHeight = $height
    originX = $originX
    originY = $originY
    scale = $scale
  }
  if ($Hwnd -ne [IntPtr]::Zero) {
    $out.hwnd = ([Int64]$Hwnd).ToString()
  }
  return [pscustomobject]$out
}

$action = [string]$payload.action
$hwnd = Get-Hwnd $payload.hwnd
$result = $null

switch ($action) {
  'list_windows' {
    $result = [ordered]@{
      ok = $true
      action = $action
      message = 'Listed visible windows.'
      windows = @(List-Windows)
    }
  }
  'screenshot' {
    $maxDimension = 1400
    if ($null -ne $payload.max_image_dimension) { $maxDimension = [int]$payload.max_image_dimension }
    $shot = Capture-Screenshot $hwnd $maxDimension
    $result = [ordered]@{
      ok = $true
      action = $action
      message = 'Captured screenshot.'
      screenshot = $shot
    }
  }
  'activate_window' {
    if ($hwnd -eq [IntPtr]::Zero) { throw 'hwnd is required for activate_window' }
    $info = Activate-Window $hwnd
    $result = [ordered]@{ ok = $true; action = $action; message = 'Activated window.'; window = $info }
  }
  { $_ -in @('click', 'double_click', 'right_click') } {
    if ($null -eq $payload.x -or $null -eq $payload.y) { throw 'x and y are required for click actions' }
    if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
    $point = Resolve-Point $hwnd ([double]$payload.x) ([double]$payload.y)
    [void][LeviathanUser32]::SetCursorPos($point.x, $point.y)
    $button = 'left'
    if ($null -ne $payload.button) { $button = [string]$payload.button }
    $count = 1
    if ($action -eq 'double_click') { $count = 2 }
    if ($action -eq 'right_click') { $button = 'right' }
    Invoke-MouseClick $button $count
    $result = [ordered]@{ ok = $true; action = $action; message = "Clicked at $($point.x),$($point.y)." }
  }
  'type_text' {
    if ($null -eq $payload.text) { throw 'text is required for type_text' }
    if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
    [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText ([string]$payload.text)))
    $result = [ordered]@{ ok = $true; action = $action; message = 'Typed text.' }
  }
  'press_key' {
    if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
    [System.Windows.Forms.SendKeys]::SendWait((Convert-KeySpec ([string]$payload.key)))
    $result = [ordered]@{ ok = $true; action = $action; message = "Pressed key $($payload.key)." }
  }
  'scroll' {
    if ($null -eq $payload.x -or $null -eq $payload.y) { throw 'x and y are required for scroll' }
    if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
    $point = Resolve-Point $hwnd ([double]$payload.x) ([double]$payload.y)
    [void][LeviathanUser32]::SetCursorPos($point.x, $point.y)
    $scrollY = 600
    if ($null -ne $payload.scroll_y) { $scrollY = [int]$payload.scroll_y }
    $delta = -[int]$scrollY
    [LeviathanUser32]::mouse_event([uint32]0x0800, 0, 0, $delta, [UIntPtr]::Zero)
    $result = [ordered]@{ ok = $true; action = $action; message = "Scrolled at $($point.x),$($point.y)." }
  }
  'drag' {
    if ($null -eq $payload.x -or $null -eq $payload.y -or $null -eq $payload.to_x -or $null -eq $payload.to_y) {
      throw 'x, y, to_x, and to_y are required for drag'
    }
    if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
    $from = Resolve-Point $hwnd ([double]$payload.x) ([double]$payload.y)
    $to = Resolve-Point $hwnd ([double]$payload.to_x) ([double]$payload.to_y)
    [void][LeviathanUser32]::SetCursorPos($from.x, $from.y)
    [LeviathanUser32]::mouse_event([uint32]0x0002, 0, 0, 0, [UIntPtr]::Zero)
    for ($i = 1; $i -le 12; $i++) {
      $nx = [int][Math]::Round($from.x + (($to.x - $from.x) * $i / 12.0))
      $ny = [int][Math]::Round($from.y + (($to.y - $from.y) * $i / 12.0))
      [void][LeviathanUser32]::SetCursorPos($nx, $ny)
      Start-Sleep -Milliseconds 15
    }
    [LeviathanUser32]::mouse_event([uint32]0x0004, 0, 0, 0, [UIntPtr]::Zero)
    $result = [ordered]@{ ok = $true; action = $action; message = "Dragged from $($from.x),$($from.y) to $($to.x),$($to.y)." }
  }
  'wait' {
    $durationInput = 1000
    if ($null -ne $payload.duration_ms) { $durationInput = [int]$payload.duration_ms }
    $duration = [Math]::Min(30000, [Math]::Max(0, $durationInput))
    Start-Sleep -Milliseconds $duration
    $result = [ordered]@{ ok = $true; action = $action; message = "Waited $duration ms." }
  }
  default {
    throw "Unsupported Computer Use action '$action'"
  }
}

if ($null -eq $result) {
  throw "Computer Use action '$action' produced no result."
}
Write-Result $result
Write-Output '__LEVIATHAN_COMPUTER_USE_END__'
[Console]::Out.Flush()
Start-Sleep -Milliseconds 1
`
}
