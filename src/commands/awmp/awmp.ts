import { join, resolve } from 'path'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalCommandResult } from '../../types/command.js'
import {
  decideApprovalRequest,
  formatApprovalList,
  listApprovalRequests,
} from '../../awmp/approvalStore.js'
import {
  formatArtifactReviewList,
  listArtifactReviews,
  recordArtifactReview,
  type AwmpArtifactReviewStatus,
} from '../../awmp/artifactReviewStore.js'
import {
  evaluateAwmpRuns,
  inspectAwmpRun,
} from '../../awmp/evalReporter.js'
import {
  formatModeLintReport,
  lintModePackage,
  scaffoldModePackage,
} from '../../awmp/modeAuthoring.js'
import {
  buildModeCatalogFromRoots,
  formatModeCatalog,
  loadModeCatalog,
  publishModeToCatalog,
} from '../../awmp/modeCatalog.js'
import {
  formatModeMarketplace,
  formatModeMarketplaceInstallResult,
  formatModeMarketplaceSyncResult,
  formatModeMarketplaceVerification,
  installMarketplaceMode,
  loadModeMarketplace,
  publishModeToMarketplace,
  revokeMarketplaceMode,
  syncModeMarketplace,
  verifyModeMarketplace,
} from '../../awmp/modeMarketplace.js'
import {
  exportModeBundle,
  formatModeBundleExport,
  formatModeBundleInstall,
  installModeBundle,
} from '../../awmp/modeBundle.js'
import {
  formatModeEvalReport,
  runModeEvals,
} from '../../awmp/modeEval.js'
import { installModePackage } from '../../awmp/modeInstaller.js'
import {
  formatModeLock,
  formatModeLockVerification,
  loadModeLock,
  lockModePackage,
  verifyModeLock,
} from '../../awmp/modeLock.js'
import {
  formatModeSignatureVerification,
  formatModeTrust,
  generateModeTrustKeyPair,
  loadModeTrust,
  signModePackage,
  verifyModeSignature,
} from '../../awmp/modeTrust.js'
import { discoverModePackages, summarizeModes } from '../../awmp/modeRegistry.js'
import { getAwmpStateRoot, resolveModeRoots } from '../../awmp/paths.js'
import { routeAwmpRequest, runAwmpTaskFile } from '../../awmp/runtime.js'
import {
  retryAwmpSchedulerStep,
  runAwmpScheduler,
  runAwmpSchedulerStep,
} from '../../awmp/scheduler.js'
import { callRegisteredTool } from '../../awmp/toolBroker.js'
import {
  checkWorkspacePolicyForTaskFile,
  formatWorkspacePolicy,
  formatWorkspacePolicyCheck,
  loadWorkspacePolicy,
  updateWorkspacePolicy,
} from '../../awmp/workspacePolicy.js'
import { getCwd } from '../../utils/cwd.js'

