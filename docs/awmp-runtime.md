# AWMP Runtime Substrate

AWMP is Leviathan's Agent Work Mode Protocol substrate. It turns a work request
into traceable runtime records instead of treating every task as an unstructured
chat turn.

## Current Scope

The current implementation is a local v0.1 substrate. It supports:

- Mode package discovery from `mode.yaml` plus `SKILL.md`.
- Mode package scaffolding and static linting for mode authors.
- Natural-language routing against installed or explicitly supplied modes.
- Workspace-local mode installation under `.leviathan/awmp/modes`.
- Local Mode Catalog generation and publishing under
  `.leviathan/awmp/catalog/mode_catalog.json`, including mode capability
  summaries, package digests, and lint status.
- Portable Mode Bundle export/install under `.leviathan/awmp/bundles`,
  allowing a linted mode package to move across workspaces as a verified
  `.awmp-mode.json` file.
- Workspace Policy gates under
  `.leviathan/awmp/control_plane/workspace_policy.json`, including optional
  mode-lock enforcement, signed-mode enforcement, marketplace approval,
  mode allow/deny lists, trusted publishers, and max selected modes per task.
- Local Mode Marketplace records under
  `.leviathan/awmp/marketplace/mode_marketplace.json`, including published mode
  releases, publisher ids, package digests, signature references, and
  active/revoked state. Marketplace entries can also be synced from local or
  HTTP(S) feed JSON sources for cross-workspace revocation distribution.
- Task Contract execution into a run directory under `.leviathan/awmp/runs`.
- Execution Capsule, governance policy, artifact index, validation records, and
  trace log generation.
- Artifact Store snapshots with typed artifact registration and JSON reads.
- Execution Context snapshots that compact task, mode, artifact, validator,
  tool registry, and approval state into a model-usable runtime view.
- Run Inspection and Eval reports that turn persisted AWMP run files into
  evidence-backed metrics and explicit evidence gaps.
- Mode Eval reports that run a mode package's `examples/` golden task JSON files
  through the AWMP substrate and persist package-level regression evidence.
- First-party executable mode examples under `examples/awmp`, including a
  customer-support analysis mode, a presentation mode, and a cross-mode
  support-to-presentation task fixture.
- Explicit artifact review records for produced artifacts. These records are
  the evidence source for Artifact Acceptance Rate.
- Handoff Plan generation for adjacent multi-mode tasks, with blocked handoff
  policies reflected in final task state.
- Durable Scheduler records that turn mode steps into resumable execution states
  (`pending`, `deferred`, `running`, `completed`, `approval_required`,
  `blocked`, or `failed`).
- Scheduler failures record structured recovery metadata: `lastFailureKind`,
  `retryable`, `retryAfter`, and per-step retry policy.
- Scheduler step execution can auto-select one unambiguous non-denied tool owned
  by the step's mode. Ambiguous tool sets stay `deferred` until an explicit
  `tool_id` is supplied.
- Orchestration records for the local task lifecycle:
  `planning -> working -> validating -> completed|failed`.
- Explicit validator execution through a restricted runner.
- Policy-aware Tool Broker calls for `local`, `openapi`, and `mcp` tools.
- Completed scheduler tool calls register a runtime
  `awmp.scheduler_step_result` artifact. If the tool emits a JSON
  `artifact`/`artifacts` object whose type matches the step's expected artifact
  contracts, AWMP also registers that produced artifact.
- Scheduler step validation creates `awmp.scheduler_step_validation` artifacts,
  appends scoped entries to `validations.json`, and writes validation status back
  to produced business artifacts.
- Durable approval requests and decisions for sensitive tool calls.

It intentionally does not fabricate business data or grant ambient authority to
declared tools.

## Runtime Artifacts

Each AWMP run writes a self-contained directory:

```text
.leviathan/awmp/runs/<timestamp>_<task-id>/
  task.json
  task.draft.json
  capsule.json
  handoff_plan.json
  scheduler.json
  orchestration.json
  trace.jsonl
  validations.json
  context/
    execution_context.json
  modes/<mode-id>/
  artifacts/
    index.json
    store.json
    execution_plan.json
    governance_policy.json
    tool_registry.json
    tool_calls/*.json
    scheduler_step_result_*.json
    scheduler_step_validation_*.json
    approvals/
      index.json
      approval_<id>.json
    reviews/
      index.json
      review_<id>.json
  reports/
    run_inspection.json
```

