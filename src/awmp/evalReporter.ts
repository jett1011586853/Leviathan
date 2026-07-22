import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { listApprovalRequests } from './approvalStore.js'
import { loadArtifactIndex } from './artifactStore.js'
import {
  listArtifactReviews,
  type AwmpArtifactReviewRecord,
} from './artifactReviewStore.js'
import type {
  AwmpArtifact,
  AwmpSchedulerRecord,
  AwmpTask,
  AwmpTraceEvent,
  AwmpValidationResult,
} from './types.js'

export type AwmpMetricStatus =
  | 'computed'
  | 'missing_evidence'
  | 'not_applicable'

export type AwmpEvidenceMetric = {
  id: string
  label: string
  status: AwmpMetricStatus
  unit: 'ratio' | 'count' | 'boolean'
  value: number | null
  numerator?: number
  denominator?: number
  evidence: string[]
  notes: string[]
}

export type AwmpRunInspectionReport = {
  awmp: '0.1'
  kind: 'RunInspectionReport'
  generatedAt: string
  runDir: string
  reportPath?: string
  task: {
    id: string
    title: string
    state: string
    message?: string
    modeIds: string[]
  }
  scheduler: {
    status: string
    totalSteps: number
    completedSteps: number
    failedSteps: number
    blockedSteps: number
    approvalRequiredSteps: number
    retryableFailedSteps: number
  }
  artifacts: {
    total: number
    runtime: number
    business: number
    byType: Record<string, number>
    validationStatus: Record<string, number>
  }
  validations: {
    total: number
    passed: number
    failed: number
    skipped: number
    blockingFailures: number
    executedTotal: number
    executedPassed: number
    executedFailed: number
  }
  approvals: {
    total: number
    pending: number
    approved: number
    rejected: number
    resolved: number
  }
  reviews: {
    total: number
    reviewedArtifacts: number
    accepted: number
    acceptedWithChanges: number
    rejected: number
    needsRevision: number
  }
  adapters: {
    totalTools: number
    local: number
    openapi: number
    mcp: number
    approvalRequired: number
    denied: number
  }
  trace: {
    events: number
    byEvent: Record<string, number>
  }
  metrics: Record<string, AwmpEvidenceMetric>
  evidenceGaps: string[]
  sourcePaths: string[]
}

export type AwmpEvalReport = {
  awmp: '0.1'
  kind: 'EvalReport'
  generatedAt: string
  runsRoot?: string
  reportPath?: string
  runCount: number
  runs: Array<{
    runDir: string
    taskId: string
    taskState: string
    schedulerStatus: string
    modeIds: string[]
    workCompleted: boolean
  }>
  metrics: Record<string, AwmpEvidenceMetric>
  evidenceGaps: string[]
  sourcePaths: string[]
}

