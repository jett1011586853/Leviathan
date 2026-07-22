import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { hashModePackage } from './modeCatalog.js'
import { lintModePackage } from './modeAuthoring.js'
import { getAwmpStateRoot } from './paths.js'

export type AwmpModeLockEntry = {
  awmp: '0.1'
  kind: 'ModeLockEntry'
  id: string
  name: string
  version: string
  root: string
  packageDigest: string
  lockedAt: string
  source: {
    kind: 'local'
    path: string
  }
  lint: {
    ok: boolean
    errors: number
    warnings: number
  }
}

export type AwmpModeLock = {
  awmp: '0.1'
  kind: 'ModeLock'
  generatedAt: string
  lockPath: string
  entries: AwmpModeLockEntry[]
}

export type AwmpModeLockResult = {
  lock: AwmpModeLock
  entry: AwmpModeLockEntry
  replaced: boolean
  lockPath: string
}

export type AwmpModeLockVerification = {
  awmp: '0.1'
  kind: 'ModeLockVerification'
  generatedAt: string
  lockPath: string
  ok: boolean
  checked: Array<{
    id: string
    version: string
    root: string
    expectedDigest: string
    actualDigest?: string
    status: 'matched' | 'missing' | 'mismatched' | 'invalid'
    message: string
  }>
}

const MODE_LOCK_FILE = 'mode_lock.json'

export function getDefaultModeLockPath(cwd = process.cwd()): string {
  return join(getAwmpStateRoot(cwd), 'catalog', MODE_LOCK_FILE)
}