These records are the first layer of an Agent Work Execution Plane: the agent can
resume, inspect, validate, and govern a task through files with stable meaning.

Workspace-level AWMP state also includes the local mode catalog when mode
packages are published, and mode eval reports when golden task suites are run:

```text
.leviathan/awmp/catalog/
  mode_catalog.json
  mode_lock.json
  mode_trust.json
.leviathan/awmp/bundles/
  *.awmp-mode.json
.leviathan/awmp/marketplace/
  mode_marketplace.json
.leviathan/awmp/control_plane/
  workspace_policy.json
.leviathan/awmp/evals/<mode-id>/
  mode_eval_<timestamp>_<id>.json
```

The catalog is not a second source of truth for the mode package. It is a
discoverable marketplace-style index derived from `mode.yaml`, `SKILL.md`,
declared tools, permissions, validators, artifacts, handoffs, lint results, and a
package digest.

## Mode Catalog

`src/awmp/modeCatalog.ts` provides the local registry layer for AWMP modes. It
supports:

- building a transient catalog from one or more mode roots;
- publishing a linted mode package into a durable workspace catalog;
- recording a deterministic `sha256:` digest over the package files;
- summarizing activation intents, input keys, artifact types, tool kinds,
  permissions, validators, and handoff declarations.

The current catalog is local-first. It is the engineering bridge toward a future
Mode Marketplace, but it does not implement tenant policy, billing, package
hosting, or trust scoring. Local signature metadata is handled separately by
Mode Trust.

## Mode Bundle

`src/awmp/modeBundle.ts` adds a portable package layer for AWMP modes. The
catalog answers what a mode can do. The bundle answers how the mode package can
be carried to another workspace without relying on the original filesystem path.

The default bundle output directory is:

```text
.leviathan/awmp/bundles/
```

A bundle records:

- mode id, version, name, description, and package digest;
- the mode's catalog capability summary;
- every bundled file as a relative path, byte size, sha256 digest, and base64
  content;
- lint summary at export time.

The CLI can export and install bundles:

```text
/awmp export-bundle <mode-dir> [--bundle <bundle-path>] [--force]
/awmp install-bundle <bundle-path> [--force]
```

The model-facing `AWMP` tool exposes the same layer through
`export_mode_bundle` and `install_mode_bundle`.

Bundle installation writes files to a temporary workspace mode directory,
verifies per-file digests, recomputes the full package digest, runs mode lint,
and only then replaces the installed mode root. This is the local package
hosting substrate; it is not yet a compressed archive service, remote package
store, or signed distribution channel by itself.

## Mode Lock

`src/awmp/modeLock.ts` adds a reproducibility layer on top of the local catalog.
The catalog answers "what modes are available"; the lock answers "which exact
mode package digests is this workspace pinned to".

The lock file lives at:

```text
.leviathan/awmp/catalog/mode_lock.json
```

It records:

- mode id, name, version, root, and local source path;
- deterministic `sha256:` package digest;
- lock timestamp;
- lint summary at lock time.

The CLI can write and verify lock entries:

```text
/awmp lock-mode <mode-dir> [--lock <lock-path>] [--force]
/awmp mode-lock [--lock <lock-path>]
/awmp verify-lock [mode-dir] [--lock <lock-path>]
```

The model-facing `AWMP` tool exposes the same layer through
`read_mode_lock`, `lock_mode`, and `verify_mode_lock`.

This is not remote package signing. It is the local foundation for version
locks, drift detection, and later marketplace trust metadata. A mismatched lock
means the mode package changed after it was pinned and should be reviewed before
being treated as the same reusable work capability.

## Mode Trust

`src/awmp/modeTrust.ts` adds a local trust layer for mode package distribution.
The catalog answers what modes are available. The lock answers which exact
digests are pinned. The trust store answers which publisher signed a package
digest and whether that signature still verifies.

The trust store lives at:

```text
.leviathan/awmp/catalog/mode_trust.json
```

It records:

- mode id, version, root, publisher id, and package digest;
- Ed25519 public key and signature;
- signed payload binding `modeId`, `version`, `packageDigest`, and
  `publisherId`;
- lint summary at signing time.

Private keys are never stored in `mode_trust.json`. They are written only to the
explicit path supplied by the user when generating a keypair.

