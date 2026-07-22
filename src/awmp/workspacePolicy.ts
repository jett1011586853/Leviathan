import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { AwmpTaskSchema } from './schemas.js'
import {
  discoverModePackages,
  findModeById,
  searchModes,
} from './modeRegistry.js'
import { verifyModeLock } from './modeLock.js'
import { verifyModeMarketplace } from './modeMarketplace.js'
import { verifyModeSignature } from './modeTrust.js'
import { getAwmpStateRoot, resolveModeRoots } from './paths.js'
import type { AwmpModePackage, AwmpTask } from './types.js'

export type AwmpWorkspacePolicy = {
  awmp: '0.1'
  kind: 'WorkspacePolicy'
  generatedAt: string
  policyPath: string
  requireModeLock: boolean
  requireModeSignature: boolean
  requireMarketplaceApproval: boolean
  modeLockPath?: string
  modeTrustPath?: string
  modeMarketplacePath?: string
  trustedPublisherIds: string[]
  allowedModeIds: string[]
  deniedModeIds: string[]
  maxModesPerTask?: number
  notes: string[]
}

export type AwmpWorkspacePolicyDecision = {
  scope: 'workspace' | 'task' | 'mode' | 'lock' | 'signature' | 'marketplace'
  status:
    | 'allowed'
    | 'denied'
    | 'missing_lock'
    | 'mismatched_lock'
    | 'invalid_lock'
    | 'missing_signature'
    | 'digest_mismatch'
    | 'invalid_signature'
    | 'untrusted_signature'
    | 'missing_marketplace_entry'
    | 'revoked_marketplace_entry'
    | 'mismatched_marketplace_digest'
    | 'invalid_marketplace_signature'
    | 'untrusted_marketplace_publisher'
  severity: 'info' | 'blocking'
  modeId?: string
  modeVersion?: string
  publisherId?: string
  root?: string
  message: string
}

export type AwmpWorkspacePolicyCheck = {
  awmp: '0.1'
  kind: 'WorkspacePolicyCheck'
  generatedAt: string
  policyPath: string
  ok: boolean
  policy: AwmpWorkspacePolicy
  selectedModeIds: string[]
  decisions: AwmpWorkspacePolicyDecision[]
}

const WORKSPACE_POLICY_FILE = 'workspace_policy.json'

export function getDefaultWorkspacePolicyPath(cwd = process.cwd()): string {
  return join(getAwmpStateRoot(cwd), 'control_plane', WORKSPACE_POLICY_FILE)
}

export async function loadWorkspacePolicy(input?: {
  cwd?: string
  policyPath?: string
}): Promise<AwmpWorkspacePolicy> {
  const policyPath = resolve(
    input?.policyPath ?? getDefaultWorkspacePolicyPath(input?.cwd),
  )
  try {
    return normalizePolicy(
      JSON.parse(await readFile(policyPath, 'utf8')) as Partial<AwmpWorkspacePolicy>,
      policyPath,
    )
  } catch {
    return emptyWorkspacePolicy(policyPath)
  }
}

