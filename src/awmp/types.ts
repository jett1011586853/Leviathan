export const AWMP_VERSION = '0.1' as const

export type AwmpVersion = typeof AWMP_VERSION

export type TaskState =
  | 'submitted'
  | 'planning'
  | 'working'
  | 'validating'
  | 'approval_required'
  | 'input_required'
  | 'auth_required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'

export type AwmpMode = {
  awmp: AwmpVersion
  kind: 'Mode'
  id: string
  name: string
  version: string
  description: string
  activation: {
    intents: string[]
    examples?: string[]
    antiExamples?: string[]
  }
  inputs?: {
    accepted?: string[]
    schemas?: string[]
  }
  outputs: {
    artifacts?: Array<{
      type: string
      mediaType: string
      schema?: string
    }>
  }
  tools?: {
    mcp?: unknown[]
    openapi?: unknown[]
    local?: unknown[]
  }
  permissions?: {
    default?: string[]
    requiresApproval?: string[]
    denied?: string[]
  }
  validators?: AwmpValidator[]
  handoffs?: {
    canDelegateTo?: string[]
    canReceiveFrom?: string[]
  }
}

export type AwmpValidator = {
  id: string
  command: string
  blocking?: boolean
}

export type AwmpTask = {
  awmp: AwmpVersion
  kind: 'Task'
  id: string
  contextId: string
  title: string
  objective: string
  modeIds: string[]
  inputs?: Record<string, unknown>
  status: {
    state: TaskState
    message?: string
    timestamp?: string
  }
  constraints?: Record<string, unknown>
  artifacts?: string[]
  traceId?: string
  metadata?: Record<string, unknown>
}

export type AwmpArtifact = {
  awmp: AwmpVersion
  kind: 'Artifact'
  id: string
  taskId: string
  type: string
  mediaType: string
  uri: string
  createdBy: {
    modeId: string
    agentId: string
  }
  lineage?: string[]
  validation?: {
    status?: 'unknown' | 'pending' | 'passed' | 'failed' | 'waived'
    validators?: unknown[]
  }
  version?: number
  metadata?: Record<string, unknown>
}

export type AwmpExecutionCapsule = {
  awmp: AwmpVersion
  kind: 'ExecutionCapsule'
  id: string
  taskId: string
  workspace: string
  runtime: Record<string, unknown>
  network?: {
    mode?: 'deny' | 'allowlist' | 'open'
    allow?: string[]
  }
  filesystem?: Record<string, unknown>
  secrets?: unknown[]
  limits: Record<string, unknown>
}

export type AwmpExecutionContext = {
  awmp: AwmpVersion
  kind: 'ExecutionContext'
  id: string
  taskId: string
  traceId: string
  capsuleId: string
  generatedAt: string
  contextPath: string
  task: {
    title: string
    objective: string
    state: TaskState
    message?: string
    inputs: Record<string, unknown>
    constraints: Record<string, unknown>
  }
  modes: Array<{
    id: string
    name: string
    version: string
    description: string
    skillPath?: string
    artifactTypes: string[]
    validators: Array<{
      id: string
      blocking: boolean
    }>
    handoffs: {
      canDelegateTo?: string[]
      canReceiveFrom?: string[]
    }
  }>
  artifacts: Array<{
    id: string
    type: string
    mediaType: string
    uri: string
    validationStatus: string
    createdBy: AwmpArtifact['createdBy']
    lineage: string[]
  }>
  validators: {
    total: number
    passed: number
    failed: number
    skipped: number
    blockingFailures: string[]
  }
  toolRegistry?: {
    path: string
    total: number
    mcp: number
    openapi: number
    local: number
    approvalRequired: number
    denied: number
  }
  controlPlane?: {
    workspacePolicy?: {
      path: string
      ok: boolean
      requireModeLock: boolean
      requireModeSignature: boolean
      requireMarketplaceApproval: boolean
      selectedModeIds: string[]
      blockingDecisions: number
      decisions: Array<{
        scope: string
        status: string
        severity: string
        modeId?: string
        message: string
      }>
    }
  }
  approvals: {
    total: number
    pending: number
    approved: number
    rejected: number
  }
  handoffGraph: Array<{
    from: string
    to: string
    allowed: boolean
    reason: string
  }>
  handoffPlan?: {
    path: string
    status: AwmpHandoffPlan['status']
    steps: Array<
      Pick<
        AwmpModeStep,
        | 'id'
        | 'modeId'
        | 'status'
        | 'order'
        | 'dependsOn'
        | 'expectedArtifactTypes'
        | 'validatorIds'
        | 'handoffFrom'
        | 'handoffAllowed'
        | 'handoffReason'
        | 'message'
      >
    >
    blockedReasons: string[]
  }
  scheduler?: {
    path: string
    status: AwmpSchedulerRecord['status']
    steps: Array<
      Pick<
        AwmpSchedulerStepRecord,
        | 'id'
        | 'modeId'
        | 'planStepId'
        | 'state'
        | 'order'
        | 'dependsOn'
        | 'attemptCount'
        | 'nextAction'
        | 'blockedReason'
        | 'registeredArtifactUris'
        | 'validationSummary'
        | 'lastFailureKind'
        | 'retryable'
        | 'retryAfter'
      >
    >
  }
  missingModeIds: string[]
  nextActions: string[]
}

