import { getOriginalCwd } from 'src/bootstrap/state.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { Root } from '../ink.js'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../leviathan/branding.js'
import type { Message, SystemMessage } from '../types/message.js'
import type { PermissionMode } from '../types/permissions.js'
import {
  deserializeMessages,
  type TeleportRemoteResponse,
} from './conversationRecovery.js'
import {
  detectCurrentRepositoryWithHost,
  parseGitHubRepository,
  parseGitRemote,
} from './detectRepository.js'
import { TeleportOperationError, toError } from './errors.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { getIsClean, gitExe } from './git.js'
import { logForDebugging } from './debug.js'
import { createSystemMessage, createUserMessage } from './messages.js'
import type { GitSource, SessionResource } from './teleport/api.js'

export type TeleportResult = {
  messages: Message[]
  branchName: string
}

export type TeleportProgressStep =
  | 'validating'
  | 'fetching_logs'
  | 'fetching_branch'
  | 'checking_out'
  | 'done'

export type TeleportProgressCallback = (step: TeleportProgressStep) => void

type TeleportToRemoteResponse = {
  id: string
  title: string
}

function legacyRemoteSessionError(): Error {
  return new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}

function createTeleportResumeSystemMessage(
  branchError: Error | null,
): SystemMessage {
  if (branchError === null) {
    return createSystemMessage('Session resumed', 'suggestion')
  }
  const formattedError =
    branchError instanceof TeleportOperationError
      ? branchError.formattedMessage
      : branchError.message
  return createSystemMessage(
    `Session resumed without branch: ${formattedError}`,
    'warning',
  )
}

function createTeleportResumeUserMessage() {
  return createUserMessage({
    content: `This session is being continued from another machine. Application state may have changed. The updated working directory is ${getOriginalCwd()}`,
    isMeta: true,
  })
}

export async function validateGitState(): Promise<void> {
  const isClean = await getIsClean({ ignoreUntracked: true })
  if (!isClean) {
    throw new TeleportOperationError(
      'Git working directory is not clean. Please commit or stash your changes before using remote session commands.',
      'Error: Git working directory is not clean. Please commit or stash your changes before using remote session commands.\n',
    )
  }
}

async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execFileNoThrow(gitExe(), [
    'branch',
    '--show-current',
  ])
  return stdout.trim()
}

export function processMessagesForTeleportResume(
  messages: Message[],
  error: Error | null,
): Message[] {
  return [
    ...deserializeMessages(messages),
    createTeleportResumeUserMessage(),
    createTeleportResumeSystemMessage(error),
  ]
}

export async function checkOutTeleportedSessionBranch(_branch?: string): Promise<{
  branchName: string
  branchError: Error | null
}> {
  try {
    return { branchName: await getCurrentBranch(), branchError: null }
  } catch (error) {
    return { branchName: '', branchError: toError(error) }
  }
}

export type RepoValidationResult = {
  status: 'match' | 'mismatch' | 'not_in_repo' | 'no_repo_required' | 'error'
  sessionRepo?: string
  currentRepo?: string | null
  sessionHost?: string
  currentHost?: string
  errorMessage?: string
}

export async function validateSessionRepository(
  sessionData: SessionResource,
): Promise<RepoValidationResult> {
  const currentParsed = await detectCurrentRepositoryWithHost()
  const currentRepo = currentParsed
    ? `${currentParsed.owner}/${currentParsed.name}`
    : null
  const gitSource = sessionData.session_context.sources.find(
    (source): source is GitSource => source.type === 'git_repository',
  )
  if (!gitSource?.url) {
    return { status: 'no_repo_required' }
  }

  const sessionParsed = parseGitRemote(gitSource.url)
  const sessionRepo = sessionParsed
    ? `${sessionParsed.owner}/${sessionParsed.name}`
    : parseGitHubRepository(gitSource.url)
  if (!sessionRepo) {
    return { status: 'no_repo_required' }
  }
  if (!currentRepo) {
    return {
      status: 'not_in_repo',
      sessionRepo,
      sessionHost: sessionParsed?.host,
      currentRepo: null,
    }
  }

  const stripPort = (host: string): string => host.replace(/:\d+$/, '')
  const repoMatch = currentRepo.toLowerCase() === sessionRepo.toLowerCase()
  const hostMatch =
    !currentParsed ||
    !sessionParsed ||
    stripPort(currentParsed.host.toLowerCase()) ===
      stripPort(sessionParsed.host.toLowerCase())
  if (repoMatch && hostMatch) {
    return { status: 'match', sessionRepo, currentRepo }
  }

  return {
    status: 'mismatch',
    sessionRepo,
    currentRepo,
    sessionHost: sessionParsed?.host,
    currentHost: currentParsed?.host,
  }
}

export async function teleportResumeCodeSession(
  _sessionId: string,
  onProgress?: TeleportProgressCallback,
): Promise<TeleportRemoteResponse> {
  onProgress?.('done')
  throw legacyRemoteSessionError()
}

export async function teleportToRemoteWithErrorHandling(
  _root: Root,
  _description: string | null,
  _signal: AbortSignal,
  _branchName?: string,
): Promise<TeleportToRemoteResponse | null> {
  logForDebugging(LEGACY_ACCOUNT_FEATURE_NOTICE)
  return null
}

export async function teleportFromSessionsAPI(
  _sessionId: string,
  _orgUUID: string,
  _accessToken: string,
  onProgress?: TeleportProgressCallback,
  _sessionData?: SessionResource,
): Promise<TeleportRemoteResponse> {
  onProgress?.('done')
  throw legacyRemoteSessionError()
}

export type PollRemoteSessionResponse = {
  newEvents: SDKMessage[]
  lastEventId: string | null
  branch?: string
  sessionStatus?: 'idle' | 'running' | 'requires_action' | 'archived'
}

export async function pollRemoteSessionEvents(
  _sessionId: string,
  afterId: string | null = null,
  _opts?: { skipMetadata?: boolean },
): Promise<PollRemoteSessionResponse> {
  return { newEvents: [], lastEventId: afterId, sessionStatus: 'archived' }
}

export async function teleportToRemote(options: {
  initialMessage: string | null
  branchName?: string
  title?: string
  description?: string
  model?: string
  permissionMode?: PermissionMode
  ultraplan?: boolean
  signal: AbortSignal
  useDefaultEnvironment?: boolean
  environmentId?: string
  environmentVariables?: Record<string, string>
  useBundle?: boolean
  onBundleFail?: (message: string) => void
  skipBundle?: boolean
  reuseOutcomeBranch?: string
  githubPr?: { owner: string; repo: string; number: number }
}): Promise<TeleportToRemoteResponse | null> {
  options.onBundleFail?.(LEGACY_ACCOUNT_FEATURE_NOTICE)
  return null
}

export async function archiveRemoteSession(_sessionId: string): Promise<void> {}
