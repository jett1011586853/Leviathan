import { existsSync } from 'fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'path'
import { loadModePackage } from './modeRegistry.js'
import { sanitizePathSegment } from './paths.js'
import type { AwmpModePackage } from './types.js'

export type AwmpModePackageScaffoldOptions = {
  targetDir: string
  id: string
  name: string
  description: string
  intents?: string[]
  artifactTypes?: string[]
  force?: boolean
}

export type AwmpModePackageScaffoldResult = {
  root: string
  modePackage: AwmpModePackage
  createdFiles: string[]
}

export type AwmpModeLintSeverity = 'error' | 'warning' | 'info'

export type AwmpModeLintDiagnostic = {
  severity: AwmpModeLintSeverity
  code: string
  message: string
  path?: string
}

export type AwmpModeLintResult = {
  root: string
  ok: boolean
  modePackage?: AwmpModePackage
  diagnostics: AwmpModeLintDiagnostic[]
}

const DEFAULT_VALIDATOR_ID = 'schema_check'
const DEFAULT_LOCAL_TOOL_NAME = 'generate_artifact'
const DEFAULT_LOCAL_TOOL_COMMAND = 'bun tools/generate_artifact.ts'
const DEFAULT_VALIDATOR_COMMAND = 'bun validators/schema_check.ts'

export async function scaffoldModePackage(
  options: AwmpModePackageScaffoldOptions,
): Promise<AwmpModePackageScaffoldResult> {
  const root = resolve(options.targetDir)
  const normalized = normalizeScaffoldOptions(options)

  if (options.force !== true) {
    await assertSafeScaffoldTarget(root)
  }

  const files = buildScaffoldFiles(root, normalized)
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.content, 'utf8')
  }

  const modePackage = await loadModePackage(root)
  return {
    root,
    modePackage,
    createdFiles: files.map(file => file.path),
  }
}

export async function lintModePackage(
  modeDir: string,
): Promise<AwmpModeLintResult> {
  const root = resolve(modeDir)
  const diagnostics: AwmpModeLintDiagnostic[] = []
  let modePackage: AwmpModePackage | undefined

  try {
    modePackage = await loadModePackage(root)
  } catch (error) {
    return {
      root,
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'invalid_mode_yaml',
          message: error instanceof Error ? error.message : String(error),
          path: join(root, 'mode.yaml'),
        },
      ],
    }
  }

  const mode = modePackage.mode
  if ((mode.activation.intents ?? []).length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'missing_activation_intents',
      message: 'mode.activation.intents must contain at least one routing phrase.',
      path: join(root, 'mode.yaml'),
    })
  }

  if ((mode.outputs.artifacts ?? []).length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'missing_artifact_contract',
      message: 'mode.outputs.artifacts must declare at least one artifact contract.',
      path: join(root, 'mode.yaml'),
    })
  }

  const skillDiagnostic = await lintSkillFile(root)
  if (skillDiagnostic !== undefined) diagnostics.push(skillDiagnostic)

  for (const artifact of mode.outputs.artifacts ?? []) {
    if (artifact.schema !== undefined) {
      const schemaPath = join(root, artifact.schema)
      if (!(await fileExists(schemaPath))) {
        diagnostics.push({
          severity: 'warning',
          code: 'missing_artifact_schema_file',
          message: `Artifact schema file is declared but does not exist: ${artifact.schema}`,
          path: schemaPath,
        })
      }
    }
  }

  lintCommandDeclarations({
    root,
    diagnostics,
    declarations: asArray(mode.tools?.local),
    kind: 'local_tool',
    missingScriptSeverity: 'error',
  })

  lintCommandDeclarations({
    root,
    diagnostics,
    declarations: mode.validators ?? [],
    kind: 'validator',
    missingScriptSeverity: 'warning',
  })

  if ((mode.tools?.mcp ?? []).length === 0 && (mode.tools?.openapi ?? []).length === 0 && (mode.tools?.local ?? []).length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'no_tool_declarations',
      message:
        'Mode declares no tools. This is acceptable for pure guidance modes, but executable work modes should declare a tool surface.',
      path: join(root, 'mode.yaml'),
    })
  }

  if ((mode.permissions?.denied ?? []).length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'no_denied_permissions',
      message:
        'Mode permissions do not declare denied actions. Work modes should deny sensitive operations they must never perform.',
      path: join(root, 'mode.yaml'),
    })
  }

  return {
    root,
    ok: diagnostics.every(diagnostic => diagnostic.severity !== 'error'),
    modePackage,
    diagnostics,
  }
}

