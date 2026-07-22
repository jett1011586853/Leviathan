import { createHash } from 'node:crypto'
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import sharp from 'sharp'
import { z } from 'zod/v4'
import {
  loadGameCalibration,
  normalizedRectSchema,
  resolveCalibrationReferenceImage,
  type GameCalibrationManifest,
  type GameNormalizedRect,
} from './calibration.js'
import { GAME_PHASES } from './types.js'

export const GAME_DATASET_SPLITS = ['train', 'validation', 'test'] as const
export const GAME_ANNOTATION_STATUSES = [
  'unlabeled',
  'annotated',
  'reviewed',
  'rejected',
] as const
export const GAME_OBJECT_CATEGORIES = [
  'enemy',
  'weak_point',
  'threat',
  'objective_marker',
  'ammo_station',
  'attack_upgrade_station',
  'interactable',
] as const
export const GAME_POINT_CATEGORIES = [
  'reticle',
  'objective_arrow_tip',
  'weak_point',
  'interaction_anchor',
] as const

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const gameObjectBoxSchema = z.strictObject({
  category: z.enum(GAME_OBJECT_CATEGORIES),
  rect: normalizedRectSchema,
  trackId: z.string().min(1).max(100).optional(),
  occluded: z.boolean().default(false),
  truncated: z.boolean().default(false),
})

export const gamePointLabelSchema = z.strictObject({
  category: z.enum(GAME_POINT_CATEGORIES),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

export const gameFrameLabelsSchema = z.strictObject({
  phase: z.enum(GAME_PHASES).optional(),
  ammo: z
    .strictObject({
      current: z.number().int().nonnegative(),
      reserve: z.number().int().nonnegative().optional(),
    })
    .optional(),
  economy: z.number().nonnegative().optional(),
  health: z.number().min(0).max(100).optional(),
  safeToInteract: z.boolean().optional(),
  objectiveArrow: z
    .strictObject({
      angleDeg: z.number().min(-180).max(180),
    })
    .optional(),
  boxes: z.array(gameObjectBoxSchema).max(256).optional(),
  points: z.array(gamePointLabelSchema).max(256).optional(),
})

export const gameFrameIndexEntrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  sequence: z.number().int().positive(),
  capturedAt: z.number().int().positive(),
  frameId: z.number().int().nonnegative(),
  frameSha256: sha256Schema.optional(),
  imagePath: z.string().min(1),
  imageSha256: sha256Schema,
  viewport: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  motionScore: z.number().min(0).max(1),
  frameMetrics: z
    .strictObject({
      meanLuma: z.number().min(0).max(1),
      lumaStdDev: z.number().min(0).max(1),
      blackFrameProbability: z.number().min(0).max(1),
      measuredFps: z.number().nonnegative().max(240),
      processingMs: z.number().nonnegative().max(60_000),
    })
    .optional(),
})

const datasetSampleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sampleId: z.string().regex(/^sample_[a-f0-9]{24}$/),
  datasetId: z.string().regex(/^dataset_[a-f0-9]{20}$/),
  split: z.enum(GAME_DATASET_SPLITS),
  imagePath: z.string().min(1),
  imageSha256: sha256Schema,
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  calibrationId: z.string().regex(/^cal_[a-f0-9]{20}$/),
  source: z.strictObject({
    sessionId: z.string().min(1),
    sequence: z.number().int().positive(),
    capturedAt: z.number().int().positive(),
    frameSha256: sha256Schema.optional(),
    windowViewport: z.strictObject({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    motionScore: z.number().min(0).max(1),
    blackFrameProbability: z.number().min(0).max(1).optional(),
  }),
})

const annotationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sampleId: z.string().regex(/^sample_[a-f0-9]{24}$/),
  calibrationId: z.string().regex(/^cal_[a-f0-9]{20}$/),
  status: z.enum(GAME_ANNOTATION_STATUSES),
  revision: z.number().int().nonnegative(),
  source: z.enum(['manual', 'model', 'imported']).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  labels: gameFrameLabelsSchema.optional(),
})

const datasetManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  datasetId: z.string().regex(/^dataset_[a-f0-9]{20}$/),
  profileId: z.string().min(1),
  calibrationId: z.string().regex(/^cal_[a-f0-9]{20}$/),
  calibrationPath: z.string().min(1),
  sourceSessionId: z.string().min(1),
  sourceSessionPath: z.string().min(1),
  createdAt: z.string().datetime(),
  selection: z.strictObject({
    maxSamples: z.number().int().positive(),
    minimumMotionScore: z.number().min(0).max(1),
    includeBlackFrames: z.boolean(),
  }),
  sampleCount: z.number().int().nonnegative(),
  splitCounts: z.record(z.enum(GAME_DATASET_SPLITS), z.number().int().nonnegative()),
  skippedCounts: z.strictObject({
    duplicate: z.number().int().nonnegative(),
    lowMotion: z.number().int().nonnegative(),
    blackFrame: z.number().int().nonnegative(),
  }),
  annotationStatusCounts: z.record(
    z.enum(GAME_ANNOTATION_STATUSES),
    z.number().int().nonnegative(),
  ),
  samplesSha256: sha256Schema,
  annotationsSha256: sha256Schema,
})

export type GameObjectBox = z.infer<typeof gameObjectBoxSchema>
export type GamePointLabel = z.infer<typeof gamePointLabelSchema>
export type GameFrameLabels = z.infer<typeof gameFrameLabelsSchema>
export type GameFrameIndexEntry = z.infer<typeof gameFrameIndexEntrySchema>
export type GameDatasetSample = z.infer<typeof datasetSampleSchema>
export type GameFrameAnnotation = z.infer<typeof annotationSchema>
export type GameDatasetManifest = z.infer<typeof datasetManifestSchema>

export type GameDatasetBuildResult = {
  datasetPath: string
  manifest: GameDatasetManifest
}

