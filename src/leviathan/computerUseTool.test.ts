import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../Tool.js'
import { getTools } from '../tools.js'
import { ComputerUseTool } from '../tools/ComputerUseTool/ComputerUseTool.js'
import { COMPUTER_USE_TOOL_NAME } from '../tools/ComputerUseTool/constants.js'
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
  test('is registered as a built-in Windows tool', () => {
    const tools = getTools(getEmptyToolPermissionContext())
    const hasComputerUse = tools.some(tool => tool.name === COMPUTER_USE_TOOL_NAME)
    expect(hasComputerUse).toBe(getPlatform() === 'windows')
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
})