The CLI can generate keys, sign modes, inspect trust records, and verify
signatures:

```text
/awmp trust-keygen --public-key <path> --private-key <path> [--force]
/awmp sign-mode <mode-dir> --publisher <id> --private-key <path> [--trust <trust-path>] [--force]
/awmp mode-trust [--trust <trust-path>]
/awmp verify-signature [mode-dir] [--trust <trust-path>] [--publisher <id>] [--public-key <path>]
```

The model-facing `AWMP` tool exposes the same layer through
`generate_trust_keypair`, `read_mode_trust`, `sign_mode`, and
`verify_mode_signature`.

This is a local signing substrate, not a full marketplace PKI. It is enough to
prove the runtime can distinguish "this mode package has the exact signed digest
from a trusted publisher" from "this package is unsigned, drifted, or signed by
an untrusted publisher".

## Mode Marketplace

`src/awmp/modeMarketplace.ts` adds the first local marketplace contract. Mode
Trust answers whether a package digest has a valid publisher signature.
Marketplace answers whether that signed release is currently allowed to be
distributed and executed.

The marketplace file lives at:

```text
.leviathan/awmp/marketplace/mode_marketplace.json
```

It records:

- mode id, name, version, root, publisher id, and package digest;
- the catalog capability summary for that release;
- optional signature id from Mode Trust;
- optional inline public signature record, allowing a synced feed entry to be
  verified in another workspace without sharing the publisher's local trust
  store;
- source metadata for locally published or remotely synced entries;
- release status: `active` or `revoked`;
- revocation reason, actor, and timestamp when a release is revoked.

The CLI can publish, inspect, verify, sync, and revoke marketplace releases:

```text
/awmp marketplace [--marketplace <marketplace-path>]
/awmp marketplace-publish <mode-dir> --publisher <id> [--marketplace <marketplace-path>] [--trust <trust-path>] [--private-key <path>] [--force]
/awmp marketplace-verify [mode-dir] [--marketplace <marketplace-path>] [--trust <trust-path>] [--publisher <id>]
/awmp marketplace-sync <source-file-or-url> [--marketplace <marketplace-path>] [--source-id <id>] [--force]
/awmp marketplace-revoke <mode-id> --version <version> --publisher <id> --reason <text> [--by <name>] [--marketplace <marketplace-path>]
```

The model-facing `AWMP` tool exposes the same layer through
`read_mode_marketplace`, `publish_marketplace_mode`,
`verify_mode_marketplace`, `sync_mode_marketplace`, and
`revoke_marketplace_mode`.

This is not yet a hosted marketplace service. It is a local, test-covered
distribution contract with file/HTTP feed sync. It lets Workspace Policy
distinguish "this release is active and signed" from "this release was revoked
after publication", including when the active/revoked entry was imported from
another workspace's feed.

## Workspace Policy

`src/awmp/workspacePolicy.ts` is the first local Control Plane gate. The catalog
answers what is available, and the mode lock answers what exact package digests
are pinned. Workspace Policy decides whether a resolved task is allowed to enter
the runtime at all.

The policy file lives at:

```text
.leviathan/awmp/control_plane/workspace_policy.json
```

It can currently express:

- `requireModeLock`: every selected mode must match the workspace mode lock;
- `requireModeSignature`: every selected mode must have a valid signature;
- `requireMarketplaceApproval`: every selected mode must have an active
  marketplace entry backed by a valid signature;
- `trustedPublisherIds`: optional publisher allow list for signed modes;
- `allowedModeIds`: optional allow list for executable modes;
- `deniedModeIds`: deny list for modes that must not execute;
- `maxModesPerTask`: simple blast-radius control for multi-mode tasks;
- optional `modeLockPath` if the workspace uses a non-default lock file.
- optional `modeTrustPath` if the workspace uses a non-default trust store.
- optional `modeMarketplacePath` if the workspace uses a non-default
  marketplace file.

`runAwmpTask` checks this policy immediately after resolving selected modes and
before creating a run directory. A failed check blocks execution with a clear
error instead of writing partial run state. A passed check is written into
`trace.jsonl` and embedded in `artifacts/governance_policy.json` so each run has
evidence of the control-plane decision that allowed it.

The CLI exposes:

