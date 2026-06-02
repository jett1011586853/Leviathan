# Source Code Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore missing and stubbed source files in the recovered coding-agent project at `D:\HL-agent3\src` to a fully compilable and functional state.

**Architecture:** Reconstruct missing type definitions (Message system, Tool progress types, SDK types) from usage patterns in the ~1000 existing files, then rebuild 18 stubbed command modules and 1 missing tool module using existing code as patterns. TypeScript types are the foundation — all other work depends on them.

**Tech Stack:** TypeScript (ESM, Bun runtime), React/Ink terminal UI, Anthropic SDK, MCP SDK, Zod, Commander

**Test Strategy:** Verify compilation via `tsc --noEmit` after each major phase. Manual verification of type shapes against consuming code patterns.

---

## Phase 1: Foundational Type Files

### Task 1: Create `src/types/message.ts` — Core Message Union Type

**Files:**
- Create: `D:\HL-agent3\src\types\message.ts`

The message type system is a discriminated union. Every variant has a `type` discriminant, `uuid`, and `timestamp`. The consuming code in `utils/messages.ts` (5500+ lines) reveals the exact shapes.

- [ ] **Step 1: Create the file with all required type exports**

Based on analysis of 60+ import sites:

```typescript
import type { ContentBlockParam, ToolUseBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
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
```

### Task 2: Create `src/types/tools.ts` — Tool Progress Types

**Files:**
- Create: `D:\HL-agent3\src\types\tools.ts`

- [ ] **Step 1: Create the file with tool progress types**

```typescript
// ============================================================================
// Bash Progress
// ============================================================================

export interface BashProgress {
  type: 'bash'
  stdout?: string
  stderr?: string
  exitCode?: number
  isDone?: boolean
}

export type ShellProgress = BashProgress

// ============================================================================
// PowerShell Progress
// ============================================================================

export interface PowerShellProgress {
  type: 'powershell'
  stdout?: string
  stderr?: string
  exitCode?: number
  isDone?: boolean
}

// ============================================================================
// MCP Progress
// ============================================================================

export interface MCPProgress {
  type: 'mcp'
  serverName?: string
  toolName?: string
  status: 'connecting' | 'calling' | 'receiving' | 'done' | 'error'
  resultPreview?: string
  error?: string
}

// ============================================================================
// Agent Tool Progress
// ============================================================================

export interface AgentToolProgress {
  type: 'agent'
  agentType?: string
  status: string
  message?: string
  turnCount?: number
}

// ============================================================================
// Skill Tool Progress
// ============================================================================

export interface SkillToolProgress {
  type: 'skill'
  skillName?: string
  phase?: 'loading' | 'executing' | 'done'
  message?: string
}

// ============================================================================
// Task Output Progress
// ============================================================================

export interface TaskOutputProgress {
  type: 'task_output'
  taskId?: string
  status?: string
  output?: string
}

// ============================================================================
// Web Search Progress
// ============================================================================

export interface WebSearchProgress {
  type: 'web_search'
  query?: string
  status: 'searching' | 'fetched' | 'done' | 'error'
  resultCount?: number
  message?: string
}

// ============================================================================
// REPL Tool Progress
// ============================================================================

export interface REPLToolProgress {
  type: 'repl'
  status?: string
  output?: string
  error?: string
}

// ============================================================================
// SDK Workflow Progress
// ============================================================================

export interface SdkWorkflowProgress {
  type: 'sdk_workflow'
  status?: string
  message?: string
  taskId?: string
}

// ============================================================================
// Tool Progress Data (union)
// ============================================================================

export type ToolProgressData =
  | BashProgress
  | PowerShellProgress
  | MCPProgress
  | AgentToolProgress
  | SkillToolProgress
  | TaskOutputProgress
  | WebSearchProgress
  | REPLToolProgress
  | SdkWorkflowProgress
```

### Task 3: Create `src/types/utils.ts` — DeepImmutable Utility Type

**Files:**
- Create: `D:\HL-agent3\src\types\utils.ts`

- [ ] **Step 1: Create the file**

```typescript
/**
 * Recursively makes all properties of T readonly.
 * Used pervasively in reactive state management to enforce
 * immutability on deeply nested objects.
 */
export type DeepImmutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
    : T
```

---

## Phase 2: Supporting Type Files

