import type {
  GameControlPlan,
  GameProfile,
  GameTacticalIntent,
  GameWorldState,
} from './types.js'

export function decideGameIntent(
  world: GameWorldState,
  profile: GameProfile,
  now = Date.now(),
): GameTacticalIntent {
  if (
    world.lastObservationAt === 0 ||
    now - world.lastObservationAt > profile.policy.observationTimeoutMs
  ) {
    return intent('idle', 100, 'Perception is stale; release all controls.', now)
  }

  if (world.phase !== 'combat') {
    return intent('idle', 90, `Game phase is ${world.phase}.`, now)
  }

  const imminentThreat = world.threats.find(
    threat => threat.attackImminent && threat.confidence >= 0.55,
  )
  if (
    imminentThreat ||
    (world.health !== undefined &&
      world.health <= profile.policy.healthEvadeThreshold)
  ) {
    return intent('evade', 95, 'An imminent attack or low health requires evasion.', now)
  }

  if (world.ammo?.current === 0 && (world.ammo.reserve ?? 0) > 0) {
    return intent('reload', 88, 'The active magazine is empty.', now)
  }

  if (
    world.ammo !== undefined &&
    world.ammo.current <= profile.policy.ammoLowThreshold &&
    (world.ammo.reserve ?? 0) <= profile.policy.ammoLowThreshold
  ) {
    return intent('resupply', 82, 'Ammunition is below the reserve threshold.', now)
  }

  if (
    world.safeToInteract &&
    world.economy !== undefined &&
    world.economy >= profile.policy.attackUpgradeEconomy
  ) {
    return intent(
      'upgrade_attack',
      72,
      'Economy threshold reached during a safe interaction window.',
      now,
    )
  }

  const selectedTarget = world.targets.find(
    target => target.id === world.selectedTargetId,
  )
  if (selectedTarget) {
    return {
      ...intent('engage', 70, 'A locked target is available.', now),
      targetId: selectedTarget.id,
    }
  }

  if ((world.objectiveArrow?.confidence ?? 0) >= 0.55) {
    return intent('navigate', 55, 'Follow the current objective arrow.', now)
  }

  return intent('search', 30, 'No target or reliable objective is visible.', now)
}

export function createGameControlPlan(
  world: GameWorldState,
  profile: GameProfile,
  gameIntent: GameTacticalIntent,
): GameControlPlan {
  const plan: GameControlPlan = {
    intent: gameIntent,
    desiredKeys: [],
    tapKeys: [],
    fire: false,
    leaseMs: profile.policy.actionLeaseMs,
  }

  switch (gameIntent.kind) {
    case 'navigate': {
      const angle = world.objectiveArrow?.angleDeg ?? 0
      return {
        ...plan,
        desiredKeys: ['W'],
        mouseDelta: {
          x: clamp(
            angle * profile.policy.aimGain,
            -profile.policy.maxMouseDelta,
            profile.policy.maxMouseDelta,
          ),
          y: 0,
        },
      }
    }
    case 'engage': {
      const target = world.targets.find(target => target.id === gameIntent.targetId)
      if (!target) return plan
      const errorX = target.predictedX - world.viewport.width / 2
      const errorY = target.predictedY - world.viewport.height / 2
      const aimError = Math.hypot(errorX, errorY)
      return {
        ...plan,
        mouseDelta: {
          x: clamp(
            errorX * profile.policy.aimGain,
            -profile.policy.maxMouseDelta,
            profile.policy.maxMouseDelta,
          ),
          y: clamp(
            errorY * profile.policy.aimGain,
            -profile.policy.maxMouseDelta,
            profile.policy.maxMouseDelta,
          ),
        },
        fire:
          aimError <= profile.policy.fireErrorPixels &&
          (world.ammo?.current ?? 1) > 0,
      }
    }
    case 'evade': {
      const threat = world.threats.find(item => item.attackImminent)
      const evadeKey = threat?.direction === 'left' ? 'D' : 'A'
      return { ...plan, desiredKeys: [evadeKey], tapKeys: ['Space'] }
    }
    case 'reload':
      return { ...plan, tapKeys: ['R'] }
    default:
      return plan
  }
}

function intent(
  kind: GameTacticalIntent['kind'],
  priority: number,
  reason: string,
  createdAt: number,
): GameTacticalIntent {
  return { kind, priority, reason, createdAt }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
