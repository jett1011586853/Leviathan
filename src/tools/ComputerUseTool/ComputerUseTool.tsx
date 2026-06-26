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
  type ComputerUseAction,
} from './constants.js'
import { getPrompt } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
} from './UI.js'
import {
  runWindowsComputerUse,
  type ComputerUseInput,
  type ComputerUseOutput,
} from './windowsComputerUse.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(COMPUTER_USE_ACTIONS).describe('Computer Use action to run.'),
    hwnd: z
      .string()
      .optional()
      .describe('Target window handle returned by list_windows.'),
    x: z
      .number()
      .optional()
      .describe('X coordinate. With hwnd this is window-relative; otherwise absolute screen coordinate.'),
    y: z
      .number()
      .optional()
      .describe('Y coordinate. With hwnd this is window-relative; otherwise absolute screen coordinate.'),
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
      .describe('Vertical scroll delta. Positive scrolls down; negative scrolls up.'),
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
  }),
)

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

const outputSchema = lazySchema(() =>
  z.object({
    ok: z.boolean(),
    action: z.enum(COMPUTER_USE_ACTIONS),
    message: z.string(),
    windows: z.array(windowSchema).optional(),
    window: windowSchema.optional(),
    screenshot: z
      .object({
        dataUrl: z.string(),
        mediaType: z.literal('image/png'),
        width: z.number(),
        height: z.number(),
        originalWidth: z.number(),
        originalHeight: z.number(),
        originX: z.number(),
        originY: z.number(),
        scale: z.number(),
        hwnd: z.string().optional(),
      })
      .optional(),
  }),
)

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
  return action === 'activate_window'
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
    const summary = getToolUseSummary(input)
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
  isReadOnly(input?: Partial<ComputerUseInput>) {
    return input?.action === 'list_windows' || input?.action === 'screenshot'
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
        message: `${input.action} requires hwnd from list_windows.`,
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
    if (input.action === 'type_text' && input.text === undefined) {
      return {
        result: false,
        message: 'type_text requires text.',
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
    return { result: true }
  },
  async prompt() {
    return getPrompt()
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input, context) {
    const output = await runWindowsComputerUse(
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
    const parsedImage = output.screenshot
      ? parseDataUri(output.screenshot.dataUrl)
      : null
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
} satisfies ToolDef<z.infer<InputSchema>, z.infer<OutputSchema>>)

function outputForModel(output: ComputerUseOutput): string {
  const safeOutput = output.screenshot
    ? {
        ...output,
        screenshot: {
          ...output.screenshot,
          dataUrl: '[image attached]',
        },
      }
    : output
  return JSON.stringify(safeOutput, null, 2)
}