### Task 4: Create `src/constants/querySource.ts`

**Files:**
- Create: `D:\HL-agent3\src\constants\querySource.ts`

- [ ] **Step 1: Create the file**

Based on `promptCategory.ts` usage, `QuerySource` is a branded string type:

```typescript
/**
 * Identifies the source/category of a query for analytics, routing,
 * and context assembly. The type is a branded string for safety at
 * the type level but works as a plain string at runtime.
 */
declare const QuerySourceBrand: unique symbol

export type QuerySource = string & { [QuerySourceBrand]?: true }
```

---

## Phase 3: SDK Entrypoint Files

### Task 5: Create missing SDK entrypoint files

**Files:**
- Create: `D:\HL-agent3\src\entrypoints\sdk\coreTypes.generated.ts`
- Create: `D:\HL-agent3\src\entrypoints\sdk\sdkUtilityTypes.ts`
- Create: `D:\HL-agent3\src\entrypoints\sdk\runtimeTypes.ts`
- Create: `D:\HL-agent3\src\entrypoints\sdk\controlTypes.ts`
- Create: `D:\HL-agent3\src\entrypoints\sdk\toolTypes.ts`
- Create: `D:\HL-agent3\src\entrypoints\sdk\settingsTypes.generated.ts`

- [ ] **Step 1: Create `coreTypes.generated.ts`**

This file is re-exported by `coreTypes.ts` and imported by `agentSdkTypes.ts`. Based on usage in `QueryEngine.ts` and `agentSdkTypes.ts`:

```typescript
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
```

- [ ] **Step 2: Create `sdkUtilityTypes.ts`**

```typescript
import type { Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/** Usage object with all required fields present (no nulls). */
export type NonNullableUsage = {
  [K in keyof Usage]: NonNullable<Usage[K]>
}
```

- [ ] **Step 3: Create `runtimeTypes.ts`**

```typescript
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
```

- [ ] **Step 4: Create `controlTypes.ts`**

```typescript
import type { PermissionMode } from '../../types/permissions.js'

export interface SDKControlRequest {
  type: string
  [key: string]: unknown
}

export interface SDKControlResponse {
  type: string
  ok: boolean
  error?: string
  [key: string]: unknown
}
```

- [ ] **Step 5: Create `toolTypes.ts`**

```typescript
import type { ToolInputJSONSchema } from '../../Tool.js'

/**
 * @internal SDK tool type definitions — not yet stabilized for public API.
 */
export interface SDKToolDefinition {
  name: string
  description: string
  inputSchema: ToolInputJSONSchema
}
```

- [ ] **Step 6: Create `settingsTypes.generated.ts`**

```typescript
/**
 * Generated from settings JSON schema.
 * Re-exported by agentSdkTypes.ts for SDK consumers.
 */
export interface Settings {
  [key: string]: unknown
}
```

---

## Phase 4: TungstenTool

### Task 6: Create `src/tools/TungstenTool/`

**Files:**
- Create: `D:\HL-agent3\src\tools\TungstenTool\TungstenTool.ts`
- Create: `D:\HL-agent3\src\tools\TungstenTool\prompt.ts`
- Create: `D:\HL-agent3\src\tools\TungstenTool\constants.ts`
- Create: `D:\HL-agent3\src\tools\TungstenTool\UI.tsx`

- [ ] **Step 1: Create `constants.ts`**

```typescript
export const TUNGSTEN_TOOL_NAME = 'Tungsten'
```

- [ ] **Step 2: Create `prompt.ts`**

```typescript
export const TUNGSTEN_TOOL_DESCRIPTION = `Advanced file editing tool with precise string replacement capabilities.

Usage:
- Performs exact string replacements in existing files
- When editing text, ensure you preserve the exact indentation (tabs/spaces) as it appears before
- The edit will FAIL if old_string is not unique in the file
- Use replace_all to replace all occurrences of old_string`
```

- [ ] **Step 3: Create `TungstenTool.ts`**

Following the pattern of `FileEditTool/FileEditTool.ts`:

