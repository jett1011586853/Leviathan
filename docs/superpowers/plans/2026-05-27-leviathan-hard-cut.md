# Leviathan Hard Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove account-login gating from the normal CLI path and present Leviathan with a code-rendered pixel whale identity.

**Architecture:** A pure Leviathan branding/policy module provides the hard-cut constants used by the UI and command entry points. Startup removes only account and organization gates; provider transport code remains intact so configured model calls retain their execution path.

**Tech Stack:** TypeScript, React, Ink, Bun test

---

### Task 1: Leviathan Policy And Mascot Data

**Files:**
- Create: `src/leviathan/branding.ts`
- Test: `src/leviathan/branding.test.ts`

- [ ] Write a failing Bun test that imports the not-yet-existing module and
  asserts `PRODUCT_NAME === 'Leviathan'`, `ACCOUNT_LOGIN_REQUIRED === false`,
  and that the whale drawing is non-empty.
- [ ] Run `bun test src/leviathan/branding.test.ts`; expect failure because
  `branding.ts` does not yet exist.
- [ ] Implement constants and pixel-whale rows in `branding.ts`.
- [ ] Re-run the focused test; expect it to pass.

### Task 2: Remove Interactive Account Login

**Files:**
- Modify: `src/components/Onboarding.tsx`
- Modify: `src/commands/login/index.ts`
- Modify: `src/commands/login/login.tsx`
- Modify: `src/cli/handlers/auth.ts`
- Modify: `src/main.tsx`
- Modify: `src/interactiveHelpers.tsx`

- [ ] Remove OAuth/account steps from onboarding while retaining theme and
  safety/trust flow.
- [ ] Make `/login`, `auth login`, `auth status`, and `setup-token` explain
  that Leviathan does not require account authentication without opening OAuth.
- [ ] Delete startup calls that validate an Anthropic organization or perform
  onboarding post-login hooks.
- [ ] Search these entry points for active `ConsoleOAuthFlow` references and
  account login descriptions; expect none on the default path.

### Task 3: Replace High-Visibility Terminal Identity

**Files:**
- Create: `src/components/LogoV2/LeviathanWhale.tsx`
- Modify: `src/components/LogoV2/WelcomeV2.tsx`
- Modify: `src/components/LogoV2/Clawd.tsx`
- Modify: `src/components/LogoV2/CondensedLogo.tsx`
- Modify: `src/components/LogoV2/LogoV2.tsx`
- Modify: `src/main.tsx`

- [ ] Render the whale lines through Ink in a small stable terminal footprint.
- [ ] Replace welcome, condensed header, process title and CLI help brand with
  `Leviathan`.
- [ ] Keep internal imports/SDK identifiers unchanged; they are compatibility
  surfaces, not UI.

### Task 4: Verify The Cut

**Files:**
- Review: changed files above

- [ ] Run `bun test src/leviathan/branding.test.ts`; expect PASS.
- [ ] Run `bun run typecheck` and search for parser diagnostics; expect no
  syntax regression, while recording pre-existing type failures in restored
  reconstructed source.
- [ ] Run `bun build src/entrypoints/cli.tsx --outdir ./dist --target=bun`;
  record any missing-module failures already present in the restored baseline.
- [ ] Search for remaining user-facing Claude/Anthropic surfaces and use the
  findings to drive the next Leviathan hard-cut slice.
