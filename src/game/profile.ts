import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod/v4'
import type { GameMenuAction, GameProfile } from './types.js'

const menuActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.enum(['click', 'double_click']),
    xRatio: z.number().min(0).max(1),
    yRatio: z.number().min(0).max(1),
    delayAfterMs: z.number().int().min(0).max(30_000).optional(),
  }),
  z.strictObject({
    type: z.literal('press_key'),
    key: z.string().min(1).max(80),
    delayAfterMs: z.number().int().min(0).max(30_000).optional(),
  }),
  z.strictObject({
    type: z.literal('wait'),
    durationMs: z.number().int().min(0).max(30_000),
  }),
])

const captureSchema = z.strictObject({
  backend: z.enum([
    'windows_graphics_capture',
    'windows_gdi_fallback',
    'external_native',
  ]),
  fps: z.number().int().min(1).max(120),
  ringBufferSeconds: z.number().min(1).max(30),
  recordFrames: z.boolean(),
  datasetSampleFps: z.number().int().min(0).max(30).default(2),
})

const profileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  displayName: z.string().min(1),
  game: z.string().min(1),
  window: z.strictObject({
    titlePatterns: z.array(z.string()),
    processNames: z.array(z.string()),
  }),
  capture: captureSchema,
  policy: z.strictObject({
    decisionHz: z.number().min(1).max(30),
    controlHz: z.number().min(1).max(120),
    observationTimeoutMs: z.number().int().min(50).max(10_000),
    actionLeaseMs: z.number().int().min(20).max(2_000),
    targetHoldMs: z.number().int().min(0).max(10_000),
    targetStaleMs: z.number().int().min(20).max(10_000),
    aimPredictionMs: z.number().int().min(0).max(1_000),
    aimGain: z.number().min(0).max(10),
    maxMouseDelta: z.number().int().min(1).max(1_000),
    fireErrorPixels: z.number().min(1).max(1_000),
    ammoLowThreshold: z.number().int().min(0).max(10_000),
    healthEvadeThreshold: z.number().min(0).max(100),
    attackUpgradeEconomy: z.number().min(0),
  }),
  menuFlows: z.record(z.string(), z.array(menuActionSchema).max(40)),
  routeGraph: z.strictObject({
    nodes: z.array(
      z.strictObject({
        id: z.string().min(1),
        kind: z.enum([
          'objective',
          'ammo',
          'attack_upgrade',
          'safe',
          'waypoint',
        ]),
        label: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
    edges: z.array(
      z.strictObject({
        from: z.string().min(1),
        to: z.string().min(1),
        bidirectional: z.boolean().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  }),
})

export const DEFAULT_NZM_GAME_PROFILE: GameProfile = {
  schemaVersion: 1,
  id: 'com.leviathan.game.nzm-future',
  displayName: '\u9006\u6218\u672a\u6765',
  game: 'nzm-future',
  window: {
    titlePatterns: ['\u9006\u6218\u672a\u6765'],
    processNames: ['NZMClient'],
  },
  capture: {
    backend: 'windows_graphics_capture',
    fps: 60,
    ringBufferSeconds: 5,
    recordFrames: false,
    datasetSampleFps: 2,
  },
  policy: {
    decisionHz: 10,
    controlHz: 60,
    observationTimeoutMs: 350,
    actionLeaseMs: 180,
    targetHoldMs: 650,
    targetStaleMs: 450,
    aimPredictionMs: 80,
    aimGain: 0.3,
    maxMouseDelta: 80,
    fireErrorPixels: 24,
    ammoLowThreshold: 8,
    healthEvadeThreshold: 35,
    attackUpgradeEconomy: 1000,
  },
  menuFlows: {
    select_map: [],
    select_difficulty: [],
    start_matchmaking: [],
    exit_settlement: [],
  },
  routeGraph: {
    nodes: [],
    edges: [],
  },
}

export function getDefaultGameProfilePath(cwd: string): string {
  return resolve(cwd, '.leviathan', 'gamemodel', 'profiles', 'nzm-future.json')
}

export async function ensureGameProfile(
  cwd: string,
  profilePath?: string,
): Promise<{ path: string; profile: GameProfile; created: boolean }> {
  const path = resolveProfilePath(cwd, profilePath)
  try {
    return { path, profile: await loadGameProfile(cwd, path), created: false }
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }

  await writeGameProfile(path, DEFAULT_NZM_GAME_PROFILE)
  return { path, profile: DEFAULT_NZM_GAME_PROFILE, created: true }
}

export async function loadGameProfile(
  cwd: string,
  profilePath?: string,
): Promise<GameProfile> {
  const path = resolveProfilePath(cwd, profilePath)
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  return migrateGameProfile(profileSchema.parse(parsed) as GameProfile)
}

export async function saveGameMenuFlow(input: {
  cwd: string
  profilePath?: string
  flowName: string
  actions: GameMenuAction[]
}): Promise<{ path: string; profile: GameProfile }> {
  const ensured = await ensureGameProfile(input.cwd, input.profilePath)
  const actions = z.array(menuActionSchema).max(40).parse(input.actions)
  const profile: GameProfile = {
    ...ensured.profile,
    menuFlows: {
      ...ensured.profile.menuFlows,
      [normalizeFlowName(input.flowName)]: actions,
    },
  }
  await writeGameProfile(ensured.path, profile)
  return { path: ensured.path, profile }
}

export async function saveGameCaptureConfig(input: {
  cwd: string
  profilePath?: string
  backend?: GameProfile['capture']['backend']
  fps?: number
  recordFrames?: boolean
  datasetSampleFps?: number
}): Promise<{ path: string; profile: GameProfile }> {
  const ensured = await ensureGameProfile(input.cwd, input.profilePath)
  const capture = captureSchema.parse({
    ...ensured.profile.capture,
    backend: input.backend ?? ensured.profile.capture.backend,
    fps: input.fps ?? ensured.profile.capture.fps,
    recordFrames: input.recordFrames ?? ensured.profile.capture.recordFrames,
    datasetSampleFps:
      input.datasetSampleFps ?? ensured.profile.capture.datasetSampleFps,
  })
  const profile: GameProfile = { ...ensured.profile, capture }
  await writeGameProfile(ensured.path, profile)
  return { path: ensured.path, profile }
}

function resolveProfilePath(cwd: string, profilePath?: string): string {
  if (!profilePath) return getDefaultGameProfilePath(cwd)
  return isAbsolute(profilePath) ? profilePath : resolve(cwd, profilePath)
}

async function writeGameProfile(
  path: string,
  profile: GameProfile,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
}

function normalizeFlowName(flowName: string): string {
  const normalized = flowName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
  if (!normalized) throw new Error('Game menu flow name is required.')
  return normalized
}

function migrateGameProfile(profile: GameProfile): GameProfile {
  if (profile.id !== DEFAULT_NZM_GAME_PROFILE.id) return profile
  const processNames = new Set(
    profile.window.processNames.map((processName) => processName.toLowerCase()),
  )
  if (processNames.has('nzmclient')) return profile
  return {
    ...profile,
    window: {
      ...profile.window,
      processNames: [...profile.window.processNames, 'NZMClient'],
    },
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
