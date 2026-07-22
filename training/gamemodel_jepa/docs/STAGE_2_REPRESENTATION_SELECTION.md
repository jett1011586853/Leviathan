# Stage 2: Game-JEPA representation selection

## Decision

Use the v1 EMA target token grid as the primary world state. Keep the pooled
vector only as a compatibility summary. Do not use the v2-v4 pooled state heads
for action dynamics.

The selected checkpoint remains private-research-only and is not live-control
eligible.

## Why

The first pooled-state metric suggested collapse, but it averaged 49 spatial
tokens before evaluation. That operation discards the spatial layout needed for
targets, HUD elements, navigation, and threats. The evaluator now measures both
the pooled summary and the complete spatial-temporal token grid.

### Validation comparison (128 windows)

| Candidate | Masked-token cosine | Target-grid effective rank | Random baseline rank | Rank retention | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| v1 target token grid | 0.97187 | 44.29856 | 44.14767 | 1.00342 | Select |
| v3 strong pooled-state regularization | 0.97242 | 22.95710 | 44.14768 | 0.51999 | Reject |

The v3 online pooled state reduced pairwise cosine to 0.89444, but its effective
rank was only 2.59747. It spread examples mainly along a few axes rather than
preserving broad state information.

The v4 contrastive queue exposed a second failure: online and EMA target states
diverged (cosine 0.36286), while validation contrastive accuracy was only
0.28125 versus a 0.25 in-batch random level. It is retained as an experiment,
not selected as the base representation.

### Held-out test confirmation (225 windows)

| Metric | Trained v1 | Untrained baseline |
| --- | ---: | ---: |
| Masked-token cosine | 0.96649 | -0.04200 |
| Target-grid effective rank | 56.10380 | 55.34082 |
| Target-grid pairwise cosine | 0.97544 | 0.97003 |

The test gate passes: prediction cosine is at least 0.9, token-grid rank
retention is at least 0.9, and pairwise cosine increases by no more than 0.02.

## Evidence

- `runs/jungle-phantom-private-baseline-v1/validation-evaluation-token-grid-128.json`
- `runs/jungle-phantom-private-baseline-v1/test-evaluation-token-grid-full.json`
- `runs/jungle-phantom-private-v3-strong-60step/validation-evaluation-token-grid.json`
- `runs/jungle-phantom-private-v4-contrastive-60step/validation-evaluation.json`

## Limits

- The dataset contains 403,564 unique video tokens, below the formal 50M-token
  target.
- The held-out test split contains one independent content group, so it cannot
  establish broad gameplay generalization.
- The source videos and derived checkpoint are private-research-only.
- No aligned player actions are present. This stage validates visual latent
  prediction, not action-conditioned dynamics or game control.

## Next stage

Train action-conditioned dynamics over the target token grid. Before training,
collect or derive time-aligned action trajectories and define prediction gates
for short-horizon latent rollout, multi-step drift, and uncertainty. The pooled
summary must not be substituted for the token grid in that stage.
