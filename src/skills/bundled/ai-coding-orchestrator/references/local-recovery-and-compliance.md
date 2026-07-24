# Local Recovery And Compliance

## No-Progress Gate

The threshold is three consecutive ineffective rounds against the same problem fingerprint and failure state.

Reset the counter only after a material evidence delta:

- a verified new constraint;
- a new reproducible counterexample;
- a discriminating diagnostic result;
- a reduced failure set;
- a newly passing check;
- a verified better complexity or correctness property.

Do not reset it for a longer explanation, renamed variables, repeated code, an untested rewrite, or another unsupported assertion.

## Freeze The Best Candidate

Before recovery:

1. Save the highest-scoring reproducible candidate and its exact evidence.
2. Record the unchanged failure fingerprint.
3. Stop broad rewrites and reserve enough time or judge calls to restore and submit the best candidate.
4. Preserve current interfaces, constraints, and known passing behavior.

## Build A Local Recovery Packet

```text
OBJECTIVE:
<exact objective and scoring target>

FULL RELEVANT PROBLEM:
<statement, examples, constraints, notes, and image observations>

RUNTIME AND INTERFACES:
<language/version, limits, starter signatures, allowed files, dependencies>

CURRENT STRATEGY AND INVARIANTS:
<selected approach and required properties>

CURRENT CODE:
<complete relevant code, preserving line order>

EXECUTION EVIDENCE:
<commands/actions, failing inputs, expected/actual output, exact logs>

ATTEMPTS ALREADY MADE:
<change and observed effect for each attempt>

NEXT DIAGNOSTIC:
<one falsifiable hypothesis and the cheapest decisive check>
```

Keep the packet inside the current authorized task environment. Do not transmit it to an external question-answering service.

## Change The Diagnostic Axis

Choose one axis that has not already been tested:

- reduce the failing input to a minimal counterexample;
- trace state transitions or invariants at the first divergence;
- compare a slow reference implementation against the optimized candidate;
- perform boundary, overflow, indexing, encoding, and input-format checks;
- replace one uncertain component with a deterministic local oracle;
- ask the permitted website AI worker for an independent scoped review;
- restore the best candidate and test one minimal patch at a time.

Every recovery attempt must name its hypothesis, expected evidence, maximum change scope, and rollback condition.

## Stop Conditions

Stop recovery and report a blocker when:

- no new local evidence-producing action remains;
- the remaining tests or submissions must be reserved for the best candidate;
- site policy or authorization is unclear;
- the required information is unavailable;
- the next action would expand scope without a falsifiable reason.

Do not claim completion from confidence alone.

## Submission And Site Rules

- Treat unknown rules as no permission for automated submission.
- Require explicit confirmation before consequential final submission unless prior authorization is unambiguous and current.
- Stop automation in live or proctored assessments that disallow AI or delegated work.
- Switch to concept explanation, practice examples, or post-event review when restricted.
- Do not disguise automated actions as human behavior to evade platform detection.