```text
/awmp policy [--policy <policy-path>]
/awmp policy-set [--require-mode-lock|--no-require-mode-lock] [--require-mode-signature|--no-require-mode-signature] [--require-marketplace|--no-require-marketplace] [--mode-lock <lock-path>] [--mode-trust <trust-path>] [--marketplace <marketplace-path>] [--trusted-publisher <id>] [--allow-mode <mode-id>] [--deny-mode <mode-id>] [--max-modes <n>]
/awmp policy-check <task.json> [--modes <mode-root>] [--policy <policy-path>]
```

The model-facing `AWMP` tool exposes the same layer through
`read_workspace_policy`, `set_workspace_policy`, and `check_workspace_policy`.

This is not yet a full enterprise policy engine. It is a local, test-covered
execution gate that can later grow into tenant policy, signed marketplace trust,
remote admin controls, and audit export.

## Artifact Store And Context

`artifacts/index.json` remains a simple artifact array for compatibility with
validators and tools. `artifacts/store.json` is the richer Artifact Store
snapshot. It records the run-local artifact filesystem state, including counts by
artifact type.

The Artifact Store API lives in `src/awmp/artifactStore.ts` and provides:

- typed artifact registration;
- JSON artifact writes and reads;
- durable index and store snapshots.

`context/execution_context.json` is generated by `src/awmp/contextBuilder.ts`.
It is a compact view of the run, built from:

- the current Task Contract;
- selected Mode Cards and mounted skill references;
- artifact summaries and validation state;
- tool registry counts and approval state;
- control-plane workspace policy status and blocking decision count;
- adjacent handoff graph for selected modes;
- durable handoff plan status and blocked reasons;
- durable scheduler state for each mode step;
- inferred next actions.

This keeps the runtime moving toward progressive disclosure: the agent can read a
small execution context first, then follow stable file paths for details.

## Run Inspection And Eval

`src/awmp/evalReporter.ts` converts AWMP run directories into observability
records. It does not infer success from chat text. It reads the durable files in
the run directory:

- `task.json`
- `scheduler.json`
- `artifacts/index.json`
- `validations.json`
- `artifacts/tool_registry.json`
- `artifacts/approvals/`
- `artifacts/reviews/`
- `trace.jsonl`

`/awmp inspect <run-dir>` writes:

```text
<run-dir>/reports/run_inspection.json
```

The report includes task state, scheduler state, artifact counts, validator
counts, approval state, adapter/tool coverage, trace event counts, and
evidence-backed metric records.

`/awmp eval [runs-root]` scans inspectable run directories and writes:

```text
<runs-root>/awmp_eval_report.json
```

The current metric layer intentionally distinguishes computed values from missing
evidence:

- `Work Completion Rate`: computed from completed task state plus completed
  durable scheduler status.
- `Validation Pass Rate`: computed only from executed pass/fail validator
  results; skipped validators are not counted as passed.
- `Mode Reuse Rate`: computed across multiple inspected runs.
- `Adapter Coverage`: computed from `artifacts/tool_registry.json`.
- `Human Approval Efficiency`: currently represented as approval resolution rate
  because approval cycle time and human effort are not yet recorded.
- `Cross-Mode Task Success`: computed for runs with more than one mode and a
  completed scheduler.
- `Artifact Acceptance Rate`: computed only from the latest explicit artifact
  review per reviewed artifact. `accepted` and `accepted_with_changes` count as
  accepted. If no review exists, the metric is marked `missing_evidence`. AWMP
  does not fabricate this metric from artifact existence or validation status.

The model-facing `AWMP.inspect_run` and `AWMP.eval_runs` actions expose the same
reports to the agent loop. This is the first control-plane layer for the goal's
north-star metrics: work completion, artifact acceptance, mode reuse, adapter
coverage, approval efficiency, validation pass rate, and cross-mode success.

Artifact reviews are recorded through:

```text
/awmp review-artifact <run-dir> <artifact-id-or-uri> <accepted|accepted_with_changes|rejected|needs_revision> [--by <name>] [--note <text>] [--changes <text>]
/awmp reviews <run-dir>
```

The model-facing `AWMP.record_artifact_review` and
`AWMP.list_artifact_reviews` actions expose the same records. Recording a review
is a governance write, not an automatic validator result, and should represent a
real human or workflow acceptance decision.

## Mode Eval / Golden Tasks

