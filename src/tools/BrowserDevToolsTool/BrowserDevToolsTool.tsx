import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { parseDataUri } from '../BashTool/utils.js'
import {
  runBrowserDevTools,
  type BrowserDevToolsInput,
  type BrowserDevToolsOutput,
} from './browserDevTools.js'
import {
  BROWSER_DEVTOOLS_ACTIONS,
  BROWSER_DEVTOOLS_TOOL_NAME,
  type BrowserDevToolsAction,
} from './constants.js'
import { getPrompt } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(BROWSER_DEVTOOLS_ACTIONS)
      .describe('Browser DevTools action to run.'),
    host: z
      .string()
      .optional()
      .describe('DevTools host. Defaults to 127.0.0.1.'),
    port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe('DevTools port. Defaults to 9222.'),
    browser: z
      .enum(['auto', 'edge', 'chrome', 'brave'])
      .optional()
      .describe('Browser to launch for launch_browser. Defaults to auto.'),
    url: z
      .string()
      .optional()
      .describe('URL for launch_browser, new_tab, or navigate.'),
    tab_id: z
      .string()
      .optional()
      .describe('Target tab id returned by list_tabs. Defaults to the first page tab.'),
    expression: z
      .string()
      .optional()
      .describe('JavaScript expression to evaluate in the page.'),
    selector: z
      .string()
      .optional()
      .describe('CSS selector for click or type_text. Prefer selectors returned by snapshot.'),
    text: z.string().optional().describe('Text for type_text.'),
    key: z
      .string()
      .optional()
      .describe('Simple key for press_key, such as Enter, Tab, Escape, Backspace, Delete, Left, Right, Up, Down.'),
    timeout_ms: z
      .number()
      .int()
      .min(500)
      .max(60_000)
      .optional()
      .describe('Action timeout in milliseconds. Defaults to 10000.'),
    user_data_dir: z
      .string()
      .optional()
      .describe('Optional browser user data directory for launch_browser. Defaults to Leviathan config storage.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const tabSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  url: z.string(),
  webSocketDebuggerUrl: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    ok: z.boolean(),
    action: z.enum(BROWSER_DEVTOOLS_ACTIONS),
    message: z.string(),
    endpoint: z.string().optional(),
    browser: z.string().optional(),
    tab: tabSchema.optional(),
    tabs: z.array(tabSchema).optional(),
    result: z.unknown().optional(),
    snapshot: z
      .object({
        title: z.string(),
        url: z.string(),
        readyState: z.string(),
        text: z.string(),
        elements: z.array(
          z.object({
            selector: z.string(),
            tag: z.string(),
            text: z.string(),
            ariaLabel: z.string(),
            placeholder: z.string(),
            role: z.string(),
            href: z.string(),
            visible: z.boolean(),
          }),
        ),
      })
      .optional(),
    screenshot: z
      .object({
        dataUrl: z.string(),
        mediaType: z.literal('image/png'),
      })
      .optional(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>

function permissionRuleContent(action: BrowserDevToolsAction): string {
  return `action:${action}`
}

function buildSuggestions(action: BrowserDevToolsAction) {
  return [
    {
      type: 'addRules' as const,
      destination: 'session' as const,
      rules: [
        {
          toolName: BROWSER_DEVTOOLS_TOOL_NAME,
          ruleContent: permissionRuleContent(action),
        },
      ],
      behavior: 'allow' as const,
    },
  ]
}

function isReadOnlyAction(action: BrowserDevToolsAction | undefined): boolean {
  return ['connect', 'list_tabs', 'snapshot', 'screenshot'].includes(
    action ?? '',
  )
}

export const BrowserDevToolsTool = buildTool({
  name: BROWSER_DEVTOOLS_TOOL_NAME,
  searchHint: 'control Chromium browsers through DevTools console and DOM selectors',
  maxResultSizeChars: Infinity,
  shouldDefer: true,
  async description(input) {
    return `Leviathan wants to use Browser DevTools: ${input.action}`
  },
  userFacingName() {
    return 'Browser DevTools'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input as Partial<BrowserDevToolsInput>)
    return summary ? `Using browser: ${summary}` : 'Using browser'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isReadOnly(input) {
    return isReadOnlyAction((input as BrowserDevToolsInput).action)
  },
  toAutoClassifierInput(input) {
    return `${input.action}${input.url ? ` url=${input.url}` : ''}${input.selector ? ` selector=${input.selector}` : ''}`
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
      BrowserDevToolsTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `${BROWSER_DEVTOOLS_TOOL_NAME} denied ${ruleContent}.`,
        decisionReason: { type: 'rule', rule: denyRule },
      }
    }

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      BrowserDevToolsTool,
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
      message: `Leviathan requested permission to use Browser DevTools (${action}).`,
      updatedInput: input,
      suggestions: buildSuggestions(action),
    }
  },
  async validateInput(input) {
    if (['new_tab', 'navigate'].includes(input.action) && !input.url) {
      return {
        result: false,
        message: `${input.action} requires url.`,
        errorCode: 1,
      }
    }
    if (input.action === 'evaluate' && !input.expression) {
      return {
        result: false,
        message: 'evaluate requires expression.',
        errorCode: 2,
      }
    }
    if (['click', 'type_text'].includes(input.action) && !input.selector) {
      return {
        result: false,
        message: `${input.action} requires selector.`,
        errorCode: 3,
      }
    }
    if (input.action === 'press_key' && !input.key) {
      return {
        result: false,
        message: 'press_key requires key.',
        errorCode: 4,
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
    const output = await runBrowserDevTools(
      input as BrowserDevToolsInput,
      context.abortController.signal,
    )
    return { data: output }
  },
  mapToolResultToToolResultBlockParam(
    output: BrowserDevToolsOutput,
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
} satisfies ToolDef<InputSchema, z.infer<OutputSchema>>)

function outputForModel(output: BrowserDevToolsOutput): string {
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
