import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../Tool.js'
import { getTools } from '../tools.js'
import { BrowserDevToolsTool } from '../tools/BrowserDevToolsTool/BrowserDevToolsTool.js'
import { BROWSER_DEVTOOLS_TOOL_NAME } from '../tools/BrowserDevToolsTool/constants.js'

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
    ).toBe(
      false,
    )

    const browserUseTools = getTools(getEmptyToolPermissionContext(), {
      includeBrowserUseTools: true,
    })
    expect(
      browserUseTools.some(tool => tool.name === BROWSER_DEVTOOLS_TOOL_NAME),
    ).toBe(
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
    expect(BrowserDevToolsTool.isReadOnly({ action: 'click', selector: 'button' })).toBe(false)
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

  test('supports asking ChatGPT through Browser Use as external guidance', async () => {
    const prompt = await BrowserDevToolsTool.prompt()
    const missingQuestion = await BrowserDevToolsTool.validateInput({
      action: 'ask_chatgpt',
    })
    const validQuestion = await BrowserDevToolsTool.validateInput({
      action: 'ask_chatgpt',
      question: 'What is a likely cause of this test failure?',
    })
    const permission = await BrowserDevToolsTool.checkPermissions(
      {
        action: 'ask_chatgpt',
        question: 'Give a debugging hypothesis.',
      },
      contextWithMode('default'),
    )
    const files = [
      source('tools/BrowserDevToolsTool/constants.ts'),
      source('tools/BrowserDevToolsTool/BrowserDevToolsTool.tsx'),
      source('tools/BrowserDevToolsTool/browserDevTools.ts'),
      source('tools/BrowserDevToolsTool/prompt.ts'),
      source('tools/BrowserDevToolsTool/UI.tsx'),
    ].join('\n')

    expect(prompt).toContain('ask_chatgpt')
    expect(prompt).toContain('external guidance')
    expect(missingQuestion.result).toBe(false)
    expect(
      missingQuestion.result === false ? missingQuestion.message : '',
    ).toContain('question')
    expect(validQuestion.result).toBe(true)
    expect(permission.behavior).toBe('ask')
    expect(permission.behavior === 'ask' ? permission.message : '').toContain(
      'ChatGPT',
    )
    expect(files).toContain("'ask_chatgpt'")
    expect(files).toContain('https://chatgpt.com/')
    expect(files).toContain('CHATGPT_STATE_EXPRESSION')
    expect(files).toContain('MutationObserver')
    expect(files).toContain('syncStrategy')
    expect(files).toContain('polling-fallback')
    expect(files).toContain('pendingAnswer')
    expect(files).toContain('submittedNewQuestion: false')
    expect(files).toContain('ChatGPT is still generating')
    expect(files).toContain('ask ChatGPT')
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

  test('returns ChatGPT guidance as model-visible text', () => {
    const output = {
      ok: true,
      action: 'ask_chatgpt' as const,
      message: 'Asked ChatGPT through Browser Use and captured its response as external guidance.',
      chatgpt: {
        question: 'Why is this test failing?',
        answer: 'Check whether the new state field is initialized in every AppState constructor.',
        url: 'https://chatgpt.com/c/example',
        tabId: 'tab-1',
      },
    }

    const block = BrowserDevToolsTool.mapToolResultToToolResultBlockParam(
      output,
      'toolu_chatgpt',
    )
    expect(block.content).toContain('Why is this test failing?')
    expect(block.content).toContain('new state field')
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