`src/awmp/modeEval.ts` provides package-level regression checks for reusable
AWMP modes. It discovers AWMP `Task` JSON files under a mode package's
`examples/` directory, runs each task through the same local substrate as
`/awmp run`, optionally runs a bounded scheduler pass, inspects the resulting
run directory, and writes a durable `ModeEvalReport`.

The CLI entry point is:

```text
/awmp eval-mode <mode-dir> [--run-scheduler] [--max-steps <n>] [--timeout-ms <ms>] [--execute-validators] [--validator-timeout-ms <ms>] [--apply-review-fixtures] [--report <path>]
```

The model-facing action is `AWMP.eval_mode` with `source_dir` pointing at the
mode package root. Set `eval_run_scheduler=true` to enable the same scheduler
pass through the agent tool. Set `apply_review_fixtures=true` only for local
regression suites that declare explicit artifact review fixtures.

Each task may have an optional sibling expectation file:

```text
examples/task.json
examples/task.eval.json
```

The expectation file uses `kind: "ModeEvalExpectation"` and may declare:

- `expectRuntimePass`: whether the runtime's default pass rule should be
  required. This lets negative examples intentionally pass when the task fails
  for the expected boundary reason.
- `expectedTaskState` and `expectedSchedulerStatus`.
- `requiredArtifactTypes` and `forbiddenArtifactTypes`.
- `expectedMetrics` values from the run inspection report.
- `artifactReviewFixtures`, which can write local review records when
  `--apply-review-fixtures` is set.

A golden task case passes when:

- the task reaches `completed`;
- the inspected run has no blocking validator failures.

This is intentionally narrower than claiming business success. Work completion,
artifact acceptance, validation pass rate, and other north-star metrics are still
computed by run/eval reports from their own evidence. If a mode package has no
golden task files under `examples/`, the report is still written and records the
missing evidence.

Artifact review fixtures are regression evidence only. They are useful for
checking that a mode's acceptance metric plumbing works, but they must not be
treated as production user acceptance or benchmark ground truth.

## First-Party Mode Examples

`examples/awmp` contains deterministic, local-first AWMP mode packages used as
runtime fixtures:

```text
examples/awmp/
  modes/customer_support/
  modes/ppt/
  tasks/support_to_ppt_task.json
```

The customer-support mode produces a `support.analysis.report` artifact from a
support-ticket fixture. The presentation mode consumes upstream artifact
evidence when available and produces `presentation.outline` plus
`presentation.pptx` artifact records. The cross-mode task validates the current
runtime path:

```text
Task Contract
-> customer_support scheduler step
-> support.analysis.report
-> ppt scheduler step
-> presentation.outline / presentation.pptx
-> validators
-> run inspection metrics
```

These examples are not production integrations. They are first-party fixtures
for protocol/runtime behavior: mode discovery, linting, catalog summaries,
policy-checked local tools, scheduler progression, artifact registration,
validator execution, and evidence-backed eval reports.

The first-party mode packages also include `*.eval.json` expectation files. The
customer-support package contains both a successful support-analysis task and a
negative blocked-handoff task that verifies incompatible mode ordering is
rejected instead of silently producing artifacts.

## Orchestration

`orchestration.json` is generated by `src/awmp/orchestrator.ts`. In v0.1 it is a
local lifecycle record, not a distributed scheduler. It records state transitions
and mirrors them into `trace.jsonl` as `orchestrator.transition` events.

`handoff_plan.json` is generated by `src/awmp/handoffPlanner.ts`. It turns
adjacent `handoffs.canDelegateTo` and `handoffs.canReceiveFrom` declarations
into ordered mode steps. The first mode starts as `ready`; each following mode is
`ready` only when the previous mode may delegate to it and it may receive from
the previous mode. A blocked handoff makes the task fail with a
`Blocked AWMP handoffs` status message.

`scheduler.json` is generated and advanced by `src/awmp/scheduler.ts`. It turns
handoff plan steps into durable scheduler step records with attempts, dependency
metadata, and next actions. In v0.1, mode business execution is still not
fabricated by the runtime. A step advances only through policy-checked Tool
Broker calls or connected adapters:

```text
pending -> deferred -> running -> completed | failed
                         |-> approval_required
                         |-> blocked
                         |-> deferred
```

