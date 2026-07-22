import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import {
  buildModeCatalogEntry,
  hashModePackage,
  type AwmpModeCatalogEntry,
} from './modeCatalog.js'
import { lintModePackage } from './modeAuthoring.js'
import {
  exportModeBundle,
  installModeBundle,
  type AwmpModeBundleInstallResult,
} from './modeBundle.js'
import {
  loadModeTrust,
  signModePackage,
  verifyModeSignature,
  type AwmpModeSignature,
  verifyModeSignatureRecord,
} from './modeTrust.js'
import { getAwmpStateRoot } from './paths.js'

export type AwmpModeMarketplaceEntry = {
  awmp: '0.1'
  kind: 'ModeMarketplaceEntry'
  id: string
  modeId: string
  name: string
  version: string
  description: string
  root: string
  publisherId: string
  packageDigest: string
  bundleUri?: string
  bundleDigest?: string
  bundleFileCount?: number
  bundleBytes?: number
  signatureId?: string
  signature?: AwmpModeSignature
  source: 'local' | 'remote'
  sourceId?: string
  status: 'active' | 'revoked'
  publishedAt: string
  revokedAt?: string
  revokedBy?: string
  revocationReason?: string
  catalogEntry: AwmpModeCatalogEntry
}

export type AwmpModeMarketplace = {
  awmp: '0.1'
  kind: 'ModeMarketplace'
  generatedAt: string
  marketplacePath: string
  entries: AwmpModeMarketplaceEntry[]
}

export type AwmpModeMarketplaceFeed = {
  awmp: '0.1'
  kind: 'ModeMarketplaceFeed'
  generatedAt: string
  sourceId: string
  entries: AwmpModeMarketplaceEntry[]
}

export type AwmpModeMarketplacePublishResult = {
  marketplace: AwmpModeMarketplace
  entry: AwmpModeMarketplaceEntry
  marketplacePath: string
  signature?: AwmpModeSignature
  replaced: boolean
}

export type AwmpModeMarketplaceVerification = {
  awmp: '0.1'
  kind: 'ModeMarketplaceVerification'
  generatedAt: string
  marketplacePath: string
  ok: boolean
  checked: Array<{
    modeId: string
    version: string
    publisherId: string
    root: string
    expectedDigest: string
    actualDigest?: string
    status:
      | 'active'
      | 'missing'
      | 'revoked'
      | 'digest_mismatch'
      | 'missing_signature'
      | 'invalid_signature'
      | 'invalid_mode'
    message: string
  }>
}

export type AwmpModeMarketplaceSyncResult = {
  awmp: '0.1'
  kind: 'ModeMarketplaceSyncResult'
  generatedAt: string
  marketplacePath: string
  source: string
  sourceId: string
  added: number
  updated: number
  revoked: number
  unchanged: number
  marketplace: AwmpModeMarketplace
}

export type AwmpModeMarketplaceInstallResult = {
  awmp: '0.1'
  kind: 'ModeMarketplaceInstallResult'
  generatedAt: string
  marketplacePath: string
  entry: AwmpModeMarketplaceEntry
  install: AwmpModeBundleInstallResult
}

const MODE_MARKETPLACE_FILE = 'mode_marketplace.json'

export function getDefaultModeMarketplacePath(cwd = process.cwd()): string {
  return join(getAwmpStateRoot(cwd), 'marketplace', MODE_MARKETPLACE_FILE)
}

