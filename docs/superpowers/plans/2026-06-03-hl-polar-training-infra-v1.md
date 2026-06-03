# HL Polar Training Infrastructure v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the training-precondition governance layer from the Leviathan HL + Polar Harness-Grounded Learning v1.0 specification before any formal training starts.

**Architecture:** Add a focused `src/learning` subsystem that turns existing conversations and future runtime artifacts into versioned, redacted rollout bundles. Keep the first stages independent from the main agent loop so they are easy to test, commit, and roll back.

**Tech Stack:** Bun tests, TypeScript, existing Leviathan message types, existing `/export` local command, JSON files.

---

### Task 1: Rollout Schema and Redaction

**Files:**
- Create: `src/learning/rolloutSchema.ts`
- Create: `src/learning/redaction.ts`
- Test: `src/leviathan/learningRollout.test.ts`

- [ ] Write failing tests that prove required rollout fields exist, optional and Polar-only fields are separated, and secrets/absolute paths are redacted.
- [ ] Implement `createEmptyRolloutBundle()` with schema version `leviathan.rollout.v1`.
- [ ] Implement `redactValue()` and `redactText()` for API keys, bearer tokens, Windows/Unix paths, and auth headers.
- [ ] Run `bun test src\leviathan\learningRollout.test.ts`.

### Task 2: Conversation Rollout Builder

**Files:**
- Create: `src/learning/conversationRollout.ts`
- Modify: `src/leviathan/learningRollout.test.ts`

- [ ] Write failing tests that convert representative user/assistant/tool-result messages into a rollout bundle.
- [ ] Extract first user instruction, model metadata, messages, tool events, and security flags from existing `Message[]`.
- [ ] Default missing training-only fields to absent rather than fake values.
- [ ] Run `bun test src\leviathan\learningRollout.test.ts`.

### Task 3: Rollout Export Command

**Files:**
- Modify: `src/commands/export/export.tsx`
- Modify: `src/commands/export/index.ts`
- Test: `src/leviathan/learningRollout.test.ts`

- [ ] Write failing tests for `/export --rollout <file>` producing JSON instead of conversation text.
- [ ] Add argument parsing for `--rollout`.
- [ ] Write the redacted rollout bundle to disk using the current working directory.
- [ ] Run `bun test src\leviathan\learningRollout.test.ts`.

### Task 4: Replay Runner Scaffold

**Files:**
- Create: `src/learning/replayPlan.ts`
- Test: `src/leviathan/learningReplay.test.ts`

- [ ] Write failing tests that derive a replay plan from a rollout bundle.
- [ ] Require `repo`, `base_commit`, `harness_version`, `policy_version`, `network_policy`, and compare policy.
- [ ] Return explicit blockers for missing deterministic replay fields.
- [ ] Run `bun test src\leviathan\learningReplay.test.ts`.

### Task 5: Promotion Gate Scaffold

**Files:**
- Create: `src/learning/promotionGate.ts`
- Test: `src/leviathan/learningPromotion.test.ts`

- [ ] Write failing tests that only allow candidate bundles into stable when replay, held-out, security, and complexity gates pass.
- [ ] Implement `evaluatePromotionCandidate()` with explicit pass/fail reasons.
- [ ] Enforce candidate-only updater output by type.
- [ ] Run `bun test src\leviathan\learningPromotion.test.ts`.

### Task 6: Versioned Stage Commit and Push

**Files:**
- No source file requirement.

- [ ] Run `bun test src\leviathan`.
- [ ] Commit each completed task as a separate stage commit.
- [ ] Retry pushing branch and permanent checkpoint tag:

```powershell
git push origin checkpoint/pre-hl-polar-training-v1.0
git push -u origin feature/hl-polar-training-infra-v1
```

### Completion Rule

Formal training remains disallowed until the v1.0 checklist is implemented and verified. These tasks only start the training-precondition layer.