export async function updateWorkspacePolicy(input: {
  cwd?: string
  policyPath?: string
  requireModeLock?: boolean
  requireModeSignature?: boolean
  requireMarketplaceApproval?: boolean
  modeLockPath?: string
  modeTrustPath?: string
  modeMarketplacePath?: string
  trustedPublisherIds?: string[]
  allowedModeIds?: string[]
  deniedModeIds?: string[]
  maxModesPerTask?: number | null
  notes?: string[]
  clearAllowedModeIds?: boolean
  clearDeniedModeIds?: boolean
  clearTrustedPublisherIds?: boolean
}): Promise<AwmpWorkspacePolicy> {
  const current = await loadWorkspacePolicy({
    cwd: input.cwd,
    policyPath: input.policyPath,
  })
  const policy: AwmpWorkspacePolicy = {
    ...current,
    generatedAt: new Date().toISOString(),
    requireModeLock: input.requireModeLock ?? current.requireModeLock,
    requireModeSignature:
      input.requireModeSignature ?? current.requireModeSignature,
    requireMarketplaceApproval:
      input.requireMarketplaceApproval ?? current.requireMarketplaceApproval,
    modeLockPath: input.modeLockPath ?? current.modeLockPath,
    modeTrustPath: input.modeTrustPath ?? current.modeTrustPath,
    modeMarketplacePath:
      input.modeMarketplacePath ?? current.modeMarketplacePath,
    trustedPublisherIds: uniqueStrings([
      ...(input.clearTrustedPublisherIds ? [] : current.trustedPublisherIds),
      ...(input.trustedPublisherIds ?? []),
    ]),
    allowedModeIds: uniqueStrings([
      ...(input.clearAllowedModeIds ? [] : current.allowedModeIds),
      ...(input.allowedModeIds ?? []),
    ]),
    deniedModeIds: uniqueStrings([
      ...(input.clearDeniedModeIds ? [] : current.deniedModeIds),
      ...(input.deniedModeIds ?? []),
    ]),
    notes: uniqueStrings([...(current.notes ?? []), ...(input.notes ?? [])]),
  }

  if (input.maxModesPerTask === null) {
    delete policy.maxModesPerTask
  } else if (input.maxModesPerTask !== undefined) {
    policy.maxModesPerTask = input.maxModesPerTask
  }

  await writeWorkspacePolicy(policy)
  return policy
}

