import { applyEdits, modify } from 'jsonc-parser'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { getPlatform } from '../../utils/platform.js'
import { getCachedPowerShellPath } from '../../utils/shell/powershellDetection.js'
import { which } from '../../utils/which.js'
import type { ComputerUseInput, ComputerUseOutput } from './windowsComputerUse.js'

type VSCodePlan =
  | {
      kind: 'cli'
      args: string[]
      description: string
      timeoutMs: number
    }
  | {
      kind: 'uri'
      uri: string
      description: string
      timeoutMs: number
    }

type VSCodeRunnerResult = {
  executable: string
  args: string[]
  exitCode: number
  stdout: string
  stderr: string
  uri?: string
  typedCharacters?: number
  autoIndentDisabled?: boolean
  autoIndentRestored?: boolean
  settingsPath?: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const LONG_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 40_000
const DEFAULT_TYPING_DELAY_MS = 4
const VSCODE_TYPING_SETTINGS: ReadonlyArray<[string, unknown]> = [
  ['editor.autoIndent', 'none'],
  ['editor.formatOnType', false],
  ['editor.formatOnPaste', false],
]

export async function runVSCodeComputerUse(
  input: ComputerUseInput,
  signal?: AbortSignal,
): Promise<ComputerUseOutput> {
  if (input.action === 'vscode_type_text') {
    return runVSCodeManualTyping(input, signal)
  }

  const plan = buildVSCodePlan(input)
  const result =
    plan.kind === 'cli'
      ? await runVSCodeCli(plan, signal)
      : await openVSCodeUri(plan, signal)
  const ok = result.exitCode === 0

  return {
    ok,
    action: input.action,
    message: ok
      ? `VSCode native action completed: ${plan.description}.`
      : `VSCode native action failed: ${plan.description}.`,
    vscode: {
      executable: result.executable,
      args: result.args,
      exitCode: result.exitCode,
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr),
      uri: result.uri,
      typedCharacters: result.typedCharacters,
      autoIndentDisabled: result.autoIndentDisabled,
      autoIndentRestored: result.autoIndentRestored,
      settingsPath: result.settingsPath,
      extensions:
        input.action === 'vscode_list_extensions'
          ? parseNonEmptyLines(result.stdout)
          : undefined,
      version:
        input.action === 'vscode_version'
          ? parseNonEmptyLines(result.stdout)[0]
          : undefined,
    },
  }
}

export function buildVSCodeCommandUri(
  command: string,
  commandArgs?: unknown[],
): string {
  const encodedArgs =
    commandArgs && commandArgs.length > 0
      ? `?${encodeURIComponent(JSON.stringify(commandArgs))}`
      : ''
  return `vscode://command/${encodeURIComponent(command)}${encodedArgs}`
}

