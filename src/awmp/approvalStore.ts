import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { sanitizePathSegment } from './paths.js'
import { appendTraceEvent, createTraceEvent } from './trace.js'
import type { AwmpToolRegistryEntry } from './toolBroker.js'
import type { AwmpTask } from './types.js'

export type AwmpApprovalStatus = 'pending' | 'approved' | 'rejected'

export type AwmpApprovalRequest = {
  awmp: '0.1'
  kind: 'ApprovalRequest'
  id: string
  runDir: string
  taskId: string
  traceId?: string
  status: AwmpApprovalStatus
  requestedAt: string
  decidedAt?: string
  decidedBy?: string
  note?: string
  tool: {
    id: string
    name: string
    kind: string
    modeId: string
    policy: AwmpToolRegistryEntry['policy']
  }
  input?: unknown
  inputFingerprint: string
  reason: string
  requestPath: string
}

export type AwmpApprovalList = {
  awmp: '0.1'
  kind: 'ApprovalIndex'
  generatedAt: string
  runDir: string
  approvals: AwmpApprovalRequest[]
}

export type AwmpApprovalDecisionResult =
  | {
      usable: true
      request: AwmpApprovalRequest
    }
  | {
      usable: false
      reason: string
      request?: AwmpApprovalRequest
    }

export async function ensureApprovalRequest(input: {
  runDir: string
  task: AwmpTask
  tool: AwmpToolRegistryEntry
  requestInput?: unknown
  reason: string
}): Promise<{ request: AwmpApprovalRequest; created: boolean }> {
  const runDir = resolve(input.runDir)
  const inputFingerprint = fingerprintValue(input.requestInput)
  const existing = (await listApprovalRequests(runDir)).approvals.find(
    approval =>
      approval.status === 'pending' &&
      approval.tool.id === input.tool.id &&
      approval.inputFingerprint === inputFingerprint,
  )

  if (existing !== undefined) {
    return { request: existing, created: false }
  }

  const id = `approval_${randomUUID()}`
  const requestPath = approvalPath(runDir, id)
  const request: AwmpApprovalRequest = {
    awmp: '0.1',
    kind: 'ApprovalRequest',
    id,
    runDir,
    taskId: input.task.id,
    traceId: input.task.traceId,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    tool: {
      id: input.tool.id,
      name: input.tool.name,
      kind: input.tool.kind,
      modeId: input.tool.modeId,
      policy: input.tool.policy,
    },
    input: input.requestInput,
    inputFingerprint,
    reason: input.reason,
    requestPath,
  }

  await writeApprovalRequest(request)
  await writeApprovalIndex(runDir)
  await appendApprovalTrace(runDir, request, 'approval.requested')
  return { request, created: true }
}

export async function listApprovalRequests(
  runDir: string,
): Promise<AwmpApprovalList> {
  const resolvedRunDir = resolve(runDir)
  const dir = approvalsDir(resolvedRunDir)
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    return {
      awmp: '0.1',
      kind: 'ApprovalIndex',
      generatedAt: new Date().toISOString(),
      runDir: resolvedRunDir,
      approvals: [],
    }
  }

  const approvals = (
    await Promise.all(
      files
        .filter(file => file.endsWith('.json') && file !== 'index.json')
        .map(async file => {
          try {
            return parseApproval(await readFile(join(dir, file), 'utf8'))
          } catch {
            return undefined
          }
        }),
    )
  )
    .filter((approval): approval is AwmpApprovalRequest => approval !== undefined)
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))

  return {
    awmp: '0.1',
    kind: 'ApprovalIndex',
    generatedAt: new Date().toISOString(),
    runDir: resolvedRunDir,
    approvals,
  }
}

export async function getApprovalRequest(input: {
  runDir: string
  approvalId: string
}): Promise<AwmpApprovalRequest> {
  const raw = await readFile(approvalPath(resolve(input.runDir), input.approvalId), 'utf8')
  return parseApproval(raw)
}

export async function decideApprovalRequest(input: {
  runDir: string
  approvalId: string
  decision: Extract<AwmpApprovalStatus, 'approved' | 'rejected'>
  decidedBy?: string
  note?: string
}): Promise<AwmpApprovalRequest> {
  const runDir = resolve(input.runDir)
  const current = await getApprovalRequest({
    runDir,
    approvalId: input.approvalId,
  })
  if (current.status !== 'pending') {
    throw new Error(
      `Approval ${input.approvalId} has already been ${current.status}.`,
    )
  }

  const updated: AwmpApprovalRequest = {
    ...current,
    status: input.decision,
    decidedAt: new Date().toISOString(),
    decidedBy: input.decidedBy ?? 'local-user',
    note: input.note,
  }
  await writeApprovalRequest(updated)
  await writeApprovalIndex(runDir)
  await appendApprovalTrace(runDir, updated, `approval.${input.decision}`)
  return updated
}

