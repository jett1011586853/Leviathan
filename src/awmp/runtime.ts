import { randomUUID } from 'crypto'
import { cp, mkdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { AwmpExecutionCapsuleSchema, AwmpTaskSchema } from './schemas.js'
import {
  createArtifactStore,
  writeArtifactIndex,
  writeJsonArtifact,
  type AwmpArtifactStoreHandle,
} from './artifactStore.js'
import { buildExecutionContext } from './contextBuilder.js'
import { buildHandoffPlan } from './handoffPlanner.js'
import {
  completeAwmpOrchestration,
  startAwmpOrchestration,
  transitionAwmpOrchestration,
} from './orchestrator.js'
import { createAwmpScheduler } from './scheduler.js'
import {
  getAwmpStateRoot,
  resolveModeRoots,
  sanitizePathSegment,
} from './paths.js'
import {
  discoverModePackages,
  findModeById,
  searchModes,
} from './modeRegistry.js'
import { createTraceEvent, appendTraceEvent } from './trace.js'
import { runModeValidators } from './validatorRunner.js'
import { buildToolRegistry } from './toolBroker.js'
import {
  assertWorkspacePolicyAllowed,
  checkWorkspacePolicy,
  type AwmpWorkspacePolicyCheck,
} from './workspacePolicy.js'
import type {
  AwmpArtifact,
  AwmpExecutionCapsule,
  AwmpHandoffPlan,
  AwmpModePackage,
  AwmpRunResult,
  AwmpSchedulerRecord,
  AwmpTask,
} from './types.js'

export type AwmpRunOptions = {
  cwd?: string
  modeRoots?: string[]
  policyPath?: string
  executeValidators?: boolean
  validatorTimeoutMs?: number
}

export type AwmpRouteResult = {
  modeRoots: string[]
  candidates: ReturnType<typeof searchModes>
}

export async function loadAwmpTaskFile(taskPath: string): Promise<AwmpTask> {
  const raw = await readFile(resolve(taskPath), 'utf8')
  const parsed = AwmpTaskSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(`Invalid AWMP task file: ${parsed.error.message}`)
  }
  return parsed.data
}

export async function routeAwmpRequest(options: {
  query: string
  cwd?: string
  modeRoots?: string[]
  taskPath?: string
}): Promise<AwmpRouteResult> {
  const modeRoots = resolveModeRoots({
    cwd: options.cwd,
    explicitModeRoots: options.modeRoots,
    taskPath: options.taskPath,
  })
  const modes = await discoverModePackages(modeRoots)
  return {
    modeRoots,
    candidates: searchModes(options.query, modes),
  }
}

export async function runAwmpTaskFile(
  taskPath: string,
  options: AwmpRunOptions = {},
): Promise<AwmpRunResult> {
  const absoluteTaskPath = resolve(taskPath)
  const task = await loadAwmpTaskFile(absoluteTaskPath)
  return runAwmpTask(task, {
    ...options,
    taskPath: absoluteTaskPath,
  })
}