export function formatModeLintReport(result: AwmpModeLintResult): string {
  const header = [
    `AWMP mode lint: ${result.ok ? 'passed' : 'failed'}`,
    `Root: ${result.root}`,
    result.modePackage === undefined
      ? undefined
      : `Mode: ${result.modePackage.mode.id} (${result.modePackage.mode.name})`,
  ].filter(Boolean)

  if (result.diagnostics.length === 0) {
    return [...header, '', 'No diagnostics.'].join('\n')
  }

  return [
    ...header,
    '',
    ...result.diagnostics.map(diagnostic =>
      [
        `- ${diagnostic.severity.toUpperCase()} ${diagnostic.code}`,
        `  ${diagnostic.message}`,
        diagnostic.path === undefined ? undefined : `  path: ${diagnostic.path}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
}

function normalizeScaffoldOptions(options: AwmpModePackageScaffoldOptions): {
  id: string
  name: string
  description: string
  intents: string[]
  artifactTypes: string[]
} {
  const id = options.id.trim()
  const name = options.name.trim()
  const description = options.description.trim()
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new Error('AWMP mode id must match /^[a-zA-Z0-9_.-]+$/.')
  }
  if (!name) throw new Error('AWMP mode name is required.')
  if (!description) throw new Error('AWMP mode description is required.')

  const intents = uniqueStrings([...(options.intents ?? []), name, description])
  const artifactTypes = uniqueStrings(
    options.artifactTypes?.length
      ? options.artifactTypes
      : [`${id}.artifact`],
  )

  return {
    id,
    name,
    description,
    intents,
    artifactTypes,
  }
}

async function assertSafeScaffoldTarget(root: string): Promise<void> {
  try {
    const entries = await readdir(root)
    if (entries.length > 0) {
      throw new Error(
        `Target directory is not empty: ${root}. Use --force to overwrite scaffold files.`,
      )
    }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
}

function buildScaffoldFiles(
  root: string,
  input: {
    id: string
    name: string
    description: string
    intents: string[]
    artifactTypes: string[]
  },
): Array<{ path: string; content: string }> {
  const primaryArtifactType = input.artifactTypes[0]!
  const modeSlug = sanitizePathSegment(input.id)
  return [
    {
      path: join(root, 'mode.yaml'),
      content: [
        'awmp: "0.1"',
        'kind: "Mode"',
        `id: ${yamlString(input.id)}`,
        `name: ${yamlString(input.name)}`,
        'version: "0.1.0"',
        `description: ${yamlString(input.description)}`,
        'activation:',
        '  intents:',
        ...input.intents.map(intent => `    - ${yamlString(intent)}`),
        '  examples:',
        `    - ${yamlString(`Use ${input.name} to complete a governed work task.`)}`,
        '  antiExamples:',
        '    - "Requests unrelated to this work mode."',
        'inputs:',
        '  accepted:',
        '    - "objective"',
        '    - "inputs"',
        'outputs:',
        '  artifacts:',
        ...input.artifactTypes.flatMap((artifactType, index) => [
          `    - type: ${yamlString(artifactType)}`,
          '      mediaType: "application/json"',
          index === 0 ? '      schema: "schemas/output.schema.json"' : undefined,
        ].filter(Boolean) as string[]),
        'tools:',
        '  local:',
        `    - name: ${yamlString(DEFAULT_LOCAL_TOOL_NAME)}`,
        `      command: ${yamlString(DEFAULT_LOCAL_TOOL_COMMAND)}`,
        'permissions:',
        '  default:',
        '    - "artifact:read"',
        '  requiresApproval:',
        '    - "external:write"',
        '  denied:',
        '    - "secrets:exfiltrate"',
        '    - "policy:bypass_approval"',
        'validators:',
        `  - id: ${yamlString(DEFAULT_VALIDATOR_ID)}`,
        `    command: ${yamlString(DEFAULT_VALIDATOR_COMMAND)}`,
        '    blocking: true',
        'handoffs:',
        '  canDelegateTo: []',
        '  canReceiveFrom: []',
        '',
      ].join('\n'),
    },
    {
      path: join(root, 'SKILL.md'),
      content: [
        '---',
        `name: ${input.id}`,
        `description: ${input.description}`,
        '---',
        '',
        `# ${input.name}`,
        '',
        'Use this mode when the task matches the activation intents in mode.yaml.',
        'Produce artifacts that satisfy schemas/output.schema.json and keep sensitive operations behind the AWMP permission policy.',
        '',
      ].join('\n'),
    },
    {
      path: join(root, 'schemas', 'output.schema.json'),
      content: `${JSON.stringify(
        {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          required: ['modeId', 'artifactType', 'summary'],
          properties: {
            modeId: { const: input.id },
            artifactType: { const: primaryArtifactType },
            summary: { type: 'string' },
            data: { type: 'object' },
          },
          additionalProperties: true,
        },
        null,
        2,
      )}\n`,
    },
    {
      path: join(root, 'tools', 'generate_artifact.ts'),
      content: [
        'import { mkdir, writeFile } from "fs/promises"',
        'import { join } from "path"',
        '',
        'const input = JSON.parse(process.env.AWMP_TOOL_INPUT_JSON || "{}")',
        'const artifactsDir = process.env.AWMP_ARTIFACTS_DIR',
        'if (!artifactsDir) throw new Error("AWMP_ARTIFACTS_DIR is required")',
        'await mkdir(artifactsDir, { recursive: true })',
        `const artifactPath = join(artifactsDir, ${JSON.stringify(`${modeSlug}_artifact.json`)})`,
        'const artifact = {',
        `  modeId: ${JSON.stringify(input.id)},`,
        `  artifactType: ${JSON.stringify(primaryArtifactType)},`,
        '  summary: typeof input.summary === "string" ? input.summary : "Generated by AWMP scaffold tool.",',
        '  data: typeof input.data === "object" && input.data !== null ? input.data : {},',
        '}',
        'await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\\n`, "utf8")',
        'console.log(JSON.stringify({ artifactPath, artifact }))',
        '',
      ].join('\n'),
    },
    {
      path: join(root, 'validators', 'schema_check.ts'),
      content: [
        'const artifactIndexPath = process.env.AWMP_ARTIFACT_INDEX',
        'if (!artifactIndexPath) {',
        '  console.log(JSON.stringify({',
        '    status: "failed",',
        '    severity: "blocking",',
        '    message: "AWMP_ARTIFACT_INDEX is required.",',
        '  }))',
        '  process.exit(1)',
        '}',
        '',
        'console.log(JSON.stringify({',
        '  status: "passed",',
        '  severity: "info",',
        '  message: "Scaffold validator completed. Replace this with artifact-specific checks.",',
        '}))',
        '',
      ].join('\n'),
    },
    {
      path: join(root, 'examples', 'task.json'),
      content: `${JSON.stringify(
        {
          awmp: '0.1',
          kind: 'Task',
          id: `task_${modeSlug}_example`,
          contextId: `ctx_${modeSlug}_example`,
          title: `${input.name} example task`,
          objective: input.description,
          modeIds: [input.id],
          inputs: {},
          status: {
            state: 'submitted',
          },
          constraints: {
            network: 'deny',
            maxRuntimeSeconds: 900,
          },
          artifacts: [],
          traceId: `trace_${modeSlug}_example`,
        },
        null,
        2,
      )}\n`,
    },
  ]
}