export function buildVSCodePlan(input: ComputerUseInput): VSCodePlan {
  const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS

  switch (input.action) {
    case 'vscode_version':
      return {
        kind: 'cli',
        args: ['--version'],
        description: 'print VSCode version',
        timeoutMs,
      }
    case 'vscode_status':
      return {
        kind: 'cli',
        args: ['--status'],
        description: 'print VSCode process status',
        timeoutMs,
      }
    case 'vscode_open':
      return {
        kind: 'cli',
        args: [
          ...buildWindowFlags(input),
          ...buildProfileFlags(input),
          ...resolvePathInputs(input),
        ],
        description: 'open files or folders',
        timeoutMs,
      }
    case 'vscode_open_file':
      return {
        kind: 'cli',
        args: [
          ...(input.new_window ? ['--new-window'] : ['--reuse-window']),
          ...buildProfileFlags(input),
          ...(input.line
            ? ['--goto', formatGotoTarget(requireInput(input.file, 'file'), input)]
            : [resolveWorkspacePath(requireInput(input.file, 'file'))]),
        ],
        description: 'open file at location',
        timeoutMs,
      }
    case 'vscode_open_diff':
      return {
        kind: 'cli',
        args: [
          '--diff',
          resolveWorkspacePath(requireInput(input.left_file, 'left_file')),
          resolveWorkspacePath(requireInput(input.right_file, 'right_file')),
        ],
        description: 'open file diff',
        timeoutMs,
      }
    case 'vscode_add_folder':
      return {
        kind: 'cli',
        args: ['--add', resolveWorkspacePath(requireInput(input.path, 'path'))],
        description: 'add folder to current VSCode window',
        timeoutMs,
      }
    case 'vscode_remove_folder':
      return {
        kind: 'cli',
        args: [
          '--remove',
          resolveWorkspacePath(requireInput(input.path, 'path')),
        ],
        description: 'remove folder from current VSCode window',
        timeoutMs,
      }
    case 'vscode_run_command':
      return {
        kind: 'uri',
        uri: buildVSCodeCommandUri(
          requireInput(input.command, 'command'),
          input.command_args,
        ),
        description: `run command ${input.command}`,
        timeoutMs,
      }
    case 'vscode_open_uri':
      return {
        kind: 'uri',
        uri: requireInput(input.url, 'url'),
        description: 'open VSCode URI',
        timeoutMs,
      }
    case 'vscode_type_text':
      throw new Error('vscode_type_text is handled by the manual typing runner.')
    case 'vscode_chat':
      return {
        kind: 'cli',
        args: ['chat', requireInput(input.prompt, 'prompt')],
        description: 'send prompt to VSCode chat',
        timeoutMs: input.timeout_ms ?? LONG_TIMEOUT_MS,
      }
    case 'vscode_list_extensions':
      return {
        kind: 'cli',
        args: [
          '--list-extensions',
          ...(input.show_versions ? ['--show-versions'] : []),
        ],
        description: 'list installed extensions',
        timeoutMs,
      }
    case 'vscode_install_extension':
      return {
        kind: 'cli',
        args: [
          '--install-extension',
          requireInput(input.extension_id ?? input.path, 'extension_id'),
          ...(input.force ? ['--force'] : []),
          ...(input.pre_release ? ['--pre-release'] : []),
        ],
        description: 'install or update extension',
        timeoutMs: input.timeout_ms ?? LONG_TIMEOUT_MS,
      }
    case 'vscode_uninstall_extension':
      return {
        kind: 'cli',
        args: [
          '--uninstall-extension',
          requireInput(input.extension_id, 'extension_id'),
        ],
        description: 'uninstall extension',
        timeoutMs: input.timeout_ms ?? LONG_TIMEOUT_MS,
      }
    case 'vscode_update_extensions':
      return {
        kind: 'cli',
        args: ['--update-extensions'],
        description: 'update installed extensions',
        timeoutMs: input.timeout_ms ?? LONG_TIMEOUT_MS,
      }
    default:
      throw new Error(`Unsupported VSCode action: ${input.action}`)
  }
}

async function runVSCodeManualTyping(
  input: ComputerUseInput,
  signal?: AbortSignal,
): Promise<ComputerUseOutput> {
  let openResult: VSCodeRunnerResult | null = null
  if (input.file) {
    openResult = await runVSCodeCli(
      buildVSCodePlan({
        ...input,
        action: 'vscode_open_file',
      }) as Extract<VSCodePlan, { kind: 'cli' }>,
      signal,
    )
    if (openResult.exitCode !== 0) {
      return {
        ok: false,
        action: input.action,
        message: 'VSCode native action failed: open file before manual typing.',
        vscode: {
          executable: openResult.executable,
          args: openResult.args,
          exitCode: openResult.exitCode,
          stdout: truncateOutput(openResult.stdout),
          stderr: truncateOutput(openResult.stderr),
        },
      }
    }
    await sleep(650, signal)
  }

  const autoIndent = await disableAutoIndentForManualTyping(input)
  let typingResult: VSCodeRunnerResult
  let restored = false
  try {
    if (autoIndent.disabled) {
      await sleep(350, signal)
    }
    typingResult = await runManualTypingPowerShell(input, signal)
  } finally {
    restored = await autoIndent.restore()
  }

  const ok = typingResult.exitCode === 0
  return {
    ok,
    action: input.action,
    message: ok
      ? 'VSCode manual typing completed.'
      : 'VSCode manual typing failed.',
    vscode: {
      executable: typingResult.executable,
      args: typingResult.args,
      exitCode: typingResult.exitCode,
      stdout: truncateOutput(
        [openResult?.stdout, typingResult.stdout].filter(Boolean).join('\n'),
      ),
      stderr: truncateOutput(
        [openResult?.stderr, typingResult.stderr].filter(Boolean).join('\n'),
      ),
      typedCharacters: input.text?.length ?? 0,
      autoIndentDisabled: autoIndent.disabled,
      autoIndentRestored: restored,
      settingsPath: autoIndent.settingsPath,
    },
  }
}

