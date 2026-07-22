import { stat } from 'fs/promises'
import { isAbsolute, join, normalize, relative, resolve } from 'path'
import type {
  AwmpModePackage,
  AwmpValidationResult,
  AwmpValidator,
} from './types.js'

export async function runModeValidators(options: {
  modePackages: AwmpModePackage[]
  allowExecution?: boolean
  runDir?: string
  taskPath?: string
  artifactIndexPath?: string
  timeoutMs?: number
}): Promise<AwmpValidationResult[]> {
  const results: AwmpValidationResult[] = []

  for (const modePackage of options.modePackages) {
    for (const validator of modePackage.mode.validators ?? []) {
      results.push(await inspectValidator(modePackage, validator, options))
    }
  }

  return results
}

async function inspectValidator(
  modePackage: AwmpModePackage,
  validator: AwmpValidator,
  options: {
    allowExecution?: boolean
    runDir?: string
    taskPath?: string
    artifactIndexPath?: string
    timeoutMs?: number
  },
): Promise<AwmpValidationResult> {
  const parsedCommand = parseValidatorCommand(modePackage.root, validator.command)

  if (parsedCommand === null) {
    return {
      validatorId: validator.id,
      modeId: modePackage.mode.id,
      status: 'failed',
      severity: validator.blocking === false ? 'warning' : 'blocking',
      command: validator.command,
      message:
        'Validator command must be one of: python <relative.py>, python3 <relative.py>, bun <relative.ts|js>, node <relative.js>, and the script must stay inside the mode package.',
    }
  }

  const exists = await fileExists(parsedCommand.scriptPath)

  if (!exists) {
    return {
      validatorId: validator.id,
      modeId: modePackage.mode.id,
      status: 'skipped',
      severity: validator.blocking === false ? 'warning' : 'blocking',
      command: validator.command,
      message:
        'Validator command is declared by mode.yaml but the referenced file is not present in the mode package.',
    }
  }

  if (!options.allowExecution) {
    return {
      validatorId: validator.id,
      modeId: modePackage.mode.id,
      status: 'skipped',
      severity: 'info',
      command: validator.command,
      message:
        'Validator command was found but not executed. AWMP v0.1 substrate does not run mode-provided code by default.',
    }
  }

  return executeValidator(modePackage, validator, parsedCommand, options)
}

type ParsedValidatorCommand = {
  runtime: 'python' | 'python3' | 'bun' | 'node'
  executable: string
  scriptPath: string
  args: string[]
}

function parseValidatorCommand(
  modeRoot: string,
  command: string,
): ParsedValidatorCommand | null {
  const parts = tokenize(command)
  if (parts.length < 2) return null

  const runtime = parts[0]
  if (!isAllowedRuntime(runtime)) return null

  const script = parts[1]!
  if (isAbsolute(script)) return null

  const scriptPath = normalize(join(modeRoot, script))
  if (!isInside(modeRoot, scriptPath)) return null

  return {
    runtime,
    executable: runtime === 'bun' ? process.execPath : runtime,
    scriptPath,
    args: parts.slice(2),
  }
}

async function executeValidator(
  modePackage: AwmpModePackage,
  validator: AwmpValidator,
  command: ParsedValidatorCommand,
  options: {
    runDir?: string
    taskPath?: string
    artifactIndexPath?: string
    timeoutMs?: number
  },
): Promise<AwmpValidationResult> {
  const started = Date.now()
  const timeoutMs = options.timeoutMs ?? 10_000
  const proc = Bun.spawn([command.executable, command.scriptPath, ...command.args], {
    cwd: options.runDir ?? modePackage.root,
    env: {
      PATH: process.env.PATH ?? '',
      AWMP_MODE_ID: modePackage.mode.id,
      AWMP_MODE_ROOT: modePackage.root,
      AWMP_RUN_DIR: options.runDir ?? '',
      AWMP_WORKSPACE_DIR:
        options.runDir === undefined ? '' : join(options.runDir, 'workspace'),
      AWMP_ARTIFACTS_DIR:
        options.runDir === undefined ? '' : join(options.runDir, 'artifacts'),
      AWMP_ARTIFACT_INDEX: options.artifactIndexPath ?? '',
      AWMP_TASK_PATH: options.taskPath ?? '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

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
  const durationMs = Date.now() - started
  const parsed = parseValidatorStdout(stdout)

  if (timedOut) {
    return {
      validatorId: validator.id,
      modeId: modePackage.mode.id,
      status: 'failed',
      severity: validator.blocking === false ? 'warning' : 'blocking',
      command: validator.command,
      exitCode,
      durationMs,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      message: `Validator timed out after ${timeoutMs}ms.`,
    }
  }

  if (parsed.status === 'skipped') {
    return {
      validatorId: validator.id,
      modeId: modePackage.mode.id,
      status: 'skipped',
      severity: parsed.severity ?? 'info',
      command: validator.command,
      exitCode,
      durationMs,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      findings: parsed.findings,
      message: parsed.message ?? 'Validator skipped.',
    }
  }

  const passed = exitCode === 0 && parsed.status !== 'failed'
  return {
    validatorId: validator.id,
    modeId: modePackage.mode.id,
    status: passed ? 'passed' : 'failed',
    severity:
      parsed.severity ??
      (passed ? 'info' : validator.blocking === false ? 'warning' : 'blocking'),
    command: validator.command,
    exitCode,
    durationMs,
    stdout: truncate(stdout),
    stderr: truncate(stderr),
    findings: parsed.findings,
    message:
      parsed.message ??
      (passed
        ? 'Validator passed.'
        : `Validator failed with exit code ${exitCode}.`),
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function isAllowedRuntime(
  value: string | undefined,
): value is ParsedValidatorCommand['runtime'] {
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

function parseValidatorStdout(stdout: string): {
  status?: 'passed' | 'failed' | 'skipped'
  severity?: 'info' | 'warning' | 'blocking'
  message?: string
  findings?: unknown[]
} {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith('{')) return {}

  try {
    const parsed = JSON.parse(trimmed) as {
      status?: unknown
      severity?: unknown
      message?: unknown
      findings?: unknown
    }
    return {
      status:
        parsed.status === 'passed' ||
        parsed.status === 'failed' ||
        parsed.status === 'skipped'
          ? parsed.status
          : undefined,
      severity:
        parsed.severity === 'info' ||
        parsed.severity === 'warning' ||
        parsed.severity === 'blocking'
          ? parsed.severity
          : undefined,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      findings: Array.isArray(parsed.findings) ? parsed.findings : undefined,
    }
  } catch {
    return {}
  }
}

function truncate(value: string, max = 4000): string | undefined {
  if (!value) return undefined
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n...[truncated]`
}
