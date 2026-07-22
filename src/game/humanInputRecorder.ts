import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { z } from 'zod/v4'

const INPUT_PROTOCOL_VERSION = 1
const START_TIMEOUT_MS = 12_000
const STOP_TIMEOUT_MS = 5_000
const MAX_STDERR_LENGTH = 16_384

const readyEventSchema = z.strictObject({
  type: z.literal('input_ready'),
  protocolVersion: z.literal(INPUT_PROTOCOL_VERSION),
  backend: z.literal('windows_raw_input'),
  sessionId: z.string().min(1),
  processId: z.number().int().positive(),
  targetHwnd: z.number().int().positive(),
  parentPid: z.number().int().positive(),
  sampleHz: z.number().int().min(30).max(240),
  clockOriginUnixNs: z.string().regex(/^\d+$/),
  clockOriginMonotonicNs: z.literal('0'),
})

const inputSampleEventSchema = z.strictObject({
  type: z.literal('input_sample'),
  protocolVersion: z.literal(INPUT_PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  sequence: z.number().int().positive(),
  timestampNs: z.string().regex(/^\d+$/),
  monotonicNs: z.string().regex(/^\d+$/),
  focused: z.boolean(),
  moveForward: z.boolean(),
  moveLeft: z.boolean(),
  moveBackward: z.boolean(),
  moveRight: z.boolean(),
  mouseDx: z.number().int(),
  mouseDy: z.number().int(),
  fire: z.boolean(),
  aim: z.boolean(),
  reload: z.boolean(),
  interact: z.boolean(),
  jump: z.boolean(),
  sprint: z.boolean(),
})

const stoppedEventSchema = z.strictObject({
  type: z.literal('input_stopped'),
  protocolVersion: z.literal(INPUT_PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  sampleCount: z.number().int().nonnegative(),
  focusLossCount: z.number().int().nonnegative(),
})

const nativeInputEventSchema = z.discriminatedUnion('type', [
  readyEventSchema,
  inputSampleEventSchema,
  stoppedEventSchema,
])

export type NativeHumanInputSample = z.infer<typeof inputSampleEventSchema>

export type HumanInputRecorderDiagnostics = {
  status: 'starting' | 'active' | 'stopped' | 'degraded'
  processId?: number
  sampleHz: number
  rawSampleCount: number
  focusLossCount: number
  targetFocused?: boolean
  lastSampleAt?: string
  clockOriginUnixNs?: string
  clockOriginMonotonicNs?: string
  lastError?: string
}

export type HumanInputRecorderOptions = {
  binaryPath: string
  binaryArgs?: string[]
  hwnd: string
  sampleHz: number
  sessionId: string
  parentPid?: number
}

export class HumanInputRecorderClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private readline: Interface | undefined
  private stderr = ''
  private closing = false
  private status: HumanInputRecorderDiagnostics['status'] = 'starting'
  private processId: number | undefined
  private rawSampleCount = 0
  private focusLossCount = 0
  private targetFocused: boolean | undefined
  private lastSampleAt: string | undefined
  private clockOriginUnixNs: string | undefined
  private clockOriginMonotonicNs: string | undefined
  private lastError: string | undefined
  private readySettled = false
  private readonly readyPromise: Promise<void>
  private readyResolve!: () => void
  private readyReject!: (error: Error) => void
  private onSample: ((sample: NativeHumanInputSample) => void) | undefined

  constructor(private readonly options: HumanInputRecorderOptions) {
    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      this.readyResolve = resolveReady
      this.readyReject = rejectReady
    })
  }

  async start(onSample: (sample: NativeHumanInputSample) => void): Promise<void> {
    if (this.child) {
      throw new Error('Human input recorder is already started.')
    }
    this.onSample = onSample
    const args = [
      ...(this.options.binaryArgs ?? []),
      '--input-recorder',
      '--hwnd',
      this.options.hwnd,
      '--sample-hz',
      String(this.options.sampleHz),
      '--session-id',
      this.options.sessionId,
      '--parent-pid',
      String(this.options.parentPid ?? process.pid),
    ]
    const child = spawn(this.options.binaryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-MAX_STDERR_LENGTH)
    })
    child.once('error', error => this.fail(error))
    child.once('exit', (code, signal) => {
      if (this.closing && (code === 0 || signal !== null)) {
        this.status = 'stopped'
        return
      }
      this.fail(
        new Error(
          `Human input recorder exited unexpectedly (${signal ?? code ?? 'unknown'}). ${this.stderr}`,
        ),
      )
    })
    this.readline = createInterface({ input: child.stdout })
    this.readline.on('line', line => this.handleLine(line))
    await withTimeout(
      this.readyPromise,
      START_TIMEOUT_MS,
      'Human input recorder startup timed out.',
    )
  }

  async close(): Promise<void> {
    if (!this.child) {
      this.status = 'stopped'
      return
    }
    this.closing = true
    const child = this.child
    const exited = new Promise<void>(resolveExit => {
      if (child.exitCode !== null) {
        resolveExit()
        return
      }
      child.once('exit', () => resolveExit())
    })
    child.stdin.write('stop\n')
    await withTimeout(exited, STOP_TIMEOUT_MS, 'Human input recorder stop timed out.').catch(
      () => child.kill(),
    )
    this.readline?.close()
    this.child = undefined
    this.readline = undefined
    this.onSample = undefined
    this.status = 'stopped'
  }

  diagnostics(): HumanInputRecorderDiagnostics {
    return {
      status: this.status,
      processId: this.processId,
      sampleHz: this.options.sampleHz,
      rawSampleCount: this.rawSampleCount,
      focusLossCount: this.focusLossCount,
      targetFocused: this.targetFocused,
      lastSampleAt: this.lastSampleAt,
      clockOriginUnixNs: this.clockOriginUnixNs,
      clockOriginMonotonicNs: this.clockOriginMonotonicNs,
      lastError: this.lastError,
    }
  }

  private handleLine(line: string): void {
    let event: z.infer<typeof nativeInputEventSchema>
    try {
      event = nativeInputEventSchema.parse(JSON.parse(line))
    } catch (error) {
      this.fail(
        new Error(
          `Human input recorder emitted an invalid event: ${errorMessage(error)}`,
        ),
      )
      return
    }
    if (event.sessionId !== this.options.sessionId) {
      this.fail(new Error('Human input recorder emitted an event for a different session.'))
      return
    }
    if (event.type === 'input_ready') {
      if (String(event.targetHwnd) !== this.options.hwnd) {
        this.fail(new Error('Human input recorder bound the wrong target window.'))
        return
      }
      this.processId = event.processId
      this.clockOriginUnixNs = event.clockOriginUnixNs
      this.clockOriginMonotonicNs = event.clockOriginMonotonicNs
      this.status = 'active'
      this.settleReady()
      return
    }
    if (event.type === 'input_sample') {
      const previouslyFocused = this.targetFocused
      this.rawSampleCount += 1
      this.targetFocused = event.focused
      this.lastSampleAt = nanosecondsToIso(event.timestampNs)
      if (previouslyFocused === true && !event.focused) {
        this.focusLossCount += 1
      }
      try {
        this.onSample?.(event)
      } catch (error) {
        this.fail(error)
      }
      return
    }
    this.rawSampleCount = Math.max(this.rawSampleCount, event.sampleCount)
    this.focusLossCount = Math.max(this.focusLossCount, event.focusLossCount)
    this.status = 'stopped'
  }

  private fail(error: unknown): void {
    const message = errorMessage(error)
    this.status = 'degraded'
    this.lastError = message
    if (!this.readySettled) {
      this.readySettled = true
      this.readyReject(new Error(message))
    }
    if (!this.closing) this.child?.kill()
  }

  private settleReady(): void {
    if (this.readySettled) return
    this.readySettled = true
    this.readyResolve()
  }
}

function nanosecondsToIso(timestampNs: string): string {
  const milliseconds = Number(BigInt(timestampNs) / 1_000_000n)
  return new Date(milliseconds).toISOString()
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