export async function buildGameDataset(input: {
  cwd: string
  sessionPath: string
  profileId: string
  calibrationPath?: string
  outputPath?: string
  maxSamples?: number
  minimumMotionScore?: number
  includeBlackFrames?: boolean
}): Promise<GameDatasetBuildResult> {
  const sessionPath = resolveFromCwd(input.cwd, input.sessionPath)
  const sessionSummary = JSON.parse(
    await readFile(join(sessionPath, 'session.json'), 'utf8'),
  ) as { sessionId?: unknown; profileId?: unknown }
  const sessionId = z.string().min(1).parse(sessionSummary.sessionId)
  const profileId = z.string().min(1).parse(sessionSummary.profileId)
  if (profileId !== input.profileId) {
    throw new Error(`Session profile ${profileId} does not match ${input.profileId}.`)
  }
  const calibrationResult = await loadGameCalibration({
    cwd: input.cwd,
    profileId,
    calibrationPath: input.calibrationPath,
  })
  const calibrationReferencePath = await verifyCalibrationReference(
    calibrationResult.path,
    calibrationResult.calibration,
  )
  const selection = {
    maxSamples: z.number().int().min(1).max(100_000).parse(input.maxSamples ?? 5000),
    minimumMotionScore: z
      .number()
      .min(0)
      .max(1)
      .parse(input.minimumMotionScore ?? 0),
    includeBlackFrames: input.includeBlackFrames ?? false,
  }
  const frameIndex = parseJsonl(
    await readFile(join(sessionPath, 'frames.index.jsonl'), 'utf8'),
    gameFrameIndexEntrySchema,
    'GameModel frame index',
  )
  const skippedCounts = { duplicate: 0, lowMotion: 0, blackFrame: 0 }
  const seenFrames = new Set<string>()
  const candidates: Array<{
    entry: GameFrameIndexEntry
    sourceImagePath: string
    imageWidth: number
    imageHeight: number
  }> = []
  for (const entry of frameIndex) {
    if (entry.sessionId !== sessionId) {
      throw new Error(`Frame index sequence ${entry.sequence} belongs to another session.`)
    }
    const dedupeKey = entry.frameSha256 ?? entry.imageSha256
    if (seenFrames.has(dedupeKey)) {
      skippedCounts.duplicate += 1
      continue
    }
    seenFrames.add(dedupeKey)
    if (entry.motionScore < selection.minimumMotionScore) {
      skippedCounts.lowMotion += 1
      continue
    }
    if (
      !selection.includeBlackFrames &&
      (entry.frameMetrics?.blackFrameProbability ?? 0) >= 0.9
    ) {
      skippedCounts.blackFrame += 1
      continue
    }
    const sourceImagePath = resolveWithin(sessionPath, entry.imagePath)
    const encoded = await readFile(sourceImagePath)
    if (sha256(encoded) !== entry.imageSha256) {
      throw new Error(`Frame sample digest mismatch: ${entry.imagePath}`)
    }
    const metadata = await sharp(encoded).metadata()
    if (!metadata.width || !metadata.height) {
      throw new Error(`Frame sample dimensions are unreadable: ${entry.imagePath}`)
    }
    candidates.push({
      entry,
      sourceImagePath,
      imageWidth: metadata.width,
      imageHeight: metadata.height,
    })
  }
  const selected = selectEvenly(candidates, selection.maxSamples)
  const datasetSeed = JSON.stringify({
    sessionId,
    calibrationId: calibrationResult.calibration.calibrationId,
    selection,
    frames: selected.map(({ entry }) => [entry.sequence, entry.imageSha256]),
  })
  const datasetId = `dataset_${sha256(datasetSeed).slice(0, 20)}`
  const datasetPath = input.outputPath
    ? resolveFromCwd(input.cwd, input.outputPath)
    : resolve(
        input.cwd,
        '.leviathan',
        'gamemodel',
        'datasets',
        datasetId,
      )
  const existing = await loadExistingDataset(datasetPath, datasetId)
  if (existing) return { datasetPath, manifest: existing }

  const samples: GameDatasetSample[] = []
  for (const item of selected) {
    const sampleId = `sample_${sha256(
      `${sessionId}:${item.entry.sequence}:${item.entry.imageSha256}`,
    ).slice(0, 24)}`
    const split = splitForSample(sampleId)
    const sourceExtension = extname(item.sourceImagePath).toLowerCase()
    const imageExtension =
      sourceExtension === '.jpg' || sourceExtension === '.jpeg' ? '.jpg' : '.png'
    const imagePath = join('images', split, `${sampleId}${imageExtension}`).replaceAll(
      '\\',
      '/',
    )
    const destination = resolveWithin(datasetPath, imagePath)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(item.sourceImagePath, destination)
    samples.push(
      datasetSampleSchema.parse({
        schemaVersion: 1,
        sampleId,
        datasetId,
        split,
        imagePath,
        imageSha256: item.entry.imageSha256,
        imageWidth: item.imageWidth,
        imageHeight: item.imageHeight,
        calibrationId: calibrationResult.calibration.calibrationId,
        source: {
          sessionId,
          sequence: item.entry.sequence,
          capturedAt: item.entry.capturedAt,
          frameSha256: item.entry.frameSha256,
          windowViewport: item.entry.viewport,
          motionScore: item.entry.motionScore,
          blackFrameProbability:
            item.entry.frameMetrics?.blackFrameProbability,
        },
      }),
    )
  }
  const now = new Date().toISOString()
  const annotations = samples.map(sample =>
    annotationSchema.parse({
      schemaVersion: 1,
      sampleId: sample.sampleId,
      calibrationId: sample.calibrationId,
      status: 'unlabeled',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }),
  )
  const samplesContent = toJsonl(samples)
  const annotationsContent = toJsonl(annotations)
  const calibrationSnapshotPath = join(datasetPath, 'calibration', 'manifest.json')
  const calibrationReferenceSnapshotPath = join(
    datasetPath,
    'calibration',
    'reference.png',
  )
  const calibrationSnapshot: GameCalibrationManifest = {
    ...calibrationResult.calibration,
    referenceImage: {
      ...calibrationResult.calibration.referenceImage,
      path: 'reference.png',
    },
  }
  const manifest = datasetManifestSchema.parse({
    schemaVersion: 1,
    datasetId,
    profileId,
    calibrationId: calibrationResult.calibration.calibrationId,
    calibrationPath: 'calibration/manifest.json',
    sourceSessionId: sessionId,
    sourceSessionPath: relative(datasetPath, sessionPath).replaceAll('\\', '/'),
    createdAt: now,
    selection,
    sampleCount: samples.length,
    splitCounts: countValues(samples.map(sample => sample.split), GAME_DATASET_SPLITS),
    skippedCounts,
    annotationStatusCounts: countValues(
      annotations.map(annotation => annotation.status),
      GAME_ANNOTATION_STATUSES,
    ),
    samplesSha256: sha256(samplesContent),
    annotationsSha256: sha256(annotationsContent),
  })
  await mkdir(datasetPath, { recursive: true })
  await mkdir(dirname(calibrationSnapshotPath), { recursive: true })
  await copyFile(calibrationReferencePath, calibrationReferenceSnapshotPath)
  await writeFile(
    calibrationSnapshotPath,
    `${JSON.stringify(calibrationSnapshot, null, 2)}\n`,
    'utf8',
  )
  await writeFile(join(datasetPath, 'samples.jsonl'), samplesContent, 'utf8')
  await writeFile(join(datasetPath, 'annotations.jsonl'), annotationsContent, 'utf8')
  await writeJsonAtomic(join(datasetPath, 'manifest.json'), manifest)
  return { datasetPath, manifest }
}

