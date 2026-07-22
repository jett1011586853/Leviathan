import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { isAbsolute, join, normalize, relative, resolve } from 'path'
import {
  ensureApprovalRequest,
  findUsableApproval,
} from './approvalStore.js'
import { getAwmpMcpAdapter } from './mcpAdapterRegistry.js'
import { sanitizePathSegment } from './paths.js'
import { appendTraceEvent, createTraceEvent } from './trace.js'
import type {
  AwmpExecutionCapsule,
  AwmpModePackage,
  AwmpTask,
} from './types.js'

export type AwmpToolKind = 'mcp' | 'openapi' | 'local'

export type AwmpToolPolicyDecision =
  | 'available'
  | 'approval_required'
  | 'denied'

export type AwmpToolRegistryEntry = {
  id: string
  modeId: string
  kind: AwmpToolKind
  name: string
  target: Record<string, string>
  policy: {
    decision: AwmpToolPolicyDecision
    matchedPermission?: string
    reason: string
  }
}

export type AwmpToolCallStatus =
  | 'completed'
  | 'failed'
  | 'denied'
  | 'approval_required'
  | 'deferred'

export type AwmpToolCallResult = {
  awmp: '0.1'
  kind: 'ToolCallResult'
  id: string
  status: AwmpToolCallStatus
  runDir: string
  tool: AwmpToolRegistryEntry
  message: string
  approved: boolean
  startedAt: string
  completedAt: string
  durationMs: number
  input?: unknown
  exitCode?: number
  httpStatus?: number
  stdout?: string
  stderr?: string
  approvalRequestId?: string
  resultPath: string
}

export type AwmpToolRegistry = {
  awmp: '0.1'
  kind: 'ToolBrokerRegistry'
  generatedAt: string
  ambientAuthority: false
  invocation: 'policy_checked'
  entries: AwmpToolRegistryEntry[]
  summary: {
    modes: number
    total: number
    mcp: number
    openapi: number
    local: number
    approvalRequired: number
    denied: number
  }
}

export function buildToolRegistry(
  modePackages: AwmpModePackage[],
  options: { runDir?: string } = {},
): AwmpToolRegistry {
  const entries = modePackages.flatMap(modePackage =>
    collectModeTools(modePackage, options),
  )

  return {
    awmp: '0.1',
    kind: 'ToolBrokerRegistry',
    generatedAt: new Date().toISOString(),
    ambientAuthority: false,
    invocation: 'policy_checked',
    entries,
    summary: {
      modes: modePackages.length,
      total: entries.length,
      mcp: entries.filter(entry => entry.kind === 'mcp').length,
      openapi: entries.filter(entry => entry.kind === 'openapi').length,
      local: entries.filter(entry => entry.kind === 'local').length,
      approvalRequired: entries.filter(
        entry => entry.policy.decision === 'approval_required',
      ).length,
      denied: entries.filter(entry => entry.policy.decision === 'denied').length,
    },
  }
}

