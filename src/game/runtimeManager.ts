import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { isInBundledMode } from '../utils/bundledMode.js'
import type {
  GameSidecarMessage,
  GameSidecarRequest,
  GameSidecarResponse,
  GameSidecarStartParams,
} from './ipc.js'
import type {
  ActiveGameModelMode,
  GameProfile,
  GameRuntimeSummary,
} from './types.js'

type PendingRequest = {
  resolve: (value: GameSidecarResponse['data']) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  removeAbortListener?: () => void
}

export type StartGameSessionInput = {
  cwd: string
  controlMode: ActiveGameModelMode
  objective: string
  profile: GameProfile
  profilePath: string
  hwnd?: string
  signal?: AbortSignal
}

class GameRuntimeClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private readline: Interface | undefined
  private nextId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private stderrTail = ''
  private stdoutTail = ''
  private launchDescription = ''
  private latestSummary: GameRuntimeSummary | undefined

  isAlive(): boolean {
    return this.child !== undefined && this.child.exitCode === null
  }

  get cachedSummary(): GameRuntimeSummary | undefined {
    return this.latestSummary
  }

  async start(cwd: string): Promise<void> {
    if (this.isAlive()) return
    const launch = resolveGameSidecarLaunchSpec()
    this.launchDescription = [launch.command, ...launch.args].join(' ')
    const child = spawn(launch.command, launch.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, LEVIATHAN_GAME_SIDECAR: '1' },
    })
    this.child = child
    child.unref()
    unrefStream(child.stdin)
    unrefStream(child.stdout)
    unrefStream(child.stderr)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-12_000)
    })
    this.readline = createInterface({ input: child.stdout })
    this.readline.on('line', line => this.handleLine(line))
    child.once('exit', (code, signal) => this.handleExit(code, signal))
    await this.request('ping', undefined, undefined, 10_000)
  }

  async request(
    method: GameSidecarRequest['method'],
    params?: GameSidecarRequest['params'],
    signal?: AbortSignal,
    timeoutMs = 5000,
  ): Promise<GameSidecarResponse['data']> {
    if (!this.child || !this.isAlive()) {
      throw new Error('GameModel realtime sidecar is not running.')
    }
    const id = String(this.nextId++)
    const request = { id, method, params } as GameSidecarRequest
    return await new Promise((resolveRequest, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`GameModel sidecar ${method} timed out.`))
      }, timeoutMs)
      const pending: PendingRequest = {
        resolve: resolveRequest,
        reject,
        timeout,
      }
      if (signal) {
        const onAbort = () => {
          clearTimeout(timeout)
          this.pending.delete(id)
          reject(new Error(`GameModel sidecar ${method} was aborted.`))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending.removeAbortListener = () =>
          signal.removeEventListener('abort', onAbort)
      }
      this.pending.set(id, pending)
      this.child!.stdin.write(`${JSON.stringify(request)}\n`, error => {
        if (!error) return
        clearTimeout(timeout)
        pending.removeAbortListener?.()
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  async close(sendStop = true): Promise<void> {
    if (sendStop && this.isAlive()) {
      await this.request('stop').catch(() => {})
    }
    this.child?.stdin.end()
    this.child?.kill()
    this.readline?.close()
    this.child = undefined
    this.readline = undefined
  }

  closeSync(): void {
    // Closing stdin lets the sidecar run its finally block and release every
    // held input. Its parent watchdog remains the fallback if the pipe stalls.
    this.child?.stdin.end()
  }

  private handleLine(line: string): void {
    let message: GameSidecarMessage
    try {
      message = JSON.parse(line) as GameSidecarMessage
    } catch {
      this.stdoutTail = `${this.stdoutTail}${line}\n`.slice(-12_000)
      return
    }
    if (message.type === 'event') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timeout)
    pending.removeAbortListener?.()
    if (!message.ok) {
      pending.reject(new Error(message.error ?? 'GameModel sidecar failed.'))
      return
    }
    if (isRuntimeSummary(message.data)) this.latestSummary = message.data
    pending.resolve(message.data)
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const diagnostics = [
      this.stderrTail ? `stderr:\n${this.stderrTail}` : '',
      this.stdoutTail ? `stdout:\n${this.stdoutTail}` : '',
    ].filter(Boolean)
    const exitReason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
    const error = new Error([
      `GameModel sidecar exited with ${exitReason}.`,
      this.launchDescription ? `Launch: ${this.launchDescription}` : '',
      ...diagnostics,
    ].filter(Boolean).join('\n'))
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.removeAbortListener?.()
      pending.reject(error)
      this.pending.delete(id)
    }
    this.child = undefined
  }
}

let client: GameRuntimeClient | undefined
let exitHookRegistered = false