export type AwmpModePackage = {
  mode: AwmpMode
  root: string
  skillPath?: string
  skillText?: string
}

export type AwmpTraceEvent = {
  traceId: string
  taskId: string
  modeId?: string
  capsuleId?: string
  event: string
  timestamp: string
  actor: string
  riskLevel?: string
  data?: Record<string, unknown>
}

export type AwmpValidationResult = {
  validatorId: string
  modeId: string
  scope?: 'task' | 'scheduler_step'
  schedulerStepId?: string
  artifactIds?: string[]
  artifactUris?: string[]
  status: 'passed' | 'failed' | 'skipped'
  severity: 'info' | 'warning' | 'blocking'
  message: string
  command?: string
  exitCode?: number
  durationMs?: number
  stdout?: string
  stderr?: string
  findings?: unknown[]
}

export type AwmpSchedulerStepValidationSummary = {
  total: number
  passed: number
  failed: number
  skipped: number
  blockingFailures: string[]
  artifactIds: string[]
  artifactUris: string[]
  validationArtifactIds: string[]
  validationArtifactUris: string[]
}

export type AwmpSchedulerFailureKind =
  | 'tool_failed'
  | 'validation_failed'
  | 'approval_required'
  | 'adapter_deferred'
  | 'policy_denied'
  | 'dependency_pending'
  | 'ambiguous_tool'
  | 'handoff_blocked'

export type AwmpSchedulerRetryPolicy = {
  maxAttempts: number
  baseBackoffMs: number
  maxBackoffMs: number
}

export type AwmpOrchestrationStep = {
  state: TaskState
  status: 'started' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string
  message?: string
  data?: Record<string, unknown>
}

export type AwmpOrchestrationRecord = {
  awmp: AwmpVersion
  kind: 'OrchestrationRecord'
  id: string
  taskId: string
  traceId: string
  currentState: TaskState
  startedAt: string
  updatedAt: string
  completedAt?: string
  path: string
  steps: AwmpOrchestrationStep[]
}

export type AwmpModeStepStatus =
  | 'pending'
  | 'ready'
  | 'blocked'
  | 'completed'
  | 'skipped'

export type AwmpModeStep = {
  id: string
  modeId: string
  status: AwmpModeStepStatus
  order: number
  dependsOn: string[]
  expectedArtifactTypes: string[]
  validatorIds: string[]
  handoffFrom?: string
  handoffAllowed: boolean
  handoffReason: string
  startedAt?: string
  completedAt?: string
  message?: string
}

export type AwmpHandoffPlan = {
  awmp: AwmpVersion
  kind: 'HandoffPlan'
  taskId: string
  generatedAt: string
  path: string
  status: 'ready' | 'blocked'
  steps: AwmpModeStep[]
  blockedReasons: string[]
}