export async function inspectAwmpRun(input: {
  runDir: string
  writeReport?: boolean
}): Promise<AwmpRunInspectionReport> {
  const runDir = resolve(input.runDir)
  const paths = runPaths(runDir)
  const [task, scheduler, artifacts, validations, approvals, toolRegistry, trace] =
    await Promise.all([
      readJsonFile<AwmpTask>(paths.task),
      readJsonFile<AwmpSchedulerRecord>(paths.scheduler),
      loadArtifactIndex(runDir).catch(() => [] as AwmpArtifact[]),
      readJsonFile<AwmpValidationResult[]>(paths.validations).catch(
        () => [] as AwmpValidationResult[],
      ),
      listApprovalRequests(runDir),
      readToolRegistry(paths.toolRegistry),
      readTrace(paths.trace),
    ])
  const reviews = await listArtifactReviews(runDir)

  const reportPath = join(runDir, 'reports', 'run_inspection.json')
  const artifactSummary = summarizeArtifacts(artifacts)
  const validationSummary = summarizeValidations(validations)
  const approvalSummary = summarizeApprovals(approvals.approvals)
  const reviewSummary = summarizeReviews(reviews.reviews)
  const adapterSummary = summarizeAdapters(toolRegistry)
  const schedulerSummary = summarizeScheduler(scheduler)
  const traceSummary = summarizeTrace(trace)
  const metrics = buildRunMetrics({
    task,
    scheduler,
    artifactSummary,
    validationSummary,
    approvalSummary,
    reviewSummary,
    adapterSummary,
    runDir,
    paths,
  })
  const evidenceGaps = collectEvidenceGaps(metrics)
  const report: AwmpRunInspectionReport = {
    awmp: '0.1',
    kind: 'RunInspectionReport',
    generatedAt: new Date().toISOString(),
    runDir,
    reportPath: input.writeReport === false ? undefined : reportPath,
    task: {
      id: task.id,
      title: task.title,
      state: task.status.state,
      message: task.status.message,
      modeIds: task.modeIds,
    },
    scheduler: schedulerSummary,
    artifacts: artifactSummary,
    validations: validationSummary,
    approvals: approvalSummary,
    reviews: reviewSummary,
    adapters: adapterSummary,
    trace: traceSummary,
    metrics,
    evidenceGaps,
    sourcePaths: [
      paths.task,
      paths.scheduler,
      paths.artifactIndex,
      paths.validations,
      paths.toolRegistry,
      paths.trace,
      paths.approvals,
      paths.reviews,
    ],
  }

  if (input.writeReport !== false) {
    await writeJson(reportPath, report)
  }

  return report
}

export async function evaluateAwmpRuns(input: {
  runsRoot?: string
  runDirs?: string[]
  writeReport?: boolean
}): Promise<AwmpEvalReport> {
  const runsRoot = input.runsRoot === undefined ? undefined : resolve(input.runsRoot)
  const runDirs =
    input.runDirs !== undefined
      ? input.runDirs.map(runDir => resolve(runDir))
      : runsRoot === undefined
        ? []
        : await discoverAwmpRunDirs(runsRoot)
  const reports = (
    await Promise.all(
      runDirs.map(async runDir => {
        try {
          return await inspectAwmpRun({ runDir, writeReport: false })
        } catch {
          return undefined
        }
      }),
    )
  ).filter((report): report is AwmpRunInspectionReport => report !== undefined)
  const metrics = buildEvalMetrics(reports)
  const reportPath =
    input.writeReport === false || runsRoot === undefined
      ? undefined
      : join(runsRoot, 'awmp_eval_report.json')
  const report: AwmpEvalReport = {
    awmp: '0.1',
    kind: 'EvalReport',
    generatedAt: new Date().toISOString(),
    runsRoot,
    reportPath,
    runCount: reports.length,
    runs: reports.map(report => ({
      runDir: report.runDir,
      taskId: report.task.id,
      taskState: report.task.state,
      schedulerStatus: report.scheduler.status,
      modeIds: report.task.modeIds,
      workCompleted: report.metrics.workCompletion.value === 1,
    })),
    metrics,
    evidenceGaps: collectEvidenceGaps(metrics),
    sourcePaths: reports.flatMap(report => report.sourcePaths),
  }

  if (reportPath !== undefined) {
    await writeJson(reportPath, report)
  }

  return report
}

export async function discoverAwmpRunDirs(runsRoot: string): Promise<string[]> {
  const root = resolve(runsRoot)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const dir = join(root, entry.name)
        try {
          await stat(join(dir, 'task.json'))
          await stat(join(dir, 'scheduler.json'))
          return dir
        } catch {
          return undefined
        }
      }),
  )
  return dirs
    .filter((dir): dir is string => dir !== undefined)
    .sort((left, right) => basename(left).localeCompare(basename(right)))
}

