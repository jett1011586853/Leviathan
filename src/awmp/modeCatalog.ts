import { createHash } from 'crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, join, relative, resolve, sep } from 'path'
import { lintModePackage, type AwmpModeLintResult } from './modeAuthoring.js'
import { discoverModePackages } from './modeRegistry.js'
import { getAwmpStateRoot } from './paths.js'
import type { AwmpModePackage } from './types.js'

export type AwmpModeCatalogEntry = {
  awmp: '0.1'
  kind: 'ModeCatalogEntry'
  id: string
  name: string
  version: string
  description: string
  root: string
  source: 'local'
  packageDigest: string
  publishedAt: string
  skillPath?: string
  capabilities: {
    intents: string[]
    inputKeys: string[]
    artifactTypes: string[]
    toolKinds: {
      local: number
      openapi: number
      mcp: number
    }
    permissions: {
      default: string[]
      requiresApproval: string[]
      denied: string[]
    }
    validators: Array<{
      id: string
      blocking: boolean
    }>
    handoffs: {
      canDelegateTo: string[]
      canReceiveFrom: string[]
    }
  }
  lint: {
    ok: boolean
    errors: number
    warnings: number
    infos: number
  }
}

export type AwmpModeCatalog = {
  awmp: '0.1'
  kind: 'ModeCatalog'
  generatedAt: string
  catalogPath: string
  entries: AwmpModeCatalogEntry[]
}

export type AwmpModeCatalogPublishResult = {
  catalog: AwmpModeCatalog
  entry: AwmpModeCatalogEntry
  catalogPath: string
  replaced: boolean
}

const CATALOG_FILE = 'mode_catalog.json'
const HASH_EXCLUDED_DIRS = new Set(['.git', 'node_modules'])
const HASH_EXCLUDED_FILES = new Set([CATALOG_FILE])

export function getDefaultModeCatalogPath(cwd = process.cwd()): string {
  return join(getAwmpStateRoot(cwd), 'catalog', CATALOG_FILE)
}

