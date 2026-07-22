import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import {
  loadArtifactIndex,
  openArtifactStore,
  updateArtifactValidation,
  writeJsonArtifact,
} from './artifactStore.js'
import { buildExecutionContext } from './contextBuilder.js'
import {
  discoverModePackages,
  findModeById,
} from './modeRegistry.js'
import { sanitizePathSegment } from './paths.js'
import { appendTraceEvent, createTraceEvent } from './trace.js'
import { runModeValidators } from './validatorRunner.js'
import {
  callRegisteredTool,
  loadToolRegistry,
  type AwmpToolCallResult,
  type AwmpToolRegistryEntry,
} from './toolBroker.js'
import {
  AWMP_VERSION,
  type AwmpArtifact,
  type AwmpExecutionCapsule,
  type AwmpSchedulerFailureKind,
  type AwmpHandoffPlan,
  type AwmpSchedulerRecord,
  type AwmpSchedulerRetryPolicy,
  type AwmpSchedulerRunResult,
  type AwmpSchedulerStatus,
  type AwmpSchedulerStepRecord,
  type AwmpSchedulerStepRunResult,
  type AwmpSchedulerStepRunStatus,
  type AwmpSchedulerStepState,
  type AwmpSchedulerStepValidationSummary,
  type AwmpTask,
  type AwmpValidationResult,
} from './types.js'

const DEFAULT_RETRY_POLICY: AwmpSchedulerRetryPolicy = {
  maxAttempts: 3,
  baseBackoffMs: 5_000,
  maxBackoffMs: 60_000,
}

export async function createAwmpScheduler(input: {
  runDir: string
  tracePath: string
  task: AwmpTask
  traceId: string
  handoffPlan: AwmpHandoffPlan
}): Promise<AwmpSchedulerRecord> {
  const now = new Date().toISOString()
  const path = join(input.runDir, 'scheduler.json')
  const steps = input.handoffPlan.steps.map(planStep =>
    buildSchedulerStep(planStep, now),
  )
  const status = inferSchedulerStatus(steps)
  const scheduler = {
    awmp: AWMP_VERSION,
    kind: 'SchedulerRecord',
    id: `sched_${input.task.id}`,
    taskId: input.task.id,
    traceId: input.traceId,
    path,
    status,
    createdAt: now,
    updatedAt: now,
    policy: {
      modeExecution: 'deferred',
      validatorExecution: 'separate_phase',
      retry: DEFAULT_RETRY_POLICY,
      reason:
        'AWMP v0.1 schedules mode steps durably, but business execution is delegated to policy-checked Tool Broker calls or connected adapters.',
    },
    steps,
  } satisfies AwmpSchedulerRecord

  await mkdir(input.runDir, { recursive: true })
  await writeSchedulerRecord(scheduler)
  await traceSchedulerCreated({
    tracePath: input.tracePath,
    scheduler,
  })

  for (const step of scheduler.steps) {
    await traceSchedulerStep({
      tracePath: input.tracePath,
      scheduler,
      step,
    })
  }

  return scheduler
}

async function writeSchedulerRecord(
  scheduler: AwmpSchedulerRecord,
): Promise<void> {
  await writeFile(scheduler.path, `${JSON.stringify(scheduler, null, 2)}\n`, 'utf8')
}

export async function loadAwmpScheduler(
  runDir: string,
): Promise<AwmpSchedulerRecord> {
  const schedulerPath = join(resolve(runDir), 'scheduler.json')
  const raw = await readFile(schedulerPath, 'utf8')
  const scheduler = JSON.parse(raw) as AwmpSchedulerRecord
  if (scheduler.kind !== 'SchedulerRecord' || !Array.isArray(scheduler.steps)) {
    throw new Error('Invalid AWMP scheduler record.')
  }
  return scheduler
}