export async function checkWorkspacePolicy(input: {
  cwd?: string
  policyPath?: string
  selectedModes: AwmpModePackage[]
}): Promise<AwmpWorkspacePolicyCheck> {
  const policy = await loadWorkspacePolicy({
    cwd: input.cwd,
    policyPath: input.policyPath,
  })
  const decisions: AwmpWorkspacePolicyDecision[] = []
  const selectedModeIds = input.selectedModes.map(modePackage => modePackage.mode.id)

  if (policy.maxModesPerTask !== undefined) {
    decisions.push(
      selectedModeIds.length > policy.maxModesPerTask
        ? {
            scope: 'task',
            status: 'denied',
            severity: 'blocking',
            message: `Task selects ${selectedModeIds.length} mode(s), exceeding maxModesPerTask=${policy.maxModesPerTask}.`,
          }
        : {
            scope: 'task',
            status: 'allowed',
            severity: 'info',
            message: `Task selects ${selectedModeIds.length} mode(s), within maxModesPerTask=${policy.maxModesPerTask}.`,
          },
    )
  }

  for (const modePackage of input.selectedModes) {
    const denied = policy.deniedModeIds.includes(modePackage.mode.id)
    const outsideAllowList =
      policy.allowedModeIds.length > 0 &&
      !policy.allowedModeIds.includes(modePackage.mode.id)

    if (denied || outsideAllowList) {
      decisions.push({
        scope: 'mode',
        status: 'denied',
        severity: 'blocking',
        modeId: modePackage.mode.id,
        modeVersion: modePackage.mode.version,
        root: modePackage.root,
        message: denied
          ? `Mode ${modePackage.mode.id} is denied by workspace policy.`
          : `Mode ${modePackage.mode.id} is not in workspace policy allowedModeIds.`,
      })
      continue
    }

    decisions.push({
      scope: 'mode',
      status: 'allowed',
      severity: 'info',
      modeId: modePackage.mode.id,
      modeVersion: modePackage.mode.version,
      root: modePackage.root,
      message: `Mode ${modePackage.mode.id} is allowed by workspace policy.`,
    })
  }

  if (policy.requireModeLock) {
    for (const modePackage of input.selectedModes) {
      const verification = await verifyModeLock({
        cwd: input.cwd,
        lockPath: policy.modeLockPath,
        modeDir: modePackage.root,
      })
      const lockResult = verification.checked[0]
      if (verification.ok) {
        decisions.push({
          scope: 'lock',
          status: 'allowed',
          severity: 'info',
          modeId: modePackage.mode.id,
          modeVersion: modePackage.mode.version,
          root: modePackage.root,
          message: `Mode ${modePackage.mode.id}@${modePackage.mode.version} matches mode lock digest.`,
        })
        continue
      }

      const status =
        lockResult?.status === 'missing'
          ? 'missing_lock'
          : lockResult?.status === 'mismatched'
            ? 'mismatched_lock'
            : 'invalid_lock'
      decisions.push({
        scope: 'lock',
        status,
        severity: 'blocking',
        modeId: modePackage.mode.id,
        modeVersion: modePackage.mode.version,
        root: modePackage.root,
        message:
          lockResult?.message ??
          `Mode ${modePackage.mode.id}@${modePackage.mode.version} failed mode lock verification.`,
      })
    }
  } else {
    decisions.push({
      scope: 'lock',
      status: 'allowed',
      severity: 'info',
      message: 'Mode lock verification is not required by workspace policy.',
    })
  }

  if (policy.requireModeSignature) {
    for (const modePackage of input.selectedModes) {
      const verification = await verifyModeSignature({
        cwd: input.cwd,
        trustPath: policy.modeTrustPath,
        modeDir: modePackage.root,
      })
      const matched = verification.checked.find(
        item =>
          item.status === 'matched' &&
          (policy.trustedPublisherIds.length === 0 ||
            policy.trustedPublisherIds.includes(item.publisherId)),
      )
      if (matched !== undefined) {
        decisions.push({
          scope: 'signature',
          status: 'allowed',
          severity: 'info',
          modeId: modePackage.mode.id,
          modeVersion: modePackage.mode.version,
          publisherId: matched.publisherId,
          root: modePackage.root,
          message: `Mode ${modePackage.mode.id}@${modePackage.mode.version} has a valid trusted signature from ${matched.publisherId}.`,
        })
        continue
      }

      const best = verification.checked[0]
      const status =
        best?.status === 'missing'
          ? 'missing_signature'
          : best?.status === 'digest_mismatch'
            ? 'digest_mismatch'
            : best?.status === 'invalid_signature' ||
                best?.status === 'invalid_mode'
              ? 'invalid_signature'
              : 'untrusted_signature'
      decisions.push({
        scope: 'signature',
        status,
        severity: 'blocking',
        modeId: modePackage.mode.id,
        modeVersion: modePackage.mode.version,
        publisherId: best?.publisherId,
        root: modePackage.root,
        message:
          best?.status === 'matched'
            ? `Mode ${modePackage.mode.id}@${modePackage.mode.version} is signed by ${best.publisherId}, but that publisher is not trusted by workspace policy.`
            : best?.message ??
              `Mode ${modePackage.mode.id}@${modePackage.mode.version} failed signature verification.`,
      })
    }
  } else {
    decisions.push({
      scope: 'signature',
      status: 'allowed',
      severity: 'info',
      message: 'Mode signature verification is not required by workspace policy.',
    })
  }

  if (policy.requireMarketplaceApproval) {
    for (const modePackage of input.selectedModes) {
      const verification = await verifyModeMarketplace({
        cwd: input.cwd,
        marketplacePath: policy.modeMarketplacePath,
        trustPath: policy.modeTrustPath,
        modeDir: modePackage.root,
      })
      const matched = verification.checked.find(
        item =>
          item.status === 'active' &&
          (policy.trustedPublisherIds.length === 0 ||
            policy.trustedPublisherIds.includes(item.publisherId)),
      )
      if (matched !== undefined) {
        decisions.push({
          scope: 'marketplace',
          status: 'allowed',
          severity: 'info',
          modeId: modePackage.mode.id,
          modeVersion: modePackage.mode.version,
          publisherId: matched.publisherId,
          root: modePackage.root,
          message: `Mode ${modePackage.mode.id}@${modePackage.mode.version} is active in marketplace under publisher ${matched.publisherId}.`,
        })
        continue
      }

      const best = verification.checked[0]
      const status =
        best?.status === 'missing'
          ? 'missing_marketplace_entry'
          : best?.status === 'revoked'
            ? 'revoked_marketplace_entry'
            : best?.status === 'digest_mismatch'
              ? 'mismatched_marketplace_digest'
              : best?.status === 'active'
                ? 'untrusted_marketplace_publisher'
                : 'invalid_marketplace_signature'
      decisions.push({
        scope: 'marketplace',
        status,
        severity: 'blocking',
        modeId: modePackage.mode.id,
        modeVersion: modePackage.mode.version,
        publisherId: best?.publisherId,
        root: modePackage.root,
        message:
          best?.status === 'active'
            ? `Mode ${modePackage.mode.id}@${modePackage.mode.version} is active in marketplace under ${best.publisherId}, but that publisher is not trusted by workspace policy.`
            : best?.message ??
              `Mode ${modePackage.mode.id}@${modePackage.mode.version} failed marketplace verification.`,
      })
    }
  } else {
    decisions.push({
      scope: 'marketplace',
      status: 'allowed',
      severity: 'info',
      message: 'Marketplace approval is not required by workspace policy.',
    })
  }

  return {
    awmp: '0.1',
    kind: 'WorkspacePolicyCheck',
    generatedAt: new Date().toISOString(),
    policyPath: policy.policyPath,
    ok: decisions.every(decision => decision.severity !== 'blocking'),
    policy,
    selectedModeIds,
    decisions,
  }
}

