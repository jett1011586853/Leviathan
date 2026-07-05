import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { getPlatform } from '../../utils/platform.js'
import { parseDataUri } from '../BashTool/utils.js'
import {
  COMPUTER_USE_ACTIONS,
  COMPUTER_USE_TOOL_NAME,
  isVSCodeComputerUseAction,
  type ComputerUseAction,
} from './constants.js'
import { getPrompt } from './prompt.js'
import { runVSCodeComputerUse } from './vscodeComputerUse.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
} from './UI.js'
import {
  runWindowsComputerUse,
  type ComputerUseInput,
  type ComputerUseOutput,
  type ComputerUseScreenshot,
} from './windowsComputerUse.js'

const inputSchema = lazySchema(() => {
  const stepSchema = z.strictObject({
    action: z.enum(COMPUTER_USE_ACTIONS).describe('Computer Use step action to run.'),
    hwnd: z
      .string()
      .optional()
      .describe('Target window handle returned by list_apps or list_windows.'),
    x: z
      .number()
      .optional()
      .describe('X coordinate in the latest screenshot for this hwnd; absolute screen coordinate when hwnd is omitted.'),
    y: z
      .number()
      .optional()
      .describe('Y coordinate in the latest screenshot for this hwnd; absolute screen coordinate when hwnd is omitted.'),
    to_x: z.number().optional().describe('Drag target X coordinate.'),
    to_y: z.number().optional().describe('Drag target Y coordinate.'),
    text: z.string().optional().describe('Literal text for type_text.'),
    key: z
      .string()
      .optional()
      .describe('Key or shortcut for press_key, such as Enter, Ctrl+A, Alt+F4, or Shift+Tab.'),
    button: z
      .enum(['left', 'right', 'middle'])
      .optional()
      .describe('Mouse button for click actions.'),
    scroll_x: z.number().optional().describe('Horizontal scroll delta.'),
    scroll_y: z
      .number()
      .optional()
      .describe('Vertical scroll delta. Positive scrolls down; negative scroll_y scrolls up.'),
    duration_ms: z
      .number()
      .int()
      .min(0)
      .max(30_000)
      .optional()
      .describe('Duration for wait, in milliseconds.'),
    max_image_dimension: z
      .number()
      .int()
      .min(320)
      .max(2400)
      .optional()
      .describe('Maximum screenshot width or height before downscaling. Defaults to 1400.'),
    include_screenshot: z
      .boolean()
      .optional()
      .describe('For get_window_state, include a screenshot. Defaults to true.'),
    include_text: z
      .boolean()
      .optional()
      .describe('For get_window_state, include a bounded accessibility tree. Defaults to false.'),
  })

  return z.strictObject({
    action: z.enum(COMPUTER_USE_ACTIONS).describe('Computer Use action to run.'),
    hwnd: z
      .string()
      .optional()
      .describe('Target window handle returned by list_apps or list_windows.'),
    x: z
      .number()
      .optional()
      .describe('X coordinate in the latest screenshot for this hwnd; absolute screen coordinate when hwnd is omitted.'),
    y: z
      .number()
      .optional()
      .describe('Y coordinate in the latest screenshot for this hwnd; absolute screen coordinate when hwnd is omitted.'),
    to_x: z.number().optional().describe('Drag target X coordinate.'),
    to_y: z.number().optional().describe('Drag target Y coordinate.'),
    text: z.string().optional().describe('Literal text for type_text.'),
    key: z
      .string()
      .optional()
      .describe('Key or shortcut for press_key, such as Enter, Ctrl+A, Alt+F4, or Shift+Tab.'),
    button: z
      .enum(['left', 'right', 'middle'])
      .optional()
      .describe('Mouse button for click actions.'),
    scroll_x: z.number().optional().describe('Horizontal scroll delta.'),
    scroll_y: z
      .number()
      .optional()
      .describe('Vertical scroll delta. Positive scroll_y scrolls down; negative scroll_y scrolls up.'),
    duration_ms: z
      .number()
      .int()
      .min(0)
      .max(30_000)
      .optional()
      .describe('Duration for wait, in milliseconds.'),
    max_image_dimension: z
      .number()
      .int()
      .min(320)
      .max(2400)
      .optional()
      .describe('Maximum screenshot width or height before downscaling. Defaults to 1400.'),
    include_screenshot: z
      .boolean()
      .optional()
      .describe('For get_window_state, include a screenshot. Defaults to true.'),
    include_text: z
      .boolean()
      .optional()
      .describe('For get_window_state, include a bounded accessibility tree. Defaults to false.'),
    steps: z
      .array(stepSchema)
      .max(20)
      .optional()
      .describe('For sequence, stable Computer Use steps to run in one backend call. Steps inherit the top-level hwnd when omitted.'),
    screenshot_after: z
      .boolean()
      .optional()
      .describe('For sequence, capture get_window_state after all steps.'),
    path: z
      .string()
      .optional()
      .describe('Path for vscode_open, vscode_add_folder, vscode_remove_folder, or extension VSIX path. Relative paths resolve from the workspace.'),
    paths: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Paths for vscode_open. Relative paths resolve from the workspace.'),
    file: z
      .string()
      .optional()
      .describe('File path for vscode_open_file. Relative paths resolve from the workspace.'),
    left_file: z
      .string()
      .optional()
      .describe('Left file for vscode_open_diff. Relative paths resolve from the workspace.'),
    right_file: z
      .string()
      .optional()
      .describe('Right file for vscode_open_diff. Relative paths resolve from the workspace.'),
    line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('1-based line number for vscode_open_file.'),
    column: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('1-based column number for vscode_open_file.'),
    command: z
      .string()
      .optional()
      .describe('VSCode command id for vscode_run_command, such as workbench.action.showCommands.'),
    command_args: z
      .array(z.unknown())
      .max(20)
      .optional()
      .describe('JSON-serializable argument array for vscode_run_command.'),
    url: z
      .string()
      .optional()
      .describe('vscode:// or vscode-insiders:// URI for vscode_open_uri.'),
    prompt: z
      .string()
      .optional()
      .describe('Prompt text for vscode_chat.'),
    extension_id: z
      .string()
      .optional()
      .describe('Extension id for vscode_install_extension or vscode_uninstall_extension, such as ms-python.python.'),
    force: z
      .boolean()
      .optional()
      .describe('For vscode_install_extension, force install/update.'),
    pre_release: z
      .boolean()
      .optional()
      .describe('For vscode_install_extension, install pre-release version.'),
    show_versions: z
      .boolean()
      .optional()
      .describe('For vscode_list_extensions, include extension versions.'),
    new_window: z
      .boolean()
      .optional()
      .describe('For VSCode open actions, open a new window.'),
    reuse_window: z
      .boolean()
      .optional()
      .describe('For VSCode open actions, reuse the active window. Defaults to true.'),
    profile: z
      .string()
      .optional()
      .describe('Optional VSCode profile name for open actions.'),
    timeout_ms: z
      .number()
      .int()
      .min(500)
      .max(180_000)
      .optional()
      .describe('Timeout for VSCode native actions. Defaults to 15000.'),
    typing_delay_ms: z
      .number()
      .int()
      .min(0)
      .max(1000)
      .optional()
      .describe('For vscode_type_text, delay between simulated keystrokes. Defaults to 4 ms.'),
    disable_auto_indent: z
      .boolean()
      .optional()
      .describe('For vscode_type_text, temporarily disable VSCode auto indentation and format-on-type before typing. Defaults to true.'),
    restore_auto_indent: z
      .boolean()
      .optional()
      .describe('For vscode_type_text, restore the previous VSCode settings after typing. Defaults to true.'),
    vscode_settings_path: z
      .string()
      .optional()
      .describe('Optional settings.json path to edit while disabling auto indentation for vscode_type_text.'),
  })
})