export async function loadModeMarketplace(input?: {
  cwd?: string
  marketplacePath?: string
}): Promise<AwmpModeMarketplace> {
  const marketplacePath = resolve(
    input?.marketplacePath ?? getDefaultModeMarketplacePath(input?.cwd),
  )
  try {
    const parsed = JSON.parse(
      await readFile(marketplacePath, 'utf8'),
    ) as Partial<AwmpModeMarketplace>
    return {
      awmp: '0.1',
      kind: 'ModeMarketplace',
      generatedAt: parsed.generatedAt ?? new Date().toISOString(),
      marketplacePath,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch {
    return emptyMarketplace(marketplacePath)
  }
}

export async function publishModeToMarketplace(input: {
  modeDir: string
  publisherId: string
  cwd?: string
  marketplacePath?: string
  trustPath?: string
  privateKeyPath?: string
  bundlePath?: string
  force?: boolean
}): Promise<AwmpModeMarketplacePublishResult> {
  const root = resolve(input.modeDir)
  const marketplacePath = resolve(
    input.marketplacePath ?? getDefaultModeMarketplacePath(input.cwd),
  )
  const publisherId = input.publisherId.trim()
  if (!publisherId) throw new Error('publisherId is required to publish a mode.')

  const lint = await lintModePackage(root)
  if (lint.modePackage === undefined || !lint.ok) {
    throw new Error(`Cannot publish invalid AWMP mode: ${formatLintFailure(lint)}`)
  }

  const signature =
    input.privateKeyPath === undefined
      ? undefined
      : (
          await signModePackage({
            modeDir: root,
            cwd: input.cwd,
            trustPath: input.trustPath,
            publisherId,
            privateKeyPath: input.privateKeyPath,
            force: input.force,
          })
        ).signature
  const catalogEntry = await buildModeCatalogEntry(lint.modePackage, lint)
  const bundle =
    input.bundlePath === undefined
      ? undefined
      : await exportModeBundle({
          cwd: input.cwd,
          modeDir: root,
          bundlePath: input.bundlePath,
          force: input.force,
        })
  const trustSignature =
    signature ??
    (await findMarketplaceSignature({
      cwd: input.cwd,
      trustPath: input.trustPath,
      root,
      publisherId,
      packageDigest: catalogEntry.packageDigest,
    }))
  const entry: AwmpModeMarketplaceEntry = {
    awmp: '0.1',
    kind: 'ModeMarketplaceEntry',
    id: `${catalogEntry.id}@${catalogEntry.version}:${publisherId}`,
    modeId: catalogEntry.id,
    name: catalogEntry.name,
    version: catalogEntry.version,
    description: catalogEntry.description,
    root: catalogEntry.root,
    publisherId,
    packageDigest: catalogEntry.packageDigest,
    bundleUri: bundle?.bundlePath,
    bundleDigest: bundle?.bundleDigest,
    bundleFileCount: bundle?.fileCount,
    bundleBytes: bundle?.totalBytes,
    signatureId: trustSignature?.id,
    signature: trustSignature,
    source: 'local',
    status: 'active',
    publishedAt: new Date().toISOString(),
    catalogEntry,
  }

  const marketplace = await loadModeMarketplace({ marketplacePath })
  const existing = marketplace.entries.find(item => item.id === entry.id)
  if (
    existing !== undefined &&
    (existing.packageDigest !== entry.packageDigest ||
      existing.status === 'revoked') &&
    input.force !== true
  ) {
    throw new Error(
      `Marketplace entry ${entry.id} already exists with status=${existing.status} and digest=${existing.packageDigest}. Use --force to replace it.`,
    )
  }

  const updated: AwmpModeMarketplace = {
    awmp: '0.1',
    kind: 'ModeMarketplace',
    generatedAt: new Date().toISOString(),
    marketplacePath,
    entries: [
      ...marketplace.entries.filter(item => item.id !== entry.id),
      entry,
    ].sort(sortMarketplaceEntries),
  }
  await writeModeMarketplace(updated)

  return {
    marketplace: updated,
    entry,
    marketplacePath,
    signature: trustSignature,
    replaced: existing !== undefined,
  }
}

export async function installMarketplaceMode(input: {
  modeId: string
  version?: string
  publisherId?: string
  cwd?: string
  marketplacePath?: string
  force?: boolean
}): Promise<AwmpModeMarketplaceInstallResult> {
  const marketplace = await loadModeMarketplace({
    cwd: input.cwd,
    marketplacePath: input.marketplacePath,
  })
  const entry = findInstallableMarketplaceEntry(marketplace.entries, input)
  if (entry.status === 'revoked') {
    throw new Error(
      `Marketplace entry ${entry.id} is revoked${entry.revocationReason === undefined ? '' : `: ${entry.revocationReason}`}.`,
    )
  }
  if (entry.bundleUri === undefined) {
    throw new Error(
      `Marketplace entry ${entry.id} does not declare a bundleUri. Publish with --bundle or install the mode package manually.`,
    )
  }

  const install = await installModeBundle({
    cwd: input.cwd,
    bundlePath: entry.bundleUri,
    expectedBundleDigest: entry.bundleDigest,
    expectedPackageDigest: entry.packageDigest,
    force: input.force,
  })
  const signatureOk =
    entry.signature === undefined
      ? true
      : verifyModeSignatureRecord(entry.signature, install.packageDigest)
  if (!signatureOk) {
    throw new Error(`Marketplace entry ${entry.id} has an invalid inline signature.`)
  }

  return {
    awmp: '0.1',
    kind: 'ModeMarketplaceInstallResult',
    generatedAt: new Date().toISOString(),
    marketplacePath: marketplace.marketplacePath,
    entry,
    install,
  }
}

export async function syncModeMarketplace(input: {
  source: string
  cwd?: string
  marketplacePath?: string
  sourceId?: string
  force?: boolean
}): Promise<AwmpModeMarketplaceSyncResult> {
  const marketplace = await loadModeMarketplace({
    cwd: input.cwd,
    marketplacePath: input.marketplacePath,
  })
  const feed = await loadMarketplaceFeed(input.source, input.sourceId)
  let added = 0
  let updated = 0
  let revoked = 0
  let unchanged = 0

  const existingById = new Map(marketplace.entries.map(entry => [entry.id, entry]))
  const merged = new Map(marketplace.entries.map(entry => [entry.id, entry]))
  for (const incoming of feed.entries) {
    const normalized: AwmpModeMarketplaceEntry = {
      ...incoming,
      source: 'remote',
      sourceId: feed.sourceId,
    }
    const existing = existingById.get(normalized.id)
    if (existing === undefined) {
      merged.set(normalized.id, normalized)
      added += 1
      if (normalized.status === 'revoked') revoked += 1
      continue
    }
    if (
      existing.packageDigest !== normalized.packageDigest &&
      input.force !== true
    ) {
      throw new Error(
        `Marketplace sync refused digest change for ${normalized.id}: local=${existing.packageDigest}, incoming=${normalized.packageDigest}. Use force to replace.`,
      )
    }
    if (marketplaceEntriesEqual(existing, normalized)) {
      unchanged += 1
      continue
    }
    merged.set(normalized.id, normalized)
    updated += 1
    if (normalized.status === 'revoked' && existing.status !== 'revoked') {
      revoked += 1
    }
  }

  const updatedMarketplace: AwmpModeMarketplace = {
    awmp: '0.1',
    kind: 'ModeMarketplace',
    generatedAt: new Date().toISOString(),
    marketplacePath: marketplace.marketplacePath,
    entries: [...merged.values()].sort(sortMarketplaceEntries),
  }
  await writeModeMarketplace(updatedMarketplace)

  return {
    awmp: '0.1',
    kind: 'ModeMarketplaceSyncResult',
    generatedAt: updatedMarketplace.generatedAt,
    marketplacePath: updatedMarketplace.marketplacePath,
    source: input.source,
    sourceId: feed.sourceId,
    added,
    updated,
    revoked,
    unchanged,
    marketplace: updatedMarketplace,
  }
}

export async function revokeMarketplaceMode(input: {
  modeId: string
  version: string
  publisherId: string
  reason: string
  revokedBy?: string
  cwd?: string
  marketplacePath?: string
}): Promise<AwmpModeMarketplaceEntry> {
  const marketplace = await loadModeMarketplace({
    cwd: input.cwd,
    marketplacePath: input.marketplacePath,
  })
  const id = `${input.modeId}@${input.version}:${input.publisherId}`
  const existing = marketplace.entries.find(item => item.id === id)
  if (existing === undefined) {
    throw new Error(`Marketplace entry ${id} was not found.`)
  }
  const revoked: AwmpModeMarketplaceEntry = {
    ...existing,
    status: 'revoked',
    revokedAt: new Date().toISOString(),
    revokedBy: input.revokedBy,
    revocationReason: input.reason,
  }
  const updated: AwmpModeMarketplace = {
    ...marketplace,
    generatedAt: new Date().toISOString(),
    entries: marketplace.entries.map(item => (item.id === id ? revoked : item)),
  }
  await writeModeMarketplace(updated)
  return revoked
}

export async function verifyModeMarketplace(input?: {
  cwd?: string
  marketplacePath?: string
  trustPath?: string
  modeDir?: string
  publisherId?: string
}): Promise<AwmpModeMarketplaceVerification> {
  const marketplace = await loadModeMarketplace({
    cwd: input?.cwd,
    marketplacePath: input?.marketplacePath,
  })
  const modeRoot =
    input?.modeDir === undefined ? undefined : resolve(input.modeDir)
  const modeRootDigest =
    modeRoot === undefined ? undefined : await hashModePackage(modeRoot)
  const entries = marketplace.entries.filter(entry => {
    const rootMatches =
      modeRoot === undefined ||
      resolve(entry.root).toLowerCase() === modeRoot.toLowerCase()
    const digestMatches =
      modeRootDigest === undefined || entry.packageDigest === modeRootDigest
    const publisherMatches =
      input?.publisherId === undefined ||
      entry.publisherId === input.publisherId
    return (rootMatches || digestMatches) && publisherMatches
  })
  const checked: AwmpModeMarketplaceVerification['checked'] = []

  if (modeRoot !== undefined && entries.length === 0) {
    checked.push({
      modeId: '<unknown>',
      version: '<unknown>',
      publisherId: input?.publisherId ?? '<any>',
      root: modeRoot,
      expectedDigest: '<missing>',
      status: 'missing',
      message: `No marketplace entry found for mode root ${modeRoot}.`,
    })
  }

  for (const entry of entries) {
    try {
      const actualDigest =
        modeRootDigest ??
        (entry.root.startsWith('http://') || entry.root.startsWith('https://')
          ? entry.packageDigest
          : await hashModePackage(entry.root))
      if (entry.status === 'revoked') {
        checked.push({
          modeId: entry.modeId,
          version: entry.version,
          publisherId: entry.publisherId,
          root: modeRoot ?? entry.root,
          expectedDigest: entry.packageDigest,
          actualDigest,
          status: 'revoked',
          message: `Marketplace entry is revoked${entry.revocationReason === undefined ? '' : `: ${entry.revocationReason}`}.`,
        })
        continue
      }
      if (actualDigest !== entry.packageDigest) {
        checked.push({
          modeId: entry.modeId,
          version: entry.version,
          publisherId: entry.publisherId,
          root: modeRoot ?? entry.root,
          expectedDigest: entry.packageDigest,
          actualDigest,
          status: 'digest_mismatch',
          message: 'Mode package digest differs from marketplace digest.',
        })
        continue
      }

      if (entry.signature !== undefined) {
        const verified = verifyModeSignatureRecord(entry.signature, actualDigest)
        checked.push({
          modeId: entry.modeId,
          version: entry.version,
          publisherId: entry.publisherId,
          root: modeRoot ?? entry.root,
          expectedDigest: entry.packageDigest,
          actualDigest,
          status: verified ? 'active' : 'invalid_signature',
          message: verified
            ? 'Marketplace entry is active and backed by its inline public signature.'
            : 'Marketplace entry inline signature could not be verified.',
        })
        continue
      }

      const signature = await verifyModeSignature({
        cwd: input?.cwd,
        trustPath: input?.trustPath,
        modeDir: modeRoot ?? entry.root,
        publisherId: entry.publisherId,
      })
      if (signature.ok) {
        checked.push({
          modeId: entry.modeId,
          version: entry.version,
          publisherId: entry.publisherId,
          root: modeRoot ?? entry.root,
          expectedDigest: entry.packageDigest,
          actualDigest,
          status: 'active',
          message: 'Marketplace entry is active and backed by a valid signature.',
        })
        continue
      }
      const signatureStatus = signature.checked[0]?.status
      checked.push({
        modeId: entry.modeId,
        version: entry.version,
        publisherId: entry.publisherId,
        root: modeRoot ?? entry.root,
        expectedDigest: entry.packageDigest,
        actualDigest,
        status:
          signatureStatus === 'missing'
            ? 'missing_signature'
            : signatureStatus === 'invalid_mode'
              ? 'invalid_mode'
              : 'invalid_signature',
        message:
          signature.checked[0]?.message ??
          'Marketplace entry does not have a valid signature.',
      })
    } catch (error) {
      checked.push({
        modeId: entry.modeId,
        version: entry.version,
        publisherId: entry.publisherId,
        root: entry.root,
        expectedDigest: entry.packageDigest,
        status: 'invalid_mode',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    awmp: '0.1',
    kind: 'ModeMarketplaceVerification',
    generatedAt: new Date().toISOString(),
    marketplacePath: marketplace.marketplacePath,
    ok:
      checked.length > 0 &&
      checked.every(item => item.status === 'active'),
    checked,
  }
}

export function formatModeMarketplace(marketplace: AwmpModeMarketplace): string {
  if (marketplace.entries.length === 0) {
    return [
      'AWMP mode marketplace',
      `Path: ${marketplace.marketplacePath}`,
      '',
      'No marketplace entries.',
    ].join('\n')
  }

  return [
    'AWMP mode marketplace',
    `Path: ${marketplace.marketplacePath}`,
    `Entries: ${marketplace.entries.length}`,
    '',
    ...marketplace.entries.map(entry =>
      [
        `- ${entry.modeId}@${entry.version} (${entry.name})`,
        `  publisher: ${entry.publisherId}`,
        `  status: ${entry.status}`,
        `  root: ${entry.root}`,
        `  digest: ${entry.packageDigest}`,
        entry.bundleUri === undefined ? undefined : `  bundle: ${entry.bundleUri}`,
        entry.bundleDigest === undefined ? undefined : `  bundle digest: ${entry.bundleDigest}`,
        entry.signatureId === undefined ? undefined : `  signature: ${entry.signatureId}`,
        entry.sourceId === undefined ? undefined : `  source: ${entry.sourceId}`,
        entry.revocationReason === undefined
          ? undefined
          : `  revoked: ${entry.revocationReason}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
}

export function formatModeMarketplaceVerification(
  verification: AwmpModeMarketplaceVerification,
): string {
  return [
    `AWMP mode marketplace verification: ${verification.ok ? 'passed' : 'failed'}`,
    `Path: ${verification.marketplacePath}`,
    `Checked: ${verification.checked.length}`,
    '',
    ...verification.checked.map(item =>
      [
        `- ${item.modeId}@${item.version}: ${item.status}`,
        `  publisher: ${item.publisherId}`,
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

export function formatModeMarketplaceSyncResult(
  result: AwmpModeMarketplaceSyncResult,
): string {
  return [
    'AWMP mode marketplace sync',
    `Path: ${result.marketplacePath}`,
    `Source: ${result.source}`,
    `Source id: ${result.sourceId}`,
    `Added: ${result.added}`,
    `Updated: ${result.updated}`,
    `Revoked: ${result.revoked}`,
    `Unchanged: ${result.unchanged}`,
    `Entries: ${result.marketplace.entries.length}`,
  ].join('\n')
}

export function formatModeMarketplaceInstallResult(
  result: AwmpModeMarketplaceInstallResult,
): string {
  return [
    `${result.install.replaced ? 'Replaced' : 'Installed'} AWMP marketplace mode ${result.entry.modeId}@${result.entry.version}`,
    `Publisher: ${result.entry.publisherId}`,
    `Marketplace: ${result.marketplacePath}`,
    `Bundle: ${result.install.bundlePath}`,
    `Bundle digest: ${result.install.bundleDigest}`,
    `Installed root: ${result.install.installedRoot}`,
    `Package digest: ${result.install.packageDigest}`,
  ].join('\n')
}

function findInstallableMarketplaceEntry(
  entries: AwmpModeMarketplaceEntry[],
  input: {
    modeId: string
    version?: string
    publisherId?: string
  },
): AwmpModeMarketplaceEntry {
  const matches = entries.filter(
    entry =>
      entry.modeId === input.modeId &&
      (input.version === undefined || entry.version === input.version) &&
      (input.publisherId === undefined || entry.publisherId === input.publisherId),
  )
  if (matches.length === 0) {
    throw new Error(
      `No marketplace entry found for ${input.modeId}${input.version === undefined ? '' : `@${input.version}`}${input.publisherId === undefined ? '' : ` by ${input.publisherId}`}.`,
    )
  }
  const active = matches.filter(entry => entry.status === 'active')
  if (active.length === 1) return active[0]!
  if (active.length > 1) {
    throw new Error(
      `Multiple active marketplace entries match ${input.modeId}. Specify --version and --publisher.`,
    )
  }
  if (matches.length === 1) return matches[0]!
  throw new Error(
    `Multiple revoked marketplace entries match ${input.modeId}. Specify --version and --publisher.`,
  )
}

async function findMarketplaceSignature(input: {
  cwd?: string
  trustPath?: string
  root: string
  publisherId: string
  packageDigest: string
}): Promise<AwmpModeSignature | undefined> {
  const trust = await loadModeTrust({
    cwd: input.cwd,
    trustPath: input.trustPath,
  })
  return trust.signatures.find(
    signature =>
      resolve(signature.root).toLowerCase() ===
        resolve(input.root).toLowerCase() &&
      signature.publisherId === input.publisherId &&
      signature.packageDigest === input.packageDigest,
  )
}

async function loadMarketplaceFeed(
  source: string,
  sourceId?: string,
): Promise<AwmpModeMarketplaceFeed> {
  const parsed = JSON.parse(await readMarketplaceSource(source)) as
    | Partial<AwmpModeMarketplace>
    | Partial<AwmpModeMarketplaceFeed>
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`Marketplace source ${source} does not contain entries.`)
  }
  return {
    awmp: '0.1',
    kind: 'ModeMarketplaceFeed',
    generatedAt: parsed.generatedAt ?? new Date().toISOString(),
    sourceId:
      sourceId ??
      ('sourceId' in parsed && typeof parsed.sourceId === 'string'
        ? parsed.sourceId
        : source),
    entries: parsed.entries.map(entry =>
      normalizeMarketplaceEntry(entry as AwmpModeMarketplaceEntry),
    ),
  }
}

async function readMarketplaceSource(source: string): Promise<string> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(
        `Marketplace source fetch failed: HTTP ${response.status} ${response.statusText}`,
      )
    }
    return response.text()
  }
  return readFile(resolve(source), 'utf8')
}

function normalizeMarketplaceEntry(
  entry: AwmpModeMarketplaceEntry,
): AwmpModeMarketplaceEntry {
  return {
    ...entry,
    awmp: '0.1',
    kind: 'ModeMarketplaceEntry',
    source: entry.source ?? 'remote',
    status: entry.status === 'revoked' ? 'revoked' : 'active',
  }
}

function marketplaceEntriesEqual(
  left: AwmpModeMarketplaceEntry,
  right: AwmpModeMarketplaceEntry,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function writeModeMarketplace(
  marketplace: AwmpModeMarketplace,
): Promise<void> {
  await mkdir(dirname(marketplace.marketplacePath), { recursive: true })
  await writeFile(
    marketplace.marketplacePath,
    `${JSON.stringify(marketplace, null, 2)}\n`,
    'utf8',
  )
}

function emptyMarketplace(marketplacePath: string): AwmpModeMarketplace {
  return {
    awmp: '0.1',
    kind: 'ModeMarketplace',
    generatedAt: new Date().toISOString(),
    marketplacePath,
    entries: [],
  }
}

function sortMarketplaceEntries(
  left: AwmpModeMarketplaceEntry,
  right: AwmpModeMarketplaceEntry,
): number {
  return (
    left.modeId.localeCompare(right.modeId) ||
    left.version.localeCompare(right.version) ||
    left.publisherId.localeCompare(right.publisherId)
  )
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
