import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod/v4'

export const GAME_ROI_KINDS = [
  'full_viewport',
  'menu_view',
  'combat_view',
  'center_reticle',
  'phase_indicator',
  'hud_ammo',
  'hud_economy',
  'hud_health',
  'hud_interaction',
  'objective_arrow',
  'minimap',
  'target_search_area',
  'threat_search_area',
] as const

export const normalizedRectSchema = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .superRefine((rect, context) => {
    if (rect.x + rect.width > 1 + Number.EPSILON) {
      context.addIssue({
        code: 'custom',
        message: 'ROI x + width must not exceed 1.',
        path: ['width'],
      })
    }
    if (rect.y + rect.height > 1 + Number.EPSILON) {
      context.addIssue({
        code: 'custom',
        message: 'ROI y + height must not exceed 1.',
        path: ['height'],
      })
    }
  })

export const gameRoiRegionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/),
  kind: z.enum(GAME_ROI_KINDS),
  label: z.string().min(1).max(120).optional(),
  rect: normalizedRectSchema,
  enabled: z.boolean().default(true),
})

const calibrationManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  calibrationId: z.string().regex(/^cal_[a-f0-9]{20}$/),
  revision: z.number().int().positive(),
  profileId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  windowViewport: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  referenceImage: z.strictObject({
    path: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  regions: z.array(gameRoiRegionSchema).min(1).max(64),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export type GameNormalizedRect = z.infer<typeof normalizedRectSchema>
export type GameRoiRegion = z.infer<typeof gameRoiRegionSchema>
export type GameCalibrationManifest = z.infer<
  typeof calibrationManifestSchema
>

export function getDefaultGameCalibrationPath(
  cwd: string,
  profileId: string,
): string {
  return resolve(
    cwd,
    '.leviathan',
    'gamemodel',
    'calibrations',
    `${safePathSegment(profileId)}.json`,
  )
}

export async function loadGameCalibration(input: {
  cwd: string
  profileId: string
  calibrationPath?: string
}): Promise<{ path: string; calibration: GameCalibrationManifest }> {
  const path = resolveCalibrationPath(input)
  const calibration = calibrationManifestSchema.parse(
    JSON.parse(await readFile(path, 'utf8')),
  )
  if (calibration.profileId !== input.profileId) {
    throw new Error(
      `Calibration belongs to ${calibration.profileId}, not ${input.profileId}.`,
    )
  }
  return { path, calibration }
}

export async function saveGameCalibration(input: {
  cwd: string
  profileId: string
  calibrationPath?: string
  referenceImage: Buffer
  windowViewport: { width: number; height: number }
  regions: GameRoiRegion[]
}): Promise<{ path: string; calibration: GameCalibrationManifest }> {
  const path = resolveCalibrationPath(input)
  const regions = z.array(gameRoiRegionSchema).min(1).max(64).parse(input.regions)
  assertUniqueRegionIds(regions)
  const viewport = z
    .strictObject({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .parse(input.windowViewport)
  const imageMetadata = await sharp(input.referenceImage).metadata()
  if (!imageMetadata.width || !imageMetadata.height) {
    throw new Error('Calibration reference image dimensions could not be read.')
  }
  const previous = await loadExistingCalibration(path, input.profileId)
  const now = new Date().toISOString()
  const referencePath = join(
    dirname(path),
    `${safePathSegment(input.profileId)}.reference.png`,
  )
  const referenceImageSha256 = sha256(input.referenceImage)
  const sortedRegions = [...regions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
  const content = {
    profileId: input.profileId,
    windowViewport: viewport,
    referenceImageSha256,
    regions: sortedRegions,
  }
  const contentSha256 = sha256(JSON.stringify(content))
  const calibration: GameCalibrationManifest = calibrationManifestSchema.parse({
    schemaVersion: 1,
    calibrationId: `cal_${contentSha256.slice(0, 20)}`,
    revision: (previous?.revision ?? 0) + 1,
    profileId: input.profileId,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    windowViewport: viewport,
    referenceImage: {
      path: relative(dirname(path), referencePath).replaceAll('\\', '/'),
      width: imageMetadata.width,
      height: imageMetadata.height,
      sha256: referenceImageSha256,
    },
    regions: sortedRegions,
    contentSha256,
  })

  await mkdir(dirname(path), { recursive: true })
  await writeFile(referencePath, input.referenceImage)
  await writeJsonAtomic(path, calibration)
  return { path, calibration }
}

export function resolveCalibrationReferenceImage(
  calibrationPath: string,
  calibration: GameCalibrationManifest,
): string {
  const root = dirname(resolve(calibrationPath))
  const imagePath = resolve(root, calibration.referenceImage.path)
  const relation = relative(root, imagePath)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Calibration reference image resolves outside its directory.')
  }
  return imagePath
}

function resolveCalibrationPath(input: {
  cwd: string
  profileId: string
  calibrationPath?: string
}): string {
  if (!input.calibrationPath) {
    return getDefaultGameCalibrationPath(input.cwd, input.profileId)
  }
  return isAbsolute(input.calibrationPath)
    ? resolve(input.calibrationPath)
    : resolve(input.cwd, input.calibrationPath)
}

async function loadExistingCalibration(
  path: string,
  profileId: string,
): Promise<GameCalibrationManifest | undefined> {
  try {
    const parsed = calibrationManifestSchema.parse(
      JSON.parse(await readFile(path, 'utf8')),
    )
    if (parsed.profileId !== profileId) {
      throw new Error(
        `Existing calibration belongs to ${parsed.profileId}, not ${profileId}.`,
      )
    }
    return parsed
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

function assertUniqueRegionIds(regions: GameRoiRegion[]): void {
  const ids = new Set<string>()
  for (const region of regions) {
    if (ids.has(region.id)) {
      throw new Error(`Duplicate calibration ROI id: ${region.id}`)
    }
    ids.add(region.id)
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

function safePathSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_')
  if (!normalized) throw new Error('Profile id cannot be converted to a path.')
  return normalized
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