export async function runAwmpTask(
  task: AwmpTask,
  options: AwmpRunOptions & { taskPath?: string } = {},
): Promise<AwmpRunResult> {
  const modeRoots = resolveModeRoots({
    cwd: options.cwd,
    explicitModeRoots: options.modeRoots,
    taskPath: options.taskPath,
  })
  const discoveredModes = await discoverModePackages(modeRoots)
  const selectedModes = selectModesForTask(task, discoveredModes)
  const missingModeIds = task.modeIds.filter(
    modeId => findModeById(selectedModes, modeId) === undefined,
  )
  const workspacePolicyCheck = await checkWorkspacePolicy({
    cwd: options.cwd,
    policyPath: options.policyPath,
    selectedModes,
  })
  assertWorkspacePolicyAllowed(workspacePolicyCheck)

  const runDir = await createRunDir(task, options.cwd)
  const tracePath = join(runDir, 'trace.jsonl')
  const capsule = createCapsule(task, runDir)
  const artifactStore = await createArtifactStore({
    runDir,
    taskId: task.id,
  })

  await mkdir(join(runDir, 'workspace'), { recursive: true })
  await mkdir(join(runDir, 'modes'), { recursive: true })

  const traceId = task.traceId ?? `trace_${randomUUID()}`
  let orchestration = await startAwmpOrchestration({
    runDir,
    tracePath,
    task,
    traceId,
  })
  await trace(tracePath, traceId, task.id, 'task.created', {
    taskPath: options.taskPath,
    modeRoots,
    workspacePolicyPath: workspacePolicyCheck.policyPath,
  })
  await trace(tracePath, traceId, task.id, 'workspace_policy.checked', {
    policyPath: workspacePolicyCheck.policyPath,
    ok: workspacePolicyCheck.ok,
    selectedModeIds: workspacePolicyCheck.selectedModeIds,
    blockingDecisions: workspacePolicyCheck.decisions.filter(
      decision => decision.severity === 'blocking',
    ),
  })
  orchestration = await transitionAwmpOrchestration(orchestration, {
    tracePath,
    state: 'planning',
    message: 'Resolved requested modes against available mode roots.',
    data: {
      modeRoots,
      selectedModeIds: selectedModes.map(modePackage => modePackage.mode.id),
      missingModeIds,
    },
  })

  await writeJson(join(runDir, 'capsule.json'), capsule)
  await trace(tracePath, traceId, task.id, 'capsule.created', {
    capsuleId: capsule.id,
    workspace: capsule.workspace,
  })

  await mountModes(runDir, selectedModes)
  for (const modePackage of selectedModes) {
    await trace(tracePath, traceId, task.id, 'mode.mounted', {
      capsuleId: capsule.id,
      modeId: modePackage.mode.id,
      root: modePackage.root,
    })
  }

  const handoffPlan = await buildHandoffPlan({
    runDir,
    task,
    selectedModes,
    tracePath,
    traceId,
  })
  const scheduler = await createAwmpScheduler({
    runDir,
    task,
    tracePath,
    traceId,
    handoffPlan,
  })

  const executionPlanArtifact = await writeExecutionPlanArtifact({
    task,
    artifactStore,
    selectedModes,
    missingModeIds,
    handoffPlan,
    scheduler,
  })
  await trace(tracePath, traceId, task.id, 'artifact.written', {
    capsuleId: capsule.id,
    artifactId: executionPlanArtifact.id,
    artifactType: executionPlanArtifact.type,
  })

  const governanceArtifact = await writeGovernancePolicyArtifact({
    task,
    artifactStore,
    selectedModes,
    workspacePolicyCheck,
  })
  await trace(tracePath, traceId, task.id, 'artifact.written', {
    capsuleId: capsule.id,
    artifactId: governanceArtifact.id,
    artifactType: governanceArtifact.type,
  })

  const toolRegistryArtifact = await writeToolRegistryArtifact({
    task,
    artifactStore,
    selectedModes,
  })
  await trace(tracePath, traceId, task.id, 'artifact.written', {
    capsuleId: capsule.id,
    artifactId: toolRegistryArtifact.id,
    artifactType: toolRegistryArtifact.type,
  })
  orchestration = await transitionAwmpOrchestration(orchestration, {
    tracePath,
    state: 'working',
    message: 'Mounted modes and wrote control-plane artifacts.',
    data: {
      artifacts: artifactStore.artifacts.map(artifact => artifact.type),
      schedulerStatus: scheduler.status,
    },
  })

  const draftTaskPath = join(runDir, 'task.draft.json')
  await writeJson(draftTaskPath, {
    ...task,
    traceId,
    artifacts: artifactStore.artifacts.map(artifact => artifact.uri),
  })
  await writeArtifactIndex(artifactStore)
  orchestration = await transitionAwmpOrchestration(orchestration, {
    tracePath,
    state: 'validating',
    message: 'Prepared artifact index and started validator pass.',
    data: {
      artifactIndexPath: artifactStore.indexPath,
      executeValidators: options.executeValidators === true,
    },
  })

  const validations = await runModeValidators({
    modePackages: selectedModes,
    allowExecution: options.executeValidators === true,
    runDir,
    taskPath: draftTaskPath,
    artifactIndexPath: artifactStore.indexPath,
    timeoutMs: options.validatorTimeoutMs,
  })
  for (const validation of validations) {
    await trace(tracePath, traceId, task.id, 'validator.finished', {
      capsuleId: capsule.id,
      modeId: validation.modeId,
      validatorId: validation.validatorId,
      status: validation.status,
      severity: validation.severity,
      exitCode: validation.exitCode,
      durationMs: validation.durationMs,
    })
  }

  const finalTask = finalizeTask(task, {
    traceId,
    artifactUris: artifactStore.artifacts.map(artifact => artifact.uri),
    missingModeIds,
    validations,
    handoffPlan,
    scheduler,
  })
  await writeJson(join(runDir, 'task.json'), finalTask)
  await writeArtifactIndex(artifactStore)
  await writeJson(join(runDir, 'validations.json'), validations)
  const executionContext = await buildExecutionContext({
    runDir,
    task: finalTask,
    capsule,
    selectedModes,
    artifacts: artifactStore.artifacts,
    validations,
    traceId,
    missingModeIds,
    handoffPlan,
    scheduler,
  })
  await trace(tracePath, traceId, task.id, 'context.built', {
    capsuleId: capsule.id,
    contextPath: executionContext.contextPath,
  })
  await trace(tracePath, traceId, task.id, `task.${finalTask.status.state}`, {
    message: finalTask.status.message,
  })

  for (const modePackage of selectedModes) {
    await trace(tracePath, traceId, task.id, 'mode.unmounted', {
      capsuleId: capsule.id,
      modeId: modePackage.mode.id,
    })
  }
  orchestration = await completeAwmpOrchestration(orchestration, {
    tracePath,
    state: finalTask.status.state === 'failed' ? 'failed' : 'completed',
    message: finalTask.status.message ?? 'AWMP orchestration completed.',
    data: {
      contextPath: executionContext.contextPath,
      validations: validations.length,
      handoffPlanStatus: handoffPlan.status,
      schedulerStatus: scheduler.status,
    },
  })

  return {
    task: finalTask,
    capsule,
    runDir,
    tracePath,
    artifactStorePath: artifactStore.storePath,
    contextPath: executionContext.contextPath,
    orchestrationPath: orchestration.path,
    handoffPlanPath: handoffPlan.path,
    schedulerPath: scheduler.path,
    selectedModes,
    artifacts: artifactStore.artifacts,
    validations,
    executionContext,
    orchestration,
    handoffPlan,
    scheduler,
    summary: buildRunSummary({
      task: finalTask,
      selectedModes,
      missingModeIds,
      artifacts: artifactStore.artifacts,
      validations,
      handoffPlan,
      scheduler,
      runDir,
    }),
  }
}