const windowSchema = z.object({
  hwnd: z.string(),
  title: z.string(),
  processName: z.string(),
  processId: z.number(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  blockedReason: z.string().optional(),
})

const outputSchema = lazySchema(() => {
  const screenshotSchema = z.object({
    dataUrl: z.string(),
    mediaType: z.literal('image/png'),
    width: z.number(),
    height: z.number(),
    originalWidth: z.number(),
    originalHeight: z.number(),
    originX: z.number(),
    originY: z.number(),
    scale: z.number(),
    coordinateSpace: z.literal('screenshot').optional(),
    hwnd: z.string().optional(),
  })
  const appSchema = z.object({
    id: z.string(),
    displayName: z.string(),
    isRunning: z.boolean(),
    windows: z.array(windowSchema),
  })
  const stateSchema = z.object({
    window: windowSchema,
    screenshots: z.array(screenshotSchema),
    accessibility: z
      .object({
        tree: z.string(),
        focused_element: z.string().optional(),
        selected_text: z.string().optional(),
        selected_elements: z.array(z.string()).optional(),
        document_text: z.string().optional(),
      })
      .nullable(),
  })

  return z.object({
    ok: z.boolean(),
    action: z.enum(COMPUTER_USE_ACTIONS),
    message: z.string(),
    backend: z.literal('persistent-powershell').optional(),
    latencyMs: z.number().optional(),
    apps: z.array(appSchema).optional(),
    windows: z.array(windowSchema).optional(),
    window: windowSchema.optional(),
    screenshot: screenshotSchema.optional(),
    state: stateSchema.optional(),
    steps: z
      .array(
        z.object({
          ok: z.boolean(),
          action: z.enum(COMPUTER_USE_ACTIONS),
          message: z.string(),
        }),
      )
      .optional(),
    vscode: z
      .object({
        executable: z.string(),
        args: z.array(z.string()),
        exitCode: z.number(),
        stdout: z.string(),
        stderr: z.string(),
        uri: z.string().optional(),
        version: z.string().optional(),
        extensions: z.array(z.string()).optional(),
        typedCharacters: z.number().optional(),
        autoIndentDisabled: z.boolean().optional(),
        autoIndentRestored: z.boolean().optional(),
        settingsPath: z.string().optional(),
      })
      .optional(),
  })
})

type InputSchema = ReturnType<typeof inputSchema>
type OutputSchema = ReturnType<typeof outputSchema>

function permissionRuleContent(action: ComputerUseAction): string {
  return `action:${action}`
}

function buildSuggestions(action: ComputerUseAction) {
  return [
    {
      type: 'addRules' as const,
      destination: 'session' as const,
      rules: [
        {
          toolName: COMPUTER_USE_TOOL_NAME,
          ruleContent: permissionRuleContent(action),
        },
      ],
      behavior: 'allow' as const,
    },
  ]
}

function actionNeedsCoordinates(action: ComputerUseAction): boolean {
  return ['click', 'double_click', 'right_click', 'scroll', 'drag'].includes(
    action,
  )
}

function actionNeedsHwnd(action: ComputerUseAction): boolean {
  return ['activate_window', 'get_window', 'get_window_state'].includes(action)
}

function isReadOnlyAction(action: ComputerUseAction | undefined): boolean {
  return [
    'list_apps',
    'list_windows',
    'get_active_window',
    'get_active_window_state',
    'get_window',
    'get_window_state',
    'screenshot',
    'vscode_version',
    'vscode_status',
    'vscode_list_extensions',
  ].includes(action ?? '')
}

function containsForbiddenKeyChord(key: string | undefined): boolean {
  return /(^|[+_\-\s])(win|windows|meta|super|cmd|command|os)([+_\-\s]|$)/i.test(
    key ?? '',
  )
}

export const ComputerUseTool = buildTool({
  name: COMPUTER_USE_TOOL_NAME,
  searchHint: 'control local Windows desktop apps with screenshots, mouse, and keyboard',
  maxResultSizeChars: Infinity,
  shouldDefer: true,
  async description(input) {
    const action = (input as Partial<ComputerUseInput>).action
    return action
      ? `Leviathan wants to control the computer: ${action}`
      : 'Leviathan wants to control the computer'
  },
  userFacingName() {
    return 'Computer Use'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input as Partial<ComputerUseInput>)
    return summary ? `Using computer: ${summary}` : 'Using computer'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return getPlatform() === 'windows'
  },
  isReadOnly(input) {
    return isReadOnlyAction((input as Partial<ComputerUseInput>).action)
  },
  toAutoClassifierInput(input) {
    return `${input.action}${input.hwnd ? ` hwnd=${input.hwnd}` : ''}`
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const action = input.action
    const permissionContext = context.getAppState().toolPermissionContext

    if (permissionContext.mode === 'bypassPermissions') {
      return { behavior: 'allow', updatedInput: input }
    }

    const ruleContent = permissionRuleContent(action)
    const denyRule = getRuleByContentsForTool(
      permissionContext,
      ComputerUseTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `${COMPUTER_USE_TOOL_NAME} denied ${ruleContent}.`,
        decisionReason: { type: 'rule', rule: denyRule },
      }
    }

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      ComputerUseTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: { type: 'rule', rule: allowRule },
      }
    }

    return {
      behavior: 'ask',
      message: `Leviathan requested permission to use Computer Use (${action}).`,
      updatedInput: input,
      suggestions: buildSuggestions(action),
    }
  },
  async validateInput(input): Promise<{ result: true } | { result: false; message: string; errorCode: number }> {
    if (getPlatform() !== 'windows') {
      return {
        result: false,
        message: 'Computer Use is currently implemented for Windows only.',
        errorCode: 1,
      }
    }
    if (actionNeedsHwnd(input.action) && !input.hwnd) {
      return {
        result: false,
        message: `${input.action} requires hwnd from list_apps or list_windows.`,
        errorCode: 2,
      }
    }
    if (
      actionNeedsCoordinates(input.action) &&
      (input.x === undefined || input.y === undefined)
    ) {
      return {
        result: false,
        message: `${input.action} requires x and y coordinates.`,
        errorCode: 3,
      }
    }
    if (
      input.action === 'drag' &&
      (input.to_x === undefined || input.to_y === undefined)
    ) {
      return {
        result: false,
        message: 'drag requires to_x and to_y coordinates.',
        errorCode: 4,
      }
    }
    if (
      (input.action === 'type_text' || input.action === 'vscode_type_text') &&
      input.text === undefined
    ) {
      return {
        result: false,
        message: `${input.action} requires text.`,
        errorCode: 5,
      }
    }
    if (input.action === 'press_key' && !input.key) {
      return {
        result: false,
        message: 'press_key requires key.',
        errorCode: 6,
      }
    }
    if (input.action === 'press_key' && containsForbiddenKeyChord(input.key)) {
      return {
        result: false,
        message: 'Computer Use does not allow Windows/Meta key shortcuts.',
        errorCode: 7,
      }
    }
    if (input.action === 'sequence') {
      if (!input.steps?.length) {
        return {
          result: false,
          message: 'sequence requires at least one step.',
          errorCode: 8,
        }
      }
      if (input.steps.some(step => step.action === 'sequence')) {
        return {
          result: false,
          message: 'nested sequence actions are not supported.',
          errorCode: 9,
        }
      }
      if (input.steps.some(step => isVSCodeComputerUseAction(step.action))) {
        return {
          result: false,
          message: 'VSCode native actions cannot be nested inside sequence.',
          errorCode: 11,
        }
      }
      if (input.steps.some(step => step.action === 'press_key' && containsForbiddenKeyChord(step.key))) {
        return {
          result: false,
          message: 'Computer Use does not allow Windows/Meta key shortcuts.',
          errorCode: 10,
        }
      }
    }
    if (isVSCodeComputerUseAction(input.action)) {
      const missingField = getMissingVSCodeField(input as ComputerUseInput)
      if (missingField) {
        return {
          result: false,
          message: `${input.action} requires ${missingField}.`,
          errorCode: 12,
        }
      }
      if (input.action === 'vscode_open_uri' && !isAllowedVSCodeUri(input.url)) {
        return {
          result: false,
          message: 'vscode_open_uri only accepts vscode:// or vscode-insiders:// URIs.',
          errorCode: 13,
        }
      }
    }
    return { result: true }
  },
  async prompt() {
    return getPrompt()
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input, context) {
    const output = isVSCodeComputerUseAction(
      (input as ComputerUseInput).action,
    )
      ? await runVSCodeComputerUse(
          input as ComputerUseInput,
          context.abortController.signal,
        )
      : await runWindowsComputerUse(
          input as ComputerUseInput,
          context.abortController.signal,
        )
    return { data: output }
  },
  mapToolResultToToolResultBlockParam(
    output: ComputerUseOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    const text = outputForModel(output)
    const screenshot = getPrimaryScreenshot(output)
    const parsedImage = screenshot ? parseDataUri(screenshot.dataUrl) : null
    if (parsedImage) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [
          { type: 'text', text },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: parsedImage.mediaType as 'image/png',
              data: parsedImage.data,
            },
          },
        ],
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: text,
    }
  },
} satisfies ToolDef<InputSchema, z.infer<OutputSchema>>)

