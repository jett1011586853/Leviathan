# AWMP Starter Pack Alignment

This note maps `D:\hl-agent4\awmp_starter_pack` to Leviathan's current AWMP
runtime implementation. It is intentionally scoped to code that exists in this
repository.

## Source Materials

- `D:\hl-agent4\awmp_starter_pack\spec\mode.schema.json`
- `D:\hl-agent4\awmp_starter_pack\spec\task.schema.json`
- `D:\hl-agent4\awmp_starter_pack\spec\artifact.schema.json`
- `D:\hl-agent4\awmp_starter_pack\spec\execution_capsule.schema.json`
- `D:\hl-agent4\awmp_starter_pack\examples\modes\customer_support\mode.yaml`
- `D:\hl-agent4\awmp_starter_pack\examples\modes\ppt\mode.yaml`
- `D:\hl-agent4\awmp_starter_pack\runtime_pseudocode\orchestrator.ts`

## Implemented Alignment

| Starter pack concept | Leviathan implementation | Notes |
| --- | --- | --- |
| Mode Card | `src/awmp/schemas.ts`, `src/awmp/types.ts`, `src/awmp/modeRegistry.ts` | Supports `mode.yaml`, `SKILL.md`, activation, inputs, outputs, tools, permissions, validators, and handoffs. |
| Task Contract | `src/awmp/schemas.ts`, `src/awmp/runtime.ts` | Supports `Task` loading, routing fallback, task status, constraints, artifacts, and trace id. |
| Artifact Contract | `src/awmp/artifactStore.ts`, `src/awmp/runtime.ts`, `src/awmp/types.ts` | Runtime writes execution plan, governance policy, tool registry, validation files, tool call results, approval artifacts, artifact index, and Artifact Store snapshots. |
| Execution Capsule | `src/awmp/runtime.ts` | Creates a task-scoped workspace with runtime metadata, network policy, filesystem scope, secrets list, and limits. |
| Execution Context | `src/awmp/contextBuilder.ts` | Builds a compact context snapshot from task, selected modes, artifacts, validators, tool registry, approvals, and handoff graph. |
| Handoff Plan | `src/awmp/handoffPlanner.ts`, `src/awmp/runtime.ts` | Enforces adjacent `canDelegateTo` / `canReceiveFrom` policy for selected modes and writes `handoff_plan.json`. |
| Scheduler Record | `src/awmp/scheduler.ts`, `src/awmp/runtime.ts` | Turns handoff plan steps into durable per-mode scheduler states, writes `scheduler.json`, and advances steps through policy-checked Tool Broker calls. |
| Orchestrator | `src/awmp/orchestrator.ts`, `src/awmp/runtime.ts` | Records local lifecycle transitions through planning, working, validating, and terminal task states. |
| Tool Broker | `src/awmp/toolBroker.ts` | Supports `local`, `openapi`, and `mcp` registry entries with policy decisions before execution. |
| Approval flow | `src/awmp/approvalStore.ts`, `src/awmp/toolBroker.ts` | Approval-gated tools create durable run-local approval requests and require a matching approval before execution. |
| Mode Catalog | `src/awmp/modeCatalog.ts` | Publishes linted mode packages into a local catalog with capability summaries, package digests, and lint status. |
| Mode Bundle | `src/awmp/modeBundle.ts` | Exports linted mode packages as portable `.awmp-mode.json` bundles and installs them into another workspace after file digest, package digest, and lint verification. |
| Mode Lock | `src/awmp/modeLock.ts` | Pins mode id/version/package digest entries into a workspace lock file and verifies local package drift before reproducible execution. |
| Mode Trust | `src/awmp/modeTrust.ts` | Generates local Ed25519 trust keys, signs linted mode package digests, stores public signatures, and verifies signed modes for marketplace-style trust metadata. |
| Mode Marketplace | `src/awmp/modeMarketplace.ts` | Records marketplace releases with publisher ids, package digests, inline public signatures, local/remote source metadata, active/revoked state, file/HTTP feed sync, and verification for Workspace Policy. |
| Workspace Policy / Control Plane | `src/awmp/workspacePolicy.ts`, `src/awmp/runtime.ts` | Adds a workspace-level execution gate for mode-lock enforcement, signed-mode enforcement, marketplace approval, trusted publishers, mode allow/deny lists, and max selected modes before a task can enter the runtime. Passed checks are written into trace and governance artifacts. |
| Run inspection / eval | `src/awmp/evalReporter.ts`, `src/awmp/artifactReviewStore.ts` | Converts persisted runs into evidence-backed metrics, including explicit artifact review evidence for acceptance. |
| Mode golden task eval | `src/awmp/modeEval.ts` | Runs AWMP `Task` JSON files under a mode package's `examples/` directory and writes package-level regression reports. It can optionally execute a bounded scheduler pass before inspection, load sibling `*.eval.json` expectations, and apply local artifact review fixtures for regression-only acceptance evidence. |
| First-party executable examples | `examples/awmp` | Provides local customer-support and presentation mode packages plus a cross-mode support-to-presentation task fixture. |
| Slash command control plane | `src/commands/awmp/awmp.ts` | Supports status, mode authoring, install, route, run, approvals, decisions, and tool calls. |
| Model-facing control plane | `src/tools/AwmpTool/AwmpTool.ts` | Exposes AWMP actions to the agent loop, including mode authoring, task start/run, approvals, and tool calls. |

