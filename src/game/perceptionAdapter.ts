import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod/v4'
import {
  runWindowsComputerUse,
  type ComputerUseScreenshot,
} from '../tools/ComputerUseTool/windowsComputerUse.js'
import {
  GAME_PERCEPTION_CAPABILITIES,
  GAME_PHASES,
  type ActiveGameModelMode,
  type GameObservation,
  type GamePerceptionAdapterDescriptor,
  type GamePerceptionCapability,
  type GamePerceptionRuntimeSummary,
  type GameProfile,
  type TrustedGameObservation,
} from './types.js'
import { loadGameCalibration } from './calibration.js'
import {
  NativeGameCaptureClient,
  resolveNativeGameCaptureBinary,
} from './nativeCaptureClient.js'
import { NzmFutureObservePerceptionDetector } from './nzmFuturePerception.js'

const MAX_CAPTURE_AGE_MS = 30_000
const MAX_FUTURE_SKEW_MS = 1_000

const targetSchema = z.strictObject({
  id: z.string().min(1),
  confidence: z.number().min(0).max(1),
  screenX: z.number().finite(),
  screenY: z.number().finite(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  threat: z.number().min(0).max(1).optional(),
  weakPointX: z.number().finite().optional(),
  weakPointY: z.number().finite().optional(),
})

const threatSchema = z.strictObject({
  id: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
  direction: z.enum(['left', 'right', 'front', 'rear', 'unknown']),
  distance: z.number().nonnegative().optional(),
  attackImminent: z.boolean().optional(),
})

const observationPayloadSchema = z.strictObject({
  frameId: z.number().int().nonnegative(),
  viewport: z
    .strictObject({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  phase: z.enum(GAME_PHASES).optional(),
  ammo: z
    .strictObject({
      current: z.number().int().nonnegative(),
      reserve: z.number().int().nonnegative().optional(),
      capacity: z.number().int().positive().optional(),
    })
    .optional(),
  economy: z.number().nonnegative().optional(),
  health: z.number().min(0).max(100).optional(),
  safeToInteract: z.boolean().optional(),
  objectiveArrow: z
    .strictObject({
      angleDeg: z.number().min(-180).max(180),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
  motionScore: z.number().min(0).max(1).optional(),
  motionGrid: z
    .strictObject({
      columns: z.number().int().positive().max(32),
      rows: z.number().int().positive().max(32),
      values: z.array(z.number().min(0).max(1)).max(1024),
    })
    .optional(),
  frameMetrics: z
    .strictObject({
      meanLuma: z.number().min(0).max(1),
      lumaStdDev: z.number().min(0).max(1),
      blackFrameProbability: z.number().min(0).max(1),
      measuredFps: z.number().nonnegative().max(240),
      processingMs: z.number().nonnegative().max(60_000),
    })
    .optional(),
  targets: z.array(targetSchema).max(256).optional(),
  threats: z.array(threatSchema).max(256).optional(),
})

const sampleEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  adapterInstanceId: z.string().min(1),
  sequence: z.number().int().positive(),
  capturedAt: z.number().int().positive(),
  frameSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  observation: observationPayloadSchema,
})

const descriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  adapterId: z.string().min(1),
  adapterInstanceId: z.string().min(1),
  kind: z.enum(['capture', 'detector', 'fusion']),
  captureBackend: z.string().min(1),
  capabilities: z.array(z.enum(GAME_PERCEPTION_CAPABILITIES)),
})

type ObservationPayload = z.infer<typeof observationPayloadSchema>

export type GamePerceptionSampleEnvelope = z.infer<
  typeof sampleEnvelopeSchema
>

export type GamePerceptionFrameSample = {
  envelope: GamePerceptionSampleEnvelope
  encodedFrame?: Buffer
  screenshot?: ComputerUseScreenshot
  sampleImage?: {
    path: string
    sha256: string
  }
}

export interface GamePerceptionAdapter {
  readonly descriptor: GamePerceptionAdapterDescriptor
  readonly delivery: 'pull' | 'stream'
  readonly warning?: string
  start(hwnd: string): Promise<void>
  sample(hwnd: string, signal?: AbortSignal): Promise<GamePerceptionFrameSample>
  close(): Promise<void>
  diagnostics?(): Partial<GamePerceptionRuntimeSummary>
}

const FIELD_CAPABILITIES = {
  viewport: 'frame.viewport',
  phase: 'game.phase',
  ammo: 'hud.ammo',
  economy: 'hud.economy',
  health: 'hud.health',
  safeToInteract: 'hud.interaction',
  objectiveArrow: 'navigation.objective_arrow',
  motionScore: 'frame.motion',
  motionGrid: 'frame.motion_grid',
  frameMetrics: 'frame.metrics',
  targets: 'vision.targets',
  threats: 'vision.threats',
} as const satisfies Record<
  Exclude<keyof ObservationPayload, 'frameId'>,
  GamePerceptionCapability
>

export class TrustedGameObservationGate {
  readonly descriptor: GamePerceptionAdapterDescriptor
  private lastSequence = 0
  private acceptedCount = 0
  private rejectedCount = 0
  private lastAcceptedAt: number | undefined

  constructor(
    private readonly sessionId: string,
    descriptor: GamePerceptionAdapterDescriptor,
  ) {
    this.descriptor = descriptorSchema.parse(descriptor)
  }

  accept(
    candidate: GamePerceptionSampleEnvelope,
    receivedAt = Date.now(),
  ): TrustedGameObservation {
    try {
      const envelope = sampleEnvelopeSchema.parse(candidate)
      this.assertEnvelope(envelope, receivedAt)
      this.assertCapabilities(envelope.observation)
      const observationSha256 = sha256(
        JSON.stringify({
          sessionId: envelope.sessionId,
          adapterInstanceId: envelope.adapterInstanceId,
          sequence: envelope.sequence,
          capturedAt: envelope.capturedAt,
          observation: envelope.observation,
        }),
      )
      const trusted: TrustedGameObservation = {
        ...envelope.observation,
        timestamp: envelope.capturedAt,
        provenance: {
          schemaVersion: 1,
          trust: 'sidecar_adapter',
          sessionId: envelope.sessionId,
          adapterId: this.descriptor.adapterId,
          adapterInstanceId: this.descriptor.adapterInstanceId,
          adapterKind: this.descriptor.kind,
          captureBackend: this.descriptor.captureBackend,
          capabilities: [...this.descriptor.capabilities],
          sequence: envelope.sequence,
          capturedAt: envelope.capturedAt,
          receivedAt,
          frameSha256: envelope.frameSha256,
          observationSha256,
        },
      }
      this.lastSequence = envelope.sequence
      this.acceptedCount += 1
      this.lastAcceptedAt = receivedAt
      return trusted
    } catch (error) {
      this.rejectedCount += 1
      throw error
    }
  }

  summary(): GamePerceptionRuntimeSummary {
    return {
      status: 'active',
      adapterId: this.descriptor.adapterId,
      adapterInstanceId: this.descriptor.adapterInstanceId,
      captureBackend: this.descriptor.captureBackend,
      capabilities: [...this.descriptor.capabilities],
      trustedObservationCount: this.acceptedCount,
      rejectedObservationCount: this.rejectedCount,
      lastTrustedObservationAt:
        this.lastAcceptedAt === undefined
          ? undefined
          : new Date(this.lastAcceptedAt).toISOString(),
    }
  }

  private assertEnvelope(
    envelope: GamePerceptionSampleEnvelope,
    receivedAt: number,
  ): void {
    if (envelope.sessionId !== this.sessionId) {
      throw new Error('Perception sample session does not match the active GameModel session.')
    }
    if (envelope.adapterInstanceId !== this.descriptor.adapterInstanceId) {
      throw new Error('Perception sample adapter identity is not trusted by this session.')
    }
    if (envelope.sequence <= this.lastSequence) {
      throw new Error('Perception sample sequence must increase monotonically.')
    }
    if (envelope.capturedAt > receivedAt + MAX_FUTURE_SKEW_MS) {
      throw new Error('Perception sample timestamp is too far in the future.')
    }
    if (receivedAt - envelope.capturedAt > MAX_CAPTURE_AGE_MS) {
      throw new Error('Perception sample is too old for realtime control.')
    }
  }

  private assertCapabilities(observation: ObservationPayload): void {
    if (
      observation.motionGrid &&
      observation.motionGrid.values.length !==
        observation.motionGrid.columns * observation.motionGrid.rows
    ) {
      throw new Error('Perception motion grid dimensions do not match its values.')
    }
    const capabilities = new Set(this.descriptor.capabilities)
    for (const [field, capability] of Object.entries(FIELD_CAPABILITIES)) {
      if (observation[field as keyof ObservationPayload] === undefined) continue
      if (!capabilities.has(capability)) {
        throw new Error(
          `Perception adapter ${this.descriptor.adapterId} cannot submit ${field}; missing capability ${capability}.`,
        )
      }
    }
  }
}

export class WindowsGdiMotionPerceptionAdapter
  implements GamePerceptionAdapter
{
  readonly descriptor: GamePerceptionAdapterDescriptor
  readonly delivery = 'pull' as const
  private previousLuma: Buffer | undefined
  private sequence = 0

  constructor(
    private readonly sessionId: string,
    adapterInstanceId = randomUUID(),
    readonly warning?: string,
  ) {
    this.descriptor = {
      schemaVersion: 1,
      adapterId: 'com.leviathan.perception.windows-gdi-motion.v1',
      adapterInstanceId,
      kind: 'capture',
      captureBackend: 'windows_gdi_fallback',
      capabilities: ['frame.viewport', 'frame.motion'],
    }
  }

  async start(_hwnd: string): Promise<void> {}

  async sample(
    hwnd: string,
    signal?: AbortSignal,
  ): Promise<GamePerceptionFrameSample> {
    const output = await runWindowsComputerUse(
      { action: 'screenshot', hwnd, max_image_dimension: 960 },
      signal,
    )
    const screenshot = output.screenshot
    if (!screenshot) throw new Error('Screenshot backend returned no image.')
    const encoded = screenshot.dataUrl.split(',', 2)[1]
    if (!encoded) throw new Error('Screenshot data URI is invalid.')
    const frame = Buffer.from(encoded, 'base64')
    const luma = await sharp(frame)
      .resize(32, 18, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer()
    const motionScore = calculateMotionScore(this.previousLuma, luma)
    this.previousLuma = luma
    this.sequence += 1
    const capturedAt = Date.now()

    return {
      envelope: {
        schemaVersion: 1,
        sessionId: this.sessionId,
        adapterInstanceId: this.descriptor.adapterInstanceId,
        sequence: this.sequence,
        capturedAt,
        frameSha256: sha256(frame),
        observation: {
          frameId: this.sequence,
          viewport: {
            width: screenshot.originalWidth,
            height: screenshot.originalHeight,
          },
          motionScore,
        },
      },
      encodedFrame: frame,
      screenshot,
    }
  }

  async close(): Promise<void> {}

  diagnostics(): Partial<GamePerceptionRuntimeSummary> {
    return {
      status: 'active',
      targetFps: undefined,
      nativeFrameCount: undefined,
      droppedFrameCount: 0,
      blackFrameCount: 0,
    }
  }
}

export class WindowsGraphicsCapturePerceptionAdapter
  implements GamePerceptionAdapter
{
  readonly descriptor: GamePerceptionAdapterDescriptor
  readonly delivery = 'stream' as const
  private client: NativeGameCaptureClient | undefined
  private detectorAnalyzedFrameCount = 0
  private detectorErrorCount = 0
  private detectorLastInferenceMs: number | undefined
  private detectorLastResultAt: string | undefined
  private detectorLastPhaseConfidence: number | undefined
  private detectorLastObjectiveCandidateConfidence: number | undefined
  private detectorLastObjectiveCandidateAngleDeg: number | undefined
  private detectorLastThreatCount: number | undefined
  private detectorLastError: string | undefined

  constructor(
    private readonly sessionId: string,
    private readonly profile: GameProfile,
    private readonly sessionDir: string,
    private readonly binaryPath: string,
    private readonly detector?: NzmFutureObservePerceptionDetector,
    adapterInstanceId = randomUUID(),
    readonly warning?: string,
  ) {
    this.descriptor = {
      schemaVersion: 1,
      adapterId: detector
        ? 'com.leviathan.perception.windows-wgc-nzm-fusion.v1'
        : 'com.leviathan.perception.windows-wgc-frame-metrics.v1',
      adapterInstanceId,
      kind: detector ? 'fusion' : 'capture',
      captureBackend: 'windows_graphics_capture',
      capabilities: [
        'frame.viewport',
        'frame.motion',
        'frame.motion_grid',
        'frame.metrics',
        ...(detector?.capabilities ?? []),
      ],
    }
  }

  async start(hwnd: string): Promise<void> {
    if (this.client) throw new Error('Windows Graphics Capture adapter is already started.')
    const client = new NativeGameCaptureClient({
      binaryPath: this.binaryPath,
      hwnd,
      targetFps: this.profile.capture.fps,
      sessionId: this.sessionId,
      adapterInstanceId: this.descriptor.adapterInstanceId,
      recordingPath: this.profile.capture.recordFrames
        ? join(this.sessionDir, 'capture.mp4')
        : undefined,
      sampleDirectory: this.profile.capture.recordFrames
        ? join(this.sessionDir, 'frames')
        : undefined,
      sampleFps: this.profile.capture.recordFrames
        ? this.profile.capture.datasetSampleFps
        : 0,
    })
    this.client = client
    await client.start()
  }

  async sample(
    _hwnd: string,
    signal?: AbortSignal,
  ): Promise<GamePerceptionFrameSample> {
    if (!this.client) throw new Error('Windows Graphics Capture adapter is not started.')
    const frame = await this.client.nextFrame(signal)
    let detectorObservation: NzmFuturePerceptionObservation = {}
    if (this.detector && frame.samplePath && frame.sampleSha256) {
      try {
        const samplePath = resolveSessionArtifactPath(
          this.sessionDir,
          frame.samplePath,
        )
        const encodedFrame = await readFile(samplePath)
        if (sha256(encodedFrame) !== frame.sampleSha256) {
          throw new Error('Native sample image digest does not match its event.')
        }
        const result = await this.detector.analyze(encodedFrame)
        detectorObservation = result.observation
        this.detectorAnalyzedFrameCount += 1
        this.detectorLastInferenceMs = result.inferenceMs
        this.detectorLastResultAt = new Date().toISOString()
        this.detectorLastPhaseConfidence = result.phaseConfidence
        this.detectorLastObjectiveCandidateConfidence =
          result.objectiveCandidate?.confidence
        this.detectorLastObjectiveCandidateAngleDeg =
          result.objectiveCandidate?.angleDeg
        this.detectorLastThreatCount = result.threatCount
        this.detectorLastError = undefined
      } catch (error) {
        this.detectorErrorCount += 1
        this.detectorLastError = errorMessage(error)
      }
    }
    return {
      envelope: {
        schemaVersion: 1,
        sessionId: this.sessionId,
        adapterInstanceId: this.descriptor.adapterInstanceId,
        sequence: frame.sequence,
        capturedAt: frame.capturedAt,
        frameSha256: frame.frameSha256,
        observation: {
          frameId: frame.sequence,
          viewport: { width: frame.width, height: frame.height },
          motionScore: frame.motionScore,
          motionGrid: {
            columns: frame.motionGridColumns,
            rows: frame.motionGridRows,
            values: frame.motionGrid,
          },
          frameMetrics: {
            meanLuma: frame.meanLuma,
            lumaStdDev: frame.lumaStdDev,
            blackFrameProbability: frame.blackFrameProbability,
            measuredFps: frame.measuredFps,
            processingMs: frame.processingMs,
          },
          ...detectorObservation,
        },
      },
      sampleImage:
        frame.samplePath && frame.sampleSha256
          ? { path: frame.samplePath, sha256: frame.sampleSha256 }
          : undefined,
    }
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = undefined
  }

  diagnostics(): Partial<GamePerceptionRuntimeSummary> {
    const captureDiagnostics = this.client?.diagnostics() ?? {
      status: 'stopped',
      targetFps: this.profile.capture.fps,
      recordingPath: this.profile.capture.recordFrames
        ? join(this.sessionDir, 'capture.mp4')
        : undefined,
      sampleDirectory: this.profile.capture.recordFrames
        ? join(this.sessionDir, 'frames')
        : undefined,
    }
    return {
      ...captureDiagnostics,
      detectorId: this.detector?.id,
      detectorAnalyzedFrameCount: this.detectorAnalyzedFrameCount,
      detectorErrorCount: this.detectorErrorCount,
      detectorLastInferenceMs: this.detectorLastInferenceMs,
      detectorLastResultAt: this.detectorLastResultAt,
      detectorLastPhaseConfidence: this.detectorLastPhaseConfidence,
      detectorLastObjectiveCandidateConfidence:
        this.detectorLastObjectiveCandidateConfidence,
      detectorLastObjectiveCandidateAngleDeg:
        this.detectorLastObjectiveCandidateAngleDeg,
      detectorLastThreatCount: this.detectorLastThreatCount,
      detectorLastError: this.detectorLastError,
    }
  }
}

export async function createGamePerceptionAdapter(
  profile: GameProfile,
  sessionId: string,
  sessionDir = process.cwd(),
  options: {
    cwd?: string
    controlMode?: ActiveGameModelMode
  } = {},
): Promise<GamePerceptionAdapter | undefined> {
  if (profile.capture.backend === 'external_native') return undefined
  if (profile.capture.backend === 'windows_graphics_capture') {
    const binaryPath = resolveNativeGameCaptureBinary()
    if (binaryPath) {
      const detectorResult = await createNzmFutureObserveDetector({
        profile,
        cwd: options.cwd ?? process.cwd(),
        controlMode: options.controlMode,
      })
      return new WindowsGraphicsCapturePerceptionAdapter(
        sessionId,
        profile,
        sessionDir,
        binaryPath,
        detectorResult.detector,
        undefined,
        detectorResult.warning,
      )
    }
    return new WindowsGdiMotionPerceptionAdapter(
      sessionId,
      undefined,
      'Windows Graphics Capture binary was not found; using the slower GDI fallback.',
    )
  }
  return new WindowsGdiMotionPerceptionAdapter(sessionId)
}

type NzmFuturePerceptionObservation = Awaited<
  ReturnType<NzmFutureObservePerceptionDetector['analyze']>
>['observation']

async function createNzmFutureObserveDetector(input: {
  profile: GameProfile
  cwd: string
  controlMode?: ActiveGameModelMode
}): Promise<{
  detector?: NzmFutureObservePerceptionDetector
  warning?: string
}> {
  if (input.profile.id !== 'com.leviathan.game.nzm-future') return {}
  if (input.controlMode !== 'observe') {
    return {
      warning:
        'NZM Future image perception is disabled outside observe mode until offline validation is complete.',
    }
  }
  if (!input.profile.capture.recordFrames) {
    return {
      warning:
        'NZM Future observe perception requires recordFrames so sampled images are available to the detector.',
    }
  }
  try {
    const loaded = await loadGameCalibration({
      cwd: input.cwd,
      profileId: input.profile.id,
    })
    const detector = await NzmFutureObservePerceptionDetector.create({
      calibrationPath: loaded.path,
      calibration: loaded.calibration,
    })
    return {
      detector,
      warning:
        'NZM Future heuristic perception is observe-only and must be benchmarked against reviewed labels before live control.',
    }
  } catch (error) {
    return {
      warning: `NZM Future observe perception is unavailable: ${errorMessage(error)}`,
    }
  }
}

function resolveSessionArtifactPath(sessionDir: string, candidate: string): string {
  const root = resolve(sessionDir)
  const resolved = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(root, candidate)
  const relation = relative(root, resolved)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Native sample image resolves outside the active session directory.')
  }
  return resolved
}

function calculateMotionScore(
  previous: Buffer | undefined,
  current: Buffer,
): number {
  if (!previous || previous.length !== current.length) return 0
  let total = 0
  for (let index = 0; index < current.length; index += 1) {
    total += Math.abs(current[index]! - previous[index]!)
  }
  return Number((total / current.length / 255).toFixed(4))
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