export async function startGameSession(
  input: StartGameSessionInput,
): Promise<GameRuntimeSummary> {
  if ((input.controlMode === 'live' || input.controlMode === 'demo') && !input.hwnd) {
    throw new Error(
      `${input.controlMode === 'demo' ? 'Demo' : 'Live'} GameModel sessions require hwnd for foreground locking.`,
    )
  }
  if (
    input.controlMode === 'demo' &&
    (!input.profile.capture.recordFrames || input.profile.capture.datasetSampleFps <= 0)
  ) {
    throw new Error(
      'Demo GameModel sessions require frame recording and a positive dataset sample FPS.',
    )
  }
  const activeClient = await ensureClient(input.cwd)
  const sessionId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const sessionDir = resolve(
    input.cwd,
    '.leviathan',
    'gamemodel',
    'sessions',
    sessionId,
  )
  await mkdir(sessionDir, { recursive: true })
  const params: GameSidecarStartParams = {
    sessionId,
    cwd: input.cwd,
    sessionDir,
    controlMode: input.controlMode,
    objective: input.objective,
    profile: input.profile,
    profilePath: input.profilePath,
    hwnd: input.hwnd,
    parentPid: process.pid,
  }
  const result = await activeClient.request(
    'start',
    params,
    input.signal,
    15_000,
  )
  return assertRuntimeSummary(result)
}

export async function setGameSessionGoal(
  objective: string,
  signal?: AbortSignal,
): Promise<GameRuntimeSummary> {
  const result = await requireClient().request(
    'set_goal',
    { objective },
    signal,
  )
  return assertRuntimeSummary(result)
}

export async function getGameSessionSummary(
  signal?: AbortSignal,
): Promise<GameRuntimeSummary | undefined> {
  if (!client?.isAlive()) return client?.cachedSummary
  const result = await client.request('get_summary', undefined, signal)
  return assertRuntimeSummary(result)
}

export async function pauseGameSession(
  signal?: AbortSignal,
): Promise<GameRuntimeSummary> {
  return assertRuntimeSummary(
    await requireClient().request('pause', undefined, signal),
  )
}

export async function resumeGameSession(
  signal?: AbortSignal,
): Promise<GameRuntimeSummary> {
  return assertRuntimeSummary(
    await requireClient().request('resume', undefined, signal),
  )
}

export async function stopGameSession(
  signal?: AbortSignal,
): Promise<GameRuntimeSummary | undefined> {
  if (!client?.isAlive()) return client?.cachedSummary
  const result = await client.request('stop', undefined, signal, 10_000)
  const summary = assertRuntimeSummary(result)
  await client.close(false)
  client = undefined
  return summary
}

export async function disposeGameRuntimeForTests(): Promise<void> {
  await client?.close()
  client = undefined
}

async function ensureClient(cwd: string): Promise<GameRuntimeClient> {
  if (client?.isAlive()) return client
  client = new GameRuntimeClient()
  await client.start(cwd)
  registerExitHook()
  return client
}

function requireClient(): GameRuntimeClient {
  if (!client?.isAlive()) {
    throw new Error('No active GameModel session. Start one first.')
  }
  return client
}

function registerExitHook(): void {
  if (exitHookRegistered) return
  exitHookRegistered = true
  process.once('exit', () => client?.closeSync())
}

type GameSidecarLaunchEnvironment = {
  executablePath: string
  invocationEntry?: string
  moduleDirectory: string
  nativeBundle: boolean
}

export function resolveGameSidecarLaunchSpec(
  overrides: Partial<GameSidecarLaunchEnvironment> = {},
): { command: string; args: string[] } {
  const environment: GameSidecarLaunchEnvironment = {
    executablePath: process.execPath,
    invocationEntry: process.argv[1],
    moduleDirectory: import.meta.dir,
    nativeBundle: isInBundledMode(),
    ...overrides,
  }
  if (environment.nativeBundle) {
    return {
      command: environment.executablePath,
      args: ['--game-runtime-sidecar'],
    }
  }
  const sourceEntry = resolve(
    environment.moduleDirectory,
    '..',
    'entrypoints',
    'cli.tsx',
  )
  if (existsSync(sourceEntry)) {
    return {
      command: environment.executablePath,
      args: ['run', sourceEntry, '--game-runtime-sidecar'],
    }
  }
  if (!environment.invocationEntry) {
    throw new Error(
      'Cannot launch the GameModel sidecar because the current Leviathan entry point is unknown.',
    )
  }
  const invocationEntry = resolve(environment.invocationEntry)
  if (!existsSync(invocationEntry)) {
    throw new Error(
      `Cannot launch the GameModel sidecar because the current Leviathan entry point does not exist: ${invocationEntry}`,
    )
  }
  return {
    command: environment.executablePath,
    args: ['run', invocationEntry, '--game-runtime-sidecar'],
  }
}

function assertRuntimeSummary(
  value: GameSidecarResponse['data'],
): GameRuntimeSummary {
  if (!isRuntimeSummary(value)) {
    throw new Error('GameModel sidecar returned an invalid runtime summary.')
  }
  return value
}

function isRuntimeSummary(value: unknown): value is GameRuntimeSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sessionId' in value &&
    'status' in value &&
    'world' in value
  )
}

function unrefStream(stream: unknown): void {
  const unref = (stream as { unref?: () => void }).unref
  if (typeof unref === 'function') unref.call(stream)
}
