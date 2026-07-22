import { createHash } from 'node:crypto'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { FrameRingBuffer } from './frameRingBuffer.js'
import {
  HumanInputRecorderClient,
  type NativeHumanInputSample,
} from './humanInputRecorder.js'
import { GameInputController } from './inputController.js'
import {
  controlPlanToActionSample,
  humanInputToActionSample,
} from './actionTrajectory.js'
import type {
  GameSidecarRequest,
  GameSidecarResponse,
  GameSidecarStartParams,
} from './ipc.js'
import {
  createGamePerceptionAdapter,
  TrustedGameObservationGate,
  WindowsGdiMotionPerceptionAdapter,
  type GamePerceptionAdapter,
} from './perceptionAdapter.js'
import { createGameControlPlan, decideGameIntent } from './tacticalPolicy.js'
import type {
  GameRuntimeSummary,
  GameWorldState,
  TrustedGameObservation,
} from './types.js'
import {
  applyGameObservation,
  createInitialGameWorldState,
} from './worldState.js'
import { resolveNativeGameCaptureBinary } from './nativeCaptureClient.js'

type CapturedFrame = {
  timestamp: number
  frameId: number
  motionScore: number
  frameSha256?: string
  imageSha256?: string
  path?: string
}

type ActiveSession = {
  params: GameSidecarStartParams
  status: GameRuntimeSummary['status']
  startedAt: string
  stoppedAt?: string
  world: GameWorldState
  currentIntent?: GameRuntimeSummary['currentIntent']
  observations: FrameRingBuffer<TrustedGameObservation>
  frames: FrameRingBuffer<CapturedFrame>
  perceptionAdapter?: GamePerceptionAdapter
  perceptionGate?: TrustedGameObservationGate
  humanInput?: HumanInputRecorderClient
  input: GameInputController
  observationCount: number
  decisionCount: number
  frameCount: number
  lastSampledFrameAt: number
  lastDecisionAt: number
  lastActionAt: number
  lastHumanTimestampNs?: bigint
  lastHumanFocused?: boolean
  humanEpisodeIndex: number
  lastPersistedFrameSequence?: number
  alignedHumanActionCount: number
  skippedUnalignedHumanSampleCount: number
  rawHumanSampleCount: number
  humanFocusLossCount: number
  lastHumanSampleAt?: string
  warnings: string[]
  captureTimer?: ReturnType<typeof setTimeout>
  controlTimer?: ReturnType<typeof setInterval>
  parentTimer?: ReturnType<typeof setInterval>
  captureAbort?: AbortController
  captureLoop?: Promise<void>
  consecutiveBlackFrames: number
  writeQueue: Promise<void>
}

class GameSidecarRuntime {
  private session: ActiveSession | undefined

  async handle(
    request: GameSidecarRequest,
  ): Promise<GameSidecarResponse['data']> {
    switch (request.method) {
      case 'ping':
        return { pong: true }
      case 'start':
        return await this.start(request.params)
      case 'set_goal':
        return await this.setGoal(request.params.objective)
      case 'get_summary':
        return this.getSummary()
      case 'pause':
        return await this.pause()
      case 'resume':
        return await this.resume()
      case 'stop':
        return await this.stop()
    }
  }

  async shutdown(): Promise<void> {
    await this.stop().catch(() => {})
  }

