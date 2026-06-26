import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { getCachedPowerShellPath } from '../../utils/shell/powershellDetection.js'
import type { ComputerUseAction } from './constants.js'

const RESULT_PREFIX = '__LEVIATHAN_COMPUTER_USE_RESULT__'
const ERROR_PREFIX = '__LEVIATHAN_COMPUTER_USE_ERROR__'
const READY_LINE = '__LEVIATHAN_COMPUTER_USE_READY__'

type ComputerUseCommonInput = {
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
  include_screenshot?: boolean
  include_text?: boolean
}

export type ComputerUseStep = ComputerUseCommonInput & {
  action: Exclude<ComputerUseAction, 'sequence'>
}

export type ComputerUseInput = ComputerUseCommonInput & {
  action: ComputerUseAction
  steps?: ComputerUseStep[]
  screenshot_after?: boolean
}

export type ComputerUseWindow = {
  hwnd: string
  title: string
  processName: string
  processId: number
  bounds: { x: number; y: number; width: number; height: number }
  blockedReason?: string
}

export type ComputerUseApp = {
  id: string
  displayName: string
  isRunning: boolean
  windows: ComputerUseWindow[]
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
  coordinateSpace: 'screenshot'
  hwnd?: string
}

export type ComputerUseAccessibility = {
  tree: string
  focused_element?: string
  selected_text?: string
  selected_elements?: string[]
  document_text?: string
}

export type ComputerUseWindowState = {
  window: ComputerUseWindow
  screenshots: ComputerUseScreenshot[]
  accessibility: ComputerUseAccessibility | null
}

export type ComputerUseOutput = {
  ok: boolean
  action: ComputerUseAction
  message: string
  backend?: 'persistent-powershell'
  latencyMs?: number
  apps?: ComputerUseApp[]
  windows?: ComputerUseWindow[]
  window?: ComputerUseWindow
  screenshot?: ComputerUseScreenshot
  state?: ComputerUseWindowState
  steps?: Array<{
    ok: boolean
    action: ComputerUseAction
    message: string
  }>
}

type PendingRequest = {
  resolve: (value: ComputerUseOutput) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  abortListener?: () => void
}

let bridge: PowerShellComputerUseBridge | null = null

export async function runWindowsComputerUse(
  input: ComputerUseInput,
  signal?: AbortSignal,
): Promise<ComputerUseOutput> {
  const start = Date.now()
  const activeBridge = await getBridge()
  const output = await activeBridge.request(input, signal)
  return {
    ...output,
    backend: 'persistent-powershell',
    latencyMs: Date.now() - start,
  }
}

async function getBridge(): Promise<PowerShellComputerUseBridge> {
  if (bridge?.isAlive()) {
    return bridge
  }

  bridge = new PowerShellComputerUseBridge()
  await bridge.start()
  return bridge
}

class PowerShellComputerUseBridge {
  private child: ChildProcessWithoutNullStreams | null = null
  private readline: Interface | null = null
  private nextID = 1
  private pending = new Map<string, PendingRequest>()
  private stderrTail = ''
  private tempDir: string | null = null
  private alive = false

  isAlive(): boolean {
    return this.alive && this.child !== null && this.child.exitCode === null
  }

  async start(): Promise<void> {
    const psPath = await getCachedPowerShellPath()
    if (!psPath) {
      throw new Error('PowerShell is required for Windows Computer Use.')
    }

    this.tempDir = await mkdtemp(path.join(tmpdir(), 'leviathan-computer-use-'))
    const scriptPath = path.join(this.tempDir, 'bridge.ps1')
    await writeFile(scriptPath, buildPowerShellBridgeScript(), 'utf8')

    const child = spawn(
      psPath,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    this.child = child
    child.unref()
    unrefStream(child.stdin)
    unrefStream(child.stdout)
    unrefStream(child.stderr)

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      this.stderrTail = (this.stderrTail + chunk).slice(-8000)
    })