function selectModesForTask(
  task: AwmpTask,
  discoveredModes: AwmpModePackage[],
): AwmpModePackage[] {
  const selected: AwmpModePackage[] = []
  const seen = new Set<string>()

  for (const modeId of task.modeIds) {
    const modePackage = findModeById(discoveredModes, modeId)
    if (modePackage === undefined || seen.has(modePackage.mode.id)) continue
    seen.add(modePackage.mode.id)
    selected.push(modePackage)
  }

  if (selected.length > 0) return selected

  for (const hit of searchModes(task.objective, discoveredModes)) {
    if (seen.has(hit.modePackage.mode.id)) continue
    seen.add(hit.modePackage.mode.id)
    selected.push(hit.modePackage)
  }

  return selected
}

async function createRunDir(task: AwmpTask, cwd = process.cwd()): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = join(
    getAwmpStateRoot(cwd),
    'runs',
    `${stamp}_${sanitizePathSegment(task.id)}`,
  )
  await mkdir(runDir, { recursive: true })
  return runDir
}

function createCapsule(task: AwmpTask, runDir: string): AwmpExecutionCapsule {
  const capsule = {
    awmp: '0.1',
    kind: 'ExecutionCapsule',
    id: `cap_${randomUUID()}`,
    taskId: task.id,
    workspace: join(runDir, 'workspace'),
    runtime: {
      mode: 'local-substrate',
      note:
        'AWMP v0.1 local substrate creates a task-scoped workspace but does not execute mode-provided code by default.',
      toolBroker: {
        registry: join(runDir, 'artifacts', 'tool_registry.json'),
        invocation: 'deferred',
      },
    },
    network: {
      mode:
        task.constraints?.network === 'allowlist' ||
        task.constraints?.network === 'open'
          ? task.constraints.network
          : 'deny',
      allow: uniqueStrings([
        ...readStringArray(task.constraints?.networkAllow),
        ...readStringArray(task.constraints?.networkAllowlist),
        ...readStringArray(task.constraints?.allowedHosts),
      ]),
    },
    filesystem: {
      read: [join(runDir, 'workspace')],
      write: [join(runDir, 'workspace'), join(runDir, 'artifacts')],
    },
    secrets: [],
    limits: {
      wallClockSeconds: task.constraints?.maxRuntimeSeconds ?? 900,
    },
  } satisfies AwmpExecutionCapsule

  return AwmpExecutionCapsuleSchema.parse(capsule)
}