function buildRunMetrics(input: {
  task: AwmpTask
  scheduler: AwmpSchedulerRecord
  artifactSummary: AwmpRunInspectionReport['artifacts']
  validationSummary: AwmpRunInspectionReport['validations']
  approvalSummary: AwmpRunInspectionReport['approvals']
  reviewSummary: AwmpRunInspectionReport['reviews']
  adapterSummary: AwmpRunInspectionReport['adapters']
  runDir: string
  paths: ReturnType<typeof runPaths>
}): Record<string, AwmpEvidenceMetric> {
  const workCompleted =
    input.task.status.state === 'completed' &&
    input.scheduler.status === 'completed'
  const multiMode = input.task.modeIds.length > 1
  return {
    workCompletion: ratioMetric({
      id: 'workCompletion',
      label: 'Work Completion',
      numerator: workCompleted ? 1 : 0,
      denominator: 1,
      evidence: [input.paths.task, input.paths.scheduler],
      notes: [
        'A run counts as completed only when the Task state and durable Scheduler status are both completed.',
      ],
    }),
    artifactAcceptance: acceptanceMetric(input),
    modeReuse: {
      id: 'modeReuse',
      label: 'Mode Reuse',
      status: 'not_applicable',
      unit: 'ratio',
      value: null,
      evidence: [input.paths.task],
      notes: ['Mode reuse requires an aggregate report across multiple runs.'],
    },
    adapterCoverage: {
      id: 'adapterCoverage',
      label: 'Adapter Coverage',
      status: 'computed',
      unit: 'count',
      value: input.adapterSummary.totalTools,
      numerator: input.adapterSummary.totalTools,
      denominator: undefined,
      evidence: [input.paths.toolRegistry],
      notes: [
        `local=${input.adapterSummary.local}, openapi=${input.adapterSummary.openapi}, mcp=${input.adapterSummary.mcp}`,
      ],
    },
    approvalEfficiency: approvalMetric(input.approvalSummary, input.paths.approvals),
    validationPassRate: validationMetric(
      input.validationSummary,
      input.paths.validations,
    ),
    crossModeTaskSuccess: multiMode
      ? ratioMetric({
          id: 'crossModeTaskSuccess',
          label: 'Cross-Mode Task Success',
          numerator: workCompleted ? 1 : 0,
          denominator: 1,
          evidence: [input.paths.task, input.paths.scheduler],
          notes: [
            'This run has more than one mode; success requires scheduler completion.',
          ],
        })
      : {
          id: 'crossModeTaskSuccess',
          label: 'Cross-Mode Task Success',
          status: 'not_applicable',
          unit: 'ratio',
          value: null,
          evidence: [input.paths.task],
          notes: ['This run uses a single mode.'],
        },
  }
}