export async function checkWorkspacePolicyForTaskFile(input: {
  taskPath: string
  cwd?: string
  modeRoots?: string[]
  policyPath?: string
}): Promise<AwmpWorkspacePolicyCheck> {
  const absoluteTaskPath = resolve(input.taskPath)
  const task = AwmpTaskSchema.parse(
    JSON.parse(await readFile(absoluteTaskPath, 'utf8')),
  )
  return checkWorkspacePolicyForTask({
    task,
    cwd: input.cwd,
    modeRoots: input.modeRoots,
    policyPath: input.policyPath,
    taskPath: absoluteTaskPath,
  })
}

export async function checkWorkspacePolicyForTask(input: {
  task: AwmpTask
  cwd?: string
  modeRoots?: string[]
  policyPath?: string
  taskPath?: string
}): Promise<AwmpWorkspacePolicyCheck> {
  const modeRoots = resolveModeRoots({
    cwd: input.cwd,
    explicitModeRoots: input.modeRoots,
    taskPath: input.taskPath,
  })
  const discoveredModes = await discoverModePackages(modeRoots)
  return checkWorkspacePolicy({
    cwd: input.cwd,
    policyPath: input.policyPath,
    selectedModes: selectModesForTask(input.task, discoveredModes),
  })
}

export function assertWorkspacePolicyAllowed(
  check: AwmpWorkspacePolicyCheck,
): void {
  if (check.ok) return
  throw new Error(
    `AWMP workspace policy blocked task: ${check.decisions
      .filter(decision => decision.severity === 'blocking')
      .map(decision => decision.message)
      .join('; ')}`,
  )
}

