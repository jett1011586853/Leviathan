export const DEFAULT_UPLOAD_CONCURRENCY = 4
export const FILE_COUNT_LIMIT = 1000
export const OUTPUTS_SUBDIR = '.outputs'

export interface PersistedFile {
  path: string
  fileId: string
  size: number
}

export interface FailedPersistence {
  path: string
  error: string
}

export interface FilesPersistedEventData {
  persisted: PersistedFile[]
  failed: FailedPersistence[]
  totalSize: number
}

export interface TurnStartTime {
  timestamp: number
}
