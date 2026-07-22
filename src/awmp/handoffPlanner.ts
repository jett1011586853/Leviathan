import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { appendTraceEvent, createTraceEvent } from './trace.js'
import {
  AWMP_VERSION,
  type AwmpHandoffPlan,
  type AwmpModePackage,
  type AwmpModeStep,
  type AwmpTask,
} from './types.js'

export async function buildHandoffPlan(input: {
  runDir: string
  task: AwmpTask
  selectedModes: AwmpModePackage[]
  tracePath: string
  traceId: string
}): Promise<AwmpHandoffPlan> {
  const planPath = join(input.runDir, 'handoff_plan.json')
  const steps: AwmpModeStep[] = []
  const blockedReasons: string[] = []

  for (let index = 0; index < input.selectedModes.length; index += 1) {
    const modePackage = input.selectedModes[index]!
    const previousModePackage = input.selectedModes[index - 1]
    const previousStep = steps[index - 1]
    const policy =
      previousModePackage === undefined
        ? {
            allowed: true,
            reason: 'first mode starts the task and does not require an incoming handoff',
          }
        : evaluateAdjacentHandoff(previousModePackage, modePackage)
    const dependencyAllowed =
      previousStep === undefined || previousStep.status !== 'blocked'
    const blockedByDependency =
      previousStep !== undefined && previousStep.status === 'blocked'
    const status = policy.allowed && dependencyAllowed ? 'ready' : 'blocked'
    const message = blockedByDependency
      ? `Dependency ${previousStep.id} is blocked.`
      : policy.allowed
        ? undefined
        : policy.reason

    if (status === 'blocked') {
      blockedReasons.push(
        message === undefined
          ? `Blocked handoff before ${modePackage.mode.id}.`
          : message,
      )
    }

    steps.push({
      id: `step_${String(index + 1).padStart(2, '0')}_${safeStepId(modePackage.mode.id)}`,
      modeId: modePackage.mode.id,
      status,
      order: index + 1,
      dependsOn: previousStep === undefined ? [] : [previousStep.id],
      expectedArtifactTypes:
        modePackage.mode.outputs.artifacts?.map(artifact => artifact.type) ?? [],
      validatorIds:
        modePackage.mode.validators?.map(validator => validator.id) ?? [],
      handoffFrom: previousModePackage?.mode.id,
      handoffAllowed: policy.allowed,
      handoffReason: policy.reason,
      message,
    })
  }

  const plan = {
    awmp: AWMP_VERSION,
    kind: 'HandoffPlan',
    taskId: input.task.id,
    generatedAt: new Date().toISOString(),
    path: planPath,
    status: blockedReasons.length === 0 ? 'ready' : 'blocked',
    steps,
    blockedReasons,
  } satisfies AwmpHandoffPlan

  await mkdir(input.runDir, { recursive: true })
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  await appendTraceEvent(
    input.tracePath,
    createTraceEvent({
      traceId: input.traceId,
      taskId: input.task.id,
      event: 'handoff.plan.created',
      data: {
        status: plan.status,
        stepCount: plan.steps.length,
        blockedReasons: plan.blockedReasons,
      },
    }),
  )

  return plan
}

function evaluateAdjacentHandoff(
  from: AwmpModePackage,
  to: AwmpModePackage,
): { allowed: boolean; reason: string } {
  const canDelegateTo = from.mode.handoffs?.canDelegateTo
  const canReceiveFrom = to.mode.handoffs?.canReceiveFrom
  const delegateOk =
    canDelegateTo === undefined || canDelegateTo.includes(to.mode.id)
  const receiveOk =
    canReceiveFrom === undefined || canReceiveFrom.includes(from.mode.id)

  if (delegateOk && receiveOk) {
    return {
      allowed: true,
      reason: `${from.mode.id} -> ${to.mode.id} is permitted by adjacent handoff policy`,
    }
  }

  const reasons = [
    delegateOk
      ? undefined
      : `${from.mode.id} cannot delegate to ${to.mode.id}`,
    receiveOk
      ? undefined
      : `${to.mode.id} cannot receive from ${from.mode.id}`,
  ].filter((item): item is string => item !== undefined)

  return {
    allowed: false,
    reason: `${from.mode.id} -> ${to.mode.id} blocked: ${reasons.join('; ')}`,
  }
}

function safeStepId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_')
}