  private async start(
    params: GameSidecarStartParams,
  ): Promise<GameRuntimeSummary> {
    if (this.session) await this.stop()
    await mkdir(params.sessionDir, { recursive: true })
    const now = new Date().toISOString()
    const warnings = buildStartWarnings(params)
    const retentionMs = params.profile.capture.ringBufferSeconds * 1000
    const perceptionAdapter = await createGamePerceptionAdapter(
      params.profile,
      params.sessionId,
      params.sessionDir,
      { cwd: params.cwd, controlMode: params.controlMode },
    )
    const perceptionGate = perceptionAdapter
      ? new TrustedGameObservationGate(
          params.sessionId,
          perceptionAdapter.descriptor,
        )
      : undefined
    const session: ActiveSession = {
      params,
      status: 'starting',
      startedAt: now,
      world: createInitialGameWorldState(),
      observations: new FrameRingBuffer(retentionMs),
      frames: new FrameRingBuffer(retentionMs),
      perceptionAdapter,
      perceptionGate,
      input: new GameInputController(params.controlMode, params.hwnd),
      observationCount: 0,
      decisionCount: 0,
      frameCount: 0,
      lastSampledFrameAt: 0,
      lastDecisionAt: 0,
      lastActionAt: 0,
      humanEpisodeIndex: 1,
      alignedHumanActionCount: 0,
      skippedUnalignedHumanSampleCount: 0,
      rawHumanSampleCount: 0,
      humanFocusLossCount: 0,
      warnings,
      consecutiveBlackFrames: 0,
      writeQueue: Promise.resolve(),
    }
    this.session = session
    await this.startPerception(session)
    await writeFile(
      join(params.sessionDir, 'profile.snapshot.json'),
      `${JSON.stringify(params.profile, null, 2)}\n`,
      'utf8',
    )
    session.status = 'running'
    this.startCaptureLoop(session)
    try {
      if (params.controlMode === 'demo') {
        await this.startHumanInputRecorder(session)
      }
    } catch (error) {
      session.status = 'failed'
      session.captureAbort?.abort()
      await session.perceptionAdapter?.close().catch(() => {})
      await session.captureLoop?.catch(() => {})
      await session.input.close().catch(() => {})
      await this.persistSummary().catch(() => {})
      throw error
    }
    await this.recordEvent('session_started', {
      controlMode: params.controlMode,
      objective: params.objective,
      hwnd: params.hwnd,
      profileId: params.profile.id,
      perceptionAdapter: perceptionAdapter?.descriptor,
      activePerceptionAdapter: session.perceptionAdapter?.descriptor,
    })
    await this.persistSummary()
    if (params.controlMode !== 'demo') this.startControlLoop(session)
    this.startParentWatchdog(session)
    return this.getSummary()
  }

  private async setGoal(objective: string): Promise<GameRuntimeSummary> {
    const session = this.requireSession()
    const normalized = objective.trim()
    if (!normalized) throw new Error('GameModel objective cannot be empty.')
    session.params = { ...session.params, objective: normalized }
    await this.recordEvent('goal_updated', { objective: normalized })
    await this.persistSummary()
    return this.getSummary()
  }

  private async ingestTrustedObservation(
    session: ActiveSession,
    observation: TrustedGameObservation,
  ): Promise<void> {
    if (session.status === 'stopped' || session.status === 'failed') {
      throw new Error(
        `Cannot ingest observation while session is ${session.status}.`,
      )
    }
    const timestamp = observation.timestamp
    session.observations.push(observation, timestamp)
    session.world = applyGameObservation(
      session.world,
      observation,
      session.params.profile,
    )
    session.observationCount += 1
    const blackFrameProbability =
      observation.frameMetrics?.blackFrameProbability
    session.consecutiveBlackFrames =
      blackFrameProbability !== undefined && blackFrameProbability >= 0.9
        ? session.consecutiveBlackFrames + 1
        : 0
    this.queueWrite(
      join(session.params.sessionDir, 'observations.jsonl'),
      `${JSON.stringify(observation)}\n`,
    )
    if (session.consecutiveBlackFrames >= 30) {
      const warning =
        'Perception safety pause: the native capture stream produced 30 consecutive near-black frames.'
      if (addWarning(session, warning)) {
        await this.recordEvent('perception_black_frame_pause', { warning })
      }
      if (session.params.controlMode === 'live') {
        session.status = 'paused'
        await session.input.releaseAll()
      }
    }
    const decisionInterval = 1000 / session.params.profile.policy.decisionHz
    if (
      session.params.controlMode !== 'demo' &&
      timestamp - session.lastDecisionAt >= decisionInterval
    ) {
      await this.runDecisionCycle(session, timestamp)
    }
  }

