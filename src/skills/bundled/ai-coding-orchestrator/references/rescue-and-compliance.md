# External Reference Rescue And Compliance

## No-Progress Gate

The default threshold is three consecutive ineffective rounds against the same problem fingerprint and failure state. A locally configured threshold may replace it, but never use fewer than two rounds unless the user explicitly requests immediate external review.

Reset the counter only after a material evidence delta:

- verified new constraint;
- new reproducible counterexample;
- discriminating diagnostic result;
- reduced failure set;
- newly passing check;
- verified better complexity/correctness property.

Do not reset it for a longer explanation, renamed variables, repeated code, untested rewrite, or another unsupported assertion.

## Rescue Preconditions

All must hold:

- policy mode is `allowed`;
- the user has not forbidden external services;
- Browser Use is enabled;
- there is no unresolved ChatGPT generation already in progress;
- the packet can be safely redacted;
- this fingerprint has not already submitted an external rescue question.

If any condition fails, continue with local diagnostics or report the blocker. Never bypass login, CAPTCHA, proctoring, anti-cheat, or browser security controls.

## Build The Rescue Packet

Preserve the exact relevant statement and evidence. Redact authentication and unrelated private content.

```text
ROLE:
You are an external technical reviewer. Your output is advisory and will be
verified by Leviathan. Do not assume the current approach is correct.

OBJECTIVE:
<exact user objective and scoring target>

FULL RELEVANT PROBLEM:
<complete statement, examples, constraints, notes, and image descriptions>

RUNTIME AND INTERFACES:
<language/version, limits, starter signatures, allowed files, dependencies>

CURRENT STRATEGY AND INVARIANTS:
<selected approach and why>

CURRENT CODE:
<complete relevant code, preserving line order>

EXECUTION EVIDENCE:
<commands/actions, failing inputs, expected/actual output, exact logs>

ATTEMPTS ALREADY MADE:
<change and observed effect for each attempt>

ASK:
1. Identify the most likely root cause.
2. Provide a corrected strategy or minimal patch.
3. State complexity and assumptions.
4. Give counterexamples and decisive tests.
5. Mark any uncertainty explicitly.
```

Never include cookies, API keys, access tokens, passwords, private keys, payment data, personal identifiers, unrelated private source, or hidden data obtained without authorization.

## Call The Reference

Use `BrowserDevTools`:

```json
{
  "action": "ask_chatgpt",
  "question": "<rescue packet>",
  "url": "<configured ChatGPT reference URL when available>",
  "timeout_ms": 180000
}
```

The configured URL identifies a conversation, not a credential. Use the browser's existing signed-in profile. If login is required, ask the user to sign in manually. Never accept or inject exported cookies.

Leviathan's Browser DevTools profile is persistent. A one-time manual login is the supported bootstrap path; it preserves the account session without placing reusable authentication material in source code, prompts, logs, or configuration. Keep the model already selected for the configured conversation. If the requested model is not available to that account or conversation, stop and report the mismatch.

If the tool reports that ChatGPT is still generating, do not submit another question. Wait and retrieve the same pending response. Only one new submission is allowed per unchanged problem fingerprint.

## Consume The Response

Record:

```text
EXTERNAL_RAW_ANSWER:
ACTIONABLE_CLAIMS:
ASSUMPTIONS:
PROPOSED_COUNTEREXAMPLES:
PROPOSED_TESTS:
CONFLICTS_WITH_LOCAL_EVIDENCE:
VERIFICATION_DECISION:
```

Return to L3 when the strategy changes, L5 for a scoped implementation, or L6 for diagnostics. Never move directly from external advice to L9.

## Submission And Site Rules

- Treat unknown rules as no permission for automated submission.
- Require explicit confirmation before consequential final submission unless prior authorization is unambiguous and current.
- Stop automation in live or proctored assessments that disallow AI or delegated work.
- Switch to concept explanation, practice examples, or post-event review when restricted.
- Do not disguise automated actions as human behavior to evade platform detection.
- Record that external guidance was used and what independent evidence verified it.