function buildEvalMetrics(
  reports: AwmpRunInspectionReport[],
): Record<string, AwmpEvidenceMetric> {
  const workCompleted = reports.filter(
    report => report.metrics.workCompletion.value === 1,
  ).length
  const multiModeReports = reports.filter(report => report.task.modeIds.length > 1)
  const multiModeCompleted = multiModeReports.filter(
    report => report.metrics.crossModeTaskSuccess.value === 1,
  ).length
  const modeCounts = new Map<string, number>()
  for (const report of reports) {
    for (const modeId of report.task.modeIds) {
      modeCounts.set(modeId, (modeCounts.get(modeId) ?? 0) + 1)
    }
  }
  const reusedModes = [...modeCounts.values()].filter(count => count > 1).length
  const validationPassed = sum(reports, report => report.validations.executedPassed)
  const validationFailed = sum(reports, report => report.validations.executedFailed)
  const approvalsTotal = sum(reports, report => report.approvals.total)
  const approvalsResolved = sum(reports, report => report.approvals.resolved)
  const acceptanceEvidence = reports.filter(
    report => report.metrics.artifactAcceptance.status === 'computed',
  )
  const acceptedArtifacts = sumMetricNumerator(acceptanceEvidence, 'artifactAcceptance')
  const acceptanceArtifacts = sumMetricDenominator(
    acceptanceEvidence,
    'artifactAcceptance',
  )
  const adapterTotal = sum(reports, report => report.adapters.totalTools)

  return {
    workCompletionRate: ratioMetric({
      id: 'workCompletionRate',
      label: 'Work Completion Rate',
      numerator: workCompleted,
      denominator: reports.length,
      evidence: reports.flatMap(report => [
        join(report.runDir, 'task.json'),
        join(report.runDir, 'scheduler.json'),
      ]),
      notes: [
        'Counts only runs whose task state and scheduler status are both completed.',
      ],
    }),
    artifactAcceptanceRate:
      acceptanceArtifacts > 0
        ? ratioMetric({
            id: 'artifactAcceptanceRate',
            label: 'Artifact Acceptance Rate',
            numerator: acceptedArtifacts,
            denominator: acceptanceArtifacts,
            evidence: acceptanceEvidence.flatMap(report =>
              report.metrics.artifactAcceptance.evidence,
            ),
            notes: [
              'Computed only from explicit artifact acceptance evidence.',
            ],
          })
        : missingMetric({
            id: 'artifactAcceptanceRate',
            label: 'Artifact Acceptance Rate',
            unit: 'ratio',
            evidence: reports.flatMap(report => report.sourcePaths),
            notes: [
              'No explicit artifact acceptance signal exists in the inspected runs.',
            ],
          }),
    modeReuseRate:
      modeCounts.size > 0 && reports.length > 1
        ? ratioMetric({
            id: 'modeReuseRate',
            label: 'Mode Reuse Rate',
            numerator: reusedModes,
            denominator: modeCounts.size,
            evidence: reports.map(report => join(report.runDir, 'task.json')),
            notes: [
              'A mode counts as reused when it appears in more than one inspected run.',
            ],
          })
        : {
            id: 'modeReuseRate',
            label: 'Mode Reuse Rate',
            status: 'not_applicable',
            unit: 'ratio',
            value: null,
            evidence: reports.map(report => join(report.runDir, 'task.json')),
            notes: ['Mode reuse requires at least two inspectable runs.'],
          },
    adapterCoverage: {
      id: 'adapterCoverage',
      label: 'Adapter Coverage',
      status: 'computed',
      unit: 'count',
      value: adapterTotal,
      numerator: adapterTotal,
      evidence: reports.map(report =>
        join(report.runDir, 'artifacts', 'tool_registry.json'),
      ),
      notes: [
        `local=${sum(reports, report => report.adapters.local)}, openapi=${sum(
          reports,
          report => report.adapters.openapi,
        )}, mcp=${sum(reports, report => report.adapters.mcp)}`,
      ],
    },
    approvalEfficiency:
      approvalsTotal > 0
        ? ratioMetric({
            id: 'approvalEfficiency',
            label: 'Human Approval Efficiency',
            numerator: approvalsResolved,
            denominator: approvalsTotal,
            evidence: reports.map(report =>
              join(report.runDir, 'artifacts', 'approvals'),
            ),
            notes: [
              'Uses approval resolution rate because cycle-time and user effort data are not yet recorded.',
            ],
          })
        : {
            id: 'approvalEfficiency',
            label: 'Human Approval Efficiency',
            status: 'not_applicable',
            unit: 'ratio',
            value: null,
            evidence: reports.map(report =>
              join(report.runDir, 'artifacts', 'approvals'),
            ),
            notes: ['No approval requests were recorded in the inspected runs.'],
          },
    validationPassRate: validationPassed + validationFailed > 0
      ? ratioMetric({
          id: 'validationPassRate',
          label: 'Validation Pass Rate',
          numerator: validationPassed,
          denominator: validationPassed + validationFailed,
          evidence: reports.map(report => join(report.runDir, 'validations.json')),
          notes: ['Skipped validators are excluded from the pass-rate denominator.'],
        })
      : missingMetric({
          id: 'validationPassRate',
          label: 'Validation Pass Rate',
          unit: 'ratio',
          evidence: reports.map(report => join(report.runDir, 'validations.json')),
          notes: [
            'No executed validator results were found; skipped validators are not pass/fail evidence.',
          ],
        }),
    crossModeTaskSuccess:
      multiModeReports.length > 0
        ? ratioMetric({
            id: 'crossModeTaskSuccess',
            label: 'Cross-Mode Task Success',
            numerator: multiModeCompleted,
            denominator: multiModeReports.length,
            evidence: multiModeReports.flatMap(report => [
              join(report.runDir, 'task.json'),
              join(report.runDir, 'scheduler.json'),
            ]),
            notes: [
              'Counts multi-mode runs whose task state and scheduler status are both completed.',
            ],
          })
        : {
            id: 'crossModeTaskSuccess',
            label: 'Cross-Mode Task Success',
            status: 'not_applicable',
            unit: 'ratio',
            value: null,
            evidence: reports.map(report => join(report.runDir, 'task.json')),
            notes: ['No inspected run used more than one mode.'],
          },
  }
}