export async function runAwmpSchedulerStep(input: {
  runDir: string
  stepId?: string
  modeId?: string
  toolId?: string
  toolName?: string
  toolInput?: unknown
  approved?: boolean
  approvalId?: string
  timeoutMs?: number
  executeValidators?: boolean
  validatorTimeoutMs?: number
}): Promise<AwmpSchedulerStepRunResult> {
  const runDir = resolve(input.runDir)
  const scheduler = await loadAwmpScheduler(runDir)
  const step = resolveSchedulerStep(scheduler, {
    stepId: input.stepId,
    modeId: input.modeId,
  })
  const dependencyStatus = resolveDependencyStatus(scheduler, step)

  if (!dependencyStatus.ready) {
    const updated = updateSchedulerStep(scheduler, {
      ...step,
      state: 'pending',
      nextAction: dependencyStatus.message,
      lastFailureKind: 'dependency_pending',
      retryable: false,
      retryAfter: undefined,
    })
    await writeSchedulerRecord(updated)
    await traceSchedulerStep({
      tracePath: join(runDir, 'trace.jsonl'),
      scheduler: updated,
      step: updated.steps.find(item => item.id === step.id)!,
    })
    const contextPath = await refreshExecutionContextForScheduler({
      runDir,
      scheduler: updated,
    })
    return {
      awmp: AWMP_VERSION,
      kind: 'SchedulerStepRunResult',
      runDir,
      schedulerPath: updated.path,
      contextPath,
      status: 'pending',
      message: dependencyStatus.message,
      step: updated.steps.find(item => item.id === step.id)!,
      scheduler: updated,
    }
  }

  if (step.state === 'blocked') {
    return {
      awmp: AWMP_VERSION,
      kind: 'SchedulerStepRunResult',
      runDir,
      schedulerPath: scheduler.path,
      status: 'blocked',
      message: step.blockedReason ?? 'AWMP scheduler step is blocked.',
      step,
      scheduler,
    }
  }

  if (step.state === 'completed') {
    return {
      awmp: AWMP_VERSION,
      kind: 'SchedulerStepRunResult',
      runDir,
      schedulerPath: scheduler.path,
      status: 'completed',
      message: 'AWMP scheduler step is already completed.',
      step,
      scheduler,
    }
  }

  const toolReference = await resolveSchedulerToolReference({
    runDir,
    scheduler,
    step,
    toolId: trimmed(input.toolId),
    toolName: trimmed(input.toolName),
  })

  if (!toolReference.ready) {
    const updated = updateSchedulerStep(scheduler, {
      ...step,
      state: 'deferred',
      nextAction: toolReference.nextAction,
      lastFailureKind: toolReference.failureKind,
      retryable: false,
      retryAfter: undefined,
    })
    await writeSchedulerRecord(updated)
    await traceSchedulerStep({
      tracePath: join(runDir, 'trace.jsonl'),
      scheduler: updated,
      step: updated.steps.find(item => item.id === step.id)!,
    })
    const contextPath = await refreshExecutionContextForScheduler({
      runDir,
      scheduler: updated,
    })
    return {
      awmp: AWMP_VERSION,
      kind: 'SchedulerStepRunResult',
      runDir,
      schedulerPath: updated.path,
      contextPath,
      status: 'deferred',
      message: toolReference.message,
      step: updated.steps.find(item => item.id === step.id)!,
      scheduler: updated,
    }
  }

  if (toolReference.autoSelected) {
    await traceSchedulerToolSelected({
      tracePath: join(runDir, 'trace.jsonl'),
      scheduler,
      step,
      tool: toolReference.tool,
    })
  }

  const runningStep = {
    ...step,
    state: 'running' as const,
    nextAction: 'Tool Broker execution is in progress.',
    lastFailureKind: undefined,
    retryable: false,
    retryAfter: undefined,
  }
  let updatedScheduler = updateSchedulerStep(scheduler, runningStep)
  await writeSchedulerRecord(updatedScheduler)
  await traceSchedulerStep({
    tracePath: join(runDir, 'trace.jsonl'),
    scheduler: updatedScheduler,
    step: runningStep,
  })

  const toolCall = await callRegisteredTool({
    runDir,
    toolId: toolReference.toolId,
    toolName: toolReference.toolName,
    input: input.toolInput,
    approved: input.approved,
    approvalId: input.approvalId,
    timeoutMs: input.timeoutMs,
  })
  const registeredArtifacts =
    toolCall.status === 'completed'
      ? await registerSchedulerStepArtifacts({
          runDir,
          scheduler: updatedScheduler,
          step: runningStep,
          toolCall,
        })
      : []
  const validationResult =
    toolCall.status === 'completed'
      ? await validateSchedulerStepArtifacts({
          runDir,
          scheduler: updatedScheduler,
          step: runningStep,
          registeredArtifacts,
          executeValidators: input.executeValidators === true,
          validatorTimeoutMs: input.validatorTimeoutMs,
        })
      : {
          artifacts: [] as AwmpArtifact[],
          summary: undefined,
        }
  const completedStep = buildStepAfterToolCall({
    step: runningStep,
    toolCall,
    registeredArtifacts: [
      ...registeredArtifacts,
      ...validationResult.artifacts,
    ],
    validationSummary: validationResult.summary,
  })
  updatedScheduler = updateSchedulerStep(updatedScheduler, completedStep)
  const unlockResult =
    completedStep.state === 'completed'
      ? unlockReadySchedulerSteps(updatedScheduler)
      : {
          scheduler: updatedScheduler,
          unlockedSteps: [],
        }
  updatedScheduler = unlockResult.scheduler
  await writeSchedulerRecord(updatedScheduler)
  await traceSchedulerStep({
    tracePath: join(runDir, 'trace.jsonl'),
    scheduler: updatedScheduler,
    step: completedStep,
  })
  for (const unlockedStep of unlockResult.unlockedSteps) {
    await traceSchedulerStep({
      tracePath: join(runDir, 'trace.jsonl'),
      scheduler: updatedScheduler,
      step: unlockedStep,
    })
  }
  const contextPath = await refreshExecutionContextForScheduler({
    runDir,
    scheduler: updatedScheduler,
  })

  return {
    awmp: AWMP_VERSION,
    kind: 'SchedulerStepRunResult',
    runDir,
    schedulerPath: updatedScheduler.path,
    contextPath,
    status: mapStepStateToRunStatus(completedStep.state),
    message: messageForToolAndValidation(toolCall, validationResult.summary),
    step: completedStep,
    scheduler: updatedScheduler,
    toolCall,
  }
}

export async function retryAwmpSchedulerStep(input: {
  runDir: string
  stepId?: string
  modeId?: string
  toolId?: string
  toolName?: string
  toolInput?: unknown
  approved?: boolean
  approvalId?: string
  timeoutMs?: number
  executeValidators?: boolean
  validatorTimeoutMs?: number
  force?: boolean
}): Promise<AwmpSchedulerStepRunResult> {
  const runDir = resolve(input.runDir)
  const scheduler = await loadAwmpScheduler(runDir)
  const step = resolveSchedulerStep(scheduler, {
    stepId: input.stepId,
    modeId: input.modeId,
  })

  if (step.state !== 'failed') {
    return {
      awmp: AWMP_VERSION,
      kind: 'SchedulerStepRunResult',
      runDir,
      schedulerPath: scheduler.path,
      status: mapStepStateToRunStatus(step.state),
      message: `AWMP scheduler step ${step.id} is ${step.state}; retry-step only reruns failed retryable steps.`,
      step,
      scheduler,
    }
  }

  if (step.retryable !== true) {
    return {
      awmp: AWMP_VERSION,
      kind: 'SchedulerStepRunResult',
      runDir,
      schedulerPath: scheduler.path,
      status: 'failed',
      message: `AWMP scheduler step ${step.id} is not retryable. Failure kind: ${step.lastFailureKind ?? 'unknown'}.`,
      step,
      scheduler,
    }
  }

  const retryAvailableAt = retryAfterTimestamp(step)
  if (
    retryAvailableAt !== undefined &&
    retryAvailableAt > Date.now() &&
    input.force !== true
  ) {
    return {
      awmp: AWMP_VERSION,
      kind: 'SchedulerStepRunResult',
      runDir,
      schedulerPath: scheduler.path,
      status: 'failed',
      message: `AWMP scheduler step ${step.id} can be retried after ${step.retryAfter}. Use --force to retry immediately.`,
      step,
      scheduler,
    }
  }

  await traceSchedulerRetryRequested({
    tracePath: join(runDir, 'trace.jsonl'),
    scheduler,
    step,
    force: input.force === true,
  })

  const toolId = trimmed(input.toolId) ?? step.lastToolId
  const toolName =
    trimmed(input.toolName) ?? (toolId === undefined ? step.lastToolName : undefined)
  const toolInput =
    input.toolInput === undefined
      ? await loadPreviousToolInput(step.lastToolCallResultPath)
      : input.toolInput

  return runAwmpSchedulerStep({
    runDir,
    stepId: step.id,
    toolId,
    toolName,
    toolInput,
    approved: input.approved,
    approvalId: input.approvalId,
    timeoutMs: input.timeoutMs,
    executeValidators: input.executeValidators,
    validatorTimeoutMs: input.validatorTimeoutMs,
  })
}