    this.readline = createInterface({ input: child.stdout })
    this.readline.on('line', line => this.handleLine(line))
    child.on('exit', () => {
      this.alive = false
      const error = new Error(
        `Computer Use bridge exited.${this.stderrTail ? `\n${this.stderrTail}` : ''}`,
      )
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout)
        pending.abortListener?.()
        pending.reject(error)
        this.pending.delete(id)
      }
      void this.cleanup()
    })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Computer Use bridge did not become ready.${this.stderrTail ? `\n${this.stderrTail}` : ''}`,
          ),
        )
      }, 10_000)

      const onLine = (line: string) => {
        if (line === READY_LINE) {
          clearTimeout(timeout)
          this.readline?.off('line', onLine)
          child.off('exit', onExit)
          this.alive = true
          resolve()
        }
      }
      const onExit = () => {
        clearTimeout(timeout)
        this.readline?.off('line', onLine)
        reject(
          new Error(
            `Computer Use bridge exited during startup.${this.stderrTail ? `\n${this.stderrTail}` : ''}`,
          ),
        )
      }

      this.readline?.on('line', onLine)
      child.once('exit', onExit)
    })
  }

  async request(
    input: ComputerUseInput,
    signal?: AbortSignal,
  ): Promise<ComputerUseOutput> {
    if (!this.child || !this.isAlive()) {
      throw new Error('Computer Use bridge is not running.')
    }

    const id = String(this.nextID++)
    const timeoutMs = Math.max(12_000, (input.duration_ms ?? 0) + 8_000)
    const payload = Buffer.from(JSON.stringify(input), 'utf16le').toString(
      'base64',
    )
    const line = `${id}\t${payload}\n`

    return await new Promise<ComputerUseOutput>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Computer Use timed out after ${timeoutMs} ms.`))
        this.stop()
      }, timeoutMs)

      let abortListener: (() => void) | undefined
      let removeAbortListener: (() => void) | undefined
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeout)
          reject(new Error('Computer Use was aborted.'))
          return
        }
        abortListener = () => {
          clearTimeout(timeout)
          this.pending.delete(id)
          reject(new Error('Computer Use was aborted.'))
          this.stop()
        }
        signal.addEventListener('abort', abortListener, { once: true })
        removeAbortListener = () =>
          signal.removeEventListener('abort', abortListener!)
      }

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
        abortListener: removeAbortListener,
      })

      this.child!.stdin.write(line, error => {
        if (error) {
          clearTimeout(timeout)
          removeAbortListener?.()
          this.pending.delete(id)
          reject(error)
        }
      })
    })
  }

  stop(): void {
    this.alive = false
    this.child?.kill()
  }

  private handleLine(line: string): void {
    if (line === READY_LINE) {
      return
    }
    if (line.startsWith(RESULT_PREFIX)) {
      this.finishRequest(line.slice(RESULT_PREFIX.length), false)
      return
    }
    if (line.startsWith(ERROR_PREFIX)) {
      this.finishRequest(line.slice(ERROR_PREFIX.length), true)
    }
  }

  private finishRequest(payloadLine: string, isError: boolean): void {
    const separatorIndex = payloadLine.indexOf('\t')
    if (separatorIndex < 0) {
      return
    }
    const id = payloadLine.slice(0, separatorIndex)
    const encoded = payloadLine.slice(separatorIndex + 1)
    const pending = this.pending.get(id)
    if (!pending) {
      return
    }
    this.pending.delete(id)
    clearTimeout(pending.timeout)
    pending.abortListener?.()

    const decoded = Buffer.from(encoded, 'base64').toString('utf16le')
    if (isError) {
      try {
        const errorOutput = JSON.parse(decoded) as { message?: string; detail?: string }
        pending.reject(
          new Error(
            [
              errorOutput.message ?? 'Computer Use failed.',
              errorOutput.detail,
              this.stderrTail,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        )
      } catch {
        pending.reject(new Error(decoded))
      }
      return
    }

    try {
      pending.resolve(JSON.parse(decoded) as ComputerUseOutput)
    } catch (error) {
      pending.reject(
        new Error(
          `Computer Use returned invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }\n${decoded.slice(0, 1000)}`,
        ),
      )
    }
  }

  private async cleanup(): Promise<void> {
    this.readline?.close()
    if (this.tempDir) {
      const tempDir = this.tempDir
      this.tempDir = null
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function unrefStream(stream: unknown): void {
  const maybeUnref = (stream as { unref?: () => void }).unref
  if (typeof maybeUnref === 'function') {
    maybeUnref.call(stream)
  }
}

export function buildPowerShellBridgeScript(): string {
  return String.raw`
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {}

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

$script:ProcessNameCache = @{}
$script:LastScreenshots = @{}

function Write-BridgeMessage {
  param([string]$Prefix, [string]$Id, [object]$Payload)
  $json = $Payload | ConvertTo-Json -Depth 20 -Compress
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($json))
  [Console]::Out.WriteLine(('{0}{1}{2}{3}' -f $Prefix, $Id, [char]9, $encoded))
  [Console]::Out.Flush()
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

function Get-ProcessNameForPid {
  param([uint32]$ProcessId)
  $key = [string]$ProcessId
  if ($script:ProcessNameCache.ContainsKey($key)) {
    return $script:ProcessNameCache[$key]
  }
  $name = ''
  try {
    if ($ProcessId -ne 0) {
      $name = (Get-Process -Id ([int]$ProcessId) -ErrorAction Stop).ProcessName
    }
  } catch {
    $name = ''
  }
  $script:ProcessNameCache[$key] = $name
  return $name
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
  $processName = Get-ProcessNameForPid $pidValue
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

function List-Apps {
  $windows = @(List-Windows)
  $groups = $windows | Group-Object -Property processName
  $apps = New-Object System.Collections.Generic.List[object]
  foreach ($group in $groups) {
    if ([string]::IsNullOrWhiteSpace([string]$group.Name)) { continue }
    $apps.Add([pscustomobject]@{
      id = [string]$group.Name
      displayName = [string]$group.Name
      isRunning = $true
      windows = @($group.Group)
    })
  }
  return $apps
}

function Activate-Window {
  param([IntPtr]$Hwnd)
  $info = Assert-WindowSafe $Hwnd
  [void][LeviathanUser32]::ShowWindow($Hwnd, 9)
  Start-Sleep -Milliseconds 30
  [void][LeviathanUser32]::SetForegroundWindow($Hwnd)
  Start-Sleep -Milliseconds 45
  return $info
}

function Resolve-Point {
  param([IntPtr]$Hwnd, [double]$X, [double]$Y)
  if ($Hwnd -eq [IntPtr]::Zero) {
    return [pscustomobject]@{ x = [int][Math]::Round($X); y = [int][Math]::Round($Y) }
  }
  $bounds = Get-WindowBounds $Hwnd
  $key = ([Int64]$Hwnd).ToString()
  if ($script:LastScreenshots.ContainsKey($key)) {
    $scale = [double]$script:LastScreenshots[$key].scale
    if ($scale -gt 0 -and $scale -lt 1) {
      $X = $X / $scale
      $Y = $Y / $scale
    }
  }
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
    Start-Sleep -Milliseconds 18
    [LeviathanUser32]::mouse_event([uint32]$up, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 35
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
  if ($raw -match '(?i)(^|[+_\-\s])(win|windows|meta|super|cmd|command|os)([+_\-\s]|$)') {
    throw 'Windows/Meta key shortcuts are not allowed for Computer Use.'
  }
  if ($raw.StartsWith('{') -or $raw.StartsWith('^') -or $raw.StartsWith('%') -or $raw.StartsWith('+')) {
    return $raw
  }
  $parts = $raw -split '\+'
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
    'period' = '.'; 'comma' = ','; 'slash' = '/'; 'backslash' = '\';
  }
  if ($named.ContainsKey($lower)) {
    return $mods + $named[$lower]
  }
  if ($lower -match '^f([1-9]|1[0-2])$') {
    return $mods + '{' + $lower.ToUpperInvariant() + '}'
  }
  if ($lower -match '^(kp|numpad)_?([0-9])$') {
    return $mods + $matches[2]
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
    coordinateSpace = 'screenshot'
  }
  if ($Hwnd -ne [IntPtr]::Zero) {
    $key = ([Int64]$Hwnd).ToString()
    $out.hwnd = $key
    $script:LastScreenshots[$key] = [pscustomobject]@{
      scale = $scale
      width = $finalWidth
      height = $finalHeight
      originalWidth = $width
      originalHeight = $height
    }
  }
  return [pscustomobject]$out
}

function Get-ElementBoundsText {
  param([object]$Rect)
  try {
    if ($Rect.IsEmpty) { return '' }
    return (' bounds={0},{1},{2}x{3}' -f [int]$Rect.X, [int]$Rect.Y, [int]$Rect.Width, [int]$Rect.Height)
  } catch {
    return ''
  }
}

function Get-AccessibilityTree {
  param([IntPtr]$Hwnd, [int]$Limit)
  if ($Limit -le 0) { $Limit = 220 }
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($Hwnd)
    if ($null -eq $root) { return $null }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $lines = New-Object System.Collections.Generic.List[string]
    $script:AccessibilityIndex = 0

    function Visit-Element {
      param([System.Windows.Automation.AutomationElement]$Element, [int]$Depth)
      if ($null -eq $Element -or $lines.Count -ge $Limit) { return }
      $current = $Element.Current
      $name = ''
      try { $name = [string]$current.Name } catch {}
      $controlType = ''
      try { $controlType = ([string]$current.ControlType.ProgrammaticName) -replace '^ControlType\.', '' } catch {}
      $automationId = ''
      try { $automationId = [string]$current.AutomationId } catch {}
      $bounds = ''
      try { $bounds = Get-ElementBoundsText $current.BoundingRectangle } catch {}
      if (-not [string]::IsNullOrWhiteSpace($name) -or -not [string]::IsNullOrWhiteSpace($automationId) -or -not [string]::IsNullOrWhiteSpace($controlType)) {
        $indent = '  ' * [Math]::Min(10, $Depth)
        $label = ('[{0}] {1}{2}' -f $script:AccessibilityIndex, $controlType, $bounds)
        if (-not [string]::IsNullOrWhiteSpace($name)) { $label += (' name="{0}"' -f ($name -replace '"', '\"')) }
        if (-not [string]::IsNullOrWhiteSpace($automationId)) { $label += (' automationId="{0}"' -f ($automationId -replace '"', '\"')) }
        $lines.Add($indent + $label)
        $script:AccessibilityIndex += 1
      }
      $child = $walker.GetFirstChild($Element)
      while ($null -ne $child -and $lines.Count -lt $Limit) {
        Visit-Element $child ($Depth + 1)
        $child = $walker.GetNextSibling($child)
      }
    }

    Visit-Element $root 0
    $focused = $null
    try {
      $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
      if ($null -ne $focusedElement) {
        $focused = ('{0} name="{1}"' -f $focusedElement.Current.ControlType.ProgrammaticName, $focusedElement.Current.Name)
      }
    } catch {}
    $tree = if ($lines.Count -gt 0) { [string]::Join([Environment]::NewLine, $lines.ToArray()) } else { '' }
    $result = [ordered]@{ tree = $tree }
    if ($focused) { $result.focused_element = $focused }
    return [pscustomobject]$result
  } catch {
    return [pscustomobject]@{ tree = ''; focused_element = "Accessibility unavailable: $($_.Exception.Message)" }
  }
}

function Get-WindowState {
  param([object]$Payload)
  $hwnd = Get-Hwnd $Payload.hwnd
  if ($hwnd -eq [IntPtr]::Zero) { throw 'hwnd is required for get_window_state' }
  $info = Assert-WindowSafe $hwnd
  $includeScreenshot = $true
  if ($null -ne $Payload.include_screenshot) { $includeScreenshot = [bool]$Payload.include_screenshot }
  $includeText = $false
  if ($null -ne $Payload.include_text) { $includeText = [bool]$Payload.include_text }
  $screenshots = @()
  if ($includeScreenshot) {
    $maxDimension = 1400
    if ($null -ne $Payload.max_image_dimension) { $maxDimension = [int]$Payload.max_image_dimension }
    $screenshots = @(Capture-Screenshot $hwnd $maxDimension)
  }
  $accessibility = $null
  if ($includeText) {
    $accessibility = Get-AccessibilityTree $hwnd 220
  }
  return [pscustomobject]@{
    window = $info
    screenshots = $screenshots
    accessibility = $accessibility
  }
}

function Invoke-ComputerAction {
  param([object]$Payload)
  $action = [string]$Payload.action
  $hwnd = Get-Hwnd $Payload.hwnd

  switch ($action) {
    'list_apps' {
      return [ordered]@{
        ok = $true
        action = $action
        message = 'Listed running apps with visible windows.'
        apps = @(List-Apps)
      }
    }
    'list_windows' {
      return [ordered]@{
        ok = $true
        action = $action
        message = 'Listed visible windows.'
        windows = @(List-Windows)
      }
    }
    'get_window' {
      if ($hwnd -eq [IntPtr]::Zero) { throw 'hwnd is required for get_window' }
      return [ordered]@{
        ok = $true
        action = $action
        message = 'Refreshed window.'
        window = (Assert-WindowSafe $hwnd)
      }
    }
    'get_window_state' {
      $state = Get-WindowState $Payload
      return [ordered]@{
        ok = $true
        action = $action
        message = 'Captured window state.'
        window = $state.window
        state = $state
      }
    }
    'screenshot' {
      $maxDimension = 1400
      if ($null -ne $Payload.max_image_dimension) { $maxDimension = [int]$Payload.max_image_dimension }
      $shot = Capture-Screenshot $hwnd $maxDimension
      return [ordered]@{
        ok = $true
        action = $action
        message = 'Captured screenshot.'
        screenshot = $shot
      }
    }
    'activate_window' {
      if ($hwnd -eq [IntPtr]::Zero) { throw 'hwnd is required for activate_window' }
      $info = Activate-Window $hwnd
      return [ordered]@{ ok = $true; action = $action; message = 'Activated window.'; window = $info }
    }
    { $_ -in @('click', 'double_click', 'right_click') } {
      if ($null -eq $Payload.x -or $null -eq $Payload.y) { throw 'x and y are required for click actions' }
      if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
      $point = Resolve-Point $hwnd ([double]$Payload.x) ([double]$Payload.y)
      [void][LeviathanUser32]::SetCursorPos($point.x, $point.y)
      $button = 'left'
      if ($null -ne $Payload.button) { $button = [string]$Payload.button }
      $count = 1
      if ($action -eq 'double_click') { $count = 2 }
      if ($action -eq 'right_click') { $button = 'right' }
      Invoke-MouseClick $button $count
      return [ordered]@{ ok = $true; action = $action; message = "Clicked at $($point.x),$($point.y)." }
    }
    'type_text' {
      if ($null -eq $Payload.text) { throw 'text is required for type_text' }
      if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
      [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText ([string]$Payload.text)))
      return [ordered]@{ ok = $true; action = $action; message = 'Typed text.' }
    }
    'press_key' {
      if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
      [System.Windows.Forms.SendKeys]::SendWait((Convert-KeySpec ([string]$Payload.key)))
      return [ordered]@{ ok = $true; action = $action; message = "Pressed key $($Payload.key)." }
    }
    'scroll' {
      if ($null -eq $Payload.x -or $null -eq $Payload.y) { throw 'x and y are required for scroll' }
      if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
      $point = Resolve-Point $hwnd ([double]$Payload.x) ([double]$Payload.y)
      [void][LeviathanUser32]::SetCursorPos($point.x, $point.y)
      $scrollY = 600
      if ($null -ne $Payload.scroll_y) { $scrollY = [int]$Payload.scroll_y }
      $delta = -[int]$scrollY
      [LeviathanUser32]::mouse_event([uint32]0x0800, 0, 0, $delta, [UIntPtr]::Zero)
      return [ordered]@{ ok = $true; action = $action; message = "Scrolled at $($point.x),$($point.y)." }
    }
    'drag' {
      if ($null -eq $Payload.x -or $null -eq $Payload.y -or $null -eq $Payload.to_x -or $null -eq $Payload.to_y) {
        throw 'x, y, to_x, and to_y are required for drag'
      }
      if ($hwnd -ne [IntPtr]::Zero) { [void](Activate-Window $hwnd) }
      $from = Resolve-Point $hwnd ([double]$Payload.x) ([double]$Payload.y)
      $to = Resolve-Point $hwnd ([double]$Payload.to_x) ([double]$Payload.to_y)
      [void][LeviathanUser32]::SetCursorPos($from.x, $from.y)
      [LeviathanUser32]::mouse_event([uint32]0x0002, 0, 0, 0, [UIntPtr]::Zero)
      for ($i = 1; $i -le 10; $i++) {
        $nx = [int][Math]::Round($from.x + (($to.x - $from.x) * $i / 10.0))
        $ny = [int][Math]::Round($from.y + (($to.y - $from.y) * $i / 10.0))
        [void][LeviathanUser32]::SetCursorPos($nx, $ny)
        Start-Sleep -Milliseconds 10
      }
      [LeviathanUser32]::mouse_event([uint32]0x0004, 0, 0, 0, [UIntPtr]::Zero)
      return [ordered]@{ ok = $true; action = $action; message = "Dragged from $($from.x),$($from.y) to $($to.x),$($to.y)." }
    }
    'wait' {
      $durationInput = 1000
      if ($null -ne $Payload.duration_ms) { $durationInput = [int]$Payload.duration_ms }
      $duration = [Math]::Min(30000, [Math]::Max(0, $durationInput))
      Start-Sleep -Milliseconds $duration
      return [ordered]@{ ok = $true; action = $action; message = "Waited $duration ms." }
    }
    default {
      throw "Unsupported Computer Use action '$action'"
    }
  }
}

function Invoke-Sequence {
  param([object]$Payload)
  if ($null -eq $Payload.steps -or $Payload.steps.Count -eq 0) {
    throw 'sequence requires at least one step'
  }
  $summaries = @()
  foreach ($step in @($Payload.steps)) {
    if ([string]$step.action -eq 'sequence') {
      throw 'nested sequence actions are not supported'
    }
    if (($null -eq $step.hwnd -or [string]::IsNullOrWhiteSpace([string]$step.hwnd)) -and $null -ne $Payload.hwnd) {
      Add-Member -InputObject $step -NotePropertyName hwnd -NotePropertyValue $Payload.hwnd -Force
    }
    $stepResult = Invoke-ComputerAction $step
    $summaries += [pscustomobject]@{
      ok = [bool]$stepResult.ok
      action = [string]$stepResult.action
      message = [string]$stepResult.message
    }
  }
  $result = [ordered]@{
    ok = $true
    action = 'sequence'
    message = "Ran $($summaries.Count) Computer Use steps."
    steps = @($summaries)
  }
  if ($Payload.screenshot_after -eq $true) {
    $hwnd = Get-Hwnd $Payload.hwnd
    if ($hwnd -ne [IntPtr]::Zero) {
      $statePayload = [pscustomobject]@{
        hwnd = $Payload.hwnd
        include_screenshot = $true
        include_text = $false
        max_image_dimension = $Payload.max_image_dimension
      }
      $state = Get-WindowState $statePayload
      $result.window = $state.window
      $result.state = $state
    }
  }
  return $result
}

[Console]::Out.WriteLine('__LEVIATHAN_COMPUTER_USE_READY__')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }

  $separator = $line.IndexOf([char]9)
  if ($separator -le 0) { continue }
  $id = $line.Substring(0, $separator)
  $payloadBase64 = $line.Substring($separator + 1)

  try {
    $payloadJson = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($payloadBase64))
    $payload = $payloadJson | ConvertFrom-Json
    if ([string]$payload.action -eq 'sequence') {
      $result = Invoke-Sequence $payload
    } else {
      $result = Invoke-ComputerAction $payload
    }
    Write-BridgeMessage '__LEVIATHAN_COMPUTER_USE_RESULT__' $id $result
  } catch {
    Write-BridgeMessage '__LEVIATHAN_COMPUTER_USE_ERROR__' $id ([ordered]@{
      message = $_.Exception.Message
      detail = $_.ScriptStackTrace
    })
  }
}
`
}
