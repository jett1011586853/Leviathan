export const BROWSER_DEVTOOLS_TOOL_NAME = 'BrowserDevTools'

export const BROWSER_DEVTOOLS_ACTIONS = [
  'launch_browser',
  'connect',
  'list_tabs',
  'new_tab',
  'navigate',
  'evaluate',
  'snapshot',
  'click',
  'type_text',
  'press_key',
  'screenshot',
  'close_tab',
] as const

export type BrowserDevToolsAction =
  (typeof BROWSER_DEVTOOLS_ACTIONS)[number]