function getPrimaryScreenshot(
  output: ComputerUseOutput,
): ComputerUseScreenshot | undefined {
  return output.screenshot ?? output.state?.screenshots?.[0]
}

function outputForModel(output: ComputerUseOutput): string {
  const safeOutput = {
    ...output,
    screenshot: output.screenshot
      ? {
          ...output.screenshot,
          dataUrl: '[image attached]',
        }
      : undefined,
    state: output.state
      ? {
          ...output.state,
          screenshots: output.state.screenshots.map(screenshot => ({
            ...screenshot,
            dataUrl: '[image attached]',
          })),
        }
      : undefined,
  }
  return JSON.stringify(safeOutput, null, 2)
}

function getMissingVSCodeField(input: ComputerUseInput): string | null {
  switch (input.action) {
    case 'vscode_open_file':
      return input.file ? null : 'file'
    case 'vscode_open_diff':
      if (!input.left_file) return 'left_file'
      return input.right_file ? null : 'right_file'
    case 'vscode_add_folder':
    case 'vscode_remove_folder':
      return input.path ? null : 'path'
    case 'vscode_run_command':
      return input.command ? null : 'command'
    case 'vscode_open_uri':
      return input.url ? null : 'url'
    case 'vscode_chat':
      return input.prompt ? null : 'prompt'
    case 'vscode_install_extension':
      return input.extension_id || input.path ? null : 'extension_id'
    case 'vscode_uninstall_extension':
      return input.extension_id ? null : 'extension_id'
    default:
      return null
  }
}

function isAllowedVSCodeUri(url: string | undefined): boolean {
  return /^vscode(?:-insiders)?:\/\//i.test(url?.trim() ?? '')
}
