# AI Coding Orchestration Playbook

Use this playbook as the normative L0-L9 workflow. Keep the current stage explicit. A stage may be revisited when new evidence invalidates its artifact.

## L0 - Collect The Problem And Environment

Capture the exact source material before analysis:

- full problem statement, examples, notes, diagrams, and expanded sections;
- language and version;
- starter code and current editor contents;
- input/output protocol;
- data bounds, time limit, and memory limit;
- wall-clock deadline and remaining task time;
- project root and files allowed to change;
- compile, run, test, and judge mechanisms;
- remaining local-run, official-test, judge, and submission quotas;
- current baseline score, passed checks, and partial-credit behavior;
- scoring dimensions and partial-credit rules;
- website AI assistant capabilities;
- website AI, automation, examination, and submission rules.

Create a problem fingerprint from the statement, language, starter code, and constraints. Record missing information as explicit assumptions. Do not silently invent it.

Exit artifact: `problem_contract`, `policy_mode`, and `resource_budget`.

## Continuous Budget Controller

Update the resource budget before and after every worker call, code change, test, judge call, and submission attempt. Unknown or unlimited quotas must be recorded explicitly rather than guessed.

Always keep:

```text
TIME_REMAINING:
LOCAL_RUNS_REMAINING:
OFFICIAL_TESTS_REMAINING:
JUDGE_CALLS_REMAINING:
SUBMISSIONS_REMAINING:
SUBMISSION_RESERVE:
CURRENT_VERIFIED_SCORE_OR_PASS_COUNT:
BEST_CANDIDATE_AND_ROLLBACK_ANCHOR:
```

Operate as an anytime controller:

- establish a compiling or partially passing baseline early;
- delegate the highest-value bounded task to the website AI assistant;
- prefer actions with the greatest expected verified score gain per unit of time and scarce quota;
- use local compilation, samples, and targeted diagnostics before official judge calls;
- spend an official run only when its result can validate a candidate or distinguish actionable hypotheses;
- checkpoint every candidate that improves verified score or passing tests;
- reserve enough time and quota to restore, sanity-check, and submit the best candidate.

When time or quota is healthy, explore materially different strategies. When either reaches its reserve threshold, freeze speculative work, restore the best verified candidate, and switch to stabilization. A verified partial score is better than an unverified theoretical full solution at deadline.

## L1 - Global Reconnaissance

Ask the worker to analyze without writing full code:

```text
Do not write the complete solution yet.

Return:
1. core objective;
2. exact input and output contract;
3. explicit constraints;
4. inferred constraints, each labelled as an assumption;
5. ambiguities;
6. key technical difficulties;
7. boundary cases;
8. likely hidden-test failures;
9. acceptance criteria;
10. recommended validation methods.

PROBLEM:
<exact problem content>
```

Reject invented requirements, omitted limits, changed output formats, and conclusions unsupported by the statement.

Exit artifact: `requirements_matrix`.

## L2 - Generate Candidate Strategies

Request at least three materially different candidates when the problem warrants it:

```text
Propose candidates without coding:
- A: implementation speed first;
- B: worst-case performance first;
- C: correctness and verification simplicity first.

For each provide the invariant, data structures, steps, time complexity,
space complexity, strengths, weaknesses, likely implementation failure,
and applicability conditions. End with a recommendation and uncertainty.
```

Leviathan selects or combines candidates based on constraints, remaining budget, expected score gain, hidden-test exposure, environment support, and verifiability. Do not select solely because the worker recommends it.

Exit artifact: `strategy_decision` with rejection reasons.

## L3 - Adversarial Review Before Coding

Ask a fresh review pass to attack the selected strategy:

```text
Act as an adversarial reviewer. Try to falsify the selected strategy.
Check requirement interpretation, complexity, invariants, state consistency,
boundaries, hidden tests, implementation risk, and test observability.
For every claim, provide the smallest counterexample or a concrete diagnostic.
Do not write replacement code.
```

Choose one transition: `keep`, `amend`, `replace`, or `add_guard`. Update the invariant and validation plan.

Exit artifact: `preimplementation_review`.

## L4 - Decompose Into Bounded Tasks

Create the smallest independently verifiable tasks, such as:

- T1 data model or parser;
- T2 core algorithm;
- T3 edge handling;
- T4 error handling;
- T5 tests and oracle;
- T6 performance checks;
- T7 final review.

Each task must define:

```text
Task ID:
Objective:
Allowed files/editor region:
Forbidden interfaces/dependencies:
Inputs and known evidence:
Expected output:
Acceptance checks:
Maximum change scope:
Rollback anchor:
Expected score or pass-count contribution:
Maximum time/run/test budget:
Abort condition:
```

Exit artifact: `task_graph` with dependencies and acceptance checks.

## L5 - Dispatch One Scoped Coding Task

Issue one bounded instruction at a time:

