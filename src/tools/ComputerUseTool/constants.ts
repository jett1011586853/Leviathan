export const COMPUTER_USE_TOOL_NAME = 'ComputerUse'

export const COMPUTER_USE_ACTIONS = [
  'list_windows',
  'screenshot',
  'activate_window',
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'scroll',
  'drag',
  'wait',
] as const

export type ComputerUseAction = (typeof COMPUTER_USE_ACTIONS)[number]
