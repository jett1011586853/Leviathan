import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { AwmpArtifactSchema } from './schemas.js'
import { sanitizePathSegment } from './paths.js'
import type { AwmpArtifact } from './types.js'

export type AwmpArtifactStoreSnapshot = {
  awmp: '0.1'
  kind: 'ArtifactStore'
  generatedAt: string
  runDir: string
  taskId: string
  indexPath: string
  artifacts: AwmpArtifact[]
  summary: {
    total: number
    byType: Record<string, number>
  }
}

export type AwmpArtifactStoreHandle = {
  runDir: string
  taskId: string
  artifactsDir: string
  indexPath: string
  storePath: string
  artifacts: AwmpArtifact[]
}

export async function createArtifactStore(input: {
  runDir: string
  taskId: string
}): Promise<AwmpArtifactStoreHandle> {
  const runDir = resolve(input.runDir)
  const artifactsDir = join(runDir, 'artifacts')
  const handle: AwmpArtifactStoreHandle = {
    runDir,
    taskId: input.taskId,
    artifactsDir,
    indexPath: join(artifactsDir, 'index.json'),
    storePath: join(artifactsDir, 'store.json'),
    artifacts: [],
  }

  await mkdir(artifactsDir, { recursive: true })
  await writeArtifactIndex(handle)
  return handle
}

export async function openArtifactStore(input: {
  runDir: string
  taskId: string
}): Promise<AwmpArtifactStoreHandle> {
  const runDir = resolve(input.runDir)
  const artifactsDir = join(runDir, 'artifacts')
  return {
    runDir,
    taskId: input.taskId,
    artifactsDir,
    indexPath: join(artifactsDir, 'index.json'),
    storePath: join(artifactsDir, 'store.json'),
    artifacts: await loadArtifactIndex(runDir),
  }
}

export async function writeJsonArtifact(
  store: AwmpArtifactStoreHandle,
  input: {
    type: string
    fileName: string
    content: unknown
    createdBy: AwmpArtifact['createdBy']
    mediaType?: string
    lineage?: string[]
    validation?: AwmpArtifact['validation']
    metadata?: Record<string, unknown>
  },
): Promise<AwmpArtifact> {
  const artifactPath = join(store.artifactsDir, sanitizePathSegment(input.fileName))
  await writeFile(artifactPath, `${JSON.stringify(input.content, null, 2)}\n`, 'utf8')

  return registerArtifact(store, {
    awmp: '0.1',
    kind: 'Artifact',
    id: `art_${randomUUID()}`,
    taskId: store.taskId,
    type: input.type,
    mediaType: input.mediaType ?? 'application/json',
    uri: artifactPath,
    createdBy: input.createdBy,
    lineage: input.lineage ?? [],
    validation: input.validation,
    version: 1,
    metadata: input.metadata,
  })
}

export async function registerArtifact(
  store: AwmpArtifactStoreHandle,
  artifact: AwmpArtifact,
): Promise<AwmpArtifact> {
  const parsed = AwmpArtifactSchema.parse(artifact)
  store.artifacts = [...store.artifacts, parsed]
  await writeArtifactIndex(store)
  return parsed
}

export async function updateArtifactValidation(
  store: AwmpArtifactStoreHandle,
  input: {
    artifactIds: string[]
    validation: NonNullable<AwmpArtifact['validation']>
  },
): Promise<AwmpArtifact[]> {
  const targetIds = new Set(input.artifactIds)
  const updated: AwmpArtifact[] = []
  store.artifacts = store.artifacts.map(artifact => {
    if (!targetIds.has(artifact.id)) return artifact
    const parsed = AwmpArtifactSchema.parse({
      ...artifact,
      validation: input.validation,
      version: (artifact.version ?? 1) + 1,
    })
    updated.push(parsed)
    return parsed
  })
  await writeArtifactIndex(store)
  return updated
}

export async function writeArtifactIndex(
  store: AwmpArtifactStoreHandle,
): Promise<void> {
  await mkdir(store.artifactsDir, { recursive: true })
  await writeFile(store.indexPath, `${JSON.stringify(store.artifacts, null, 2)}\n`, 'utf8')
  await writeFile(
    store.storePath,
    `${JSON.stringify(createStoreSnapshot(store), null, 2)}\n`,
    'utf8',
  )
}

export async function loadArtifactIndex(runDir: string): Promise<AwmpArtifact[]> {
  const raw = await readFile(join(resolve(runDir), 'artifacts', 'index.json'), 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid AWMP artifact index.')
  }
  return parsed.map(artifact => AwmpArtifactSchema.parse(artifact))
}

export async function loadArtifactStoreSnapshot(
  runDir: string,
): Promise<AwmpArtifactStoreSnapshot> {
  const raw = await readFile(join(resolve(runDir), 'artifacts', 'store.json'), 'utf8')
  const parsed = JSON.parse(raw) as AwmpArtifactStoreSnapshot
  if (parsed.kind !== 'ArtifactStore' || !Array.isArray(parsed.artifacts)) {
    throw new Error('Invalid AWMP artifact store snapshot.')
  }
  return parsed
}

export async function readJsonArtifact(artifact: AwmpArtifact): Promise<unknown> {
  if (artifact.mediaType !== 'application/json') {
    throw new Error(`Artifact ${artifact.id} is not JSON: ${artifact.mediaType}`)
  }
  return JSON.parse(await readFile(artifact.uri, 'utf8'))
}

function createStoreSnapshot(
  store: AwmpArtifactStoreHandle,
): AwmpArtifactStoreSnapshot {
  return {
    awmp: '0.1',
    kind: 'ArtifactStore',
    generatedAt: new Date().toISOString(),
    runDir: store.runDir,
    taskId: store.taskId,
    indexPath: store.indexPath,
    artifacts: store.artifacts,
    summary: {
      total: store.artifacts.length,
      byType: summarizeByType(store.artifacts),
    },
  }
}

function summarizeByType(artifacts: AwmpArtifact[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const artifact of artifacts) {
    counts[artifact.type] = (counts[artifact.type] ?? 0) + 1
  }
  return counts
}