function collectModeTools(
  modePackage: AwmpModePackage,
  options: { runDir?: string },
): AwmpToolRegistryEntry[] {
  const entries: AwmpToolRegistryEntry[] = []
  const modeId = modePackage.mode.id

  for (const declaration of asArray(modePackage.mode.tools?.mcp)) {
    const record = asRecord(declaration)
    const server = stringValue(record.server) ?? 'unknown'
    const allow = stringArray(record.allow)
    const toolNames = allow.length > 0 ? allow : ['*']

    for (const toolName of toolNames) {
      const name = `${server}.${toolName}`
      entries.push(
        createToolEntry(modePackage, {
          kind: 'mcp',
          name,
          target: {
            server,
            tool: toolName,
            ...mountedModeRootTarget(modePackage, options),
          },
          permissionCandidates: [
            name,
            `${server}:${toolName}`,
            toolName,
            `mcp:${server}:${toolName}`,
          ],
        }),
      )
    }
  }

  for (const declaration of asArray(modePackage.mode.tools?.openapi)) {
    const record = asRecord(declaration)
    const operation =
      stringValue(record.operationId) ??
      stringValue(record.name) ??
      [stringValue(record.method), stringValue(record.path)]
        .filter(Boolean)
        .join(' ') ??
      'operation'
    const name = operation || 'operation'

    entries.push(
      createToolEntry(modePackage, {
        kind: 'openapi',
        name,
        target: compactRecord({
          operation,
          url: stringValue(record.url),
          baseUrl: stringValue(record.baseUrl),
          method: stringValue(record.method),
          path: stringValue(record.path),
          ...mountedModeRootTarget(modePackage, options),
        }),
        permissionCandidates: [name, `openapi:${name}`],
      }),
    )
  }

  for (const declaration of asArray(modePackage.mode.tools?.local)) {
    const record = asRecord(declaration)
    const name = stringValue(record.name) ?? stringValue(record.command) ?? 'local'
    entries.push(
      createToolEntry(modePackage, {
        kind: 'local',
        name,
        target: compactRecord({
          command: stringValue(record.command),
          ...mountedModeRootTarget(modePackage, options),
        }),
        permissionCandidates: [name, `local:${name}`],
      }),
    )
  }

  return entries
}

export async function callRegisteredTool(options: {
  runDir: string
  toolId?: string
  toolName?: string
  input?: unknown
  approved?: boolean
  approvalId?: string
  timeoutMs?: number
}): Promise<AwmpToolCallResult> {
  const runDir = resolve(options.runDir)
  const registry = await loadToolRegistry(runDir)
  const task = await loadRunTask(runDir)
  const capsule = await loadRunCapsule(runDir)
  const tool = resolveToolReference(registry, {
    toolId: options.toolId,
    toolName: options.toolName,
  })
  const startedAt = new Date().toISOString()
  const started = Date.now()
  let approved = options.approved === true
  let approvalRequestId: string | undefined

  if (tool.policy.decision === 'denied') {
    return finishToolCall({
      runDir,
      task,
      tool,
      input: options.input,
      approved,
      started,
      startedAt,
      status: 'denied',
      message: tool.policy.reason,
    })
  }

  if (tool.policy.decision === 'approval_required' && !approved) {
    const usableApproval = await findUsableApproval({
      runDir,
      approvalId: options.approvalId,
      tool,
      requestInput: options.input,
    })
    if (usableApproval.usable) {
      approved = true
      approvalRequestId = usableApproval.request.id
    } else if (options.approvalId !== undefined) {
      return finishToolCall({
        runDir,
        task,
        tool,
        input: options.input,
        approved,
        approvalRequestId: usableApproval.request?.id ?? options.approvalId,
        started,
        startedAt,
        status: 'denied',
        message: usableApproval.reason,
      })
    }
  }

  if (tool.policy.decision === 'approval_required' && !approved) {
    const approval = await ensureApprovalRequest({
      runDir,
      task,
      tool,
      requestInput: options.input,
      reason: tool.policy.reason,
    })
    return finishToolCall({
      runDir,
      task,
      tool,
      input: options.input,
      approved,
      approvalRequestId: approval.request.id,
      started,
      startedAt,
      status: 'approval_required',
      message:
        `Tool policy requires human approval. Approval request ${approval.request.id} is ${approval.created ? 'created' : 'already pending'}.`,
    })
  }

  if (tool.kind === 'mcp') {
    const execution = await executeMcpTool({
      runDir,
      tool,
      input: options.input,
      timeoutMs: options.timeoutMs,
    })
    return finishToolCall({
      runDir,
      task,
      tool,
      input: options.input,
      approved,
      approvalRequestId,
      started,
      startedAt,
      status: execution.status,
      message: execution.message,
      stdout: execution.stdout,
      stderr: execution.stderr,
    })
  }

  if (tool.kind === 'openapi') {
    const execution = await executeOpenApiTool({
      capsule,
      tool,
      input: options.input,
      timeoutMs: options.timeoutMs,
    })
    return finishToolCall({
      runDir,
      task,
      tool,
      input: options.input,
      approved,
      approvalRequestId,
      started,
      startedAt,
      status: execution.status,
      message: execution.message,
      httpStatus: execution.httpStatus,
      stdout: execution.stdout,
      stderr: execution.stderr,
    })
  }

  const command = parseLocalToolCommand(tool)
  if (command === null) {
    return finishToolCall({
      runDir,
      task,
      tool,
      input: options.input,
      approved,
      approvalRequestId,
      started,
      startedAt,
      status: 'failed',
      message:
        'Local tool command must be one of: python <relative.py>, python3 <relative.py>, bun <relative.ts|js>, node <relative.js>, and the script must stay inside the mounted mode package.',
    })
  }

  const execution = await executeLocalTool({
    command,
    runDir,
    tool,
    input: options.input,
    timeoutMs: options.timeoutMs,
  })

  return finishToolCall({
    runDir,
    task,
    tool,
    input: options.input,
    approved,
    approvalRequestId,
    started,
    startedAt,
    status: execution.exitCode === 0 ? 'completed' : 'failed',
    message:
      execution.message ??
      (execution.exitCode === 0
        ? 'Local tool completed.'
        : `Local tool failed with exit code ${execution.exitCode}.`),
    exitCode: execution.exitCode,
    stdout: execution.stdout,
    stderr: execution.stderr,
  })
}

