# Stage 3: action-conditioned token-grid dynamics

## Scope

Stage 3 starts the action-conditioned world-model layer. It consumes the v1 EMA
target token grid selected in Stage 2. The old single-vector GRU remains for
compatibility, but it is not the selected dynamics architecture.

This stage does not claim autonomous game control. No existing local GameModel
session contains synchronized action records, so real dynamics training remains
blocked on new causal trajectory collection.

## Implemented architecture

`build_token_grid_action_dynamics` updates every spatial-temporal token at each
rollout step:

1. Encode the normalized 12-dimensional action and elapsed time.
2. Apply a shared GRU transition to each token.
3. Mix spatial information with a Transformer encoder layer.
4. Predict a residual next-state mean and a bounded per-token log variance.
5. Feed the predicted mean into the next rollout step.

`token_grid_dynamics_loss` reports Gaussian NLL, cosine similarity, predicted
standard deviation, and MSE/cosine metrics for every rollout horizon.

## Action recording

The realtime sidecar now writes `actions.jsonl` after each successful control
decision. Records use the same 12 fields as the Python training package and are
aligned to the current GameModel frame sequence.

- `live` mode records `source=policy`, because the plan was actually applied.
- `observe` mode records `source=pseudo`, because the plan was not applied.
- Failed input applications are not recorded as successful actions.
- Nanosecond timestamps are serialized as decimal strings so JavaScript does not
  lose integer precision; the Python reader converts them back to integers.

Existing sessions without `actions.jsonl` cannot be reconstructed as causal
trajectories.

## Real-data gate

Use:

```powershell
leviathan-game-jepa audit-action-session `
  --session "C:\Users\<user>\.leviathan\gamemodel\sessions\<session-id>" `
  --output action-session-audit.json
```

A session is eligible only when all current engineering thresholds pass:

- at least 128 non-takeover `human` or `policy` actions;
- at least 32 distinct matched frame sequences;
- at least 95% of causal actions matched to recorded frames;
- monotonic action timestamps and frame sequences.

Pseudo actions never count as causal training or test truth.

## GPU synthetic smoke

Command:

```powershell
leviathan-game-jepa smoke-dynamics `
  --config configs\jungle_phantom_private_research_v1.json `
  --output runs\jungle-phantom-token-grid-dynamics-smoke `
  --steps 40
```

Observed on an NVIDIA GeForce RTX 4060 Laptop GPU:

| Metric | Before | After 40 steps |
| --- | ---: | ---: |
| Mean multi-step MSE | 1.28731 | 0.00559 |
| Mean cosine similarity | 0.69542 | 0.99723 |
| Horizon-3 MSE | 2.38625 | 0.00838 |

The model has 597,312 parameters for the current 192-dimensional configuration.
This is an overfit learnability check on synthetic transitions, not evidence of
gameplay performance.

## Remaining blockers

- The 53 downloaded videos have no synchronized keyboard/mouse actions.
- All eight existing local GameModel sessions predate action logging.
- Human demonstration capture is not implemented. The current sidecar records
  only policy plans, with observe-mode plans correctly marked pseudo.
- No real train/validation/test trajectory corpus exists yet.
- Live eligibility still requires real multi-session evaluation, rollout drift
  gates, uncertainty calibration, and safety review.

## Next data milestone

Restart Leviathan from the updated source before collecting new sessions. Build
multiple independent sessions so splitting can occur by session or episode, not
by adjacent frames. Do not begin formal dynamics training until the audit gate
passes and validation/test sessions are independent from training sessions.