  private async pause(): Promise<GameRuntimeSummary> {
    const session = this.requireSession()
    if (session.status === 'stopped') return this.getSummary()
    session.status = 'paused'
    await session.humanInput?.close().catch(() => {})
    session.humanInput = undefined
    await session.input.releaseAll()
    await this.recordEvent('session_paused')
    await this.persistSummary()
    return this.getSummary()
  }

  private async resume(): Promise<GameRuntimeSummary> {
    const session = this.requireSession()
    if (session.status === 'stopped') {
      throw new Error('Stopped GameModel sessions cannot be resumed.')
    }
    session.status = 'running'
    if (session.params.controlMode === 'demo') {
      session.humanEpisodeIndex += 1
      session.lastHumanTimestampNs = undefined
      session.lastHumanFocused = undefined
      await this.startHumanInputRecorder(session)
    }
    await this.recordEvent('session_resumed')
    await this.persistSummary()
    return this.getSummary()
  }

  private async stop(): Promise<GameRuntimeSummary> {
    const session = this.session
    if (!session) throw new Error('No active GameModel session.')
    if (session.captureTimer) clearTimeout(session.captureTimer)
    if (session.controlTimer) clearInterval(session.controlTimer)
    if (session.parentTimer) clearInterval(session.parentTimer)
    session.captureAbort?.abort()
    await session.humanInput?.close().catch(() => {})
    session.humanInput = undefined
    await session.perceptionAdapter?.close().catch(() => {})
    await session.captureLoop?.catch(() => {})
    await session.input.close()
    if (session.status !== 'stopped') {
      session.status = 'stopped'
      session.stoppedAt = new Date().toISOString()
      await this.recordEvent('session_stopped')
      await this.persistSummary()
    }
    await session.writeQueue
    return this.getSummary()
  }

  private getSummary(): GameRuntimeSummary {
    const session = this.requireSession()
    const now = Date.now()
    const lease = session.input.inputLeaseExpiresAt
    return {
      sessionId: session.params.sessionId,
      status: session.status,
      controlMode: session.params.controlMode,
      objective: session.params.objective,
      profileId: session.params.profile.id,
      hwnd: session.params.hwnd,
      startedAt: session.startedAt,
      updatedAt: new Date(now).toISOString(),
      stoppedAt: session.stoppedAt,
      observationCount: session.observationCount,
      decisionCount: session.decisionCount,
      lastObservationAgeMs:
        session.world.lastObservationAt > 0
          ? Math.max(0, now - session.world.lastObservationAt)
          : undefined,
      inputLeaseExpiresAt: lease ? new Date(lease).toISOString() : undefined,
      world: session.world,
      currentIntent: session.currentIntent,
      perception: session.perceptionGate
        ? {
            ...session.perceptionGate.summary(),
            ...session.perceptionAdapter?.diagnostics?.(),
          }
        : {
            status: 'not_configured',
            capabilities: [],
            trustedObservationCount: 0,
            rejectedObservationCount: 0,
          },
      demonstration:
        session.params.controlMode === 'demo'
          ? buildHumanInputSummary(session)
          : undefined,
      sessionDir: session.params.sessionDir,
      warnings: [...session.warnings],
    }
  }

  private startControlLoop(session: ActiveSession): void {
    const intervalMs = Math.max(
      8,
      Math.round(1000 / session.params.profile.policy.controlHz),
    )
    session.controlTimer = setInterval(() => {
      void this.controlTick(session)
    }, intervalMs)
  }

  private async controlTick(session: ActiveSession): Promise<void> {
    if (this.session !== session || session.status !== 'running') return
    const now = Date.now()
    await session.input.releaseIfExpired(now)
    if (
      session.world.lastObservationAt === 0 ||
      now - session.world.lastObservationAt >
        session.params.profile.policy.observationTimeoutMs
    ) {
      await session.input.releaseAll()
      return
    }
    const decisionInterval = 1000 / session.params.profile.policy.decisionHz
    if (now - session.lastDecisionAt >= decisionInterval) {
      await this.runDecisionCycle(session, now)
    }
  }

