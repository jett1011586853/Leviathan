import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../Tool.js'
import { getTools } from '../tools.js'
import { BrowserDevToolsTool } from '../tools/BrowserDevToolsTool/BrowserDevToolsTool.js'
import { createStreamTypingPlan } from '../tools/BrowserDevToolsTool/browserDevTools.js'
import {
  BROWSER_DEVTOOLS_ACTIONS,
  BROWSER_DEVTOOLS_TOOL_NAME,
} from '../tools/BrowserDevToolsTool/constants.js'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function contextWithMode(
  mode: 'default' | 'bypassPermissions',
  browserUseEnabled = false,
) {
  return {
    getAppState: () => ({
      browserUseEnabled,
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
        isBypassPermissionsModeAvailable: true,
      },
    }),
  } as ToolUseContext
}

describe('Leviathan Browser DevTools tool', () => {
  test('is gated by the Browser Use feature switch', () => {
    const tools = getTools(getEmptyToolPermissionContext())
    expect(tools.some(tool => tool.name === BROWSER_DEVTOOLS_TOOL_NAME)).toBe(
      false,
    )

    const computerUseTools = getTools(getEmptyToolPermissionContext(), {
      includeComputerUseTools: true,
    })
    expect(
      computerUseTools.some(tool => tool.name === BROWSER_DEVTOOLS_TOOL_NAME),
    ).toBe(false)

    const browserUseTools = getTools(getEmptyToolPermissionContext(), {
      includeBrowserUseTools: true,
    })
    expect(
      browserUseTools.some(tool => tool.name === BROWSER_DEVTOOLS_TOOL_NAME),
    ).toBe(true)
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

  test('allows BrowserDevTools actions after Browser Use is enabled', async () => {
    const decision = await BrowserDevToolsTool.checkPermissions(
      {
        action: 'cdp_send',
        cdp_method: 'Browser.getVersion',
        cdp_target: 'browser',
      },
      contextWithMode('default', true),
    )

    expect(decision.behavior).toBe('allow')
  })

  test('treats passive inspection as read-only', () => {
    expect(BrowserDevToolsTool.isReadOnly({ action: 'snapshot' })).toBe(true)
    expect(BrowserDevToolsTool.isReadOnly({ action: 'screenshot' })).toBe(true)
    expect(
      BrowserDevToolsTool.isReadOnly({ action: 'click', selector: 'button' }),
    ).toBe(false)
    expect(
      BrowserDevToolsTool.isReadOnly({
        action: 'cdp_send',
        cdp_method: 'Browser.getVersion',
      }),
    ).toBe(false)
  })

  test('supports explicitly permissioned full CDP access', async () => {
    const prompt = await BrowserDevToolsTool.prompt()
    const validation = await BrowserDevToolsTool.validateInput({
      action: 'cdp_send',
    })
    const permission = await BrowserDevToolsTool.checkPermissions(
      {
        action: 'cdp_send',
        cdp_method: 'Browser.getVersion',
        cdp_target: 'browser',
      },
      contextWithMode('default'),
    )
    const files = [
      source('tools/BrowserDevToolsTool/constants.ts'),
      source('tools/BrowserDevToolsTool/BrowserDevToolsTool.tsx'),
      source('tools/BrowserDevToolsTool/browserDevTools.ts'),
      source('tools/BrowserDevToolsTool/prompt.ts'),
    ].join('\n')

    expect(prompt).toContain('cdp_send')
    expect(prompt).toContain('full CDP access')
    expect(validation.result).toBe(false)
    expect(validation.result === false ? validation.message : '').toContain(
      'cdp_method',
    )
    expect(permission.behavior).toBe('ask')
    expect(permission.behavior === 'ask' ? permission.message : '').toContain(
      'full Chrome DevTools Protocol',
    )
    expect(files).toContain("'cdp_send'")
    expect(files).toContain('cdp_method')
    expect(files).toContain('cdp_target')
    expect(files).toContain('webSocketDebuggerUrl')
    expect(files).toContain('sessionId')
  })

  test('does not expose the removed external consultation action', async () => {
    const prompt = await BrowserDevToolsTool.prompt()
    const files = [
      source('tools/BrowserDevToolsTool/constants.ts'),
      source('tools/BrowserDevToolsTool/BrowserDevToolsTool.tsx'),
      source('tools/BrowserDevToolsTool/browserDevTools.ts'),
      source('tools/BrowserDevToolsTool/prompt.ts'),
      source('tools/BrowserDevToolsTool/UI.tsx'),
    ].join('\n')

    expect(BROWSER_DEVTOOLS_ACTIONS).toEqual([
      'launch_browser',
      'connect',
      'list_tabs',
      'new_tab',
      'navigate',
      'evaluate',
      'snapshot',
      'click',
      'type_text',
      'stream_type_text',
      'press_key',
      'screenshot',
      'cdp_send',
      'close_tab',
    ])
    expect(prompt).not.toContain('outside second opinion')
    expect(files).not.toContain('external guidance')
  })

  test('supports streaming code into browser editors', async () => {
    const prompt = await BrowserDevToolsTool.prompt()
    const missingText = await BrowserDevToolsTool.validateInput({
      action: 'stream_type_text',
    })
    const validAutoTarget = await BrowserDevToolsTool.validateInput({
      action: 'stream_type_text',
      text: '#include <bits/stdc++.h>\nint main(){return 0;}',
      typing_delay_ms: 1,
      clear: true,
    })
    const files = [
      source('tools/BrowserDevToolsTool/constants.ts'),
      source('tools/BrowserDevToolsTool/BrowserDevToolsTool.tsx'),
      source('tools/BrowserDevToolsTool/browserDevTools.ts'),
      source('tools/BrowserDevToolsTool/prompt.ts'),
      source('tools/BrowserDevToolsTool/UI.tsx'),
    ].join('\n')

    expect(prompt).toContain('stream_type_text')
    expect(prompt).toContain('character-by-character')
    expect(prompt).toContain('defaults to 200')
    expect(prompt).toContain('with or without automatic indentation')
    expect(missingText.result).toBe(false)
    expect(missingText.result === false ? missingText.message : '').toContain(
      'text',
    )
    expect(validAutoTarget.result).toBe(true)
    expect(files).toContain("'stream_type_text'")
    expect(files).toContain('buildFocusStreamTargetExpression')
    expect(files).toContain('streamInsertText')
    expect(files).toContain('Input.insertText')
    expect(files).toContain('typing_delay_ms')
    expect(files).toContain('input.typing_delay_ms ?? 200')
    expect(files).toContain('clearFocusedEditor')
    expect(files).toContain('buildReadStreamEditorExpression')
    expect(files).toContain('buildReplaceStreamEditorExpression')
    expect(files).toContain('indentationCorrections')
    expect(files).toContain('verifiedExact')
  })

  test('keeps streamed source exact with and without editor auto-indent', () => {
    const sourceText = [
      'class Solution:',
      '    def twoSum(self):',
      '        if True:',
      '            return []',
    ].join('\n')
    const plan = createStreamTypingPlan(sourceText)

    const simulateEditor = (automaticIndent: string) => {
      let editorText = ''
      for (const step of plan) {
        if (step.mode === 'reconcile') {
          editorText = step.expectedText
        } else {
          editorText += step.character
          if (step.character === '\n') editorText += automaticIndent
        }
        if (step.reconcileAfterInsert) editorText = step.expectedText
      }
      return editorText
    }

    expect(simulateEditor('')).toBe(sourceText)
    expect(simulateEditor('    ')).toBe(sourceText)
    expect(
      plan.filter(step => step.mode === 'reconcile').length,
    ).toBeGreaterThan(0)
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
    expect(JSON.stringify(block.content)).not.toContain(
      output.screenshot.dataUrl,
    )
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