function summarizeScheduler(
  scheduler: AwmpSchedulerRecord,
): AwmpRunInspectionReport['scheduler'] {
  return {
    status: scheduler.status,
    totalSteps: scheduler.steps.length,
    completedSteps: scheduler.steps.filter(step => step.state === 'completed')
      .length,
    failedSteps: scheduler.steps.filter(step => step.state === 'failed').length,
    blockedSteps: scheduler.steps.filter(step => step.state === 'blocked').length,
    approvalRequiredSteps: scheduler.steps.filter(
      step => step.state === 'approval_required',
    ).length,
    retryableFailedSteps: scheduler.steps.filter(
      step => step.state === 'failed' && step.retryable === true,
    ).length,
  }
}

function summarizeArtifacts(
  artifacts: AwmpArtifact[],
): AwmpRunInspectionReport['artifacts'] {
  return {
    total: artifacts.length,
    runtime: artifacts.filter(isRuntimeArtifact).length,
    business: artifacts.filter(artifact => !isRuntimeArtifact(artifact)).length,
    byType: countBy(artifacts, artifact => artifact.type),
    validationStatus: countBy(
      artifacts,
      artifact => artifact.validation?.status ?? 'unknown',
    ),
  }
}

function summarizeValidations(
  validations: AwmpValidationResult[],
): AwmpRunInspectionReport['validations'] {
  const executed = validations.filter(validation => validation.status !== 'skipped')
  return {
    total: validations.length,
    passed: validations.filter(validation => validation.status === 'passed').length,
    failed: validations.filter(validation => validation.status === 'failed').length,
    skipped: validations.filter(validation => validation.status === 'skipped')
      .length,
    blockingFailures: validations.filter(
      validation =>
        validation.status === 'failed' && validation.severity === 'blocking',
    ).length,
    executedTotal: executed.length,
    executedPassed: executed.filter(validation => validation.status === 'passed')
      .length,
    executedFailed: executed.filter(validation => validation.status === 'failed')
      .length,
  }
}

function summarizeApprovals(
  approvals: Array<{ status: string }>,
): AwmpRunInspectionReport['approvals'] {
  const approved = approvals.filter(approval => approval.status === 'approved')
    .length
  const rejected = approvals.filter(approval => approval.status === 'rejected')
    .length
  return {
    total: approvals.length,
    pending: approvals.filter(approval => approval.status === 'pending').length,
    approved,
    rejected,
    resolved: approved + rejected,
  }
}