function createToolEntry(
  modePackage: AwmpModePackage,
  input: {
    kind: AwmpToolKind
    name: string
    target: Record<string, string>
    permissionCandidates: string[]
  },
): AwmpToolRegistryEntry {
  return {
    id: [
      sanitizePathSegment(modePackage.mode.id),
      input.kind,
      sanitizePathSegment(input.name),
    ].join(':'),
    modeId: modePackage.mode.id,
    kind: input.kind,
    name: input.name,
    target: input.target,
    policy: resolveToolPolicy(modePackage, input.permissionCandidates),
  }
}

function resolveToolPolicy(
  modePackage: AwmpModePackage,
  permissionCandidates: string[],
): AwmpToolRegistryEntry['policy'] {
  const denied = modePackage.mode.permissions?.denied ?? []
  const requiresApproval = modePackage.mode.permissions?.requiresApproval ?? []
  const deniedMatch = firstIntersection(permissionCandidates, denied)
  if (deniedMatch !== undefined) {
    return {
      decision: 'denied',
      matchedPermission: deniedMatch,
      reason: 'Matched mode.permissions.denied.',
    }
  }

  const approvalMatch = firstIntersection(permissionCandidates, requiresApproval)
  if (approvalMatch !== undefined) {
    return {
      decision: 'approval_required',
      matchedPermission: approvalMatch,
      reason: 'Matched mode.permissions.requiresApproval.',
    }
  }

  return {
    decision: 'available',
    reason:
      'Declared by the selected mode. Actual invocation still requires the AWMP policy engine/tool broker phase.',
  }
}

type ParsedLocalToolCommand = {
  executable: string
  scriptPath: string
  args: string[]
}

function parseLocalToolCommand(
  tool: AwmpToolRegistryEntry,
): ParsedLocalToolCommand | null {
  const command = tool.target.command
  const modeRoot = tool.target.modeRoot
  if (command === undefined || modeRoot === undefined) return null

  const parts = tokenize(command)
  if (parts.length < 2) return null

  const runtime = parts[0]
  if (!isAllowedRuntime(runtime)) return null

  const script = parts[1]!
  if (isAbsolute(script)) return null

  const scriptPath = normalize(join(modeRoot, script))
  if (!isInside(modeRoot, scriptPath)) return null

  return {
    executable: runtime === 'bun' ? process.execPath : runtime,
    scriptPath,
    args: parts.slice(2),
  }
}

