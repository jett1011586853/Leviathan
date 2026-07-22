import { createHash } from 'crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import {
  buildModeCatalogEntry,
  hashModePackage,
  type AwmpModeCatalogEntry,
} from './modeCatalog.js'
import { lintModePackage } from './modeAuthoring.js'
import { loadModePackage } from './modeRegistry.js'
import { getAwmpStateRoot, sanitizePathSegment } from './paths.js'
import type { AwmpModePackage } from './types.js'

export type AwmpModeBundleFile = {
  path: string
  size: number
  sha256: string
  contentBase64: string
}

export type AwmpModeBundle = {
  awmp: '0.1'
  kind: 'ModeBundle'
  generatedAt: string
  modeId: string
  version: string
  name: string
  description: string
  packageDigest: string
  catalogEntry: AwmpModeCatalogEntry
  files: AwmpModeBundleFile[]
  lint: {
    ok: boolean
    errors: number
    warnings: number
    infos: number
  }
}

export type AwmpModeBundleExportResult = {
  bundlePath: string
  bundleDigest: string
  bundle: AwmpModeBundle
  fileCount: number
  totalBytes: number
}

export type AwmpModeBundleInstallResult = {
  bundlePath: string
  bundleDigest: string
  installedRoot: string
  replaced: boolean
  modePackage: AwmpModePackage
  packageDigest: string
}

const BUNDLE_EXCLUDED_DIRS = new Set(['.git', 'node_modules'])
const BUNDLE_FILE_EXT = '.awmp-mode.json'

export async function exportModeBundle(input: {
  modeDir: string
  bundlePath?: string
  cwd?: string
  force?: boolean
}): Promise<AwmpModeBundleExportResult> {
  const root = resolve(input.modeDir)
  const lint = await lintModePackage(root)
  if (lint.modePackage === undefined || !lint.ok) {
    throw new Error(`Cannot export invalid AWMP mode: ${formatLintFailure(lint)}`)
  }

  const catalogEntry = await buildModeCatalogEntry(lint.modePackage, lint)
  const files = await readBundleFiles(root)
  const bundlePath = resolve(
    input.bundlePath ?? defaultBundlePath(input.cwd, catalogEntry),
  )
  if ((await exists(bundlePath)) && input.force !== true) {
    throw new Error(
      `Mode bundle already exists at ${bundlePath}. Use --force to replace it.`,
    )
  }

  const bundle: AwmpModeBundle = {
    awmp: '0.1',
    kind: 'ModeBundle',
    generatedAt: new Date().toISOString(),
    modeId: catalogEntry.id,
    version: catalogEntry.version,
    name: catalogEntry.name,
    description: catalogEntry.description,
    packageDigest: catalogEntry.packageDigest,
    catalogEntry,
    files,
    lint: catalogEntry.lint,
  }

  const serialized = `${JSON.stringify(bundle, null, 2)}\n`
  const bundleDigest = `sha256:${sha256Hex(Buffer.from(serialized, 'utf8'))}`
  await mkdir(dirname(bundlePath), { recursive: true })
  await writeFile(bundlePath, serialized, 'utf8')

  return {
    bundlePath,
    bundleDigest,
    bundle,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  }
}

export async function installModeBundle(input: {
  bundlePath: string
  cwd?: string
  force?: boolean
  expectedPackageDigest?: string
  expectedBundleDigest?: string
}): Promise<AwmpModeBundleInstallResult> {
  const bundlePath = isRemoteSource(input.bundlePath)
    ? input.bundlePath
    : resolve(input.bundlePath)
  const bundleText = await readModeBundleSource(bundlePath)
  const bundleDigest = `sha256:${sha256Hex(Buffer.from(bundleText, 'utf8'))}`
  if (
    input.expectedBundleDigest !== undefined &&
    bundleDigest !== input.expectedBundleDigest
  ) {
    throw new Error(
      `Bundle source digest mismatch: expected ${input.expectedBundleDigest}, actual ${bundleDigest}.`,
    )
  }
  const bundle = parseModeBundle(bundleText, bundlePath)
  if (
    input.expectedPackageDigest !== undefined &&
    bundle.packageDigest !== input.expectedPackageDigest
  ) {
    throw new Error(
      `Bundle package digest mismatch: expected ${input.expectedPackageDigest}, bundle declares ${bundle.packageDigest}.`,
    )
  }
  const modesRoot = join(getAwmpStateRoot(input.cwd), 'modes')
  const installedRoot = join(modesRoot, sanitizePathSegment(bundle.modeId))
  const tempRoot = join(
    modesRoot,
    `.install_${sanitizePathSegment(bundle.modeId)}_${Date.now()}`,
  )
  const alreadyInstalled = await exists(installedRoot)
  if (alreadyInstalled && input.force !== true) {
    throw new Error(
      `Mode ${bundle.modeId} is already installed at ${installedRoot}. Use --force to replace it.`,
    )
  }

  await mkdir(modesRoot, { recursive: true })
  try {
    await writeBundleFiles(tempRoot, bundle)
    const digest = await hashModePackage(tempRoot)
    const expectedDigest = input.expectedPackageDigest ?? bundle.packageDigest
    if (digest !== expectedDigest) {
      throw new Error(
        `Bundle digest mismatch for ${bundle.modeId}@${bundle.version}: expected ${expectedDigest}, actual ${digest}.`,
      )
    }
    const lint = await lintModePackage(tempRoot)
    if (lint.modePackage === undefined || !lint.ok) {
      throw new Error(`Installed bundle failed lint: ${formatLintFailure(lint)}`)
    }

    if (alreadyInstalled) {
      await rm(installedRoot, { recursive: true, force: true })
    }
    await rename(tempRoot, installedRoot)

    return {
      bundlePath,
      bundleDigest,
      installedRoot,
      replaced: alreadyInstalled,
      modePackage: await loadModePackage(installedRoot),
      packageDigest: digest,
    }
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true })
    throw error
  }
}