async function lintSkillFile(
  root: string,
): Promise<AwmpModeLintDiagnostic | undefined> {
  const skillPath = join(root, 'SKILL.md')
  try {
    const text = await readFile(skillPath, 'utf8')
    if (!text.trim()) {
      return {
        severity: 'error',
        code: 'empty_skill_file',
        message: 'SKILL.md exists but is empty.',
        path: skillPath,
      }
    }
    return undefined
  } catch {
    return {
      severity: 'error',
      code: 'missing_skill_file',
      message:
        'Mode package must include SKILL.md so the agent can load operational guidance progressively.',
      path: skillPath,
    }
  }
}

function lintCommandDeclarations(input: {
  root: string
  diagnostics: AwmpModeLintDiagnostic[]
  declarations: unknown[]
  kind: 'local_tool' | 'validator'
  missingScriptSeverity: AwmpModeLintSeverity
}): void {
  for (const declaration of input.declarations) {
    const record = asRecord(declaration)
    const command = stringValue(record.command)
    const id = stringValue(record.name) ?? stringValue(record.id) ?? input.kind
    if (command === undefined) {
      input.diagnostics.push({
        severity: 'error',
        code: `${input.kind}_missing_command`,
        message: `${input.kind} ${id} must declare a command.`,
        path: join(input.root, 'mode.yaml'),
      })
      continue
    }

    const parsed = parseRestrictedCommand(input.root, command)
    if (parsed.status === 'unsafe') {
      input.diagnostics.push({
        severity: 'error',
        code: `${input.kind}_unsafe_command`,
        message: `${input.kind} ${id} command is unsafe: ${parsed.reason}`,
        path: join(input.root, 'mode.yaml'),
      })
      continue
    }

    if (!parsed.scriptExists) {
      input.diagnostics.push({
        severity: input.missingScriptSeverity,
        code: `${input.kind}_missing_script`,
        message: `${input.kind} ${id} references a script that does not exist: ${parsed.scriptPath}`,
        path: parsed.scriptPath,
      })
    }
  }
}

function parseRestrictedCommand(
  root: string,
  command: string,
): { status: 'ok'; scriptPath: string; scriptExists: boolean } | {
  status: 'unsafe'
  reason: string
} {
  const parts = tokenize(command)
  if (parts.length < 2) {
    return { status: 'unsafe', reason: 'command must include runtime and script' }
  }

  const runtime = parts[0]
  const script = parts[1]
  if (!isAllowedRuntime(runtime)) {
    return {
      status: 'unsafe',
      reason: 'runtime must be one of python, python3, bun, node',
    }
  }
  if (script === undefined || isAbsolute(script)) {
    return { status: 'unsafe', reason: 'script path must be relative' }
  }

  const scriptPath = normalize(join(root, script))
  if (!isInside(root, scriptPath)) {
    return { status: 'unsafe', reason: 'script path escapes mode package root' }
  }

  return {
    status: 'ok',
    scriptPath,
    scriptExists: existsSync(scriptPath),
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
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

function uniqueStrings(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map(value => value.trim())
        .filter(value => value.length > 0),
    ),
  ]
}

function yamlString(value: string): string {
  return JSON.stringify(value)
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
