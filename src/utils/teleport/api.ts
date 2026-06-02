import axios from 'axios'
import z from 'zod/v4'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'
import { lazySchema } from '../lazySchema.js'

/**
 * Checks if an axios error is a transient network error. This helper is kept
 * for local callers that classify provider/network failures; it does not
 * initiate any network request.
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false
  }

  if (!error.response) {
    return true
  }

  return error.response.status >= 500
}

export type SessionStatus = 'requires_action' | 'running' | 'idle' | 'archived'

export type GitSource = {
  type: 'git_repository'
  url: string
  revision?: string | null
  allow_unrestricted_git_push?: boolean
}

export type KnowledgeBaseSource = {
  type: 'knowledge_base'
  knowledge_base_id: string
}

export type SessionContextSource = GitSource | KnowledgeBaseSource

export type OutcomeGitInfo = {
  type: 'github'
  repo: string
  branches: string[]
}

export type GitRepositoryOutcome = {
  type: 'git_repository'
  git_info: OutcomeGitInfo
}

export type Outcome = GitRepositoryOutcome

export type SessionContext = {
  sources: SessionContextSource[]
  cwd: string
  outcomes: Outcome[] | null
  custom_system_prompt: string | null
  append_system_prompt: string | null
  model: string | null
  seed_bundle_file_id?: string
  github_pr?: { owner: string; repo: string; number: number }
  reuse_outcome_branches?: boolean
}

export type SessionResource = {
  type: 'session'
  id: string
  title: string | null
  session_status: SessionStatus
  environment_id: string
  created_at: string
  updated_at: string
  session_context: SessionContext
}

export type ListSessionsResponse = {
  data: SessionResource[]
  has_more: boolean
  first_id: string | null
  last_id: string | null
}

export const CodeSessionSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    status: z.enum([
      'idle',
      'working',
      'waiting',
      'completed',
      'archived',
      'cancelled',
      'rejected',
    ]),
    repo: z
      .object({
        name: z.string(),
        owner: z.object({
          login: z.string(),
        }),
        default_branch: z.string().optional(),
      })
      .nullable(),
    turns: z.array(z.string()),
    created_at: z.string(),
    updated_at: z.string(),
  }),
)

export type CodeSession = z.infer<ReturnType<typeof CodeSessionSchema>>

function legacyRemoteSessionError(): Error {
  return new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}

export async function prepareApiRequest(): Promise<{
  accessToken: string
  orgUUID: string
}> {
  throw legacyRemoteSessionError()
}

export async function fetchCodeSessionsFromSessionsAPI(): Promise<
  CodeSession[]
> {
  throw legacyRemoteSessionError()
}

export function getOAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
}

export async function fetchSession(
  _sessionId: string,
): Promise<SessionResource> {
  throw legacyRemoteSessionError()
}

export function getBranchFromSession(
  session: SessionResource,
): string | undefined {
  const gitOutcome = session.session_context.outcomes?.find(
    (outcome): outcome is GitRepositoryOutcome =>
      outcome.type === 'git_repository',
  )
  return gitOutcome?.git_info?.branches[0]
}

export type RemoteMessageContent =
  | string
  | Array<{ type: string; [key: string]: unknown }>

export async function sendEventToRemoteSession(
  _sessionId: string,
  _messageContent: RemoteMessageContent,
  _opts?: { uuid?: string },
): Promise<boolean> {
  return false
}

export async function updateSessionTitle(
  _sessionId: string,
  _title: string,
): Promise<boolean> {
  return false
}
