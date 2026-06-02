import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../leviathan/branding.js'
import type {
  BridgeApiClient,
  BridgeConfig,
  PermissionResponseEvent,
  WorkResponse,
} from './types.js'

type BridgeApiDeps = {
  baseUrl: string
  getAccessToken: () => string | undefined
  runnerVersion: string
  onDebug?: (msg: string) => void
  onAuth401?: (staleAccessToken: string) => Promise<boolean>
  getTrustedDeviceToken?: () => string | undefined
}

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

export function validateBridgeId(id: string, label: string): string {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: contains unsafe characters`)
  }
  return id
}

export class BridgeFatalError extends Error {
  readonly status: number
  readonly errorType: string | undefined

  constructor(message: string, status: number, errorType?: string) {
    super(message)
    this.name = 'BridgeFatalError'
    this.status = status
    this.errorType = errorType
  }
}

function bridgeFatal(): BridgeFatalError {
  return new BridgeFatalError(
    LEGACY_ACCOUNT_FEATURE_NOTICE,
    410,
    'legacy_account_disabled',
  )
}

export function createBridgeApiClient(deps: BridgeApiDeps): BridgeApiClient {
  deps.onDebug?.('[bridge:api] Remote bridge API is unavailable in Leviathan')
  return {
    async registerBridgeEnvironment(
      _config: BridgeConfig,
    ): Promise<{ environment_id: string; environment_secret: string }> {
      throw bridgeFatal()
    },

    async pollForWork(
      _environmentId: string,
      _environmentSecret: string,
      _signal?: AbortSignal,
      _reclaimOlderThanMs?: number,
    ): Promise<WorkResponse | null> {
      return null
    },

    async acknowledgeWork(
      _environmentId: string,
      _workId: string,
      _sessionToken: string,
    ): Promise<void> {},

    async stopWork(
      _environmentId: string,
      _workId: string,
      _force: boolean,
    ): Promise<void> {},

    async deregisterEnvironment(_environmentId: string): Promise<void> {},

    async sendPermissionResponseEvent(
      _sessionId: string,
      _event: PermissionResponseEvent,
      _sessionToken: string,
    ): Promise<void> {},

    async archiveSession(_sessionId: string): Promise<void> {},

    async reconnectSession(
      _environmentId: string,
      _sessionId: string,
    ): Promise<void> {},

    async heartbeatWork(
      _environmentId: string,
      _workId: string,
      _sessionToken: string,
    ): Promise<{ lease_extended: boolean; state: string }> {
      return { lease_extended: false, state: 'archived' }
    },
  }
}

export function isExpiredErrorType(errorType: string | undefined): boolean {
  if (!errorType) {
    return false
  }
  return errorType.includes('expired') || errorType.includes('lifetime')
}

export function isSuppressible403(err: BridgeFatalError): boolean {
  if (err.status !== 403) {
    return false
  }
  return (
    err.message.includes('external_poll_sessions') ||
    err.message.includes('environments:manage')
  )
}
