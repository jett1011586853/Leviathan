import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../leviathan/branding.js'
import { logForDebugging } from '../utils/debug.js'

export type BackoffConfig = {
  connInitialMs: number
  connCapMs: number
  connGiveUpMs: number
  generalInitialMs: number
  generalCapMs: number
  generalGiveUpMs: number
  shutdownGraceMs?: number
  stopWorkBaseDelayMs?: number
}

function bridgeUnavailableError(): Error {
  return new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}

export async function runBridgeLoop(..._args: unknown[]): Promise<void> {
  throw bridgeUnavailableError()
}

export function isConnectionError(_err: unknown): boolean {
  return false
}

export function isServerError(_err: unknown): boolean {
  return false
}

export type ParsedArgs = {
  args: string[]
  error?: string
  help?: boolean
}

export function parseArgs(args: string[]): ParsedArgs {
  return { args, error: LEGACY_ACCOUNT_FEATURE_NOTICE }
}

export async function bridgeMain(_args: string[]): Promise<void> {
  logForDebugging('[bridge] Standalone bridge is unavailable in Leviathan')
  throw bridgeUnavailableError()
}

export class BridgeHeadlessPermanentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeHeadlessPermanentError'
  }
}

export type HeadlessBridgeOpts = {
  dir: string
  name?: string
  spawnMode: 'same-dir' | 'worktree'
  capacity: number
  permissionMode?: string
  sandbox: boolean
  sessionTimeoutMs?: number
  createSessionOnStart: boolean
  getAccessToken: () => string | undefined
  onAuth401: (failedToken: string) => Promise<boolean>
  log: (s: string) => void
}

export async function runBridgeHeadless(
  opts: HeadlessBridgeOpts,
  _signal: AbortSignal,
): Promise<void> {
  opts.log(LEGACY_ACCOUNT_FEATURE_NOTICE)
  throw new BridgeHeadlessPermanentError(LEGACY_ACCOUNT_FEATURE_NOTICE)
}
