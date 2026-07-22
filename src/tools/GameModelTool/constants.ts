export const GAME_MODEL_TOOL_NAME = 'GameModel'

export const GAME_MODEL_ACTIONS = [
  'initialize_profile',
  'get_profile',
  'configure_capture',
  'get_calibration',
  'save_calibration',
  'discover_window',
  'save_menu_flow',
  'run_menu_flow',
  'start_session',
  'set_goal',
  'get_summary',
  'pause',
  'resume',
  'stop_session',
  'evaluate_replay',
  'build_dataset',
  'get_annotation_sample',
  'save_annotation',
  'evaluate_detector_benchmark',
] as const

export type GameModelAction = (typeof GAME_MODEL_ACTIONS)[number]
