import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import { loadArtifactIndex } from './artifactStore.js'
import {
  recordArtifactReview,
  type AwmpArtifactReviewRecord,
  type AwmpArtifactReviewStatus,
} from './artifactReviewStore.js'
import {
  inspectAwmpRun,
  type AwmpEvidenceMetric,
  type AwmpRunInspectionReport,
} from './evalReporter.js'
import { lintModePackage } from './modeAuthoring.js'
import { getAwmpStateRoot, sanitizePathSegment } from './paths.js'
import { runAwmpTaskFile } from './runtime.js'
import { runAwmpScheduler } from './scheduler.js'

export type AwmpModeEvalCaseStatus = 'passed' | 'failed'

export type AwmpModeEvalCaseResult = {
  awmp: '0.1'
  kind: 'ModeEvalCaseResult'
  id: string
  taskPath: string
  runDir?: string
  runReportPath?: string
  status: AwmpModeEvalCaseStatus
  startedAt: string
  completedAt: string
  durationMs: number
  taskState?: string
  schedulerStatus?: string
  schedulerPass?: {
    attemptedSteps: number
    status: string
    message: string
  }
  metrics?: Record<string, AwmpEvidenceMetric>
  validations?: {
    total: number
    passed: number
    failed: number
    skipped: number
    blockingFailures: number
  }
  artifacts?: {
    total: number
    business: number
  }
  expectation?: AwmpModeEvalExpectationResult
  evidenceGaps: string[]
  error?: string
}

export type AwmpModeEvalReport = {
  awmp: '0.1'
  kind: 'ModeEvalReport'
  id: string
  generatedAt: string
  mode: {
    id: string
    name: string
    version: string
  }
  modeRoot: string
  reportPath: string
  cases: AwmpModeEvalCaseResult[]
  evidenceGaps: string[]
  summary: {
    total: number
    passed: number
    failed: number
    workCompleted: number
    validationPassed: number
    validationFailed: number
    expectationsChecked: number
    expectationsFailed: number
    reviewFixturesApplied: number
    evidenceGaps: number
  }
}

export type AwmpModeEvalOptions = {
  modeDir: string
  cwd?: string
  executeValidators?: boolean
  validatorTimeoutMs?: number
  runScheduler?: boolean
  schedulerMaxSteps?: number
  toolTimeoutMs?: number
  applyReviewFixtures?: boolean
  reportPath?: string
}

export type AwmpModeEvalExpectation = {
  awmp: '0.1'
  kind: 'ModeEvalExpectation'
  expectRuntimePass?: boolean
  expectedTaskState?: string
  expectedSchedulerStatus?: string
  requiredArtifactTypes?: string[]
  forbiddenArtifactTypes?: string[]
  expectedMetrics?: Record<string, number>
  artifactReviewFixtures?: AwmpModeEvalArtifactReviewFixture[]
}

export type AwmpModeEvalArtifactReviewFixture = {
  artifactType: string
  status: AwmpArtifactReviewStatus
  reviewedBy?: string
  note?: string
  requestedChanges?: string
}

export type AwmpModeEvalExpectationResult = {
  path: string
  passed: boolean
  failures: string[]
  checked: {
    requiredArtifactTypes: string[]
    forbiddenArtifactTypes: string[]
    expectedMetrics: string[]
  }
  reviewFixtures: {
    declared: number
    applied: number
    skipped: number
    records: Array<{
      id: string
      artifactId: string
      artifactType: string
      status: string
      accepted: boolean
    }>
  }
}

export async function discoverModeEvalTasks(
  modeDir: string,
): Promise<string[]> {
  const examplesRoot = join(resolve(modeDir), 'examples')
  const candidates = await listJsonFiles(examplesRoot)
  const taskPaths: string[] = []
  for (const candidate of candidates) {
    if (await isAwmpTaskFile(candidate)) {
      taskPaths.push(candidate)
    }
  }
  return taskPaths.sort((left, right) => left.localeCompare(right))
}