  private async runDecisionCycle(
    session: ActiveSession,
    now: number,
  ): Promise<void> {
    if (session.status !== 'running') return
    const gameIntent = decideGameIntent(
      session.world,
      session.params.profile,
      now,
    )
    const plan = createGameControlPlan(
      session.world,
      session.params.profile,
      gameIntent,
    )
    session.lastDecisionAt = now
    session.currentIntent = gameIntent
    session.world = { ...session.world, lastIntent: gameIntent }
    session.decisionCount += 1
    await this.recordEvent('decision', {
      intent: gameIntent.kind,
      reason: gameIntent.reason,
      targetId: gameIntent.targetId,
      liveInput: session.params.controlMode === 'live',
    })
    try {
      await session.input.applyPlan(plan)
      const deltaSeconds = session.lastActionAt
        ? Math.max(0.001, Math.min(1, (now - session.lastActionAt) / 1000))
        : 1 / session.params.profile.policy.decisionHz
      const actionSample = controlPlanToActionSample({
        sessionId: session.params.sessionId,
        episodeId: `${session.params.sessionId}:episode-1`,
        timestampMs: now,
        frameSequence: session.world.frameId ?? session.frameCount,
        deltaSeconds,
        source: session.params.controlMode === 'live' ? 'policy' : 'pseudo',
        plan,
        maxMouseDelta: session.params.profile.policy.maxMouseDelta,
      })
      session.lastActionAt = now
      this.queueWrite(
        join(session.params.sessionDir, 'actions.jsonl'),
        `${JSON.stringify(actionSample)}\n`,
      )
    } catch (error) {
      await session.input.releaseAll()
      session.status = 'paused'
      const warning = `Live input paused: ${errorMessage(error)}`
      addWarning(session, warning)
      await this.recordEvent('input_safety_pause', { warning })
    }
  }

  private startCaptureLoop(session: ActiveSession): void {
    if (
      !session.params.hwnd ||
      !session.perceptionAdapter ||
      !session.perceptionGate
    ) {
      return
    }
    session.captureAbort = new AbortController()
    if (session.perceptionAdapter.delivery === 'stream') {
      session.captureLoop = this.runStreamCaptureLoop(
        session,
        session.captureAbort.signal,
      )
      return
    }
    const intervalMs = Math.max(
      50,
      Math.round(1000 / session.params.profile.capture.fps),
    )
    const schedule = () => {
      session.captureTimer = setTimeout(async () => {
        if (this.session !== session || session.status === 'stopped') return
        await this.captureFrame(session, session.captureAbort?.signal).catch(
          async (error) => {
            const warning = `Fallback capture unavailable: ${errorMessage(error)}`
            if (addWarning(session, warning)) {
              await this.recordEvent('capture_error', { warning })
            }
          },
        )
        schedule()
      }, intervalMs)
    }
    schedule()
  }

