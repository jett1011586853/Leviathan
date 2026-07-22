# Leviathan Hard Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove account-login gating from the normal CLI path and present Leviathan with a code-rendered pixel whale identity.

**Architecture:** A pure Leviathan branding module provides the product identity used by the UI. Startup and command discovery omit product-account entry points; provider transport code remains intact so configured model calls retain their execution path.

**Tech Stack:** TypeScript, React, Ink, Bun test

---

### Task 1: Leviathan Policy And Mascot Data

**Files:**
- Create: `src/leviathan/branding.ts`
- Test: `src/leviathan/branding.test.ts`

- [ ] Write a failing Bun test that imports the not-yet-existing module and
  asserts `PRODUCT_NAME === 'Leviathan'` and that the whale drawing is non-empty.
- [ ] Run `bun test src/leviathan/branding.test.ts`; expect failure because
  `branding.ts` does not yet exist.
- [ ] Implement constants and pixel-whale rows in `branding.ts`.
- [ ] Re-run the focused test; expect it to pass.

### Task 2: Remove Interactive Account Login

**Files:**
- Modify: `src/components/Onboarding.tsx`
- Modify: `src/main.tsx`
- Modify: `src/interactiveHelpers.tsx`
- Delete: product-account command handlers and their unused OAuth component

- [ ] Remove OAuth/account steps from onboarding while retaining theme and
  safety/trust flow.
- [ ] Remove product-account commands from both interactive and top-level CLI
  registries.
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
