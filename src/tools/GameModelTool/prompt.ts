import { GAME_MODEL_TOOL_NAME } from './constants.js'

export function getPrompt(): string {
  return `${GAME_MODEL_TOOL_NAME} controls Leviathan's dedicated realtime game-agent runtime.

Use it only after the user activates /gamemodel. This is intentionally separate from ComputerUse: ComputerUse is suitable for ordinary desktop UI, while GameModel maintains temporal world state, target identity, tactical decisions, input leases, and a parent-bound realtime sidecar.

Operating model:
1. initialize_profile creates the workspace profile for the requested game. The built-in profile is com.leviathan.game.nzm-future.
2. configure_capture selects windows_graphics_capture, windows_gdi_fallback, or external_native, sets 1-120 FPS, enables or disables recording, and sets dataset_sample_fps. Prefer windows_graphics_capture at 60 FPS with 1-3 annotation PNG samples per second when collecting data.
3. discover_window finds a visible window from the profile title/process patterns and returns a calibration screenshot. A caller may also provide an exact hwnd.
4. save_calibration captures the real game window and stores versioned, normalized ROI regions plus a reference-image digest. Use get_calibration to inspect it. Never invent ROI coordinates: derive them from the returned screenshot and keep HUD, navigation, combat-view, and target-search regions separate. If the game is on a menu, use menu_view/full_viewport only or wait for combat; never label a menu screenshot as combat_view.
5. save_menu_flow stores normalized, reusable actions for static screens such as map selection, difficulty selection, matchmaking, settlement, and returning home. Do not invent coordinates. Calibrate them from a real screenshot supplied by the user or a visible game window.
6. run_menu_flow executes a calibrated flow and returns a verification screenshot. It requires /gamemodel live.
7. start_session starts the realtime sidecar. It auto-discovers the profile window when hwnd is omitted. Observation mode never emits input and may use the built-in trusted-trace objective when objective is omitted. Demo mode requires a resolved hwnd, automatically records video plus at least 10 FPS aligned frames, records Windows Raw Input only while that exact game window is foreground, and never runs the tactical policy or emits input. Live mode requires both an explicit objective and a resolved hwnd, and checks that exact window remains foreground before every input plan.
8. Perception observations come only from capability-scoped adapters running inside the sidecar. The model cannot submit phase, HUD, target, threat, or navigation observations. Never invent these values.
9. get_summary reads the current belief state, trusted adapter status, measured FPS, sampled frames, dropped frames, black-frame count, and intent. set_goal, pause, resume, and stop_session manage lifecycle. stop_session always releases all held input.
10. build_dataset consumes a completed session's frames.index.jsonl, verifies image hashes, binds every sample to a calibration id, removes duplicate/black/low-motion frames, and creates deterministic train/validation/test splits. It never creates labels.
11. get_annotation_sample returns the next unlabeled image (or an exact sample id). save_annotation writes revisioned labels and an append-only audit entry. Mark model-produced labels as model; only mark reviewed after human verification.
12. evaluate_detector_benchmark compares a detector prediction JSONL against annotated ground truth, verifies image integrity, and reports coverage, phase/HUD errors, objective-arrow angular error, and IoU@0.5 detection metrics. A baseline report must use the same dataset id.
13. evaluate_replay replays observations.jsonl through the same deterministic world-state and policy logic, while distinguishing trusted adapter samples from legacy unverified records.

Important limits:
- The native Windows Graphics Capture adapter can submit only measured viewport, motion grid, luminance, black-frame health, and capture-performance fields. When recording is enabled it writes capture.mp4, sampled PNGs, and frames.index.jsonl. It has no capability to submit phase, HUD, navigation, target, or threat data.
- The Windows GDI adapter is a slower fallback and can submit only measured viewport and global motion fields.
- Continuous aiming requires a perception adapter to provide fresh targets. If observations become stale, the sidecar releases all input.
- Demo sessions write input-events.jsonl, actions.jsonl, clock.sync.jsonl, capture.mp4, sampled frames, and frames.index.jsonl. Only actions.jsonl contains normalized frame-aligned human actions suitable for the trajectory audit; focus-loss samples are marked as takeover and excluded from causal truth.
- Do not run ComputerUse key/mouse actions concurrently with a live GameModel session.
- Do not claim a map is supported until its menu coordinates, route graph, and perception assets have been calibrated and evaluated.`
}
