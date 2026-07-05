import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../Tool.js'
import { getTools } from '../tools.js'
import { ComputerUseTool } from '../tools/ComputerUseTool/ComputerUseTool.js'
import {
  COMPUTER_USE_TOOL_NAME,
  isVSCodeComputerUseAction,
} from '../tools/ComputerUseTool/constants.js'
import { BROWSER_DEVTOOLS_TOOL_NAME } from '../tools/BrowserDevToolsTool/constants.js'
import {
  buildVSCodeCommandUri,
  buildVSCodePlan,
} from '../tools/ComputerUseTool/vscodeComputerUse.js'
import { getPlatform } from '../utils/platform.js'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function contextWithMode(mode: 'default' | 'bypassPermissions') {
  return {
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
        isBypassPermissionsModeAvailable: true,
      },
    }),
  } as ToolUseContext
}

describe('Leviathan Computer Use tool', () => {
  test('is gated by the Computer Use feature switch', () => {
    const tools = getTools(getEmptyToolPermissionContext())
    const hasComputerUse = tools.some(tool => tool.name === COMPUTER_USE_TOOL_NAME)
    expect(hasComputerUse).toBe(false)

    const enabledTools = getTools(getEmptyToolPermissionContext(), {
      includeComputerUseTools: true,
    })
    const hasEnabledComputerUse = enabledTools.some(
      tool => tool.name === COMPUTER_USE_TOOL_NAME,
    )
    const hasBrowserDevTools = enabledTools.some(
      tool => tool.name === BROWSER_DEVTOOLS_TOOL_NAME,
    )
    expect(hasEnabledComputerUse).toBe(getPlatform() === 'windows')
    expect(hasBrowserDevTools).toBe(false)
  })

  test('asks for permission by default and allows full access mode', async () => {
    const input = { action: 'list_windows' as const }

    const defaultDecision = await ComputerUseTool.checkPermissions(
      input,
      contextWithMode('default'),
    )
    expect(defaultDecision.behavior).toBe('ask')
    expect(
      defaultDecision.behavior === 'ask'
        ? defaultDecision.suggestions?.[0]?.type
        : undefined,
    ).toBe('addRules')

    const bypassDecision = await ComputerUseTool.checkPermissions(
      input,
      contextWithMode('bypassPermissions'),
    )
    expect(bypassDecision.behavior).toBe('allow')
  })

  test('returns screenshots as model-visible image blocks without exposing data URI text', () => {
    const screenshot = {
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZ3w7QAAAABJRU5ErkJggg==',
      mediaType: 'image/png' as const,
      width: 1,
      height: 1,
      originalWidth: 1,
      originalHeight: 1,
      originX: 0,
      originY: 0,
      scale: 1,
      coordinateSpace: 'screenshot' as const,
    }
    const output = {
      ok: true,
      action: 'screenshot' as const,
      message: 'Captured screenshot.',
      screenshot,
    }

    const block = ComputerUseTool.mapToolResultToToolResultBlockParam(
      output,
      'toolu_test',
    )
    expect(Array.isArray(block.content)).toBe(true)
    expect(JSON.stringify(block.content)).toContain('"type":"image"')
    expect(JSON.stringify(block.content)).not.toContain(output.screenshot.dataUrl)

    const stateBlock = ComputerUseTool.mapToolResultToToolResultBlockParam(
      {
        ok: true,
        action: 'get_window_state',
        message: 'Captured window state.',
        state: {
          screenshots: [screenshot],
          accessibility: null,
          window: {
            hwnd: '1',
            title: 'Test',
            processName: 'test',
            processId: 1,
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          },
        },
      },
      'toolu_state',
    )
    expect(Array.isArray(stateBlock.content)).toBe(true)
    expect(JSON.stringify(stateBlock.content)).toContain('"type":"image"')
    expect(JSON.stringify(stateBlock.content)).not.toContain(screenshot.dataUrl)
  })

  test('does not depend on recovered private computer-use packages', () => {
    const files = [
      source('tools/ComputerUseTool/ComputerUseTool.tsx'),
      source('tools/ComputerUseTool/windowsComputerUse.ts'),
      source('tools/ComputerUseTool/prompt.ts'),
    ].join('\n')

    expect(files).not.toContain('@ant/computer-use-mcp')
    expect(files).not.toContain('@oai/sky')
    expect(files).not.toContain('claude')
    expect(files).not.toContain('Claude')
  })

  test('exposes VSCode native actions through the gated Computer Use tool', async () => {
    const prompt = await ComputerUseTool.prompt()
    expect(prompt).toContain('get_active_window')
    expect(prompt).toContain('get_active_window_state')
    expect(prompt).toContain('vscode_open_file')
    expect(prompt).toContain('vscode_run_command')
    expect(prompt).toContain('vscode_type_text')
    expect(prompt).toContain('vscode_install_extension')
    expect(isVSCodeComputerUseAction('vscode_status')).toBe(true)
    expect(isVSCodeComputerUseAction('click')).toBe(false)
  })

  test('exposes active-window capture through the Windows backend', () => {
    const constants = source('tools/ComputerUseTool/constants.ts')
    const backend = source('tools/ComputerUseTool/windowsComputerUse.ts')

    expect(constants).toContain("'get_active_window'")
    expect(constants).toContain("'get_active_window_state'")
    expect(backend).toContain('GetForegroundWindow')
    expect(backend).toContain("'get_active_window'")
    expect(backend).toContain("'get_active_window_state'")
  })

  test('validates VSCode native action inputs before execution', async () => {
    const missingFile = await ComputerUseTool.validateInput({
      action: 'vscode_open_file',
    })
    expect(missingFile.result).toBe(false)
    expect(
      missingFile.result === false ? missingFile.message : '',
    ).toContain('file')

    const invalidUri = await ComputerUseTool.validateInput({
      action: 'vscode_open_uri',
      url: 'https://example.com',
    })
    expect(invalidUri.result).toBe(false)
    expect(
      invalidUri.result === false ? invalidUri.message : '',
    ).toContain('vscode://')

    const missingManualText = await ComputerUseTool.validateInput({
      action: 'vscode_type_text',
    })
    expect(missingManualText.result).toBe(false)
    expect(
      missingManualText.result === false ? missingManualText.message : '',
    ).toContain('text')

    const validCommand = await ComputerUseTool.validateInput({
      action: 'vscode_run_command',
      command: 'workbench.action.showCommands',
    })
    expect(validCommand.result).toBe(getPlatform() === 'windows')
  })

  test('builds deterministic VSCode CLI and URI plans', () => {
    const openPlan = buildVSCodePlan({
      action: 'vscode_open_file',
      file: 'src/main.tsx',
      line: 12,
      column: 3,
    })
    expect(openPlan.kind).toBe('cli')
    expect(openPlan.kind === 'cli' ? openPlan.args : []).toContain('--goto')
    expect(
      openPlan.kind === 'cli'
        ? openPlan.args.some(arg => arg.endsWith('src\\main.tsx:12:3') || arg.endsWith('src/main.tsx:12:3'))
        : false,
    ).toBe(true)

    const uri = buildVSCodeCommandUri('workbench.action.showCommands', [
      { query: 'format' },
    ])
    expect(uri).toContain('vscode://command/workbench.action.showCommands')
    expect(uri).toContain('%7B%22query%22%3A%22format%22%7D')

    const commandPlan = buildVSCodePlan({
      action: 'vscode_run_command',
      command: 'workbench.action.showCommands',
    })
    expect(commandPlan.kind).toBe('uri')
  })

  test('VSCode manual typing disables auto indentation while sending keys', () => {
    const sourceText = source('tools/ComputerUseTool/vscodeComputerUse.ts')

    expect(sourceText).toContain('vscode_type_text')
    expect(sourceText).toContain('editor.autoIndent')
    expect(sourceText).toContain('editor.formatOnType')
    expect(sourceText).toContain('SendKeys')
    expect(sourceText).toContain('restore_auto_indent')
  })
})
