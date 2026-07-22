import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  createInterface,
  type Interface as ReadlineInterface,
} from 'node:readline'
import { z } from 'zod/v4'

const PROTOCOL_VERSION = 1
const START_TIMEOUT_MS = 12_000
const STOP_TIMEOUT_MS = 5_000
const MAX_FRAME_QUEUE = 3
const MAX_STDERR_LENGTH = 16_384

const readyEventSchema = z.strictObject({
  type: z.literal('ready'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  backend: z.literal('windows_graphics_capture'),
  sessionId: z.string().min(1),
  adapterInstanceId: z.string().min(1),
  processId: z.number().int().positive(),
  hwnd: z.number().int().positive(),
  targetFps: z.number().int().min(1).max(120),
  parentPid: z.number().int().positive(),
  recordingPath: z.string().nullable(),
  sampleDirectory: z.string().nullable(),
  sampleFps: z.number().int().min(0).max(30),
})

const frameEventSchema = z.strictObject({
  type: z.literal('frame'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  adapterInstanceId: z.string().min(1),
  sequence: z.number().int().positive(),
  capturedAt: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameSha256: z.string().regex(/^[a-f0-9]{64}$/),
  motionScore: z.number().min(0).max(1),
  motionGridColumns: z.number().int().positive().max(32),
  motionGridRows: z.number().int().positive().max(32),
  motionGrid: z.array(z.number().min(0).max(1)).max(1024),
  meanLuma: z.number().min(0).max(1),
  lumaStdDev: z.number().min(0).max(1),
  blackFrameProbability: z.number().min(0).max(1),
  measuredFps: z.number().nonnegative().max(240),
  processingMs: z.number().nonnegative().max(60_000),
  samplePath: z.string().nullable(),
  sampleSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
})

const stoppedEventSchema = z.strictObject({
  type: z.literal('stopped'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  adapterInstanceId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  capturedFrames: z.number().int().nonnegative(),
  sampledFrames: z.number().int().nonnegative(),
  recordingPath: z.string().nullable(),
})

const nativeCaptureEventSchema = z.discriminatedUnion('type', [
  readyEventSchema,
  frameEventSchema,
  stoppedEventSchema,
])

export type NativeCaptureFrameEvent = z.infer<typeof frameEventSchema>

type FrameWaiter = {
  resolve: (frame: NativeCaptureFrameEvent) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  abortListener?: () => void
}

export type NativeCaptureDiagnostics = {
  status: 'starting' | 'active' | 'degraded' | 'stopped'
  processId?: number
  targetFps: number
  measuredFps?: number
  nativeFrameCount: number
  droppedFrameCount: number
  blackFrameCount: number
  sampledFrameCount: number
  sampleDirectory?: string
  recordingPath?: string
  lastError?: string
}

export type NativeGameCaptureClientOptions = {
  binaryPath: string
  binaryArgs?: string[]
  hwnd: string
  targetFps: number
  sessionId: string
  adapterInstanceId: string
  recordingPath?: string
  sampleDirectory?: string
  sampleFps?: number
  parentPid?: number
}

export class NativeGameCaptureClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private readline: ReadlineInterface | undefined
  private readonly frames: NativeCaptureFrameEvent[] = []
  private readonly waiters: FrameWaiter[] = []
  private stderr = ''
  private closing = false
  private status: NativeCaptureDiagnostics['status'] = 'starting'
  private processId: number | undefined
  private measuredFps: number | undefined
  private nativeFrameCount = 0
  private droppedFrameCount = 0
  private blackFrameCount = 0
  private sampledFrameCount = 0
  private lastError: string | undefined
  private readySettled = false
  private readonly readyPromise: Promise<void>
  private readyResolve!: () => void
  private readyReject!: (error: Error) => void

  constructor(private readonly options: NativeGameCaptureClientOptions) {
    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      this.readyResolve = resolveReady
      this.readyReject = rejectReady
    })
  }

  async start(): Promise<void> {
    if (this.child)
      throw new Error('Native game capture client is already started.')
    const args = [
      ...(this.options.binaryArgs ?? []),
      '--hwnd',
      this.options.hwnd,
      '--target-fps',
      String(this.options.targetFps),
      '--session-id',
      this.options.sessionId,
      '--adapter-instance-id',
      this.options.adapterInstanceId,
      '--parent-pid',
      String(this.options.parentPid ?? process.pid),
    ]
    if (this.options.recordingPath) {
      args.push('--record-path', this.options.recordingPath)
    }
    if (this.options.sampleDirectory && (this.options.sampleFps ?? 0) > 0) {
      args.push(
        '--sample-dir',
        this.options.sampleDirectory,
        '--sample-fps',
        String(this.options.sampleFps),
      )
    }
    const child = spawn(this.options.binaryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-MAX_STDERR_LENGTH)
    })
    child.once('error', (error) => this.fail(error))
    child.once('exit', (code, signal) => {
      if (this.closing && (code === 0 || signal !== null)) {
        this.status = 'stopped'
        this.rejectWaiters(new Error('Native game capture was stopped.'))
        return
      }
      const detail = this.stderr.trim()
      this.fail(
        new Error(
          `Native game capture exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'})${detail ? `: ${detail}` : '.'}`,
        ),
      )
    })
    this.readline = createInterface({ input: child.stdout })
    this.readline.on('line', (line) => this.consumeLine(line))
    this.readline.once('error', (error) => this.fail(error))
    await withTimeout(
      this.readyPromise,
      START_TIMEOUT_MS,
      'Timed out waiting for the native Windows capture process.',
    )
  }

  async nextFrame(signal?: AbortSignal): Promise<NativeCaptureFrameEvent> {
    if (signal?.aborted) throw abortError()
    const queued = this.frames.shift()
    if (queued) return queued
    if (this.status === 'degraded' && this.lastError) {
      throw new Error(this.lastError)
    }
    if (this.status === 'stopped') {
      throw new Error('Native game capture is stopped.')
    }
    return await new Promise<NativeCaptureFrameEvent>(
      (resolveFrame, rejectFrame) => {
        const waiter: FrameWaiter = {
          resolve: resolveFrame,
          reject: rejectFrame,
          signal,
        }
        if (signal) {
          waiter.abortListener = () => {
            const index = this.waiters.indexOf(waiter)
            if (index >= 0) this.waiters.splice(index, 1)
            rejectFrame(abortError())
          }
          signal.addEventListener('abort', waiter.abortListener, {
            once: true,
          })
        }
        this.waiters.push(waiter)
      },
    )
  }

  diagnostics(): NativeCaptureDiagnostics {
    return {
      status: this.status,
      processId: this.processId,
      targetFps: this.options.targetFps,
      measuredFps: this.measuredFps,
      nativeFrameCount: this.nativeFrameCount,
      droppedFrameCount: this.droppedFrameCount,
      blackFrameCount: this.blackFrameCount,
      sampledFrameCount: this.sampledFrameCount,
      sampleDirectory: this.options.sampleDirectory,
      recordingPath: this.options.recordingPath,
      lastError: this.lastError,
    }
  }

  async close(): Promise<void> {
    if (!this.child) {
      this.status = 'stopped'
      return
    }
    if (this.closing) return
    this.closing = true
    this.status = 'stopped'
    this.rejectWaiters(new Error('Native game capture is stopping.'))
    this.child.stdin.write('stop\n')
    this.child.stdin.end()
    const exited = new Promise<void>((resolveExit) => {
      this.child?.once('exit', () => resolveExit())
    })
    const stoppedCleanly = await Promise.race([
      exited.then(() => true),
      delay(STOP_TIMEOUT_MS).then(() => false),
    ])
    if (!stoppedCleanly && this.child.exitCode === null) {
      this.child.kill()
      await Promise.race([exited, delay(1_000)])
    }
    this.readline?.close()
    this.readline = undefined
    this.child = undefined
  }

  private consumeLine(line: string): void {
    if (!line.trim()) return
    try {
      const event = nativeCaptureEventSchema.parse(JSON.parse(line))
      this.assertIdentity(event.sessionId, event.adapterInstanceId)
      switch (event.type) {
        case 'ready':
          this.processId = event.processId
          this.status = 'active'
          this.settleReady()
          return
        case 'frame':
          if (
            event.motionGrid.length !==
            event.motionGridColumns * event.motionGridRows
          ) {
            throw new Error(
              'Native capture motion grid dimensions do not match its values.',
            )
          }
          this.nativeFrameCount += 1
          this.measuredFps = event.measuredFps
          if (event.blackFrameProbability >= 0.9) this.blackFrameCount += 1
          if ((event.samplePath === null) !== (event.sampleSha256 === null)) {
            throw new Error(
              'Native capture sample path and digest must be emitted together.',
            )
          }
          if (event.samplePath) this.sampledFrameCount += 1
          this.enqueueFrame(event)
          return
        case 'stopped':
          this.status = 'stopped'
          this.rejectWaiters(new Error('Native game capture stream ended.'))
          return
      }
    } catch (error) {
      this.fail(error)
    }
  }

  private enqueueFrame(frame: NativeCaptureFrameEvent): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      this.removeAbortListener(waiter)
      waiter.resolve(frame)
      return
    }
    while (this.frames.length >= MAX_FRAME_QUEUE) {
      this.frames.shift()
      this.droppedFrameCount += 1
    }
    this.frames.push(frame)
  }

  private assertIdentity(sessionId: string, adapterInstanceId: string): void {
    if (sessionId !== this.options.sessionId) {
      throw new Error(
        'Native capture emitted an event for a different session.',
      )
    }
    if (adapterInstanceId !== this.options.adapterInstanceId) {
      throw new Error(
        'Native capture emitted an event with an untrusted adapter identity.',
      )
    }
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.status = 'degraded'
    this.lastError = message
    if (!this.readySettled) {
      this.readySettled = true
      this.readyReject(new Error(message))
    }
    this.rejectWaiters(new Error(message))
  }

  private settleReady(): void {
    if (this.readySettled) return
    this.readySettled = true
    this.readyResolve()
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      this.removeAbortListener(waiter)
      waiter.reject(error)
    }
  }

  private removeAbortListener(waiter: FrameWaiter): void {
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener)
    }
  }
}

export function resolveNativeGameCaptureBinary(input?: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  moduleDirectory?: string
}): string | undefined {
  if (process.platform !== 'win32') return undefined
  const env = input?.env ?? process.env
  const cwd = input?.cwd ?? process.cwd()
  const moduleDirectory =
    input?.moduleDirectory ?? dirname(fileURLToPath(import.meta.url))
  const candidates = [
    env.LEVIATHAN_GAME_CAPTURE_BINARY,
    env.LEVIATHAN_CODE_INSTALL_ROOT
      ? join(env.LEVIATHAN_CODE_INSTALL_ROOT, 'leviathan-game-capture.exe')
      : undefined,
    resolve(
      moduleDirectory,
      '../../native/game-capture/target/release/leviathan-game-capture.exe',
    ),
    resolve(
      moduleDirectory,
      '../native/game-capture/target/release/leviathan-game-capture.exe',
    ),
    resolve(
      cwd,
      'native/game-capture/target/release/leviathan-game-capture.exe',
    ),
  ]
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  )
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return await Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error(message)
    }),
  ])
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function abortError(): Error {
  const error = new Error('Native capture frame wait was aborted.')
  error.name = 'AbortError'
  return error
}
