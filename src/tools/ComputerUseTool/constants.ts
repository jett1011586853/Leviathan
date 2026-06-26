export const COMPUTER_USE_TOOL_NAME = 'ComputerUse'

export const COMPUTER_USE_ACTIONS = [
  'list_apps',
  'list_windows',
  'get_window',
  'get_window_state',
  'screenshot',
  'activate_window',
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'scroll',
  'drag',
  'sequence',
  'wait',
] as const

export type ComputerUseAction = (typeof COMPUTER_USE_ACTIONS)[number]
