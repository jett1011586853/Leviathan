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