const USAGE = [
  'Usage:',
  '  /awmp status',
  '  /awmp init <modeDir> --id <id> --name <name> --description <text> [--intent <text>] [--artifact <type>] [--force]',
  '  /awmp lint <modeDir>',
  '  /awmp modes [--modes <modeRoot>]',
  '  /awmp catalog [--modes <modeRoot>] [--catalog <catalogPath>] [--write]',
  '  /awmp publish-mode <modeDir> [--catalog <catalogPath>] [--force]',
  '  /awmp mode-lock [--lock <lockPath>]',
  '  /awmp lock-mode <modeDir> [--lock <lockPath>] [--force]',
  '  /awmp verify-lock [modeDir] [--lock <lockPath>]',
  '  /awmp trust-keygen --public-key <path> --private-key <path> [--force]',
  '  /awmp mode-trust [--trust <trustPath>]',
  '  /awmp sign-mode <modeDir> --publisher <id> --private-key <path> [--trust <trustPath>] [--force]',
  '  /awmp verify-signature [modeDir] [--trust <trustPath>] [--publisher <id>] [--public-key <path>]',
  '  /awmp marketplace [--marketplace <marketplacePath>]',
  '  /awmp marketplace-publish <modeDir> --publisher <id> [--marketplace <marketplacePath>] [--trust <trustPath>] [--private-key <path>] [--bundle <bundlePath>] [--force]',
  '  /awmp marketplace-revoke <modeId> --version <version> --publisher <id> --reason <text> [--by <name>] [--marketplace <marketplacePath>]',
  '  /awmp marketplace-verify [modeDir] [--marketplace <marketplacePath>] [--trust <trustPath>] [--publisher <id>]',
  '  /awmp marketplace-sync <source-file-or-url> [--marketplace <marketplacePath>] [--source-id <id>] [--force]',
  '  /awmp marketplace-install <modeId> [--version <version>] [--publisher <id>] [--marketplace <marketplacePath>] [--force]',
  '  /awmp policy [--policy <policyPath>]',
  '  /awmp policy-set [--policy <policyPath>] [--require-mode-lock|--no-require-mode-lock] [--require-mode-signature|--no-require-mode-signature] [--require-marketplace|--no-require-marketplace] [--mode-lock <lockPath>] [--mode-trust <trustPath>] [--marketplace <marketplacePath>] [--trusted-publisher <id>] [--allow-mode <modeId>] [--deny-mode <modeId>] [--max-modes <n>] [--clear-allowed] [--clear-denied] [--clear-trusted-publishers]',
  '  /awmp policy-check <task.json> [--modes <modeRoot>] [--policy <policyPath>]',
  '  /awmp eval-mode <modeDir> [--run-scheduler] [--max-steps <n>] [--timeout-ms <ms>] [--execute-validators] [--validator-timeout-ms <ms>] [--apply-review-fixtures] [--report <path>]',
  '  /awmp install <modeDir> [--force]',
  '  /awmp export-bundle <modeDir> [--bundle <bundlePath>] [--force]',
  '  /awmp install-bundle <bundlePath> [--force]',
  '  /awmp route <request> [--modes <modeRoot>]',
  '  /awmp run <task.json> [--modes <modeRoot>] [--execute-validators]',
  '  /awmp approvals <runDir>',
  '  /awmp approve <runDir> <approvalId> [--by <name>] [--note <text>]',
  '  /awmp reject <runDir> <approvalId> [--by <name>] [--note <text>]',
  '  /awmp reviews <runDir>',
  '  /awmp review-artifact <runDir> <artifactIdOrUri> <accepted|accepted_with_changes|rejected|needs_revision> [--by <name>] [--note <text>] [--changes <text>]',
  '  /awmp inspect <runDir>',
  '  /awmp eval [runsRoot]',
  '  /awmp tool-call <runDir> <toolIdOrName> [--approve] [--approval <approvalId>] [--input-json <json>]',
  '  /awmp step-run <runDir> <stepIdOrModeId> [toolIdOrName] [--approve] [--approval <approvalId>] [--input-json <json>] [--execute-validators] [--validator-timeout-ms <ms>]',
  '  /awmp retry-step <runDir> <stepIdOrModeId> [toolIdOrName] [--force] [--approve] [--approval <approvalId>] [--input-json <json>] [--execute-validators] [--validator-timeout-ms <ms>]',
  '  /awmp scheduler-run <runDir> [--max-steps <n>] [--timeout-ms <ms>] [--execute-validators] [--validator-timeout-ms <ms>]',
  '',
  'Notes:',
  '  - If task.json is under examples/tasks, Leviathan infers examples/modes.',
  '  - AWMP v0.1 substrate mounts modes and writes task/capsule/artifact/trace records.',
  '  - It does not execute mode-provided validator scripts by default.',
].join('\n')

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const parsed = parseArgs(args)
  const [command, ...rest] = parsed.positionals

  try {
    if (command === undefined || command === 'status') {
      return text(await statusCommand(parsed.options.modes))
    }

    if (command === 'init') {
      const modeDir = rest.join(' ').trim()
      if (!modeDir) return text(USAGE)
      return text(
        await initCommand({
          modeDir,
          id: parsed.options.id,
          name: parsed.options.name,
          description: parsed.options.description,
          intents: parsed.options.intents,
          artifactTypes: parsed.options.artifactTypes,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'lint') {
      const modeDir = rest.join(' ').trim()
      if (!modeDir) return text(USAGE)
      return text(await lintCommand(modeDir))
    }

    if (command === 'modes') {
      return text(await modesCommand(parsed.options.modes))
    }

    if (command === 'catalog') {
      return text(
        await catalogCommand({
          modeRoot: parsed.options.modes,
          catalogPath: parsed.options.catalogPath,
          write: parsed.options.write,
        }),
      )
    }

    if (command === 'publish-mode') {
      const modeDir = rest.join(' ').trim()
      if (!modeDir) return text(USAGE)
      return text(
        await publishModeCommand({
          modeDir,
          catalogPath: parsed.options.catalogPath,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'mode-lock') {
      return text(await modeLockCommand(parsed.options.lockPath))
    }

    if (command === 'lock-mode') {
      const modeDir = rest.join(' ').trim()
      if (!modeDir) return text(USAGE)
      return text(
        await lockModeCommand({
          modeDir,
          lockPath: parsed.options.lockPath,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'verify-lock') {
      const modeDir = rest.join(' ').trim() || undefined
      return text(
        await verifyLockCommand({
          modeDir,
          lockPath: parsed.options.lockPath,
        }),
      )
    }

    if (command === 'trust-keygen') {
      if (!parsed.options.publicKeyPath || !parsed.options.privateKeyPath) {
        return text(USAGE)
      }
      return text(
        await trustKeygenCommand({
          publicKeyPath: parsed.options.publicKeyPath,
          privateKeyPath: parsed.options.privateKeyPath,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'mode-trust') {
      return text(await modeTrustCommand(parsed.options.trustPath))
    }

    if (command === 'sign-mode') {
      const modeDir = rest.join(' ').trim()
      if (
        !modeDir ||
        !parsed.options.publisherId ||
        !parsed.options.privateKeyPath
      ) {
        return text(USAGE)
      }
      return text(
        await signModeCommand({
          modeDir,
          publisherId: parsed.options.publisherId,
          privateKeyPath: parsed.options.privateKeyPath,
          trustPath: parsed.options.trustPath,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'verify-signature') {
      const modeDir = rest.join(' ').trim() || undefined
      return text(
        await verifySignatureCommand({
          modeDir,
          trustPath: parsed.options.trustPath,
          publisherId: parsed.options.publisherId,
          publicKeyPath: parsed.options.publicKeyPath,
        }),
      )
    }

    if (command === 'marketplace') {
      return text(await marketplaceCommand(parsed.options.marketplacePath))
    }

    if (command === 'marketplace-publish') {
      const modeDir = rest.join(' ').trim()
      if (!modeDir || !parsed.options.publisherId) return text(USAGE)
      return text(
        await marketplacePublishCommand({
          modeDir,
          publisherId: parsed.options.publisherId,
          marketplacePath: parsed.options.marketplacePath,
          trustPath: parsed.options.trustPath,
          privateKeyPath: parsed.options.privateKeyPath,
          bundlePath: parsed.options.bundlePath,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'marketplace-revoke') {
      const modeId = rest.join(' ').trim()
      if (
        !modeId ||
        !parsed.options.version ||
        !parsed.options.publisherId ||
        !parsed.options.reason
      ) {
        return text(USAGE)
      }
      return text(
        await marketplaceRevokeCommand({
          modeId,
          version: parsed.options.version,
          publisherId: parsed.options.publisherId,
          reason: parsed.options.reason,
          revokedBy: parsed.options.by,
          marketplacePath: parsed.options.marketplacePath,
        }),
      )
    }

    if (command === 'marketplace-verify') {
      const modeDir = rest.join(' ').trim() || undefined
      return text(
        await marketplaceVerifyCommand({
          modeDir,
          marketplacePath: parsed.options.marketplacePath,
          trustPath: parsed.options.trustPath,
          publisherId: parsed.options.publisherId,
        }),
      )
    }

    if (command === 'marketplace-sync') {
      const source = rest.join(' ').trim()
      if (!source) return text(USAGE)
      return text(
        await marketplaceSyncCommand({
          source,
          marketplacePath: parsed.options.marketplacePath,
          sourceId: parsed.options.sourceId,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'marketplace-install') {
      const modeId = rest.join(' ').trim()
      if (!modeId) return text(USAGE)
      return text(
        await marketplaceInstallCommand({
          modeId,
          version: parsed.options.version,
          publisherId: parsed.options.publisherId,
          marketplacePath: parsed.options.marketplacePath,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'policy') {
      return text(await policyCommand(parsed.options.policyPath))
    }

    if (command === 'policy-set') {
      return text(
        await policySetCommand({
          policyPath: parsed.options.policyPath,
          requireModeLock: parsed.options.requireModeLock,
          requireModeSignature: parsed.options.requireModeSignature,
          requireMarketplaceApproval:
            parsed.options.requireMarketplaceApproval,
          modeLockPath: parsed.options.modeLockPath,
          modeTrustPath: parsed.options.modeTrustPath,
          modeMarketplacePath: parsed.options.marketplacePath,
          trustedPublisherIds: parsed.options.trustedPublisherIds,
          allowedModeIds: parsed.options.allowedModeIds,
          deniedModeIds: parsed.options.deniedModeIds,
          maxModesPerTask: parsed.options.maxModesPerTask,
          clearAllowedModeIds: parsed.options.clearAllowedModeIds,
          clearDeniedModeIds: parsed.options.clearDeniedModeIds,
          clearTrustedPublisherIds: parsed.options.clearTrustedPublisherIds,
        }),
      )
    }

    if (command === 'policy-check') {
      const taskPath = rest.join(' ').trim()
      if (!taskPath) return text(USAGE)
      return text(
        await policyCheckCommand({
          taskPath,
          modeRoot: parsed.options.modes,
          policyPath: parsed.options.policyPath,
        }),
      )
    }

    if (command === 'eval-mode') {
      const modeDir = rest.join(' ').trim()
      if (!modeDir) return text(USAGE)
      return text(
        await evalModeCommand({
          modeDir,
          executeValidators: parsed.options.executeValidators,
          validatorTimeoutMs: parsed.options.validatorTimeoutMs,
          runScheduler: parsed.options.runScheduler,
          schedulerMaxSteps: parsed.options.maxSteps,
          toolTimeoutMs: parsed.options.timeoutMs,
          applyReviewFixtures: parsed.options.applyReviewFixtures,
          reportPath: parsed.options.reportPath,
        }),
      )
    }

    if (command === 'install') {
      const modeDir = rest.join(' ').trim()
      if (!modeDir) return text(USAGE)
      return text(await installCommand(modeDir, parsed.options.force))
    }

    if (command === 'export-bundle') {
      const modeDir = rest.join(' ').trim()
      if (!modeDir) return text(USAGE)
      return text(
        await exportBundleCommand({
          modeDir,
          bundlePath: parsed.options.bundlePath,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'install-bundle') {
      const bundlePath = rest.join(' ').trim()
      if (!bundlePath) return text(USAGE)
      return text(await installBundleCommand(bundlePath, parsed.options.force))
    }

    if (command === 'route') {
      const request = rest.join(' ').trim()
      if (!request) return text(USAGE)
      return text(await routeCommand(request, parsed.options.modes))
    }

    if (command === 'run') {
      const taskPath = rest.join(' ').trim()
      if (!taskPath) return text(USAGE)
      return text(
        await runCommand(
          taskPath,
          parsed.options.modes,
          parsed.options.executeValidators,
          parsed.options.policyPath,
        ),
      )
    }

    if (command === 'approvals') {
      const runDir = rest.join(' ').trim()
      if (!runDir) return text(USAGE)
      return text(await approvalsCommand(runDir))
    }

    if (command === 'approve' || command === 'reject') {
      const runDir = rest[0]
      const approvalId = rest[1]
      if (!runDir || !approvalId) return text(USAGE)
      return text(
        await decisionCommand({
          runDir,
          approvalId,
          decision: command === 'approve' ? 'approved' : 'rejected',
          decidedBy: parsed.options.by,
          note: parsed.options.note,
        }),
      )
    }

    if (command === 'reviews') {
      const runDir = rest.join(' ').trim()
      if (!runDir) return text(USAGE)
      return text(await reviewsCommand(runDir))
    }

    if (command === 'review-artifact') {
      const runDir = rest[0]
      const artifactRef = rest[1]
      const status = parseReviewStatus(rest[2])
      if (!runDir || !artifactRef || status === undefined) return text(USAGE)
      return text(
        await reviewArtifactCommand({
          runDir,
          artifactRef,
          status,
          reviewedBy: parsed.options.by,
          note: parsed.options.note,
          requestedChanges: parsed.options.changes,
        }),
      )
    }

    if (command === 'inspect') {
      const runDir = rest.join(' ').trim()
      if (!runDir) return text(USAGE)
      return text(await inspectCommand(runDir))
    }

    if (command === 'eval') {
      const runsRoot = rest.join(' ').trim() || undefined
      return text(await evalCommand(runsRoot))
    }

    if (command === 'tool-call') {
      const runDir = rest[0]
      const toolRef = rest.slice(1).join(' ').trim()
      if (!runDir || !toolRef) return text(USAGE)
      return text(
        await toolCallCommand({
          runDir,
          toolRef,
          approved: parsed.options.approve,
          approvalId: parsed.options.approvalId,
          inputJson: parsed.options.inputJson,
        }),
      )
    }

    if (command === 'step-run') {
      const runDir = rest[0]
      const stepRef = rest[1]
      const toolRef = rest.slice(2).join(' ').trim() || undefined
      if (!runDir || !stepRef) return text(USAGE)
      return text(
        await stepRunCommand({
          runDir,
          stepRef,
          toolRef,
          approved: parsed.options.approve,
          approvalId: parsed.options.approvalId,
          inputJson: parsed.options.inputJson,
          executeValidators: parsed.options.executeValidators,
          validatorTimeoutMs: parsed.options.validatorTimeoutMs,
        }),
      )
    }

    if (command === 'retry-step') {
      const runDir = rest[0]
      const stepRef = rest[1]
      const toolRef = rest.slice(2).join(' ').trim() || undefined
      if (!runDir || !stepRef) return text(USAGE)
      return text(
        await retryStepCommand({
          runDir,
          stepRef,
          toolRef,
          approved: parsed.options.approve,
          approvalId: parsed.options.approvalId,
          inputJson: parsed.options.inputJson,
          executeValidators: parsed.options.executeValidators,
          validatorTimeoutMs: parsed.options.validatorTimeoutMs,
          force: parsed.options.force,
        }),
      )
    }

    if (command === 'scheduler-run') {
      const runDir = rest.join(' ').trim()
      if (!runDir) return text(USAGE)
      return text(
        await schedulerRunCommand({
          runDir,
          maxSteps: parsed.options.maxSteps,
          timeoutMs: parsed.options.timeoutMs,
          executeValidators: parsed.options.executeValidators,
          validatorTimeoutMs: parsed.options.validatorTimeoutMs,
        }),
      )
    }

    return text(USAGE)
  } catch (error) {
    return text(
      `AWMP command failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

async function statusCommand(modeRoot?: string): Promise<string> {
  const modeRoots = resolveModeRoots({
    cwd: getCwd(),
    explicitModeRoots: modeRoot === undefined ? [] : [modeRoot],
  })
  const modes = await discoverModePackages(modeRoots)
  return [
    'AWMP v0.1 substrate',
    `State root: ${getAwmpStateRoot(getCwd())}`,
    `Mode roots: ${modeRoots.join(', ') || 'none'}`,
    `Discovered modes: ${modes.length}`,
    '',
    USAGE,
  ].join('\n')
}

async function modesCommand(modeRoot?: string): Promise<string> {
  const modeRoots = resolveModeRoots({
    cwd: getCwd(),
    explicitModeRoots: modeRoot === undefined ? [] : [modeRoot],
  })
  const modes = await discoverModePackages(modeRoots)
  return [
    `AWMP mode roots: ${modeRoots.join(', ') || 'none'}`,
    '',
    summarizeModes(modes),
  ].join('\n')
}

async function catalogCommand(input: {
  modeRoot?: string
  catalogPath?: string
  write: boolean
}): Promise<string> {
  if (input.modeRoot === undefined && !input.write) {
    return formatModeCatalog(
      await loadModeCatalog({
        cwd: getCwd(),
        catalogPath: input.catalogPath,
      }),
    )
  }

  const modeRoots = resolveModeRoots({
    cwd: getCwd(),
    explicitModeRoots: input.modeRoot === undefined ? [] : [input.modeRoot],
  })
  return formatModeCatalog(
    await buildModeCatalogFromRoots({
      modeRoots,
      cwd: getCwd(),
      catalogPath: input.catalogPath,
      write: input.write,
    }),
  )
}

async function publishModeCommand(input: {
  modeDir: string
  catalogPath?: string
  force: boolean
}): Promise<string> {
  const result = await publishModeToCatalog({
    modeDir: resolve(input.modeDir),
    cwd: getCwd(),
    catalogPath: input.catalogPath,
    force: input.force,
  })
  return [
    `${result.replaced ? 'Replaced' : 'Published'} AWMP mode ${result.entry.id}@${result.entry.version}`,
    `Catalog: ${result.catalogPath}`,
    `Digest: ${result.entry.packageDigest}`,
    `Artifacts: ${result.entry.capabilities.artifactTypes.join(', ') || 'none'}`,
    `Tools: local=${result.entry.capabilities.toolKinds.local}, openapi=${result.entry.capabilities.toolKinds.openapi}, mcp=${result.entry.capabilities.toolKinds.mcp}`,
    `Entries: ${result.catalog.entries.length}`,
  ].join('\n')
}

async function modeLockCommand(lockPath?: string): Promise<string> {
  return formatModeLock(
    await loadModeLock({
      cwd: getCwd(),
      lockPath,
    }),
  )
}

async function lockModeCommand(input: {
  modeDir: string
  lockPath?: string
  force: boolean
}): Promise<string> {
  const result = await lockModePackage({
    modeDir: resolve(input.modeDir),
    cwd: getCwd(),
    lockPath: input.lockPath,
    force: input.force,
  })
  return [
    `${result.replaced ? 'Replaced' : 'Locked'} AWMP mode ${result.entry.id}@${result.entry.version}`,
    `Lock: ${result.lockPath}`,
    `Root: ${result.entry.root}`,
    `Digest: ${result.entry.packageDigest}`,
    `Entries: ${result.lock.entries.length}`,
  ].join('\n')
}

async function verifyLockCommand(input: {
  modeDir?: string
  lockPath?: string
}): Promise<string> {
  return formatModeLockVerification(
    await verifyModeLock({
      cwd: getCwd(),
      lockPath: input.lockPath,
      modeDir: input.modeDir,
    }),
  )
}

async function trustKeygenCommand(input: {
  publicKeyPath: string
  privateKeyPath: string
  force: boolean
}): Promise<string> {
  const result = await generateModeTrustKeyPair({
    publicKeyPath: input.publicKeyPath,
    privateKeyPath: input.privateKeyPath,
    force: input.force,
  })
  return [
    'Generated AWMP mode trust keypair',
    `Public key: ${result.publicKeyPath}`,
    `Private key: ${result.privateKeyPath}`,
  ].join('\n')
}

async function modeTrustCommand(trustPath?: string): Promise<string> {
  return formatModeTrust(
    await loadModeTrust({
      cwd: getCwd(),
      trustPath,
    }),
  )
}

async function signModeCommand(input: {
  modeDir: string
  publisherId: string
  privateKeyPath: string
  trustPath?: string
  force: boolean
}): Promise<string> {
  const result = await signModePackage({
    modeDir: resolve(input.modeDir),
    cwd: getCwd(),
    trustPath: input.trustPath,
    publisherId: input.publisherId,
    privateKeyPath: input.privateKeyPath,
    force: input.force,
  })
  return [
    `${result.replaced ? 'Replaced' : 'Signed'} AWMP mode ${result.signature.modeId}@${result.signature.version}`,
    `Publisher: ${result.signature.publisherId}`,
    `Trust: ${result.trustPath}`,
    `Digest: ${result.signature.packageDigest}`,
    `Signatures: ${result.trust.signatures.length}`,
  ].join('\n')
}

async function verifySignatureCommand(input: {
  modeDir?: string
  trustPath?: string
  publisherId?: string
  publicKeyPath?: string
}): Promise<string> {
  return formatModeSignatureVerification(
    await verifyModeSignature({
      cwd: getCwd(),
      trustPath: input.trustPath,
      modeDir: input.modeDir,
      publisherId: input.publisherId,
      publicKeyPath: input.publicKeyPath,
    }),
  )
}

async function marketplaceCommand(marketplacePath?: string): Promise<string> {
  return formatModeMarketplace(
    await loadModeMarketplace({
      cwd: getCwd(),
      marketplacePath,
    }),
  )
}

async function marketplacePublishCommand(input: {
  modeDir: string
  publisherId: string
  marketplacePath?: string
  trustPath?: string
  privateKeyPath?: string
  bundlePath?: string
  force: boolean
}): Promise<string> {
  const result = await publishModeToMarketplace({
    modeDir: resolve(input.modeDir),
    cwd: getCwd(),
    publisherId: input.publisherId,
    marketplacePath: input.marketplacePath,
    trustPath: input.trustPath,
    privateKeyPath: input.privateKeyPath,
    bundlePath: input.bundlePath,
    force: input.force,
  })
  return [
    `${result.replaced ? 'Replaced' : 'Published'} AWMP marketplace mode ${result.entry.modeId}@${result.entry.version}`,
    `Publisher: ${result.entry.publisherId}`,
    `Marketplace: ${result.marketplacePath}`,
    `Digest: ${result.entry.packageDigest}`,
    result.entry.bundleUri === undefined ? 'Bundle: none' : `Bundle: ${result.entry.bundleUri}`,
    result.entry.bundleDigest === undefined
      ? ''
      : `Bundle digest: ${result.entry.bundleDigest}`,
    result.entry.signatureId === undefined
      ? 'Signature: none'
      : `Signature: ${result.entry.signatureId}`,
    `Entries: ${result.marketplace.entries.length}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function marketplaceInstallCommand(input: {
  modeId: string
  version?: string
  publisherId?: string
  marketplacePath?: string
  force: boolean
}): Promise<string> {
  return formatModeMarketplaceInstallResult(
    await installMarketplaceMode({
      cwd: getCwd(),
      modeId: input.modeId,
      version: input.version,
      publisherId: input.publisherId,
      marketplacePath: input.marketplacePath,
      force: input.force,
    }),
  )
}

async function marketplaceRevokeCommand(input: {
  modeId: string
  version: string
  publisherId: string
  reason: string
  revokedBy?: string
  marketplacePath?: string
}): Promise<string> {
  const entry = await revokeMarketplaceMode({
    cwd: getCwd(),
    marketplacePath: input.marketplacePath,
    modeId: input.modeId,
    version: input.version,
    publisherId: input.publisherId,
    reason: input.reason,
    revokedBy: input.revokedBy,
  })
  return [
    `Revoked AWMP marketplace mode ${entry.modeId}@${entry.version}`,
    `Publisher: ${entry.publisherId}`,
    `Reason: ${entry.revocationReason ?? input.reason}`,
    entry.revokedBy === undefined ? '' : `By: ${entry.revokedBy}`,
    entry.revokedAt === undefined ? '' : `At: ${entry.revokedAt}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function marketplaceVerifyCommand(input: {
  modeDir?: string
  marketplacePath?: string
  trustPath?: string
  publisherId?: string
}): Promise<string> {
  return formatModeMarketplaceVerification(
    await verifyModeMarketplace({
      cwd: getCwd(),
      marketplacePath: input.marketplacePath,
      trustPath: input.trustPath,
      modeDir: input.modeDir,
      publisherId: input.publisherId,
    }),
  )
}

async function marketplaceSyncCommand(input: {
  source: string
  marketplacePath?: string
  sourceId?: string
  force: boolean
}): Promise<string> {
  return formatModeMarketplaceSyncResult(
    await syncModeMarketplace({
      cwd: getCwd(),
      source: input.source,
      marketplacePath: input.marketplacePath,
      sourceId: input.sourceId,
      force: input.force,
    }),
  )
}

async function policyCommand(policyPath?: string): Promise<string> {
  return formatWorkspacePolicy(
    await loadWorkspacePolicy({
      cwd: getCwd(),
      policyPath,
    }),
  )
}

async function policySetCommand(input: {
  policyPath?: string
  requireModeLock?: boolean
  requireModeSignature?: boolean
  requireMarketplaceApproval?: boolean
  modeLockPath?: string
  modeTrustPath?: string
  modeMarketplacePath?: string
  trustedPublisherIds: string[]
  allowedModeIds: string[]
  deniedModeIds: string[]
  maxModesPerTask?: number
  clearAllowedModeIds: boolean
  clearDeniedModeIds: boolean
  clearTrustedPublisherIds: boolean
}): Promise<string> {
  const policy = await updateWorkspacePolicy({
    cwd: getCwd(),
    policyPath: input.policyPath,
    requireModeLock: input.requireModeLock,
    requireModeSignature: input.requireModeSignature,
    requireMarketplaceApproval: input.requireMarketplaceApproval,
    modeLockPath: input.modeLockPath,
    modeTrustPath: input.modeTrustPath,
    modeMarketplacePath: input.modeMarketplacePath,
    trustedPublisherIds: input.trustedPublisherIds,
    allowedModeIds: input.allowedModeIds,
    deniedModeIds: input.deniedModeIds,
    maxModesPerTask: input.maxModesPerTask,
    clearAllowedModeIds: input.clearAllowedModeIds,
    clearDeniedModeIds: input.clearDeniedModeIds,
    clearTrustedPublisherIds: input.clearTrustedPublisherIds,
  })
  return formatWorkspacePolicy(policy)
}

async function policyCheckCommand(input: {
  taskPath: string
  modeRoot?: string
  policyPath?: string
}): Promise<string> {
  return formatWorkspacePolicyCheck(
    await checkWorkspacePolicyForTaskFile({
      taskPath: resolve(input.taskPath),
      cwd: getCwd(),
      modeRoots: input.modeRoot === undefined ? [] : [input.modeRoot],
      policyPath: input.policyPath,
    }),
  )
}

async function evalModeCommand(input: {
  modeDir: string
  executeValidators: boolean
  validatorTimeoutMs?: number
  runScheduler: boolean
  schedulerMaxSteps?: number
  toolTimeoutMs?: number
  applyReviewFixtures: boolean
  reportPath?: string
}): Promise<string> {
  return formatModeEvalReport(
    await runModeEvals({
      modeDir: resolve(input.modeDir),
      cwd: getCwd(),
      executeValidators: input.executeValidators,
      validatorTimeoutMs: input.validatorTimeoutMs,
      runScheduler: input.runScheduler,
      schedulerMaxSteps: input.schedulerMaxSteps,
      toolTimeoutMs: input.toolTimeoutMs,
      applyReviewFixtures: input.applyReviewFixtures,
      reportPath: input.reportPath,
    }),
  )
}

async function initCommand(input: {
  modeDir: string
  id?: string
  name?: string
  description?: string
  intents: string[]
  artifactTypes: string[]
  force: boolean
}): Promise<string> {
  if (!input.id || !input.name || !input.description) {
    return USAGE
  }

  const result = await scaffoldModePackage({
    targetDir: resolve(input.modeDir),
    id: input.id,
    name: input.name,
    description: input.description,
    intents: input.intents,
    artifactTypes: input.artifactTypes,
    force: input.force,
  })
  const lint = await lintModePackage(result.root)

  return [
    `Created AWMP mode ${result.modePackage.mode.id}`,
    `Root: ${result.root}`,
    `Files: ${result.createdFiles.length}`,
    '',
    formatModeLintReport(lint),
  ].join('\n')
}

async function lintCommand(modeDir: string): Promise<string> {
  return formatModeLintReport(await lintModePackage(resolve(modeDir)))
}

async function installCommand(modeDir: string, force: boolean): Promise<string> {
  const result = await installModePackage({
    sourceDir: modeDir,
    cwd: getCwd(),
    force,
  })

  return [
    `${result.replaced ? 'Reinstalled' : 'Installed'} AWMP mode ${result.modePackage.mode.id}`,
    `Name: ${result.modePackage.mode.name}`,
    `Version: ${result.modePackage.mode.version}`,
    `Installed root: ${result.installedRoot}`,
  ].join('\n')
}

async function exportBundleCommand(input: {
  modeDir: string
  bundlePath?: string
  force: boolean
}): Promise<string> {
  return formatModeBundleExport(
    await exportModeBundle({
      cwd: getCwd(),
      modeDir: input.modeDir,
      bundlePath: input.bundlePath,
      force: input.force,
    }),
  )
}

async function installBundleCommand(
  bundlePath: string,
  force: boolean,
): Promise<string> {
  return formatModeBundleInstall(
    await installModeBundle({
      cwd: getCwd(),
      bundlePath,
      force,
    }),
  )
}

async function routeCommand(
  request: string,
  modeRoot?: string,
): Promise<string> {
  const routed = await routeAwmpRequest({
    query: request,
    cwd: getCwd(),
    modeRoots: modeRoot === undefined ? [] : [modeRoot],
  })
  const hits = routed.candidates

  if (hits.length === 0) {
    return [
      `Request: ${request}`,
      `Mode roots: ${routed.modeRoots.join(', ') || 'none'}`,
      'No matching AWMP modes found.',
    ].join('\n')
  }

  return [
    `Request: ${request}`,
    `Mode roots: ${routed.modeRoots.join(', ') || 'none'}`,
    '',
    ...hits.map(hit =>
      [
        `- ${hit.modePackage.mode.id} score=${hit.score}`,
        `  ${hit.modePackage.mode.description}`,
        `  reasons: ${hit.reasons.join(', ') || 'n/a'}`,
      ].join('\n'),
    ),
  ].join('\n')
}

async function runCommand(
  taskPath: string,
  modeRoot?: string,
  executeValidators?: boolean,
  policyPath?: string,
): Promise<string> {
  const result = await runAwmpTaskFile(resolve(taskPath), {
    cwd: getCwd(),
    modeRoots: modeRoot === undefined ? [] : [modeRoot],
    executeValidators: executeValidators === true,
    policyPath,
  })

  return [
    result.summary,
    '',
    'Files:',
    `  task: ${result.runDir}\\task.json`,
    `  capsule: ${result.runDir}\\capsule.json`,
    `  artifacts: ${result.runDir}\\artifacts`,
    `  artifact store: ${result.artifactStorePath}`,
    `  context: ${result.contextPath}`,
    `  orchestration: ${result.orchestrationPath}`,
    `  handoff plan: ${result.handoffPlanPath}`,
    `  scheduler: ${result.schedulerPath}`,
    `  trace: ${result.tracePath}`,
  ].join('\n')
}

async function approvalsCommand(runDir: string): Promise<string> {
  return formatApprovalList(await listApprovalRequests(resolve(runDir)))
}

async function decisionCommand(input: {
  runDir: string
  approvalId: string
  decision: 'approved' | 'rejected'
  decidedBy?: string
  note?: string
}): Promise<string> {
  const approval = await decideApprovalRequest({
    runDir: resolve(input.runDir),
    approvalId: input.approvalId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    note: input.note,
  })
  return [
    `AWMP approval ${approval.id}: ${approval.status}`,
    `Tool: ${approval.tool.id} (${approval.tool.name})`,
    `Decision by: ${approval.decidedBy ?? 'unknown'}`,
    approval.note === undefined ? '' : `Note: ${approval.note}`,
    `Path: ${approval.requestPath}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function reviewsCommand(runDir: string): Promise<string> {
  return formatArtifactReviewList(await listArtifactReviews(resolve(runDir)))
}

async function reviewArtifactCommand(input: {
  runDir: string
  artifactRef: string
  status: AwmpArtifactReviewStatus
  reviewedBy?: string
  note?: string
  requestedChanges?: string
}): Promise<string> {
  const review = await recordArtifactReview({
    runDir: resolve(input.runDir),
    artifactRef: input.artifactRef,
    status: input.status,
    reviewedBy: input.reviewedBy,
    note: input.note,
    requestedChanges: input.requestedChanges,
  })
  return [
    `AWMP artifact review ${review.id}: ${review.status}`,
    `Artifact: ${review.artifact.id} (${review.artifact.type})`,
    `Accepted: ${review.accepted}`,
    `Reviewed by: ${review.reviewedBy}`,
    review.note === undefined ? '' : `Note: ${review.note}`,
    review.requestedChanges === undefined
      ? ''
      : `Requested changes: ${review.requestedChanges}`,
    `Path: ${review.reviewPath}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function inspectCommand(runDir: string): Promise<string> {
  const report = await inspectAwmpRun({
    runDir: resolve(runDir),
  })
  return [
    `AWMP run inspection: ${report.task.id}`,
    `Run: ${report.runDir}`,
    report.reportPath === undefined ? '' : `Report: ${report.reportPath}`,
    `Task state: ${report.task.state}`,
    `Scheduler: ${report.scheduler.status} (${report.scheduler.completedSteps}/${report.scheduler.totalSteps} completed)`,
    `Artifacts: ${report.artifacts.total} total, ${report.artifacts.business} business`,
    `Validators: ${report.validations.passed} passed, ${report.validations.failed} failed, ${report.validations.skipped} skipped`,
    `Approvals: ${report.approvals.resolved}/${report.approvals.total} resolved`,
    ...formatMetrics(report.metrics),
    formatEvidenceGaps(report.evidenceGaps),
  ]
    .filter(Boolean)
    .join('\n')
}

async function evalCommand(runsRoot?: string): Promise<string> {
  const root = resolve(runsRoot ?? join(getAwmpStateRoot(getCwd()), 'runs'))
  const report = await evaluateAwmpRuns({
    runsRoot: root,
  })
  return [
    `AWMP eval report: ${report.runCount} run(s)`,
    `Runs root: ${root}`,
    report.reportPath === undefined ? '' : `Report: ${report.reportPath}`,
    ...formatMetrics(report.metrics),
    formatEvidenceGaps(report.evidenceGaps),
  ]
    .filter(Boolean)
    .join('\n')
}

async function toolCallCommand(input: {
  runDir: string
  toolRef: string
  approved: boolean
  approvalId?: string
  inputJson?: string
}): Promise<string> {
  const result = await callRegisteredTool({
    runDir: resolve(input.runDir),
    toolId: input.toolRef,
    toolName: input.toolRef,
    approved: input.approved,
    approvalId: input.approvalId,
    input:
      input.inputJson === undefined ? undefined : JSON.parse(input.inputJson),
  })

  return [
    `AWMP tool call ${result.id}: ${result.status}`,
    `Tool: ${result.tool.id} (${result.tool.name})`,
    `Message: ${result.message}`,
    `Result: ${result.resultPath}`,
    result.approvalRequestId === undefined
      ? ''
      : `Approval: ${result.approvalRequestId}`,
    result.exitCode === undefined ? '' : `Exit code: ${result.exitCode}`,
    result.httpStatus === undefined ? '' : `HTTP status: ${result.httpStatus}`,
    result.stdout === undefined ? '' : `Stdout: ${result.stdout}`,
    result.stderr === undefined ? '' : `Stderr: ${result.stderr}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function stepRunCommand(input: {
  runDir: string
  stepRef: string
  toolRef?: string
  approved: boolean
  approvalId?: string
  inputJson?: string
  executeValidators: boolean
  validatorTimeoutMs?: number
}): Promise<string> {
  const result = await runAwmpSchedulerStep({
    runDir: resolve(input.runDir),
    stepId: input.stepRef,
    modeId: input.stepRef,
    toolId: input.toolRef,
    toolName: input.toolRef,
    approved: input.approved,
    approvalId: input.approvalId,
    toolInput:
      input.inputJson === undefined ? undefined : JSON.parse(input.inputJson),
    executeValidators: input.executeValidators,
    validatorTimeoutMs: input.validatorTimeoutMs,
  })

  return [
    `AWMP scheduler step ${result.step.id}: ${result.status}`,
    `Mode: ${result.step.modeId}`,
    `Message: ${result.message}`,
    `Scheduler: ${result.schedulerPath}`,
    result.contextPath === undefined ? '' : `Context: ${result.contextPath}`,
    `State: ${result.step.state}`,
    `Attempts: ${result.step.attemptCount}`,
    result.step.lastFailureKind === undefined
      ? ''
      : `Failure kind: ${result.step.lastFailureKind}`,
    result.step.retryable === undefined ? '' : `Retryable: ${result.step.retryable}`,
    result.step.retryAfter === undefined
      ? ''
      : `Retry after: ${result.step.retryAfter}`,
    result.step.nextAction === undefined
      ? ''
      : `Next action: ${result.step.nextAction}`,
    result.toolCall === undefined
      ? ''
      : `Tool call: ${result.toolCall.id} (${result.toolCall.status})`,
    result.toolCall?.approvalRequestId === undefined
      ? ''
      : `Approval: ${result.toolCall.approvalRequestId}`,
    result.toolCall?.resultPath === undefined
      ? ''
      : `Result: ${result.toolCall.resultPath}`,
    result.step.registeredArtifactUris === undefined ||
    result.step.registeredArtifactUris.length === 0
      ? ''
      : `Artifacts: ${result.step.registeredArtifactUris.join(', ')}`,
    result.step.validationSummary === undefined
      ? ''
      : `Validators: ${result.step.validationSummary.passed} passed, ${result.step.validationSummary.failed} failed, ${result.step.validationSummary.skipped} skipped`,
    result.toolCall?.stdout === undefined ? '' : `Stdout: ${result.toolCall.stdout}`,
    result.toolCall?.stderr === undefined ? '' : `Stderr: ${result.toolCall.stderr}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function retryStepCommand(input: {
  runDir: string
  stepRef: string
  toolRef?: string
  approved: boolean
  approvalId?: string
  inputJson?: string
  executeValidators: boolean
  validatorTimeoutMs?: number
  force: boolean
}): Promise<string> {
  const result = await retryAwmpSchedulerStep({
    runDir: resolve(input.runDir),
    stepId: input.stepRef,
    modeId: input.stepRef,
    toolId: input.toolRef,
    toolName: input.toolRef,
    approved: input.approved,
    approvalId: input.approvalId,
    toolInput:
      input.inputJson === undefined ? undefined : JSON.parse(input.inputJson),
    executeValidators: input.executeValidators,
    validatorTimeoutMs: input.validatorTimeoutMs,
    force: input.force,
  })

  return [
    `AWMP scheduler retry ${result.step.id}: ${result.status}`,
    `Mode: ${result.step.modeId}`,
    `Message: ${result.message}`,
    `Scheduler: ${result.schedulerPath}`,
    result.contextPath === undefined ? '' : `Context: ${result.contextPath}`,
    `State: ${result.step.state}`,
    `Attempts: ${result.step.attemptCount}`,
    result.step.lastFailureKind === undefined
      ? ''
      : `Failure kind: ${result.step.lastFailureKind}`,
    result.step.retryable === undefined ? '' : `Retryable: ${result.step.retryable}`,
    result.step.retryAfter === undefined
      ? ''
      : `Retry after: ${result.step.retryAfter}`,
    result.step.nextAction === undefined
      ? ''
      : `Next action: ${result.step.nextAction}`,
    result.toolCall === undefined
      ? ''
      : `Tool call: ${result.toolCall.id} (${result.toolCall.status})`,
    result.toolCall?.resultPath === undefined
      ? ''
      : `Result: ${result.toolCall.resultPath}`,
    result.toolCall?.stdout === undefined ? '' : `Stdout: ${result.toolCall.stdout}`,
    result.toolCall?.stderr === undefined ? '' : `Stderr: ${result.toolCall.stderr}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function schedulerRunCommand(input: {
  runDir: string
  maxSteps?: number
  timeoutMs?: number
  executeValidators: boolean
  validatorTimeoutMs?: number
}): Promise<string> {
  const result = await runAwmpScheduler({
    runDir: resolve(input.runDir),
    maxSteps: input.maxSteps,
    timeoutMs: input.timeoutMs,
    executeValidators: input.executeValidators,
    validatorTimeoutMs: input.validatorTimeoutMs,
  })

  return [
    result.message,
    `Scheduler: ${result.schedulerPath}`,
    result.contextPath === undefined ? '' : `Context: ${result.contextPath}`,
    `Status: ${result.status}`,
    `Steps attempted: ${result.steps.length}`,
    ...result.steps.map(step =>
      [
        `- ${step.step.id}: ${step.status}`,
        `  mode: ${step.step.modeId}`,
        `  message: ${step.message}`,
      ].join('\n'),
    ),
  ]
    .filter(Boolean)
    .join('\n')
}

function formatMetrics(
  metrics: Record<
    string,
    {
      label: string
      status: string
      value: number | null
      numerator?: number
      denominator?: number
    }
  >,
): string[] {
  return Object.values(metrics).map(metric => {
    const value =
      metric.value === null
        ? metric.status
        : `${formatNumber(metric.value)}${
            metric.denominator === undefined
              ? ''
              : ` (${metric.numerator ?? 0}/${metric.denominator})`
          }`
    return `Metric ${metric.label}: ${value}`
  })
}

function formatEvidenceGaps(gaps: string[]): string {
  if (gaps.length === 0) return ''
  return ['Evidence gaps:', ...gaps.map(gap => `- ${gap}`)].join('\n')
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

function text(value: string): LocalCommandResult {
  return { type: 'text', value }
}

function parseArgs(args: string): {
  positionals: string[]
  options: {
    modes?: string
    force: boolean
    executeValidators: boolean
    runScheduler: boolean
    applyReviewFixtures: boolean
    approve: boolean
    inputJson?: string
    approvalId?: string
    by?: string
    note?: string
    id?: string
    name?: string
    description?: string
    intents: string[]
    artifactTypes: string[]
    maxSteps?: number
    timeoutMs?: number
    validatorTimeoutMs?: number
    changes?: string
    catalogPath?: string
    lockPath?: string
    trustPath?: string
    marketplacePath?: string
    sourceId?: string
    bundlePath?: string
    reportPath?: string
    policyPath?: string
    modeLockPath?: string
    modeTrustPath?: string
    privateKeyPath?: string
    publicKeyPath?: string
    publisherId?: string
    version?: string
    reason?: string
    requireModeLock?: boolean
    requireModeSignature?: boolean
    requireMarketplaceApproval?: boolean
    trustedPublisherIds: string[]
    allowedModeIds: string[]
    deniedModeIds: string[]
    maxModesPerTask?: number
    clearAllowedModeIds: boolean
    clearDeniedModeIds: boolean
    clearTrustedPublisherIds: boolean
    write: boolean
  }
} {
  const tokens = tokenize(args)
  const positionals: string[] = []
  const options: {
    modes?: string
    force: boolean
    executeValidators: boolean
    runScheduler: boolean
    applyReviewFixtures: boolean
    approve: boolean
    inputJson?: string
    approvalId?: string
    by?: string
    note?: string
    id?: string
    name?: string
    description?: string
    intents: string[]
    artifactTypes: string[]
    maxSteps?: number
    timeoutMs?: number
    validatorTimeoutMs?: number
    changes?: string
    catalogPath?: string
    lockPath?: string
    trustPath?: string
    marketplacePath?: string
    sourceId?: string
    bundlePath?: string
    reportPath?: string
    policyPath?: string
    modeLockPath?: string
    modeTrustPath?: string
    privateKeyPath?: string
    publicKeyPath?: string
    publisherId?: string
    version?: string
    reason?: string
    requireModeLock?: boolean
    requireModeSignature?: boolean
    requireMarketplaceApproval?: boolean
    trustedPublisherIds: string[]
    allowedModeIds: string[]
    deniedModeIds: string[]
    maxModesPerTask?: number
    clearAllowedModeIds: boolean
    clearDeniedModeIds: boolean
    clearTrustedPublisherIds: boolean
    write: boolean
  } = {
    force: false,
    executeValidators: false,
    runScheduler: false,
    applyReviewFixtures: false,
    approve: false,
    write: false,
    intents: [],
    artifactTypes: [],
    trustedPublisherIds: [],
    allowedModeIds: [],
    deniedModeIds: [],
    clearAllowedModeIds: false,
    clearDeniedModeIds: false,
    clearTrustedPublisherIds: false,
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === '--modes') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--modes requires a path')
      options.modes = value
      i += 1
      continue
    }
    if (token === '--force') {
      options.force = true
      continue
    }
    if (token === '--write') {
      options.write = true
      continue
    }
    if (token === '--catalog') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--catalog requires a path')
      options.catalogPath = value
      i += 1
      continue
    }
    if (token === '--lock') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--lock requires a path')
      options.lockPath = value
      i += 1
      continue
    }
    if (token === '--trust') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--trust requires a path')
      options.trustPath = value
      i += 1
      continue
    }
    if (token === '--marketplace') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--marketplace requires a path')
      options.marketplacePath = value
      i += 1
      continue
    }
    if (token === '--source-id') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--source-id requires an id')
      options.sourceId = value
      i += 1
      continue
    }
    if (token === '--bundle') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--bundle requires a path')
      options.bundlePath = value
      i += 1
      continue
    }
    if (token === '--policy') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--policy requires a path')
      options.policyPath = value
      i += 1
      continue
    }
    if (token === '--mode-lock') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--mode-lock requires a path')
      options.modeLockPath = value
      i += 1
      continue
    }
    if (token === '--mode-trust') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--mode-trust requires a path')
      options.modeTrustPath = value
      i += 1
      continue
    }
    if (token === '--require-mode-lock') {
      options.requireModeLock = true
      continue
    }
    if (token === '--no-require-mode-lock') {
      options.requireModeLock = false
      continue
    }
    if (token === '--require-mode-signature') {
      options.requireModeSignature = true
      continue
    }
    if (token === '--no-require-mode-signature') {
      options.requireModeSignature = false
      continue
    }
    if (token === '--require-marketplace') {
      options.requireMarketplaceApproval = true
      continue
    }
    if (token === '--no-require-marketplace') {
      options.requireMarketplaceApproval = false
      continue
    }
    if (token === '--publisher') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--publisher requires an id')
      options.publisherId = value
      i += 1
      continue
    }
    if (token === '--version') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--version requires a value')
      options.version = value
      i += 1
      continue
    }
    if (token === '--reason') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--reason requires a value')
      options.reason = value
      i += 1
      continue
    }
    if (token === '--trusted-publisher') {
      const value = tokens[i + 1]
      if (value === undefined) {
        throw new Error('--trusted-publisher requires an id')
      }
      options.trustedPublisherIds.push(value)
      i += 1
      continue
    }
    if (token === '--public-key') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--public-key requires a path')
      options.publicKeyPath = value
      i += 1
      continue
    }
    if (token === '--private-key') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--private-key requires a path')
      options.privateKeyPath = value
      i += 1
      continue
    }
    if (token === '--allow-mode') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--allow-mode requires a mode id')
      options.allowedModeIds.push(value)
      i += 1
      continue
    }
    if (token === '--deny-mode') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--deny-mode requires a mode id')
      options.deniedModeIds.push(value)
      i += 1
      continue
    }
    if (token === '--clear-allowed') {
      options.clearAllowedModeIds = true
      continue
    }
    if (token === '--clear-denied') {
      options.clearDeniedModeIds = true
      continue
    }
    if (token === '--clear-trusted-publishers') {
      options.clearTrustedPublisherIds = true
      continue
    }
    if (token === '--report') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--report requires a path')
      options.reportPath = value
      i += 1
      continue
    }
    if (token === '--execute-validators') {
      options.executeValidators = true
      continue
    }
    if (token === '--run-scheduler') {
      options.runScheduler = true
      continue
    }
    if (token === '--apply-review-fixtures') {
      options.applyReviewFixtures = true
      continue
    }
    if (token === '--approve') {
      options.approve = true
      continue
    }
    if (token === '--input-json') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--input-json requires JSON')
      options.inputJson = value
      i += 1
      continue
    }
    if (token === '--approval') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--approval requires an id')
      options.approvalId = value
      i += 1
      continue
    }
    if (token === '--by') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--by requires a value')
      options.by = value
      i += 1
      continue
    }
    if (token === '--note') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--note requires a value')
      options.note = value
      i += 1
      continue
    }
    if (token === '--changes') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--changes requires a value')
      options.changes = value
      i += 1
      continue
    }
    if (token === '--max-steps') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--max-steps requires a number')
      options.maxSteps = Number(value)
      i += 1
      continue
    }
    if (token === '--max-modes') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--max-modes requires a number')
      options.maxModesPerTask = Number(value)
      i += 1
      continue
    }
    if (token === '--timeout-ms') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--timeout-ms requires a number')
      options.timeoutMs = Number(value)
      i += 1
      continue
    }
    if (token === '--validator-timeout-ms') {
      const value = tokens[i + 1]
      if (value === undefined) {
        throw new Error('--validator-timeout-ms requires a number')
      }
      options.validatorTimeoutMs = Number(value)
      i += 1
      continue
    }
    if (token === '--id') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--id requires a value')
      options.id = value
      i += 1
      continue
    }
    if (token === '--name') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--name requires a value')
      options.name = value
      i += 1
      continue
    }
    if (token === '--description') {
      const value = tokens[i + 1]
      if (value === undefined) {
        throw new Error('--description requires a value')
      }
      options.description = value
      i += 1
      continue
    }
    if (token === '--intent') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--intent requires a value')
      options.intents.push(value)
      i += 1
      continue
    }
    if (token === '--artifact') {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error('--artifact requires a value')
      options.artifactTypes.push(value)
      i += 1
      continue
    }
    positionals.push(token)
  }

  return { positionals, options }
}

function parseReviewStatus(
  value: string | undefined,
): AwmpArtifactReviewStatus | undefined {
  if (
    value === 'accepted' ||
    value === 'accepted_with_changes' ||
    value === 'rejected' ||
    value === 'needs_revision'
  ) {
    return value
  }
  return undefined
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