export async function runAwmpScheduler(input: {
  runDir: string
  maxSteps?: number
  timeoutMs?: number
  executeValidators?: boolean
  validatorTimeoutMs?: number
}): Promise<AwmpSchedulerRunResult> {
  const runDir = resolve(input.runDir)
  const maxSteps = clampInteger(input.maxSteps ?? 20, 1, 50)
  const stepResults: AwmpSchedulerStepRunResult[] = []
  const attemptedStepIds = new Set<string>()

  for (let index = 0; index < maxSteps; index += 1) {
    const scheduler = await loadAwmpScheduler(runDir)
    const nextStep = findNextRunnableStep(scheduler, attemptedStepIds)
    if (nextStep === undefined) break

    const result = await runAwmpSchedulerStep({
      runDir,
      stepId: nextStep.id,
      timeoutMs: input.timeoutMs,
      executeValidators: input.executeValidators === true,
      validatorTimeoutMs: input.validatorTimeoutMs,
    })
    stepResults.push(result)
    attemptedStepIds.add(nextStep.id)

    if (result.status === 'completed') {
      continue
    }
  }

  const scheduler = await loadAwmpScheduler(runDir)
  const contextPath = await refreshExecutionContextForScheduler({
    runDir,
    scheduler,
  })
  return {
    awmp: AWMP_VERSION,
    kind: 'SchedulerRunResult',
    runDir,
    schedulerPath: scheduler.path,
    contextPath,
    status: scheduler.status,
    message: summarizeSchedulerRun(stepResults, scheduler),
    steps: stepResults,
    scheduler,
  }
}

function buildSchedulerStep(
  planStep: AwmpHandoffPlan['steps'][number],
  now: string,
): AwmpSchedulerStepRecord {
  if (planStep.status === 'blocked') {
    const message =
      planStep.message ?? `Handoff policy blocked mode step ${planStep.id}.`
    return {
      id: `sched_${planStep.id}`,
      planStepId: planStep.id,
      modeId: planStep.modeId,
      order: planStep.order,
      state: 'blocked',
      dependsOn: planStep.dependsOn,
      expectedArtifactTypes: planStep.expectedArtifactTypes,
      validatorIds: planStep.validatorIds,
      attemptCount: 0,
      attempts: [],
      retryPolicy: DEFAULT_RETRY_POLICY,
      lastFailureKind: 'handoff_blocked',
      retryable: false,
      blockedReason: message,
      nextAction:
        'Fix the mode handoff policy, install a compatible intermediate mode, or change the task mode order.',
    }
  }

  const message = `Mode ${planStep.modeId} is scheduled and deferred to Tool Broker or adapter execution.`
  const state = planStep.dependsOn.length === 0 ? 'deferred' : 'pending'
  return {
    id: `sched_${planStep.id}`,
    planStepId: planStep.id,
    modeId: planStep.modeId,
    order: planStep.order,
    state,
    dependsOn: planStep.dependsOn,
    expectedArtifactTypes: planStep.expectedArtifactTypes,
    validatorIds: planStep.validatorIds,
    attemptCount: 0,
    attempts: [],
    retryPolicy: DEFAULT_RETRY_POLICY,
    retryable: false,
    nextAction:
      state === 'pending'
        ? 'Wait for dependency steps to complete before executing this mode step.'
        : 'Use policy-checked Tool Broker calls or a connected AWMP adapter to execute this mode step and register produced artifacts.',
  }
}

function inferSchedulerStatus(
  steps: AwmpSchedulerStepRecord[],
): AwmpSchedulerStatus {
  if (steps.some(step => step.state === 'blocked')) return 'blocked'
  if (steps.some(step => step.state === 'failed')) return 'failed'
  if (steps.some(step => step.state === 'approval_required')) {
    return 'approval_required'
  }
  if (steps.some(step => step.state === 'deferred')) return 'deferred'
  if (steps.some(step => step.state === 'pending')) return 'pending'
  if (steps.every(step => step.state === 'completed')) return 'completed'
  return 'ready'
}

function resolveSchedulerStep(
  scheduler: AwmpSchedulerRecord,
  input: { stepId?: string; modeId?: string },
): AwmpSchedulerStepRecord {
  if (input.stepId !== undefined) {
    const match = scheduler.steps.find(
      step => step.id === input.stepId || step.planStepId === input.stepId,
    )
    if (match !== undefined) return match
    if (input.modeId === undefined) {
      throw new Error(`AWMP scheduler step not found: ${input.stepId}`)
    }
  }

  if (input.modeId !== undefined) {
    const matches = scheduler.steps.filter(step => step.modeId === input.modeId)
    if (matches.length === 1) return matches[0]!
    if (matches.length > 1) {
      throw new Error(
        `AWMP scheduler mode id is ambiguous: ${input.modeId}. Use step_id instead.`,
      )
    }
    throw new Error(`AWMP scheduler mode id not found: ${input.modeId}`)
  }

  throw new Error('step_id or mode_id is required.')
}

function resolveDependencyStatus(
  scheduler: AwmpSchedulerRecord,
  step: AwmpSchedulerStepRecord,
): { ready: true } | { ready: false; message: string } {
  const incomplete = step.dependsOn.filter(dependencyId => {
    const dependency = scheduler.steps.find(
      item => item.id === dependencyId || item.planStepId === dependencyId,
    )
    return dependency === undefined || dependency.state !== 'completed'
  })

  if (incomplete.length === 0) return { ready: true }

  return {
    ready: false,
    message: `Waiting for dependency step(s): ${incomplete.join(', ')}`,
  }
}