function summarizeReviews(
  reviews: AwmpArtifactReviewRecord[],
): AwmpRunInspectionReport['reviews'] {
  const latest = latestReviewsByArtifact(reviews)
  return {
    total: reviews.length,
    reviewedArtifacts: latest.length,
    accepted: latest.filter(review => review.status === 'accepted').length,
    acceptedWithChanges: latest.filter(
      review => review.status === 'accepted_with_changes',
    ).length,
    rejected: latest.filter(review => review.status === 'rejected').length,
    needsRevision: latest.filter(review => review.status === 'needs_revision')
      .length,
  }
}

function summarizeAdapters(
  toolRegistry: ToolRegistrySnapshot | undefined,
): AwmpRunInspectionReport['adapters'] {
  const entries = toolRegistry?.entries ?? []
  return {
    totalTools: entries.length,
    local: entries.filter(entry => entry.kind === 'local').length,
    openapi: entries.filter(entry => entry.kind === 'openapi').length,
    mcp: entries.filter(entry => entry.kind === 'mcp').length,
    approvalRequired: entries.filter(
      entry => entry.policy?.decision === 'approval_required',
    ).length,
    denied: entries.filter(entry => entry.policy?.decision === 'denied').length,
  }
}

function summarizeTrace(
  events: AwmpTraceEvent[],
): AwmpRunInspectionReport['trace'] {
  return {
    events: events.length,
    byEvent: countBy(events, event => event.event),
  }
}

function validationMetric(
  summary: AwmpRunInspectionReport['validations'],
  evidencePath: string,
): AwmpEvidenceMetric {
  const denominator = summary.executedPassed + summary.executedFailed
  if (denominator === 0) {
    return missingMetric({
      id: 'validationPassRate',
      label: 'Validation Pass Rate',
      unit: 'ratio',
      evidence: [evidencePath],
      notes: [
        'No executed validator results were found. Skipped validators are not pass/fail evidence.',
      ],
    })
  }
  return ratioMetric({
    id: 'validationPassRate',
    label: 'Validation Pass Rate',
    numerator: summary.executedPassed,
    denominator,
    evidence: [evidencePath],
    notes: ['Skipped validators are excluded from the pass-rate denominator.'],
  })
}

function approvalMetric(
  summary: AwmpRunInspectionReport['approvals'],
  evidencePath: string,
): AwmpEvidenceMetric {
  if (summary.total === 0) {
    return {
      id: 'approvalEfficiency',
      label: 'Human Approval Efficiency',
      status: 'not_applicable',
      unit: 'ratio',
      value: null,
      evidence: [evidencePath],
      notes: ['No approval requests were recorded for this run.'],
    }
  }
  return ratioMetric({
    id: 'approvalEfficiency',
    label: 'Human Approval Efficiency',
    numerator: summary.resolved,
    denominator: summary.total,
    evidence: [evidencePath],
    notes: [
      'Uses approval resolution rate because cycle-time and user effort data are not yet recorded.',
    ],
  })
}

function acceptanceMetric(input: {
  artifactSummary: AwmpRunInspectionReport['artifacts']
  reviewSummary: AwmpRunInspectionReport['reviews']
  paths: ReturnType<typeof runPaths>
}): AwmpEvidenceMetric {
  if (input.reviewSummary.reviewedArtifacts > 0) {
    return ratioMetric({
      id: 'artifactAcceptance',
      label: 'Artifact Acceptance Rate',
      numerator:
        input.reviewSummary.accepted + input.reviewSummary.acceptedWithChanges,
      denominator: input.reviewSummary.reviewedArtifacts,
      evidence: [input.paths.reviews],
      notes: [
        'Computed from the latest explicit artifact review per reviewed artifact.',
        'accepted_with_changes counts as accepted because the artifact was accepted after minor edits.',
      ],
    })
  }

  return missingMetric({
    id: 'artifactAcceptance',
    label: 'Artifact Acceptance Rate',
    unit: 'ratio',
    evidence: [input.paths.artifactIndex],
    notes: [
      'The current AWMP run records artifacts and validation status, but no explicit user acceptance artifact or review decision.',
      `Business artifact count: ${input.artifactSummary.business}.`,
    ],
  })
}