async function mountModes(
  runDir: string,
  selectedModes: AwmpModePackage[],
): Promise<void> {
  for (const modePackage of selectedModes) {
    const modeDir = join(runDir, 'modes', sanitizePathSegment(modePackage.mode.id))
    await cp(modePackage.root, modeDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
    })
    await mkdir(modeDir, { recursive: true })
    await writeJson(join(modeDir, 'mode.json'), modePackage.mode)
    if (modePackage.skillText !== undefined) {
      await writeFile(join(modeDir, 'SKILL.md'), modePackage.skillText, 'utf8')
    }
  }
}

async function writeExecutionPlanArtifact(input: {
  task: AwmpTask
  artifactStore: AwmpArtifactStoreHandle
  selectedModes: AwmpModePackage[]
  missingModeIds: string[]
  handoffPlan: AwmpHandoffPlan
  scheduler: AwmpSchedulerRecord
}): Promise<AwmpArtifact> {
  const content = {
    awmp: '0.1',
    kind: 'ExecutionPlan',
    taskId: input.task.id,
    objective: input.task.objective,
    selectedModes: input.selectedModes.map(modePackage => ({
      id: modePackage.mode.id,
      name: modePackage.mode.name,
      outputs: modePackage.mode.outputs.artifacts ?? [],
      validators: modePackage.mode.validators ?? [],
      handoffs: modePackage.mode.handoffs ?? {},
    })),
    handoffPlan: {
      path: input.handoffPlan.path,
      status: input.handoffPlan.status,
      steps: input.handoffPlan.steps.map(step => ({
        id: step.id,
        modeId: step.modeId,
        status: step.status,
        dependsOn: step.dependsOn,
        handoffFrom: step.handoffFrom,
        handoffAllowed: step.handoffAllowed,
        handoffReason: step.handoffReason,
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
        dependsOn: step.dependsOn,
        attemptCount: step.attemptCount,
        nextAction: step.nextAction,
        blockedReason: step.blockedReason,
      })),
    },
    missingModeIds: input.missingModeIds,
    constraints: input.task.constraints ?? {},
    substrateBoundary:
      'This AWMP run validates/mounts mode packages and writes execution artifacts. It does not fabricate business data. Mode-provided validators and local tools execute only through explicit, restricted, policy-aware runtime entrypoints.',
  }

  return writeJsonArtifact(input.artifactStore, {
    type: 'awmp.execution_plan',
    fileName: 'execution_plan.json',
    content,
    createdBy: {
      modeId: 'awmp.router',
      agentId: 'leviathan-awmp-runtime',
    },
    validation: {
      status: input.missingModeIds.length === 0 ? 'passed' : 'failed',
      validators: [
        {
          id: 'mode_resolution',
          status: input.missingModeIds.length === 0 ? 'passed' : 'failed',
          missingModeIds: input.missingModeIds,
        },
      ],
    },
  })
}