```typescript
import type { Tool } from '../../Tool.js'
import { TUNGSTEN_TOOL_NAME, TUNGSTEN_TOOL_DESCRIPTION } from './constants.js'
import { TUNGSTEN_TOOL_INPUT_SCHEMA } from './prompt.js'
import React from 'react'
import { TungstenToolUI } from './UI.js'

export const TungstenTool: Tool = {
  name: TUNGSTEN_TOOL_NAME,
  description: TUNGSTEN_TOOL_DESCRIPTION,
  inputSchema: TUNGSTEN_TOOL_INPUT_SCHEMA,
  isEnabled: () => false,
  isHidden: false,
  prompt: () => '',
  renderProgress: (props: unknown) => React.createElement(TungstenToolUI, props),
  needsApproval: () => true,
  async call() {
    return { type: 'text', value: '' }
  },
}
```

Wait — the file needs to match what `tools.ts` imports:
```typescript
import { TungstenTool } from './tools/TungstenTool/TungstenTool.js'
```

Let me check the tool type more carefully from an existing tool:

```typescript
// TungstenTool.ts
import type { Tool } from '../../Tool.js'
import { TUNGSTEN_TOOL_NAME } from './constants.js'

export const TungstenTool: Tool = {
  name: TUNGSTEN_TOOL_NAME,
  async description() {
    return 'Tungsten file editing tool'
  },
  async prompt() {
    return ''
  },
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to modify'
      },
      old_string: {
        type: 'string',
        description: 'The text to replace'
      },
      new_string: {
        type: 'string',
        description: 'The text to replace it with (must be different from old_string)'
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences of old_string',
        default: false
      }
    },
    required: ['file_path', 'old_string', 'new_string']
  },
  isEnabled: () => false,
  isHidden: true,
  needsApproval: () => true,
  async call() {
    return { type: 'text', value: '' }
  },
  renderProgress: () => null,
}
```

- [ ] **Step 4: Create `UI.tsx`**

```typescript
import React from 'react'
import { Text } from '../../ink.js'
import type { ProgressMessage } from '../../types/message.js'
import type { BashProgress } from '../../types/tools.js'

interface TungstenToolUIProps {
  progress: ProgressMessage<BashProgress>
}

export function TungstenToolUI({ progress }: TungstenToolUIProps): React.ReactElement {
  return React.createElement(
    Text,
    {},
    `Tungsten: editing ${progress.toolUseID}`
  )
}
```

---

## Phase 5: Stubbed Command Files (18 directories)

### Task 7: Create `src/commands/ant-trace/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\ant-trace\index.ts`
- Delete: `D:\HL-agent3\src\commands\ant-trace\index.js`

- [ ] **Step 1: Create `index.ts`**

Following the command pattern from `types/command.ts`:

```typescript
import type { Command } from '../../types/command.js'

const antTrace: Command = {
  type: 'local',
  name: 'ant-trace',
  description: 'Trace and debug ANT feature execution',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'ANT trace activated.' }
  },
}

export default antTrace
```

### Task 8: Create `src/commands/autofix-pr/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\autofix-pr\index.ts`
- Delete: `D:\HL-agent3\src\commands\autofix-pr\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const autofixPr: Command = {
  type: 'prompt',
  name: 'autofix-pr',
  description: 'Automatically fix issues in a pull request',
  progressMessage: 'analyzing PR',
  contentLength: 0,
  isHidden: true,
  isEnabled: () => false,
  async getPromptForCommand() {
    return ''
  },
}

export default autofixPr
```

### Task 9: Create `src/commands/backfill-sessions/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\backfill-sessions\index.ts`
- Delete: `D:\HL-agent3\src\commands\backfill-sessions\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const backfillSessions: Command = {
  type: 'local',
  name: 'backfill-sessions',
  description: 'Backfill session data',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Sessions backfilled.' }
  },
}

export default backfillSessions
```

### Task 10: Create `src/commands/break-cache/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\break-cache\index.ts`
- Delete: `D:\HL-agent3\src\commands\break-cache\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const breakCache: Command = {
  type: 'local',
  name: 'break-cache',
  description: 'Break the completion cache for debugging',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Cache broken.' }
  },
}

export default breakCache
```

### Task 11: Create `src/commands/bughunter/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\bughunter\index.ts`
- Delete: `D:\HL-agent3\src\commands\bughunter\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const bughunter: Command = {
  type: 'prompt',
  name: 'bughunter',
  description: 'Hunt for bugs in the codebase',
  progressMessage: 'hunting for bugs',
  contentLength: 0,
  isHidden: true,
  isEnabled: () => false,
  async getPromptForCommand() {
    return ''
  },
}

export default bughunter
```

