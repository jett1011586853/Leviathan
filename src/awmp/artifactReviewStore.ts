import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { loadArtifactIndex } from './artifactStore.js'
import { sanitizePathSegment } from './paths.js'
import { appendTraceEvent, createTraceEvent } from './trace.js'
import type { AwmpArtifact, AwmpTask } from './types.js'

export type AwmpArtifactReviewStatus =
  | 'accepted'
  | 'accepted_with_changes'
  | 'rejected'
  | 'needs_revision'

export type AwmpArtifactReviewRecord = {
  awmp: '0.1'
  kind: 'ArtifactReview'
  id: string
  runDir: string
  taskId: string
  traceId?: string
  artifact: {
    id: string
    type: string
    uri: string
    mediaType: string
    createdBy: AwmpArtifact['createdBy']
  }
  status: AwmpArtifactReviewStatus
  accepted: boolean
  reviewedAt: string
  reviewedBy: string
  note?: string
  requestedChanges?: string
  reviewPath: string
}

export type AwmpArtifactReviewList = {
  awmp: '0.1'
  kind: 'ArtifactReviewIndex'
  generatedAt: string
  runDir: string
  reviews: AwmpArtifactReviewRecord[]
}

export async function recordArtifactReview(input: {
  runDir: string
  artifactRef: string
  status: AwmpArtifactReviewStatus
  reviewedBy?: string
  note?: string
  requestedChanges?: string
}): Promise<AwmpArtifactReviewRecord> {
  const runDir = resolve(input.runDir)
  const task = await readJsonFile<AwmpTask>(join(runDir, 'task.json'))
  const artifact = await resolveArtifact(runDir, input.artifactRef)
  const id = `review_${randomUUID()}`
  const review: AwmpArtifactReviewRecord = {
    awmp: '0.1',
    kind: 'ArtifactReview',
    id,
    runDir,
    taskId: task.id,
    traceId: task.traceId,
    artifact: {
      id: artifact.id,
      type: artifact.type,
      uri: artifact.uri,
      mediaType: artifact.mediaType,
      createdBy: artifact.createdBy,
    },
    status: input.status,
    accepted: isAcceptedReview(input.status),
    reviewedAt: new Date().toISOString(),
    reviewedBy: input.reviewedBy?.trim() || 'local-user',
    note: input.note,
    requestedChanges: input.requestedChanges,
    reviewPath: reviewPath(runDir, id),
  }

  await writeArtifactReview(review)
  await writeArtifactReviewIndex(runDir)
  await appendArtifactReviewTrace(runDir, review)
  return review
}

export async function listArtifactReviews(
  runDir: string,
): Promise<AwmpArtifactReviewList> {
  const resolvedRunDir = resolve(runDir)
  const dir = reviewsDir(resolvedRunDir)
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    return {
      awmp: '0.1',
      kind: 'ArtifactReviewIndex',
      generatedAt: new Date().toISOString(),
      runDir: resolvedRunDir,
      reviews: [],
    }
  }

  const reviews = (
    await Promise.all(
      files
        .filter(file => file.endsWith('.json') && file !== 'index.json')
        .map(async file => {
          try {
            return parseArtifactReview(await readFile(join(dir, file), 'utf8'))
          } catch {
            return undefined
          }
        }),
    )
  )
    .filter((review): review is AwmpArtifactReviewRecord => review !== undefined)
    .sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt))

  return {
    awmp: '0.1',
    kind: 'ArtifactReviewIndex',
    generatedAt: new Date().toISOString(),
    runDir: resolvedRunDir,
    reviews,
  }
}

export function formatArtifactReviewList(
  list: AwmpArtifactReviewList,
): string {
  if (list.reviews.length === 0) {
    return [
      'AWMP artifact reviews',
      `Run: ${list.runDir}`,
      '',
      'No artifact reviews.',
    ].join('\n')
  }

  return [
    'AWMP artifact reviews',
    `Run: ${list.runDir}`,
    '',
    ...list.reviews.map(review =>
      [
        `- ${review.id} ${review.status}`,
        `  artifact: ${review.artifact.id} (${review.artifact.type})`,
        `  accepted: ${review.accepted}`,
        `  reviewed: ${review.reviewedAt} by ${review.reviewedBy}`,
        review.note === undefined ? undefined : `  note: ${review.note}`,
        review.requestedChanges === undefined
          ? undefined
          : `  requested changes: ${review.requestedChanges}`,
        `  path: ${review.reviewPath}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
}

export function isAcceptedReview(status: AwmpArtifactReviewStatus): boolean {
  return status === 'accepted' || status === 'accepted_with_changes'
}

async function writeArtifactReview(
  review: AwmpArtifactReviewRecord,
): Promise<void> {
  await mkdir(dirname(review.reviewPath), { recursive: true })
  await writeFile(review.reviewPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8')
}

async function writeArtifactReviewIndex(runDir: string): Promise<void> {
  const list = await listArtifactReviews(runDir)
  await mkdir(reviewsDir(runDir), { recursive: true })
  await writeFile(reviewIndexPath(runDir), `${JSON.stringify(list, null, 2)}\n`, 'utf8')
}

async function appendArtifactReviewTrace(
  runDir: string,
  review: AwmpArtifactReviewRecord,
): Promise<void> {
  if (review.traceId === undefined) return
  await appendTraceEvent(
    join(runDir, 'trace.jsonl'),
    createTraceEvent({
      traceId: review.traceId,
      taskId: review.taskId,
      modeId: review.artifact.createdBy.modeId,
      event: 'artifact.reviewed',
      data: {
        reviewId: review.id,
        artifactId: review.artifact.id,
        artifactType: review.artifact.type,
        status: review.status,
        accepted: review.accepted,
        reviewedBy: review.reviewedBy,
        reviewPath: review.reviewPath,
      },
    }),
  )
}

async function resolveArtifact(
  runDir: string,
  artifactRef: string,
): Promise<AwmpArtifact> {
  const cleanRef = artifactRef.trim()
  const artifacts = await loadArtifactIndex(runDir)
  const match = artifacts.find(
    artifact =>
      artifact.id === cleanRef ||
      artifact.uri === cleanRef ||
      resolve(artifact.uri) === resolve(cleanRef) ||
      basename(artifact.uri) === cleanRef,
  )
  if (match === undefined) {
    throw new Error(`AWMP artifact not found for review: ${artifactRef}`)
  }
  return match
}

function parseArtifactReview(raw: string): AwmpArtifactReviewRecord {
  const parsed = JSON.parse(raw) as AwmpArtifactReviewRecord
  if (parsed.kind !== 'ArtifactReview' || !parsed.id || !parsed.artifact?.id) {
    throw new Error('Invalid AWMP artifact review record.')
  }
  return parsed
}

function reviewsDir(runDir: string): string {
  return join(resolve(runDir), 'artifacts', 'reviews')
}

function reviewPath(runDir: string, id: string): string {
  return join(reviewsDir(runDir), `${sanitizePathSegment(id)}.json`)
}

function reviewIndexPath(runDir: string): string {
  return join(reviewsDir(runDir), 'index.json')
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}
