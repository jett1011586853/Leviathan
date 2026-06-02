import type { Tool } from '../../Tool.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { UUID } from 'crypto'
import type { SDKSessionInfo, SDKMessage, SDKResultMessage } from './coreTypes.js'
import type { McpSdkServerConfig } from '../../services/mcp/types.js'

// ============================================================================
// SDK Runtime Types (non-serializable, with callbacks/interfaces)
// ============================================================================

export type AnyZodRawShape = Record<string, unknown>
export type InferShape<S extends AnyZodRawShape> = { [K in keyof S]: unknown }

export interface SDKSession {
  id: string
  sessionId: string
  query: (prompt: string, options?: Options) => Promise<void>
  close: () => Promise<void>
  getSessionInfo: (options?: GetSessionInfoOptions) => Promise<SDKSessionInfo>
  getMessages: (options?: GetSessionMessagesOptions) => Promise<SessionMessage[]>
}

export interface ListSessionsOptions {
  limit?: number
  offset?: number
}

export interface GetSessionInfoOptions {
  sessionId: string
}

export interface GetSessionMessagesOptions {
  sessionId: string
  limit?: number
  before?: string
  after?: string
}

export interface SessionMutationOptions {
  sessionId: string
}

export interface ForkSessionOptions extends SessionMutationOptions {
  prompt?: string
  permissionMode?: string
}

export interface ForkSessionResult {
  sessionId: string
}

export interface Options {
  permissionMode?: string
  maxTurns?: number
  model?: string
  tools?: Tool[]
  systemPrompt?: string
  signal?: AbortSignal
  print?: boolean
  effort?: string
  forkSessionId?: UUID
  agentDefinition?: unknown
}

export interface InternalOptions extends Options {
  sessionId?: string
}

export interface Query {
  (prompt: string, options?: Options): Promise<void>
}

export interface InternalQuery extends Query {
  (prompt: string, options?: InternalOptions): Promise<void>
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface SDKSessionOptions {
  cwd?: string
  permissionMode?: string
  model?: string
  systemPrompt?: string
  forkSessionId?: UUID
  agentModel?: string
}

export interface SdkMcpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>
}

export interface McpSdkServerConfigWithInstance extends McpSdkServerConfig {
  tools: SdkMcpToolDefinition[]
}
