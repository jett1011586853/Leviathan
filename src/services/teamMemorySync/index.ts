import { createHash } from 'crypto'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { TeamMemorySyncPushResult } from './types.js'

export type SyncState = {
  lastKnownChecksum: string | null
  serverChecksums: Map<string, string>
  serverMaxEntries: number | null
}

export function createSyncState(): SyncState {
  return {
    lastKnownChecksum: null,
    serverChecksums: new Map(),
    serverMaxEntries: null,
  }
}

export function hashContent(content: string): string {
  return 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex')
}

export function batchDeltaByBytes(
  delta: Record<string, string>,
): Array<Record<string, string>> {
  const keys = Object.keys(delta).sort()
  if (keys.length === 0) return []

  const maxBodyBytes = 200_000
  const emptyBodyBytes = Buffer.byteLength('{"entries":{}}', 'utf8')
  const entryBytes = (key: string, value: string): number =>
    Buffer.byteLength(jsonStringify(key), 'utf8') +
    Buffer.byteLength(jsonStringify(value), 'utf8') +
    2

  const batches: Array<Record<string, string>> = []
  let current: Record<string, string> = {}
  let currentBytes = emptyBodyBytes

  for (const key of keys) {
    const added = entryBytes(key, delta[key]!)
    if (
      currentBytes + added > maxBodyBytes &&
      Object.keys(current).length > 0
    ) {
      batches.push(current)
      current = {}
      currentBytes = emptyBodyBytes
    }
    current[key] = delta[key]!
    currentBytes += added
  }

  batches.push(current)
  return batches
}

export function isTeamMemorySyncAvailable(): boolean {
  return false
}

export async function pullTeamMemory(
  _state: SyncState,
  _options?: { skipEtagCache?: boolean },
): Promise<{
  success: boolean
  filesWritten: number
  entryCount: number
  notModified?: boolean
  error?: string
}> {
  return {
    success: false,
    filesWritten: 0,
    entryCount: 0,
    error: 'Team memory sync is unavailable in Leviathan',
  }
}

export async function pushTeamMemory(
  _state: SyncState,
): Promise<TeamMemorySyncPushResult> {
  return {
    success: false,
    filesUploaded: 0,
    error: 'Team memory sync is unavailable in Leviathan',
    errorType: 'no_oauth',
  }
}

export async function syncTeamMemory(_state: SyncState): Promise<{
  success: boolean
  filesPulled: number
  filesPushed: number
  error?: string
}> {
  return {
    success: false,
    filesPulled: 0,
    filesPushed: 0,
    error: 'Team memory sync is unavailable in Leviathan',
  }
}