function findNextRunnableStep(
  scheduler: AwmpSchedulerRecord,
  attemptedStepIds: Set<string>,
): AwmpSchedulerStepRecord | undefined {
  return [...scheduler.steps]
    .sort((left, right) => left.order - right.order)
    .find(step => {
      if (attemptedStepIds.has(step.id)) return false
      if (step.state !== 'deferred' && step.state !== 'ready') return false
      return resolveDependencyStatus(scheduler, step).ready
    })
}

function updateSchedulerStep(
  scheduler: AwmpSchedulerRecord,
  step: AwmpSchedulerStepRecord,
): AwmpSchedulerRecord {
  const updatedSteps = scheduler.steps.map(item =>
    item.id === step.id ? step : item,
  )
  return {
    ...scheduler,
    status: inferSchedulerStatus(updatedSteps),
    updatedAt: new Date().toISOString(),
    steps: updatedSteps,
  }
}

function unlockReadySchedulerSteps(scheduler: AwmpSchedulerRecord): {
  scheduler: AwmpSchedulerRecord
  unlockedSteps: AwmpSchedulerStepRecord[]
} {
  const unlockedSteps: AwmpSchedulerStepRecord[] = []
  const updatedSteps = scheduler.steps.map(step => {
    if (step.state !== 'pending') return step
    if (!resolveDependencyStatus(scheduler, step).ready) return step
    const unlocked = {
      ...step,
      state: 'deferred' as const,
      nextAction:
        'Dependencies completed. Use policy-checked Tool Broker calls or a connected AWMP adapter to execute this mode step and register produced artifacts.',
    }
    unlockedSteps.push(unlocked)
    return unlocked
  })

  if (unlockedSteps.length === 0) {
    return {
      scheduler,
      unlockedSteps,
    }
  }

  return {
    scheduler: {
      ...scheduler,
      status: inferSchedulerStatus(updatedSteps),
      updatedAt: new Date().toISOString(),
      steps: updatedSteps,
    },
    unlockedSteps,
  }
}

function buildStepAfterToolCall(input: {
  step: AwmpSchedulerStepRecord
  toolCall: AwmpToolCallResult
  registeredArtifacts: AwmpArtifact[]
  validationSummary?: AwmpSchedulerStepValidationSummary
}): AwmpSchedulerStepRecord {
  const state =
    input.validationSummary !== undefined &&
    input.validationSummary.blockingFailures.length > 0
      ? 'failed'
      : mapToolStatusToStepState(input.toolCall.status)
  const validationFailed =
    input.validationSummary !== undefined &&
    input.validationSummary.blockingFailures.length > 0
  const attemptState = validationFailed
    ? 'failed'
    : mapToolStatusToAttemptState(input.toolCall.status)
  const attemptCount = input.step.attemptCount + 1
  const failureKind = failureKindForToolCall({
    toolCall: input.toolCall,
    validationFailed,
  })
  const retryPolicy = input.step.retryPolicy ?? DEFAULT_RETRY_POLICY
  const retryable = isRetryableFailure({
    state,
    failureKind,
    attemptCount,
    retryPolicy,
  })
  const retryAfter =
    retryable && failureKind !== undefined
      ? computeRetryAfter({
          completedAt: input.toolCall.completedAt,
          attemptCount,
          retryPolicy,
        })
      : undefined
  const registeredArtifactIds = input.registeredArtifacts.map(
    artifact => artifact.id,
  )
  const registeredArtifactUris = input.registeredArtifacts.map(
    artifact => artifact.uri,
  )
  const attempt = {
    id: `attempt_${String(attemptCount).padStart(2, '0')}_${input.step.planStepId}`,
    state: attemptState,
    startedAt: input.toolCall.startedAt,
    completedAt: input.toolCall.completedAt,
    message: messageForToolAndValidation(
      input.toolCall,
      input.validationSummary,
    ),
    toolCallId: input.toolCall.id,
    toolCallResultPath: input.toolCall.resultPath,
    approvalRequestId: input.toolCall.approvalRequestId,
    registeredArtifactIds,
    registeredArtifactUris,
    validationSummary: input.validationSummary,
    failureKind,
    retryable,
    retryAfter,
  } satisfies AwmpSchedulerStepRecord['attempts'][number]
  return {
    ...input.step,
    state,
    attemptCount,
    attempts: [...input.step.attempts, attempt],
    retryPolicy,
    nextAction: nextActionForFailure({
      validationSummary: input.validationSummary,
      toolCall: input.toolCall,
      retryable,
      retryAfter,
    }),
    blockedReason:
      state === 'blocked' ? input.toolCall.message : input.step.blockedReason,
    lastFailureKind: failureKind,
    retryable,
    retryAfter,
    lastToolId: input.toolCall.tool.id,
    lastToolName: input.toolCall.tool.name,
    lastToolCallResultPath: input.toolCall.resultPath,
    registeredArtifactIds: [
      ...(input.step.registeredArtifactIds ?? []),
      ...registeredArtifactIds,
    ],
    registeredArtifactUris: [
      ...(input.step.registeredArtifactUris ?? []),
      ...registeredArtifactUris,
    ],
    validationSummary: input.validationSummary ?? input.step.validationSummary,
    completedAt:
      state === 'completed' ? input.toolCall.completedAt : input.step.completedAt,
  }
}

function failureKindForToolCall(input: {
  toolCall: AwmpToolCallResult
  validationFailed: boolean
}): AwmpSchedulerFailureKind | undefined {
  if (input.validationFailed) return 'validation_failed'
  if (input.toolCall.status === 'failed') return 'tool_failed'
  if (input.toolCall.status === 'approval_required') return 'approval_required'
  if (input.toolCall.status === 'deferred') return 'adapter_deferred'
  if (input.toolCall.status === 'denied') return 'policy_denied'
  return undefined
}

function isRetryableFailure(input: {
  state: AwmpSchedulerStepState
  failureKind?: AwmpSchedulerFailureKind
  attemptCount: number
  retryPolicy: AwmpSchedulerRetryPolicy
}): boolean {
  if (input.state !== 'failed') return false
  if (
    input.failureKind !== 'tool_failed' &&
    input.failureKind !== 'validation_failed'
  ) {
    return false
  }
  return input.attemptCount < input.retryPolicy.maxAttempts
}

