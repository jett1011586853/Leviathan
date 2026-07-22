export const GAME_MODEL_MODES = ['off', 'observe', 'demo', 'live'] as const

export type GameModelMode = (typeof GAME_MODEL_MODES)[number]
export type ActiveGameModelMode = Exclude<GameModelMode, 'off'>

export const GAME_PHASES = [
  'unknown',
  'home',
  'map_select',
  'difficulty_select',
  'matchmaking',
  'loading',
  'combat',
  'settlement',
] as const

export type GamePhase = (typeof GAME_PHASES)[number]

export type GameTargetObservation = {
  id: string
  confidence: number
  screenX: number
  screenY: number
  width?: number
  height?: number
  threat?: number
  weakPointX?: number
  weakPointY?: number
}

export type GameThreatObservation = {
  id?: string
  confidence: number
  direction: 'left' | 'right' | 'front' | 'rear' | 'unknown'
  distance?: number
  attackImminent?: boolean
}

export const GAME_PERCEPTION_CAPABILITIES = [
  'frame.viewport',
  'frame.motion',
  'frame.motion_grid',
  'frame.metrics',
  'game.phase',
  'hud.ammo',
  'hud.economy',
  'hud.health',
  'hud.interaction',
  'navigation.objective_arrow',
  'vision.targets',
  'vision.threats',
] as const

export type GamePerceptionCapability =
  (typeof GAME_PERCEPTION_CAPABILITIES)[number]

export type GamePerceptionAdapterDescriptor = {
  schemaVersion: 1
  adapterId: string
  adapterInstanceId: string
  kind: 'capture' | 'detector' | 'fusion'
  captureBackend: string
  capabilities: GamePerceptionCapability[]
}

export type GameObservationProvenance = {
  schemaVersion: 1
  trust: 'sidecar_adapter'
  sessionId: string
  adapterId: string
  adapterInstanceId: string
  adapterKind: GamePerceptionAdapterDescriptor['kind']
  captureBackend: string
  capabilities: GamePerceptionCapability[]
  sequence: number
  capturedAt: number
  receivedAt: number
  frameSha256?: string
  observationSha256: string
}

export type GameObservation = {
  timestamp?: number
  frameId?: number
  viewport?: { width: number; height: number }
  phase?: GamePhase
  ammo?: { current: number; reserve?: number; capacity?: number }
  economy?: number
  health?: number
  safeToInteract?: boolean
  objectiveArrow?: { angleDeg: number; confidence: number }
  motionScore?: number
  motionGrid?: {
    columns: number
    rows: number
    values: number[]
  }
  frameMetrics?: {
    meanLuma: number
    lumaStdDev: number
    blackFrameProbability: number
    measuredFps: number
    processingMs: number
  }
  targets?: GameTargetObservation[]
  threats?: GameThreatObservation[]
  metadata?: Record<string, unknown>
  provenance?: GameObservationProvenance
}

export type TrustedGameObservation = GameObservation & {
  timestamp: number
  frameId: number
  provenance: GameObservationProvenance
}

export type GamePerceptionRuntimeSummary = {
  status: 'starting' | 'active' | 'degraded' | 'stopped' | 'not_configured'
  adapterId?: string
  adapterInstanceId?: string
  captureBackend?: string
  capabilities: GamePerceptionCapability[]
  trustedObservationCount: number
  rejectedObservationCount: number
  lastTrustedObservationAt?: string
  processId?: number
  targetFps?: number
  measuredFps?: number
  nativeFrameCount?: number
  droppedFrameCount?: number
  blackFrameCount?: number
  sampledFrameCount?: number
  sampleDirectory?: string
  recordingPath?: string
  detectorId?: string
  detectorAnalyzedFrameCount?: number
  detectorErrorCount?: number
  detectorLastInferenceMs?: number
  detectorLastResultAt?: string
  detectorLastPhaseConfidence?: number
  detectorLastObjectiveCandidateConfidence?: number
  detectorLastObjectiveCandidateAngleDeg?: number
  detectorLastThreatCount?: number
  detectorLastError?: string
  lastError?: string
}

export type GameHumanInputRuntimeSummary = {
  status: 'starting' | 'active' | 'stopped' | 'degraded'
  backend: 'windows_raw_input'
  sampleHz: number
  processId?: number
  episodeId: string
  rawSampleCount: number
  alignedActionCount: number
  skippedUnalignedSampleCount: number
  focusLossCount: number
  targetFocused?: boolean
  lastSampleAt?: string
  rawEventsPath: string
  actionsPath: string
  clockSyncPath: string
  lastError?: string
}

