import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { logForDebugging } from '../utils/debug.js'

type SessionEvent = {
  type: 'event'
  data: SDKMessage
}

export async function createBridgeSession(_opts: {
  environmentId: string
  title?: string
  events: SessionEvent[]
  gitRepoUrl: string | null
  branch: string
  signal: AbortSignal
  baseUrl?: string
  getAccessToken?: () => string | undefined
  permissionMode?: string
}): Promise<string | null> {
  logForDebugging('[bridge] Remote session creation is unavailable in Leviathan')
  return null
}

export async function getBridgeSession(
  _sessionId: string,
  _opts?: { baseUrl?: string; getAccessToken?: () => string | undefined },
): Promise<{ environment_id?: string; title?: string } | null> {
  logForDebugging('[bridge] Remote session fetch is unavailable in Leviathan')
  return null
}

export async function archiveBridgeSession(
  _sessionId: string,
  _opts?: {
    baseUrl?: string
    getAccessToken?: () => string | undefined
    timeoutMs?: number
  },
): Promise<void> {
  logForDebugging('[bridge] Remote session archive is unavailable in Leviathan')
}

export async function updateBridgeSessionTitle(
  _sessionId: string,
  _title: string,
  _opts?: { baseUrl?: string; getAccessToken?: () => string | undefined },
): Promise<void> {
  logForDebugging('[bridge] Remote session title sync is unavailable in Leviathan')
}