type AutoIndentState = {
  disabled: boolean
  settingsPath?: string
  restore: () => Promise<boolean>
}

async function disableAutoIndentForManualTyping(
  input: ComputerUseInput,
): Promise<AutoIndentState> {
  if (input.disable_auto_indent === false) {
    return { disabled: false, restore: async () => false }
  }

  const settingsPath = resolveVSCodeSettingsPath(input)
  const originalContent = await readFile(settingsPath, 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    },
  )
  let nextContent = originalContent ?? '{}\n'
  for (const [settingKey, value] of VSCODE_TYPING_SETTINGS) {
    nextContent = setJsoncSetting(nextContent, settingKey, value)
  }

  await mkdir(path.dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, nextContent, 'utf8')

  const restore = async () => {
    if (input.restore_auto_indent === false) return false
    if (originalContent === null) {
      await rm(settingsPath, { force: true }).catch(() => {})
      return true
    }
    await writeFile(settingsPath, originalContent, 'utf8').catch(() => {})
    return true
  }

  return { disabled: true, settingsPath, restore }
}

function setJsoncSetting(
  content: string,
  settingKey: string,
  value: unknown,
): string {
  const edits = modify(content, [settingKey], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  return applyEdits(content, edits)
}

function resolveVSCodeSettingsPath(input: ComputerUseInput): string {
  if (input.vscode_settings_path?.trim()) {
    return path.resolve(input.vscode_settings_path.trim())
  }
  if (process.env.LEVIATHAN_VSCODE_SETTINGS_PATH?.trim()) {
    return path.resolve(process.env.LEVIATHAN_VSCODE_SETTINGS_PATH.trim())
  }

  switch (getPlatform()) {
    case 'windows': {
      const appData = process.env.APPDATA
      if (!appData) {
        throw new Error('APPDATA is required to locate VSCode settings.')
      }
      return path.join(appData, 'Code', 'User', 'settings.json')
    }
    case 'macos':
      return path.join(
        homedir(),
        'Library',
        'Application Support',
        'Code',
        'User',
        'settings.json',
      )
    default:
      return path.join(homedir(), '.config', 'Code', 'User', 'settings.json')
  }
}

async function runManualTypingPowerShell(
  input: ComputerUseInput,
  signal?: AbortSignal,
): Promise<VSCodeRunnerResult> {
  const psPath = await getCachedPowerShellPath()
  if (!psPath) {
    return {
      executable: 'powershell',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'PowerShell is required for VSCode manual typing.',
    }
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'leviathan-vscode-type-'))
  const scriptPath = path.join(tempDir, 'type-vscode.ps1')
  const textPath = path.join(tempDir, 'input.txt')
  await Promise.all([
    writeFile(scriptPath, buildVSCodeTypingPowerShellScript(), 'utf8'),
    writeFile(textPath, input.text ?? '', 'utf8'),
  ])

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-TextPath',
    textPath,
    '-DelayMs',
    String(input.typing_delay_ms ?? DEFAULT_TYPING_DELAY_MS),
    '-WindowTitleHint',
    input.file ? path.basename(input.file) : '',
  ]

  try {
    const result = await execFileNoThrowWithCwd(psPath, args, {
      abortSignal: signal,
      timeout: input.timeout_ms ?? LONG_TIMEOUT_MS,
      preserveOutputOnError: true,
      cwd: getCwd(),
      maxBuffer: MAX_OUTPUT_CHARS,
    })
    return {
      executable: psPath,
      args,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr || result.error || '',
      typedCharacters: input.text?.length ?? 0,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function runVSCodeCli(
  plan: Extract<VSCodePlan, { kind: 'cli' }>,
  signal?: AbortSignal,
): Promise<VSCodeRunnerResult> {
  const executable = await findVSCodeExecutable()
  if (!executable) {
    return {
      executable: 'code',
      args: plan.args,
      exitCode: 1,
      stdout: '',
      stderr:
        'VSCode CLI was not found. Install VSCode shell command or set LEVIATHAN_VSCODE_CLI.',
    }
  }

  const result = await execFileNoThrowWithCwd(executable, plan.args, {
    abortSignal: signal,
    timeout: plan.timeoutMs,
    preserveOutputOnError: true,
    cwd: getCwd(),
    maxBuffer: MAX_OUTPUT_CHARS * 2,
  })
  return {
    executable,
    args: plan.args,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr || result.error || '',
  }
}

async function openVSCodeUri(
  plan: Extract<VSCodePlan, { kind: 'uri' }>,
  signal?: AbortSignal,
): Promise<VSCodeRunnerResult> {
  const uri = assertVSCodeUri(plan.uri)
  const opener = getUriOpener(uri)
  const result = await execFileNoThrowWithCwd(opener.executable, opener.args, {
    abortSignal: signal,
    timeout: plan.timeoutMs,
    preserveOutputOnError: true,
    cwd: getCwd(),
    maxBuffer: MAX_OUTPUT_CHARS,
  })
  return {
    executable: opener.executable,
    args: opener.args,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr || result.error || '',
    uri,
  }
}

async function findVSCodeExecutable(): Promise<string | null> {
  const override = process.env.LEVIATHAN_VSCODE_CLI
  if (override?.trim()) {
    return override.trim()
  }

  const candidates =
    getPlatform() === 'windows' ? ['code.cmd', 'code'] : ['code']
  for (const candidate of candidates) {
    const resolved = await which(candidate)
    if (resolved) {
      return resolved
    }
  }
  return null
}

function buildWindowFlags(input: ComputerUseInput): string[] {
  if (input.new_window) return ['--new-window']
  if (input.reuse_window !== false) return ['--reuse-window']
  return []
}

function buildProfileFlags(input: ComputerUseInput): string[] {
  return input.profile ? ['--profile', input.profile] : []
}

function resolvePathInputs(input: ComputerUseInput): string[] {
  const paths = [...(input.paths ?? [])]
  if (input.path) {
    paths.unshift(input.path)
  }
  return (paths.length > 0 ? paths : [getCwd()]).map(resolveWorkspacePath)
}

function resolveWorkspacePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(getCwd(), filePath)
}

function formatGotoTarget(filePath: string, input: ComputerUseInput): string {
  const line = Math.max(1, input.line ?? 1)
  const column = Math.max(1, input.column ?? 1)
  return `${resolveWorkspacePath(filePath)}:${line}:${column}`
}

function requireInput(value: string | undefined, fieldName: string): string {
  if (!value?.trim()) {
    throw new Error(`${fieldName} is required for this VSCode action.`)
  }
  return value.trim()
}

function assertVSCodeUri(uri: string): string {
  const value = uri.trim()
  if (!/^vscode(?:-insiders)?:\/\//i.test(value)) {
    throw new Error('Only vscode:// and vscode-insiders:// URIs are allowed.')
  }
  return value
}

function getUriOpener(uri: string): { executable: string; args: string[] } {
  switch (getPlatform()) {
    case 'windows':
      return {
        executable: 'rundll32.exe',
        args: ['url.dll,FileProtocolHandler', uri],
      }
    case 'macos':
      return { executable: 'open', args: [uri] }
    default:
      return { executable: 'xdg-open', args: [uri] }
  }
}

function buildVSCodeTypingPowerShellScript(): string {
  return String.raw`
param(
  [Parameter(Mandatory = $true)][string]$TextPath,
  [int]$DelayMs = 4,
  [string]$WindowTitleHint = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class LeviathanVSCodeUser32 {
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
}
"@

function Get-WindowTitle {
  param([IntPtr]$Hwnd)
  $length = [LeviathanVSCodeUser32]::GetWindowTextLength($Hwnd)
  if ($length -le 0) { return '' }
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][LeviathanVSCodeUser32]::GetWindowText($Hwnd, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Get-WindowArea {
  param([IntPtr]$Hwnd)
  $rect = New-Object LeviathanVSCodeUser32+RECT
  if (-not [LeviathanVSCodeUser32]::GetWindowRect($Hwnd, [ref]$rect)) {
    return 0
  }
  return [Math]::Max(0, $rect.Right - $rect.Left) * [Math]::Max(0, $rect.Bottom - $rect.Top)
}

function Find-VSCodeWindow {
  $windows = New-Object System.Collections.Generic.List[object]
  $callback = [LeviathanVSCodeUser32+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [LeviathanVSCodeUser32]::IsWindowVisible($hWnd)) { return $true }
    $pidValue = [uint32]0
    [void][LeviathanVSCodeUser32]::GetWindowThreadProcessId($hWnd, [ref]$pidValue)
    if ($pidValue -eq 0) { return $true }
    try {
      $processName = (Get-Process -Id ([int]$pidValue) -ErrorAction Stop).ProcessName
    } catch {
      return $true
    }
    if ($processName -notin @('Code', 'Code - Insiders', 'VSCodium')) { return $true }
    $title = Get-WindowTitle $hWnd
    if ([string]::IsNullOrWhiteSpace($title)) { return $true }
    $windows.Add([pscustomobject]@{
      Hwnd = $hWnd
      Title = $title
      Area = Get-WindowArea $hWnd
    })
    return $true
  }
  [void][LeviathanVSCodeUser32]::EnumWindows($callback, [IntPtr]::Zero)

  if ($windows.Count -eq 0) {
    throw 'No visible VSCode window was found.'
  }

  $ordered = @($windows)
  if (-not [string]::IsNullOrWhiteSpace($WindowTitleHint)) {
    $hintMatches = @($ordered | Where-Object {
      $_.Title.IndexOf($WindowTitleHint, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    if ($hintMatches.Count -gt 0) {
      $ordered = $hintMatches
    }
  }

  return ($ordered | Sort-Object -Property Area -Descending | Select-Object -First 1)
}

function Escape-SendKeysText {
  param([string]$Text)
  $builder = New-Object System.Text.StringBuilder
  foreach ($ch in $Text.ToCharArray()) {
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
  return $builder.ToString()
}

function Send-ManualText {
  param([string]$Text)
  $newline = [string][char]10
  $carriageReturn = [string][char]13
  $tab = [char]9
  $normalized = $Text.Replace($carriageReturn + $newline, $newline).Replace($carriageReturn, $newline)
  foreach ($ch in $normalized.ToCharArray()) {
    if ($ch -eq [char]10) {
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    } elseif ($ch -eq $tab) {
      [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
    } else {
      [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText ([string]$ch)))
    }
    if ($DelayMs -gt 0) {
      Start-Sleep -Milliseconds $DelayMs
    }
  }
}

$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8)
$target = Find-VSCodeWindow
[void][LeviathanVSCodeUser32]::ShowWindow($target.Hwnd, 9)
Start-Sleep -Milliseconds 80
[void][LeviathanVSCodeUser32]::SetForegroundWindow($target.Hwnd)
Start-Sleep -Milliseconds 120
Send-ManualText $text

[pscustomobject]@{
  ok = $true
  title = $target.Title
  typedCharacters = $text.Length
} | ConvertTo-Json -Compress
`
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.reject(new Error('VSCode action was aborted.'))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    const abortListener = () => {
      clearTimeout(timeout)
      reject(new Error('VSCode action was aborted.'))
    }
    signal?.addEventListener('abort', abortListener, { once: true })
  })
}

function parseNonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return text
  }
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]`
}