export type AwmpSchedulerStatus =
  | 'ready'
  | 'deferred'
  | 'pending'
  | 'approval_required'
  | 'blocked'
  | 'completed'
  | 'failed'

export type AwmpSchedulerStepState =
  | 'pending'
  | 'ready'
  | 'running'
  | 'deferred'
  | 'approval_required'
  | 'blocked'
  | 'completed'
  | 'failed'

export type AwmpSchedulerStepAttempt = {
  id: string
  state: Extract<
    AwmpSchedulerStepState,
    'deferred' | 'approval_required' | 'blocked' | 'completed' | 'failed'
  >
  startedAt: string
  completedAt: string
  message: string
  toolCallId?: string
  toolCallResultPath?: string
  approvalRequestId?: string
  registeredArtifactIds?: string[]
  registeredArtifactUris?: string[]
  validationSummary?: AwmpSchedulerStepValidationSummary
  failureKind?: AwmpSchedulerFailureKind
  retryable?: boolean
  retryAfter?: string
}

export type AwmpSchedulerStepRecord = {
  id: string
  planStepId: string
  modeId: string
  order: number
  state: AwmpSchedulerStepState
  dependsOn: string[]
  expectedArtifactTypes: string[]
  validatorIds: string[]
  attemptCount: number
  attempts: AwmpSchedulerStepAttempt[]
  retryPolicy?: AwmpSchedulerRetryPolicy
  nextAction?: string
  blockedReason?: string
  lastFailureKind?: AwmpSchedulerFailureKind
  retryable?: boolean
  retryAfter?: string
  lastToolId?: string
  lastToolName?: string
  lastToolCallResultPath?: string
  registeredArtifactIds?: string[]
  registeredArtifactUris?: string[]
  validationSummary?: AwmpSchedulerStepValidationSummary
  completedAt?: string
}

export type AwmpSchedulerStepRunStatus =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'pending'
  | 'approval_required'
  | 'deferred'

export type AwmpSchedulerStepRunResult = {
  awmp: AwmpVersion
  kind: 'SchedulerStepRunResult'
  runDir: string
  schedulerPath: string
  contextPath?: string
  status: AwmpSchedulerStepRunStatus
  message: string
  step: AwmpSchedulerStepRecord
  scheduler: AwmpSchedulerRecord
  toolCall?: {
    id: string
    status: string
    message: string
    resultPath: string
    approvalRequestId?: string
    exitCode?: number
    httpStatus?: number
    stdout?: string
    stderr?: string
  }
}

export type AwmpSchedulerRunResult = {
  awmp: AwmpVersion
  kind: 'SchedulerRunResult'
  runDir: string
  schedulerPath: string
  contextPath?: string
  status: AwmpSchedulerStatus
  message: string
  steps: AwmpSchedulerStepRunResult[]
  scheduler: AwmpSchedulerRecord
}

export type AwmpSchedulerRecord = {
  awmp: AwmpVersion
  kind: 'SchedulerRecord'
  id: string
  taskId: string
  traceId: string
  path: string
  status: AwmpSchedulerStatus
  createdAt: string
  updatedAt: string
  policy: {
    modeExecution: 'deferred'
    validatorExecution: 'separate_phase'
    retry: AwmpSchedulerRetryPolicy
    reason: string
  }
  steps: AwmpSchedulerStepRecord[]
}

export type AwmpRunResult = {
  task: AwmpTask
  capsule: AwmpExecutionCapsule
  runDir: string
  tracePath: string
  artifactStorePath: string
  contextPath: string
  orchestrationPath: string
  handoffPlanPath: string
  schedulerPath: string
  selectedModes: AwmpModePackage[]
  artifacts: AwmpArtifact[]
  validations: AwmpValidationResult[]
  executionContext: AwmpExecutionContext
  orchestration: AwmpOrchestrationRecord
  handoffPlan: AwmpHandoffPlan
  scheduler: AwmpSchedulerRecord
  summary: string
}
