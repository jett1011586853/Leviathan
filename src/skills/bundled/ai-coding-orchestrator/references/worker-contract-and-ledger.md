# Worker Contract And Evidence Ledger

## Master/Worker Contract

Leviathan is the sole owner of:

- final objective and scoring interpretation;
- permissions and external data disclosure;
- strategy selection and task ordering;
- accepted code state and rollback;
- evidence quality;
- readiness and submission decisions.

A website AI assistant or subagent is a bounded worker. It may:

- analyze an assigned problem or local component;
- enumerate constraints and boundaries;
- propose candidate strategies;
- implement only the approved scope;
- generate tests and counterexamples;
- analyze exact logs;
- report risk and uncertainty.

It may not:

- redefine the objective or scoring rule;
- enlarge scope or modify public interfaces without approval;
- add dependencies without approval;
- skip validation;
- claim completion without evidence;
- rewrite the project because one local attempt failed;
- submit the final answer independently.

## Required Worker Response

```text
TASK_ID:
TASK_UNDERSTANDING:
REMAINING_TIME_AND_RUN_TEST_BUDGET:
EXPECTED_SCORE_OR_PASS_COUNT_GAIN:
ABORT_CONDITION:
RESULT:
EXACT_CHANGES:
KEY_EVIDENCE:
ASSUMPTIONS:
KNOWN_RISKS:
UNCONFIRMED_ITEMS:
RECOMMENDED_CHECKS:
NEXT_STEP:
```

If code is returned without evidence, assumptions, and checks, request those fields before acceptance.

## Run Ledger

```json
{
  "run_id": "...",
  "problem_fingerprint": "...",
  "policy_mode": "allowed|unknown|restricted",
  "stage": "L0|L1|L2|L3|L4|L5|L6|L7|L8|L9",
  "confirmed_constraints": [],
  "assumptions": [],
  "selected_strategy": "...",
  "open_risks": [],
  "resource_budget": {
    "deadline": "...",
    "time_remaining_ms": null,
    "local_runs_remaining": null,
    "official_tests_remaining": null,
    "judge_calls_remaining": null,
    "submissions_remaining": null,
    "submission_reserve": 1
  },
  "best_candidate": {
    "change_id": "...",
    "verified_score": null,
    "verified_pass_count": null,
    "rollback_anchor": "..."
  },
  "ineffective_rounds": 0,
  "external_reference_submitted_for_fingerprint": false
}
```

## Change Ledger

```text
CHANGE_ID:
TASK_ID:
OBJECTIVE:
FILES_OR_EDITOR_REGION:
BEFORE_STATE_OR_HASH:
AFTER_STATE_OR_HASH:
RATIONALE:
VALIDATION_EVIDENCE:
REGRESSIONS:
DECISION: retain|repair|rollback
```

For a browser-only editor, retain the previous complete editor text or a content hash plus a recoverable copy before replacing it.

## Test Evidence

```text
CHECK_ID:
TYPE: compile|sample|boundary|adversarial|differential|performance|regression|judge
COMMAND_OR_ACTION:
INPUT:
EXPECTED:
ACTUAL:
EXIT_STATUS:
DURATION:
QUOTA_CONSUMED:
SCORE_OR_PASS_COUNT_BEFORE:
SCORE_OR_PASS_COUNT_AFTER:
RESULT: pass|fail|inconclusive
ARTIFACT:
```

Natural-language claims such as "looks correct" and "should pass" are not validation evidence.

## Failure Discipline

When multiple attempts fail:

1. Freeze broad editing.
2. Reproduce one smallest failure.
3. Compare expected and actual state.
4. Ask for no more than three hypotheses.
5. Run a diagnostic that distinguishes them.
6. Apply the smallest supported repair.
7. Re-run the failed check and regressions.
8. Increment the ineffective-round counter only when no material evidence delta was produced.

## Context Packing For A Worker

Send the minimum sufficient context:

- current objective;
- exact relevant problem text;
- relevant code only;
- exact current failure;
- verified facts;
- forbidden changes;
- expected response schema.

Do not resend the entire conversation history. Do not omit a problem constraint merely to shorten the packet.