function computeRetryAfter(input: {
  completedAt: string
  attemptCount: number
  retryPolicy: AwmpSchedulerRetryPolicy
}): string {
  const base = Math.max(0, input.retryPolicy.baseBackoffMs)
  const max = Math.max(base, input.retryPolicy.maxBackoffMs)
  const exponent = Math.max(0, input.attemptCount - 1)
  const backoffMs = Math.min(base * 2 ** exponent, max)
  const completedAtMs = Date.parse(input.completedAt)
  const startMs = Number.isFinite(completedAtMs) ? completedAtMs : Date.now()
  return new Date(startMs + backoffMs).toISOString()
}

function mapToolStatusToStepState(
  status: AwmpToolCallResult['status'],
): AwmpSchedulerStepState {
  if (status === 'completed') return 'completed'
  if (status === 'approval_required') return 'approval_required'
  if (status === 'deferred') return 'deferred'
  if (status === 'denied') return 'blocked'
  return 'failed'
}

function mapToolStatusToAttemptState(
  status: AwmpToolCallResult['status'],
): AwmpSchedulerStepRecord['attempts'][number]['state'] {
  if (status === 'completed') return 'completed'
  if (status === 'approval_required') return 'approval_required'
  if (status === 'deferred') return 'deferred'
  if (status === 'denied') return 'blocked'
  return 'failed'
}

function mapToolStatusToRunStatus(
  status: AwmpToolCallResult['status'],
): AwmpSchedulerStepRunStatus {
  if (status === 'denied') return 'blocked'
  return status
}

function mapStepStateToRunStatus(
  state: AwmpSchedulerStepState,
): AwmpSchedulerStepRunStatus {
  if (state === 'blocked') return 'blocked'
  if (state === 'approval_required') return 'approval_required'
  if (state === 'pending') return 'pending'
  if (state === 'deferred') return 'deferred'
  if (state === 'completed') return 'completed'
  return 'failed'
}

function nextActionForToolCall(toolCall: AwmpToolCallResult): string {
  if (toolCall.status === 'completed') {
    return 'Register or validate produced artifacts, then continue dependent scheduler steps.'
  }
  if (toolCall.status === 'approval_required') {
    return `Approve or reject approval request ${toolCall.approvalRequestId ?? '<missing>'}, then rerun this scheduler step with the approval id.`
  }
  if (toolCall.status === 'deferred') {
    return 'Connect the required AWMP adapter or session MCP tool, then rerun this scheduler step.'
  }
  if (toolCall.status === 'denied') {
    return 'Change the mode permission policy or choose a different allowed tool.'
  }
  return 'Inspect the tool call result and retry after fixing the failure.'
}

function nextActionForFailure(input: {
  validationSummary: AwmpSchedulerStepValidationSummary | undefined
  toolCall: AwmpToolCallResult
  retryable: boolean
  retryAfter?: string
}): string {
  const base =
    input.validationSummary !== undefined &&
    input.validationSummary.blockingFailures.length > 0
      ? `Fix blocking validator failure(s): ${input.validationSummary.blockingFailures.join(', ')}.`
      : nextActionForToolCall(input.toolCall)

  if (!input.retryable) return base

  return [
    base,
    `Retry is available after ${input.retryAfter ?? '<now>'} with /awmp retry-step or AWMP.retry_scheduler_step.`,
  ].join(' ')
}

function messageForToolAndValidation(
  toolCall: AwmpToolCallResult,
  summary: AwmpSchedulerStepValidationSummary | undefined,
): string {
  if (summary === undefined || summary.blockingFailures.length === 0) {
    return toolCall.message
  }
  return `${toolCall.message} Blocking validator failure(s): ${summary.blockingFailures.join(', ')}.`
}

