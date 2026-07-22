import { randomUUID } from 'crypto'
import { join, resolve } from 'path'
import { z } from 'zod/v4'
import {
  decideApprovalRequest,
  listApprovalRequests,
  type AwmpApprovalRequest,
} from '../../awmp/approvalStore.js'
import {
  listArtifactReviews,
  recordArtifactReview,
  type AwmpArtifactReviewRecord,
} from '../../awmp/artifactReviewStore.js'
import {
  evaluateAwmpRuns,
  inspectAwmpRun,
} from '../../awmp/evalReporter.js'
import {
  lintModePackage,
  scaffoldModePackage,
} from '../../awmp/modeAuthoring.js'
import {
  buildModeCatalogFromRoots,
  loadModeCatalog,
  publishModeToCatalog,
} from '../../awmp/modeCatalog.js'
import {
  exportModeBundle,
  installModeBundle,
} from '../../awmp/modeBundle.js'
import { runModeEvals } from '../../awmp/modeEval.js'
import { installModePackage } from '../../awmp/modeInstaller.js'
import {
  loadModeLock,
  lockModePackage,
  verifyModeLock,
} from '../../awmp/modeLock.js'
import {
  installMarketplaceMode,
  loadModeMarketplace,
  publishModeToMarketplace,
  revokeMarketplaceMode,
  syncModeMarketplace,
  verifyModeMarketplace,
} from '../../awmp/modeMarketplace.js'
import {
  generateModeTrustKeyPair,
  loadModeTrust,
  signModePackage,
  verifyModeSignature,
} from '../../awmp/modeTrust.js'
import { discoverModePackages, summarizeModes } from '../../awmp/modeRegistry.js'
import { registerAwmpMcpAdapter } from '../../awmp/mcpAdapterRegistry.js'
import { getAwmpStateRoot, resolveModeRoots } from '../../awmp/paths.js'
import {
  routeAwmpRequest,
  runAwmpTask,
  runAwmpTaskFile,
} from '../../awmp/runtime.js'
import {
  retryAwmpSchedulerStep,
  runAwmpScheduler,
  runAwmpSchedulerStep,
} from '../../awmp/scheduler.js'
import { callRegisteredTool } from '../../awmp/toolBroker.js'
import {
  checkWorkspacePolicyForTaskFile,
  loadWorkspacePolicy,
  updateWorkspacePolicy,
} from '../../awmp/workspacePolicy.js'
import { AWMP_VERSION, type AwmpTask } from '../../awmp/types.js'
import {
  buildTool,
  type Tool,
  type ToolDef,
  type ToolResult,
  type ToolUseContext,
  type ValidationResult,
} from '../../Tool.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { AssistantMessage } from '../../types/message.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { AWMP_TOOL_ACTIONS, AWMP_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(AWMP_TOOL_ACTIONS)
      .describe(
        'AWMP control-plane action: list modes, route a request, create/lint/install a mode package, run a task file, or start a task from an objective.',
      ),
    target_dir: z
      .string()
      .optional()
      .describe('Directory where action=create_mode should scaffold a new AWMP mode package.'),
    mode_id: z
      .string()
      .optional()
      .describe('AWMP mode id for action=create_mode. Must match /^[a-zA-Z0-9_.-]+$/.'),
    mode_name: z
      .string()
      .optional()
      .describe('Human-readable AWMP mode name for action=create_mode.'),
    mode_description: z
      .string()
      .optional()
      .describe('Mode description used in mode.yaml and SKILL.md for action=create_mode.'),
    mode_intents: z
      .array(z.string())
      .optional()
      .describe('Activation intent phrases for action=create_mode.'),
    artifact_types: z
      .array(z.string())
      .optional()
      .describe('Artifact type contracts for action=create_mode.'),
    mode_root: z
      .string()
      .optional()
      .describe(
        'Optional AWMP mode root directory. If omitted, installed workspace modes under .leviathan/awmp/modes are used.',
      ),
    query: z
      .string()
      .optional()
      .describe('Natural-language request to route against installed modes.'),
    source_dir: z
      .string()
      .optional()
      .describe('Mode package directory to lint, install, publish, or export as a bundle. Must contain mode.yaml.'),
    catalog_path: z
      .string()
      .optional()
      .describe('Optional AWMP mode catalog path for catalog_modes or publish_mode.'),
    bundle_path: z
      .string()
      .optional()
      .describe('AWMP mode bundle path for action=export_mode_bundle or action=install_mode_bundle. Export writes this file when set; install reads this file.'),
    lock_path: z
      .string()
      .optional()
      .describe('Optional AWMP mode lock path for read_mode_lock, lock_mode, or verify_mode_lock.'),
    trust_path: z
      .string()
      .optional()
      .describe('Optional AWMP mode trust path for read_mode_trust, sign_mode, or verify_mode_signature.'),
    marketplace_path: z
      .string()
      .optional()
      .describe('Optional AWMP mode marketplace path for read_mode_marketplace, publish_marketplace_mode, revoke_marketplace_mode, verify_mode_marketplace, sync_mode_marketplace, install_marketplace_mode, or policy gating.'),
    marketplace_source: z
      .string()
      .optional()
      .describe('Local file path or HTTP(S) URL for action=sync_mode_marketplace. The source must contain a marketplace or marketplace feed JSON object with entries.'),
    marketplace_source_id: z
      .string()
      .optional()
      .describe('Optional stable source id recorded on entries imported by action=sync_mode_marketplace.'),
    public_key_path: z
      .string()
      .optional()
      .describe('Public key path for generate_trust_keypair or verify_mode_signature.'),
    private_key_path: z
      .string()
      .optional()
      .describe('Private key path for generate_trust_keypair or sign_mode. The key content is never returned by the tool.'),
    publisher_id: z
      .string()
      .optional()
      .describe('Publisher id for sign_mode, verify_mode_signature, marketplace publishing/revocation, or trusted workspace policy configuration.'),
    mode_version: z
      .string()
      .optional()
      .describe('Mode version used by revoke_marketplace_mode.'),
    revocation_reason: z
      .string()
      .optional()
      .describe('Reason recorded by revoke_marketplace_mode.'),
    revoked_by: z
      .string()
      .optional()
      .describe('Human or system actor recorded by revoke_marketplace_mode.'),
    policy_path: z
      .string()
      .optional()
      .describe(
        'Optional AWMP workspace policy path for read_workspace_policy, set_workspace_policy, check_workspace_policy, or task execution.',
      ),
    policy_mode_lock_path: z
      .string()
      .optional()
      .describe('Optional mode lock path referenced by set_workspace_policy.'),
    policy_mode_trust_path: z
      .string()
      .optional()
      .describe('Optional mode trust path referenced by set_workspace_policy.'),
    policy_marketplace_path: z
      .string()
      .optional()
      .describe('Optional mode marketplace path referenced by set_workspace_policy.'),
    require_mode_lock: z
      .boolean()
      .optional()
      .describe(
        'For action=set_workspace_policy, require selected modes to match the workspace mode lock before task execution.',
      ),
    require_mode_signature: z
      .boolean()
      .optional()
      .describe(
        'For action=set_workspace_policy, require selected modes to have a valid trusted signature before task execution.',
      ),
    require_marketplace_approval: z
      .boolean()
      .optional()
      .describe(
        'For action=set_workspace_policy, require selected modes to be active in the workspace mode marketplace before task execution.',
      ),
    trusted_publisher_ids: z
      .array(z.string())
      .optional()
      .describe('For action=set_workspace_policy, append trusted publisher ids for signed modes.'),
    allowed_mode_ids: z
      .array(z.string())
      .optional()
      .describe('For action=set_workspace_policy, append mode IDs to the workspace allow list.'),
    denied_mode_ids: z
      .array(z.string())
      .optional()
      .describe('For action=set_workspace_policy, append mode IDs to the workspace deny list.'),
    max_modes_per_task: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('For action=set_workspace_policy, maximum selected modes allowed per task.'),
    clear_allowed_mode_ids: z
      .boolean()
      .optional()
      .default(false)
      .describe('For action=set_workspace_policy, clear the allow list before adding allowed_mode_ids.'),
    clear_denied_mode_ids: z
      .boolean()
      .optional()
      .default(false)
      .describe('For action=set_workspace_policy, clear the deny list before adding denied_mode_ids.'),
    clear_trusted_publisher_ids: z
      .boolean()
      .optional()
      .default(false)
      .describe('For action=set_workspace_policy, clear trusted publishers before adding trusted_publisher_ids.'),
    report_path: z
      .string()
      .optional()
      .describe('Optional output report path for action=eval_mode.'),
    eval_run_scheduler: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'For action=eval_mode, also run a bounded scheduler pass for each golden task before inspecting the run.',
      ),
    apply_review_fixtures: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'For action=eval_mode, apply local artifact review fixtures declared by *.eval.json expectation files. These are regression fixtures, not real user acceptance.',
      ),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe('Replace an already installed mode when installing.'),
    task_path: z
      .string()
      .optional()
      .describe('Path to an AWMP Task JSON file.'),
    run_dir: z
      .string()
      .optional()
      .describe('AWMP run directory used by tool and approval actions.'),
    runs_root: z
      .string()
      .optional()
      .describe(
        'AWMP runs root directory for action=eval_runs. Defaults to .leviathan/awmp/runs in the current workspace.',
      ),
    scheduler_step_id: z
      .string()
      .optional()
      .describe('Scheduler step id or plan step id for scheduler step actions.'),
    scheduler_mode_id: z
      .string()
      .optional()
      .describe('Mode id for scheduler step actions when the mode appears only once in the scheduler.'),
    approval_id: z
      .string()
      .optional()
      .describe('AWMP approval request id for approval actions or action=call_registered_tool.'),
    approval_note: z
      .string()
      .optional()
      .describe('Optional note recorded with approve_request or reject_request.'),
    approval_decided_by: z
      .string()
      .optional()
      .describe('Optional actor label recorded with approve_request or reject_request.'),
    artifact_ref: z
      .string()
      .optional()
      .describe('Artifact id, URI, absolute path, or basename for action=record_artifact_review.'),
    artifact_review_status: z
      .enum(['accepted', 'accepted_with_changes', 'rejected', 'needs_revision'])
      .optional()
      .describe('Explicit artifact review status for action=record_artifact_review.'),
    artifact_review_note: z
      .string()
      .optional()
      .describe('Optional human-readable note recorded with an artifact review.'),
    artifact_review_changes: z
      .string()
      .optional()
      .describe('Optional requested changes recorded with an artifact review.'),
    artifact_reviewed_by: z
      .string()
      .optional()
      .describe('Optional actor label recorded with an artifact review.'),
    tool_id: z
      .string()
      .optional()
      .describe('Exact AWMP tool registry entry id for tool or scheduler execution actions.'),
    tool_name: z
      .string()
      .optional()
      .describe('Tool registry display name for tool or scheduler execution actions. Use tool_id if ambiguous.'),
    approve_tool_call: z
      .boolean()
      .optional()
      .default(false)
      .describe('Explicit approval for tools whose policy decision is approval_required.'),
    force_retry: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'For action=retry_scheduler_step, retry immediately even if retry_after is still in the future.',
      ),
    tool_input: z
      .unknown()
      .optional()
      .describe('Structured input passed to a local registered AWMP tool.'),
    tool_timeout_ms: z
      .number()
      .int()
      .positive()
      .max(60_000)
      .optional()
      .describe('Timeout in milliseconds for tool or scheduler execution actions.'),
    scheduler_max_steps: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe('Maximum number of scheduler steps to attempt for action=run_scheduler.'),
    objective: z
      .string()
      .optional()
      .describe('Objective for a new AWMP task when action=start_task.'),
    title: z
      .string()
      .optional()
      .describe('Short title for a new AWMP task.'),
    mode_ids: z
      .array(z.string())
      .optional()
      .describe(
        'Optional explicit mode IDs for start_task. If omitted, AWMP routes the objective against installed modes.',
      ),
    inputs: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Structured task inputs.'),
    constraints: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Task constraints such as network, maxRuntimeSeconds, or requiresHumanApprovalFor.'),
    execute_validators: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Explicitly execute mode-provided validator scripts in the restricted AWMP validator runner. Defaults to false.',
      ),
    validator_timeout_ms: z
      .number()
      .int()
      .positive()
      .max(60_000)
      .optional()
      .describe('Per-validator timeout in milliseconds when execute_validators=true.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.enum(AWMP_TOOL_ACTIONS),
    summary: z.string(),
    state_root: z.string(),
    mode_roots: z.array(z.string()).optional(),
    modes: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          version: z.string(),
          description: z.string(),
          root: z.string(),
          artifact_types: z.array(z.string()),
          validators: z.number(),
        }),
      )
      .optional(),
    candidates: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          score: z.number(),
          reasons: z.array(z.string()),
        }),
      )
      .optional(),
    installed_root: z.string().optional(),
    mode_catalog_path: z.string().optional(),
    mode_catalog: z.unknown().optional(),
    mode_catalog_entry: z.unknown().optional(),
    mode_bundle_path: z.string().optional(),
    mode_bundle: z.unknown().optional(),
    mode_bundle_file_count: z.number().optional(),
    mode_bundle_total_bytes: z.number().optional(),
    mode_lock_path: z.string().optional(),
    mode_lock: z.unknown().optional(),
    mode_lock_entry: z.unknown().optional(),
    mode_lock_verification: z.unknown().optional(),
    mode_trust_path: z.string().optional(),
    mode_trust: z.unknown().optional(),
    mode_signature: z.unknown().optional(),
    mode_signature_verification: z.unknown().optional(),
    trust_public_key_path: z.string().optional(),
    trust_private_key_path: z.string().optional(),
    mode_marketplace_path: z.string().optional(),
    mode_marketplace: z.unknown().optional(),
    mode_marketplace_entry: z.unknown().optional(),
    mode_marketplace_verification: z.unknown().optional(),
    mode_marketplace_sync: z.unknown().optional(),
    mode_marketplace_install: z.unknown().optional(),
    workspace_policy_path: z.string().optional(),
    workspace_policy: z.unknown().optional(),
    workspace_policy_check: z.unknown().optional(),
    mode_eval_report_path: z.string().optional(),
    mode_eval_report: z.unknown().optional(),
    created_files: z.array(z.string()).optional(),
    lint_ok: z.boolean().optional(),
    diagnostics: z
      .array(
        z.object({
          severity: z.string(),
          code: z.string(),
          message: z.string(),
          path: z.string().optional(),
        }),
      )
      .optional(),
    run_dir: z.string().optional(),
    trace_path: z.string().optional(),
    artifact_store_path: z.string().optional(),
    context_path: z.string().optional(),
    orchestration_path: z.string().optional(),
    handoff_plan_path: z.string().optional(),
    scheduler_path: z.string().optional(),
    runs_root: z.string().optional(),
    run_report_path: z.string().optional(),
    eval_report_path: z.string().optional(),
    run_report: z.unknown().optional(),
    eval_report: z.unknown().optional(),
    task: z.unknown().optional(),
    artifacts: z
      .array(
        z.object({
          id: z.string(),
          type: z.string(),
          uri: z.string(),
        }),
      )
      .optional(),
    validations: z
      .array(
        z.object({
          validatorId: z.string(),
          modeId: z.string(),
          status: z.string(),
          severity: z.string(),
          message: z.string(),
          exitCode: z.number().optional(),
          durationMs: z.number().optional(),
          stdout: z.string().optional(),
          stderr: z.string().optional(),
          findings: z.array(z.unknown()).optional(),
        }),
      )
      .optional(),
    tool_call: z
      .object({
        id: z.string(),
        status: z.string(),
        message: z.string(),
        resultPath: z.string(),
        approvalRequestId: z.string().optional(),
        exitCode: z.number().optional(),
        httpStatus: z.number().optional(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
      })
      .optional(),
    scheduler_step: z
      .object({
        id: z.string(),
        modeId: z.string(),
        state: z.string(),
        attemptCount: z.number(),
        nextAction: z.string().optional(),
        blockedReason: z.string().optional(),
        lastFailureKind: z.string().optional(),
        retryable: z.boolean().optional(),
        retryAfter: z.string().optional(),
        retryPolicy: z
          .object({
            maxAttempts: z.number(),
            baseBackoffMs: z.number(),
            maxBackoffMs: z.number(),
          })
          .optional(),
        lastToolCallResultPath: z.string().optional(),
        registeredArtifactIds: z.array(z.string()).optional(),
        registeredArtifactUris: z.array(z.string()).optional(),
        validationSummary: z
          .object({
            total: z.number(),
            passed: z.number(),
            failed: z.number(),
            skipped: z.number(),
            blockingFailures: z.array(z.string()),
            artifactIds: z.array(z.string()),
            artifactUris: z.array(z.string()),
            validationArtifactIds: z.array(z.string()),
            validationArtifactUris: z.array(z.string()),
          })
          .optional(),
      })
      .optional(),
    scheduler_steps: z
      .array(
        z.object({
          id: z.string(),
          modeId: z.string(),
          status: z.string(),
          state: z.string(),
          attemptCount: z.number(),
          message: z.string(),
          nextAction: z.string().optional(),
          lastFailureKind: z.string().optional(),
          retryable: z.boolean().optional(),
          retryAfter: z.string().optional(),
          validationSummary: z
            .object({
              total: z.number(),
              passed: z.number(),
              failed: z.number(),
              skipped: z.number(),
              blockingFailures: z.array(z.string()),
              artifactIds: z.array(z.string()),
              artifactUris: z.array(z.string()),
              validationArtifactIds: z.array(z.string()),
              validationArtifactUris: z.array(z.string()),
            })
            .optional(),
        }),
      )
      .optional(),
    approvals: z
      .array(
        z.object({
          id: z.string(),
          status: z.string(),
          toolId: z.string(),
          toolName: z.string(),
          reason: z.string(),
          requestedAt: z.string(),
          decidedAt: z.string().optional(),
          decidedBy: z.string().optional(),
          requestPath: z.string(),
        }),
      )
      .optional(),
    artifact_reviews: z
      .array(
        z.object({
          id: z.string(),
          status: z.string(),
          accepted: z.boolean(),
          reviewedAt: z.string(),
          reviewedBy: z.string(),
          artifactId: z.string(),
          artifactType: z.string(),
          artifactUri: z.string(),
          reviewPath: z.string(),
          note: z.string().optional(),
          requestedChanges: z.string().optional(),
        }),
      )
      .optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const AwmpTool = buildTool({
  name: AWMP_TOOL_NAME,
  searchHint: 'work mode task artifact governance runtime',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description() {
    return 'Use the Agent Work Mode Protocol runtime to discover/install work modes, route requests, create task contracts, write artifacts, and inspect governance/validation records.'
  },
  async prompt() {
    return [
      'AWMP is Leviathan’s Agent Work Mode Protocol control-plane tool.',
      'Use it when a user request looks like a real work task that should be represented as a Task Contract with Mode Cards, Artifacts, Execution Capsule, governance policy, and validators.',
      '',
      'Actions:',
      '- list_modes: inspect installed or explicitly supplied AWMP mode packages.',
      '- route_request: find matching modes for a natural-language work request.',
      '- create_mode: scaffold a complete mode package with mode.yaml, SKILL.md, schema, example task, local tool, and validator.',
      '- lint_mode: statically verify an AWMP mode package before install or execution.',
      '- install_mode: install a mode package directory into the current workspace registry.',
      '- catalog_modes: inspect the persistent local AWMP mode catalog, or build a transient catalog summary from mode_root without writing it.',
      '- publish_mode: lint a mode package and publish its capability summary plus package digest into the local AWMP mode catalog.',
      '- export_mode_bundle: export a linted mode package into a portable .awmp-mode.json bundle with file digests and catalog metadata.',
      '- install_mode_bundle: install a portable AWMP mode bundle into the workspace mode registry after file digest, package digest, and lint verification.',
      '- read_mode_lock: inspect the persistent AWMP mode lock file that pins mode id/version/digest records.',
      '- lock_mode: lint a mode package and pin its id/version/package digest into the AWMP mode lock file for reproducible execution.',
      '- verify_mode_lock: recompute locked mode package digests and report matched, missing, invalid, or mismatched entries.',
      '- generate_trust_keypair: create an Ed25519 publisher keypair at explicit filesystem paths for signing mode packages. The private key content is never returned.',
      '- read_mode_trust: inspect the persistent AWMP mode trust store containing publisher signatures for mode package digests.',
      '- sign_mode: sign a linted mode package digest with a publisher private key and record the public signature in the local mode trust store.',
      '- verify_mode_signature: recompute mode package digests and verify stored Ed25519 signatures, optionally filtered by publisher or public key.',
      '- read_mode_marketplace: inspect the local AWMP mode marketplace index containing published mode releases and revocation state.',
      '- publish_marketplace_mode: publish a linted mode release into the local marketplace index, optionally signing it first with a publisher private key.',
      '- revoke_marketplace_mode: mark a published mode release as revoked with a reason and actor for workspace policy enforcement.',
      '- verify_mode_marketplace: recompute mode package digests, verify signatures, and report whether marketplace entries are active or revoked.',
      '- sync_mode_marketplace: import active/revoked marketplace entries from a local file or HTTP(S) feed into the workspace marketplace, preserving remote source identity and inline public signatures.',
      '- install_marketplace_mode: install an active marketplace mode release by resolving its bundleUri, verifying the bundle/package digests, and installing it into the workspace mode registry.',
      '- read_workspace_policy: inspect the workspace-level AWMP policy gate.',
      '- set_workspace_policy: update workspace policy gates such as require_mode_lock, require_mode_signature, require_marketplace_approval, trusted_publisher_ids, allowed_mode_ids, denied_mode_ids, and max_modes_per_task.',
      '- check_workspace_policy: resolve a task file against available modes and report whether workspace policy would allow execution.',
      '- eval_mode: run a mode package examples/ golden task suite through the AWMP substrate and write a ModeEvalReport. Set eval_run_scheduler=true to also execute a bounded scheduler pass for each case. Set apply_review_fixtures=true only for local regression expectations that declare artifact review fixtures; these fixtures are not real user acceptance.',
      '- run_task_file: run an existing AWMP task JSON file through the local substrate.',
      '- start_task: create a Task Contract from an objective and route or explicit mode IDs, then run the local substrate.',
      '- list_approvals: inspect durable human approval requests for an AWMP run.',
      '- list_artifact_reviews: inspect explicit artifact review and acceptance records for an AWMP run.',
      '- record_artifact_review: record a human artifact review decision for a produced artifact. Accepted reviews become evidence for Artifact Acceptance Rate; this action must not be used to fabricate acceptance.',
      '- inspect_run: generate a structured run inspection report from real AWMP run files, including evidence-backed metrics and missing evidence gaps.',
      '- eval_runs: aggregate inspectable AWMP run directories into a metrics report for work completion, validation pass rate, mode reuse, adapter coverage, approval resolution, and cross-mode success. It marks unsupported metrics as missing_evidence instead of inventing values.',
      '- approve_request / reject_request: record an explicit approval decision for a pending AWMP approval request.',
      '- call_registered_tool: call a tool from a completed AWMP run tool registry through the policy-aware Tool Broker.',
      '- run_scheduler_step: advance one scheduler step by calling a policy-checked Tool Broker tool, auto-selecting a single unambiguous mode-owned tool when no tool_id/tool_name is supplied, persisting registered artifacts, and recording step-scoped validator results. Set execute_validators=true to run declared validators instead of only inspecting/skipping them.',
      '- retry_scheduler_step: explicitly rerun a failed retryable scheduler step after its recorded backoff, reusing the previous tool/input when no replacement is supplied. Set force_retry=true to bypass the recorded retry_after wait.',
      '- run_scheduler: run an explicit bounded scheduler pass across runnable deferred steps. It does not approve gated tools automatically. Set execute_validators=true to execute declared validators after each completed step.',
      '',
      'Boundary: this v0.1 substrate creates task/capsule/artifact/trace/governance records. It does not fabricate business data. Validator execution and registered local tool execution are explicit, timeout-bound, and restricted to declared relative scripts inside mounted mode packages. OpenAPI/HTTP tools execute only when the Execution Capsule network policy allows the target. MCP entries execute only through explicit AWMP adapters or connected Leviathan MCP tools; otherwise they remain deferred.',
    ].join('\n')
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'AWMP'
  },
  renderToolUseMessage() {
    return null
  },
  isConcurrencySafe(input: Input) {
    return (
      input.action === 'list_modes' ||
      input.action === 'route_request' ||
      input.action === 'lint_mode' ||
      input.action === 'catalog_modes' ||
      input.action === 'read_mode_lock' ||
      input.action === 'verify_mode_lock' ||
      input.action === 'read_mode_trust' ||
      input.action === 'verify_mode_signature' ||
      input.action === 'read_mode_marketplace' ||
      input.action === 'verify_mode_marketplace' ||
      input.action === 'read_workspace_policy' ||
      input.action === 'check_workspace_policy' ||
      input.action === 'list_approvals' ||
      input.action === 'list_artifact_reviews'
    )
  },
  isReadOnly(input: Input) {
    return (
      input.action === 'list_modes' ||
      input.action === 'route_request' ||
      input.action === 'lint_mode' ||
      input.action === 'catalog_modes' ||
      input.action === 'read_mode_lock' ||
      input.action === 'verify_mode_lock' ||
      input.action === 'read_mode_trust' ||
      input.action === 'verify_mode_signature' ||
      input.action === 'read_mode_marketplace' ||
      input.action === 'verify_mode_marketplace' ||
      input.action === 'read_workspace_policy' ||
      input.action === 'check_workspace_policy' ||
      input.action === 'list_approvals' ||
      input.action === 'list_artifact_reviews'
    )
  },
  toAutoClassifierInput(input: Input) {
    return [
      input.action,
      input.query,
      input.objective,
      input.task_path,
      input.source_dir,
      input.catalog_path,
      input.bundle_path,
      input.lock_path,
      input.trust_path,
      input.marketplace_path,
      input.marketplace_source,
      input.marketplace_source_id,
      input.report_path,
      input.policy_path,
      input.policy_mode_lock_path,
      input.policy_mode_trust_path,
      input.policy_marketplace_path,
      input.public_key_path,
      input.private_key_path,
      input.publisher_id,
      input.mode_version,
      input.revocation_reason,
      input.revoked_by,
      input.target_dir,
      input.mode_id,
      input.mode_name,
      input.run_dir,
      input.runs_root,
      input.approval_id,
      input.artifact_ref,
      input.artifact_review_status,
      input.tool_id,
      input.tool_name,
      input.scheduler_step_id,
      input.scheduler_mode_id,
      input.require_mode_lock === undefined
        ? undefined
        : input.require_mode_lock
          ? 'require_mode_lock'
          : 'no_require_mode_lock',
      input.require_mode_signature === undefined
        ? undefined
        : input.require_mode_signature
          ? 'require_mode_signature'
          : 'no_require_mode_signature',
      input.require_marketplace_approval === undefined
        ? undefined
        : input.require_marketplace_approval
          ? 'require_marketplace_approval'
          : 'no_require_marketplace_approval',
      input.trusted_publisher_ids?.join(','),
      input.allowed_mode_ids?.join(','),
      input.denied_mode_ids?.join(','),
      input.max_modes_per_task,
      input.execute_validators ? 'execute_validators' : undefined,
      input.eval_run_scheduler ? 'eval_run_scheduler' : undefined,
      input.apply_review_fixtures ? 'apply_review_fixtures' : undefined,
      input.force_retry ? 'force_retry' : undefined,
    ]
      .filter(Boolean)
      .join(' ')
  },
  async checkPermissions(input: Input) {
    if (
      input.action === 'list_modes' ||
      input.action === 'route_request' ||
      input.action === 'lint_mode' ||
      input.action === 'catalog_modes' ||
      input.action === 'read_mode_lock' ||
      input.action === 'verify_mode_lock' ||
      input.action === 'read_mode_trust' ||
      input.action === 'verify_mode_signature' ||
      input.action === 'read_mode_marketplace' ||
      input.action === 'verify_mode_marketplace' ||
      input.action === 'read_workspace_policy' ||
      input.action === 'check_workspace_policy' ||
      input.action === 'list_approvals' ||
      input.action === 'list_artifact_reviews'
    ) {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    if (input.action === 'record_artifact_review') {
      return {
        behavior: 'ask' as const,
        message: `Record AWMP artifact review for ${input.artifact_ref ?? '<missing artifact_ref>'} in run ${input.run_dir ?? '<missing run_dir>'} as ${input.artifact_review_status ?? '<missing status>'}`,
      }
    }

    if (input.action === 'approve_request' || input.action === 'reject_request') {
      return {
        behavior: 'ask' as const,
        message: `${input.action === 'approve_request' ? 'Approve' : 'Reject'} AWMP approval ${input.approval_id ?? '<missing approval_id>'} in run ${input.run_dir ?? '<missing run_dir>'}`,
      }
    }

    if (input.action === 'create_mode') {
      return {
        behavior: 'ask' as const,
        message: `Create AWMP mode package at ${input.target_dir ?? '<missing target_dir>'}`,
      }
    }

    if (input.action === 'install_mode') {
      return {
        behavior: 'ask' as const,
        message: `Install AWMP mode package from ${input.source_dir ?? '<missing source_dir>'}`,
      }
    }

    if (input.action === 'publish_mode') {
      return {
        behavior: 'ask' as const,
        message: `Publish AWMP mode package ${input.source_dir ?? '<missing source_dir>'} into catalog ${input.catalog_path ?? '<workspace .leviathan/awmp/catalog/mode_catalog.json>'}`,
      }
    }

    if (input.action === 'export_mode_bundle') {
      return {
        behavior: 'ask' as const,
        message: `Export AWMP mode package ${input.source_dir ?? '<missing source_dir>'} into bundle ${input.bundle_path ?? '<workspace .leviathan/awmp/bundles/*.awmp-mode.json>'}`,
      }
    }

    if (input.action === 'install_mode_bundle') {
      return {
        behavior: 'ask' as const,
        message: `Install AWMP mode bundle ${input.bundle_path ?? '<missing bundle_path>'} into the workspace mode registry`,
      }
    }

    if (input.action === 'lock_mode') {
      return {
        behavior: 'ask' as const,
        message: `Lock AWMP mode package ${input.source_dir ?? '<missing source_dir>'} into ${input.lock_path ?? '<workspace .leviathan/awmp/catalog/mode_lock.json>'}`,
      }
    }

    if (input.action === 'generate_trust_keypair') {
      return {
        behavior: 'ask' as const,
        message: `Generate AWMP trust keypair at public=${input.public_key_path ?? '<missing public_key_path>'}, private=${input.private_key_path ?? '<missing private_key_path>'}`,
      }
    }

    if (input.action === 'sign_mode') {
      return {
        behavior: 'ask' as const,
        message: `Sign AWMP mode package ${input.source_dir ?? '<missing source_dir>'} as publisher ${input.publisher_id ?? '<missing publisher_id>'} into ${input.trust_path ?? '<workspace .leviathan/awmp/catalog/mode_trust.json>'}`,
      }
    }

    if (input.action === 'publish_marketplace_mode') {
      return {
        behavior: 'ask' as const,
        message: `Publish AWMP marketplace mode ${input.source_dir ?? '<missing source_dir>'} as publisher ${input.publisher_id ?? '<missing publisher_id>'} into ${input.marketplace_path ?? '<workspace .leviathan/awmp/marketplace/mode_marketplace.json>'}${input.bundle_path === undefined ? '' : ` with bundle ${input.bundle_path}`}`,
      }
    }

    if (input.action === 'revoke_marketplace_mode') {
      return {
        behavior: 'ask' as const,
        message: `Revoke AWMP marketplace mode ${input.mode_id ?? '<missing mode_id>'}@${input.mode_version ?? '<missing mode_version>'} for publisher ${input.publisher_id ?? '<missing publisher_id>'}`,
      }
    }

    if (input.action === 'sync_mode_marketplace') {
      return {
        behavior: 'ask' as const,
        message: `Sync AWMP mode marketplace from ${input.marketplace_source ?? '<missing marketplace_source>'} into ${input.marketplace_path ?? '<workspace .leviathan/awmp/marketplace/mode_marketplace.json>'}`,
      }
    }

    if (input.action === 'install_marketplace_mode') {
      return {
        behavior: 'ask' as const,
        message: `Install AWMP marketplace mode ${input.mode_id ?? '<missing mode_id>'}${input.mode_version === undefined ? '' : `@${input.mode_version}`} from ${input.marketplace_path ?? '<workspace .leviathan/awmp/marketplace/mode_marketplace.json>'}`,
      }
    }

    if (input.action === 'eval_mode') {
      return {
        behavior: 'ask' as const,
        message: `Run AWMP mode eval for ${input.source_dir ?? '<missing source_dir>'}${input.eval_run_scheduler ? ' with scheduler execution' : ''}${input.execute_validators ? ' and execute declared validators' : ''}${input.apply_review_fixtures ? ' and apply local artifact review fixtures' : ''}`,
      }
    }

    if (input.action === 'set_workspace_policy') {
      return {
        behavior: 'ask' as const,
        message: `Update AWMP workspace policy at ${input.policy_path ?? '<workspace .leviathan/awmp/control_plane/workspace_policy.json>'}`,
      }
    }

    if (input.action === 'inspect_run' || input.action === 'eval_runs') {
      return {
        behavior: 'ask' as const,
        message:
          input.action === 'inspect_run'
            ? `Inspect AWMP run ${input.run_dir ?? '<missing run_dir>'} and write a run report`
            : `Evaluate AWMP runs under ${input.runs_root ?? '<workspace .leviathan/awmp/runs>'} and write an eval report`,
      }
    }

    if (
      input.action === 'call_registered_tool' ||
      input.action === 'run_scheduler_step' ||
      input.action === 'retry_scheduler_step' ||
      input.action === 'run_scheduler'
    ) {
      return {
        behavior: 'ask' as const,
        message:
          input.action === 'run_scheduler_step'
            ? `Run AWMP scheduler step ${input.scheduler_step_id ?? input.scheduler_mode_id ?? '<missing step>'} with tool ${input.tool_id ?? input.tool_name ?? '<auto-select>'} in run ${input.run_dir ?? '<missing run_dir>'}`
            : input.action === 'retry_scheduler_step'
              ? `Retry AWMP scheduler step ${input.scheduler_step_id ?? input.scheduler_mode_id ?? '<missing step>'} with tool ${input.tool_id ?? input.tool_name ?? '<previous or auto-select>'} in run ${input.run_dir ?? '<missing run_dir>'}`
            : input.action === 'run_scheduler'
              ? `Run AWMP scheduler pass in run ${input.run_dir ?? '<missing run_dir>'}`
              : `Call AWMP registered tool ${input.tool_id ?? input.tool_name ?? '<missing tool>'} in run ${input.run_dir ?? '<missing run_dir>'}`,
      }
    }

    return {
      behavior: 'ask' as const,
      message:
        input.action === 'run_task_file'
          ? `Run AWMP task file ${input.task_path ?? '<missing task_path>'}${input.execute_validators ? ' and execute declared validators' : ''}`
          : `Start AWMP task ${input.title ?? input.objective ?? '<missing objective>'}${input.execute_validators ? ' and execute declared validators' : ''}`,
    }
  },
  async validateInput(input: Input): Promise<ValidationResult> {
    if (input.action === 'route_request' && !input.query?.trim()) {
      return {
        result: false,
        message: 'query is required for action=route_request',
        errorCode: 400,
      }
    }
    if (input.action === 'install_mode' && !input.source_dir?.trim()) {
      return {
        result: false,
        message: 'source_dir is required for action=install_mode',
        errorCode: 400,
      }
    }
    if (
      (input.action === 'publish_mode' ||
        input.action === 'export_mode_bundle' ||
        input.action === 'publish_marketplace_mode' ||
        input.action === 'lock_mode' ||
        input.action === 'sign_mode' ||
        input.action === 'eval_mode') &&
      !input.source_dir?.trim()
    ) {
      return {
        result: false,
        message: `source_dir is required for action=${input.action}`,
        errorCode: 400,
      }
    }
    if (input.action === 'install_mode_bundle' && !input.bundle_path?.trim()) {
      return {
        result: false,
        message: 'bundle_path is required for action=install_mode_bundle',
        errorCode: 400,
      }
    }
    if (input.action === 'generate_trust_keypair') {
      if (!input.public_key_path?.trim()) {
        return {
          result: false,
          message: 'public_key_path is required for action=generate_trust_keypair',
          errorCode: 400,
        }
      }
      if (!input.private_key_path?.trim()) {
        return {
          result: false,
          message: 'private_key_path is required for action=generate_trust_keypair',
          errorCode: 400,
        }
      }
    }
    if (input.action === 'sign_mode') {
      if (!input.publisher_id?.trim()) {
        return {
          result: false,
          message: 'publisher_id is required for action=sign_mode',
          errorCode: 400,
        }
      }
      if (!input.private_key_path?.trim()) {
        return {
          result: false,
          message: 'private_key_path is required for action=sign_mode',
          errorCode: 400,
        }
      }
    }
    if (input.action === 'publish_marketplace_mode' && !input.publisher_id?.trim()) {
      return {
        result: false,
        message: 'publisher_id is required for action=publish_marketplace_mode',
        errorCode: 400,
      }
    }
    if (input.action === 'sync_mode_marketplace' && !input.marketplace_source?.trim()) {
      return {
        result: false,
        message: 'marketplace_source is required for action=sync_mode_marketplace',
        errorCode: 400,
      }
    }
    if (input.action === 'install_marketplace_mode' && !input.mode_id?.trim()) {
      return {
        result: false,
        message: 'mode_id is required for action=install_marketplace_mode',
        errorCode: 400,
      }
    }
    if (input.action === 'revoke_marketplace_mode') {
      if (!input.mode_id?.trim()) {
        return {
          result: false,
          message: 'mode_id is required for action=revoke_marketplace_mode',
          errorCode: 400,
        }
      }
      if (!input.mode_version?.trim()) {
        return {
          result: false,
          message: 'mode_version is required for action=revoke_marketplace_mode',
          errorCode: 400,
        }
      }
      if (!input.publisher_id?.trim()) {
        return {
          result: false,
          message: 'publisher_id is required for action=revoke_marketplace_mode',
          errorCode: 400,
        }
      }
      if (!input.revocation_reason?.trim()) {
        return {
          result: false,
          message: 'revocation_reason is required for action=revoke_marketplace_mode',
          errorCode: 400,
        }
      }
    }
    if (input.action === 'lint_mode' && !input.source_dir?.trim()) {
      return {
        result: false,
        message: 'source_dir is required for action=lint_mode',
        errorCode: 400,
      }
    }
    if (input.action === 'create_mode') {
      if (!input.target_dir?.trim()) {
        return {
          result: false,
          message: 'target_dir is required for action=create_mode',
          errorCode: 400,
        }
      }
      if (!input.mode_id?.trim()) {
        return {
          result: false,
          message: 'mode_id is required for action=create_mode',
          errorCode: 400,
        }
      }
      if (!input.mode_name?.trim()) {
        return {
          result: false,
          message: 'mode_name is required for action=create_mode',
          errorCode: 400,
        }
      }
      if (!input.mode_description?.trim()) {
        return {
          result: false,
          message: 'mode_description is required for action=create_mode',
          errorCode: 400,
        }
      }
    }
    if (input.action === 'run_task_file' && !input.task_path?.trim()) {
      return {
        result: false,
        message: 'task_path is required for action=run_task_file',
        errorCode: 400,
      }
    }
    if (input.action === 'check_workspace_policy' && !input.task_path?.trim()) {
      return {
        result: false,
        message: 'task_path is required for action=check_workspace_policy',
        errorCode: 400,
      }
    }
    if (input.action === 'start_task' && !input.objective?.trim()) {
      return {
        result: false,
        message: 'objective is required for action=start_task',
        errorCode: 400,
      }
    }
    if (
      (input.action === 'list_approvals' ||
        input.action === 'list_artifact_reviews' ||
        input.action === 'record_artifact_review' ||
        input.action === 'inspect_run' ||
        input.action === 'approve_request' ||
        input.action === 'reject_request') &&
      !input.run_dir?.trim()
    ) {
      return {
        result: false,
        message: `run_dir is required for action=${input.action}`,
        errorCode: 400,
      }
    }
    if (input.action === 'record_artifact_review') {
      if (!input.artifact_ref?.trim()) {
        return {
          result: false,
          message: 'artifact_ref is required for action=record_artifact_review',
          errorCode: 400,
        }
      }
      if (input.artifact_review_status === undefined) {
        return {
          result: false,
          message:
            'artifact_review_status is required for action=record_artifact_review',
          errorCode: 400,
        }
      }
    }
    if (
      (input.action === 'approve_request' ||
        input.action === 'reject_request') &&
      !input.approval_id?.trim()
    ) {
      return {
        result: false,
        message: `approval_id is required for action=${input.action}`,
        errorCode: 400,
      }
    }
    if (
      input.action === 'call_registered_tool' ||
      input.action === 'run_scheduler_step' ||
      input.action === 'retry_scheduler_step' ||
      input.action === 'run_scheduler'
    ) {
      if (!input.run_dir?.trim()) {
        return {
          result: false,
          message: `run_dir is required for action=${input.action}`,
          errorCode: 400,
        }
      }
      if (
        input.action === 'call_registered_tool' &&
        !input.tool_id?.trim() &&
        !input.tool_name?.trim()
      ) {
        return {
          result: false,
          message:
            'tool_id or tool_name is required for action=call_registered_tool',
          errorCode: 400,
        }
      }
      if (
        (input.action === 'run_scheduler_step' ||
          input.action === 'retry_scheduler_step') &&
        !input.scheduler_step_id?.trim() &&
        !input.scheduler_mode_id?.trim()
      ) {
        return {
          result: false,
          message:
            `scheduler_step_id or scheduler_mode_id is required for action=${input.action}`,
          errorCode: 400,
        }
      }
    }
    return { result: true }
  },
  async call(
    input: Input,
    context?: ToolUseContext,
    canUseTool?: CanUseToolFn,
    parentMessage?: AssistantMessage,
  ): Promise<ToolResult<Output>> {
    const cwd = getCwd()
    const stateRoot = getAwmpStateRoot(cwd)
    const modeRoots = resolveModeRoots({
      cwd,
      explicitModeRoots: input.mode_root === undefined ? [] : [input.mode_root],
      taskPath: input.task_path,
    })

    if (input.action === 'list_modes') {
      const modes = await discoverModePackages(modeRoots)
      return {
        data: {
          action: input.action,
          summary: summarizeModes(modes),
          state_root: stateRoot,
          mode_roots: modeRoots,
          modes: modes.map(toModeOutput),
        },
      }
    }

    if (input.action === 'route_request') {
      const routed = await routeAwmpRequest({
        query: input.query!,
        cwd,
        modeRoots: input.mode_root === undefined ? [] : [input.mode_root],
        taskPath: input.task_path,
      })
      return {
        data: {
          action: input.action,
          summary:
            routed.candidates.length === 0
              ? 'No matching AWMP modes found.'
              : `Matched ${routed.candidates.length} AWMP mode(s).`,
          state_root: stateRoot,
          mode_roots: routed.modeRoots,
          candidates: routed.candidates.map(hit => ({
            id: hit.modePackage.mode.id,
            name: hit.modePackage.mode.name,
            score: hit.score,
            reasons: hit.reasons,
          })),
        },
      }
    }

    if (input.action === 'create_mode') {
      const result = await scaffoldModePackage({
        targetDir: resolve(input.target_dir!),
        id: input.mode_id!,
        name: input.mode_name!,
        description: input.mode_description!,
        intents: input.mode_intents,
        artifactTypes: input.artifact_types,
        force: input.force ?? false,
      })
      const lint = await lintModePackage(result.root)
      return {
        data: {
          action: input.action,
          summary: `Created AWMP mode ${result.modePackage.mode.id}. Lint ${lint.ok ? 'passed' : 'failed'}.`,
          state_root: stateRoot,
          installed_root: result.root,
          created_files: result.createdFiles,
          lint_ok: lint.ok,
          diagnostics: lint.diagnostics,
          modes: [toModeOutput(result.modePackage)],
        },
      }
    }

    if (input.action === 'lint_mode') {
      const lint = await lintModePackage(resolve(input.source_dir!))
      return {
        data: {
          action: input.action,
          summary: `AWMP mode lint ${lint.ok ? 'passed' : 'failed'}.`,
          state_root: stateRoot,
          lint_ok: lint.ok,
          diagnostics: lint.diagnostics,
          modes:
            lint.modePackage === undefined
              ? undefined
              : [toModeOutput(lint.modePackage)],
        },
      }
    }

    if (input.action === 'install_mode') {
      const installed = await installModePackage({
        sourceDir: input.source_dir!,
        cwd,
        force: input.force ?? false,
      })
      return {
        data: {
          action: input.action,
          summary: `${installed.replaced ? 'Reinstalled' : 'Installed'} AWMP mode ${installed.modePackage.mode.id}.`,
          state_root: stateRoot,
          installed_root: installed.installedRoot,
          modes: [toModeOutput(installed.modePackage)],
        },
      }
    }

    if (input.action === 'catalog_modes') {
      const catalog =
        input.mode_root === undefined
          ? await loadModeCatalog({
              cwd,
              catalogPath: input.catalog_path,
            })
          : await buildModeCatalogFromRoots({
              cwd,
              catalogPath: input.catalog_path,
              modeRoots,
              write: false,
            })
      return {
        data: {
          action: input.action,
          summary: `AWMP mode catalog contains ${catalog.entries.length} entr${catalog.entries.length === 1 ? 'y' : 'ies'}.`,
          state_root: stateRoot,
          mode_roots: input.mode_root === undefined ? undefined : modeRoots,
          mode_catalog_path: catalog.catalogPath,
          mode_catalog: catalog,
        },
      }
    }

    if (input.action === 'publish_mode') {
      const result = await publishModeToCatalog({
        modeDir: input.source_dir!,
        cwd,
        catalogPath: input.catalog_path,
        force: input.force ?? false,
      })
      return {
        data: {
          action: input.action,
          summary: `${result.replaced ? 'Replaced' : 'Published'} AWMP mode ${result.entry.id}@${result.entry.version}.`,
          state_root: stateRoot,
          mode_catalog_path: result.catalogPath,
          mode_catalog: result.catalog,
          mode_catalog_entry: result.entry,
        },
      }
    }

    if (input.action === 'export_mode_bundle') {
      const result = await exportModeBundle({
        modeDir: input.source_dir!,
        cwd,
        bundlePath: input.bundle_path,
        force: input.force ?? false,
      })
      return {
        data: {
          action: input.action,
          summary: `Exported AWMP mode bundle ${result.bundle.modeId}@${result.bundle.version}.`,
          state_root: stateRoot,
          mode_bundle_path: result.bundlePath,
          mode_bundle: result.bundle,
          mode_bundle_file_count: result.fileCount,
          mode_bundle_total_bytes: result.totalBytes,
        },
      }
    }

    if (input.action === 'install_mode_bundle') {
      const result = await installModeBundle({
        cwd,
        bundlePath: input.bundle_path!,
        force: input.force ?? false,
      })
      return {
        data: {
          action: input.action,
          summary: `${result.replaced ? 'Replaced' : 'Installed'} AWMP mode bundle ${result.modePackage.mode.id}@${result.modePackage.mode.version}.`,
          state_root: stateRoot,
          installed_root: result.installedRoot,
          mode_bundle_path: result.bundlePath,
          modes: [toModeOutput(result.modePackage)],
        },
      }
    }

    if (input.action === 'read_mode_lock') {
      const lock = await loadModeLock({
        cwd,
        lockPath: input.lock_path,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP mode lock contains ${lock.entries.length} entr${lock.entries.length === 1 ? 'y' : 'ies'}.`,
          state_root: stateRoot,
          mode_lock_path: lock.lockPath,
          mode_lock: lock,
        },
      }
    }

    if (input.action === 'lock_mode') {
      const result = await lockModePackage({
        modeDir: input.source_dir!,
        cwd,
        lockPath: input.lock_path,
        force: input.force ?? false,
      })
      return {
        data: {
          action: input.action,
          summary: `${result.replaced ? 'Replaced' : 'Locked'} AWMP mode ${result.entry.id}@${result.entry.version}.`,
          state_root: stateRoot,
          mode_lock_path: result.lockPath,
          mode_lock: result.lock,
          mode_lock_entry: result.entry,
        },
      }
    }

    if (input.action === 'verify_mode_lock') {
      const verification = await verifyModeLock({
        cwd,
        lockPath: input.lock_path,
        modeDir: input.source_dir,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP mode lock verification ${verification.ok ? 'passed' : 'failed'} for ${verification.checked.length} entr${verification.checked.length === 1 ? 'y' : 'ies'}.`,
          state_root: stateRoot,
          mode_lock_path: verification.lockPath,
          mode_lock_verification: verification,
        },
      }
    }

    if (input.action === 'generate_trust_keypair') {
      const result = await generateModeTrustKeyPair({
        publicKeyPath: input.public_key_path!,
        privateKeyPath: input.private_key_path!,
        force: input.force ?? false,
      })
      return {
        data: {
          action: input.action,
          summary: `Generated AWMP trust keypair at ${result.publicKeyPath}.`,
          state_root: stateRoot,
          trust_public_key_path: result.publicKeyPath,
          trust_private_key_path: result.privateKeyPath,
        },
      }
    }

    if (input.action === 'read_mode_trust') {
      const trust = await loadModeTrust({
        cwd,
        trustPath: input.trust_path,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP mode trust store contains ${trust.signatures.length} signature${trust.signatures.length === 1 ? '' : 's'}.`,
          state_root: stateRoot,
          mode_trust_path: trust.trustPath,
          mode_trust: trust,
        },
      }
    }

    if (input.action === 'sign_mode') {
      const result = await signModePackage({
        modeDir: input.source_dir!,
        cwd,
        trustPath: input.trust_path,
        publisherId: input.publisher_id!,
        privateKeyPath: input.private_key_path!,
        force: input.force ?? false,
      })
      return {
        data: {
          action: input.action,
          summary: `${result.replaced ? 'Replaced' : 'Signed'} AWMP mode ${result.signature.modeId}@${result.signature.version} by ${result.signature.publisherId}.`,
          state_root: stateRoot,
          mode_trust_path: result.trustPath,
          mode_trust: result.trust,
          mode_signature: result.signature,
        },
      }
    }

    if (input.action === 'verify_mode_signature') {
      const verification = await verifyModeSignature({
        cwd,
        trustPath: input.trust_path,
        modeDir: input.source_dir,
        publisherId: input.publisher_id,
        publicKeyPath: input.public_key_path,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP mode signature verification ${verification.ok ? 'passed' : 'failed'} for ${verification.checked.length} entr${verification.checked.length === 1 ? 'y' : 'ies'}.`,
          state_root: stateRoot,
          mode_trust_path: verification.trustPath,
          mode_signature_verification: verification,
        },
      }
    }

    if (input.action === 'read_mode_marketplace') {
      const marketplace = await loadModeMarketplace({
        cwd,
        marketplacePath: input.marketplace_path,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP mode marketplace contains ${marketplace.entries.length} entr${marketplace.entries.length === 1 ? 'y' : 'ies'}.`,
          state_root: stateRoot,
          mode_marketplace_path: marketplace.marketplacePath,
          mode_marketplace: marketplace,
        },
      }
    }

    if (input.action === 'publish_marketplace_mode') {
      const result = await publishModeToMarketplace({
        modeDir: input.source_dir!,
        cwd,
        marketplacePath: input.marketplace_path,
        trustPath: input.trust_path,
        publisherId: input.publisher_id!,
        privateKeyPath: input.private_key_path,
        force: input.force ?? false,
      })
      return {
        data: {
          action: input.action,
          summary: `${result.replaced ? 'Replaced' : 'Published'} AWMP marketplace mode ${result.entry.modeId}@${result.entry.version} by ${result.entry.publisherId}.`,
          state_root: stateRoot,
          mode_marketplace_path: result.marketplacePath,
          mode_marketplace: result.marketplace,
          mode_marketplace_entry: result.entry,
          mode_signature: result.signature,
        },
      }
    }

    if (input.action === 'sync_mode_marketplace') {
      const result = await syncModeMarketplace({
        cwd,
        source: input.marketplace_source!,
        marketplacePath: input.marketplace_path,
        sourceId: input.marketplace_source_id,
        force: input.force ?? false,
      })
      return {
        data: {
          action: input.action,
          summary: `Synced AWMP mode marketplace from ${result.sourceId}: ${result.added} added, ${result.updated} updated, ${result.revoked} revoked, ${result.unchanged} unchanged.`,
          state_root: stateRoot,
          mode_marketplace_path: result.marketplacePath,
          mode_marketplace: result.marketplace,
          mode_marketplace_sync: result,
        },
      }
    }

    if (input.action === 'revoke_marketplace_mode') {
      const entry = await revokeMarketplaceMode({
        cwd,
        marketplacePath: input.marketplace_path,
        modeId: input.mode_id!,
        version: input.mode_version!,
        publisherId: input.publisher_id!,
        reason: input.revocation_reason!,
        revokedBy: input.revoked_by,
      })
      return {
        data: {
          action: input.action,
          summary: `Revoked AWMP marketplace mode ${entry.modeId}@${entry.version} by ${entry.publisherId}.`,
          state_root: stateRoot,
          mode_marketplace_path: input.marketplace_path,
          mode_marketplace_entry: entry,
        },
      }
    }

    if (input.action === 'verify_mode_marketplace') {
      const verification = await verifyModeMarketplace({
        cwd,
        marketplacePath: input.marketplace_path,
        trustPath: input.trust_path,
        modeDir: input.source_dir,
        publisherId: input.publisher_id,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP mode marketplace verification ${verification.ok ? 'passed' : 'failed'} for ${verification.checked.length} entr${verification.checked.length === 1 ? 'y' : 'ies'}.`,
          state_root: stateRoot,
          mode_marketplace_path: verification.marketplacePath,
          mode_marketplace_verification: verification,
        },
      }
    }

    if (input.action === 'read_workspace_policy') {
      const policy = await loadWorkspacePolicy({
        cwd,
        policyPath: input.policy_path,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP workspace policy: requireModeLock=${policy.requireModeLock}, allowed=${policy.allowedModeIds.length}, denied=${policy.deniedModeIds.length}.`,
          state_root: stateRoot,
          workspace_policy_path: policy.policyPath,
          workspace_policy: policy,
        },
      }
    }

    if (input.action === 'set_workspace_policy') {
      const policy = await updateWorkspacePolicy({
        cwd,
        policyPath: input.policy_path,
        requireModeLock: input.require_mode_lock,
        requireModeSignature: input.require_mode_signature,
        requireMarketplaceApproval: input.require_marketplace_approval,
        modeLockPath: input.policy_mode_lock_path,
        modeTrustPath: input.policy_mode_trust_path,
        modeMarketplacePath:
          input.policy_marketplace_path ?? input.marketplace_path,
        trustedPublisherIds: input.trusted_publisher_ids,
        allowedModeIds: input.allowed_mode_ids,
        deniedModeIds: input.denied_mode_ids,
        maxModesPerTask: input.max_modes_per_task,
        clearAllowedModeIds: input.clear_allowed_mode_ids === true,
        clearDeniedModeIds: input.clear_denied_mode_ids === true,
        clearTrustedPublisherIds: input.clear_trusted_publisher_ids === true,
      })
      return {
        data: {
          action: input.action,
          summary: `Updated AWMP workspace policy at ${policy.policyPath}.`,
          state_root: stateRoot,
          workspace_policy_path: policy.policyPath,
          workspace_policy: policy,
        },
      }
    }

    if (input.action === 'check_workspace_policy') {
      const check = await checkWorkspacePolicyForTaskFile({
        taskPath: resolve(input.task_path!),
        cwd,
        modeRoots: input.mode_root === undefined ? [] : [input.mode_root],
        policyPath: input.policy_path,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP workspace policy check ${check.ok ? 'passed' : 'failed'} for ${check.selectedModeIds.length} selected mode(s).`,
          state_root: stateRoot,
          workspace_policy_path: check.policyPath,
          workspace_policy: check.policy,
          workspace_policy_check: check,
        },
      }
    }

    if (input.action === 'eval_mode') {
      const report = await runModeEvals({
        modeDir: input.source_dir!,
        cwd,
        executeValidators: input.execute_validators === true,
        validatorTimeoutMs: input.validator_timeout_ms,
        runScheduler: input.eval_run_scheduler === true,
        schedulerMaxSteps: input.scheduler_max_steps,
        toolTimeoutMs: input.tool_timeout_ms,
        applyReviewFixtures: input.apply_review_fixtures === true,
        reportPath: input.report_path,
      })
      return {
        data: {
          action: input.action,
          summary: `Evaluated ${report.mode.id}@${report.mode.version}: ${report.summary.passed}/${report.summary.total} golden task(s) passed.`,
          state_root: stateRoot,
          mode_eval_report_path: report.reportPath,
          mode_eval_report: report,
        },
      }
    }

    if (input.action === 'run_task_file') {
      const result = await runAwmpTaskFile(resolve(input.task_path!), {
        cwd,
        modeRoots: input.mode_root === undefined ? [] : [input.mode_root],
        executeValidators: input.execute_validators === true,
        validatorTimeoutMs: input.validator_timeout_ms,
        policyPath: input.policy_path,
      })
      return {
        data: toRunOutput(input.action, stateRoot, result),
      }
    }

    if (input.action === 'list_approvals') {
      const approvals = await listApprovalRequests(resolve(input.run_dir!))
      return {
        data: {
          action: input.action,
          summary: `Found ${approvals.approvals.length} AWMP approval request(s).`,
          state_root: stateRoot,
          run_dir: approvals.runDir,
          approvals: approvals.approvals.map(toApprovalOutput),
        },
      }
    }

    if (input.action === 'list_artifact_reviews') {
      const reviews = await listArtifactReviews(resolve(input.run_dir!))
      return {
        data: {
          action: input.action,
          summary: `Found ${reviews.reviews.length} AWMP artifact review(s).`,
          state_root: stateRoot,
          run_dir: reviews.runDir,
          artifact_reviews: reviews.reviews.map(toArtifactReviewOutput),
        },
      }
    }

    if (input.action === 'record_artifact_review') {
      const review = await recordArtifactReview({
        runDir: resolve(input.run_dir!),
        artifactRef: input.artifact_ref!,
        status: input.artifact_review_status!,
        reviewedBy: input.artifact_reviewed_by,
        note: input.artifact_review_note,
        requestedChanges: input.artifact_review_changes,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP artifact review ${review.id} recorded as ${review.status}.`,
          state_root: stateRoot,
          run_dir: review.runDir,
          artifact_reviews: [toArtifactReviewOutput(review)],
        },
      }
    }

    if (input.action === 'inspect_run') {
      const report = await inspectAwmpRun({
        runDir: resolve(input.run_dir!),
      })
      return {
        data: {
          action: input.action,
          summary: `Inspected AWMP run ${report.task.id}. Evidence gaps: ${report.evidenceGaps.length}.`,
          state_root: stateRoot,
          run_dir: report.runDir,
          run_report_path: report.reportPath,
          run_report: report,
        },
      }
    }

    if (input.action === 'eval_runs') {
      const runsRoot = resolve(
        input.runs_root ?? join(getAwmpStateRoot(cwd), 'runs'),
      )
      const report = await evaluateAwmpRuns({
        runsRoot,
      })
      return {
        data: {
          action: input.action,
          summary: `Evaluated ${report.runCount} AWMP run(s). Evidence gaps: ${report.evidenceGaps.length}.`,
          state_root: stateRoot,
          runs_root: runsRoot,
          eval_report_path: report.reportPath,
          eval_report: report,
        },
      }
    }

    if (input.action === 'approve_request' || input.action === 'reject_request') {
      const approval = await decideApprovalRequest({
        runDir: resolve(input.run_dir!),
        approvalId: input.approval_id!,
        decision: input.action === 'approve_request' ? 'approved' : 'rejected',
        decidedBy: input.approval_decided_by,
        note: input.approval_note,
      })
      return {
        data: {
          action: input.action,
          summary: `AWMP approval ${approval.id} is ${approval.status}.`,
          state_root: stateRoot,
          run_dir: approval.runDir,
          approvals: [toApprovalOutput(approval)],
        },
      }
    }

    if (input.action === 'call_registered_tool') {
      const result = await withSessionMcpAdapters(
        {
          context,
          canUseTool,
          parentMessage,
        },
        () =>
          callRegisteredTool({
            runDir: input.run_dir!,
            toolId: input.tool_id,
            toolName: input.tool_name,
            input: input.tool_input,
            approved: input.approve_tool_call === true,
            approvalId: input.approval_id,
            timeoutMs: input.tool_timeout_ms,
          }),
      )
      return {
        data: {
          action: input.action,
          summary: result.message,
          state_root: stateRoot,
          run_dir: result.runDir,
          tool_call: {
            id: result.id,
            status: result.status,
            message: result.message,
            resultPath: result.resultPath,
            approvalRequestId: result.approvalRequestId,
            exitCode: result.exitCode,
            httpStatus: result.httpStatus,
            stdout: result.stdout,
            stderr: result.stderr,
          },
        },
      }
    }

    if (input.action === 'run_scheduler_step') {
      const result = await withSessionMcpAdapters(
        {
          context,
          canUseTool,
          parentMessage,
        },
        () =>
          runAwmpSchedulerStep({
            runDir: input.run_dir!,
            stepId: input.scheduler_step_id,
            modeId: input.scheduler_mode_id,
            toolId: input.tool_id,
            toolName: input.tool_name,
            toolInput: input.tool_input,
            approved: input.approve_tool_call === true,
            approvalId: input.approval_id,
            timeoutMs: input.tool_timeout_ms,
            executeValidators: input.execute_validators === true,
            validatorTimeoutMs: input.validator_timeout_ms,
          }),
      )
      return {
        data: {
          action: input.action,
          summary: result.message,
          state_root: stateRoot,
          run_dir: result.runDir,
          scheduler_path: result.schedulerPath,
          context_path: result.contextPath,
          scheduler_step: {
            id: result.step.id,
            modeId: result.step.modeId,
            state: result.step.state,
            attemptCount: result.step.attemptCount,
            nextAction: result.step.nextAction,
            blockedReason: result.step.blockedReason,
            lastFailureKind: result.step.lastFailureKind,
            retryable: result.step.retryable,
            retryAfter: result.step.retryAfter,
            retryPolicy: result.step.retryPolicy,
            lastToolCallResultPath: result.step.lastToolCallResultPath,
            registeredArtifactIds: result.step.registeredArtifactIds,
            registeredArtifactUris: result.step.registeredArtifactUris,
            validationSummary: result.step.validationSummary,
          },
          tool_call:
            result.toolCall === undefined
              ? undefined
              : {
                  id: result.toolCall.id,
                  status: result.toolCall.status,
                  message: result.toolCall.message,
                  resultPath: result.toolCall.resultPath,
                  approvalRequestId: result.toolCall.approvalRequestId,
                  exitCode: result.toolCall.exitCode,
                  httpStatus: result.toolCall.httpStatus,
                  stdout: result.toolCall.stdout,
                  stderr: result.toolCall.stderr,
                },
        },
      }
    }

    if (input.action === 'retry_scheduler_step') {
      const result = await withSessionMcpAdapters(
        {
          context,
          canUseTool,
          parentMessage,
        },
        () =>
          retryAwmpSchedulerStep({
            runDir: input.run_dir!,
            stepId: input.scheduler_step_id,
            modeId: input.scheduler_mode_id,
            toolId: input.tool_id,
            toolName: input.tool_name,
            toolInput: input.tool_input,
            approved: input.approve_tool_call === true,
            approvalId: input.approval_id,
            timeoutMs: input.tool_timeout_ms,
            executeValidators: input.execute_validators === true,
            validatorTimeoutMs: input.validator_timeout_ms,
            force: input.force_retry === true,
          }),
      )
      return {
        data: {
          action: input.action,
          summary: result.message,
          state_root: stateRoot,
          run_dir: result.runDir,
          scheduler_path: result.schedulerPath,
          context_path: result.contextPath,
          scheduler_step: {
            id: result.step.id,
            modeId: result.step.modeId,
            state: result.step.state,
            attemptCount: result.step.attemptCount,
            nextAction: result.step.nextAction,
            blockedReason: result.step.blockedReason,
            lastFailureKind: result.step.lastFailureKind,
            retryable: result.step.retryable,
            retryAfter: result.step.retryAfter,
            retryPolicy: result.step.retryPolicy,
            lastToolCallResultPath: result.step.lastToolCallResultPath,
            registeredArtifactIds: result.step.registeredArtifactIds,
            registeredArtifactUris: result.step.registeredArtifactUris,
            validationSummary: result.step.validationSummary,
          },
          tool_call:
            result.toolCall === undefined
              ? undefined
              : {
                  id: result.toolCall.id,
                  status: result.toolCall.status,
                  message: result.toolCall.message,
                  resultPath: result.toolCall.resultPath,
                  approvalRequestId: result.toolCall.approvalRequestId,
                  exitCode: result.toolCall.exitCode,
                  httpStatus: result.toolCall.httpStatus,
                  stdout: result.toolCall.stdout,
                  stderr: result.toolCall.stderr,
                },
        },
      }
    }

    if (input.action === 'run_scheduler') {
      const result = await withSessionMcpAdapters(
        {
          context,
          canUseTool,
          parentMessage,
        },
        () =>
          runAwmpScheduler({
            runDir: input.run_dir!,
            maxSteps: input.scheduler_max_steps,
            timeoutMs: input.tool_timeout_ms,
            executeValidators: input.execute_validators === true,
            validatorTimeoutMs: input.validator_timeout_ms,
          }),
      )
      return {
        data: {
          action: input.action,
          summary: result.message,
          state_root: stateRoot,
          run_dir: result.runDir,
          scheduler_path: result.schedulerPath,
          context_path: result.contextPath,
          scheduler_steps: result.steps.map(stepResult => ({
            id: stepResult.step.id,
            modeId: stepResult.step.modeId,
            status: stepResult.status,
            state: stepResult.step.state,
            attemptCount: stepResult.step.attemptCount,
            message: stepResult.message,
            nextAction: stepResult.step.nextAction,
            lastFailureKind: stepResult.step.lastFailureKind,
            retryable: stepResult.step.retryable,
            retryAfter: stepResult.step.retryAfter,
            validationSummary: stepResult.step.validationSummary,
          })),
        },
      }
    }

    const modeIds =
      input.mode_ids && input.mode_ids.length > 0
        ? input.mode_ids
        : await inferModeIds({
            objective: input.objective!,
            cwd,
            modeRoot: input.mode_root,
          })
    const task = createTaskContract({
      objective: input.objective!,
      title: input.title,
      modeIds,
      inputs: input.inputs,
      constraints: input.constraints,
    })
    const result = await runAwmpTask(task, {
      cwd,
      modeRoots: input.mode_root === undefined ? [] : [input.mode_root],
      executeValidators: input.execute_validators === true,
      validatorTimeoutMs: input.validator_timeout_ms,
      policyPath: input.policy_path,
    })
    return {
      data: toRunOutput(input.action, stateRoot, result),
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function createTaskContract(input: {
  objective: string
  title?: string
  modeIds: string[]
  inputs?: Record<string, unknown>
  constraints?: Record<string, unknown>
}): AwmpTask {
  const now = new Date().toISOString()
  return {
    awmp: AWMP_VERSION,
    kind: 'Task',
    id: `task_${randomUUID()}`,
    contextId: `ctx_${randomUUID()}`,
    title: input.title?.trim() || deriveTitle(input.objective),
    objective: input.objective,
    modeIds: input.modeIds,
    inputs: input.inputs ?? {},
    status: {
      state: 'submitted',
      timestamp: now,
    },
    constraints: input.constraints ?? {
      network: 'deny',
    },
    artifacts: [],
    traceId: `trace_${randomUUID()}`,
  }
}

async function inferModeIds(input: {
  objective: string
  cwd: string
  modeRoot?: string
}): Promise<string[]> {
  const routed = await routeAwmpRequest({
    query: input.objective,
    cwd: input.cwd,
    modeRoots: input.modeRoot === undefined ? [] : [input.modeRoot],
  })
  return routed.candidates.slice(0, 4).map(hit => hit.modePackage.mode.id)
}

function toModeOutput(modePackage: Awaited<ReturnType<typeof discoverModePackages>>[number]) {
  return {
    id: modePackage.mode.id,
    name: modePackage.mode.name,
    version: modePackage.mode.version,
    description: modePackage.mode.description,
    root: modePackage.root,
    artifact_types:
      modePackage.mode.outputs.artifacts?.map(artifact => artifact.type) ?? [],
    validators: modePackage.mode.validators?.length ?? 0,
  }
}

function toRunOutput(
  action: Input['action'],
  stateRoot: string,
  result: Awaited<ReturnType<typeof runAwmpTask>>,
): Output {
  return {
    action,
    summary: result.summary,
    state_root: stateRoot,
    run_dir: result.runDir,
    trace_path: result.tracePath,
    artifact_store_path: result.artifactStorePath,
    context_path: result.contextPath,
    orchestration_path: result.orchestrationPath,
    handoff_plan_path: result.handoffPlanPath,
    scheduler_path: result.schedulerPath,
    task: result.task,
    modes: result.selectedModes.map(toModeOutput),
    artifacts: result.artifacts.map(artifact => ({
      id: artifact.id,
      type: artifact.type,
      uri: artifact.uri,
    })),
    validations: result.validations,
  }
}

function toApprovalOutput(approval: AwmpApprovalRequest) {
  return {
    id: approval.id,
    status: approval.status,
    toolId: approval.tool.id,
    toolName: approval.tool.name,
    reason: approval.reason,
    requestedAt: approval.requestedAt,
    decidedAt: approval.decidedAt,
    decidedBy: approval.decidedBy,
    requestPath: approval.requestPath,
  }
}

function toArtifactReviewOutput(review: AwmpArtifactReviewRecord) {
  return {
    id: review.id,
    status: review.status,
    accepted: review.accepted,
    reviewedAt: review.reviewedAt,
    reviewedBy: review.reviewedBy,
    artifactId: review.artifact.id,
    artifactType: review.artifact.type,
    artifactUri: review.artifact.uri,
    reviewPath: review.reviewPath,
    note: review.note,
    requestedChanges: review.requestedChanges,
  }
}

function deriveTitle(objective: string): string {
  const clean = objective.replace(/\s+/g, ' ').trim()
  if (clean.length <= 48) return clean
  return `${clean.slice(0, 45)}...`
}

async function withSessionMcpAdapters<T>(
  input: {
    context?: ToolUseContext
    canUseTool?: CanUseToolFn
    parentMessage?: AssistantMessage
  },
  fn: () => Promise<T>,
): Promise<T> {
  if (
    input.context === undefined ||
    input.canUseTool === undefined ||
    input.parentMessage === undefined
  ) {
    return fn()
  }

  const unregister = input.context.options.tools
    .filter((tool): tool is Tool => tool.mcpInfo !== undefined)
    .map(tool =>
      registerAwmpMcpAdapter({
        server: tool.mcpInfo!.serverName,
        tool: tool.mcpInfo!.toolName,
        handler: async adapterInput => {
          const args =
            typeof adapterInput.input === 'object' &&
            adapterInput.input !== null &&
            !Array.isArray(adapterInput.input)
              ? (adapterInput.input as Record<string, unknown>)
              : {}
          const result = await tool.call(
            args,
            input.context!,
            input.canUseTool!,
            input.parentMessage!,
          )
          return {
            status: 'completed',
            message: `Connected MCP tool ${adapterInput.server}.${adapterInput.tool} completed.`,
            data: result.data,
          }
        },
      }),
    )

  try {
    return await fn()
  } finally {
    for (const remove of unregister) {
      remove()
    }
  }
}