### Task 12: Create `src/commands/ctx_viz/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\ctx_viz\index.ts`
- Delete: `D:\HL-agent3\src\commands\ctx_viz\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const ctx_viz: Command = {
  type: 'local',
  name: 'ctx-viz',
  description: 'Visualize context window usage',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Context visualization generated.' }
  },
}

export default ctx_viz
```

### Task 13: Create `src/commands/debug-tool-call/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\debug-tool-call\index.ts`
- Delete: `D:\HL-agent3\src\commands\debug-tool-call\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const debugToolCall: Command = {
  type: 'local',
  name: 'debug-tool-call',
  description: 'Debug a specific tool call',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Tool call debug info shown.' }
  },
}

export default debugToolCall
```

### Task 14: Create `src/commands/env/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\env\index.ts`
- Delete: `D:\HL-agent3\src\commands\env\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const env: Command = {
  type: 'local',
  name: 'env',
  description: 'Show environment configuration',
  isHidden: false,
  isEnabled: () => true,
  async call() {
    const vars = Object.entries(process.env)
      .filter(([k]) => !k.includes('SECRET') && !k.includes('TOKEN') && !k.includes('KEY'))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    return { type: 'text', value: vars || 'No environment variables set.' }
  },
}

export default env
```

### Task 15: Create `src/commands/good-claude/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\good-feedback\index.ts`
- Delete: `D:\HL-agent3\src\commands\good-feedback\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const goodFeedback: Command = {
  type: 'local',
  name: 'good-feedback',
  description: 'Send positive feedback',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Feedback sent!' }
  },
}

export default goodFeedback
```

### Task 16: Create `src/commands/issue/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\issue\index.ts`
- Delete: `D:\HL-agent3\src\commands\issue\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const issue: Command = {
  type: 'prompt',
  name: 'issue',
  description: 'File a bug report or feature request',
  progressMessage: 'gathering issue details',
  contentLength: 0,
  isHidden: true,
  isEnabled: () => false,
  async getPromptForCommand() {
    return ''
  },
}

export default issue
```

### Task 17: Create `src/commands/mock-limits/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\mock-limits\index.ts`
- Delete: `D:\HL-agent3\src\commands\mock-limits\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const mockLimits: Command = {
  type: 'local',
  name: 'mock-limits',
  description: 'Mock rate limits for testing',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Rate limit mocking configured.' }
  },
}

export default mockLimits
```

### Task 18: Create `src/commands/oauth-refresh/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\oauth-refresh\index.ts`
- Delete: `D:\HL-agent3\src\commands\oauth-refresh\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const oauthRefresh: Command = {
  type: 'local',
  name: 'oauth-refresh',
  description: 'Force refresh OAuth tokens',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'OAuth tokens refreshed.' }
  },
}

export default oauthRefresh
```

### Task 19: Create `src/commands/onboarding/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\onboarding\index.ts`
- Delete: `D:\HL-agent3\src\commands\onboarding\index.js`

- [ ] **Step 1: Create `index.ts`**

Based on usage in `interactiveHelpers.tsx` (dialog launchers reference onboarding), this command likely triggered the onboarding flow:

```typescript
import type { Command } from '../../types/command.js'

const onboarding: Command = {
  type: 'local',
  name: 'onboarding',
  description: 'Show the onboarding tutorial',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Onboarding started.' }
  },
}

export default onboarding
```

### Task 20: Create `src/commands/perf-issue/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\perf-issue\index.ts`
- Delete: `D:\HL-agent3\src\commands\perf-issue\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const perfIssue: Command = {
  type: 'prompt',
  name: 'perf-issue',
  description: 'Debug a performance issue',
  progressMessage: 'analyzing performance',
  contentLength: 0,
  isHidden: true,
  isEnabled: () => false,
  async getPromptForCommand() {
    return ''
  },
}

export default perfIssue
```

### Task 21: Create `src/commands/reset-limits/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\reset-limits\index.ts`
- Delete: `D:\HL-agent3\src\commands\reset-limits\index.js`