export async function loadModeCatalog(input?: {
  catalogPath?: string
  cwd?: string
}): Promise<AwmpModeCatalog> {
  const catalogPath = resolve(
    input?.catalogPath ?? getDefaultModeCatalogPath(input?.cwd),
  )
  try {
    const parsed = JSON.parse(await readFile(catalogPath, 'utf8')) as AwmpModeCatalog
    return {
      awmp: '0.1',
      kind: 'ModeCatalog',
      generatedAt: parsed.generatedAt ?? new Date().toISOString(),
      catalogPath,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch {
    return emptyCatalog(catalogPath)
  }
}

export async function publishModeToCatalog(input: {
  modeDir: string
  catalogPath?: string
  cwd?: string
  force?: boolean
}): Promise<AwmpModeCatalogPublishResult> {
  const catalogPath = resolve(
    input.catalogPath ?? getDefaultModeCatalogPath(input.cwd),
  )
  const lint = await lintModePackage(resolve(input.modeDir))
  if (lint.modePackage === undefined || !lint.ok) {
    throw new Error(
      `Cannot publish invalid AWMP mode: ${formatLintFailure(lint)}`,
    )
  }

  const catalog = await loadModeCatalog({ catalogPath })
  const entry = await buildModeCatalogEntry(lint.modePackage, lint)
  const existing = catalog.entries.find(
    item => item.id === entry.id && item.version === entry.version,
  )
  if (
    existing !== undefined &&
    existing.packageDigest !== entry.packageDigest &&
    input.force !== true
  ) {
    throw new Error(
      `Mode ${entry.id}@${entry.version} already exists in catalog with a different digest. Use --force to replace it.`,
    )
  }

  const entries = [
    ...catalog.entries.filter(
      item => !(item.id === entry.id && item.version === entry.version),
    ),
    entry,
  ].sort((left, right) =>
    left.id.localeCompare(right.id) || left.version.localeCompare(right.version),
  )
  const updatedCatalog: AwmpModeCatalog = {
    awmp: '0.1',
    kind: 'ModeCatalog',
    generatedAt: new Date().toISOString(),
    catalogPath,
    entries,
  }
  await writeModeCatalog(updatedCatalog)

  return {
    catalog: updatedCatalog,
    entry,
    catalogPath,
    replaced: existing !== undefined,
  }
}

export async function buildModeCatalogFromRoots(input: {
  modeRoots: string[]
  catalogPath?: string
  cwd?: string
  write?: boolean
}): Promise<AwmpModeCatalog> {
  const catalogPath = resolve(
    input.catalogPath ?? getDefaultModeCatalogPath(input.cwd),
  )
  const modes = await discoverModePackages(input.modeRoots)
  const entries = await Promise.all(
    modes.map(async modePackage => {
      const lint = await lintModePackage(modePackage.root)
      return buildModeCatalogEntry(modePackage, lint)
    }),
  )
  const catalog: AwmpModeCatalog = {
    awmp: '0.1',
    kind: 'ModeCatalog',
    generatedAt: new Date().toISOString(),
    catalogPath,
    entries: entries.sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.version.localeCompare(right.version),
    ),
  }

  if (input.write === true) {
    await writeModeCatalog(catalog)
  }

  return catalog
}

export function formatModeCatalog(catalog: AwmpModeCatalog): string {
  if (catalog.entries.length === 0) {
    return [
      'AWMP mode catalog',
      `Path: ${catalog.catalogPath}`,
      '',
      'No catalog entries.',
    ].join('\n')
  }

  return [
    'AWMP mode catalog',
    `Path: ${catalog.catalogPath}`,
    `Entries: ${catalog.entries.length}`,
    '',
    ...catalog.entries.map(entry =>
      [
        `- ${entry.id}@${entry.version} (${entry.name})`,
        `  root: ${entry.root}`,
        `  digest: ${entry.packageDigest}`,
        `  artifacts: ${entry.capabilities.artifactTypes.join(', ') || 'none'}`,
        `  tools: local=${entry.capabilities.toolKinds.local}, openapi=${entry.capabilities.toolKinds.openapi}, mcp=${entry.capabilities.toolKinds.mcp}`,
        `  validators: ${entry.capabilities.validators.length}`,
        `  approvals: ${entry.capabilities.permissions.requiresApproval.length}`,
        `  lint: ${entry.lint.ok ? 'ok' : 'not ok'} (${entry.lint.errors} errors, ${entry.lint.warnings} warnings)`,
      ].join('\n'),
    ),
  ].join('\n')
}

export async function buildModeCatalogEntry(
  modePackage: AwmpModePackage,
  lint: AwmpModeLintResult,
): Promise<AwmpModeCatalogEntry> {
  const { mode } = modePackage
  return {
    awmp: '0.1',
    kind: 'ModeCatalogEntry',
    id: mode.id,
    name: mode.name,
    version: mode.version,
    description: mode.description,
    root: modePackage.root,
    source: 'local',
    packageDigest: await hashModePackage(modePackage.root),
    publishedAt: new Date().toISOString(),
    skillPath: modePackage.skillPath,
    capabilities: {
      intents: [...(mode.activation.intents ?? [])],
      inputKeys: [...(mode.inputs?.accepted ?? [])],
      artifactTypes: (mode.outputs.artifacts ?? []).map(artifact => artifact.type),
      toolKinds: {
        local: countArray(mode.tools?.local),
        openapi: countArray(mode.tools?.openapi),
        mcp: countArray(mode.tools?.mcp),
      },
      permissions: {
        default: [...(mode.permissions?.default ?? [])],
        requiresApproval: [...(mode.permissions?.requiresApproval ?? [])],
        denied: [...(mode.permissions?.denied ?? [])],
      },
      validators: (mode.validators ?? []).map(validator => ({
        id: validator.id,
        blocking: validator.blocking === true,
      })),
      handoffs: {
        canDelegateTo: [...(mode.handoffs?.canDelegateTo ?? [])],
        canReceiveFrom: [...(mode.handoffs?.canReceiveFrom ?? [])],
      },
    },
    lint: {
      ok: lint.ok,
      errors: lint.diagnostics.filter(item => item.severity === 'error').length,
      warnings: lint.diagnostics.filter(item => item.severity === 'warning').length,
      infos: lint.diagnostics.filter(item => item.severity === 'info').length,
    },
  }
}

export async function hashModePackage(root: string): Promise<string> {
  const files = await listHashableFiles(resolve(root))
  const hash = createHash('sha256')
  for (const file of files) {
    const relativePath = relative(root, file).split(sep).join('/')
    hash.update(relativePath)
    hash.update('\0')
    hash.update(await readFile(file))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

async function listHashableFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (HASH_EXCLUDED_DIRS.has(entry.name)) continue
      files.push(...(await listHashableFiles(join(root, entry.name))))
      continue
    }
    if (!entry.isFile() || HASH_EXCLUDED_FILES.has(entry.name)) continue
    const path = join(root, entry.name)
    const info = await stat(path)
    if (!info.isFile()) continue
    files.push(path)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

async function writeModeCatalog(catalog: AwmpModeCatalog): Promise<void> {
  await mkdir(dirname(catalog.catalogPath), { recursive: true })
  await writeFile(
    catalog.catalogPath,
    `${JSON.stringify(catalog, null, 2)}\n`,
    'utf8',
  )
}

function emptyCatalog(catalogPath: string): AwmpModeCatalog {
  return {
    awmp: '0.1',
    kind: 'ModeCatalog',
    generatedAt: new Date().toISOString(),
    catalogPath,
    entries: [],
  }
}

function formatLintFailure(lint: AwmpModeLintResult): string {
  return lint.diagnostics
    .filter(diagnostic => diagnostic.severity === 'error')
    .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
    .join('; ') || 'missing mode package'
}

function countArray(value: unknown[] | undefined): number {
  return value?.length ?? 0
}