export async function loadModeLock(input?: {
  cwd?: string
  lockPath?: string
}): Promise<AwmpModeLock> {
  const lockPath = resolve(input?.lockPath ?? getDefaultModeLockPath(input?.cwd))
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as AwmpModeLock
    return {
      awmp: '0.1',
      kind: 'ModeLock',
      generatedAt: parsed.generatedAt ?? new Date().toISOString(),
      lockPath,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch {
    return emptyModeLock(lockPath)
  }
}

export async function lockModePackage(input: {
  modeDir: string
  cwd?: string
  lockPath?: string
  force?: boolean
}): Promise<AwmpModeLockResult> {
  const root = resolve(input.modeDir)
  const lockPath = resolve(input.lockPath ?? getDefaultModeLockPath(input.cwd))
  const lint = await lintModePackage(root)
  if (lint.modePackage === undefined || !lint.ok) {
    throw new Error(`Cannot lock invalid AWMP mode: ${formatLintFailure(lint)}`)
  }

  const entry: AwmpModeLockEntry = {
    awmp: '0.1',
    kind: 'ModeLockEntry',
    id: lint.modePackage.mode.id,
    name: lint.modePackage.mode.name,
    version: lint.modePackage.mode.version,
    root: lint.modePackage.root,
    packageDigest: await hashModePackage(root),
    lockedAt: new Date().toISOString(),
    source: {
      kind: 'local',
      path: root,
    },
    lint: {
      ok: lint.ok,
      errors: lint.diagnostics.filter(item => item.severity === 'error').length,
      warnings: lint.diagnostics.filter(item => item.severity === 'warning')
        .length,
    },
  }

  const lock = await loadModeLock({ lockPath })
  const existing = lock.entries.find(
    item => item.id === entry.id && item.version === entry.version,
  )
  if (
    existing !== undefined &&
    existing.packageDigest !== entry.packageDigest &&
    input.force !== true
  ) {
    throw new Error(
      `Mode ${entry.id}@${entry.version} is already locked with a different digest. Use --force to replace the lock entry.`,
    )
  }

  const updated: AwmpModeLock = {
    awmp: '0.1',
    kind: 'ModeLock',
    generatedAt: new Date().toISOString(),
    lockPath,
    entries: [
      ...lock.entries.filter(
        item => !(item.id === entry.id && item.version === entry.version),
      ),
      entry,
    ].sort((left, right) =>
      left.id.localeCompare(right.id) ||
      left.version.localeCompare(right.version),
    ),
  }
  await writeModeLock(updated)

  return {
    lock: updated,
    entry,
    replaced: existing !== undefined,
    lockPath,
  }
}

export async function verifyModeLock(input?: {
  cwd?: string
  lockPath?: string
  modeDir?: string
}): Promise<AwmpModeLockVerification> {
  const lock = await loadModeLock({
    cwd: input?.cwd,
    lockPath: input?.lockPath,
  })
  const modeRoot = input?.modeDir === undefined ? undefined : resolve(input.modeDir)
  const entries =
    modeRoot === undefined
      ? lock.entries
      : lock.entries.filter(
          entry =>
            resolve(entry.root).toLowerCase() === modeRoot.toLowerCase() ||
            resolve(entry.source.path).toLowerCase() === modeRoot.toLowerCase(),
        )

  const checked: AwmpModeLockVerification['checked'] = []
  if (modeRoot !== undefined && entries.length === 0) {
    checked.push({
      id: '<unknown>',
      version: '<unknown>',
      root: modeRoot,
      expectedDigest: '<missing>',
      status: 'missing',
      message: `No lock entry found for mode root ${modeRoot}.`,
    })
  }

  for (const entry of entries) {
    try {
      const actualDigest = await hashModePackage(entry.root)
      const matched = actualDigest === entry.packageDigest
      checked.push({
        id: entry.id,
        version: entry.version,
        root: entry.root,
        expectedDigest: entry.packageDigest,
        actualDigest,
        status: matched ? 'matched' : 'mismatched',
        message: matched
          ? 'Mode package matches lock digest.'
          : 'Mode package digest differs from lock entry.',
      })
    } catch (error) {
      checked.push({
        id: entry.id,
        version: entry.version,
        root: entry.root,
        expectedDigest: entry.packageDigest,
        status: 'invalid',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    awmp: '0.1',
    kind: 'ModeLockVerification',
    generatedAt: new Date().toISOString(),
    lockPath: lock.lockPath,
    ok:
      checked.length > 0 &&
      checked.every(item => item.status === 'matched'),
    checked,
  }
}

export function formatModeLock(lock: AwmpModeLock): string {
  if (lock.entries.length === 0) {
    return [
      'AWMP mode lock',
      `Path: ${lock.lockPath}`,
      '',
      'No locked modes.',
    ].join('\n')
  }

  return [
    'AWMP mode lock',
    `Path: ${lock.lockPath}`,
    `Entries: ${lock.entries.length}`,
    '',
    ...lock.entries.map(entry =>
      [
        `- ${entry.id}@${entry.version} (${entry.name})`,
        `  root: ${entry.root}`,
        `  digest: ${entry.packageDigest}`,
        `  locked: ${entry.lockedAt}`,
        `  lint: ${entry.lint.ok ? 'ok' : 'not ok'} (${entry.lint.errors} errors, ${entry.lint.warnings} warnings)`,
      ].join('\n'),
    ),
  ].join('\n')
}

export function formatModeLockVerification(
  verification: AwmpModeLockVerification,
): string {
  return [
    `AWMP mode lock verification: ${verification.ok ? 'passed' : 'failed'}`,
    `Path: ${verification.lockPath}`,
    `Checked: ${verification.checked.length}`,
    '',
    ...verification.checked.map(item =>
      [
        `- ${item.id}@${item.version}: ${item.status}`,
        `  root: ${item.root}`,
        `  expected: ${item.expectedDigest}`,
        item.actualDigest === undefined ? undefined : `  actual: ${item.actualDigest}`,
        `  ${item.message}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
}

async function writeModeLock(lock: AwmpModeLock): Promise<void> {
  await mkdir(dirname(lock.lockPath), { recursive: true })
  await writeFile(lock.lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
}

function emptyModeLock(lockPath: string): AwmpModeLock {
  return {
    awmp: '0.1',
    kind: 'ModeLock',
    generatedAt: new Date().toISOString(),
    lockPath,
    entries: [],
  }
}

function formatLintFailure(
  lint: Awaited<ReturnType<typeof lintModePackage>>,
): string {
  return (
    lint.diagnostics
      .filter(diagnostic => diagnostic.severity === 'error')
      .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
      .join('; ') || 'missing mode package'
  )
}