The scheduler enforces step dependencies before calling a tool. A dependent step
stays `pending` until required upstream steps are `completed`. When an upstream
step completes, the scheduler unlocks newly ready dependent steps to `deferred`
and records the transition in `trace.jsonl`.

When a step is ready and no tool is supplied, the scheduler checks
`artifacts/tool_registry.json` for tools owned by the step's mode. It filters out
denied tools, prefers `available` tools over `approval_required` tools, and then
uses a deterministic kind priority (`local`, then `openapi`, then `mcp`). If more
than one candidate shares the best priority, the step remains `deferred` and asks
for an explicit `tool_id`.

Successful tool calls write a scheduler step result artifact and may register
business artifacts declared by the tool stdout:

```json
{
  "artifact": {
    "type": "presentation.pptx",
    "content": { "slides": 8 }
  }
}
```

Only artifact types already declared by the scheduler step are registered from
tool stdout.

Every scheduler step mutation refreshes `context/execution_context.json`. The
refreshed context includes the latest scheduler state, approval counts, and
Artifact Store contents, and writes a `context.built` trace event with
`source=scheduler_step`.

Scheduler validation is step-scoped. After a completed tool call, AWMP inspects
the owning mode's validators and writes an `awmp.scheduler_step_validation`
artifact. By default the validator scripts are not executed; the results are
recorded as inspected/skipped. Passing `--execute-validators` or
`AWMP.execute_validators=true` executes the declared validator scripts in the
same restricted validator runner used by `/awmp run`.

If an executed blocking validator fails, the scheduler step becomes `failed`,
the scheduler status becomes `failed`, and downstream steps are not unlocked.
The produced business artifact receives `validation.status=failed`. If validators
pass, the artifact receives `validation.status=passed`.

Failed steps are recoverable when the failure class is transient or fixable by
rerunning the same step. The scheduler records:

- `lastFailureKind`: for example `tool_failed`, `validation_failed`,
  `approval_required`, `adapter_deferred`, `policy_denied`,
  `dependency_pending`, or `ambiguous_tool`;
- `retryable`: whether the step is eligible for explicit retry;
- `retryAfter`: the earliest retry time after policy backoff;
- `retryPolicy`: default maximum attempts and backoff bounds.

Only `tool_failed` and `validation_failed` are retryable by default, and only
until the step reaches its retry policy's `maxAttempts`. Governance and
configuration outcomes such as `approval_required`, `policy_denied`,
`adapter_deferred`, and `ambiguous_tool` require the operator or agent to fix the
underlying condition first. They are not retried automatically.

Retry is explicit:

```text
/awmp retry-step <run-dir> <step-id-or-mode-id> [tool-id-or-name] [--force]
```

`retry-step` reuses the previous tool and previous tool input when replacements
are not supplied. Without `--force`, it respects the persisted `retryAfter`
timestamp. The model-facing `AWMP.retry_scheduler_step` action exposes the same
control-plane operation.

The current lifecycle is:

```text
submitted
-> planning
-> working
-> validating
-> completed | failed
```

This gives later multi-agent or multi-mode schedulers a durable state record to
resume from, instead of relying on chat transcript history.

## Tool Broker Boundary

Mode packages can declare three tool kinds:

- `local`: restricted script commands inside the mounted mode package.
- `openapi`: HTTP calls controlled by the Execution Capsule network policy.
- `mcp`: external MCP tools bridged through explicit AWMP adapters or connected
  Leviathan MCP session tools.

All tool calls pass through the registry at `artifacts/tool_registry.json`.
The registry records:

- tool identity
- mode ownership
- target metadata
- policy decision: `available`, `approval_required`, or `denied`

Policy is enforced before execution. A denied tool is never executed.

A tool that requires approval writes a durable request under
`artifacts/approvals/` and returns `approval_required`. Approval requests are
bound to the exact tool id and a stable fingerprint of the requested input, so an
approval for one payload cannot be replayed for a different payload.

Approval decisions are written back to the run directory and traced as
`approval.requested`, `approval.approved`, or `approval.rejected`.

## MCP Bridge

MCP tools are not invoked by ambient name lookup. The broker only executes an MCP
tool when one of these is true:

- a runtime component registers an explicit AWMP MCP adapter for the declared
  server/tool pair;
- the `AWMP` agent tool is called inside a live Leviathan session and can bridge
  to a connected MCP tool with matching `mcpInfo`.