function summarizeSchedulerRun(
  stepResults: AwmpSchedulerStepRunResult[],
  scheduler: AwmpSchedulerRecord,
): string {
  if (stepResults.length === 0) {
    return `AWMP scheduler ${scheduler.id} had no runnable deferred steps. Current status: ${scheduler.status}.`
  }

  const completed = stepResults.filter(result => result.status === 'completed')
    .length
  const stopped = stepResults.filter(result => result.status !== 'completed')
  if (stopped.length === 0) {
    return `AWMP scheduler ${scheduler.id} ran ${stepResults.length} step(s); ${completed} completed. Current status: ${scheduler.status}.`
  }

  return `AWMP scheduler ${scheduler.id} ran ${stepResults.length} step(s); ${completed} completed, ${stopped.length} need follow-up. Current status: ${scheduler.status}.`
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function retryAfterTimestamp(
  step: AwmpSchedulerStepRecord,
): number | undefined {
  if (step.retryAfter === undefined) return undefined
  const timestamp = Date.parse(step.retryAfter)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

async function loadPreviousToolInput(
  resultPath: string | undefined,
): Promise<unknown> {
  if (resultPath === undefined) return undefined
  const previous = await readJsonFile<AwmpToolCallResult>(resultPath).catch(
    () => undefined,
  )
  return previous?.input
}

async function traceSchedulerCreated(input: {
  tracePath: string
  scheduler: AwmpSchedulerRecord
}): Promise<void> {
  await appendTraceEvent(
    input.tracePath,
    createTraceEvent({
      traceId: input.scheduler.traceId,
      taskId: input.scheduler.taskId,
      event: 'scheduler.created',
      data: {
        schedulerId: input.scheduler.id,
        status: input.scheduler.status,
        stepCount: input.scheduler.steps.length,
        path: input.scheduler.path,
      },
    }),
  )
}

async function traceSchedulerStep(input: {
  tracePath: string
  scheduler: AwmpSchedulerRecord
  step: AwmpSchedulerStepRecord
}): Promise<void> {
  await appendTraceEvent(
    input.tracePath,
    createTraceEvent({
      traceId: input.scheduler.traceId,
      taskId: input.scheduler.taskId,
      modeId: input.step.modeId,
      event: `scheduler.step.${input.step.state}`,
      data: {
        schedulerId: input.scheduler.id,
        stepId: input.step.id,
        planStepId: input.step.planStepId,
        order: input.step.order,
        attempts: input.step.attemptCount,
        nextAction: input.step.nextAction,
        blockedReason: input.step.blockedReason,
        lastFailureKind: input.step.lastFailureKind,
        retryable: input.step.retryable,
        retryAfter: input.step.retryAfter,
      },
    }),
  )
}

async function traceSchedulerRetryRequested(input: {
  tracePath: string
  scheduler: AwmpSchedulerRecord
  step: AwmpSchedulerStepRecord
  force: boolean
}): Promise<void> {
  await appendTraceEvent(
    input.tracePath,
    createTraceEvent({
      traceId: input.scheduler.traceId,
      taskId: input.scheduler.taskId,
      modeId: input.step.modeId,
      event: 'scheduler.step.retry_requested',
      data: {
        schedulerId: input.scheduler.id,
        stepId: input.step.id,
        planStepId: input.step.planStepId,
        attemptCount: input.step.attemptCount,
        lastFailureKind: input.step.lastFailureKind,
        retryAfter: input.step.retryAfter,
        force: input.force,
      },
    }),
  )
}

type SchedulerToolResolution =
  | {
      ready: true
      toolId?: string
      toolName?: string
      autoSelected: false
    }
  | {
      ready: true
      toolId: string
      toolName?: string
      autoSelected: true
      tool: AwmpToolRegistryEntry
    }
  | {
      ready: false
      message: string
      nextAction: string
      failureKind: AwmpSchedulerFailureKind
    }

async function resolveSchedulerToolReference(input: {
  runDir: string
  scheduler: AwmpSchedulerRecord
  step: AwmpSchedulerStepRecord
  toolId?: string
  toolName?: string
}): Promise<SchedulerToolResolution> {
  if (input.toolId !== undefined || input.toolName !== undefined) {
    return {
      ready: true,
      toolId: input.toolId,
      toolName: input.toolName,
      autoSelected: false,
    }
  }

  const registry = await loadToolRegistry(input.runDir)
  const candidates = registry.entries.filter(
    entry =>
      entry.modeId === input.step.modeId && entry.policy.decision !== 'denied',
  )
  if (candidates.length === 0) {
    return {
      ready: false,
      message:
        `No usable Tool Broker tools are registered for scheduler step ${input.step.id} (${input.step.modeId}).`,
      nextAction:
        'Install or declare a non-denied tool for this mode, or provide tool_id/tool_name explicitly after updating the mode package.',
      failureKind: 'adapter_deferred',
    }
  }

  const ranked = [...candidates].sort(compareToolCandidates)
  const best = ranked[0]!
  const bestRank = toolCandidateRank(best)
  const tied = ranked.filter(
    candidate => compareRanks(toolCandidateRank(candidate), bestRank) === 0,
  )

  if (tied.length > 1) {
    return {
      ready: false,
      message:
        `Multiple equally preferred tools are registered for scheduler step ${input.step.id}: ${tied
          .map(candidate => `${candidate.name} (${candidate.id})`)
          .join(', ')}.`,
      nextAction:
        'Rerun this scheduler step with an explicit tool_id to avoid ambiguous execution.',
      failureKind: 'ambiguous_tool',
    }
  }

  return {
    ready: true,
    toolId: best.id,
    autoSelected: true,
    tool: best,
  }
}

function compareToolCandidates(
  left: AwmpToolRegistryEntry,
  right: AwmpToolRegistryEntry,
): number {
  const rankComparison = compareRanks(toolCandidateRank(left), toolCandidateRank(right))
  if (rankComparison !== 0) return rankComparison
  return left.id.localeCompare(right.id)
}

function toolCandidateRank(entry: AwmpToolRegistryEntry): [number, number] {
  return [
    entry.policy.decision === 'available' ? 0 : 1,
    entry.kind === 'local' ? 0 : entry.kind === 'openapi' ? 1 : 2,
  ]
}

function compareRanks(left: [number, number], right: [number, number]): number {
  return left[0] - right[0] || left[1] - right[1]
}

async function registerSchedulerStepArtifacts(input: {
  runDir: string
  scheduler: AwmpSchedulerRecord
  step: AwmpSchedulerStepRecord
  toolCall: AwmpToolCallResult
}): Promise<AwmpArtifact[]> {
  const store = await openArtifactStore({
    runDir: input.runDir,
    taskId: input.scheduler.taskId,
  })
  const registered: AwmpArtifact[] = []

  registered.push(
    await writeJsonArtifact(store, {
      type: 'awmp.scheduler_step_result',
      fileName: schedulerStepArtifactFileName(input.step, input.toolCall),
      content: {
        awmp: AWMP_VERSION,
        kind: 'SchedulerStepResult',
        schedulerId: input.scheduler.id,
        stepId: input.step.id,
        planStepId: input.step.planStepId,
        modeId: input.step.modeId,
        toolCall: {
          id: input.toolCall.id,
          status: input.toolCall.status,
          message: input.toolCall.message,
          resultPath: input.toolCall.resultPath,
          tool: {
            id: input.toolCall.tool.id,
            name: input.toolCall.tool.name,
            kind: input.toolCall.tool.kind,
          },
          exitCode: input.toolCall.exitCode,
          httpStatus: input.toolCall.httpStatus,
          stdout: input.toolCall.stdout,
          stderr: input.toolCall.stderr,
        },
      },
      createdBy: {
        modeId: input.step.modeId,
        agentId: 'awmp-scheduler',
      },
      lineage: [input.toolCall.resultPath],
      metadata: {
        schedulerId: input.scheduler.id,
        stepId: input.step.id,
        toolCallId: input.toolCall.id,
        runtimeArtifact: true,
      },
    }),
  )

  for (const declaredArtifact of extractDeclaredArtifacts(input.toolCall.stdout)) {
    if (!input.step.expectedArtifactTypes.includes(declaredArtifact.type)) {
      continue
    }
    if (
      declaredArtifact.mediaType !== undefined &&
      declaredArtifact.mediaType !== 'application/json'
    ) {
      continue
    }
    registered.push(
      await writeJsonArtifact(store, {
        type: declaredArtifact.type,
        fileName:
          declaredArtifact.fileName ??
          `${input.step.id}_${declaredArtifact.type}_${input.toolCall.id}.json`,
        content: declaredArtifact.content,
        mediaType: 'application/json',
        createdBy: {
          modeId: input.step.modeId,
          agentId: 'awmp-scheduler',
        },
        lineage: [input.toolCall.resultPath],
        metadata: {
          schedulerId: input.scheduler.id,
          stepId: input.step.id,
          toolCallId: input.toolCall.id,
          declaredByTool: input.toolCall.tool.id,
        },
      }),
    )
  }

  for (const artifact of registered) {
    await traceSchedulerArtifactRegistered({
      tracePath: join(input.runDir, 'trace.jsonl'),
      scheduler: input.scheduler,
      step: input.step,
      artifact,
      toolCall: input.toolCall,
    })
  }

  return registered
}

async function validateSchedulerStepArtifacts(input: {
  runDir: string
  scheduler: AwmpSchedulerRecord
  step: AwmpSchedulerStepRecord
  registeredArtifacts: AwmpArtifact[]
  executeValidators: boolean
  validatorTimeoutMs?: number
}): Promise<{
  artifacts: AwmpArtifact[]
  summary?: AwmpSchedulerStepValidationSummary
}> {
  const modePackages = await discoverModePackages([join(input.runDir, 'modes')])
  const modePackage = findModeById(modePackages, input.step.modeId)
  if (modePackage === undefined || (modePackage.mode.validators ?? []).length === 0) {
    return {
      artifacts: [],
    }
  }

  const validatedArtifacts = input.registeredArtifacts.filter(artifact =>
    input.step.expectedArtifactTypes.includes(artifact.type),
  )
  const artifactIds = validatedArtifacts.map(artifact => artifact.id)
  const artifactUris = validatedArtifacts.map(artifact => artifact.uri)
  const validationResults = (
    await runModeValidators({
      modePackages: [modePackage],
      allowExecution: input.executeValidators,
      runDir: input.runDir,
      taskPath: join(input.runDir, 'task.json'),
      artifactIndexPath: join(input.runDir, 'artifacts', 'index.json'),
      timeoutMs: input.validatorTimeoutMs,
    })
  ).map(result => ({
    ...result,
    scope: 'scheduler_step' as const,
    schedulerStepId: input.step.id,
    artifactIds,
    artifactUris,
  }))

  await appendSchedulerStepValidations({
    runDir: input.runDir,
    results: validationResults,
  })
  for (const result of validationResults) {
    await traceSchedulerValidationResult({
      tracePath: join(input.runDir, 'trace.jsonl'),
      scheduler: input.scheduler,
      step: input.step,
      result,
    })
  }

  const summary = summarizeSchedulerStepValidations({
    results: validationResults,
    artifactIds,
    artifactUris,
    validationArtifacts: [],
  })
  const store = await openArtifactStore({
    runDir: input.runDir,
    taskId: input.scheduler.taskId,
  })
  const validationArtifact = await writeJsonArtifact(store, {
    type: 'awmp.scheduler_step_validation',
    fileName: schedulerStepValidationArtifactFileName(input.step),
    content: {
      awmp: AWMP_VERSION,
      kind: 'SchedulerStepValidation',
      schedulerId: input.scheduler.id,
      stepId: input.step.id,
      planStepId: input.step.planStepId,
      modeId: input.step.modeId,
      executed: input.executeValidators,
      artifactIds,
      artifactUris,
      summary,
      results: validationResults,
    },
    createdBy: {
      modeId: input.step.modeId,
      agentId: 'awmp-scheduler',
    },
    lineage: artifactUris,
    validation: {
      status: artifactValidationStatus(summary),
      validators: validationResults.map(toArtifactValidatorRecord),
    },
    metadata: {
      schedulerId: input.scheduler.id,
      stepId: input.step.id,
      validatorExecution: input.executeValidators ? 'executed' : 'inspected',
      runtimeArtifact: true,
    },
  })
  await traceSchedulerArtifactRegistered({
    tracePath: join(input.runDir, 'trace.jsonl'),
    scheduler: input.scheduler,
    step: input.step,
    artifact: validationArtifact,
    source: 'scheduler_step_validation',
  })

  if (artifactIds.length > 0) {
    await updateArtifactValidation(store, {
      artifactIds,
      validation: {
        status: artifactValidationStatus(summary),
        validators: validationResults.map(toArtifactValidatorRecord),
      },
    })
  }

  return {
    artifacts: [validationArtifact],
    summary: {
      ...summary,
      validationArtifactIds: [validationArtifact.id],
      validationArtifactUris: [validationArtifact.uri],
    },
  }
}

type DeclaredToolArtifact = {
  type: string
  mediaType?: string
  fileName?: string
  content: unknown
}

function extractDeclaredArtifacts(stdout: string | undefined): DeclaredToolArtifact[] {
  if (stdout === undefined) return []
  const parsed = parseJson(stdout.trim())
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) {
    return []
  }
  const record = parsed as Record<string, unknown>
  const values = [
    ...asArray(record.artifacts),
    ...(record.artifact === undefined ? [] : [record.artifact]),
  ]
  return values.flatMap(value => {
    const artifact = asRecord(value)
    const type = stringValue(artifact.type)
    if (type === undefined) return []
    return [
      {
        type,
        mediaType: stringValue(artifact.mediaType),
        fileName: stringValue(artifact.fileName),
        content:
          artifact.content === undefined
            ? artifact.data === undefined
              ? artifact
              : artifact.data
            : artifact.content,
      },
    ]
  })
}

function parseJson(value: string): unknown | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function schedulerStepArtifactFileName(
  step: AwmpSchedulerStepRecord,
  toolCall: AwmpToolCallResult,
): string {
  return [
    'scheduler_step_result',
    sanitizePathSegment(step.id),
    sanitizePathSegment(toolCall.id),
  ].join('_') + '.json'
}

function schedulerStepValidationArtifactFileName(
  step: AwmpSchedulerStepRecord,
): string {
  return [
    'scheduler_step_validation',
    sanitizePathSegment(step.id),
    sanitizePathSegment(new Date().toISOString()),
  ].join('_') + '.json'
}

async function appendSchedulerStepValidations(input: {
  runDir: string
  results: AwmpValidationResult[]
}): Promise<void> {
  const validationsPath = join(input.runDir, 'validations.json')
  const existing = await readJsonFile<AwmpValidationResult[]>(validationsPath).catch(
    () => [],
  )
  await writeFile(
    validationsPath,
    `${JSON.stringify([...existing, ...input.results], null, 2)}\n`,
    'utf8',
  )
}

function summarizeSchedulerStepValidations(input: {
  results: AwmpValidationResult[]
  artifactIds: string[]
  artifactUris: string[]
  validationArtifacts: AwmpArtifact[]
}): AwmpSchedulerStepValidationSummary {
  const blockingFailures = input.results
    .filter(result => result.status === 'failed' && result.severity === 'blocking')
    .map(result => `${result.modeId}.${result.validatorId}`)
  return {
    total: input.results.length,
    passed: input.results.filter(result => result.status === 'passed').length,
    failed: input.results.filter(result => result.status === 'failed').length,
    skipped: input.results.filter(result => result.status === 'skipped').length,
    blockingFailures,
    artifactIds: input.artifactIds,
    artifactUris: input.artifactUris,
    validationArtifactIds: input.validationArtifacts.map(artifact => artifact.id),
    validationArtifactUris: input.validationArtifacts.map(artifact => artifact.uri),
  }
}

function artifactValidationStatus(
  summary: AwmpSchedulerStepValidationSummary,
): NonNullable<AwmpArtifact['validation']>['status'] {
  if (summary.failed > 0) return 'failed'
  if (summary.total > 0 && summary.passed === summary.total) return 'passed'
  if (summary.skipped > 0) return 'pending'
  return 'unknown'
}

function toArtifactValidatorRecord(result: AwmpValidationResult): Record<string, unknown> {
  return {
    id: result.validatorId,
    modeId: result.modeId,
    scope: result.scope,
    schedulerStepId: result.schedulerStepId,
    status: result.status,
    severity: result.severity,
    message: result.message,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    artifactIds: result.artifactIds,
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function trimmed(value: string | undefined): string | undefined {
  const clean = value?.trim()
  return clean ? clean : undefined
}

async function traceSchedulerToolSelected(input: {
  tracePath: string
  scheduler: AwmpSchedulerRecord
  step: AwmpSchedulerStepRecord
  tool: AwmpToolRegistryEntry
}): Promise<void> {
  await appendTraceEvent(
    input.tracePath,
    createTraceEvent({
      traceId: input.scheduler.traceId,
      taskId: input.scheduler.taskId,
      modeId: input.step.modeId,
      event: 'scheduler.tool.selected',
      data: {
        schedulerId: input.scheduler.id,
        stepId: input.step.id,
        toolId: input.tool.id,
        toolName: input.tool.name,
        toolKind: input.tool.kind,
        policyDecision: input.tool.policy.decision,
      },
    }),
  )
}

async function traceSchedulerArtifactRegistered(input: {
  tracePath: string
  scheduler: AwmpSchedulerRecord
  step: AwmpSchedulerStepRecord
  artifact: AwmpArtifact
  toolCall?: AwmpToolCallResult
  source?: string
}): Promise<void> {
  await appendTraceEvent(
    input.tracePath,
    createTraceEvent({
      traceId: input.scheduler.traceId,
      taskId: input.scheduler.taskId,
      modeId: input.step.modeId,
      event: 'artifact.written',
      data: {
        schedulerId: input.scheduler.id,
        stepId: input.step.id,
        toolCallId: input.toolCall?.id,
        artifactId: input.artifact.id,
        artifactType: input.artifact.type,
        artifactUri: input.artifact.uri,
        source: input.source ?? 'scheduler_step',
      },
    }),
  )
}

async function traceSchedulerValidationResult(input: {
  tracePath: string
  scheduler: AwmpSchedulerRecord
  step: AwmpSchedulerStepRecord
  result: AwmpValidationResult
}): Promise<void> {
  await appendTraceEvent(
    input.tracePath,
    createTraceEvent({
      traceId: input.scheduler.traceId,
      taskId: input.scheduler.taskId,
      modeId: input.step.modeId,
      event: 'validator.finished',
      data: {
        schedulerId: input.scheduler.id,
        stepId: input.step.id,
        validatorId: input.result.validatorId,
        status: input.result.status,
        severity: input.result.severity,
        exitCode: input.result.exitCode,
        durationMs: input.result.durationMs,
        source: 'scheduler_step',
        artifactIds: input.result.artifactIds,
      },
    }),
  )
}

async function refreshExecutionContextForScheduler(input: {
  runDir: string
  scheduler: AwmpSchedulerRecord
}): Promise<string> {
  const [
    task,
    capsule,
    handoffPlan,
    validations,
    artifacts,
    selectedModes,
  ] = await Promise.all([
    readJsonFile<AwmpTask>(join(input.runDir, 'task.json')),
    readJsonFile<AwmpExecutionCapsule>(join(input.runDir, 'capsule.json')),
    readJsonFile<AwmpHandoffPlan>(join(input.runDir, 'handoff_plan.json')),
    readJsonFile<AwmpValidationResult[]>(join(input.runDir, 'validations.json')),
    loadArtifactIndex(input.runDir),
    discoverModePackages([join(input.runDir, 'modes')]),
  ])
  const selectedModeIds = new Set(
    selectedModes.map(modePackage => modePackage.mode.id),
  )
  const context = await buildExecutionContext({
    runDir: input.runDir,
    task,
    capsule,
    selectedModes,
    artifacts,
    validations,
    traceId: input.scheduler.traceId,
    missingModeIds: task.modeIds.filter(modeId => !selectedModeIds.has(modeId)),
    handoffPlan,
    scheduler: input.scheduler,
  })
  await appendTraceEvent(
    join(input.runDir, 'trace.jsonl'),
    createTraceEvent({
      traceId: input.scheduler.traceId,
      taskId: input.scheduler.taskId,
      event: 'context.built',
      data: {
        contextPath: context.contextPath,
        schedulerId: input.scheduler.id,
        schedulerStatus: input.scheduler.status,
        source: 'scheduler_step',
      },
    }),
  )
  return context.contextPath
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}