async function writeGovernancePolicyArtifact(input: {
  task: AwmpTask
  artifactStore: AwmpArtifactStoreHandle
  selectedModes: AwmpModePackage[]
  workspacePolicyCheck: AwmpWorkspacePolicyCheck
}): Promise<AwmpArtifact> {
  const taskApprovalActions = readStringArray(
    input.task.constraints?.requiresHumanApprovalFor,
  )
  const modePolicies = input.selectedModes.map(modePackage => ({
    modeId: modePackage.mode.id,
    default: modePackage.mode.permissions?.default ?? [],
    requiresApproval: modePackage.mode.permissions?.requiresApproval ?? [],
    denied: modePackage.mode.permissions?.denied ?? [],
  }))
  const declaredApprovalActions = uniqueStrings([
    ...taskApprovalActions,
    ...modePolicies.flatMap(policy => policy.requiresApproval),
  ])
  const deniedActions = uniqueStrings(
    modePolicies.flatMap(policy => policy.denied),
  )
  const conflicts = declaredApprovalActions.filter(action =>
    deniedActions.includes(action),
  )
  const approvalActions = declaredApprovalActions.filter(
    action => !deniedActions.includes(action),
  )

  const content = {
    awmp: '0.1',
    kind: 'GovernancePolicy',
    taskId: input.task.id,
    declaredApprovalActions,
    approvalActions,
    deniedActions,
    conflicts,
    modePolicies,
    runtimeBoundary: {
      ambientAuthority: false,
      conflictResolution: 'deny_wins',
      modeScriptExecution: 'explicit_restricted_only',
      localToolExecution: 'policy_checked',
      note:
        'AWMP v0.1 substrate records the approval and denial surface. Local tools can only run through the policy-aware Tool Broker. Enforcement of real external effects belongs to connected adapters.',
    },
    workspacePolicy: {
      path: input.workspacePolicyCheck.policyPath,
      ok: input.workspacePolicyCheck.ok,
      requireModeLock: input.workspacePolicyCheck.policy.requireModeLock,
      requireModeSignature:
        input.workspacePolicyCheck.policy.requireModeSignature,
      requireMarketplaceApproval:
        input.workspacePolicyCheck.policy.requireMarketplaceApproval,
      trustedPublisherIds:
        input.workspacePolicyCheck.policy.trustedPublisherIds,
      selectedModeIds: input.workspacePolicyCheck.selectedModeIds,
      decisions: input.workspacePolicyCheck.decisions,
    },
  }

  return writeJsonArtifact(input.artifactStore, {
    type: 'awmp.governance_policy',
    fileName: 'governance_policy.json',
    content,
    createdBy: {
      modeId: 'awmp.policy',
      agentId: 'leviathan-awmp-runtime',
    },
    validation: {
      status: 'passed',
      validators: [
        {
          id: 'approval_surface_compiled',
          status: 'passed',
          declaredApprovalActions,
          approvalActions,
          deniedActions,
          conflicts,
          workspacePolicyOk: input.workspacePolicyCheck.ok,
        },
      ],
    },
  })
}