If no adapter is connected, the call result is `deferred`. This keeps AWMP mode
declarations portable while preventing hidden authority escalation.

## CLI

The local slash command is:

```text
/awmp status
/awmp init <modeDir> --id <id> --name <name> --description <text> [--intent <text>] [--artifact <type>] [--force]
/awmp lint <modeDir>
/awmp modes [--modes <mode-root>]
/awmp catalog [--modes <mode-root>] [--catalog <catalog-path>] [--write]
/awmp publish-mode <mode-dir> [--catalog <catalog-path>] [--force]
/awmp mode-lock [--lock <lock-path>]
/awmp lock-mode <mode-dir> [--lock <lock-path>] [--force]
/awmp verify-lock [mode-dir] [--lock <lock-path>]
/awmp trust-keygen --public-key <path> --private-key <path> [--force]
/awmp mode-trust [--trust <trust-path>]
/awmp sign-mode <mode-dir> --publisher <id> --private-key <path> [--trust <trust-path>] [--force]
/awmp verify-signature [mode-dir] [--trust <trust-path>] [--publisher <id>] [--public-key <path>]
/awmp marketplace [--marketplace <marketplace-path>]
/awmp marketplace-publish <mode-dir> --publisher <id> [--marketplace <marketplace-path>] [--trust <trust-path>] [--private-key <path>] [--force]
/awmp marketplace-revoke <mode-id> --version <version> --publisher <id> --reason <text> [--by <name>] [--marketplace <marketplace-path>]
/awmp marketplace-verify [mode-dir] [--marketplace <marketplace-path>] [--trust <trust-path>] [--publisher <id>]
/awmp marketplace-sync <source-file-or-url> [--marketplace <marketplace-path>] [--source-id <id>] [--force]
/awmp policy [--policy <policy-path>]
/awmp policy-set [--require-mode-lock|--no-require-mode-lock] [--require-mode-signature|--no-require-mode-signature] [--require-marketplace|--no-require-marketplace] [--mode-lock <lock-path>] [--mode-trust <trust-path>] [--marketplace <marketplace-path>] [--trusted-publisher <id>] [--allow-mode <mode-id>] [--deny-mode <mode-id>] [--max-modes <n>]
/awmp policy-check <task.json> [--modes <mode-root>] [--policy <policy-path>]
/awmp eval-mode <mode-dir> [--run-scheduler] [--max-steps <n>] [--timeout-ms <ms>] [--execute-validators] [--validator-timeout-ms <ms>] [--apply-review-fixtures] [--report <path>]
/awmp install <mode-dir> [--force]
/awmp export-bundle <mode-dir> [--bundle <bundle-path>] [--force]
/awmp install-bundle <bundle-path> [--force]
/awmp route <request> [--modes <mode-root>]
/awmp run <task.json> [--modes <mode-root>] [--execute-validators]
/awmp approvals <run-dir>
/awmp approve <run-dir> <approval-id> [--by <name>] [--note <text>]
/awmp reject <run-dir> <approval-id> [--by <name>] [--note <text>]
/awmp reviews <run-dir>
/awmp review-artifact <run-dir> <artifact-id-or-uri> <accepted|accepted_with_changes|rejected|needs_revision> [--by <name>] [--note <text>] [--changes <text>]
/awmp inspect <run-dir>
/awmp eval [runs-root]
/awmp tool-call <run-dir> <tool-id-or-name> [--approve] [--approval <approval-id>] [--input-json <json>]
/awmp step-run <run-dir> <step-id-or-mode-id> [tool-id-or-name] [--approve] [--approval <approval-id>] [--input-json <json>] [--execute-validators] [--validator-timeout-ms <ms>]
/awmp retry-step <run-dir> <step-id-or-mode-id> [tool-id-or-name] [--force] [--approve] [--approval <approval-id>] [--input-json <json>] [--execute-validators] [--validator-timeout-ms <ms>]
/awmp scheduler-run <run-dir> [--max-steps <n>] [--timeout-ms <ms>] [--execute-validators] [--validator-timeout-ms <ms>]
```

The model-facing `AWMP` tool exposes the same control-plane actions:

