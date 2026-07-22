import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import awmp from '../commands/awmp/index.js'
import { call } from '../commands/awmp/awmp.js'
import { AwmpTool } from '../tools/AwmpTool/AwmpTool.js'
import { AWMP_TOOL_NAME } from '../tools/AwmpTool/constants.js'
import { getAllBaseTools } from '../tools.js'
import { runWithCwdOverride } from '../utils/cwd.js'
import {
  discoverModePackages,
  searchModes,
} from '../awmp/modeRegistry.js'
import {
  lintModePackage,
  scaffoldModePackage,
} from '../awmp/modeAuthoring.js'
import {
  buildModeCatalogFromRoots,
  loadModeCatalog,
  publishModeToCatalog,
} from '../awmp/modeCatalog.js'
import {
  exportModeBundle,
  installModeBundle,
} from '../awmp/modeBundle.js'
import {
  loadModeLock,
  lockModePackage,
  verifyModeLock,
} from '../awmp/modeLock.js'
import {
  publishModeToMarketplace,
  revokeMarketplaceMode,
  syncModeMarketplace,
  verifyModeMarketplace,
} from '../awmp/modeMarketplace.js'
import {
  generateModeTrustKeyPair,
  signModePackage,
  verifyModeSignature,
} from '../awmp/modeTrust.js'
import {
  checkWorkspacePolicyForTaskFile,
  updateWorkspacePolicy,
} from '../awmp/workspacePolicy.js'
import {
  clearAwmpMcpAdaptersForTests,
  registerAwmpMcpAdapter,
} from '../awmp/mcpAdapterRegistry.js'
import {
  decideApprovalRequest,
  listApprovalRequests,
} from '../awmp/approvalStore.js'
import {
  createArtifactStore,
  loadArtifactIndex,
  loadArtifactStoreSnapshot,
  readJsonArtifact,
  writeJsonArtifact,
} from '../awmp/artifactStore.js'
import {
  listArtifactReviews,
  recordArtifactReview,
} from '../awmp/artifactReviewStore.js'
import {
  evaluateAwmpRuns,
  inspectAwmpRun,
} from '../awmp/evalReporter.js'
import { runModeEvals } from '../awmp/modeEval.js'
import { runAwmpTaskFile } from '../awmp/runtime.js'
import {
  retryAwmpSchedulerStep,
  runAwmpScheduler,
  runAwmpSchedulerStep,
} from '../awmp/scheduler.js'
import { callRegisteredTool } from '../awmp/toolBroker.js'

