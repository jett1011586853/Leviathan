# Leviathan Hard Cut Design

## Objective

Turn the reconstructed CLI into Leviathan at the user-facing execution boundary:
it starts without recovered product account login or organization verification,
and its primary terminal identity is a small pixel Leviathan whale rendered in
code.

## Boundary

Account authentication is removed from normal startup, onboarding, `/login`,
and `auth login`. Provider credentials needed to make actual model API calls
remain transport configuration, because removing them would remove model
execution rather than remove recovered product account verification.

Remote features implemented by the recovered source through product account
tokens are not represented as locally available Leviathan capabilities in this
cut. They must later be replaced with Leviathan-owned services or removed.

## Implementation

- Add a small `src/leviathan/branding.ts` module for product name, no-account
  policy text, and the pixel whale drawing.
- Skip account/OAuth steps during onboarding while retaining theme, trust and
  safety controls.
- Make both CLI and in-session login commands report that account login is
  disabled and return immediately.
- Remove startup organization-validation calls that make a local run depend on
  a recovered product account.
- Replace the visible mascot and welcome brand with the pixel whale and
  `Leviathan`, without renaming SDK modules or protocol tokens.

## Verification

- A focused Bun test asserts the no-account policy and code-rendered whale.
- Search the changed user entry points for OAuth invocation and visible
  recovered product branding.
- Run parse/type and Bun build checks, explicitly separating pre-existing
  recovered-source failures from new syntax failures.