- `list_modes`
- `route_request`
- `create_mode`
- `lint_mode`
- `install_mode`
- `catalog_modes`
- `publish_mode`
- `export_mode_bundle`
- `install_mode_bundle`
- `read_mode_lock`
- `lock_mode`
- `verify_mode_lock`
- `generate_trust_keypair`
- `read_mode_trust`
- `sign_mode`
- `verify_mode_signature`
- `read_mode_marketplace`
- `publish_marketplace_mode`
- `revoke_marketplace_mode`
- `verify_mode_marketplace`
- `sync_mode_marketplace`
- `read_workspace_policy`
- `set_workspace_policy`
- `check_workspace_policy`
- `eval_mode`
- `run_task_file`
- `start_task`
- `list_approvals`
- `list_artifact_reviews`
- `record_artifact_review`
- `inspect_run`
- `eval_runs`
- `approve_request`
- `reject_request`
- `call_registered_tool`
- `run_scheduler_step`
- `retry_scheduler_step`
- `run_scheduler`

## Safety Defaults

- Validators are skipped by default and only run with explicit opt-in.
- Local scripts must use allowed runtimes and stay inside the mounted mode root.
- HTTP calls are denied unless the Execution Capsule allows them.
- MCP calls are deferred unless a bridge is explicitly connected.
- Tool calls write durable results and trace events.
- Scheduler tool auto-selection writes `scheduler.tool.selected` trace events
  when it selects a tool automatically.
- Scheduler-completed tools register `awmp.scheduler_step_result` artifacts and
  only accept tool-declared business artifacts whose types match the step
  contract.
- Scheduler validators are inspected by default and executed only with explicit
  validator opt-in.
- Scheduler retry is explicit and bounded by per-step retry policy; failed steps
  do not trigger unbounded automatic retries.
- Approval-gated tools write durable approval requests and will not execute
  until a matching approval is recorded or explicit `--approve` is supplied.
- Artifact acceptance is explicit. AWMP does not treat a written artifact or a
  passing validator as user acceptance unless an artifact review is recorded.
- Catalog publishing requires a lintable mode package and records a digest plus
  capability summary. It does not grant runtime execution permission by itself.
- Mode eval runs only task JSON files carried by the mode package `examples/`
  directory. Validator execution remains opt-in, and business acceptance is not
  inferred from a passing golden task.
- Mode bundle installation verifies file digests, package digest, and lint
  status before replacing a workspace-installed mode.

## Approvals

Approval requests are run-local artifacts, not global permissions. A request
records:

- approval id and status;
- tool id, tool name, tool kind, and owning mode;
- policy reason;
- requested input and stable input fingerprint;
- decision actor, timestamp, and optional note after approval or rejection.

Typical flow:

```text
/awmp tool-call <run-dir> refund:create --input-json '{"amount":4}'
# returns approval_required and Approval: approval_<id>

/awmp approvals <run-dir>
/awmp approve <run-dir> approval_<id> --by local-user --note "verified"
/awmp tool-call <run-dir> refund:create --approval approval_<id> --input-json '{"amount":4}'
```

If the final tool call changes the input payload, AWMP rejects it because the
approval fingerprint no longer matches.

## Mode Authoring

`/awmp init` and `AWMP.create_mode` create a complete starter mode package:

```text
mode.yaml
SKILL.md
schemas/output.schema.json
tools/generate_artifact.ts
validators/schema_check.ts
examples/task.json
```

The generated package is intentionally conservative:

- network is denied in the example task;
- sensitive actions such as secret exfiltration and approval bypass are denied;
- external writes require approval;
- the local tool stays inside the mode package;
- the validator is explicit and not executed unless requested.

`/awmp lint` and `AWMP.lint_mode` perform static checks before a mode is
installed or executed. The linter verifies schema loadability, `SKILL.md`,
activation intents, artifact contracts, declared schema files, restricted
validator/local tool commands, and basic permission posture.

## Next Engineering Steps

- Expand first-party mode authoring helpers into a package SDK.
- Add richer artifact validators and larger first-party golden task suites.
- Expand the durable scheduler into a richer active executor for parallel mode
  steps and resumable adapter sessions.
- Add richer mode executors that can choose tools from mode contracts, register
  produced artifacts automatically, and retry failed steps with policy-aware
  backoff.
- Extend marketplace feed sync and portable bundles into a remote registry
  service with package hosting, tenant trust policy, and admin controls.
- Add a persistent adapter registry for enterprise app connectors.
- Add UI views for run inspection, approvals, artifacts, and trace replay.
