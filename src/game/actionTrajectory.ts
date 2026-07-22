import type { GameControlPlan } from './types.js'

export const GAME_ACTION_VECTOR_FIELDS = [
  'move_forward',
  'move_left',
  'move_backward',
  'move_right',
  'mouse_dx',
  'mouse_dy',
  'fire',
  'aim',
  'reload',
  'interact',
  'jump',
  'sprint',
] as const

export type GameActionSource = 'human' | 'policy' | 'pseudo'

export type GameActionTrajectorySample = {
  schema_version: 1
  session_id: string
  episode_id: string
  timestamp_ns: string
  frame_sequence: number
  delta_seconds: number
  source: GameActionSource
  move_forward: number
  move_left: number
  move_backward: number
  move_right: number
  mouse_dx: number
  mouse_dy: number
  fire: number
  aim: number
  reload: number
  interact: number
  jump: number
  sprint: number
  takeover: boolean
}

export type HumanGameActionInput = {
  timestampNs: string
  focused: boolean
  moveForward: boolean
  moveLeft: boolean
  moveBackward: boolean
  moveRight: boolean
  mouseDx: number
  mouseDy: number
  fire: boolean
  aim: boolean
  reload: boolean
  interact: boolean
  jump: boolean
  sprint: boolean
}

export function controlPlanToActionSample(input: {
  sessionId: string
  episodeId: string
  timestampMs: number
  frameSequence: number
  deltaSeconds: number
  source: GameActionSource
  plan: GameControlPlan
  maxMouseDelta: number
  takeover?: boolean
}): GameActionTrajectorySample {
  if (!input.sessionId || !input.episodeId) {
    throw new Error('Action trajectory samples require session and episode IDs.')
  }
  if (!Number.isFinite(input.timestampMs) || input.timestampMs <= 0) {
    throw new Error('Action trajectory timestamp must be positive.')
  }
  if (!Number.isInteger(input.frameSequence) || input.frameSequence < 0) {
    throw new Error('Action trajectory frame sequence must be non-negative.')
  }
  const desired = normalizedKeys(input.plan.desiredKeys)
  const tapped = normalizedKeys(input.plan.tapKeys)
  const maxMouseDelta = Math.max(1, Math.abs(input.maxMouseDelta))
  const timestampMs = BigInt(Math.round(input.timestampMs))
  return {
    schema_version: 1,
    session_id: input.sessionId,
    episode_id: input.episodeId,
    timestamp_ns: (timestampMs * 1_000_000n).toString(),
    frame_sequence: input.frameSequence,
    delta_seconds: clamp(input.deltaSeconds, 0.001, 1),
    source: input.source,
    move_forward: keyState(desired, 'W'),
    move_left: keyState(desired, 'A'),
    move_backward: keyState(desired, 'S'),
    move_right: keyState(desired, 'D'),
    mouse_dx: clamp((input.plan.mouseDelta?.x ?? 0) / maxMouseDelta, -1, 1),
    mouse_dy: clamp((input.plan.mouseDelta?.y ?? 0) / maxMouseDelta, -1, 1),
    fire: input.plan.fire ? 1 : 0,
    aim: keyState(desired, 'MOUSE2'),
    reload: keyState(tapped, 'R'),
    interact: keyState(tapped, 'E'),
    jump: keyState(tapped, 'SPACE'),
    sprint: Math.max(keyState(desired, 'SHIFT'), keyState(tapped, 'SHIFT')),
    takeover: input.takeover ?? false,
  }
}

export function humanInputToActionSample(input: {
  sessionId: string
  episodeId: string
  frameSequence: number
  deltaSeconds: number
  sample: HumanGameActionInput
  maxMouseDelta: number
}): GameActionTrajectorySample {
  validateActionIdentity(input.sessionId, input.episodeId, input.frameSequence)
  if (!/^\d+$/.test(input.sample.timestampNs) || BigInt(input.sample.timestampNs) <= 0n) {
    throw new Error('Human action timestamp must be a positive integer string.')
  }
  const maxMouseDelta = Math.max(1, Math.abs(input.maxMouseDelta))
  const active = input.sample.focused
  return {
    schema_version: 1,
    session_id: input.sessionId,
    episode_id: input.episodeId,
    timestamp_ns: input.sample.timestampNs,
    frame_sequence: input.frameSequence,
    delta_seconds: clamp(input.deltaSeconds, 0.001, 1),
    source: 'human',
    move_forward: active && input.sample.moveForward ? 1 : 0,
    move_left: active && input.sample.moveLeft ? 1 : 0,
    move_backward: active && input.sample.moveBackward ? 1 : 0,
    move_right: active && input.sample.moveRight ? 1 : 0,
    mouse_dx: active ? clamp(input.sample.mouseDx / maxMouseDelta, -1, 1) : 0,
    mouse_dy: active ? clamp(input.sample.mouseDy / maxMouseDelta, -1, 1) : 0,
    fire: active && input.sample.fire ? 1 : 0,
    aim: active && input.sample.aim ? 1 : 0,
    reload: active && input.sample.reload ? 1 : 0,
    interact: active && input.sample.interact ? 1 : 0,
    jump: active && input.sample.jump ? 1 : 0,
    sprint: active && input.sample.sprint ? 1 : 0,
    takeover: !active,
  }
}

function normalizedKeys(keys: string[]): Set<string> {
  return new Set(keys.map(key => key.trim().toUpperCase()).filter(Boolean))
}

function validateActionIdentity(
  sessionId: string,
  episodeId: string,
  frameSequence: number,
): void {
  if (!sessionId || !episodeId) {
    throw new Error('Action trajectory samples require session and episode IDs.')
  }
  if (!Number.isInteger(frameSequence) || frameSequence < 0) {
    throw new Error('Action trajectory frame sequence must be non-negative.')
  }
}

function keyState(keys: Set<string>, key: string): number {
  return keys.has(key) ? 1 : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(minimum, Math.min(maximum, value))
}