async function writeToolRegistryArtifact(input: {
  task: AwmpTask
  artifactStore: AwmpArtifactStoreHandle
  selectedModes: AwmpModePackage[]
}): Promise<AwmpArtifact> {
  const content = buildToolRegistry(input.selectedModes, {
    runDir: input.artifactStore.runDir,
  })

  return writeJsonArtifact(input.artifactStore, {
    type: 'awmp.tool_registry',
    fileName: 'tool_registry.json',
    content,
    createdBy: {
      modeId: 'awmp.tool_broker',
      agentId: 'leviathan-awmp-runtime',
    },
    validation: {
      status: 'passed',
      validators: [
        {
          id: 'tool_registry_compiled',
          status: 'passed',
          total: content.summary.total,
          denied: content.summary.denied,
          approvalRequired: content.summary.approvalRequired,
        },
      ],
    },
  })
}

function finalizeTask(
  task: AwmpTask,
  input: {
    traceId: string
    artifactUris: string[]
    missingModeIds: string[]
    validations: Awaited<ReturnType<typeof runModeValidators>>
    handoffPlan: AwmpHandoffPlan
    scheduler: AwmpSchedulerRecord
  },
): AwmpTask {
  const blockingFailures = input.validations.filter(
    validation =>
      validation.status === 'failed' && validation.severity === 'blocking',
  )
  const failed =
    input.missingModeIds.length > 0 ||
    input.handoffPlan.status === 'blocked' ||
    input.scheduler.status === 'blocked' ||
    blockingFailures.length > 0
  return {
    ...task,
    traceId: input.traceId,
    artifacts: input.artifactUris,
    status: {
      state: failed ? 'failed' : 'completed',
      timestamp: new Date().toISOString(),
      message: buildFinalTaskMessage({
        missingModeIds: input.missingModeIds,
        handoffPlan: input.handoffPlan,
        scheduler: input.scheduler,
        blockingFailures,
      }),
    },
  }
}

function buildFinalTaskMessage(input: {
  missingModeIds: string[]
  handoffPlan: AwmpHandoffPlan
  scheduler: AwmpSchedulerRecord
  blockingFailures: Awaited<ReturnType<typeof runModeValidators>>
}): string {
  if (input.missingModeIds.length > 0) {
    return `Missing AWMP mode packages: ${input.missingModeIds.join(', ')}`
  }

  if (input.handoffPlan.status === 'blocked') {
    return `Blocked AWMP handoffs: ${input.handoffPlan.blockedReasons.join('; ')}`
  }

  if (input.scheduler.status === 'blocked') {
    return 'Blocked AWMP scheduler steps. Inspect scheduler.json for blocked step reasons.'
  }

  if (input.blockingFailures.length > 0) {
    return `Blocking AWMP validators failed: ${input.blockingFailures
      .map(validation => `${validation.modeId}.${validation.validatorId}`)
      .join(', ')}`
  }

  return 'AWMP v0.1 substrate run completed. Registered tool execution is available only through explicit, policy-checked Tool Broker calls.'
}

function buildRunSummary(input: {
  task: AwmpTask
  selectedModes: AwmpModePackage[]
  missingModeIds: string[]
  artifacts: AwmpArtifact[]
  validations: Awaited<ReturnType<typeof runModeValidators>>
  handoffPlan: AwmpHandoffPlan
  scheduler: AwmpSchedulerRecord
  runDir: string
}): string {
  return [
    `AWMP task ${input.task.id}: ${input.task.status.state}`,
    `Title: ${input.task.title}`,
    `Modes: ${input.selectedModes.map(mode => mode.mode.id).join(', ') || 'none'}`,
    input.missingModeIds.length === 0
      ? 'Missing modes: none'
      : `Missing modes: ${input.missingModeIds.join(', ')}`,
    `Handoff plan: ${input.handoffPlan.status}`,
    `Scheduler: ${input.scheduler.status}`,
    `Artifacts: ${input.artifacts.map(artifact => artifact.type).join(', ')}`,
    `Validators inspected: ${input.validations.length}`,
    `Run directory: ${input.runDir}`,
    input.task.status.message ? `Message: ${input.task.status.message}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function trace(
  tracePath: string,
  traceId: string,
  taskId: string,
  event: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await appendTraceEvent(
    tracePath,
    createTraceEvent({
      traceId,
      taskId,
      event,
      data,
    }),
  )
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}