describe('AWMP runtime substrate', () => {
  test('stores typed artifacts through the artifact store API', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'leviathan-awmp-store-'))
    const store = await createArtifactStore({
      runDir,
      taskId: 'task_store_test',
    })
    const artifact = await writeJsonArtifact(store, {
      type: 'example.report',
      fileName: 'report.json',
      content: { ok: true },
      createdBy: {
        modeId: 'com.example.mode',
        agentId: 'test-agent',
      },
      validation: {
        status: 'passed',
      },
    })

    expect(artifact.type).toBe('example.report')
    expect(await readJsonArtifact(artifact)).toEqual({ ok: true })
    expect((await loadArtifactIndex(runDir)).map(item => item.id)).toContain(
      artifact.id,
    )
    const snapshot = await loadArtifactStoreSnapshot(runDir)
    expect(snapshot.summary.total).toBe(1)
    expect(snapshot.summary.byType['example.report']).toBe(1)
  })

  test('discovers mode packages and routes by activation text', async () => {
    const fixture = await createAwmpFixture()
    const modes = await discoverModePackages([fixture.modesRoot])
    expect(modes.map(mode => mode.mode.id)).toEqual([
      'com.example.customer_support',
      'com.example.ppt',
    ])

    const hits = searchModes('分析投诉并生成客服周报', modes)
    expect(hits[0]?.modePackage.mode.id).toBe('com.example.customer_support')
  })

  test('runs task substrate without executing mode-provided scripts', async () => {
    const fixture = await createAwmpFixture()
    const result = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })

    expect(result.task.status.state).toBe('completed')
    expect(result.selectedModes.map(mode => mode.mode.id)).toEqual([
      'com.example.customer_support',
      'com.example.ppt',
    ])
    expect(result.artifacts.map(artifact => artifact.type)).toEqual([
      'awmp.execution_plan',
      'awmp.governance_policy',
      'awmp.tool_registry',
    ])
    expect(result.validations).toHaveLength(2)
    expect(result.validations.every(v => v.status === 'skipped')).toBe(true)
    expect(result.summary).toContain('AWMP task task_support_to_ppt_demo')

    await expectFile(join(result.runDir, 'task.json'))
    await expectFile(join(result.runDir, 'capsule.json'))
    await expectFile(join(result.runDir, 'artifacts', 'execution_plan.json'))
    await expectFile(join(result.runDir, 'artifacts', 'tool_registry.json'))
    await expectFile(result.artifactStorePath)
    await expectFile(result.contextPath)
    await expectFile(result.orchestrationPath)
    await expectFile(result.handoffPlanPath)
    await expectFile(result.schedulerPath)
    expect(result.handoffPlan.status).toBe('ready')
    expect(result.handoffPlan.steps.map(step => step.modeId)).toEqual([
      'com.example.customer_support',
      'com.example.ppt',
    ])
    expect(result.scheduler.status).toBe('deferred')
    expect(result.scheduler.steps.map(step => step.state)).toEqual([
      'deferred',
      'pending',
    ])
    expect(result.executionContext.kind).toBe('ExecutionContext')
    expect(result.executionContext.task.state).toBe('completed')
    expect(result.executionContext.toolRegistry?.total).toBeGreaterThan(0)
    expect(result.executionContext.controlPlane?.workspacePolicy?.ok).toBe(true)
    expect(result.executionContext.handoffPlan?.status).toBe('ready')
    expect(result.executionContext.scheduler?.status).toBe('deferred')
    expect(result.orchestration.currentState).toBe('completed')
    expect(result.orchestration.steps.map(step => step.state)).toEqual([
      'planning',
      'working',
      'validating',
      'completed',
    ])
    const toolRegistry = JSON.parse(
      await readFile(join(result.runDir, 'artifacts', 'tool_registry.json'), 'utf8'),
    )
    expect(toolRegistry.ambientAuthority).toBe(false)
    expect(toolRegistry.invocation).toBe('policy_checked')
    expect(toolRegistry.summary.total).toBeGreaterThan(0)
    expect(toolRegistry.entries.map((entry: { name: string }) => entry.name)).toContain(
      'zendesk.tickets.search',
    )
    const governance = JSON.parse(
      await readFile(
        join(result.runDir, 'artifacts', 'governance_policy.json'),
        'utf8',
      ),
    )
    expect(governance.approvalActions).toContain('refund:create')
    expect(governance.deniedActions).toContain('policy:export_internal_raw')
    const trace = await readFile(result.tracePath, 'utf8')
    expect(trace).toContain('task.created')
    expect(trace).toContain('orchestrator.transition')
    expect(trace).toContain('context.built')
    expect(trace).toContain('artifact.written')
    expect(trace).toContain('handoff.plan.created')
    expect(trace).toContain('scheduler.created')
    expect(trace).toContain('scheduler.step.deferred')
  })

  test('runs a ready scheduler step through the Tool Broker and marks it completed', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: [
        'const input = JSON.parse(process.env.AWMP_TOOL_INPUT_JSON || "{}")',
        'console.log(JSON.stringify({',
        '  scheduler: true,',
        '  input,',
        '  artifact: {',
        '    type: "presentation.pptx",',
        '    content: { slides: input.slides, source: "scheduler" }',
        '  }',
        '}))',
      ].join('\n'),
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      toolInput: { slides: 4 },
      timeoutMs: 5000,
    })

    expect(result.status).toBe('completed')
    expect(result.step.state).toBe('completed')
    expect(result.step.attemptCount).toBe(1)
    expect(result.step.lastToolName).toBe('create_deck')
    expect(result.toolCall?.stdout).toContain('"scheduler":true')
    expect(result.step.registeredArtifactUris?.length).toBe(3)
    expect(result.step.attempts[0]?.registeredArtifactUris?.length).toBe(3)
    expect(result.step.validationSummary?.skipped).toBe(1)
    expect(result.contextPath).toBeDefined()
    expect(result.scheduler.status).toBe('completed')
    expect(
      JSON.parse(await readFile(result.schedulerPath, 'utf8')).steps[0].state,
    ).toBe('completed')
    const snapshot = await loadArtifactStoreSnapshot(run.runDir)
    expect(snapshot.summary.byType['awmp.scheduler_step_result']).toBe(1)
    expect(snapshot.summary.byType['awmp.scheduler_step_validation']).toBe(1)
    expect(snapshot.summary.byType['presentation.pptx']).toBe(1)
    const deckArtifact = snapshot.artifacts.find(
      artifact => artifact.type === 'presentation.pptx',
    )
    expect(await readJsonArtifact(deckArtifact!)).toEqual({
      slides: 4,
      source: 'scheduler',
    })
    expect(deckArtifact?.validation?.status).toBe('pending')
    const refreshedContext = JSON.parse(await readFile(result.contextPath!, 'utf8'))
    expect(
      refreshedContext.artifacts.map((artifact: { type: string }) => artifact.type),
    ).toContain('presentation.pptx')
    expect(refreshedContext.scheduler.status).toBe('completed')

    const trace = await readFile(run.tracePath, 'utf8')
    expect(trace).toContain('scheduler.tool.selected')
    expect(trace).toContain('scheduler.step.running')
    expect(trace).toContain('scheduler.step.completed')
  })

  test('defers scheduler auto tool selection when candidates are ambiguous', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolYamlLines: [
        'tools:',
        '  local:',
        '    - name: "create_deck"',
        '      command: "bun tools/create_deck.ts"',
        '    - name: "create_summary"',
        '      command: "bun tools/create_summary.ts"',
      ],
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      timeoutMs: 5000,
    })

    expect(result.status).toBe('deferred')
    expect(result.step.state).toBe('deferred')
    expect(result.step.attemptCount).toBe(0)
    expect(result.toolCall).toBeUndefined()
    expect(result.message).toContain('Multiple equally preferred tools')
    expect(result.step.nextAction).toContain('explicit tool_id')
    expect(result.step.lastFailureKind).toBe('ambiguous_tool')
    expect(result.step.retryable).toBe(false)
  })

  test('executes scheduler step validators and marks produced artifacts passed', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: [
        'console.log(JSON.stringify({',
        '  artifact: {',
        '    type: "presentation.pptx",',
        '    content: { source: "validated-step" }',
        '  }',
        '}))',
      ].join('\n'),
      pptValidatorCommand: 'bun validators/pass.ts',
      pptValidatorScriptPath: 'validators/pass.ts',
      pptValidatorScriptContent: [
        'console.log(JSON.stringify({',
        '  status: "passed",',
        '  severity: "info",',
        '  message: "scheduler artifact accepted",',
        '}))',
      ].join('\n'),
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      executeValidators: true,
      validatorTimeoutMs: 5000,
      timeoutMs: 5000,
    })

    expect(result.status).toBe('completed')
    expect(result.step.state).toBe('completed')
    expect(result.step.validationSummary?.passed).toBe(1)
    expect(result.step.validationSummary?.blockingFailures).toEqual([])
    const snapshot = await loadArtifactStoreSnapshot(run.runDir)
    const deckArtifact = snapshot.artifacts.find(
      artifact => artifact.type === 'presentation.pptx',
    )
    expect(deckArtifact?.validation?.status).toBe('passed')
    expect(snapshot.summary.byType['awmp.scheduler_step_validation']).toBe(1)
    const validations = JSON.parse(
      await readFile(join(run.runDir, 'validations.json'), 'utf8'),
    )
    expect(
      validations.some(
        (validation: { scope?: string; schedulerStepId?: string; status: string }) =>
          validation.scope === 'scheduler_step' &&
          validation.schedulerStepId === result.step.id &&
          validation.status === 'passed',
      ),
    ).toBe(true)
  })

  test('fails a scheduler step when an executed blocking validator fails', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: [
        'console.log(JSON.stringify({',
        '  artifact: {',
        '    type: "presentation.pptx",',
        '    content: { source: "invalid-step" }',
        '  }',
        '}))',
      ].join('\n'),
      pptValidatorCommand: 'bun validators/fail.ts',
      pptValidatorScriptPath: 'validators/fail.ts',
      pptValidatorScriptContent: [
        'console.log(JSON.stringify({',
        '  status: "failed",',
        '  severity: "blocking",',
        '  message: "deck schema rejected",',
        '}))',
        'process.exit(1)',
      ].join('\n'),
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      executeValidators: true,
      validatorTimeoutMs: 5000,
      timeoutMs: 5000,
    })

    expect(result.status).toBe('failed')
    expect(result.step.state).toBe('failed')
    expect(result.scheduler.status).toBe('failed')
    expect(result.message).toContain('Blocking validator failure')
    expect(result.step.nextAction).toContain('Fix blocking validator failure')
    expect(result.step.lastFailureKind).toBe('validation_failed')
    expect(result.step.retryable).toBe(true)
    expect(result.step.retryAfter).toBeDefined()
    expect(result.step.validationSummary?.blockingFailures).toEqual([
      'com.example.ppt.ppt_file_check',
    ])
    const snapshot = await loadArtifactStoreSnapshot(run.runDir)
    const deckArtifact = snapshot.artifacts.find(
      artifact => artifact.type === 'presentation.pptx',
    )
    expect(deckArtifact?.validation?.status).toBe('failed')
  })

  test('records retry metadata for failed scheduler tools and reruns them explicitly', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/retry_deck.ts',
      pptToolScriptPath: 'tools/retry_deck.ts',
      pptToolScriptContent: [
        'import { existsSync, writeFileSync } from "fs"',
        'import { join } from "path"',
        'const marker = join(process.env.AWMP_RUN_DIR!, "retry-marker.txt")',
        'if (!existsSync(marker)) {',
        '  writeFileSync(marker, "first failure")',
        '  console.error("transient deck generator failure")',
        '  process.exit(1)',
        '}',
        'const input = JSON.parse(process.env.AWMP_TOOL_INPUT_JSON || "{}")',
        'console.log(JSON.stringify({',
        '  artifact: {',
        '    type: "presentation.pptx",',
        '    content: { source: "retry-success", slides: input.slides }',
        '  }',
        '}))',
      ].join('\n'),
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const failed = await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      toolInput: { slides: 6 },
      timeoutMs: 5000,
    })

    expect(failed.status).toBe('failed')
    expect(failed.step.state).toBe('failed')
    expect(failed.step.attemptCount).toBe(1)
    expect(failed.step.lastFailureKind).toBe('tool_failed')
    expect(failed.step.retryable).toBe(true)
    expect(failed.step.retryAfter).toBeDefined()
    expect(failed.step.nextAction).toContain('/awmp retry-step')

    const tooEarly = await retryAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
    })
    expect(tooEarly.status).toBe('failed')
    expect(tooEarly.step.attemptCount).toBe(1)
    expect(tooEarly.message).toContain('can be retried after')

    const retried = await retryAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      force: true,
      timeoutMs: 5000,
    })

    expect(retried.status).toBe('completed')
    expect(retried.step.state).toBe('completed')
    expect(retried.step.attemptCount).toBe(2)
    expect(retried.step.lastFailureKind).toBeUndefined()
    expect(retried.step.retryable).toBe(false)
    expect(retried.toolCall?.stdout).toContain('"slides":6')
    const snapshot = await loadArtifactStoreSnapshot(run.runDir)
    const deckArtifact = snapshot.artifacts.find(
      artifact => artifact.type === 'presentation.pptx',
    )
    expect(await readJsonArtifact(deckArtifact!)).toEqual({
      source: 'retry-success',
      slides: 6,
    })
    const trace = await readFile(run.tracePath, 'utf8')
    expect(trace).toContain('scheduler.step.retry_requested')
  })

  test('keeps a scheduler step pending when dependency steps are incomplete', async () => {
    const fixture = await createAwmpFixture({
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: 'console.log("should not run before dependency")',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      toolName: 'create_deck',
      timeoutMs: 5000,
    })

    expect(result.status).toBe('pending')
    expect(result.step.state).toBe('pending')
    expect(result.step.attemptCount).toBe(0)
    expect(result.toolCall).toBeUndefined()
    expect(result.message).toContain('Waiting for dependency step')
  })

  test('unlocks dependent scheduler steps after upstream completion', async () => {
    clearAwmpMcpAdaptersForTests()
    const fixture = await createAwmpFixture()
    const unregister = registerAwmpMcpAdapter({
      server: 'zendesk',
      tool: 'tickets.search',
      handler: () => ({
        status: 'completed',
        message: 'support analysis fixture completed.',
        data: {
          tickets: 3,
        },
      }),
    })

    try {
      const run = await runAwmpTaskFile(fixture.taskPath, {
        cwd: fixture.cwd,
      })
      const result = await runAwmpSchedulerStep({
        runDir: run.runDir,
        modeId: 'com.example.customer_support',
      })
      const downstream = result.scheduler.steps.find(
        step => step.modeId === 'com.example.ppt',
      )

      expect(result.status).toBe('completed')
      expect(result.scheduler.status).toBe('deferred')
      expect(downstream?.state).toBe('deferred')
      expect(downstream?.nextAction).toContain('Dependencies completed')
      expect(result.contextPath).toBeDefined()
      const persisted = JSON.parse(await readFile(result.schedulerPath, 'utf8'))
      expect(
        persisted.steps.find(
          (step: { modeId: string }) => step.modeId === 'com.example.ppt',
        )?.state,
      ).toBe('deferred')
      const refreshedContext = JSON.parse(await readFile(result.contextPath!, 'utf8'))
      expect(refreshedContext.scheduler.status).toBe('deferred')
      expect(
        refreshedContext.scheduler.steps.find(
          (step: { modeId: string }) => step.modeId === 'com.example.ppt',
        )?.state,
      ).toBe('deferred')

      const trace = await readFile(run.tracePath, 'utf8')
      expect(trace).toContain('scheduler.tool.selected')
      expect(trace).toContain('scheduler.step.deferred')
      expect(trace).toContain('"source":"scheduler_step"')
    } finally {
      unregister()
      clearAwmpMcpAdaptersForTests()
    }
  })

  test('runs a bounded scheduler pass across ready auto-selectable steps', async () => {
    clearAwmpMcpAdaptersForTests()
    const fixture = await createAwmpFixture({
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: [
        'console.log(JSON.stringify({',
        '  artifact: {',
        '    type: "presentation.pptx",',
        '    content: { source: "scheduler-pass" }',
        '  }',
        '}))',
      ].join('\n'),
    })
    const unregister = registerAwmpMcpAdapter({
      server: 'zendesk',
      tool: 'tickets.search',
      handler: () => ({
        status: 'completed',
        message: 'support pass fixture completed.',
        data: {
          tickets: 5,
        },
      }),
    })

    try {
      const run = await runAwmpTaskFile(fixture.taskPath, {
        cwd: fixture.cwd,
      })
      const result = await runAwmpScheduler({
        runDir: run.runDir,
        timeoutMs: 5000,
      })

      expect(result.status).toBe('completed')
      expect(result.steps).toHaveLength(2)
      expect(result.steps.map(step => step.status)).toEqual([
        'completed',
        'completed',
      ])
      expect(result.scheduler.steps.map(step => step.state)).toEqual([
        'completed',
        'completed',
      ])
      const snapshot = await loadArtifactStoreSnapshot(run.runDir)
      expect(snapshot.summary.byType['awmp.scheduler_step_result']).toBe(2)
      expect(snapshot.summary.byType['awmp.scheduler_step_validation']).toBe(2)
      expect(snapshot.summary.byType['presentation.pptx']).toBe(1)
      expect(result.contextPath).toBeDefined()
      const refreshedContext = JSON.parse(await readFile(result.contextPath!, 'utf8'))
      expect(refreshedContext.scheduler.status).toBe('completed')
      expect(
        refreshedContext.artifacts.map((artifact: { type: string }) => artifact.type),
      ).toContain('presentation.pptx')
    } finally {
      unregister()
      clearAwmpMcpAdaptersForTests()
    }
  })

  test('inspects a run into evidence-backed AWMP metrics without inventing acceptance data', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: [
        'console.log(JSON.stringify({',
        '  artifact: {',
        '    type: "presentation.pptx",',
        '    content: { source: "inspection" }',
        '  }',
        '}))',
      ].join('\n'),
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      timeoutMs: 5000,
    })

    const report = await inspectAwmpRun({
      runDir: run.runDir,
    })

    expect(report.kind).toBe('RunInspectionReport')
    expect(report.scheduler.status).toBe('completed')
    expect(report.metrics.workCompletion.value).toBe(1)
    expect(report.metrics.artifactAcceptance.status).toBe('missing_evidence')
    expect(report.evidenceGaps.some(gap => gap.includes('Artifact Acceptance'))).toBe(
      true,
    )
    await expectFile(report.reportPath!)
  })

  test('records artifact reviews as explicit acceptance metric evidence', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: [
        'console.log(JSON.stringify({',
        '  artifact: {',
        '    type: "presentation.pptx",',
        '    content: { source: "reviewed-artifact" }',
        '  }',
        '}))',
      ].join('\n'),
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      timeoutMs: 5000,
    })
    const snapshot = await loadArtifactStoreSnapshot(run.runDir)
    const deckArtifact = snapshot.artifacts.find(
      artifact => artifact.type === 'presentation.pptx',
    )
    expect(deckArtifact).toBeDefined()

    const review = await recordArtifactReview({
      runDir: run.runDir,
      artifactRef: deckArtifact!.id,
      status: 'accepted_with_changes',
      reviewedBy: 'awmp-test',
      note: 'minor copy edits accepted',
    })
    const reviews = await listArtifactReviews(run.runDir)
    const report = await inspectAwmpRun({
      runDir: run.runDir,
    })

    expect(review.accepted).toBe(true)
    expect(reviews.reviews).toHaveLength(1)
    expect(report.reviews.reviewedArtifacts).toBe(1)
    expect(report.reviews.acceptedWithChanges).toBe(1)
    expect(report.metrics.artifactAcceptance.status).toBe('computed')
    expect(report.metrics.artifactAcceptance.value).toBe(1)
    expect(report.metrics.artifactAcceptance.evidence).toContain(
      join(run.runDir, 'artifacts', 'reviews'),
    )
    expect(report.evidenceGaps.some(gap => gap.includes('Artifact Acceptance'))).toBe(
      false,
    )
    await expectFile(review.reviewPath)
    await expectFile(join(run.runDir, 'artifacts', 'reviews', 'index.json'))
    const trace = await readFile(run.tracePath, 'utf8')
    expect(trace).toContain('artifact.reviewed')
  })

  test('aggregates AWMP run metrics across completed and deferred multi-mode runs', async () => {
    clearAwmpMcpAdaptersForTests()
    const fixture = await createAwmpFixture({
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: [
        'console.log(JSON.stringify({',
        '  artifact: {',
        '    type: "presentation.pptx",',
        '    content: { source: "aggregate-eval" }',
        '  }',
        '}))',
      ].join('\n'),
    })
    const unregister = registerAwmpMcpAdapter({
      server: 'zendesk',
      tool: 'tickets.search',
      handler: () => ({
        status: 'completed',
        message: 'support eval fixture completed.',
        data: {
          tickets: 2,
        },
      }),
    })

    try {
      const completed = await runAwmpTaskFile(fixture.taskPath, {
        cwd: fixture.cwd,
      })
      await runAwmpScheduler({
        runDir: completed.runDir,
        timeoutMs: 5000,
      })
      const snapshot = await loadArtifactStoreSnapshot(completed.runDir)
      const deckArtifact = snapshot.artifacts.find(
        artifact => artifact.type === 'presentation.pptx',
      )
      expect(deckArtifact).toBeDefined()
      await recordArtifactReview({
        runDir: completed.runDir,
        artifactRef: deckArtifact!.id,
        status: 'accepted',
        reviewedBy: 'aggregate-test',
      })
      const deferred = await runAwmpTaskFile(fixture.taskPath, {
        cwd: fixture.cwd,
      })
      const report = await evaluateAwmpRuns({
        runDirs: [completed.runDir, deferred.runDir],
        writeReport: false,
      })

      expect(report.runCount).toBe(2)
      expect(report.metrics.workCompletionRate.value).toBe(0.5)
      expect(report.metrics.crossModeTaskSuccess.value).toBe(0.5)
      expect(report.metrics.modeReuseRate.value).toBe(1)
      expect(report.metrics.artifactAcceptanceRate.status).toBe('computed')
      expect(report.metrics.artifactAcceptanceRate.value).toBe(1)
    } finally {
      unregister()
      clearAwmpMcpAdaptersForTests()
    }
  })

  test('blocks task completion when adjacent mode handoff policy is incompatible', async () => {
    const fixture = await createAwmpFixture({
      customerSupportHandoffYamlLines: [
        'handoffs:',
        '  canDelegateTo:',
        '    - "com.example.email"',
      ],
    })
    const result = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })

    expect(result.task.status.state).toBe('failed')
    expect(result.task.status.message).toContain('Blocked AWMP handoffs')
    expect(result.handoffPlan.status).toBe('blocked')
    expect(result.handoffPlan.blockedReasons[0]).toContain(
      'com.example.customer_support -> com.example.ppt',
    )
    expect(result.handoffPlan.steps[1]?.status).toBe('blocked')
    expect(result.scheduler.status).toBe('blocked')
    expect(result.scheduler.steps[1]?.state).toBe('blocked')
    expect(result.executionContext.handoffPlan?.status).toBe('blocked')
    expect(result.executionContext.scheduler?.status).toBe('blocked')
    expect(result.executionContext.nextActions).toContain(
      'Fix blocked AWMP handoff policy before executing this multi-mode task.',
    )

    await expectFile(result.handoffPlanPath)
    await expectFile(result.schedulerPath)
    const persistedPlan = JSON.parse(
      await readFile(result.handoffPlanPath, 'utf8'),
    )
    expect(persistedPlan.status).toBe('blocked')
    const persistedScheduler = JSON.parse(
      await readFile(result.schedulerPath, 'utf8'),
    )
    expect(persistedScheduler.status).toBe('blocked')
  })

  test('executes mode validators only when explicitly enabled', async () => {
    const fixture = await createAwmpFixture({
      pptValidatorCommand: 'bun validators/pass.ts',
      pptValidatorScriptPath: 'validators/pass.ts',
      pptValidatorScriptContent: [
        'const result = {',
        '  status: "passed",',
        '  severity: "info",',
        '  message: `validated ${process.env.AWMP_MODE_ID} with task=${Boolean(process.env.AWMP_TASK_PATH)}`,',
        '  findings: [{ artifactIndex: process.env.AWMP_ARTIFACT_INDEX }],',
        '}',
        'console.log(JSON.stringify(result))',
      ].join('\n'),
    })

    const defaultResult = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    expect(
      defaultResult.validations.find(
        validation => validation.validatorId === 'ppt_file_check',
      )?.status,
    ).toBe('skipped')

    const executedResult = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
      executeValidators: true,
      validatorTimeoutMs: 5000,
    })
    const pptValidation = executedResult.validations.find(
      validation => validation.validatorId === 'ppt_file_check',
    )

    expect(executedResult.task.status.state).toBe('completed')
    expect(pptValidation?.status).toBe('passed')
    expect(pptValidation?.exitCode).toBe(0)
    expect(pptValidation?.message).toContain(
      'validated com.example.ppt with task=true',
    )
    expect(pptValidation?.findings).toHaveLength(1)
    expect(
      await readFile(join(executedResult.runDir, 'validations.json'), 'utf8'),
    ).toContain('validated com.example.ppt')
  })

  test('marks unsafe validator commands as blocking failures', async () => {
    const fixture = await createAwmpFixture({
      pptValidatorCommand: 'bun ../outside.ts',
    })
    const result = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const pptValidation = result.validations.find(
      validation => validation.validatorId === 'ppt_file_check',
    )

    expect(result.task.status.state).toBe('failed')
    expect(result.task.status.message).toContain('Blocking AWMP validators failed')
    expect(pptValidation?.status).toBe('failed')
    expect(pptValidation?.severity).toBe('blocking')
  })

  test('calls registered local tools through the policy-aware broker', async () => {
    const fixture = await createAwmpFixture({
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: [
        'const input = JSON.parse(process.env.AWMP_TOOL_INPUT_JSON || "{}")',
        'console.log(JSON.stringify({',
        '  ok: true,',
        '  tool: process.env.AWMP_TOOL_NAME,',
        '  slides: input.slides,',
        '  workspace: Boolean(process.env.AWMP_WORKSPACE_DIR),',
        '}))',
      ].join('\n'),
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'create_deck',
      input: { slides: 8 },
      timeoutMs: 5000,
    })

    expect(result.status).toBe('completed')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"slides":8')
    await expectFile(result.resultPath)
    const trace = await readFile(run.tracePath, 'utf8')
    expect(trace).toContain('tool.called')
  })

  test('denies registered tools blocked by mode policy before execution', async () => {
    const fixture = await createAwmpFixture({
      pptToolName: 'email:send_external',
      pptToolCommand: 'bun tools/should_not_run.ts',
      pptToolScriptPath: 'tools/should_not_run.ts',
      pptToolScriptContent: 'console.log("should not run")',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'email:send_external',
    })

    expect(result.status).toBe('denied')
    expect(result.stdout).toBeUndefined()
    expect(result.message).toContain('denied')
    await expectFile(result.resultPath)
  })

  test('creates durable approval requests before sensitive tool execution', async () => {
    const fixture = await createAwmpFixture({
      pptToolName: 'refund:create',
      pptToolCommand: 'bun tools/refund.ts',
      pptToolScriptPath: 'tools/refund.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ approved: true, input: process.env.AWMP_TOOL_INPUT_JSON }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const pending = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'refund:create',
      input: { amount: 12 },
    })

    expect(pending.status).toBe('approval_required')
    expect(pending.approvalRequestId).toMatch(/^approval_/)
    expect(pending.stdout).toBeUndefined()

    const approvals = await listApprovalRequests(run.runDir)
    expect(approvals.approvals).toHaveLength(1)
    expect(approvals.approvals[0]?.status).toBe('pending')
    expect(approvals.approvals[0]?.tool.name).toBe('refund:create')
    await expectFile(approvals.approvals[0]!.requestPath)

    const duplicate = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'refund:create',
      input: { amount: 12 },
    })
    expect(duplicate.approvalRequestId).toBe(pending.approvalRequestId)

    const mismatch = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'refund:create',
      input: { amount: 99 },
      approvalId: pending.approvalRequestId,
    })
    expect(mismatch.status).toBe('denied')
    expect(mismatch.message).toContain('fingerprint')

    await decideApprovalRequest({
      runDir: run.runDir,
      approvalId: pending.approvalRequestId!,
      decision: 'approved',
      decidedBy: 'test',
      note: 'unit test approval',
    })
    const completed = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'refund:create',
      input: { amount: 12 },
      approvalId: pending.approvalRequestId,
    })

    expect(completed.status).toBe('completed')
    expect(completed.approved).toBe(true)
    expect(completed.approvalRequestId).toBe(pending.approvalRequestId)
    expect(completed.stdout).toContain('"approved":true')

    const trace = await readFile(run.tracePath, 'utf8')
    expect(trace).toContain('approval.requested')
    expect(trace).toContain('approval.approved')
  })

  test('calls registered MCP tools through an explicit AWMP adapter', async () => {
    clearAwmpMcpAdaptersForTests()
    const fixture = await createAwmpFixture()
    const unregister = registerAwmpMcpAdapter({
      server: 'zendesk',
      tool: 'tickets.search',
      handler: input => ({
        status: 'completed',
        message: 'MCP adapter fixture completed.',
        data: {
          server: input.server,
          tool: input.tool,
          query: input.input,
          runDir: Boolean(input.runDir),
        },
      }),
    })

    try {
      const run = await runAwmpTaskFile(fixture.taskPath, {
        cwd: fixture.cwd,
      })
      const result = await callRegisteredTool({
        runDir: run.runDir,
        toolName: 'zendesk.tickets.search',
        input: { status: 'open' },
      })

      expect(result.status).toBe('completed')
      expect(result.message).toContain('fixture completed')
      expect(result.stdout).toContain('"server":"zendesk"')
      expect(result.stdout).toContain('"status":"open"')
      await expectFile(result.resultPath)
    } finally {
      unregister()
      clearAwmpMcpAdaptersForTests()
    }
  })

  test('defers MCP tools when no AWMP adapter is connected', async () => {
    clearAwmpMcpAdaptersForTests()
    const fixture = await createAwmpFixture()
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'zendesk.tickets.search',
      input: { status: 'open' },
    })

    expect(result.status).toBe('deferred')
    expect(result.message).toContain('external adapter is not connected')
    expect(result.stdout).toBeUndefined()
    await expectFile(result.resultPath)
  })

  test('calls OpenAPI tools when the execution capsule network allowlist permits the target', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        return Response.json({
          ok: true,
          query: url.searchParams.get('q'),
        })
      },
    })
    const origin = `http://127.0.0.1:${server.port}`

    try {
      const fixture = await createAwmpFixture({
        pptToolYamlLines: [
          'tools:',
          '  openapi:',
          '    - name: "search_api"',
          '      method: "GET"',
          `      baseUrl: "${origin}"`,
          '      path: "/search"',
        ],
        taskConstraints: {
          maxRuntimeSeconds: 900,
          network: 'allowlist',
          networkAllow: [origin],
        },
      })
      const run = await runAwmpTaskFile(fixture.taskPath, {
        cwd: fixture.cwd,
      })
      const result = await callRegisteredTool({
        runDir: run.runDir,
        toolName: 'search_api',
        input: {
          query: {
            q: 'awmp',
          },
        },
      })

      expect(result.status).toBe('completed')
      expect(result.httpStatus).toBe(200)
      expect(result.stdout).toContain('"query":"awmp"')
    } finally {
      server.stop(true)
    }
  })

  test('blocks OpenAPI tools before fetch when capsule network policy denies outbound calls', async () => {
    const fixture = await createAwmpFixture({
      pptToolYamlLines: [
        'tools:',
        '  openapi:',
        '    - name: "blocked_api"',
        '      method: "GET"',
        '      url: "http://127.0.0.1:9/blocked"',
      ],
      taskConstraints: {
        maxRuntimeSeconds: 900,
        network: 'deny',
      },
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'blocked_api',
    })

    expect(result.status).toBe('denied')
    expect(result.message).toContain('network policy denies')
    expect(result.httpStatus).toBeUndefined()
  })

  test('/awmp command is registered and can route modes', async () => {
    const fixture = await createAwmpFixture()
    expect(awmp.name).toBe('awmp')
    expect(awmp.type).toBe('local')
    expect(awmp.description).toContain('Agent Work Mode Protocol')

    const result = await call(
      `route "生成管理层 PPT" --modes "${fixture.modesRoot}"`,
      {} as Parameters<typeof call>[1],
    )

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('com.example.ppt')
    }
  })

  test('/awmp run can explicitly execute validators', async () => {
    const fixture = await createAwmpFixture({
      pptValidatorCommand: 'bun validators/fail.ts',
      pptValidatorScriptPath: 'validators/fail.ts',
      pptValidatorScriptContent: [
        'console.log(JSON.stringify({',
        '  status: "failed",',
        '  severity: "blocking",',
        '  message: "cli validator failed",',
        '}))',
        'process.exit(1)',
      ].join('\n'),
    })

    const result = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `run "${fixture.taskPath}" --execute-validators`,
        {} as Parameters<typeof call>[1],
      ),
    )

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('failed')
      expect(result.value).toContain('Blocking AWMP validators failed')
    }
  })

  test('/awmp tool-call invokes a registered local tool', async () => {
    const fixture = await createAwmpFixture({
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "cli", input: process.env.AWMP_TOOL_INPUT_JSON }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `tool-call "${run.runDir}" create_deck --input-json '{"slides":3}'`,
        {} as Parameters<typeof call>[1],
      ),
    )

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('completed')
      expect(result.value).toContain('source')
    }
  })

  test('/awmp step-run advances a scheduler step through a registered tool', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "cli-step", input: process.env.AWMP_TOOL_INPUT_JSON }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const result = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `step-run "${run.runDir}" com.example.ppt create_deck --input-json '{"slides":5}'`,
        {} as Parameters<typeof call>[1],
      ),
    )

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('completed')
      expect(result.value).toContain('cli-step')
      expect(result.value).toContain('State: completed')
    }
  })

  test('/awmp can record and list artifact reviews', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ artifact: { type: "presentation.pptx", content: { source: "cli-review" } } }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      timeoutMs: 5000,
    })
    const snapshot = await loadArtifactStoreSnapshot(run.runDir)
    const deckArtifact = snapshot.artifacts.find(
      artifact => artifact.type === 'presentation.pptx',
    )
    expect(deckArtifact).toBeDefined()

    const recorded = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `review-artifact "${run.runDir}" ${deckArtifact!.id} accepted --by tester --note "approved"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(recorded.type).toBe('text')
    if (recorded.type === 'text') {
      expect(recorded.value).toContain('accepted')
      expect(recorded.value).toContain(deckArtifact!.id)
    }

    const listed = await runWithCwdOverride(fixture.cwd, () =>
      call(`reviews "${run.runDir}"`, {} as Parameters<typeof call>[1]),
    )
    expect(listed.type).toBe('text')
    if (listed.type === 'text') {
      expect(listed.value).toContain('AWMP artifact reviews')
      expect(listed.value).toContain('accepted')
      expect(listed.value).toContain('approved')
    }
  })

  test('/awmp can inspect and decide approval-gated tool calls', async () => {
    const fixture = await createAwmpFixture({
      pptToolName: 'refund:create',
      pptToolCommand: 'bun tools/refund.ts',
      pptToolScriptPath: 'tools/refund.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "cli-approval", input: process.env.AWMP_TOOL_INPUT_JSON }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const first = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `tool-call "${run.runDir}" refund:create --input-json '{"amount":4}'`,
        {} as Parameters<typeof call>[1],
      ),
    )

    expect(first.type).toBe('text')
    if (first.type !== 'text') return
    expect(first.value).toContain('approval_required')
    const approvalId = first.value.match(/Approval: (approval_[^\s]+)/)?.[1]
    expect(approvalId).toBeDefined()

    const list = await runWithCwdOverride(fixture.cwd, () =>
      call(`approvals "${run.runDir}"`, {} as Parameters<typeof call>[1]),
    )
    expect(list.type).toBe('text')
    if (list.type === 'text') {
      expect(list.value).toContain(approvalId!)
      expect(list.value).toContain('pending')
    }

    const approval = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `approve "${run.runDir}" ${approvalId} --by tester --note "looks good"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(approval.type).toBe('text')
    if (approval.type === 'text') {
      expect(approval.value).toContain('approved')
      expect(approval.value).toContain('looks good')
    }

    const second = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `tool-call "${run.runDir}" refund:create --approval ${approvalId} --input-json '{"amount":4}'`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(second.type).toBe('text')
    if (second.type === 'text') {
      expect(second.value).toContain('completed')
      expect(second.value).toContain('cli-approval')
    }
  })

  test('/awmp install stores a mode in the workspace registry', async () => {
    const fixture = await createAwmpFixture()

    const installResult = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `install "${join(fixture.modesRoot, 'ppt')}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(installResult.type).toBe('text')
    if (installResult.type === 'text') {
      expect(installResult.value).toContain('Installed AWMP mode com.example.ppt')
    }

    const modesResult = await runWithCwdOverride(fixture.cwd, () =>
      call('modes', {} as Parameters<typeof call>[1]),
    )
    expect(modesResult.type).toBe('text')
    if (modesResult.type === 'text') {
      expect(modesResult.value).toContain('com.example.ppt')
      expect(modesResult.value).not.toContain('com.example.customer_support')
    }
  })

  test('mode bundles export and install across workspaces with digest verification', async () => {
    const source = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "mode-bundle" }))',
    })
    const targetCwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-bundle-target-'))
    const exported = await exportModeBundle({
      cwd: source.cwd,
      modeDir: join(source.modesRoot, 'ppt'),
    })
    await expectFile(exported.bundlePath)
    expect(exported.bundle.files.length).toBeGreaterThan(0)

    const installed = await installModeBundle({
      cwd: targetCwd,
      bundlePath: exported.bundlePath,
    })
    expect(installed.modePackage.mode.id).toBe('com.example.ppt')
    expect(installed.packageDigest).toBe(exported.bundle.packageDigest)

    const installedModes = await discoverModePackages([
      join(targetCwd, '.leviathan', 'awmp', 'modes'),
    ])
    expect(installedModes.map(modePackage => modePackage.mode.id)).toEqual([
      'com.example.ppt',
    ])
  })

  test('/awmp can export and install portable mode bundles', async () => {
    const source = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "cli-mode-bundle" }))',
    })
    const targetCwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-cli-bundle-'))
    const bundlePath = join(source.cwd, 'bundles', 'ppt.awmp-mode.json')

    const exported = await runWithCwdOverride(source.cwd, () =>
      call(
        `export-bundle "${join(source.modesRoot, 'ppt')}" --bundle "${bundlePath}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(exported.type).toBe('text')
    if (exported.type === 'text') {
      expect(exported.value).toContain('Exported AWMP mode bundle com.example.ppt@0.1.0')
      expect(exported.value).toContain(bundlePath)
    }
    await expectFile(bundlePath)

    const installed = await runWithCwdOverride(targetCwd, () =>
      call(`install-bundle "${bundlePath}"`, {} as Parameters<typeof call>[1]),
    )
    expect(installed.type).toBe('text')
    if (installed.type === 'text') {
      expect(installed.value).toContain('Installed AWMP mode bundle com.example.ppt@0.1.0')
      expect(installed.value).toContain(
        join(targetCwd, '.leviathan', 'awmp', 'modes', 'com.example.ppt'),
      )
    }
  })

  test('/awmp catalog can publish and inspect mode catalog entries', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: 'console.log(JSON.stringify({ source: "catalog" }))',
    })

    const published = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `publish-mode "${join(fixture.modesRoot, 'ppt')}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(published.type).toBe('text')
    if (published.type === 'text') {
      expect(published.value).toContain('Published AWMP mode com.example.ppt@0.1.0')
      expect(published.value).toContain('sha256:')
    }

    const persisted = await runWithCwdOverride(fixture.cwd, () =>
      call('catalog', {} as Parameters<typeof call>[1]),
    )
    expect(persisted.type).toBe('text')
    if (persisted.type === 'text') {
      expect(persisted.value).toContain('AWMP mode catalog')
      expect(persisted.value).toContain('com.example.ppt@0.1.0')
    }

    const transient = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `catalog --modes "${fixture.modesRoot}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(transient.type).toBe('text')
    if (transient.type === 'text') {
      expect(transient.value).toContain('com.example.customer_support@0.1.0')
      expect(transient.value).toContain('com.example.ppt@0.1.0')
    }
  })

  test('/awmp can lock and verify mode package digests', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: 'console.log(JSON.stringify({ source: "cli-lock" }))',
    })
    const modeDir = join(fixture.modesRoot, 'ppt')

    const locked = await runWithCwdOverride(fixture.cwd, () =>
      call(`lock-mode "${modeDir}"`, {} as Parameters<typeof call>[1]),
    )
    expect(locked.type).toBe('text')
    if (locked.type === 'text') {
      expect(locked.value).toContain('Locked AWMP mode com.example.ppt@0.1.0')
      expect(locked.value).toContain('Digest: sha256:')
    }

    const listed = await runWithCwdOverride(fixture.cwd, () =>
      call('mode-lock', {} as Parameters<typeof call>[1]),
    )
    expect(listed.type).toBe('text')
    if (listed.type === 'text') {
      expect(listed.value).toContain('AWMP mode lock')
      expect(listed.value).toContain('com.example.ppt@0.1.0')
    }

    const verified = await runWithCwdOverride(fixture.cwd, () =>
      call(`verify-lock "${modeDir}"`, {} as Parameters<typeof call>[1]),
    )
    expect(verified.type).toBe('text')
    if (verified.type === 'text') {
      expect(verified.value).toContain('AWMP mode lock verification: passed')
      expect(verified.value).toContain('matched')
    }
  })

  test('scaffolds and lints authorable mode packages', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-author-'))
    const modeDir = join(cwd, 'modes', 'research')
    const scaffold = await scaffoldModePackage({
      targetDir: modeDir,
      id: 'com.example.research',
      name: 'Research Mode',
      description: 'Collect evidence and produce a structured research artifact.',
      intents: ['research a topic', 'collect evidence'],
      artifactTypes: ['research.report'],
    })

    expect(scaffold.modePackage.mode.id).toBe('com.example.research')
    expect(scaffold.createdFiles.some(file => file.endsWith('mode.yaml'))).toBe(
      true,
    )
    expect(scaffold.createdFiles.some(file => file.endsWith('SKILL.md'))).toBe(
      true,
    )

    const lint = await lintModePackage(modeDir)
    expect(lint.ok).toBe(true)
    expect(lint.diagnostics.filter(item => item.severity === 'error')).toEqual(
      [],
    )

    const run = await runAwmpTaskFile(join(modeDir, 'examples', 'task.json'), {
      cwd,
      modeRoots: [join(cwd, 'modes')],
    })
    expect(run.task.status.state).toBe('completed')

    const toolCall = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'generate_artifact',
      input: { summary: 'ok', data: { source: 'test' } },
    })
    expect(toolCall.status).toBe('completed')
    expect(toolCall.stdout).toContain('research.report')
  })

  test('runs mode golden task eval records from scaffold examples', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-mode-eval-'))
    const modeDir = join(cwd, 'modes', 'research')
    await scaffoldModePackage({
      targetDir: modeDir,
      id: 'com.example.research',
      name: 'Research Mode',
      description: 'Collect evidence and produce a structured research artifact.',
      intents: ['research a topic', 'collect evidence'],
      artifactTypes: ['research.report'],
    })

    const report = await runModeEvals({
      modeDir,
      cwd,
    })

    expect(report.kind).toBe('ModeEvalReport')
    expect(report.mode.id).toBe('com.example.research')
    expect(report.summary.total).toBe(1)
    expect(report.summary.passed).toBe(1)
    expect(report.cases[0]?.status).toBe('passed')
    expect(report.cases[0]?.runDir).toBeDefined()
    expect(report.cases[0]?.runReportPath).toBeDefined()
    await expectFile(report.reportPath)
  })

  test('publishes mode packages into a durable local mode catalog', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: 'console.log(JSON.stringify({ ok: true }))',
    })
    const result = await publishModeToCatalog({
      modeDir: join(fixture.modesRoot, 'ppt'),
      cwd: fixture.cwd,
    })
    const loaded = await loadModeCatalog({
      cwd: fixture.cwd,
    })
    const transient = await buildModeCatalogFromRoots({
      modeRoots: [fixture.modesRoot],
      cwd: fixture.cwd,
    })

    expect(result.replaced).toBe(false)
    expect(result.entry.id).toBe('com.example.ppt')
    expect(result.entry.packageDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.entry.capabilities.artifactTypes).toContain(
      'presentation.pptx',
    )
    expect(result.entry.capabilities.toolKinds.local).toBe(1)
    expect(result.entry.capabilities.permissions.requiresApproval).toContain(
      'refund:create',
    )
    expect(result.entry.lint.ok).toBe(true)
    expect(loaded.entries.map(entry => entry.id)).toEqual(['com.example.ppt'])
    expect(transient.entries.map(entry => entry.id)).toEqual([
      'com.example.customer_support',
      'com.example.ppt',
    ])
    await expectFile(result.catalogPath)
  })

  test('locks mode package digests and detects local drift', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: 'console.log(JSON.stringify({ source: "lock" }))',
    })
    const modeDir = join(fixture.modesRoot, 'ppt')
    const locked = await lockModePackage({
      modeDir,
      cwd: fixture.cwd,
    })

    expect(locked.entry.id).toBe('com.example.ppt')
    expect(locked.entry.packageDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(locked.replaced).toBe(false)
    await expectFile(locked.lockPath)

    const loaded = await loadModeLock({ cwd: fixture.cwd })
    expect(loaded.entries.map(entry => entry.id)).toEqual(['com.example.ppt'])

    const verified = await verifyModeLock({
      cwd: fixture.cwd,
      modeDir,
    })
    expect(verified.ok).toBe(true)
    expect(verified.checked[0]?.status).toBe('matched')

    const modeYamlPath = join(modeDir, 'mode.yaml')
    await writeFile(
      modeYamlPath,
      `${await readFile(modeYamlPath, 'utf8')}\n# drift after lock\n`,
      'utf8',
    )

    const drifted = await verifyModeLock({
      cwd: fixture.cwd,
      modeDir,
    })
    expect(drifted.ok).toBe(false)
    expect(drifted.checked[0]?.status).toBe('mismatched')

    await expect(
      lockModePackage({
        modeDir,
        cwd: fixture.cwd,
      }),
    ).rejects.toThrow('different digest')

    const replaced = await lockModePackage({
      modeDir,
      cwd: fixture.cwd,
      force: true,
    })
    expect(replaced.replaced).toBe(true)
    expect(replaced.entry.packageDigest).not.toBe(locked.entry.packageDigest)
  })

  test('workspace policy can require locked mode digests before running tasks', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.customer_support', 'com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent: 'console.log(JSON.stringify({ source: "policy" }))',
    })

    const defaultCheck = await checkWorkspacePolicyForTaskFile({
      taskPath: fixture.taskPath,
      cwd: fixture.cwd,
      modeRoots: [fixture.modesRoot],
    })
    expect(defaultCheck.ok).toBe(true)
    expect(defaultCheck.policy.requireModeLock).toBe(false)

    await updateWorkspacePolicy({
      cwd: fixture.cwd,
      requireModeLock: true,
    })
    const blockedCheck = await checkWorkspacePolicyForTaskFile({
      taskPath: fixture.taskPath,
      cwd: fixture.cwd,
      modeRoots: [fixture.modesRoot],
    })
    expect(blockedCheck.ok).toBe(false)
    expect(blockedCheck.decisions.map(decision => decision.status)).toContain(
      'missing_lock',
    )
    await expect(
      runAwmpTaskFile(fixture.taskPath, {
        cwd: fixture.cwd,
      }),
    ).rejects.toThrow('AWMP workspace policy blocked task')

    await lockModePackage({
      modeDir: join(fixture.modesRoot, 'customer_support'),
      cwd: fixture.cwd,
    })
    await lockModePackage({
      modeDir: join(fixture.modesRoot, 'ppt'),
      cwd: fixture.cwd,
    })
    const allowedRun = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    expect(allowedRun.task.status.state).toBe('completed')
    const governance = JSON.parse(
      await readFile(
        join(allowedRun.runDir, 'artifacts', 'governance_policy.json'),
        'utf8',
      ),
    )
    expect(governance.workspacePolicy.ok).toBe(true)
    expect(governance.workspacePolicy.requireModeLock).toBe(true)
    expect(
      allowedRun.executionContext.controlPlane?.workspacePolicy?.requireModeLock,
    ).toBe(true)
    expect(
      allowedRun.executionContext.controlPlane?.workspacePolicy?.blockingDecisions,
    ).toBe(0)

    const skillPath = join(fixture.modesRoot, 'ppt', 'SKILL.md')
    await writeFile(
      skillPath,
      `${await readFile(skillPath, 'utf8')}\nchanged after lock\n`,
      'utf8',
    )
    const driftCheck = await checkWorkspacePolicyForTaskFile({
      taskPath: fixture.taskPath,
      cwd: fixture.cwd,
      modeRoots: [fixture.modesRoot],
    })
    expect(driftCheck.ok).toBe(false)
    expect(driftCheck.decisions.map(decision => decision.status)).toContain(
      'mismatched_lock',
    )
  })

  test('mode trust signatures can gate workspace task execution', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "mode-trust" }))',
    })
    const keypair = await generateModeTrustKeyPair({
      publicKeyPath: join(fixture.cwd, 'keys', 'publisher.pub.pem'),
      privateKeyPath: join(fixture.cwd, 'keys', 'publisher.key.pem'),
    })
    await updateWorkspacePolicy({
      cwd: fixture.cwd,
      requireModeSignature: true,
      trustedPublisherIds: ['com.example.publisher'],
    })

    const blockedCheck = await checkWorkspacePolicyForTaskFile({
      taskPath: fixture.taskPath,
      cwd: fixture.cwd,
      modeRoots: [fixture.modesRoot],
    })
    expect(blockedCheck.ok).toBe(false)
    expect(blockedCheck.decisions.map(decision => decision.status)).toContain(
      'missing_signature',
    )

    const signed = await signModePackage({
      modeDir: join(fixture.modesRoot, 'ppt'),
      cwd: fixture.cwd,
      publisherId: 'com.example.publisher',
      privateKeyPath: keypair.privateKeyPath,
    })
    expect(signed.signature.packageDigest).toMatch(/^sha256:[a-f0-9]{64}$/)

    const verified = await verifyModeSignature({
      modeDir: join(fixture.modesRoot, 'ppt'),
      cwd: fixture.cwd,
      publisherId: 'com.example.publisher',
      publicKeyPath: keypair.publicKeyPath,
    })
    expect(verified.ok).toBe(true)
    expect(verified.checked[0]?.status).toBe('matched')

    const allowedRun = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    expect(allowedRun.task.status.state).toBe('completed')
    expect(
      allowedRun.executionContext.controlPlane?.workspacePolicy
        ?.requireModeSignature,
    ).toBe(true)

    const skillPath = join(fixture.modesRoot, 'ppt', 'SKILL.md')
    await writeFile(
      skillPath,
      `${await readFile(skillPath, 'utf8')}\nchanged after signature\n`,
      'utf8',
    )
    const driftCheck = await checkWorkspacePolicyForTaskFile({
      taskPath: fixture.taskPath,
      cwd: fixture.cwd,
      modeRoots: [fixture.modesRoot],
    })
    expect(driftCheck.ok).toBe(false)
    expect(driftCheck.decisions.map(decision => decision.status)).toContain(
      'digest_mismatch',
    )
  })

  test('mode marketplace entries can gate and revoke workspace task execution', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "mode-marketplace" }))',
    })
    const keypair = await generateModeTrustKeyPair({
      publicKeyPath: join(fixture.cwd, 'keys', 'market.pub.pem'),
      privateKeyPath: join(fixture.cwd, 'keys', 'market.key.pem'),
    })
    await updateWorkspacePolicy({
      cwd: fixture.cwd,
      requireMarketplaceApproval: true,
      trustedPublisherIds: ['com.example.market'],
    })

    const blockedCheck = await checkWorkspacePolicyForTaskFile({
      taskPath: fixture.taskPath,
      cwd: fixture.cwd,
      modeRoots: [fixture.modesRoot],
    })
    expect(blockedCheck.ok).toBe(false)
    expect(blockedCheck.decisions.map(decision => decision.status)).toContain(
      'missing_marketplace_entry',
    )

    const published = await publishModeToMarketplace({
      modeDir: join(fixture.modesRoot, 'ppt'),
      cwd: fixture.cwd,
      publisherId: 'com.example.market',
      privateKeyPath: keypair.privateKeyPath,
    })
    expect(published.entry.status).toBe('active')
    expect(published.entry.signatureId).toBe(
      'com.example.ppt@0.1.0:com.example.market',
    )

    const verified = await verifyModeMarketplace({
      modeDir: join(fixture.modesRoot, 'ppt'),
      cwd: fixture.cwd,
      publisherId: 'com.example.market',
    })
    expect(verified.ok).toBe(true)
    expect(verified.checked[0]?.status).toBe('active')

    const allowedRun = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    expect(allowedRun.task.status.state).toBe('completed')
    expect(
      allowedRun.executionContext.controlPlane?.workspacePolicy
        ?.requireMarketplaceApproval,
    ).toBe(true)

    await revokeMarketplaceMode({
      modeId: 'com.example.ppt',
      version: '0.1.0',
      publisherId: 'com.example.market',
      reason: 'regression detected',
      revokedBy: 'test',
      cwd: fixture.cwd,
    })
    const revokedCheck = await checkWorkspacePolicyForTaskFile({
      taskPath: fixture.taskPath,
      cwd: fixture.cwd,
      modeRoots: [fixture.modesRoot],
    })
    expect(revokedCheck.ok).toBe(false)
    expect(revokedCheck.decisions.map(decision => decision.status)).toContain(
      'revoked_marketplace_entry',
    )
  })

  test('mode marketplace feed sync distributes signed entries and revocations across workspaces', async () => {
    const source = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "marketplace-feed" }))',
    })
    const target = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "marketplace-feed" }))',
    })
    const keypair = await generateModeTrustKeyPair({
      publicKeyPath: join(source.cwd, 'keys', 'feed.pub.pem'),
      privateKeyPath: join(source.cwd, 'keys', 'feed.key.pem'),
    })
    await updateWorkspacePolicy({
      cwd: target.cwd,
      requireMarketplaceApproval: true,
      trustedPublisherIds: ['com.example.feed'],
    })

    const blockedBeforeSync = await checkWorkspacePolicyForTaskFile({
      taskPath: target.taskPath,
      cwd: target.cwd,
      modeRoots: [target.modesRoot],
    })
    expect(blockedBeforeSync.ok).toBe(false)
    expect(
      blockedBeforeSync.decisions.map(decision => decision.status),
    ).toContain('missing_marketplace_entry')

    const published = await publishModeToMarketplace({
      cwd: source.cwd,
      modeDir: join(source.modesRoot, 'ppt'),
      publisherId: 'com.example.feed',
      privateKeyPath: keypair.privateKeyPath,
    })
    expect(published.entry.signature).toBeDefined()

    const syncResult = await syncModeMarketplace({
      cwd: target.cwd,
      source: published.marketplacePath,
      sourceId: 'feed-test',
    })
    expect(syncResult.added).toBe(1)
    expect(syncResult.revoked).toBe(0)
    expect(syncResult.marketplace.entries[0]?.sourceId).toBe('feed-test')

    const verified = await verifyModeMarketplace({
      cwd: target.cwd,
      modeDir: join(target.modesRoot, 'ppt'),
      publisherId: 'com.example.feed',
    })
    expect(verified.ok).toBe(true)
    expect(verified.checked[0]?.status).toBe('active')
    expect(verified.checked[0]?.root).toBe(join(target.modesRoot, 'ppt'))

    const allowedAfterSync = await checkWorkspacePolicyForTaskFile({
      taskPath: target.taskPath,
      cwd: target.cwd,
      modeRoots: [target.modesRoot],
    })
    expect(allowedAfterSync.ok).toBe(true)

    await revokeMarketplaceMode({
      cwd: source.cwd,
      modeId: 'com.example.ppt',
      version: '0.1.0',
      publisherId: 'com.example.feed',
      reason: 'remote revocation',
      revokedBy: 'feed-admin',
    })
    const revokedSync = await syncModeMarketplace({
      cwd: target.cwd,
      source: published.marketplacePath,
      sourceId: 'feed-test',
    })
    expect(revokedSync.updated).toBe(1)
    expect(revokedSync.revoked).toBe(1)

    const blockedAfterRevocation = await checkWorkspacePolicyForTaskFile({
      taskPath: target.taskPath,
      cwd: target.cwd,
      modeRoots: [target.modesRoot],
    })
    expect(blockedAfterRevocation.ok).toBe(false)
    expect(
      blockedAfterRevocation.decisions.map(decision => decision.status),
    ).toContain('revoked_marketplace_entry')
  })

  test('/awmp can read, set, and check workspace policy gates', async () => {
    const fixture = await createAwmpFixture()

    const updated = await runWithCwdOverride(fixture.cwd, () =>
      call(
        'policy-set --require-mode-lock --max-modes 2 --deny-mode com.example.blocked',
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(updated.type).toBe('text')
    if (updated.type === 'text') {
      expect(updated.value).toContain('Require mode lock: true')
      expect(updated.value).toContain('Max modes per task: 2')
      expect(updated.value).toContain('com.example.blocked')
    }

    const listed = await runWithCwdOverride(fixture.cwd, () =>
      call('policy', {} as Parameters<typeof call>[1]),
    )
    expect(listed.type).toBe('text')
    if (listed.type === 'text') {
      expect(listed.value).toContain('AWMP workspace policy')
      expect(listed.value).toContain('Require mode lock: true')
    }

    const checked = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `policy-check "${fixture.taskPath}" --modes "${fixture.modesRoot}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(checked.type).toBe('text')
    if (checked.type === 'text') {
      expect(checked.value).toContain('AWMP workspace policy check: failed')
      expect(checked.value).toContain('missing_lock')
    }
  })

  test('/awmp can generate trust keys, sign modes, and verify signatures', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "cli-trust" }))',
    })
    const publicKeyPath = join(fixture.cwd, 'keys', 'cli.pub.pem')
    const privateKeyPath = join(fixture.cwd, 'keys', 'cli.key.pem')
    const modeDir = join(fixture.modesRoot, 'ppt')

    const keygen = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `trust-keygen --public-key "${publicKeyPath}" --private-key "${privateKeyPath}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(keygen.type).toBe('text')
    if (keygen.type === 'text') {
      expect(keygen.value).toContain('Generated AWMP mode trust keypair')
    }
    await expectFile(publicKeyPath)
    await expectFile(privateKeyPath)

    const signed = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `sign-mode "${modeDir}" --publisher com.example.cli --private-key "${privateKeyPath}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(signed.type).toBe('text')
    if (signed.type === 'text') {
      expect(signed.value).toContain('Signed AWMP mode com.example.ppt@0.1.0')
      expect(signed.value).toContain('Publisher: com.example.cli')
    }

    const listed = await runWithCwdOverride(fixture.cwd, () =>
      call('mode-trust', {} as Parameters<typeof call>[1]),
    )
    expect(listed.type).toBe('text')
    if (listed.type === 'text') {
      expect(listed.value).toContain('AWMP mode trust store')
      expect(listed.value).toContain('com.example.cli')
    }

    const verified = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `verify-signature "${modeDir}" --publisher com.example.cli --public-key "${publicKeyPath}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(verified.type).toBe('text')
    if (verified.type === 'text') {
      expect(verified.value).toContain('AWMP mode signature verification: passed')
      expect(verified.value).toContain('matched')
    }
  })

  test('/awmp can publish, verify, and revoke marketplace mode entries', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "cli-marketplace" }))',
    })
    const publicKeyPath = join(fixture.cwd, 'keys', 'market.pub.pem')
    const privateKeyPath = join(fixture.cwd, 'keys', 'market.key.pem')
    const modeDir = join(fixture.modesRoot, 'ppt')

    await runWithCwdOverride(fixture.cwd, () =>
      call(
        `trust-keygen --public-key "${publicKeyPath}" --private-key "${privateKeyPath}"`,
        {} as Parameters<typeof call>[1],
      ),
    )

    const published = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `marketplace-publish "${modeDir}" --publisher com.example.market --private-key "${privateKeyPath}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(published.type).toBe('text')
    if (published.type === 'text') {
      expect(published.value).toContain(
        'Published AWMP marketplace mode com.example.ppt@0.1.0',
      )
      expect(published.value).toContain('Publisher: com.example.market')
    }

    const listed = await runWithCwdOverride(fixture.cwd, () =>
      call('marketplace', {} as Parameters<typeof call>[1]),
    )
    expect(listed.type).toBe('text')
    if (listed.type === 'text') {
      expect(listed.value).toContain('AWMP mode marketplace')
      expect(listed.value).toContain('status: active')
    }

    const verified = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `marketplace-verify "${modeDir}" --publisher com.example.market`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(verified.type).toBe('text')
    if (verified.type === 'text') {
      expect(verified.value).toContain(
        'AWMP mode marketplace verification: passed',
      )
      expect(verified.value).toContain('active')
    }

    const revoked = await runWithCwdOverride(fixture.cwd, () =>
      call(
        'marketplace-revoke com.example.ppt --version 0.1.0 --publisher com.example.market --reason "regression detected" --by tester',
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(revoked.type).toBe('text')
    if (revoked.type === 'text') {
      expect(revoked.value).toContain(
        'Revoked AWMP marketplace mode com.example.ppt@0.1.0',
      )
      expect(revoked.value).toContain('regression detected')
    }

    const verifiedAfterRevoke = await runWithCwdOverride(fixture.cwd, () =>
      call(
        `marketplace-verify "${modeDir}" --publisher com.example.market`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(verifiedAfterRevoke.type).toBe('text')
    if (verifiedAfterRevoke.type === 'text') {
      expect(verifiedAfterRevoke.value).toContain(
        'AWMP mode marketplace verification: failed',
      )
      expect(verifiedAfterRevoke.value).toContain('revoked')
    }
  })

  test('/awmp can sync marketplace feeds from another workspace', async () => {
    const source = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "cli-marketplace-feed" }))',
    })
    const target = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "cli-marketplace-feed" }))',
    })
    const sourcePublicKeyPath = join(source.cwd, 'keys', 'feed.pub.pem')
    const sourcePrivateKeyPath = join(source.cwd, 'keys', 'feed.key.pem')
    const sourceModeDir = join(source.modesRoot, 'ppt')
    const targetModeDir = join(target.modesRoot, 'ppt')
    const sourceMarketplacePath = join(
      source.cwd,
      '.leviathan',
      'awmp',
      'marketplace',
      'mode_marketplace.json',
    )

    await runWithCwdOverride(source.cwd, () =>
      call(
        `trust-keygen --public-key "${sourcePublicKeyPath}" --private-key "${sourcePrivateKeyPath}"`,
        {} as Parameters<typeof call>[1],
      ),
    )
    await runWithCwdOverride(source.cwd, () =>
      call(
        `marketplace-publish "${sourceModeDir}" --publisher com.example.cli-feed --private-key "${sourcePrivateKeyPath}"`,
        {} as Parameters<typeof call>[1],
      ),
    )

    const synced = await runWithCwdOverride(target.cwd, () =>
      call(
        `marketplace-sync "${sourceMarketplacePath}" --source-id cli-feed`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(synced.type).toBe('text')
    if (synced.type === 'text') {
      expect(synced.value).toContain('AWMP mode marketplace sync')
      expect(synced.value).toContain('Source id: cli-feed')
      expect(synced.value).toContain('Added: 1')
    }

    const verified = await runWithCwdOverride(target.cwd, () =>
      call(
        `marketplace-verify "${targetModeDir}" --publisher com.example.cli-feed`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(verified.type).toBe('text')
    if (verified.type === 'text') {
      expect(verified.value).toContain('AWMP mode marketplace verification: passed')
      expect(verified.value).toContain('inline public signature')
    }
  })

  test('first-party AWMP examples lint, catalog, and complete a cross-mode workflow', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-first-party-'))
    const examplesRoot = join(process.cwd(), 'examples', 'awmp')
    const modeRoot = join(examplesRoot, 'modes')
    const taskPath = join(examplesRoot, 'tasks', 'support_to_ppt_task.json')
    const modes = await discoverModePackages([modeRoot])
    const modeIds = modes.map(modePackage => modePackage.mode.id)

    expect(modeIds).toEqual([
      'com.leviathan.customer_support',
      'com.leviathan.ppt',
    ])
    for (const modePackage of modes) {
      const lint = await lintModePackage(modePackage.root)
      expect(lint.ok).toBe(true)
      expect(lint.diagnostics.filter(item => item.severity === 'error')).toEqual(
        [],
      )
    }

    const catalog = await buildModeCatalogFromRoots({
      modeRoots: [modeRoot],
      cwd,
    })
    expect(catalog.entries.map(entry => entry.id)).toEqual(modeIds)
    expect(
      catalog.entries.every(entry => entry.capabilities.toolKinds.local === 1),
    ).toBe(true)

    const run = await runAwmpTaskFile(taskPath, {
      cwd,
      modeRoots: [modeRoot],
    })
    const scheduler = await runAwmpScheduler({
      runDir: run.runDir,
      maxSteps: 4,
      executeValidators: true,
      validatorTimeoutMs: 5000,
    })
    const artifacts = await loadArtifactIndex(run.runDir)
    const artifactTypes = artifacts.map(artifact => artifact.type)
    const inspection = await inspectAwmpRun({
      runDir: run.runDir,
      writeReport: false,
    })

    expect(scheduler.status).toBe('completed')
    expect(artifactTypes).toContain('support.analysis.report')
    expect(artifactTypes).toContain('presentation.outline')
    expect(artifactTypes).toContain('presentation.pptx')
    expect(inspection.metrics.workCompletion.value).toBe(1)
    expect(inspection.metrics.validationPassRate.value).toBe(1)
    expect(inspection.metrics.crossModeTaskSuccess.value).toBe(1)
  })

  test('mode eval can execute scheduler passes for first-party examples', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-first-party-eval-'))
    const customerSupportModeDir = join(
      process.cwd(),
      'examples',
      'awmp',
      'modes',
      'customer_support',
    )
    const pptModeDir = join(process.cwd(), 'examples', 'awmp', 'modes', 'ppt')

    const report = await runModeEvals({
      modeDir: customerSupportModeDir,
      cwd,
      runScheduler: true,
      executeValidators: true,
      validatorTimeoutMs: 5000,
      applyReviewFixtures: true,
    })
    const positive = report.cases.find(item => item.taskPath.endsWith('task.json'))
    const negative = report.cases.find(item =>
      item.taskPath.endsWith('blocked_handoff.json'),
    )

    expect(report.summary.total).toBe(2)
    expect(report.summary.passed).toBe(2)
    expect(report.summary.workCompleted).toBe(1)
    expect(report.summary.expectationsChecked).toBe(2)
    expect(report.summary.expectationsFailed).toBe(0)
    expect(report.summary.reviewFixturesApplied).toBe(1)
    expect(positive?.schedulerPass?.status).toBe('completed')
    expect(positive?.expectation?.passed).toBe(true)
    expect(positive?.expectation?.reviewFixtures.applied).toBe(1)
    expect(positive?.metrics?.artifactAcceptance.value).toBe(1)
    expect(negative?.taskState).toBe('failed')
    expect(negative?.schedulerStatus).toBe('blocked')
    expect(negative?.expectation?.passed).toBe(true)
    await expectFile(report.reportPath)

    const pptReport = await runModeEvals({
      modeDir: pptModeDir,
      cwd,
      runScheduler: true,
      executeValidators: true,
      validatorTimeoutMs: 5000,
      applyReviewFixtures: true,
    })
    expect(pptReport.summary.total).toBe(1)
    expect(pptReport.summary.passed).toBe(1)
    expect(pptReport.summary.reviewFixturesApplied).toBe(1)
    expect(pptReport.cases[0]?.metrics?.artifactAcceptance.value).toBe(1)
  })

  test('/awmp init and /awmp lint support mode authoring', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-cli-author-'))
    const modeDir = join(cwd, 'modes', 'ops')

    const initResult = await runWithCwdOverride(cwd, () =>
      call(
        `init "${modeDir}" --id com.example.ops --name "Ops Mode" --description "Create operational handoff artifacts." --intent "write an ops handoff" --artifact ops.handoff`,
        {} as Parameters<typeof call>[1],
      ),
    )
    expect(initResult.type).toBe('text')
    if (initResult.type === 'text') {
      expect(initResult.value).toContain('Created AWMP mode com.example.ops')
      expect(initResult.value).toContain('AWMP mode lint: passed')
    }

    const lintResult = await runWithCwdOverride(cwd, () =>
      call(`lint "${modeDir}"`, {} as Parameters<typeof call>[1]),
    )
    expect(lintResult.type).toBe('text')
    if (lintResult.type === 'text') {
      expect(lintResult.value).toContain('AWMP mode lint: passed')
      expect(lintResult.value).toContain('com.example.ops')
    }
  })

  test('/awmp eval-mode runs scaffold examples and writes a report', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-cli-mode-eval-'))
    const modeDir = join(cwd, 'modes', 'ops')
    await scaffoldModePackage({
      targetDir: modeDir,
      id: 'com.example.ops',
      name: 'Ops Mode',
      description: 'Create operational handoff artifacts.',
      intents: ['create a handoff'],
      artifactTypes: ['ops.handoff'],
    })

    const result = await runWithCwdOverride(cwd, () =>
      call(`eval-mode "${modeDir}"`, {} as Parameters<typeof call>[1]),
    )

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('AWMP mode eval: com.example.ops@0.1.0')
      expect(result.value).toContain('Cases: 1/1 passed')
      expect(result.value).toContain('Report:')
    }
  })

  test('AWMP tool is available to the agent loop and can start a task', async () => {
    const fixture = await createAwmpFixture()
    const toolNames = getAllBaseTools().map(tool => tool.name)
    expect(toolNames).toContain(AWMP_TOOL_NAME)

    const result = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'start_task',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        mode_root: fixture.modesRoot,
        objective: '分析客服投诉并生成管理层 PPT',
        constraints: {
          network: 'allowlist',
          requiresHumanApprovalFor: ['refund:create'],
        },
      }),
    )

    expect(result.data.action).toBe('start_task')
    expect(result.data.summary).toContain('completed')
    expect(result.data.artifacts?.map(artifact => artifact.type)).toEqual([
      'awmp.execution_plan',
      'awmp.governance_policy',
      'awmp.tool_registry',
    ])
    expect(result.data.artifact_store_path).toBeDefined()
    expect(result.data.context_path).toBeDefined()
    expect(result.data.orchestration_path).toBeDefined()
    expect(result.data.handoff_plan_path).toBeDefined()
    expect(result.data.scheduler_path).toBeDefined()
    expect(result.data.modes?.map(mode => mode.id)).toContain(
      'com.example.customer_support',
    )
  })

  test('AWMP tool exposes workspace policy control-plane actions', async () => {
    const fixture = await createAwmpFixture()

    const updated = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'set_workspace_policy',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        require_mode_lock: true,
        max_modes_per_task: 2,
      }),
    )
    expect(updated.data.action).toBe('set_workspace_policy')
    expect(
      (updated.data.workspace_policy as { requireModeLock?: boolean })
        .requireModeLock,
    ).toBe(true)

    const checked = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'check_workspace_policy',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        task_path: fixture.taskPath,
        mode_root: fixture.modesRoot,
      }),
    )
    expect(checked.data.action).toBe('check_workspace_policy')
    expect(
      (checked.data.workspace_policy_check as { ok?: boolean }).ok,
    ).toBe(false)
    expect(checked.data.summary).toContain('failed')
  })

  test('AWMP tool exposes mode trust signing and verification actions', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "tool-trust" }))',
    })
    const publicKeyPath = join(fixture.cwd, 'keys', 'tool.pub.pem')
    const privateKeyPath = join(fixture.cwd, 'keys', 'tool.key.pem')

    const keygen = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'generate_trust_keypair',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        public_key_path: publicKeyPath,
        private_key_path: privateKeyPath,
      }),
    )
    expect(keygen.data.action).toBe('generate_trust_keypair')
    expect(keygen.data.trust_public_key_path).toBe(publicKeyPath)

    const signed = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'sign_mode',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: join(fixture.modesRoot, 'ppt'),
        publisher_id: 'com.example.tool',
        private_key_path: privateKeyPath,
      }),
    )
    expect(signed.data.action).toBe('sign_mode')
    expect(
      (signed.data.mode_signature as { publisherId?: string }).publisherId,
    ).toBe('com.example.tool')

    const verified = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'verify_mode_signature',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: join(fixture.modesRoot, 'ppt'),
        publisher_id: 'com.example.tool',
        public_key_path: publicKeyPath,
      }),
    )
    expect(verified.data.action).toBe('verify_mode_signature')
    expect(
      (verified.data.mode_signature_verification as { ok?: boolean }).ok,
    ).toBe(true)
  })

  test('AWMP tool exposes mode marketplace publish, verify, and revoke actions', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "tool-marketplace" }))',
    })
    const publicKeyPath = join(fixture.cwd, 'keys', 'tool-market.pub.pem')
    const privateKeyPath = join(fixture.cwd, 'keys', 'tool-market.key.pem')
    const modeDir = join(fixture.modesRoot, 'ppt')

    await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'generate_trust_keypair',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        public_key_path: publicKeyPath,
        private_key_path: privateKeyPath,
      }),
    )

    const published = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'publish_marketplace_mode',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: modeDir,
        publisher_id: 'com.example.tool-market',
        private_key_path: privateKeyPath,
      }),
    )
    expect(published.data.action).toBe('publish_marketplace_mode')
    expect(
      (published.data.mode_marketplace_entry as { status?: string }).status,
    ).toBe('active')

    const listed = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'read_mode_marketplace',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
      }),
    )
    expect(listed.data.action).toBe('read_mode_marketplace')
    expect(
      (listed.data.mode_marketplace as { entries?: unknown[] }).entries?.length,
    ).toBe(1)

    const verified = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'verify_mode_marketplace',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: modeDir,
        publisher_id: 'com.example.tool-market',
      }),
    )
    expect(verified.data.action).toBe('verify_mode_marketplace')
    expect(
      (verified.data.mode_marketplace_verification as { ok?: boolean }).ok,
    ).toBe(true)

    const revoked = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'revoke_marketplace_mode',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        mode_id: 'com.example.ppt',
        mode_version: '0.1.0',
        publisher_id: 'com.example.tool-market',
        revocation_reason: 'regression detected',
        revoked_by: 'test',
      }),
    )
    expect(revoked.data.action).toBe('revoke_marketplace_mode')
    expect(
      (revoked.data.mode_marketplace_entry as { status?: string }).status,
    ).toBe('revoked')
  })

  test('AWMP tool can sync marketplace feeds for remote mode governance', async () => {
    const source = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "tool-marketplace-feed" }))',
    })
    const target = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "tool-marketplace-feed" }))',
    })
    const publicKeyPath = join(source.cwd, 'keys', 'tool-feed.pub.pem')
    const privateKeyPath = join(source.cwd, 'keys', 'tool-feed.key.pem')
    const sourceModeDir = join(source.modesRoot, 'ppt')
    const targetModeDir = join(target.modesRoot, 'ppt')

    await runWithCwdOverride(source.cwd, () =>
      callAwmpToolForTest({
        action: 'generate_trust_keypair',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        public_key_path: publicKeyPath,
        private_key_path: privateKeyPath,
      }),
    )
    const published = await runWithCwdOverride(source.cwd, () =>
      callAwmpToolForTest({
        action: 'publish_marketplace_mode',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: sourceModeDir,
        publisher_id: 'com.example.tool-feed',
        private_key_path: privateKeyPath,
      }),
    )
    const sourceMarketplacePath = published.data.mode_marketplace_path
    expect(sourceMarketplacePath).toBeDefined()

    const synced = await runWithCwdOverride(target.cwd, () =>
      callAwmpToolForTest({
        action: 'sync_mode_marketplace',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        marketplace_source: sourceMarketplacePath,
        marketplace_source_id: 'tool-feed',
      }),
    )
    expect(synced.data.action).toBe('sync_mode_marketplace')
    expect(
      (synced.data.mode_marketplace_sync as { added?: number; sourceId?: string })
        .added,
    ).toBe(1)
    expect(
      (synced.data.mode_marketplace_sync as { sourceId?: string }).sourceId,
    ).toBe('tool-feed')

    const verified = await runWithCwdOverride(target.cwd, () =>
      callAwmpToolForTest({
        action: 'verify_mode_marketplace',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: targetModeDir,
        publisher_id: 'com.example.tool-feed',
      }),
    )
    expect(verified.data.action).toBe('verify_mode_marketplace')
    expect(
      (verified.data.mode_marketplace_verification as { ok?: boolean }).ok,
    ).toBe(true)
  })

  test('AWMP tool can call a registered local tool from a run', async () => {
    const fixture = await createAwmpFixture({
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "awmp-tool", input: process.env.AWMP_TOOL_INPUT_JSON }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })

    const result = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'call_registered_tool',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
        tool_name: 'create_deck',
        tool_input: { slides: 2 },
      }),
    )

    expect(result.data.action).toBe('call_registered_tool')
    expect(result.data.tool_call?.status).toBe('completed')
    expect(result.data.tool_call?.stdout).toContain('awmp-tool')
  })

  test('AWMP tool can advance a scheduler step from a run', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "awmp-scheduler", input: process.env.AWMP_TOOL_INPUT_JSON }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })

    const result = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'run_scheduler_step',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
        scheduler_mode_id: 'com.example.ppt',
        tool_input: { slides: 6 },
      }),
    )

    expect(result.data.action).toBe('run_scheduler_step')
    expect(result.data.scheduler_step?.state).toBe('completed')
    expect(result.data.scheduler_step?.registeredArtifactUris?.length).toBe(2)
    expect(result.data.scheduler_step?.validationSummary?.skipped).toBe(1)
    expect(result.data.tool_call?.status).toBe('completed')
    expect(result.data.tool_call?.stdout).toContain('awmp-scheduler')
  })

  test('AWMP tool can inspect and evaluate run records', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ artifact: { type: "presentation.pptx", content: { source: "tool-eval" } } }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      timeoutMs: 5000,
    })

    const inspected = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'inspect_run',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
      }),
    )
    expect((inspected.data.run_report as { kind?: string }).kind).toBe(
      'RunInspectionReport',
    )
    expect(inspected.data.run_report_path).toBeDefined()

    const evaluated = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'eval_runs',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        runs_root: join(fixture.cwd, '.leviathan', 'awmp', 'runs'),
      }),
    )
    expect((evaluated.data.eval_report as { kind?: string }).kind).toBe(
      'EvalReport',
    )
    expect(evaluated.data.eval_report_path).toBeDefined()
  })

  test('AWMP tool can record artifact reviews for acceptance evidence', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ artifact: { type: "presentation.pptx", content: { source: "tool-review" } } }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    await runAwmpSchedulerStep({
      runDir: run.runDir,
      modeId: 'com.example.ppt',
      timeoutMs: 5000,
    })
    const snapshot = await loadArtifactStoreSnapshot(run.runDir)
    const deckArtifact = snapshot.artifacts.find(
      artifact => artifact.type === 'presentation.pptx',
    )
    expect(deckArtifact).toBeDefined()

    const recorded = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'record_artifact_review',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
        artifact_ref: deckArtifact!.id,
        artifact_review_status: 'accepted',
        artifact_reviewed_by: 'awmp-tool-test',
        artifact_review_note: 'accepted by reviewer',
      }),
    )
    expect(recorded.data.action).toBe('record_artifact_review')
    expect(recorded.data.artifact_reviews?.[0]?.status).toBe('accepted')
    expect(recorded.data.artifact_reviews?.[0]?.accepted).toBe(true)

    const listed = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'list_artifact_reviews',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
      }),
    )
    expect(listed.data.artifact_reviews?.map(review => review.artifactId)).toContain(
      deckArtifact!.id,
    )

    const inspected = await inspectAwmpRun({
      runDir: run.runDir,
      writeReport: false,
    })
    expect(inspected.metrics.artifactAcceptance.status).toBe('computed')
    expect(inspected.metrics.artifactAcceptance.value).toBe(1)
  })

  test('AWMP tool can list and decide approval requests', async () => {
    const fixture = await createAwmpFixture({
      pptToolName: 'refund:create',
      pptToolCommand: 'bun tools/refund.ts',
      pptToolScriptPath: 'tools/refund.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "awmp-approval", input: process.env.AWMP_TOOL_INPUT_JSON }))',
    })
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })

    const first = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'call_registered_tool',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
        tool_name: 'refund:create',
        tool_input: { amount: 7 },
      }),
    )
    const approvalId = first.data.tool_call?.approvalRequestId
    expect(first.data.tool_call?.status).toBe('approval_required')
    expect(approvalId).toMatch(/^approval_/)
    const approvedApprovalId = approvalId!

    const listed = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'list_approvals',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
      }),
    )
    expect(listed.data.approvals?.map(approval => approval.id)).toContain(
      approvedApprovalId,
    )
    expect(listed.data.approvals?.[0]?.status).toBe('pending')

    const approved = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'approve_request',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
        approval_id: approvedApprovalId,
        approval_decided_by: 'awmp-tool-test',
      }),
    )
    expect(approved.data.approvals?.[0]?.status).toBe('approved')

    const completed = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'call_registered_tool',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
        tool_name: 'refund:create',
        tool_input: { amount: 7 },
        approval_id: approvedApprovalId,
      }),
    )
    expect(completed.data.tool_call?.status).toBe('completed')
    expect(completed.data.tool_call?.stdout).toContain('awmp-approval')
  })

  test('AWMP tool can scaffold and lint a mode package', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-tool-author-'))
    const modeDir = join(cwd, 'modes', 'handoff')

    const created = await runWithCwdOverride(cwd, () =>
      callAwmpToolForTest({
        action: 'create_mode',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        target_dir: modeDir,
        mode_id: 'com.example.handoff',
        mode_name: 'Handoff Mode',
        mode_description: 'Produce structured handoff artifacts.',
        mode_intents: ['create a handoff'],
        artifact_types: ['handoff.document'],
      }),
    )

    expect(created.data.action).toBe('create_mode')
    expect(created.data.lint_ok).toBe(true)
    expect(created.data.created_files?.some(file => file.endsWith('mode.yaml'))).toBe(
      true,
    )

    const linted = await runWithCwdOverride(cwd, () =>
      callAwmpToolForTest({
        action: 'lint_mode',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: modeDir,
      }),
    )
    expect(linted.data.action).toBe('lint_mode')
    expect(linted.data.lint_ok).toBe(true)
    expect(linted.data.diagnostics?.filter(item => item.severity === 'error')).toEqual(
      [],
    )
  })

  test('AWMP tool can publish and read the local mode catalog', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "awmp-tool-catalog" }))',
    })

    const published = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'publish_mode',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: join(fixture.modesRoot, 'ppt'),
      }),
    )
    expect(published.data.action).toBe('publish_mode')
    expect(
      (published.data.mode_catalog_entry as { id?: string; packageDigest?: string })
        .id,
    ).toBe('com.example.ppt')
    expect(
      (published.data.mode_catalog_entry as { packageDigest?: string })
        .packageDigest,
    ).toMatch(/^sha256:/)

    const persisted = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'catalog_modes',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
      }),
    )
    const catalog = persisted.data.mode_catalog as {
      entries?: Array<{ id: string }>
    }
    expect(catalog.entries?.map(entry => entry.id)).toEqual(['com.example.ppt'])

    const transient = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'catalog_modes',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        mode_root: fixture.modesRoot,
      }),
    )
    const transientCatalog = transient.data.mode_catalog as {
      entries?: Array<{ id: string }>
    }
    expect(transientCatalog.entries?.map(entry => entry.id)).toEqual([
      'com.example.customer_support',
      'com.example.ppt',
    ])
  })

  test('AWMP tool can export and install mode bundles', async () => {
    const source = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "awmp-tool-bundle" }))',
    })
    const targetCwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-tool-bundle-'))
    const bundlePath = join(source.cwd, 'bundles', 'tool-ppt.awmp-mode.json')

    const exported = await runWithCwdOverride(source.cwd, () =>
      callAwmpToolForTest({
        action: 'export_mode_bundle',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: join(source.modesRoot, 'ppt'),
        bundle_path: bundlePath,
      }),
    )
    expect(exported.data.action).toBe('export_mode_bundle')
    expect(exported.data.mode_bundle_path).toBe(bundlePath)
    expect(exported.data.mode_bundle_file_count).toBeGreaterThan(0)

    const installed = await runWithCwdOverride(targetCwd, () =>
      callAwmpToolForTest({
        action: 'install_mode_bundle',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        bundle_path: bundlePath,
      }),
    )
    expect(installed.data.action).toBe('install_mode_bundle')
    expect(installed.data.installed_root).toBe(
      join(targetCwd, '.leviathan', 'awmp', 'modes', 'com.example.ppt'),
    )
    expect(installed.data.modes?.map(mode => mode.id)).toEqual([
      'com.example.ppt',
    ])
  })

  test('AWMP tool can lock and verify mode package digests', async () => {
    const fixture = await createAwmpFixture({
      taskModeIds: ['com.example.ppt'],
      pptToolCommand: 'bun tools/create_deck.ts',
      pptToolScriptPath: 'tools/create_deck.ts',
      pptToolScriptContent:
        'console.log(JSON.stringify({ source: "awmp-tool-lock" }))',
    })
    const modeDir = join(fixture.modesRoot, 'ppt')

    const locked = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'lock_mode',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: modeDir,
      }),
    )
    expect(locked.data.action).toBe('lock_mode')
    expect(locked.data.mode_lock_path).toBeDefined()
    expect(
      (locked.data.mode_lock_entry as { id?: string; packageDigest?: string }).id,
    ).toBe('com.example.ppt')
    expect(
      (locked.data.mode_lock_entry as { packageDigest?: string }).packageDigest,
    ).toMatch(/^sha256:/)

    const readLock = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'read_mode_lock',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
      }),
    )
    const lock = readLock.data.mode_lock as { entries?: Array<{ id: string }> }
    expect(lock.entries?.map(entry => entry.id)).toEqual(['com.example.ppt'])

    const verified = await runWithCwdOverride(fixture.cwd, () =>
      callAwmpToolForTest({
        action: 'verify_mode_lock',
        force: false,
        approve_tool_call: false,
        execute_validators: false,
        source_dir: modeDir,
      }),
    )
    const verification = verified.data.mode_lock_verification as {
      ok?: boolean
      checked?: Array<{ status: string }>
    }
    expect(verification.ok).toBe(true)
    expect(verification.checked?.[0]?.status).toBe('matched')
  })

  test('AWMP tool can run mode eval records', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-tool-mode-eval-'))
    const modeDir = join(cwd, 'modes', 'review')
    await scaffoldModePackage({
      targetDir: modeDir,
      id: 'com.example.review',
      name: 'Review Mode',
      description: 'Review an artifact and produce a decision record.',
      intents: ['review an artifact'],
      artifactTypes: ['review.decision'],
    })

    const evaluated = await runWithCwdOverride(cwd, () =>
      callAwmpToolForTest({
        action: 'eval_mode',
        force: false,
        approve_tool_call: false,
        execute_validators: true,
        eval_run_scheduler: true,
        source_dir: modeDir,
      }),
    )

    expect(evaluated.data.action).toBe('eval_mode')
    expect(evaluated.data.mode_eval_report_path).toBeDefined()
    expect(
      (evaluated.data.mode_eval_report as { kind?: string; summary?: { total?: number; passed?: number } })
        .kind,
    ).toBe('ModeEvalReport')
    expect(
      (evaluated.data.mode_eval_report as { summary?: { total?: number; passed?: number } })
        .summary?.total,
    ).toBe(1)
    expect(
      (evaluated.data.mode_eval_report as { summary?: { total?: number; passed?: number } })
        .summary?.passed,
    ).toBe(1)
    expect(
      (evaluated.data.mode_eval_report as { summary?: { workCompleted?: number } })
        .summary?.workCompleted,
    ).toBe(1)
  })

  test('AWMP tool bridges connected session MCP tools for registered MCP calls', async () => {
    clearAwmpMcpAdaptersForTests()
    const fixture = await createAwmpFixture()
    const run = await runAwmpTaskFile(fixture.taskPath, {
      cwd: fixture.cwd,
    })
    const context = {
      options: {
        tools: [
          {
            name: 'mcp__zendesk__tickets_search',
            mcpInfo: {
              serverName: 'zendesk',
              toolName: 'tickets.search',
            },
            async call(args: Record<string, unknown>) {
              return {
                data: {
                  source: 'session-mcp',
                  args,
                },
              }
            },
          },
        ],
      },
    }

    const result = await AwmpTool.call(
      {
        action: 'call_registered_tool',
        force: false,
        force_retry: false,
        eval_run_scheduler: false,
        apply_review_fixtures: false,
        clear_allowed_mode_ids: false,
        clear_denied_mode_ids: false,
        clear_trusted_publisher_ids: false,
        approve_tool_call: false,
        execute_validators: false,
        run_dir: run.runDir,
        tool_name: 'zendesk.tickets.search',
        tool_input: { status: 'pending' },
      },
      context as never,
      (() => Promise.resolve({ behavior: 'allow' })) as never,
      {} as never,
    )

    expect(result.data.action).toBe('call_registered_tool')
    expect(result.data.tool_call?.status).toBe('completed')
    expect(result.data.tool_call?.stdout).toContain('session-mcp')
    expect(result.data.tool_call?.stdout).toContain('"status":"pending"')

    const after = await callRegisteredTool({
      runDir: run.runDir,
      toolName: 'zendesk.tickets.search',
    })
    expect(after.status).toBe('deferred')
  })
})

type AwmpToolInput = Parameters<typeof AwmpTool.call>[0]
type AwmpToolDefaultedInputKey =
  | 'force_retry'
  | 'eval_run_scheduler'
  | 'apply_review_fixtures'
  | 'clear_allowed_mode_ids'
  | 'clear_denied_mode_ids'
  | 'clear_trusted_publisher_ids'
type AwmpToolInputForTest = Omit<AwmpToolInput, AwmpToolDefaultedInputKey> &
  Partial<Pick<AwmpToolInput, AwmpToolDefaultedInputKey>>

function callAwmpToolForTest(
  input: AwmpToolInputForTest,
): ReturnType<typeof AwmpTool.call> {
  return AwmpTool.call(
    {
      force_retry: false,
      eval_run_scheduler: false,
      apply_review_fixtures: false,
      clear_allowed_mode_ids: false,
      clear_denied_mode_ids: false,
      clear_trusted_publisher_ids: false,
      ...input,
    } as AwmpToolInput,
    {
      options: {
        tools: [],
      },
    } as never,
    (() => Promise.resolve({ behavior: 'allow' })) as never,
    {} as never,
  )
}

async function createAwmpFixture(options: {
  pptValidatorCommand?: string
  pptValidatorScriptPath?: string
  pptValidatorScriptContent?: string
  pptToolName?: string
  pptToolCommand?: string
  pptToolScriptPath?: string
  pptToolScriptContent?: string
  pptToolYamlLines?: string[]
  customerSupportHandoffYamlLines?: string[]
  pptHandoffYamlLines?: string[]
  taskModeIds?: string[]
  taskConstraints?: Record<string, unknown>
} = {}): Promise<{
  cwd: string
  modesRoot: string
  taskPath: string
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'leviathan-awmp-'))
  const examplesRoot = join(cwd, 'examples')
  const modesRoot = join(examplesRoot, 'modes')
  const tasksRoot = join(examplesRoot, 'tasks')

  await writeMode({
    root: join(modesRoot, 'customer_support'),
    id: 'com.example.customer_support',
    name: 'Customer Support Mode',
    description: '处理客服工单、投诉归因、回复草稿、退款审批请求和客服周报数据。',
    intents: ['处理客服工单', '分析投诉', '生成客服周报'],
    antiExamples: ['把这些数据做成 PPT'],
    outputType: 'support.analysis.report',
    validatorId: 'support_schema_check',
    handoffYamlLines: options.customerSupportHandoffYamlLines,
    toolYamlLines: [
      'tools:',
      '  mcp:',
      '    - server: "zendesk"',
      '      allow:',
      '        - "tickets.search"',
    ],
  })
  await writeMode({
    root: join(modesRoot, 'ppt'),
    id: 'com.example.ppt',
    name: 'PPT Generation Mode',
    description: '把结构化分析、报告或大纲转成 PPTX。',
    intents: ['生成 PPT', '制作演示文稿', '管理层汇报'],
    antiExamples: ['处理客户退款'],
    outputType: 'presentation.pptx',
    validatorId: 'ppt_file_check',
    validatorCommand: options.pptValidatorCommand,
    validatorScriptPath: options.pptValidatorScriptPath,
    validatorScriptContent: options.pptValidatorScriptContent,
    handoffYamlLines: options.pptHandoffYamlLines,
    toolYamlLines:
      options.pptToolYamlLines ?? [
        'tools:',
        '  local:',
        `    - name: "${options.pptToolName ?? 'create_deck'}"`,
        `      command: "${options.pptToolCommand ?? 'python tools/create_deck.py'}"`,
      ],
    extraFiles:
      options.pptToolScriptPath === undefined ||
      options.pptToolScriptContent === undefined
        ? []
        : [
            {
              path: options.pptToolScriptPath,
              content: options.pptToolScriptContent,
            },
          ],
  })

  await mkdir(tasksRoot, { recursive: true })
  const taskPath = join(tasksRoot, 'support_to_ppt_task.json')
  await writeFile(
    taskPath,
    JSON.stringify(
      {
        awmp: '0.1',
        kind: 'Task',
        id: 'task_support_to_ppt_demo',
        contextId: 'ctx_demo',
        title: '客服投诉分析与管理层周报 PPT',
        objective: '分析过去 7 天客服投诉，生成 8 页以内管理层 PPT。',
        modeIds: options.taskModeIds ?? [
          'com.example.customer_support',
          'com.example.ppt',
        ],
        inputs: {
          maxSlides: 8,
        },
        status: {
          state: 'submitted',
        },
        constraints: options.taskConstraints ?? {
          maxRuntimeSeconds: 900,
          network: 'allowlist',
        },
        artifacts: [],
        traceId: 'trace_demo',
      },
      null,
      2,
    ),
    'utf8',
  )

  return { cwd, modesRoot, taskPath }
}

async function writeMode(input: {
  root: string
  id: string
  name: string
  description: string
  intents: string[]
  antiExamples: string[]
  outputType: string
  validatorId: string
  validatorCommand?: string
  validatorScriptPath?: string
  validatorScriptContent?: string
  handoffYamlLines?: string[]
  toolYamlLines?: string[]
  extraFiles?: Array<{ path: string; content: string }>
}): Promise<void> {
  await mkdir(input.root, { recursive: true })
  await writeFile(
    join(input.root, 'mode.yaml'),
    [
      'awmp: "0.1"',
      'kind: "Mode"',
      `id: "${input.id}"`,
      `name: "${input.name}"`,
      'version: "0.1.0"',
      `description: "${input.description}"`,
      'activation:',
      '  intents:',
      ...input.intents.map(intent => `    - "${intent}"`),
      '  antiExamples:',
      ...input.antiExamples.map(antiExample => `    - "${antiExample}"`),
      'outputs:',
      '  artifacts:',
      `    - type: "${input.outputType}"`,
      '      mediaType: "application/json"',
      ...(input.handoffYamlLines ?? []),
      'validators:',
      `  - id: "${input.validatorId}"`,
      `    command: "${input.validatorCommand ?? 'python validators/missing.py'}"`,
      '    blocking: true',
      ...(input.toolYamlLines ?? []),
      'permissions:',
      '  default:',
      '    - "artifact:read"',
      '  requiresApproval:',
      '    - "refund:create"',
      '  denied:',
      '    - "policy:export_internal_raw"',
      '    - "email:send_external"',
    ].join('\n'),
    'utf8',
  )
  if (
    input.validatorScriptPath !== undefined &&
    input.validatorScriptContent !== undefined
  ) {
    const scriptPath = join(input.root, input.validatorScriptPath)
    await mkdir(dirname(scriptPath), { recursive: true })
    await writeFile(scriptPath, input.validatorScriptContent, 'utf8')
  }
  for (const extraFile of input.extraFiles ?? []) {
    const filePath = join(input.root, extraFile.path)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, extraFile.content, 'utf8')
  }
  await writeFile(
    join(input.root, 'SKILL.md'),
    `---\nname: ${input.id}\ndescription: ${input.description}\n---\n\n# ${input.name}\n`,
    'utf8',
  )
}

async function expectFile(path: string): Promise<void> {
  expect((await stat(path)).isFile()).toBe(true)
}