export async function loadGameDataset(datasetPathInput: string): Promise<{
  datasetPath: string
  manifest: GameDatasetManifest
  samples: GameDatasetSample[]
  annotations: GameFrameAnnotation[]
}> {
  const datasetPath = resolve(datasetPathInput)
  const manifest = datasetManifestSchema.parse(
    JSON.parse(await readFile(join(datasetPath, 'manifest.json'), 'utf8')),
  )
  const calibrationPath = resolveWithin(datasetPath, manifest.calibrationPath)
  const calibration = await loadGameCalibration({
    cwd: datasetPath,
    profileId: manifest.profileId,
    calibrationPath,
  })
  if (calibration.calibration.calibrationId !== manifest.calibrationId) {
    throw new Error('Game dataset calibration id does not match its manifest.')
  }
  await verifyCalibrationReference(calibration.path, calibration.calibration)
  const samplesContent = await readFile(join(datasetPath, 'samples.jsonl'), 'utf8')
  const annotationsContent = await readFile(
    join(datasetPath, 'annotations.jsonl'),
    'utf8',
  )
  if (sha256(samplesContent) !== manifest.samplesSha256) {
    throw new Error('Game dataset samples digest does not match its manifest.')
  }
  if (sha256(annotationsContent) !== manifest.annotationsSha256) {
    throw new Error('Game dataset annotations digest does not match its manifest.')
  }
  const samples = parseJsonl(samplesContent, datasetSampleSchema, 'dataset samples')
  const annotations = parseJsonl(
    annotationsContent,
    annotationSchema,
    'dataset annotations',
  )
  if (samples.length !== manifest.sampleCount || annotations.length !== samples.length) {
    throw new Error('Game dataset manifest counts do not match its JSONL records.')
  }
  const sampleIds = new Set(samples.map(sample => sample.sampleId))
  if (sampleIds.size !== samples.length) {
    throw new Error('Game dataset contains duplicate sample ids.')
  }
  if (annotations.some(annotation => !sampleIds.has(annotation.sampleId))) {
    throw new Error('Game dataset contains an annotation for an unknown sample.')
  }
  return { datasetPath, manifest, samples, annotations }
}

export async function getGameDatasetSample(input: {
  datasetPath: string
  sampleId?: string
}): Promise<{
  sample: GameDatasetSample
  annotation: GameFrameAnnotation
  imagePath: string
  image: Buffer
}> {
  const dataset = await loadGameDataset(input.datasetPath)
  const sample = input.sampleId
    ? dataset.samples.find(candidate => candidate.sampleId === input.sampleId)
    : dataset.samples.find(candidate => {
        const annotation = dataset.annotations.find(
          item => item.sampleId === candidate.sampleId,
        )
        return annotation?.status === 'unlabeled'
      }) ?? dataset.samples[0]
  if (!sample) throw new Error('Game dataset has no samples.')
  const annotation = dataset.annotations.find(
    candidate => candidate.sampleId === sample.sampleId,
  )
  if (!annotation) throw new Error(`Annotation record is missing for ${sample.sampleId}.`)
  const imagePath = resolveWithin(dataset.datasetPath, sample.imagePath)
  const image = await readFile(imagePath)
  if (sha256(image) !== sample.imageSha256) {
    throw new Error(`Dataset sample image was modified: ${sample.sampleId}`)
  }
  return { sample, annotation, imagePath, image }
}