export async function runModeEvals(
  options: AwmpModeEvalOptions,
): Promise<AwmpModeEvalReport> {
  const modeRoot = resolve(options.modeDir)
  const lint = await lintModePackage(modeRoot)
  if (!lint.ok || lint.modePackage === undefined) {
    const messages = lint.diagnostics
      .filter(diagnostic => diagnostic.severity === 'error')
      .map(diagnostic => diagnostic.message)
    throw new Error(
      messages.length === 0
        ? 'Mode package lint failed.'
        : `Mode package lint failed: ${messages.join('; ')}`,
    )
  }

  const modePackage = lint.modePackage
  const taskPaths = await discoverModeEvalTasks(modeRoot)
  const reportPath = resolveModeEvalReportPath({
    cwd: options.cwd,
    modeId: modePackage.mode.id,
    reportPath: options.reportPath,
  })
  const cases: AwmpModeEvalCaseResult[] = []

  for (const taskPath of taskPaths) {
    cases.push(
      await runModeEvalCase({
        taskPath,
        cwd: options.cwd,
        modeRoot,
        executeValidators: options.executeValidators === true,
        validatorTimeoutMs: options.validatorTimeoutMs,
        runScheduler: options.runScheduler === true,
        schedulerMaxSteps: options.schedulerMaxSteps,
        toolTimeoutMs: options.toolTimeoutMs,
        applyReviewFixtures: options.applyReviewFixtures === true,
      }),
    )
  }
  const evidenceGaps =
    cases.length === 0
      ? [`No AWMP Task JSON files found under ${join(modeRoot, 'examples')}.`]
      : unique(cases.flatMap(item => item.evidenceGaps))

  const report: AwmpModeEvalReport = {
    awmp: '0.1',
    kind: 'ModeEvalReport',
    id: `mode_eval_${randomUUID()}`,
    generatedAt: new Date().toISOString(),
    mode: {
      id: modePackage.mode.id,
      name: modePackage.mode.name,
      version: modePackage.mode.version,
    },
    modeRoot,
    reportPath,
    cases,
    evidenceGaps,
    summary: buildSummary(cases, evidenceGaps),
  }

  await writeJson(reportPath, report)
  return report
}

