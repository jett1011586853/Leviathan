export const COMPUTER_USE_TOOL_NAME = 'ComputerUse'

export const COMPUTER_USE_DESKTOP_ACTIONS = [
  'list_apps',
  'list_windows',
  'get_active_window',
  'get_active_window_state',
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

export const COMPUTER_USE_VSCODE_ACTIONS = [
  'vscode_version',
  'vscode_status',
  'vscode_open',
  'vscode_open_file',
  'vscode_open_diff',
  'vscode_add_folder',
  'vscode_remove_folder',
  'vscode_run_command',
  'vscode_open_uri',
  'vscode_type_text',
  'vscode_chat',
  'vscode_list_extensions',
  'vscode_install_extension',
  'vscode_uninstall_extension',
  'vscode_update_extensions',
] as const

export const COMPUTER_USE_ACTIONS = [
  ...COMPUTER_USE_DESKTOP_ACTIONS,
  ...COMPUTER_USE_VSCODE_ACTIONS,
] as const

export type ComputerUseAction = (typeof COMPUTER_USE_ACTIONS)[number]
export type VSCodeComputerUseAction =
  (typeof COMPUTER_USE_VSCODE_ACTIONS)[number]

export function isVSCodeComputerUseAction(
  action: ComputerUseAction | undefined,
): action is VSCodeComputerUseAction {
  return COMPUTER_USE_VSCODE_ACTIONS.includes(
    action as VSCodeComputerUseAction,
  )
}
