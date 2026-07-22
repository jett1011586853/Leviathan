import type {
  GameObservation,
  GameProfile,
  GameTargetObservation,
  GameTrackedTarget,
  GameWorldState,
} from './types.js'

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 }

export function createInitialGameWorldState(now = Date.now()): GameWorldState {
  return {
    updatedAt: now,
    lastObservationAt: 0,
    viewport: DEFAULT_VIEWPORT,
    phase: 'unknown',
    safeToInteract: false,
    targets: [],
    threats: [],
  }
}

export function applyGameObservation(
  previous: GameWorldState,
  observation: GameObservation,
  profile: GameProfile,
): GameWorldState {
  const timestamp = normalizeTimestamp(observation.timestamp)
  const targets = updateTargets(
    previous.targets,
    observation.targets,
    timestamp,
    profile.policy.targetStaleMs,
    profile.policy.aimPredictionMs,
  )
  const selected = selectTarget(previous, targets, timestamp, profile)

  return {
    ...previous,
    updatedAt: timestamp,
    lastObservationAt: timestamp,
    frameId: observation.frameId ?? previous.frameId,
    viewport: observation.viewport ?? previous.viewport,
    phase: observation.phase ?? previous.phase,
    ammo: observation.ammo ?? previous.ammo,
    economy: observation.economy ?? previous.economy,
    health: observation.health ?? previous.health,
    safeToInteract:
      observation.safeToInteract ?? previous.safeToInteract,
    objectiveArrow: observation.objectiveArrow ?? previous.objectiveArrow,
    motionScore: observation.motionScore ?? previous.motionScore,
    motionGrid: observation.motionGrid ?? previous.motionGrid,
    frameMetrics: observation.frameMetrics ?? previous.frameMetrics,
    targets,
    selectedTargetId: selected.id,
    targetLockSince: selected.lockSince,
    threats: observation.threats ?? previous.threats,
  }
}

function updateTargets(
  previousTargets: GameTrackedTarget[],
  observations: GameTargetObservation[] | undefined,
  timestamp: number,
  staleMs: number,
  predictionMs: number,
): GameTrackedTarget[] {
  const previousById = new Map(previousTargets.map(target => [target.id, target]))
  const nextById = new Map<string, GameTrackedTarget>()

  for (const observation of observations ?? []) {
    if (!isFiniteTarget(observation)) continue
    const previous = previousById.get(observation.id)
    const elapsedMs = Math.max(1, timestamp - (previous?.lastSeenAt ?? timestamp))
    const measuredVelocityX = previous
      ? ((observation.screenX - previous.screenX) / elapsedMs) * 1000
      : 0
    const measuredVelocityY = previous
      ? ((observation.screenY - previous.screenY) / elapsedMs) * 1000
      : 0
    const velocityX = blendVelocity(previous?.velocityX, measuredVelocityX)
    const velocityY = blendVelocity(previous?.velocityY, measuredVelocityY)
    const predictionSeconds = predictionMs / 1000

    nextById.set(observation.id, {
      ...observation,
      firstSeenAt: previous?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      velocityX,
      velocityY,
      predictedX: preferredAimX(observation) + velocityX * predictionSeconds,
      predictedY: preferredAimY(observation) + velocityY * predictionSeconds,
    })
  }

  for (const previous of previousTargets) {
    if (nextById.has(previous.id)) continue
    if (timestamp - previous.lastSeenAt > staleMs) continue
    const elapsedSeconds = (timestamp - previous.lastSeenAt) / 1000
    nextById.set(previous.id, {
      ...previous,
      predictedX: previous.predictedX + previous.velocityX * elapsedSeconds,
      predictedY: previous.predictedY + previous.velocityY * elapsedSeconds,
    })
  }

  return [...nextById.values()].sort(
    (left, right) => targetScore(right) - targetScore(left),
  )
}

function selectTarget(
  previous: GameWorldState,
  targets: GameTrackedTarget[],
  timestamp: number,
  profile: GameProfile,
): { id?: string; lockSince?: number } {
  const previousTarget = targets.find(
    target => target.id === previous.selectedTargetId,
  )
  const previousLockSince = previous.targetLockSince ?? timestamp
  if (
    previousTarget &&
    timestamp - previousLockSince < profile.policy.targetHoldMs
  ) {
    return { id: previousTarget.id, lockSince: previousLockSince }
  }

  const viewport = previous.viewport
  const centerX = viewport.width / 2
  const centerY = viewport.height / 2
  const best = [...targets].sort((left, right) => {
    const leftDistance = Math.hypot(
      left.predictedX - centerX,
      left.predictedY - centerY,
    )
    const rightDistance = Math.hypot(
      right.predictedX - centerX,
      right.predictedY - centerY,
    )
    return targetScore(right) - rightDistance / 1000 - (targetScore(left) - leftDistance / 1000)
  })[0]

  if (!best) return {}
  if (best.id === previous.selectedTargetId) {
    return { id: best.id, lockSince: previousLockSince }
  }
  return { id: best.id, lockSince: timestamp }
}

function normalizeTimestamp(timestamp: number | undefined): number {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return Date.now()
  return Math.max(0, Math.round(timestamp))
}

function isFiniteTarget(target: GameTargetObservation): boolean {
  return (
    Boolean(target.id) &&
    Number.isFinite(target.confidence) &&
    Number.isFinite(target.screenX) &&
    Number.isFinite(target.screenY)
  )
}

function blendVelocity(previous: number | undefined, measured: number): number {
  if (previous === undefined) return measured
  return previous * 0.65 + measured * 0.35
}

function preferredAimX(target: GameTargetObservation): number {
  return target.weakPointX ?? target.screenX
}

function preferredAimY(target: GameTargetObservation): number {
  return target.weakPointY ?? target.screenY
}

function targetScore(target: GameTargetObservation): number {
  return target.confidence * 0.65 + (target.threat ?? 0.5) * 0.35
}
