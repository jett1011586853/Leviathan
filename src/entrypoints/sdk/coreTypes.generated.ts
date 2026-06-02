import type { UUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { PermissionMode } from '../../types/permissions.js'
import type { Message, AssistantMessage, UserMessage } from '../../types/message.js'

// Re-export message types for SDK consumers
export type { Message as SDKMessage, AssistantMessage as SDKAssistantMessage, UserMessage as SDKUserMessage }

export interface SDKCompactBoundaryMessage {
  type: 'compact_boundary'
  uuid: UUID
  timestamp: string
}

export interface SDKPermissionDenial {
  toolName: string
  reason: string
  requestId?: string
}

export interface SDKUserMessageReplay {
  messages: Message[]
  sessionId: string
}

export interface SDKStatus {
  connected: boolean
  sessionId?: string
  bridgeStatus?: 'connecting' | 'connected' | 'disconnected'
}

export interface SDKResultMessage {
  type: 'result'
  message: AssistantMessage
  sessionId: string
}

export interface SDKSessionInfo {
  sessionId: string
  projectPath: string
  createdAt: string
}

export interface SDKResultSuccess {
  type: 'result'
  subtype: string
  content: string
  sessionId: string
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'Setup'
  | 'TeammateIdle'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'Elicitation'
  | 'ElicitationResult'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'InstructionsLoaded'
  | 'CwdChanged'
  | 'FileChanged'