export async function saveGameAnnotation(input: {
  datasetPath: string
  sampleId: string
  status: Exclude<z.infer<typeof annotationSchema>['status'], 'unlabeled'>
  source: 'manual' | 'model' | 'imported'
  labels?: GameFrameLabels
}): Promise<{ annotation: GameFrameAnnotation; manifest: GameDatasetManifest }> {
  const dataset = await loadGameDataset(input.datasetPath)
  const sample = dataset.samples.find(candidate => candidate.sampleId === input.sampleId)
  if (!sample) throw new Error(`Unknown game dataset sample: ${input.sampleId}`)
  if (input.status !== 'rejected' && !input.labels) {
    throw new Error(`${input.status} annotations require labels.`)
  }
  const labels = input.labels
    ? gameFrameLabelsSchema.parse(input.labels)
    : undefined
  if (
    input.status !== 'rejected' &&
    labels &&
    Object.values(labels).every(value => value === undefined)
  ) {
    throw new Error('An annotation must contain at least one observed label.')
  }
  const previousIndex = dataset.annotations.findIndex(
    annotation => annotation.sampleId === input.sampleId,
  )
  if (previousIndex < 0) {
    throw new Error(`Annotation record is missing for ${input.sampleId}.`)
  }
  const previous = dataset.annotations[previousIndex]!
  const now = new Date().toISOString()
  const annotation = annotationSchema.parse({
    ...previous,
    status: input.status,
    revision: previous.revision + 1,
    source: input.source,
    updatedAt: now,
    labels,
  })
  const annotations = [...dataset.annotations]
  annotations[previousIndex] = annotation
  const content = toJsonl(annotations)
  const manifest = datasetManifestSchema.parse({
    ...dataset.manifest,
    annotationStatusCounts: countValues(
      annotations.map(item => item.status),
      GAME_ANNOTATION_STATUSES,
    ),
    annotationsSha256: sha256(content),
  })
  await writeTextAtomic(join(dataset.datasetPath, 'annotations.jsonl'), content)
  await writeJsonAtomic(join(dataset.datasetPath, 'manifest.json'), manifest)
  await appendFile(
    join(dataset.datasetPath, 'annotation-audit.jsonl'),
    `${JSON.stringify({
      timestamp: now,
      sampleId: input.sampleId,
      source: input.source,
      previousRevision: previous.revision,
      revision: annotation.revision,
      previousSha256: sha256(JSON.stringify(previous)),
      annotationSha256: sha256(JSON.stringify(annotation)),
    })}\n`,
    'utf8',
  )
  return { annotation, manifest }
}

export function resolveGameDatasetPath(cwd: string, path: string): string {
  return resolveFromCwd(cwd, path)
}

async function verifyCalibrationReference(
  calibrationPath: string,
  calibration: GameCalibrationManifest,
): Promise<string> {
  const path = resolveCalibrationReferenceImage(calibrationPath, calibration)
  const encoded = await readFile(path)
  if (sha256(encoded) !== calibration.referenceImage.sha256) {
    throw new Error('Calibration reference image digest does not match its manifest.')
  }
  return path
}

async function loadExistingDataset(
  datasetPath: string,
  datasetId: string,
): Promise<GameDatasetManifest | undefined> {
  try {
    const manifest = datasetManifestSchema.parse(
      JSON.parse(await readFile(join(datasetPath, 'manifest.json'), 'utf8')),
    )
    if (manifest.datasetId !== datasetId) {
      throw new Error(`Dataset directory already contains ${manifest.datasetId}.`)
    }
    await loadGameDataset(datasetPath)
    return manifest
  } catch (error) {
    if (isMissingFile(error)) {
      try {
        const info = await stat(datasetPath)
        if (info.isDirectory()) {
          throw new Error(`Dataset directory exists without a valid manifest: ${datasetPath}`)
        }
      } catch (statError) {
        if (!isMissingFile(statError)) throw statError
      }
      return undefined
    }
    throw error
  }
}

function selectEvenly<T>(values: T[], maximum: number): T[] {
  if (values.length <= maximum) return values
  if (maximum === 1) return [values[Math.floor(values.length / 2)]!]
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.round((index * (values.length - 1)) / (maximum - 1))
    return values[sourceIndex]!
  })
}

function splitForSample(sampleId: string): (typeof GAME_DATASET_SPLITS)[number] {
  const bucket = Number.parseInt(sha256(sampleId).slice(0, 8), 16) % 100
  if (bucket < 80) return 'train'
  if (bucket < 90) return 'validation'
  return 'test'
}

function countValues<const T extends readonly string[]>(
  values: string[],
  allowed: T,
): Record<T[number], number> {
  const counts = Object.fromEntries(allowed.map(value => [value, 0])) as Record<
    T[number],
    number
  >
  for (const value of values) {
    if (value in counts) counts[value as T[number]] += 1
  }
  return counts
}

function parseJsonl<T>(
  content: string,
  schema: z.ZodType<T>,
  label: string,
): T[] {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return schema.parse(JSON.parse(line))
      } catch (error) {
        throw new Error(
          `Invalid ${label} JSONL at line ${index + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    })
}

function toJsonl(values: unknown[]): string {
  return values.map(value => JSON.stringify(value)).join('\n') + (values.length ? '\n' : '')
}

function resolveWithin(rootInput: string, candidate: string): string {
  const root = resolve(rootInput)
  const resolved = resolve(root, candidate)
  const relation = relative(root, resolved)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error(`Artifact path escapes ${basename(root)}: ${candidate}`)
  }
  return resolved
}

function resolveFromCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path)
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, content, 'utf8')
  await rename(temporaryPath, path)
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

export type { GameCalibrationManifest, GameNormalizedRect }
