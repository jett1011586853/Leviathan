import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../Tool.js'
import { getTools } from '../tools.js'
import { BrowserDevToolsTool } from '../tools/BrowserDevToolsTool/BrowserDevToolsTool.js'
import { BROWSER_DEVTOOLS_TOOL_NAME } from '../tools/BrowserDevToolsTool/constants.js'

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

describe('Leviathan Browser DevTools tool', () => {
  test('is registered as a built-in tool', () => {
    const tools = getTools(getEmptyToolPermissionContext())
    expect(tools.some(tool => tool.name === BROWSER_DEVTOOLS_TOOL_NAME)).toBe(
      true,
    )
  })

  test('asks for permission by default and allows full access mode', async () => {
    const input = { action: 'evaluate' as const, expression: 'document.title' }

    const defaultDecision = await BrowserDevToolsTool.checkPermissions(
      input,
      contextWithMode('default'),
    )
    expect(defaultDecision.behavior).toBe('ask')

    const bypassDecision = await BrowserDevToolsTool.checkPermissions(
      input,
      contextWithMode('bypassPermissions'),
    )
    expect(bypassDecision.behavior).toBe('allow')
  })

  test('treats passive inspection as read-only', () => {
    expect(BrowserDevToolsTool.isReadOnly({ action: 'snapshot' })).toBe(true)
    expect(BrowserDevToolsTool.isReadOnly({ action: 'screenshot' })).toBe(true)
    expect(BrowserDevToolsTool.isReadOnly({ action: 'click', selector: 'button' })).toBe(false)
  })

  test('returns screenshots as model-visible image blocks without exposing data URI text', () => {
    const output = {
      ok: true,
      action: 'screenshot' as const,
      message: 'Captured browser screenshot.',
      screenshot: {
        dataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZ3w7QAAAABJRU5ErkJggg==',
        mediaType: 'image/png' as const,
      },
    }

    const block = BrowserDevToolsTool.mapToolResultToToolResultBlockParam(
      output,
      'toolu_browser',
    )
    expect(Array.isArray(block.content)).toBe(true)
    expect(JSON.stringify(block.content)).toContain('"type":"image"')
    expect(JSON.stringify(block.content)).not.toContain(output.screenshot.dataUrl)
  })

  test('does not depend on recovered private browser automation packages', () => {
    const files = [
      source('tools/BrowserDevToolsTool/BrowserDevToolsTool.tsx'),
      source('tools/BrowserDevToolsTool/browserDevTools.ts'),
      source('tools/BrowserDevToolsTool/prompt.ts'),
    ].join('\n')

    expect(files).not.toContain('@ant/')
    expect(files).not.toContain('claude')
    expect(files).not.toContain('Claude')
  })
})
