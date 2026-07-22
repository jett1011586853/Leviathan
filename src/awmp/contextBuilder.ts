import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { listApprovalRequests } from './approvalStore.js'
import type {
  AwmpArtifact,
  AwmpExecutionCapsule,
  AwmpExecutionContext,
  AwmpHandoffPlan,
  AwmpModePackage,
  AwmpSchedulerRecord,
  AwmpTask,
  AwmpValidationResult,
} from './types.js'

export async function buildExecutionContext(input: {
  runDir: string
  task: AwmpTask
  capsule: AwmpExecutionCapsule
  selectedModes: AwmpModePackage[]
  artifacts: AwmpArtifact[]
  validations: AwmpValidationResult[]
  traceId: string
  missingModeIds: string[]
  handoffPlan: AwmpHandoffPlan
  scheduler: AwmpSchedulerRecord
}): Promise<AwmpExecutionContext> {
  const runDir = resolve(input.runDir)
  const contextDir = join(runDir, 'context')
  const contextPath = join(contextDir, 'execution_context.json')
  const toolRegistry = await readToolRegistrySummary(runDir)
  const controlPlane = await readControlPlaneSummary(runDir)
  const approvals = await listApprovalRequests(runDir)
  const context: AwmpExecutionContext = {
    awmp: '0.1',
    kind: 'ExecutionContext',
    id: `ctx_snapshot_${input.task.id}`,
    taskId: input.task.id,
    traceId: input.traceId,
    capsuleId: input.capsule.id,
    generatedAt: new Date().toISOString(),
    contextPath,
    task: {
      title: input.task.title,
      objective: input.task.objective,
      state: input.task.status.state,
      message: input.task.status.message,
      inputs: input.task.inputs ?? {},
      constraints: input.task.constraints ?? {},
    },
    modes: input.selectedModes.map(modePackage => ({
      id: modePackage.mode.id,
      name: modePackage.mode.name,
      version: modePackage.mode.version,
      description: modePackage.mode.description,
      skillPath: modePackage.skillPath,
      artifactTypes:
        modePackage.mode.outputs.artifacts?.map(artifact => artifact.type) ?? [],
      validators:
        modePackage.mode.validators?.map(validator => ({
          id: validator.id,
          blocking: validator.blocking !== false,
        })) ?? [],
      handoffs: modePackage.mode.handoffs ?? {},
    })),
    artifacts: input.artifacts.map(artifact => ({
      id: artifact.id,
      type: artifact.type,
      mediaType: artifact.mediaType,
      uri: artifact.uri,
      validationStatus: artifact.validation?.status ?? 'unknown',
      createdBy: artifact.createdBy,
      lineage: artifact.lineage ?? [],
    })),
    validators: summarizeValidations(input.validations),
    toolRegistry,
    controlPlane,
    approvals: {
      total: approvals.approvals.length,
      pending: approvals.approvals.filter(approval => approval.status === 'pending')
        .length,
      approved: approvals.approvals.filter(
        approval => approval.status === 'approved',
      ).length,
      rejected: approvals.approvals.filter(
        approval => approval.status === 'rejected',
      ).length,
    },
    handoffGraph: buildHandoffGraph(input.selectedModes),
    handoffPlan: {
      path: input.handoffPlan.path,
      status: input.handoffPlan.status,
      steps: input.handoffPlan.steps.map(step => ({
        id: step.id,
        modeId: step.modeId,
        status: step.status,
        order: step.order,
        dependsOn: step.dependsOn,
        expectedArtifactTypes: step.expectedArtifactTypes,
        validatorIds: step.validatorIds,
        handoffFrom: step.handoffFrom,
        handoffAllowed: step.handoffAllowed,
        handoffReason: step.handoffReason,
        message: step.message,
      })),
      blockedReasons: input.handoffPlan.blockedReasons,
    },
    scheduler: {
      path: input.scheduler.path,
      status: input.scheduler.status,
      steps: input.scheduler.steps.map(step => ({
        id: step.id,
        modeId: step.modeId,
        planStepId: step.planStepId,
        state: step.state,
        order: step.order,
        dependsOn: step.dependsOn,
        attemptCount: step.attemptCount,
        nextAction: step.nextAction,
        blockedReason: step.blockedReason,
        registeredArtifactUris: step.registeredArtifactUris,
        validationSummary: step.validationSummary,
        lastFailureKind: step.lastFailureKind,
        retryable: step.retryable,
        retryAfter: step.retryAfter,
      })),
    },
    missingModeIds: input.missingModeIds,
    nextActions: inferNextActions({
      missingModeIds: input.missingModeIds,
      validations: input.validations,
      handoffPlan: input.handoffPlan,
      scheduler: input.scheduler,
      pendingApprovals: approvals.approvals.filter(
        approval => approval.status === 'pending',
      ).length,
    }),
  }

  await mkdir(contextDir, { recursive: true })
  await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, 'utf8')
  return context
}

