import type { ContentBlockParam, ToolUseBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { SDKAssistantMessageError, HookEvent } from '../entrypoints/agentSdkTypes.js'

// ============================================================================
// Message Origin
// ============================================================================

export type MessageOrigin =
  | { kind: 'human' }
  | { kind: 'task-notification' }
  | { kind: 'coordinator' }
  | { kind: 'channel'; server: string }

// ============================================================================
// System Message Subtypes
// ============================================================================

export type SystemMessageLevel = 'info' | 'warn' | 'error'

export type SystemMessageSubtype =
  | 'informational'
  | 'api_error'
  | 'bridge_status'
  | 'turn_duration'
  | 'memory_saved'
  | 'stop_hook_summary'
  | 'thinking'
  | 'compact_boundary'
  | 'microcompact_boundary'
  | 'permission_retry'
  | 'agents_killed'
  | 'api_metrics'
  | 'away_summary'
  | 'scheduled_task_fire'
  | 'local_command'

// ============================================================================
// Assistant Message
// ============================================================================

export interface AssistantMessage {
  type: 'assistant'
  uuid: UUID
  timestamp: string
  message: {
    id: UUID
    container: unknown | null
    model: string
    role: 'assistant'
    stop_reason: string
    stop_sequence: string
    type: 'message'
    usage: Usage
    content: ContentBlockParam[]
    context_management: unknown | null
  }
  requestId: string | undefined
  apiError?: unknown
  error?: SDKAssistantMessageError
  errorDetails?: string
  isApiErrorMessage: boolean
  isVirtual?: true
  isMeta?: true
  advisorModel?: string
}

// ============================================================================
// User Message
// ============================================================================

export interface UserMessage {
  type: 'user'
  uuid: UUID
  timestamp: string
  message: {
    id: UUID
    role: 'user'
    content: string | ContentBlockParam[]
  }
  toolUseResult?: unknown
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  summarizeMetadata?: unknown
  imagePasteIds?: number[]
  sourceToolAssistantUUID?: UUID
  permissionMode?: string
  origin?: MessageOrigin
}

// ============================================================================
// Attachment Message
// ============================================================================

export interface AttachmentMessage {
  type: 'attachment'
  uuid: UUID
  timestamp: string
  attachment: {
    hookEvent?: HookEvent
    toolUseID?: string
    origin?: MessageOrigin
    commandMode?: string
    [key: string]: unknown
  }
}

// ============================================================================
// Progress Message
// ============================================================================

export interface ProgressMessage<P = unknown> {
  type: 'progress'
  uuid: UUID
  timestamp: string
  data: P
  toolUseID: string
  parentToolUseID: string
}

// ============================================================================
// System Messages
// ============================================================================

export interface SystemMessage {
  type: 'system'
  uuid: UUID
  timestamp: string
  subtype: SystemMessageSubtype
  content: string
  level: SystemMessageLevel
  isMeta: boolean
  toolUseID?: string
  preventContinuation?: boolean
}

export interface SystemInformationalMessage extends SystemMessage {
  subtype: 'informational'
  level: 'info' | 'warn'
}

export interface SystemAPIErrorMessage extends SystemMessage {
  subtype: 'api_error'
  level: 'error'
}

export interface SystemBridgeStatusMessage extends SystemMessage {
  subtype: 'bridge_status'
  level: 'info'
}

export interface SystemTurnDurationMessage extends SystemMessage {
  subtype: 'turn_duration'
  level: 'info'
  durationMs: number
}

export interface SystemMemorySavedMessage extends SystemMessage {
  subtype: 'memory_saved'
  level: 'info'
}

export interface SystemStopHookSummaryMessage extends SystemMessage {
  subtype: 'stop_hook_summary'
  level: 'info'
  hookSummaries?: string[]
}

export interface SystemThinkingMessage extends SystemMessage {
  subtype: 'thinking'
  level: 'info'
  thinking?: string
}

export interface SystemCompactBoundaryMessage extends SystemMessage {
  subtype: 'compact_boundary'
  level: 'info'
}

export interface SystemMicrocompactBoundaryMessage extends SystemMessage {
  subtype: 'microcompact_boundary'
  level: 'info'
}

export interface SystemPermissionRetryMessage extends SystemMessage {
  subtype: 'permission_retry'
  level: 'info'
  commands: string[]
}

export interface SystemAgentsKilledMessage extends SystemMessage {
  subtype: 'agents_killed'
  level: 'info'
}

export interface SystemApiMetricsMessage extends SystemMessage {
  subtype: 'api_metrics'
  level: 'info'
}

export interface SystemAwaySummaryMessage extends SystemMessage {
  subtype: 'away_summary'
  level: 'info'
}

export interface SystemScheduledTaskFireMessage extends SystemMessage {
  subtype: 'scheduled_task_fire'
  level: 'info'
}

export interface SystemLocalCommandMessage extends SystemMessage {
  subtype: 'local_command'
  level: 'info'
  commandName?: string
  stdout?: string
  stderr?: string
}

// ============================================================================
// Tombstone Message
// ============================================================================

export interface TombstoneMessage {
  type: 'tombstone'
  uuid: UUID
  timestamp: string
  originalType: string
  originalUUID: UUID
}

// ============================================================================
// Tool Use Summary
// ============================================================================

export interface ToolUseSummaryMessage {
  type: 'tool_use_summary'
  uuid: UUID
  timestamp: string
  summary: string
  toolUseIds: string[]
}

// ============================================================================
// Stream Events
// ============================================================================

export interface RequestStartEvent {
  type: 'request_start'
  model: string
  requestId: string
}

export interface StreamEvent {
  type: 'stream'
  data: unknown
}

// ============================================================================
// Stop Hook Info
// ============================================================================

export interface StopHookInfo {
  hookNames: string[]
  exitCode?: number
  signal?: string
}

// ============================================================================
// Hook Result Message
// ============================================================================

export interface HookResultMessage {
  type: 'hook_result'
  uuid: UUID
  timestamp: string
  hookName: string
  hookEvent: HookEvent
  result: unknown
}

// ============================================================================
// Grouped Tool Use Message (UI rendering)
// ============================================================================

export interface GroupedToolUseMessage {
  type: 'grouped_tool_use'
  uuid: UUID
  timestamp: string
  messages: NormalizedAssistantMessage[]
  toolName: string
}

// ============================================================================
// Collapsed Read Search Group
// ============================================================================

export interface CollapsedReadSearchGroup {
  messages: NormalizedAssistantMessage[]
  collapsed: boolean
  toolName: string
  count: number
}

// ============================================================================
// Partial Compact Direction
// ============================================================================

export type PartialCompactDirection = 'above' | 'below'

// ============================================================================
// Normalized Message Types
// ============================================================================

export interface NormalizedMessage {
  type: string
  uuid: UUID
  timestamp: string
  message: {
    id?: UUID
    role?: string
    content: ContentBlockParam[]
  }
  isMeta?: true
  isVirtual?: true
  error?: SDKAssistantMessageError
  isApiErrorMessage?: boolean
  toolUseResult?: unknown
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  isVisibleInTranscriptOnly?: true
  imagePasteIds?: number[]
  origin?: MessageOrigin
  requestId?: string
  advisorModel?: string
}

export interface NormalizedAssistantMessage extends NormalizedMessage {
  type: 'assistant'
  message: {
    id: UUID
    model: string
    role: 'assistant'
    stop_reason: string
    stop_sequence: string
    type: 'message'
    usage: Usage
    content: [ContentBlockParam]
    context_management: unknown | null
  }
}

export interface NormalizedUserMessage extends NormalizedMessage {
  type: 'user'
  message: {
    id: UUID
    role: 'user'
    content: [ContentBlockParam]
  }
}

// ============================================================================
// Renderable Message (UI rendering union)
// ============================================================================

export type RenderableMessage =
  | NormalizedUserMessage
  | NormalizedAssistantMessage
  | AttachmentMessage
  | ProgressMessage
  | SystemMessage
  | GroupedToolUseMessage
  | ToolUseSummaryMessage
  | TombstoneMessage
  | HookResultMessage

// ============================================================================
// Message (main discriminated union)
// ============================================================================

export type Message =
  | UserMessage
  | AssistantMessage
  | SystemInformationalMessage
  | SystemAPIErrorMessage
  | SystemBridgeStatusMessage
  | SystemTurnDurationMessage
  | SystemMemorySavedMessage
  | SystemStopHookSummaryMessage
  | SystemThinkingMessage
  | SystemCompactBoundaryMessage
  | SystemMicrocompactBoundaryMessage
  | SystemPermissionRetryMessage
  | SystemAgentsKilledMessage
  | SystemApiMetricsMessage
  | SystemAwaySummaryMessage
  | SystemScheduledTaskFireMessage
  | SystemLocalCommandMessage
  | ProgressMessage
  | AttachmentMessage
  | TombstoneMessage
  | ToolUseSummaryMessage
  | HookResultMessage