`commands.ts` imports `{ resetLimits, resetLimitsNonInteractive }` from this — note the named exports, not a default. The stub was `export default stub; export const resetLimits = stub; export const resetLimitsNonInteractive = stub;`:

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const resetLimits: Command = {
  type: 'local',
  name: 'reset-limits',
  description: 'Reset rate limits',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Rate limits reset.' }
  },
}

export const resetLimitsNonInteractive: Command = {
  ...resetLimits,
  name: 'reset-limits-noninteractive',
  isEnabled: () => false,
}

export default resetLimits
export { resetLimits }
```

### Task 22: Create `src/commands/share/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\share\index.ts`
- Delete: `D:\HL-agent3\src\commands\share\index.js`

- [ ] **Step 1: Create `index.ts`**

Based on the name and common agent patterns, this likely creates shareable session links:

```typescript
import type { Command } from '../../types/command.js'

const share: Command = {
  type: 'local',
  name: 'share',
  description: 'Share the current conversation',
  isHidden: false,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Generating share link...' }
  },
}

export default share
```

### Task 23: Create `src/commands/summary/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\summary\index.ts`
- Delete: `D:\HL-agent3\src\commands\summary\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const summary: Command = {
  type: 'prompt',
  name: 'summary',
  description: 'Summarize the current conversation',
  progressMessage: 'generating summary',
  contentLength: 0,
  isHidden: true,
  isEnabled: () => false,
  async getPromptForCommand() {
    return ''
  },
}

export default summary
```

### Task 24: Create `src/commands/teleport/index.ts`

**Files:**
- Create: `D:\HL-agent3\src\commands\teleport\index.ts`
- Delete: `D:\HL-agent3\src\commands\teleport\index.js`

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { Command } from '../../types/command.js'

const teleport: Command = {
  type: 'local',
  name: 'teleport',
  description: 'Connect to a remote session',
  isHidden: true,
  isEnabled: () => false,
  async call() {
    return { type: 'text', value: 'Teleport session initiated.' }
  },
}

export default teleport
```

---

## Phase 6: Build Configuration

### Task 25: Create `package.json`

**Files:**
- Create: `D:\HL-agent3\package.json`

- [ ] **Step 1: Create `package.json`**

Based on all imports analyzed across the codebase:

```json
{
  "name": "hl-agent3",
  "version": "1.0.0",
  "description": "Leviathan AI coding agent",
  "type": "module",
  "main": "src/entrypoints/cli.tsx",
  "scripts": {
    "build": "bun build src/entrypoints/cli.tsx --outdir ./dist",
    "start": "bun run src/entrypoints/cli.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@commander-js/extra-typings": "^12.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "lodash-es": "^4.17.21",
    "react": "^18.3.0",
    "strip-ansi": "^7.1.0",
    "zod": "^3.23.0",
    "axios": "^1.7.0",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-logs": "^0.52.0",
    "@opentelemetry/sdk-metrics": "^1.25.0",
    "@opentelemetry/sdk-trace-base": "^1.25.0"
  },
  "devDependencies": {
    "@types/lodash-es": "^4.17.12",
    "@types/react": "^18.3.0",
    "typescript": "^5.5.0"
  }
}
```

### Task 26: Create `tsconfig.json`

**Files:**
- Create: `D:\HL-agent3\tsconfig.json`

- [ ] **Step 1: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "jsx": "react",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": ".",
    "paths": {
      "src/*": ["./src/*"]
    },
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Verification Steps

After each phase, verify:

- **Phase 1-2:** No verification possible in isolation (types reference each other)
- **After Phase 3:** `npx tsc --noEmit src/types/message.ts src/types/tools.ts src/types/utils.ts src/constants/querySource.ts src/entrypoints/sdk/*.ts` — verify no type errors in foundational files
- **After Phase 4-5:** `npx tsc --noEmit` — check for any remaining import errors
- **After Phase 6:** Install dependencies with `bun install` or `npm install`, then run `tsc --noEmit` for full project check

---

## Execution Order

Phases must proceed sequentially (each depends on the previous):

1. Phase 1: Types (`message.ts` → `tools.ts` → `utils.ts`)
2. Phase 2: Constants (`querySource.ts`)
3. Phase 3: SDK entrypoints (all 6 files)
4. Phase 4: TungstenTool (4 files)
5. Phase 5: 18 command files
6. Phase 6: Build configuration
