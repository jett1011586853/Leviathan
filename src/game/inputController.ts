import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { getCachedPowerShellPath } from '../utils/shell/powershellDetection.js'
import type {
  ActiveGameModelMode,
  GameControlPlan,
} from './types.js'

const READY_LINE = '__LEVIATHAN_GAME_INPUT_READY__'
const RESULT_PREFIX = '__LEVIATHAN_GAME_INPUT_RESULT__'

type PendingRequest = {
  resolve: (value: GameInputBridgeResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type GameInputBridgeResult = {
  ok: boolean
  message: string
  foregroundHwnd?: string
}

export class GameInputController {
  private bridge: GameInputBridge | undefined
  private readonly pressedKeys = new Set<string>()
  private fireDown = false
  private leaseExpiresAt = 0

  constructor(
    private readonly mode: ActiveGameModelMode,
    private readonly hwnd?: string,
  ) {}

  get inputLeaseExpiresAt(): number | undefined {
    return this.leaseExpiresAt > 0 ? this.leaseExpiresAt : undefined
  }

  async applyPlan(plan: GameControlPlan): Promise<void> {
    if (this.mode !== 'live') return
    if (!this.hwnd) {
      throw new Error('Live GameModel control requires a target hwnd.')
    }

    const desiredKeys = new Set(plan.desiredKeys.map(normalizeKey))
    const keysDown = [...desiredKeys].filter(key => !this.pressedKeys.has(key))
    const keysUp = [...this.pressedKeys].filter(key => !desiredKeys.has(key))
    const fireDown = plan.fire && !this.fireDown
    const fireUp = !plan.fire && this.fireDown

    const bridge = await this.getBridge()
    await bridge.request({
      action: 'apply',
      hwnd: this.hwnd,
      keysDown,
      keysUp,
      tapKeys: plan.tapKeys.map(normalizeKey),
      mouseDx: plan.mouseDelta?.x ?? 0,
      mouseDy: plan.mouseDelta?.y ?? 0,
      fireDown,
      fireUp,
    })

    this.pressedKeys.clear()
    for (const key of desiredKeys) this.pressedKeys.add(key)
    this.fireDown = plan.fire
    this.leaseExpiresAt = Date.now() + plan.leaseMs
  }

  async releaseIfExpired(now = Date.now()): Promise<boolean> {
    if (this.leaseExpiresAt === 0 || now < this.leaseExpiresAt) return false
    await this.releaseAll()
    return true
  }

  async releaseAll(): Promise<void> {
    this.leaseExpiresAt = 0
    this.pressedKeys.clear()
    this.fireDown = false
    if (!this.bridge) return
    await this.bridge
      .request({ action: 'release_all', hwnd: this.hwnd })
      .catch(() => {})
  }

  async close(): Promise<void> {
    await this.releaseAll()
    await this.bridge?.close()
    this.bridge = undefined
  }

  private async getBridge(): Promise<GameInputBridge> {
    if (this.bridge?.isAlive()) return this.bridge
    const bridge = new GameInputBridge()
    await bridge.start()
    this.bridge = bridge
    return bridge
  }
}

type GameInputBridgeRequest =
  | {
      action: 'apply'
      hwnd: string
      keysDown: string[]
      keysUp: string[]
      tapKeys: string[]
      mouseDx: number
      mouseDy: number
      fireDown: boolean
      fireUp: boolean
    }
  | { action: 'release_all'; hwnd?: string }
  | { action: 'stop' }

class GameInputBridge {
  private child: ChildProcessWithoutNullStreams | undefined
  private readline: Interface | undefined
  private tempDir: string | undefined
  private nextId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private stderrTail = ''

  isAlive(): boolean {
    return this.child !== undefined && this.child.exitCode === null
  }

  async start(): Promise<void> {
    const powershell = await getCachedPowerShellPath()
    if (!powershell) {
      throw new Error('PowerShell is required for live GameModel input.')
    }

    this.tempDir = await mkdtemp(join(tmpdir(), 'leviathan-game-input-'))
    const scriptPath = join(this.tempDir, 'input-bridge.ps1')
    await writeFile(scriptPath, buildGameInputBridgeScript(), 'utf8')
    const child = spawn(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-8000)
    })
    this.readline = createInterface({ input: child.stdout })
    this.readline.on('line', line => this.handleLine(line))
    child.once('exit', () => this.handleExit())

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Game input bridge startup timed out.')),
        10_000,
      )
      const onLine = (line: string) => {
        if (line !== READY_LINE) return
        clearTimeout(timeout)
        this.readline?.off('line', onLine)
        resolve()
      }
      this.readline?.on('line', onLine)
      child.once('exit', () => {
        clearTimeout(timeout)
        reject(new Error(`Game input bridge exited. ${this.stderrTail}`))
      })
    })
  }

  async request(input: GameInputBridgeRequest): Promise<GameInputBridgeResult> {
    if (!this.child || !this.isAlive()) {
      throw new Error('Game input bridge is not running.')
    }
    const id = String(this.nextId++)
    return await new Promise<GameInputBridgeResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Game input bridge request timed out.'))
      }, 3000)
      this.pending.set(id, { resolve, reject, timeout })
      this.child!.stdin.write(`${id}\t${JSON.stringify(input)}\n`, error => {
        if (!error) return
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  async close(): Promise<void> {
    if (this.isAlive()) {
      await this.request({ action: 'stop' }).catch(() => {})
    }
    this.child?.kill()
    this.readline?.close()
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true }).catch(() => {})
    }
    this.child = undefined
    this.readline = undefined
    this.tempDir = undefined
  }

  private handleLine(line: string): void {
    if (line === READY_LINE || !line.startsWith(RESULT_PREFIX)) return
    const body = line.slice(RESULT_PREFIX.length)
    const separator = body.indexOf('\t')
    if (separator < 0) return
    const id = body.slice(0, separator)
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timeout)
    try {
      const result = JSON.parse(body.slice(separator + 1)) as GameInputBridgeResult
      if (result.ok) pending.resolve(result)
      else pending.reject(new Error(result.message))
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private handleExit(): void {
    const error = new Error(`Game input bridge exited. ${this.stderrTail}`)
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

function normalizeKey(key: string): string {
  return key.trim().toUpperCase()
}

export function buildGameInputBridgeScript(): string {
  return String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LeviathanGameInput {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
}
"@

$script:PressedKeys = @{}
$script:FireDown = $false
$aliases = @{
  'CTRL' = 'CONTROLKEY'
  'CONTROL' = 'CONTROLKEY'
  'SHIFT' = 'SHIFTKEY'
  'ALT' = 'MENU'
  'ESC' = 'ESCAPE'
  'SPACE' = 'SPACE'
}

function Resolve-KeyCode([string]$Name) {
  $normalized = $Name.Trim().ToUpperInvariant()
  if ($aliases.ContainsKey($normalized)) { $normalized = $aliases[$normalized] }
  try {
    return [byte]([int][Enum]::Parse([System.Windows.Forms.Keys], $normalized, $true) -band 0xff)
  } catch {
    throw "Unsupported game input key: $Name"
  }
}

function Send-Key([string]$Name, [bool]$Down) {
  $vk = Resolve-KeyCode $Name
  $flags = if ($Down) { [uint32]0 } else { [uint32]2 }
  [LeviathanGameInput]::keybd_event($vk, 0, $flags, [UIntPtr]::Zero)
}

function Release-All {
  foreach ($key in @($script:PressedKeys.Keys)) {
    Send-Key $key $false
  }
  $script:PressedKeys = @{}
  if ($script:FireDown) {
    [LeviathanGameInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    $script:FireDown = $false
  }
}

function Assert-TargetWindow([string]$Hwnd) {
  if ([string]::IsNullOrWhiteSpace($Hwnd)) { throw 'Target hwnd is required.' }
  $target = [IntPtr]::new([Int64]$Hwnd)
  $foreground = [LeviathanGameInput]::GetForegroundWindow()
  if ($foreground -ne $target) {
    Release-All
    throw "Target game window is not foreground. foreground=$($foreground.ToInt64()) target=$Hwnd"
  }
}

function Write-Result([string]$Id, [bool]$Ok, [string]$Message) {
  $payload = [ordered]@{
    ok = $Ok
    message = $Message
    foregroundHwnd = [string][LeviathanGameInput]::GetForegroundWindow().ToInt64()
  } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine(('__LEVIATHAN_GAME_INPUT_RESULT__{0}{1}{2}' -f $Id, [char]9, $payload))
  [Console]::Out.Flush()
}

[Console]::Out.WriteLine('__LEVIATHAN_GAME_INPUT_READY__')
[Console]::Out.Flush()

try {
  while (($line = [Console]::In.ReadLine()) -ne $null) {
    $separator = $line.IndexOf([char]9)
    if ($separator -lt 1) { continue }
    $id = $line.Substring(0, $separator)
    try {
      $payload = $line.Substring($separator + 1) | ConvertFrom-Json
      switch ([string]$payload.action) {
        'apply' {
          Assert-TargetWindow ([string]$payload.hwnd)
          foreach ($key in @($payload.keysUp)) {
            Send-Key ([string]$key) $false
            $script:PressedKeys.Remove(([string]$key).ToUpperInvariant())
          }
          foreach ($key in @($payload.keysDown)) {
            Send-Key ([string]$key) $true
            $script:PressedKeys[([string]$key).ToUpperInvariant()] = $true
          }
          foreach ($key in @($payload.tapKeys)) {
            Send-Key ([string]$key) $true
            Start-Sleep -Milliseconds 18
            Send-Key ([string]$key) $false
          }
          $dx = [int]$payload.mouseDx
          $dy = [int]$payload.mouseDy
          if ($dx -ne 0 -or $dy -ne 0) {
            [LeviathanGameInput]::mouse_event(0x0001, $dx, $dy, 0, [UIntPtr]::Zero)
          }
          if ([bool]$payload.fireDown -and -not $script:FireDown) {
            [LeviathanGameInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
            $script:FireDown = $true
          }
          if ([bool]$payload.fireUp -and $script:FireDown) {
            [LeviathanGameInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
            $script:FireDown = $false
          }
          Write-Result $id $true 'Game input plan applied.'
        }
        'release_all' {
          Release-All
          Write-Result $id $true 'All game input state released.'
        }
        'stop' {
          Release-All
          Write-Result $id $true 'Game input bridge stopped.'
          break
        }
        default { throw "Unknown game input action: $($payload.action)" }
      }
      if ([string]$payload.action -eq 'stop') { break }
    } catch {
      Write-Result $id $false $_.Exception.Message
    }
  }
} finally {
  Release-All
}
`
}