export function formatModeBundleExport(
  result: AwmpModeBundleExportResult,
): string {
  return [
    `Exported AWMP mode bundle ${result.bundle.modeId}@${result.bundle.version}`,
    `Path: ${result.bundlePath}`,
    `Bundle digest: ${result.bundleDigest}`,
    `Digest: ${result.bundle.packageDigest}`,
    `Files: ${result.fileCount}`,
    `Bytes: ${result.totalBytes}`,
  ].join('\n')
}

export function formatModeBundleInstall(
  result: AwmpModeBundleInstallResult,
): string {
  return [
    `${result.replaced ? 'Replaced' : 'Installed'} AWMP mode bundle ${result.modePackage.mode.id}@${result.modePackage.mode.version}`,
    `Bundle: ${result.bundlePath}`,
    `Bundle digest: ${result.bundleDigest}`,
    `Installed root: ${result.installedRoot}`,
    `Digest: ${result.packageDigest}`,
  ].join('\n')
}

async function readModeBundleSource(source: string): Promise<string> {
  if (isRemoteSource(source)) {
    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(
        `AWMP mode bundle fetch failed: HTTP ${response.status} ${response.statusText}`,
      )
    }
    return response.text()
  }
  return readFile(resolve(source), 'utf8')
}

function parseModeBundle(text: string, bundlePath: string): AwmpModeBundle {
  const parsed = JSON.parse(text) as Partial<AwmpModeBundle>
  if (parsed.awmp !== '0.1' || parsed.kind !== 'ModeBundle') {
    throw new Error(`Invalid AWMP mode bundle header in ${bundlePath}.`)
  }
  if (!parsed.modeId || !parsed.version || !parsed.packageDigest) {
    throw new Error(`Invalid AWMP mode bundle metadata in ${bundlePath}.`)
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error(`AWMP mode bundle ${bundlePath} contains no files.`)
  }
  return parsed as AwmpModeBundle
}

async function readBundleFiles(root: string): Promise<AwmpModeBundleFile[]> {
  const files = await listBundleFiles(root)
  return Promise.all(
    files.map(async file => {
      const content = await readFile(file)
      const relativePath = relative(root, file).split(sep).join('/')
      return {
        path: relativePath,
        size: content.length,
        sha256: sha256Hex(content),
        contentBase64: content.toString('base64'),
      }
    }),
  )
}

async function writeBundleFiles(
  root: string,
  bundle: AwmpModeBundle,
): Promise<void> {
  for (const file of bundle.files) {
    const relativePath = normalizeBundlePath(file.path)
    const content = Buffer.from(file.contentBase64, 'base64')
    if (content.length !== file.size) {
      throw new Error(`Bundle file size mismatch: ${file.path}.`)
    }
    const actualHash = sha256Hex(content)
    if (actualHash !== file.sha256) {
      throw new Error(`Bundle file digest mismatch: ${file.path}.`)
    }
    const target = resolve(root, relativePath)
    if (!isInside(root, target)) {
      throw new Error(`Bundle file escapes install root: ${file.path}.`)
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

async function listBundleFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (BUNDLE_EXCLUDED_DIRS.has(entry.name)) continue
      files.push(...(await listBundleFiles(join(root, entry.name))))
      continue
    }
    if (!entry.isFile()) continue
    const path = join(root, entry.name)
    const info = await stat(path)
    if (!info.isFile()) continue
    files.push(path)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function defaultBundlePath(
  cwd: string | undefined,
  entry: AwmpModeCatalogEntry,
): string {
  const digestSuffix = entry.packageDigest.replace(/^sha256:/, '').slice(0, 12)
  return join(
    getAwmpStateRoot(cwd),
    'bundles',
    `${sanitizePathSegment(entry.id)}_${sanitizePathSegment(entry.version)}_${digestSuffix}${BUNDLE_FILE_EXT}`,
  )
}

function normalizeBundlePath(path: string): string {
  const normalized = normalize(path).split(sep).join('/')
  if (!normalized || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`Invalid bundle file path: ${path}.`)
  }
  if (isAbsolute(normalized)) {
    throw new Error(`Bundle file path must be relative: ${path}.`)
  }
  return normalized
}

function sha256Hex(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function isRemoteSource(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://')
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
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