```text
Execute only <TASK_ID>: <OBJECTIVE>.

Allowed scope: <FILES_OR_REGION>
Do not change: <INTERFACES_AND_DEPENDENCIES>
Evidence: <CONFIRMED_FACTS>
Acceptance: <EXECUTABLE_CHECKS>
Remaining budget: <TIME_AND_RUN_TEST_LIMITS>
Expected score contribution: <POINTS_OR_PASSING_CHECKS>
Abort when: <TIME_QUOTA_OR_FAILURE_CONDITION>

Return the exact change, complexity, assumptions, immediate tests, and risks.
Do not perform unrelated refactoring or submit the answer.
```

Before retaining the candidate, inspect scope, interface compatibility, logic, unsupported APIs, unexplained code, and unrelated churn. Record a change ID and reversible before-state.

Exit artifact: `candidate_change`.

## L6 - Verify With Actual Evidence

Run the strongest available checks:

- syntax or compilation;
- provided samples;
- hand-built boundaries;
- adversarial cases;
- exception/error paths where relevant;
- randomized differential tests when an oracle is practical;
- large-input performance and memory checks;
- regression tests for existing code.

A worker statement that tests passed is not test evidence. Capture the command or judge action, input, expected output, actual output, exit status, duration when relevant, and exact failure text.

Do not consume an official test merely to confirm that an uncompiled or locally reproducible failure still fails. After each check, update the remaining quota and compare the candidate against the best verified checkpoint. Retain a candidate only when it improves evidence, score, passing checks, or diagnostic value enough to justify the consumed budget.

On failure, diagnose before rewriting:

```text
FAILED INPUT:
<input>
EXPECTED:
<expected>
ACTUAL:
<actual>
ERROR/TRACE:
<exact evidence>
RELEVANT CODE:
<minimum sufficient code>

Return at most three root-cause hypotheses. For each give a discriminating
diagnostic. Then propose the smallest repair. Do not change public interfaces
or rewrite unrelated modules.
```

Rollback a change when it breaks previously passing checks and has no isolated, evidenced repair.

Exit artifact: `verification_report`.

## L7 - Independent Cross-Review

Review as if the current code were wrong:

```text
Check complete requirement coverage, boundary omissions, overflow, bounds,
complexity degradation, input/output formatting, unsupported APIs, mutable
state leakage, nondeterminism, and hidden-test counterexamples.

For every issue give a trigger input, expected behavior, likely current
behavior, confidence, and minimal repair. Distinguish proven defects from
speculation.
```

Only act on reproducible defects or claims with sufficient evidence. Record rejected review findings and why they were rejected.

Exit artifact: `cross_review`.

## L8 - Align With The Scoring Function

Apply the relevant lens:

- correctness: prioritize boundaries, invariants, and hidden-test coverage;
- performance: verify worst-case time, peak memory, and duplicate work;
- engineering quality: verify interfaces, errors, maintainability, and tests;
- AI Coding process: retain task prompts, changes, evidence, and review rationale;
- partial credit: preserve verified working components and avoid speculative rewrites.

Do not trade verified correctness for an unmeasured optimization.

For every candidate record:

- verified score or passing-test count when exposed by the platform;
- locally verified checks when the platform hides scoring details;
- estimated remaining score opportunity, clearly labelled as an estimate;
- time and official-run cost needed for the next validation;
- regression risk relative to the best checkpoint.

Prefer the highest verified expected final score that can still be stabilized and submitted within the reserve. Do not continue low-yield analysis while a better verified candidate remains unsaved or unsubmitted near the deadline.

Exit artifact: `score_alignment_report`.

## L9 - Decide Whether The Result Is Submit-Ready

All applicable items must be true:

```text
[ ] Policy mode permits the requested assistance and submission behavior.
[ ] Requirements and assumptions are explicit.
[ ] The selected strategy passed adversarial review.
[ ] Code compiles or runs in the target environment.
[ ] Provided samples pass.
[ ] Relevant boundary and adversarial tests pass.
[ ] Existing tests were not broken.
[ ] Complexity fits the stated limits.
[ ] Input/output format is exact.
[ ] Change scope obeys the task contract.
[ ] No known high-severity defect remains.
[ ] External guidance, if used, was independently verified.
[ ] Submission authorization is present.
[ ] The best verified candidate is selected and recoverable.
[ ] Enough time and quota remain for the authorized submission action.
```

Possible terminal states:

- `ready_for_user_confirmation`: technically ready; final click needs consent.
- `ready_for_authorized_auto_submit`: explicit authorization and site rules permit it.
- `best_verified_partial_ready`: time or quota is constrained; the highest evidenced partial-score candidate is preserved and awaits the permitted submission decision.
- `blocked_with_evidence`: cannot safely finish; report exact blocker and next diagnostic.
- `assistance_only`: policy forbids automated solving or submission.

## Browser Editor Output

When an allowed task requires placing final code into a browser editor and the user requested visible typing, use `BrowserDevTools` action `stream_type_text`. Keep `clear=true`, use the requested delay, and require exact post-write verification. Do not submit as part of the typing action.