export type GameTrackedTarget = GameTargetObservation & {
  firstSeenAt: number
  lastSeenAt: number
  velocityX: number
  velocityY: number
  predictedX: number
  predictedY: number
}

export type GameWorldState = {
  updatedAt: number
  lastObservationAt: number
  frameId?: number
  viewport: { width: number; height: number }
  phase: GamePhase
  ammo?: { current: number; reserve?: number; capacity?: number }
  economy?: number
  health?: number
  safeToInteract: boolean
  objectiveArrow?: { angleDeg: number; confidence: number }
  motionScore?: number
  motionGrid?: GameObservation['motionGrid']
  frameMetrics?: GameObservation['frameMetrics']
  targets: GameTrackedTarget[]
  selectedTargetId?: string
  targetLockSince?: number
  threats: GameThreatObservation[]
  lastIntent?: GameTacticalIntent
}

export type GameTacticalIntentKind =
  | 'idle'
  | 'navigate'
  | 'engage'
  | 'evade'
  | 'reload'
  | 'resupply'
  | 'upgrade_attack'
  | 'search'

export type GameTacticalIntent = {
  kind: GameTacticalIntentKind
  priority: number
  reason: string
  targetId?: string
  createdAt: number
}

export type GameControlPlan = {
  intent: GameTacticalIntent
  desiredKeys: string[]
  tapKeys: string[]
  mouseDelta?: { x: number; y: number }
  fire: boolean
  leaseMs: number
}

export type GameMenuAction =
  | {
      type: 'click' | 'double_click'
      xRatio: number
      yRatio: number
      delayAfterMs?: number
    }
  | {
      type: 'press_key'
      key: string
      delayAfterMs?: number
    }
  | {
      type: 'wait'
      durationMs: number
    }

export type GameProfile = {
  schemaVersion: 1
  id: string
  displayName: string
  game: string
  window: {
    titlePatterns: string[]
    processNames: string[]
  }
  capture: {
    backend:
      | 'windows_graphics_capture'
      | 'windows_gdi_fallback'
      | 'external_native'
    fps: number
    ringBufferSeconds: number
    recordFrames: boolean
    datasetSampleFps: number
  }
  policy: {
    decisionHz: number
    controlHz: number
    observationTimeoutMs: number
    actionLeaseMs: number
    targetHoldMs: number
    targetStaleMs: number
    aimPredictionMs: number
    aimGain: number
    maxMouseDelta: number
    fireErrorPixels: number
    ammoLowThreshold: number
    healthEvadeThreshold: number
    attackUpgradeEconomy: number
  }
  menuFlows: Record<string, GameMenuAction[]>
  routeGraph: {
    nodes: Array<{
      id: string
      kind: 'objective' | 'ammo' | 'attack_upgrade' | 'safe' | 'waypoint'
      label?: string
      metadata?: Record<string, unknown>
    }>
    edges: Array<{
      from: string
      to: string
      bidirectional?: boolean
      metadata?: Record<string, unknown>
    }>
  }
}

export type GameSessionStatus =
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'failed'

export type GameRuntimeSummary = {
  sessionId: string
  status: GameSessionStatus
  controlMode: ActiveGameModelMode
  objective: string
  profileId: string
  hwnd?: string
  startedAt: string
  updatedAt: string
  stoppedAt?: string
  observationCount: number
  decisionCount: number
  lastObservationAgeMs?: number
  inputLeaseExpiresAt?: string
  world: GameWorldState
  currentIntent?: GameTacticalIntent
  perception: GamePerceptionRuntimeSummary
  demonstration?: GameHumanInputRuntimeSummary
  sessionDir: string
  warnings: string[]
}

export type GameReplayEvaluation = {
  replayPath: string
  profileId: string
  sampleCount: number
  trustedSampleCount: number
  legacyUnverifiedSampleCount: number
  invalidProvenanceSampleCount: number
  adapterCounts: Record<string, number>
  durationMs: number
  staleGapCount: number
  phaseCounts: Record<string, number>
  intentCounts: Record<string, number>
  targetObservationCount: number
  selectedTargetCount: number
  averageAimErrorPixels?: number
  generatedAt: string
}