export function formatWorkspacePolicy(policy: AwmpWorkspacePolicy): string {
  return [
    'AWMP workspace policy',
    `Path: ${policy.policyPath}`,
    `Require mode lock: ${policy.requireModeLock}`,
    `Require mode signature: ${policy.requireModeSignature}`,
    `Require marketplace approval: ${policy.requireMarketplaceApproval}`,
    policy.modeLockPath === undefined ? '' : `Mode lock: ${policy.modeLockPath}`,
    policy.modeTrustPath === undefined
      ? ''
      : `Mode trust: ${policy.modeTrustPath}`,
    policy.modeMarketplacePath === undefined
      ? ''
      : `Mode marketplace: ${policy.modeMarketplacePath}`,
    `Trusted publishers: ${policy.trustedPublisherIds.join(', ') || 'any signed publisher'}`,
    policy.maxModesPerTask === undefined
      ? 'Max modes per task: unlimited'
      : `Max modes per task: ${policy.maxModesPerTask}`,
    `Allowed modes: ${policy.allowedModeIds.join(', ') || 'any'}`,
    `Denied modes: ${policy.deniedModeIds.join(', ') || 'none'}`,
    policy.notes.length === 0
      ? ''
      : ['Notes:', ...policy.notes.map(note => `- ${note}`)].join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatWorkspacePolicyCheck(
  check: AwmpWorkspacePolicyCheck,
): string {
  return [
    `AWMP workspace policy check: ${check.ok ? 'passed' : 'failed'}`,
    `Path: ${check.policyPath}`,
    `Selected modes: ${check.selectedModeIds.join(', ') || 'none'}`,
    '',
    ...check.decisions.map(decision =>
      [
        `- ${decision.scope}: ${decision.status}`,
        decision.modeId === undefined
          ? undefined
          : `  mode: ${decision.modeId}@${decision.modeVersion ?? 'unknown'}`,
        decision.root === undefined ? undefined : `  root: ${decision.root}`,
        `  ${decision.message}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
}

async function writeWorkspacePolicy(policy: AwmpWorkspacePolicy): Promise<void> {
  await mkdir(dirname(policy.policyPath), { recursive: true })
  await writeFile(policy.policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
}

function emptyWorkspacePolicy(policyPath: string): AwmpWorkspacePolicy {
  return {
    awmp: '0.1',
    kind: 'WorkspacePolicy',
    generatedAt: new Date().toISOString(),
    policyPath,
    requireModeLock: false,
    requireModeSignature: false,
    requireMarketplaceApproval: false,
    allowedModeIds: [],
    deniedModeIds: [],
    trustedPublisherIds: [],
    notes: [],
  }
}

function normalizePolicy(
  policy: Partial<AwmpWorkspacePolicy>,
  policyPath: string,
): AwmpWorkspacePolicy {
  const normalized: AwmpWorkspacePolicy = {
    awmp: '0.1',
    kind: 'WorkspacePolicy',
    generatedAt: policy.generatedAt ?? new Date().toISOString(),
    policyPath,
    requireModeLock: policy.requireModeLock === true,
    requireModeSignature: policy.requireModeSignature === true,
    requireMarketplaceApproval: policy.requireMarketplaceApproval === true,
    modeLockPath: policy.modeLockPath,
    modeTrustPath: policy.modeTrustPath,
    modeMarketplacePath: policy.modeMarketplacePath,
    trustedPublisherIds: uniqueStrings(
      readStringArray(policy.trustedPublisherIds),
    ),
    allowedModeIds: uniqueStrings(readStringArray(policy.allowedModeIds)),
    deniedModeIds: uniqueStrings(readStringArray(policy.deniedModeIds)),
    notes: uniqueStrings(readStringArray(policy.notes)),
  }
  if (
    typeof policy.maxModesPerTask === 'number' &&
    Number.isInteger(policy.maxModesPerTask) &&
    policy.maxModesPerTask > 0
  ) {
    normalized.maxModesPerTask = policy.maxModesPerTask
  }
  return normalized
}

function selectModesForTask(
  task: AwmpTask,
  discoveredModes: AwmpModePackage[],
): AwmpModePackage[] {
  const selected: AwmpModePackage[] = []
  const seen = new Set<string>()

  for (const modeId of task.modeIds) {
    const modePackage = findModeById(discoveredModes, modeId)
    if (modePackage === undefined || seen.has(modePackage.mode.id)) continue
    seen.add(modePackage.mode.id)
    selected.push(modePackage)
  }

  if (selected.length > 0) return selected

  for (const hit of searchModes(task.objective, discoveredModes)) {
    if (seen.has(hit.modePackage.mode.id)) continue
    seen.add(hit.modePackage.mode.id)
    selected.push(hit.modePackage)
  }

  return selected
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  )
}