export async function findUsableApproval(input: {
  runDir: string
  approvalId?: string
  tool: AwmpToolRegistryEntry
  requestInput?: unknown
}): Promise<AwmpApprovalDecisionResult> {
  const runDir = resolve(input.runDir)
  const inputFingerprint = fingerprintValue(input.requestInput)

  if (input.approvalId !== undefined) {
    const request = await getApprovalRequest({
      runDir,
      approvalId: input.approvalId,
    })
    const mismatch = approvalMismatchReason({
      request,
      tool: input.tool,
      inputFingerprint,
    })
    if (mismatch !== undefined) {
      return { usable: false, request, reason: mismatch }
    }
    if (request.status !== 'approved') {
      return {
        usable: false,
        request,
        reason: `Approval ${request.id} is ${request.status}.`,
      }
    }
    return { usable: true, request }
  }

  const approvals = (await listApprovalRequests(runDir)).approvals
  const approved = approvals.find(request => {
    return (
      request.status === 'approved' &&
      approvalMismatchReason({
        request,
        tool: input.tool,
        inputFingerprint,
      }) === undefined
    )
  })
  if (approved !== undefined) {
    return { usable: true, request: approved }
  }

  return {
    usable: false,
    reason: 'No approved matching approval request was found.',
  }
}

export function formatApprovalList(list: AwmpApprovalList): string {
  if (list.approvals.length === 0) {
    return [`AWMP approvals`, `Run: ${list.runDir}`, '', 'No approvals.'].join(
      '\n',
    )
  }

  return [
    'AWMP approvals',
    `Run: ${list.runDir}`,
    '',
    ...list.approvals.map(approval =>
      [
        `- ${approval.id} ${approval.status}`,
        `  tool: ${approval.tool.name} (${approval.tool.id})`,
        `  reason: ${approval.reason}`,
        `  requested: ${approval.requestedAt}`,
        approval.decidedAt === undefined
          ? undefined
          : `  decided: ${approval.decidedAt} by ${approval.decidedBy ?? 'unknown'}`,
        `  path: ${approval.requestPath}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
}

function approvalMismatchReason(input: {
  request: AwmpApprovalRequest
  tool: AwmpToolRegistryEntry
  inputFingerprint: string
}): string | undefined {
  if (input.request.tool.id !== input.tool.id) {
    return `Approval ${input.request.id} is for ${input.request.tool.id}, not ${input.tool.id}.`
  }
  if (input.request.inputFingerprint !== input.inputFingerprint) {
    return `Approval ${input.request.id} input fingerprint does not match this tool call.`
  }
  return undefined
}

async function writeApprovalRequest(
  request: AwmpApprovalRequest,
): Promise<void> {
  await mkdir(approvalsDir(request.runDir), { recursive: true })
  await writeFile(request.requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8')
}

async function writeApprovalIndex(runDir: string): Promise<void> {
  const index = await listApprovalRequests(runDir)
  await mkdir(approvalsDir(runDir), { recursive: true })
  await writeFile(indexPath(runDir), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

async function appendApprovalTrace(
  runDir: string,
  request: AwmpApprovalRequest,
  event: string,
): Promise<void> {
  await appendTraceEvent(
    join(runDir, 'trace.jsonl'),
    createTraceEvent({
      traceId: request.traceId ?? `trace_${request.taskId}`,
      taskId: request.taskId,
      modeId: request.tool.modeId,
      event,
      riskLevel: 'approval',
      data: {
        approvalId: request.id,
        approvalStatus: request.status,
        toolId: request.tool.id,
        toolName: request.tool.name,
        requestPath: request.requestPath,
      },
    }),
  )
}

function approvalsDir(runDir: string): string {
  return join(runDir, 'artifacts', 'approvals')
}

function indexPath(runDir: string): string {
  return join(approvalsDir(runDir), 'index.json')
}

function approvalPath(runDir: string, approvalId: string): string {
  return join(approvalsDir(runDir), `${sanitizePathSegment(approvalId)}.json`)
}

function parseApproval(raw: string): AwmpApprovalRequest {
  const parsed = JSON.parse(raw) as AwmpApprovalRequest
  if (parsed.kind !== 'ApprovalRequest' || typeof parsed.id !== 'string') {
    throw new Error('Invalid AWMP approval request.')
  }
  return parsed
}

function fingerprintValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value))
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableNormalize(child)]),
    )
  }
  return value
}