async function readControlPlaneSummary(
  runDir: string,
): Promise<AwmpExecutionContext['controlPlane']> {
  try {
    const path = join(runDir, 'artifacts', 'governance_policy.json')
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as {
      workspacePolicy?: {
        ok?: unknown
        requireModeLock?: unknown
        requireModeSignature?: unknown
        requireMarketplaceApproval?: unknown
        selectedModeIds?: unknown
        decisions?: Array<{
          scope?: unknown
          status?: unknown
          severity?: unknown
          modeId?: unknown
          message?: unknown
        }>
      }
    }
    const decisions =
      parsed.workspacePolicy?.decisions
        ?.map(decision => ({
          scope: stringValue(decision.scope),
          status: stringValue(decision.status),
          severity: stringValue(decision.severity),
          modeId:
            typeof decision.modeId === 'string' ? decision.modeId : undefined,
          message: stringValue(decision.message),
        }))
        .filter(decision => decision.scope && decision.status && decision.message) ??
      []
    return {
      workspacePolicy: {
        path,
        ok: parsed.workspacePolicy?.ok === true,
        requireModeLock: parsed.workspacePolicy?.requireModeLock === true,
        requireModeSignature:
          parsed.workspacePolicy?.requireModeSignature === true,
        requireMarketplaceApproval:
          parsed.workspacePolicy?.requireMarketplaceApproval === true,
        selectedModeIds: readStringArray(
          parsed.workspacePolicy?.selectedModeIds,
        ),
        blockingDecisions: decisions.filter(
          decision => decision.severity === 'blocking',
        ).length,
        decisions,
      },
    }
  } catch {
    return undefined
  }
}

async function readToolRegistrySummary(
  runDir: string,
): Promise<AwmpExecutionContext['toolRegistry']> {
  try {
    const path = join(runDir, 'artifacts', 'tool_registry.json')
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as {
      summary?: Record<string, unknown>
      entries?: Array<{ kind?: string; policy?: { decision?: string } }>
    }
    return {
      path,
      total: numberValue(parsed.summary?.total),
      mcp: numberValue(parsed.summary?.mcp),
      openapi: numberValue(parsed.summary?.openapi),
      local: numberValue(parsed.summary?.local),
      approvalRequired: numberValue(parsed.summary?.approvalRequired),
      denied: numberValue(parsed.summary?.denied),
    }
  } catch {
    return undefined
  }
}

function summarizeValidations(validations: AwmpValidationResult[]) {
  return {
    total: validations.length,
    passed: validations.filter(validation => validation.status === 'passed').length,
    failed: validations.filter(validation => validation.status === 'failed').length,
    skipped: validations.filter(validation => validation.status === 'skipped').length,
    blockingFailures: validations
      .filter(
        validation =>
          validation.status === 'failed' && validation.severity === 'blocking',
      )
      .map(validation => `${validation.modeId}.${validation.validatorId}`),
  }
}

function buildHandoffGraph(
  selectedModes: AwmpModePackage[],
): AwmpExecutionContext['handoffGraph'] {
  const edges: AwmpExecutionContext['handoffGraph'] = []
  for (let i = 0; i < selectedModes.length - 1; i += 1) {
    const from = selectedModes[i]!
    const to = selectedModes[i + 1]!
    const canDelegateTo = from.mode.handoffs?.canDelegateTo
    const canReceiveFrom = to.mode.handoffs?.canReceiveFrom
    const delegateOk =
      canDelegateTo === undefined || canDelegateTo.includes(to.mode.id)
    const receiveOk =
      canReceiveFrom === undefined || canReceiveFrom.includes(from.mode.id)
    edges.push({
      from: from.mode.id,
      to: to.mode.id,
      allowed: delegateOk && receiveOk,
      reason:
        delegateOk && receiveOk
          ? 'handoff policy permits this adjacent mode transition'
          : 'handoff policy does not permit this adjacent mode transition',
    })
  }
  return edges
}

function inferNextActions(input: {
  missingModeIds: string[]
  validations: AwmpValidationResult[]
  handoffPlan: AwmpHandoffPlan
  scheduler: AwmpSchedulerRecord
  pendingApprovals: number
}): string[] {
  if (input.missingModeIds.length > 0) {
    return ['Install or provide the missing mode packages before execution.']
  }

  if (input.handoffPlan.status === 'blocked') {
    return [
      'Fix blocked AWMP handoff policy before executing this multi-mode task.',
    ]
  }

  if (input.scheduler.status === 'blocked') {
    return ['Resolve blocked AWMP scheduler steps before continuing execution.']
  }

  if (input.scheduler.status === 'approval_required') {
    return ['Review scheduler approval requests, then rerun the gated step.']
  }

  if (input.scheduler.status === 'failed') {
    const retryableSteps = input.scheduler.steps.filter(
      step => step.state === 'failed' && step.retryable === true,
    )
    if (retryableSteps.length > 0) {
      return [
        `Retry failed AWMP scheduler step(s) after backoff: ${retryableSteps
          .map(step => `${step.id}${step.retryAfter ? ` after ${step.retryAfter}` : ''}`)
          .join(', ')}.`,
      ]
    }
    return ['Inspect failed AWMP scheduler steps before continuing execution.']
  }

  const blockingFailures = input.validations.filter(
    validation =>
      validation.status === 'failed' && validation.severity === 'blocking',
  )
  if (blockingFailures.length > 0) {
    return ['Fix blocking validator failures, then rerun the AWMP task.']
  }

  if (input.pendingApprovals > 0) {
    return ['Review pending AWMP approvals before executing gated tools.']
  }

  if (input.scheduler.status === 'deferred') {
    return [
      'Resume deferred AWMP scheduler steps through policy-checked Tool Broker calls or connected adapters.',
    ]
  }

  return [
    'Use policy-checked Tool Broker calls for any declared external action.',
    'Write additional business artifacts through the Artifact Store API.',
  ]
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