## Current Boundaries

- The runtime is still a local v0.1 substrate, not a distributed Work OS.
- Mode handoff is enforced for adjacent selected modes and persisted as
  `handoff_plan.json`.
- Scheduler state is persisted as `scheduler.json`; ready steps can be advanced
  through Tool Broker calls or adapters. The scheduler can auto-select a single
  unambiguous mode-owned tool, but it still does not fabricate business
  artifacts without tool output.
- Artifacts are written as runtime records; first-party business artifact
  generation still belongs to mode-local tools and validators.
- Artifact acceptance is explicit. It is recorded through artifact review files,
  not inferred from artifact existence or validator pass status.
- The local Mode Catalog and Mode Lock are not a remote marketplace. They
  provide local digest indexing, version pinning, and drift detection, while
  signature metadata is owned by Mode Trust.
- Mode Bundle provides a local portable package format for moving mode packages
  across workspaces. It is not yet compressed package hosting or signed remote
  distribution.
- Mode Trust provides local Ed25519 signatures over package digests and can be
  enforced by Workspace Policy. It is not yet a remote PKI, revocation system,
  or marketplace trust service.
- Mode Marketplace provides release records, local/HTTP feed sync, inline
  signature verification, and revocation state distribution. It is not yet a
  hosted marketplace service, package hosting layer, billing system, tenant
  trust service, or distributed auth protocol.
- Workspace Policy is local and file-backed. It can block task execution before
  run creation when selected modes violate lock, signature, marketplace,
  trusted publisher, allow/deny, or max-mode rules, but it is not yet a
  distributed enterprise admin plane.
- Mode eval currently runs local `examples/` task files and can optionally run a
  bounded scheduler pass. Sibling expectation files can assert expected
  artifacts, metrics, blocked negative cases, and regression-only artifact
  review fixtures. These fixtures do not replace real artifact acceptance
  reviews or benchmark suites.
- Validators are opt-in for execution and restricted to declared relative
  scripts inside mounted mode packages.
- MCP tools execute only through explicit AWMP adapters or connected Leviathan
  session tools.

## Next Engineering Slice

1. Expand first-party mode packages with larger golden task suites, more
   domain-specific expectations, and richer negative cases.
2. Extend marketplace feed sync, portable bundles, and Workspace Policy into
   hosted registry sync, tenant trust metadata, package hosting, and admin
   policy.
3. Add UI or CLI inspection commands for execution context, artifact store, and
   orchestration records.

## Principle For Future Work

AWMP should not become a prompt library. A mode is only useful when it carries
machine-readable contracts: artifact types, validators, tool permissions,
approval boundaries, and traceable execution records.