  private async runStreamCaptureLoop(
    session: ActiveSession,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      while (
        this.session === session &&
        session.status !== 'stopped' &&
        !signal.aborted
      ) {
        await this.captureFrame(session, signal)
      }
    } catch (error) {
      if (
        signal.aborted ||
        this.session !== session ||
        session.status === 'stopped'
      ) {
        return
      }
      await session.input.releaseAll()
      if (session.params.controlMode === 'live') session.status = 'paused'
      const warning = `Native capture stream stopped: ${errorMessage(error)}`
      addWarning(session, warning)
      await this.recordEvent('capture_stream_stopped', { warning })
    }
  }

  private async captureFrame(
    session: ActiveSession,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !session.params.hwnd ||
      !session.perceptionAdapter ||
      !session.perceptionGate
    ) {
      throw new Error('No trusted perception adapter is configured.')
    }
    const sample = await session.perceptionAdapter.sample(
      session.params.hwnd,
      signal,
    )
    const observation = session.perceptionGate.accept(sample.envelope)
    session.frameCount += 1
    const timestamp = observation.timestamp
    let framePath: string | undefined
    let imageSha256: string | undefined
    if (
      session.params.profile.capture.recordFrames &&
      sample.encodedFrame &&
      shouldPersistFallbackSample(session, timestamp)
    ) {
      const framesDir = join(session.params.sessionDir, 'frames')
      await mkdir(framesDir, { recursive: true })
      framePath = join(
        framesDir,
        `${String(session.frameCount).padStart(8, '0')}.png`,
      )
      await writeFile(framePath, sample.encodedFrame)
      imageSha256 = sha256(sample.encodedFrame)
    } else if (
      session.params.profile.capture.recordFrames &&
      sample.sampleImage
    ) {
      framePath = assertSessionArtifactPath(
        session.params.sessionDir,
        sample.sampleImage.path,
      )
      imageSha256 = sample.sampleImage.sha256
    }
    session.frames.push(
      {
        timestamp,
        frameId: observation.frameId,
        motionScore: observation.motionScore ?? 0,
        frameSha256: observation.provenance.frameSha256,
        imageSha256,
        path: framePath,
      },
      timestamp,
    )
    if (framePath && imageSha256) {
      session.lastPersistedFrameSequence = observation.provenance.sequence
      this.queueWrite(
        join(session.params.sessionDir, 'frames.index.jsonl'),
        `${JSON.stringify({
          schemaVersion: 1,
          sessionId: session.params.sessionId,
          sequence: observation.provenance.sequence,
          capturedAt: timestamp,
          frameId: observation.frameId,
          frameSha256: observation.provenance.frameSha256,
          imagePath: relative(session.params.sessionDir, framePath).replaceAll(
            '\\',
            '/',
          ),
          imageSha256,
          viewport: observation.viewport,
          motionScore: observation.motionScore ?? 0,
          frameMetrics: observation.frameMetrics,
        })}\n`,
      )
    }
    await this.ingestTrustedObservation(session, observation)
  }

  private async startPerception(session: ActiveSession): Promise<void> {
    const hwnd = session.params.hwnd
    const adapter = session.perceptionAdapter
    if (!hwnd || !adapter) return
    try {
      await adapter.start(hwnd)
      if (adapter.warning) addWarning(session, adapter.warning)
    } catch (error) {
      await adapter.close().catch(() => {})
      if (
        session.params.profile.capture.backend !== 'windows_graphics_capture'
      ) {
        throw error
      }
      const warning =
        `Windows Graphics Capture unavailable: ${errorMessage(error)} ` +
        'Using the slower GDI fallback.'
      const fallback = new WindowsGdiMotionPerceptionAdapter(
        session.params.sessionId,
        undefined,
        warning,
      )
      await fallback.start(hwnd)
      session.perceptionAdapter = fallback
      session.perceptionGate = new TrustedGameObservationGate(
        session.params.sessionId,
        fallback.descriptor,
      )
      addWarning(session, warning)
    }
  }

  private async startHumanInputRecorder(session: ActiveSession): Promise<void> {
    if (session.params.controlMode !== 'demo') return
    if (!session.params.hwnd) {
      throw new Error('Demo GameModel sessions require a target hwnd.')
    }
    if (session.humanInput) return
    const binaryPath = resolveNativeGameCaptureBinary({ cwd: session.params.cwd })
    if (!binaryPath) {
      throw new Error(
        'Demo input recording requires the Leviathan native game-capture binary. Run bun run build:game-capture first.',
      )
    }
    const sampleHz = Math.max(
      60,
      Math.min(120, Math.round(session.params.profile.policy.controlHz)),
    )
    const recorder = new HumanInputRecorderClient({
      binaryPath,
      hwnd: session.params.hwnd,
      sampleHz,
      sessionId: session.params.sessionId,
      parentPid: process.pid,
    })
    session.humanInput = recorder
    try {
      await recorder.start(sample => this.handleHumanInputSample(session, sample))
      const diagnostics = recorder.diagnostics()
      this.queueWrite(
        join(session.params.sessionDir, 'clock.sync.jsonl'),
        `${JSON.stringify({
          schemaVersion: 1,
          sessionId: session.params.sessionId,
          episodeId: humanEpisodeId(session),
          source: 'windows_raw_input',
          processId: diagnostics.processId,
          sampleHz: diagnostics.sampleHz,
          clockOriginUnixNs: diagnostics.clockOriginUnixNs,
          clockOriginMonotonicNs: diagnostics.clockOriginMonotonicNs,
          recordedAt: new Date().toISOString(),
        })}\n`,
      )
      await this.recordEvent('human_input_recording_started', {
        backend: 'windows_raw_input',
        sampleHz,
        processId: diagnostics.processId,
      })
    } catch (error) {
      await recorder.close().catch(() => {})
      session.humanInput = undefined
      throw error
    }
  }

  private handleHumanInputSample(
    session: ActiveSession,
    sample: NativeHumanInputSample,
  ): void {
    if (
      this.session !== session ||
      session.params.controlMode !== 'demo' ||
      session.status !== 'running'
    ) {
      return
    }
    this.queueWrite(
      join(session.params.sessionDir, 'input-events.jsonl'),
      `${JSON.stringify(sample)}\n`,
    )
    session.rawHumanSampleCount += 1
    session.lastHumanSampleAt = timestampNsToIso(sample.timestampNs)
    const timestampNs = BigInt(sample.timestampNs)
    if (
      session.lastHumanTimestampNs !== undefined &&
      timestampNs <= session.lastHumanTimestampNs
    ) {
      const warning = 'Human input recorder emitted a non-monotonic timestamp; sample skipped.'
      if (addWarning(session, warning)) {
        void this.recordEvent('human_input_timestamp_rejected', { warning })
      }
      return
    }
    const deltaSeconds = session.lastHumanTimestampNs
      ? Number(timestampNs - session.lastHumanTimestampNs) / 1_000_000_000
      : 1 / Math.max(1, session.params.profile.policy.controlHz)
    session.lastHumanTimestampNs = timestampNs

    if (sample.focused !== session.lastHumanFocused) {
      if (session.lastHumanFocused === true && !sample.focused) {
        session.humanFocusLossCount += 1
      }
      session.lastHumanFocused = sample.focused
      void this.recordEvent(
        sample.focused ? 'human_input_focus_regained' : 'human_input_focus_lost',
        { sequence: sample.sequence },
      )
    }
    const frameSequence = session.lastPersistedFrameSequence
    if (frameSequence === undefined) {
      session.skippedUnalignedHumanSampleCount += 1
      return
    }
    const action = humanInputToActionSample({
      sessionId: session.params.sessionId,
      episodeId: humanEpisodeId(session),
      frameSequence,
      deltaSeconds,
      sample,
      maxMouseDelta: session.params.profile.policy.maxMouseDelta,
    })
    session.alignedHumanActionCount += 1
    this.queueWrite(
      join(session.params.sessionDir, 'actions.jsonl'),
      `${JSON.stringify(action)}\n`,
    )
  }

  private startParentWatchdog(session: ActiveSession): void {
    session.parentTimer = setInterval(() => {
      if (isProcessAlive(session.params.parentPid)) return
      void session.input.releaseAll().finally(() => process.exit(0))
    }, 1000)
  }

  private async recordEvent(
    name: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const session = this.requireSession()
    const event = {
      timestamp: new Date().toISOString(),
      sessionId: session.params.sessionId,
      name,
      data,
    }
    this.queueWrite(
      join(session.params.sessionDir, 'events.jsonl'),
      `${JSON.stringify(event)}\n`,
    )
    writeLine({ type: 'event', event })
  }

  private async persistSummary(): Promise<void> {
    const session = this.requireSession()
    const path = join(session.params.sessionDir, 'session.json')
    const summary = this.getSummary()
    session.writeQueue = session.writeQueue.then(() =>
      writeFile(path, `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
    )
    await session.writeQueue
  }

  private queueWrite(path: string, content: string): void {
    const session = this.requireSession()
    session.writeQueue = session.writeQueue.then(() =>
      appendFile(path, content, 'utf8'),
    )
  }

  private requireSession(): ActiveSession {
    if (!this.session) throw new Error('No active GameModel session.')
    return this.session
  }
}

function assertSessionArtifactPath(
  sessionDir: string,
  candidate: string,
): string {
  const root = resolve(sessionDir)
  const resolved = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(root, candidate)
  const relation = relative(root, resolved)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error(
      'Native capture emitted a sample path outside the active session directory.',
    )
  }
  return resolved
}

function shouldPersistFallbackSample(
  session: ActiveSession,
  timestamp: number,
): boolean {
  const sampleFps = session.params.profile.capture.datasetSampleFps
  if (
    !shouldPersistSampleAtRate(session.lastSampledFrameAt, timestamp, sampleFps)
  ) {
    return false
  }
  session.lastSampledFrameAt = timestamp
  return true
}

export function shouldPersistSampleAtRate(
  lastSampledAt: number,
  timestamp: number,
  sampleFps: number,
): boolean {
  if (sampleFps <= 0) return false
  return lastSampledAt <= 0 || timestamp - lastSampledAt >= 1000 / sampleFps
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function runGameSidecarProcess(): Promise<void> {
  const runtime = new GameSidecarRuntime()
  const readline = createInterface({ input: process.stdin })
  try {
    for await (const line of readline) {
      let request: GameSidecarRequest
      try {
        request = JSON.parse(line) as GameSidecarRequest
      } catch {
        continue
      }
      try {
        const data = await runtime.handle(request)
        writeLine({ type: 'response', id: request.id, ok: true, data })
        if (request.method === 'stop') break
      } catch (error) {
        writeLine({
          type: 'response',
          id: request.id,
          ok: false,
          error: errorMessage(error),
        })
      }
    }
  } finally {
    await runtime.shutdown()
    readline.close()
  }
}

function buildStartWarnings(params: GameSidecarStartParams): string[] {
  const warnings: string[] = []
  if (!params.hwnd) {
    warnings.push(
      'No game hwnd is configured; continuous frame capture is disabled.',
    )
  }
  if (params.profile.capture.backend === 'windows_gdi_fallback') {
    warnings.push(
      `Windows GDI trusted adapter is limited to ${params.profile.capture.fps} FPS and can submit only measured viewport and motion fields; target/HUD perception requires additional capability-scoped detectors.`,
    )
  } else if (params.profile.capture.backend === 'external_native') {
    warnings.push(
      'External native capture is selected; an adapter must stream structured observations into this session.',
    )
  }
  if (params.controlMode === 'observe') {
    warnings.push('Observation mode never emits keyboard or mouse input.')
  } else if (params.controlMode === 'demo') {
    warnings.push(
      'Demo mode records Raw Input only while the bound game window is foreground; it never emits keyboard or mouse input and never runs the tactical policy.',
    )
  }
  return warnings
}

function buildHumanInputSummary(
  session: ActiveSession,
): NonNullable<GameRuntimeSummary['demonstration']> {
  const diagnostics = session.humanInput?.diagnostics()
  return {
    status: diagnostics?.status ?? 'stopped',
    backend: 'windows_raw_input',
    sampleHz:
      diagnostics?.sampleHz ??
      Math.max(60, Math.min(120, Math.round(session.params.profile.policy.controlHz))),
    processId: diagnostics?.processId,
    episodeId: humanEpisodeId(session),
    rawSampleCount: session.rawHumanSampleCount,
    alignedActionCount: session.alignedHumanActionCount,
    skippedUnalignedSampleCount: session.skippedUnalignedHumanSampleCount,
    focusLossCount: session.humanFocusLossCount,
    targetFocused: diagnostics?.targetFocused,
    lastSampleAt: session.lastHumanSampleAt ?? diagnostics?.lastSampleAt,
    rawEventsPath: join(session.params.sessionDir, 'input-events.jsonl'),
    actionsPath: join(session.params.sessionDir, 'actions.jsonl'),
    clockSyncPath: join(session.params.sessionDir, 'clock.sync.jsonl'),
    lastError: diagnostics?.lastError,
  }
}

function humanEpisodeId(session: ActiveSession): string {
  return `${session.params.sessionId}:episode-${session.humanEpisodeIndex}`
}

function timestampNsToIso(timestampNs: string): string {
  return new Date(Number(BigInt(timestampNs) / 1_000_000n)).toISOString()
}

function addWarning(session: ActiveSession, warning: string): boolean {
  if (session.warnings.includes(warning)) return false
  session.warnings.push(warning)
  return true
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function writeLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}