async function executeLocalTool(input: {
  command: ParsedLocalToolCommand
  runDir: string
  tool: AwmpToolRegistryEntry
  input?: unknown
  timeoutMs?: number
}): Promise<{
  exitCode: number
  stdout?: string
  stderr?: string
  message?: string
}> {
  const timeoutMs = input.timeoutMs ?? 10_000
  const proc = Bun.spawn(
    [input.command.executable, input.command.scriptPath, ...input.command.args],
    {
      cwd: input.tool.target.modeRoot ?? input.runDir,
      env: {
        PATH: process.env.PATH ?? '',
        AWMP_RUN_DIR: input.runDir,
        AWMP_WORKSPACE_DIR: join(input.runDir, 'workspace'),
        AWMP_ARTIFACTS_DIR: join(input.runDir, 'artifacts'),
        AWMP_TOOL_ID: input.tool.id,
        AWMP_TOOL_NAME: input.tool.name,
        AWMP_MODE_ID: input.tool.modeId,
        AWMP_TOOL_INPUT_JSON:
          input.input === undefined ? '' : JSON.stringify(input.input),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => clearTimeout(timeout))

  return {
    exitCode,
    stdout: truncate(stdout),
    stderr: truncate(stderr),
    message: timedOut ? `Local tool timed out after ${timeoutMs}ms.` : undefined,
  }
}

async function executeOpenApiTool(input: {
  capsule: AwmpExecutionCapsule
  tool: AwmpToolRegistryEntry
  input?: unknown
  timeoutMs?: number
}): Promise<{
  status: AwmpToolCallStatus
  message: string
  httpStatus?: number
  stdout?: string
  stderr?: string
}> {
  const request = buildOpenApiRequest(input.tool, input.input)
  if (request === null) {
    return {
      status: 'failed',
      message:
        'OpenAPI tool target must declare url or baseUrl/path, with method defaulting to GET.',
    }
  }

  const networkDecision = isNetworkAllowed(input.capsule, request.url)
  if (!networkDecision.allowed) {
    return {
      status: 'denied',
      message: networkDecision.reason,
    }
  }

  const timeoutMs = input.timeoutMs ?? 10_000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    const body = await response.text()
    return {
      status: response.ok ? 'completed' : 'failed',
      message: response.ok
        ? `OpenAPI tool completed with HTTP ${response.status}.`
        : `OpenAPI tool failed with HTTP ${response.status}.`,
      httpStatus: response.status,
      stdout: truncate(body),
    }
  } catch (error) {
    return {
      status: 'failed',
      message:
        error instanceof Error && error.name === 'AbortError'
          ? `OpenAPI tool timed out after ${timeoutMs}ms.`
          : `OpenAPI tool failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function executeMcpTool(input: {
  runDir: string
  tool: AwmpToolRegistryEntry
  input?: unknown
  timeoutMs?: number
}): Promise<{
  status: AwmpToolCallStatus
  message: string
  stdout?: string
  stderr?: string
}> {
  const server = input.tool.target.server
  const mcpTool = input.tool.target.tool
  if (server === undefined || mcpTool === undefined || mcpTool === '*') {
    return {
      status: 'deferred',
      message:
        'This MCP tool declaration is not specific enough for direct execution. Declare an explicit server/tool pair in mode.yaml.',
    }
  }

  const handler = getAwmpMcpAdapter({ server, tool: mcpTool })
  if (handler === undefined) {
    return {
      status: 'deferred',
      message:
        'This tool is registered, but its external adapter is not connected in the local AWMP v0.1 runtime.',
    }
  }

  const timeoutMs = input.timeoutMs ?? 30_000
  try {
    const result = await withTimeout(
      Promise.resolve(
        handler({
          runDir: input.runDir,
          modeId: input.tool.modeId,
          toolId: input.tool.id,
          toolName: input.tool.name,
          server,
          tool: mcpTool,
          input: input.input,
          timeoutMs,
        }),
      ),
      timeoutMs,
    )
    const stdout =
      result.stdout ??
      (result.data === undefined ? undefined : JSON.stringify(result.data))
    const status = result.status ?? 'completed'
    return {
      status,
      message:
        result.message ??
        (status === 'completed'
          ? 'MCP adapter completed.'
          : 'MCP adapter failed.'),
      stdout: truncate(stdout ?? ''),
      stderr: truncate(result.stderr ?? ''),
    }
  } catch (error) {
    return {
      status: 'failed',
      message:
        error instanceof Error
          ? `MCP adapter failed: ${error.message}`
          : `MCP adapter failed: ${String(error)}`,
    }
  }
}

async function finishToolCall(input: {
  runDir: string
  task: AwmpTask
  tool: AwmpToolRegistryEntry
  input?: unknown
  approved: boolean
  approvalRequestId?: string
  started: number
  startedAt: string
  status: AwmpToolCallStatus
  message: string
  exitCode?: number
  httpStatus?: number
  stdout?: string
  stderr?: string
}): Promise<AwmpToolCallResult> {
  const completedAt = new Date().toISOString()
  const resultPath = join(
    input.runDir,
    'artifacts',
    'tool_calls',
    `${sanitizePathSegment(input.tool.id)}_${randomUUID()}.json`,
  )
  const result: AwmpToolCallResult = {
    awmp: '0.1',
    kind: 'ToolCallResult',
    id: `toolcall_${randomUUID()}`,
    status: input.status,
    runDir: input.runDir,
    tool: input.tool,
    message: input.message,
    approved: input.approved,
    approvalRequestId: input.approvalRequestId,
    startedAt: input.startedAt,
    completedAt,
    durationMs: Date.now() - input.started,
    input: input.input,
    exitCode: input.exitCode,
    httpStatus: input.httpStatus,
    stdout: input.stdout,
    stderr: input.stderr,
    resultPath,
  }

  await mkdir(join(input.runDir, 'artifacts', 'tool_calls'), {
    recursive: true,
  })
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  await appendTraceEvent(
    join(input.runDir, 'trace.jsonl'),
    createTraceEvent({
      traceId: input.task.traceId ?? `trace_${input.task.id}`,
      taskId: input.task.id,
      modeId: input.tool.modeId,
      event: 'tool.called',
      data: {
        toolCallId: result.id,
        toolId: input.tool.id,
        toolName: input.tool.name,
        toolKind: input.tool.kind,
        status: input.status,
        approved: input.approved,
        approvalRequestId: input.approvalRequestId,
        httpStatus: input.httpStatus,
        resultPath,
      },
    }),
  )

  return result
}

export async function loadToolRegistry(runDir: string): Promise<AwmpToolRegistry> {
  const raw = await readFile(join(runDir, 'artifacts', 'tool_registry.json'), 'utf8')
  const parsed = JSON.parse(raw) as AwmpToolRegistry
  if (parsed.kind !== 'ToolBrokerRegistry' || !Array.isArray(parsed.entries)) {
    throw new Error('Invalid AWMP tool registry artifact.')
  }
  return parsed
}

async function loadRunTask(runDir: string): Promise<AwmpTask> {
  const raw = await readFile(join(runDir, 'task.json'), 'utf8')
  return JSON.parse(raw) as AwmpTask
}

async function loadRunCapsule(runDir: string): Promise<AwmpExecutionCapsule> {
  const raw = await readFile(join(runDir, 'capsule.json'), 'utf8')
  return JSON.parse(raw) as AwmpExecutionCapsule
}

function resolveToolReference(
  registry: AwmpToolRegistry,
  input: { toolId?: string; toolName?: string },
): AwmpToolRegistryEntry {
  if (input.toolId !== undefined) {
    const byId = registry.entries.find(entry => entry.id === input.toolId)
    if (byId !== undefined) {
      return byId
    }
    if (input.toolName === undefined) {
      throw new Error(`AWMP tool id not found: ${input.toolId}`)
    }
  }

  if (input.toolName !== undefined) {
    const matches = registry.entries.filter(entry => entry.name === input.toolName)
    if (matches.length === 1) return matches[0]!
    if (matches.length > 1) {
      throw new Error(
        `AWMP tool name is ambiguous: ${input.toolName}. Use tool_id instead.`,
      )
    }
    throw new Error(`AWMP tool name not found: ${input.toolName}`)
  }

  throw new Error('tool_id or tool_name is required.')
}

function mountedModeRootTarget(
  modePackage: AwmpModePackage,
  options: { runDir?: string },
): Record<string, string> {
  if (options.runDir === undefined) return {}
  return {
    modeRoot: join(
      options.runDir,
      'modes',
      sanitizePathSegment(modePackage.mode.id),
    ),
  }
}

function firstIntersection(
  candidates: string[],
  permissions: string[],
): string | undefined {
  const permissionSet = new Set(permissions)
  return candidates.find(candidate => permissionSet.has(candidate))
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  )
}

function compactRecord(
  value: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  )
}

function buildOpenApiRequest(
  tool: AwmpToolRegistryEntry,
  input: unknown,
): {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
} | null {
  const rawUrl =
    tool.target.url ??
    (tool.target.baseUrl === undefined || tool.target.path === undefined
      ? undefined
      : new URL(tool.target.path, ensureTrailingSlash(tool.target.baseUrl))
          .toString())
  if (rawUrl === undefined) return null

  const requestInput = asRecord(input)
  const url = new URL(rawUrl)
  for (const [key, value] of Object.entries(asRecord(requestInput.query))) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      url.searchParams.set(key, String(value))
    }
  }

  const method = (tool.target.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
  }
  for (const [key, value] of Object.entries(asRecord(requestInput.headers))) {
    if (typeof value === 'string' && isSafeHeaderName(key)) {
      headers[key] = value
    }
  }

  const body = requestInput.body
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['content-type'] = headers['content-type'] ?? 'application/json'
    return {
      url: url.toString(),
      method,
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }
  }

  return {
    url: url.toString(),
    method,
    headers,
  }
}

function isNetworkAllowed(
  capsule: AwmpExecutionCapsule,
  url: string,
): { allowed: true } | { allowed: false; reason: string } {
  const networkMode = capsule.network?.mode ?? 'deny'
  if (networkMode === 'open') return { allowed: true }
  if (networkMode === 'deny') {
    return {
      allowed: false,
      reason: 'Execution Capsule network policy denies outbound HTTP calls.',
    }
  }

  const target = new URL(url)
  const allowlist = capsule.network?.allow ?? []
  const matched = allowlist.some(entry => networkAllowEntryMatches(entry, target))
  if (matched) return { allowed: true }

  return {
    allowed: false,
    reason: `Execution Capsule network allowlist does not include ${target.origin}.`,
  }
}

function networkAllowEntryMatches(entry: string, target: URL): boolean {
  if (!entry.trim()) return false
  if (entry === target.hostname || entry === target.host || entry === target.origin) {
    return true
  }

  try {
    const parsed = new URL(entry)
    return parsed.origin === target.origin
  } catch {
    return false
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function isSafeHeaderName(value: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(value) && value.toLowerCase() !== 'host'
}

function isAllowedRuntime(value: string | undefined): boolean {
  return (
    value === 'python' ||
    value === 'python3' ||
    value === 'bun' ||
    value === 'node'
  )
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function tokenize(value: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return tokens
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function truncate(value: string, max = 4000): string | undefined {
  if (!value) return undefined
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n...[truncated]`
}