export function formatModeEvalReport(report: AwmpModeEvalReport): string {
  const lines = [
    `AWMP mode eval: ${report.mode.id}@${report.mode.version}`,
    `Mode root: ${report.modeRoot}`,
    `Report: ${report.reportPath}`,
    `Cases: ${report.summary.passed}/${report.summary.total} passed`,
    `Work completed: ${report.summary.workCompleted}/${report.summary.total}`,
    `Validation clean: ${report.summary.validationPassed}/${report.summary.total}`,
    `Expectations: ${report.summary.expectationsChecked - report.summary.expectationsFailed}/${report.summary.expectationsChecked} clean`,
    `Review fixtures applied: ${report.summary.reviewFixturesApplied}`,
    `Evidence gaps: ${report.summary.evidenceGaps}`,
  ]

  if (report.cases.length === 0) {
    lines.push('No golden task JSON files were found under examples/.')
    return lines.join('\n')
  }

  lines.push('')
  for (const item of report.cases) {
    lines.push(
      [
        `- ${basename(item.taskPath)}: ${item.status}`,
        `  task: ${item.taskState ?? 'unknown'}`,
        `  scheduler: ${item.schedulerStatus ?? 'unknown'}`,
        item.schedulerPass === undefined
          ? ''
          : `  scheduler pass: ${item.schedulerPass.status} (${item.schedulerPass.attemptedSteps} step(s))`,
        item.expectation === undefined
          ? ''
          : `  expectation: ${item.expectation.passed ? 'passed' : 'failed'} (${item.expectation.path})`,
        item.expectation === undefined ||
        item.expectation.failures.length === 0
          ? ''
          : `  expectation failures: ${item.expectation.failures.join('; ')}`,
        item.runDir === undefined ? '' : `  run: ${item.runDir}`,
        item.error === undefined ? '' : `  error: ${item.error}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  return lines.join('\n')
}

async function runModeEvalCase(input: {
  taskPath: string
  cwd?: string
  modeRoot: string
  executeValidators: boolean
  validatorTimeoutMs?: number
  runScheduler: boolean
  schedulerMaxSteps?: number
  toolTimeoutMs?: number
  applyReviewFixtures: boolean
}): Promise<AwmpModeEvalCaseResult> {
  const startedAt = new Date()
  const caseId = `case_${sanitizePathSegment(basename(input.taskPath, extname(input.taskPath)))}`
  try {
    const expectation = await loadModeEvalExpectation(input.taskPath)
    const run = await runAwmpTaskFile(input.taskPath, {
      cwd: input.cwd,
      modeRoots: [dirname(input.modeRoot)],
      executeValidators: input.executeValidators,
      validatorTimeoutMs: input.validatorTimeoutMs,
    })
    const schedulerPass = input.runScheduler
      ? await runAwmpScheduler({
          runDir: run.runDir,
          maxSteps: input.schedulerMaxSteps,
          timeoutMs: input.toolTimeoutMs,
          executeValidators: input.executeValidators,
          validatorTimeoutMs: input.validatorTimeoutMs,
        })
      : undefined
    const appliedReviewFixtures =
      expectation === undefined
        ? []
        : await applyArtifactReviewFixtures({
            runDir: run.runDir,
            expectation,
            enabled: input.applyReviewFixtures,
          })
    const inspection = await inspectAwmpRun({ runDir: run.runDir })
    const expectationResult =
      expectation === undefined
        ? undefined
        : await evaluateModeEvalExpectation({
            expectation,
            expectationPath: expectationPathForTask(input.taskPath),
            inspection,
            runDir: run.runDir,
            appliedReviewFixtures,
            applyReviewFixtures: input.applyReviewFixtures,
          })
    const completedAt = new Date()
    const runtimePass = didModeEvalCasePass(inspection)
    const requiresRuntimePass = expectation?.expectRuntimePass ?? true
    const status =
      (!requiresRuntimePass || runtimePass) &&
      (expectationResult === undefined || expectationResult.passed)
        ? 'passed'
        : 'failed'
    return {
      awmp: '0.1',
      kind: 'ModeEvalCaseResult',
      id: caseId,
      taskPath: input.taskPath,
      runDir: run.runDir,
      runReportPath: inspection.reportPath,
      status,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      taskState: inspection.task.state,
      schedulerStatus: inspection.scheduler.status,
      schedulerPass:
        schedulerPass === undefined
          ? undefined
          : {
              attemptedSteps: schedulerPass.steps.length,
              status: schedulerPass.status,
              message: schedulerPass.message,
            },
      metrics: inspection.metrics,
      validations: {
        total: inspection.validations.total,
        passed: inspection.validations.passed,
        failed: inspection.validations.failed,
        skipped: inspection.validations.skipped,
        blockingFailures: inspection.validations.blockingFailures,
      },
      artifacts: {
        total: inspection.artifacts.total,
        business: inspection.artifacts.business,
      },
      expectation: expectationResult,
      evidenceGaps: [
        ...inspection.evidenceGaps,
        ...expectationEvidenceGaps({
          expectation,
          applyReviewFixtures: input.applyReviewFixtures,
        }),
      ],
    }
  } catch (error) {
    const completedAt = new Date()
    return {
      awmp: '0.1',
      kind: 'ModeEvalCaseResult',
      id: caseId,
      taskPath: input.taskPath,
      status: 'failed',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      evidenceGaps: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function didModeEvalCasePass(report: AwmpRunInspectionReport): boolean {
  return (
    report.task.state === 'completed' &&
    report.validations.blockingFailures === 0
  )
}

function buildSummary(
  cases: AwmpModeEvalCaseResult[],
  evidenceGaps: string[],
): AwmpModeEvalReport['summary'] {
  return {
    total: cases.length,
    passed: cases.filter(item => item.status === 'passed').length,
    failed: cases.filter(item => item.status === 'failed').length,
    workCompleted: cases.filter(
      item => item.metrics?.workCompletion?.value === 1,
    ).length,
    validationPassed: cases.filter(
      item => (item.validations?.blockingFailures ?? 1) === 0,
    ).length,
    validationFailed: cases.filter(
      item => (item.validations?.blockingFailures ?? 0) > 0,
    ).length,
    expectationsChecked: cases.filter(item => item.expectation !== undefined)
      .length,
    expectationsFailed: cases.filter(
      item => item.expectation !== undefined && !item.expectation.passed,
    ).length,
    reviewFixturesApplied: cases.reduce(
      (total, item) => total + (item.expectation?.reviewFixtures.applied ?? 0),
      0,
    ),
    evidenceGaps: evidenceGaps.length,
  }
}

function resolveModeEvalReportPath(input: {
  cwd?: string
  modeId: string
  reportPath?: string
}): string {
  if (input.reportPath !== undefined) return resolve(input.reportPath)
  const timestamp = new Date().toISOString().replace(/[^0-9TZ]+/g, '-')
  return join(
    getAwmpStateRoot(input.cwd),
    'evals',
    sanitizePathSegment(input.modeId),
    `mode_eval_${timestamp}_${randomUUID()}.json`,
  )
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

async function listJsonFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const results: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await listJsonFiles(path)))
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      results.push(path)
    }
  }
  return results
}

async function isAwmpTaskFile(path: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      awmp?: unknown
      kind?: unknown
    }
    return parsed.awmp === '0.1' && parsed.kind === 'Task'
  } catch {
    return false
  }
}

async function loadModeEvalExpectation(
  taskPath: string,
): Promise<AwmpModeEvalExpectation | undefined> {
  const path = expectationPathForTask(taskPath)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as AwmpModeEvalExpectation
    if (parsed.awmp !== '0.1' || parsed.kind !== 'ModeEvalExpectation') {
      throw new Error(`Invalid AWMP mode eval expectation: ${path}`)
    }
    return parsed
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function expectationPathForTask(taskPath: string): string {
  const extension = extname(taskPath)
  return `${taskPath.slice(0, -extension.length)}.eval.json`
}

async function applyArtifactReviewFixtures(input: {
  runDir: string
  expectation: AwmpModeEvalExpectation
  enabled: boolean
}): Promise<AwmpArtifactReviewRecord[]> {
  if (!input.enabled) return []
  const fixtures = input.expectation.artifactReviewFixtures ?? []
  if (fixtures.length === 0) return []

  const artifacts = await loadArtifactIndex(input.runDir)
  const reviews: AwmpArtifactReviewRecord[] = []
  for (const fixture of fixtures) {
    const artifact = artifacts.find(item => item.type === fixture.artifactType)
    if (artifact === undefined) continue
    reviews.push(
      await recordArtifactReview({
        runDir: input.runDir,
        artifactRef: artifact.id,
        status: fixture.status,
        reviewedBy: fixture.reviewedBy ?? 'awmp-mode-eval-fixture',
        note: fixture.note,
        requestedChanges: fixture.requestedChanges,
      }),
    )
  }
  return reviews
}

async function evaluateModeEvalExpectation(input: {
  expectation: AwmpModeEvalExpectation
  expectationPath: string
  inspection: AwmpRunInspectionReport
  runDir: string
  appliedReviewFixtures: AwmpArtifactReviewRecord[]
  applyReviewFixtures: boolean
}): Promise<AwmpModeEvalExpectationResult> {
  const failures: string[] = []
  if (
    input.expectation.expectedTaskState !== undefined &&
    input.inspection.task.state !== input.expectation.expectedTaskState
  ) {
    failures.push(
      `expected task state ${input.expectation.expectedTaskState}, got ${input.inspection.task.state}`,
    )
  }
  if (
    input.expectation.expectedSchedulerStatus !== undefined &&
    input.inspection.scheduler.status !== input.expectation.expectedSchedulerStatus
  ) {
    failures.push(
      `expected scheduler status ${input.expectation.expectedSchedulerStatus}, got ${input.inspection.scheduler.status}`,
    )
  }

  const artifacts = await loadArtifactIndex(input.runDir)
  const artifactTypes = artifacts.map(artifact => artifact.type)
  const requiredArtifactTypes = input.expectation.requiredArtifactTypes ?? []
  const forbiddenArtifactTypes = input.expectation.forbiddenArtifactTypes ?? []
  for (const requiredType of requiredArtifactTypes) {
    if (!artifactTypes.includes(requiredType)) {
      failures.push(`missing required artifact type ${requiredType}`)
    }
  }
  for (const forbiddenType of forbiddenArtifactTypes) {
    if (artifactTypes.includes(forbiddenType)) {
      failures.push(`found forbidden artifact type ${forbiddenType}`)
    }
  }

  const expectedMetrics = input.expectation.expectedMetrics ?? {}
  for (const [metricId, expectedValue] of Object.entries(expectedMetrics)) {
    const actualValue = input.inspection.metrics[metricId]?.value
    if (actualValue !== expectedValue) {
      failures.push(
        `expected metric ${metricId}=${expectedValue}, got ${actualValue ?? 'missing'}`,
      )
    }
  }

  const declaredReviewFixtures = input.expectation.artifactReviewFixtures ?? []
  if (input.applyReviewFixtures) {
    for (const fixture of declaredReviewFixtures) {
      const applied = input.appliedReviewFixtures.some(
        review => review.artifact.type === fixture.artifactType,
      )
      if (!applied) {
        failures.push(
          `review fixture target artifact type not found: ${fixture.artifactType}`,
        )
      }
    }
  }

  return {
    path: input.expectationPath,
    passed: failures.length === 0,
    failures,
    checked: {
      requiredArtifactTypes,
      forbiddenArtifactTypes,
      expectedMetrics: Object.keys(expectedMetrics),
    },
    reviewFixtures: {
      declared: declaredReviewFixtures.length,
      applied: input.appliedReviewFixtures.length,
      skipped: input.applyReviewFixtures
        ? declaredReviewFixtures.length - input.appliedReviewFixtures.length
        : declaredReviewFixtures.length,
      records: input.appliedReviewFixtures.map(review => ({
        id: review.id,
        artifactId: review.artifact.id,
        artifactType: review.artifact.type,
        status: review.status,
        accepted: review.accepted,
      })),
    },
  }
}

function expectationEvidenceGaps(input: {
  expectation?: AwmpModeEvalExpectation
  applyReviewFixtures: boolean
}): string[] {
  if (
    input.expectation === undefined ||
    input.applyReviewFixtures ||
    (input.expectation.artifactReviewFixtures ?? []).length === 0
  ) {
    return []
  }
  return [
    'Mode eval expectation declares artifact review fixtures, but applyReviewFixtures is false.',
  ]
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