function ratioMetric(input: {
  id: string
  label: string
  numerator: number
  denominator: number
  evidence: string[]
  notes: string[]
}): AwmpEvidenceMetric {
  return {
    id: input.id,
    label: input.label,
    status: input.denominator > 0 ? 'computed' : 'missing_evidence',
    unit: 'ratio',
    value: input.denominator > 0 ? input.numerator / input.denominator : null,
    numerator: input.numerator,
    denominator: input.denominator,
    evidence: unique(input.evidence),
    notes: input.notes,
  }
}

function missingMetric(input: {
  id: string
  label: string
  unit: AwmpEvidenceMetric['unit']
  evidence: string[]
  notes: string[]
}): AwmpEvidenceMetric {
  return {
    id: input.id,
    label: input.label,
    status: 'missing_evidence',
    unit: input.unit,
    value: null,
    evidence: unique(input.evidence),
    notes: input.notes,
  }
}

function collectEvidenceGaps(
  metrics: Record<string, AwmpEvidenceMetric>,
): string[] {
  return Object.values(metrics)
    .filter(metric => metric.status === 'missing_evidence')
    .map(metric => `${metric.label}: ${metric.notes.join(' ')}`)
}

function sum(
  reports: AwmpRunInspectionReport[],
  selector: (report: AwmpRunInspectionReport) => number,
): number {
  return reports.reduce((total, report) => total + selector(report), 0)
}

function sumMetricNumerator(
  reports: AwmpRunInspectionReport[],
  metricId: string,
): number {
  return reports.reduce(
    (total, report) => total + (report.metrics[metricId]?.numerator ?? 0),
    0,
  )
}

function sumMetricDenominator(
  reports: AwmpRunInspectionReport[],
  metricId: string,
): number {
  return reports.reduce(
    (total, report) => total + (report.metrics[metricId]?.denominator ?? 0),
    0,
  )
}

function isRuntimeArtifact(artifact: AwmpArtifact): boolean {
  return artifact.type.startsWith('awmp.') || artifact.metadata?.runtimeArtifact === true
}

function latestReviewsByArtifact(
  reviews: AwmpArtifactReviewRecord[],
): AwmpArtifactReviewRecord[] {
  const byArtifact = new Map<string, AwmpArtifactReviewRecord>()
  for (const review of reviews) {
    const existing = byArtifact.get(review.artifact.id)
    if (existing === undefined || existing.reviewedAt <= review.reviewedAt) {
      byArtifact.set(review.artifact.id, review)
    }
  }
  return [...byArtifact.values()]
}

function countBy<T>(
  items: T[],
  key: (item: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const value = key(item)
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function runPaths(runDir: string) {
  return {
    task: join(runDir, 'task.json'),
    scheduler: join(runDir, 'scheduler.json'),
    artifactIndex: join(runDir, 'artifacts', 'index.json'),
    validations: join(runDir, 'validations.json'),
    toolRegistry: join(runDir, 'artifacts', 'tool_registry.json'),
    trace: join(runDir, 'trace.jsonl'),
    approvals: join(runDir, 'artifacts', 'approvals'),
    reviews: join(runDir, 'artifacts', 'reviews'),
  }
}

async function readTrace(tracePath: string): Promise<AwmpTraceEvent[]> {
  const raw = await readFile(tracePath, 'utf8').catch(() => '')
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line) as AwmpTraceEvent]
      } catch {
        return []
      }
    })
}

type ToolRegistrySnapshot = {
  entries?: Array<{
    kind?: string
    policy?: {
      decision?: string
    }
  }>
}

async function readToolRegistry(
  path: string,
): Promise<ToolRegistrySnapshot | undefined> {
  return readJsonFile<ToolRegistrySnapshot>(path).catch(() => undefined)
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
