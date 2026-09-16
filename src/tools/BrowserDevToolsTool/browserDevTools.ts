import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { getLeviathanConfigHomeDir } from '../../utils/envUtils.js'
import type { BrowserDevToolsAction } from './constants.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9222
const DEFAULT_TIMEOUT_MS = 10_000

export type BrowserDevToolsInput = {
  action: BrowserDevToolsAction
  host?: string
  port?: number
  browser?: 'auto' | 'edge' | 'chrome' | 'brave'
  url?: string
  tab_id?: string
  expression?: string
  scope?: 'main' | 'all_frames'
  selector?: string
  text?: string
  typing_delay_ms?: number
  clear?: boolean
  key?: string
  cdp_method?: string
  cdp_params?: Record<string, unknown>
  cdp_target?: 'tab' | 'browser'
  cdp_session_id?: string
  timeout_ms?: number
  user_data_dir?: string
  annotate?: boolean
  include_screenshot?: boolean
  include_frames?: boolean
  node_index?: number
  x?: number
  y?: number
}

export type BrowserDevToolsTab = {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl?: string
}

export type BrowserDevToolsScreenshot = {
  dataUrl: string
  mediaType: 'image/png'
}

export type BrowserDevToolsOutput = {
  ok: boolean
  action: BrowserDevToolsAction
  message: string
  endpoint?: string
  browser?: string
  tab?: BrowserDevToolsTab
  tabs?: BrowserDevToolsTab[]
  result?: unknown
  frames?: BrowserDevToolsFrame[]
  elements?: BrowserDevToolsAnnotation[]
  snapshot?: {
    title: string
    url: string
    readyState: string
    text: string
    elements: Array<{
      selector: string
      tag: string
      text: string
      ariaLabel: string
      placeholder: string
      role: string
      href: string
      visible: boolean
      frame?: string
    }>
  }
  screenshot?: BrowserDevToolsScreenshot
}

/** A cross-origin (out-of-process) frame reachable through a CDP session. */
export type BrowserDevToolsFrame = {
  sessionId: string
  targetId: string
  url: string
  type: string
}

/** Interactive element exposed by an annotated screenshot. */
export type BrowserDevToolsAnnotation = {
  index: number
  selector: string
  tag: string
  text: string
  frame?: string
  /** Viewport rect in CSS pixels, used for coordinate clicks. */
  rect: { x: number; y: number; width: number; height: number }
}

type CdpResponse = {
  id?: number
  result?: unknown
  error?: { message?: string; data?: string }
  method?: string
  params?: unknown
  sessionId?: string
}

type CdpEvalResult = {
  result?: {
    type?: string
    value?: unknown
    description?: string
  }
  exceptionDetails?: {
    text?: string
    exception?: { description?: string }
  }
}

type AnnotationSnapshot = {
  at: number
  elements: BrowserDevToolsAnnotation[]
  frames: BrowserDevToolsFrame[]
}

/**
 * Last annotated screenshot per tab. The model sees numbered boxes in the
 * image and clicks them by index; the coordinates behind those indices have to
 * survive between calls, so they are cached here rather than re-derived from
 * the DOM (the element may be inside a cross-origin frame or shadow root, where
 * a selector cannot reach it but a coordinate click still works).
 */
const annotationCache = new Map<string, AnnotationSnapshot>()
const ANNOTATION_TTL_MS = 10 * 60 * 1000

function storeAnnotations(
  tabId: string,
  elements: BrowserDevToolsAnnotation[],
  frames: BrowserDevToolsFrame[],
): void {
  const now = Date.now()
  for (const [key, value] of annotationCache) {
    if (now - value.at > ANNOTATION_TTL_MS) annotationCache.delete(key)
  }
  annotationCache.set(tabId, { at: now, elements, frames })
}

function getAnnotations(tabId: string): AnnotationSnapshot | null {
  const snapshot = annotationCache.get(tabId)
  if (!snapshot) return null
  if (Date.now() - snapshot.at > ANNOTATION_TTL_MS) {
    annotationCache.delete(tabId)
    return null
  }
  return snapshot
}

export async function runBrowserDevTools(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsOutput> {
  switch (input.action) {
    case 'launch_browser':
      return launchBrowser(input, signal)
    case 'connect':
      return connect(input, signal)
    case 'list_tabs':
      return listTabsOutput(input, signal)
    case 'new_tab':
      return newTab(input, signal)
    case 'navigate':
      return withTab(input, signal, async (client, tab) => {
        await client.send('Page.enable')
        await client.send('Page.navigate', { url: required(input.url, 'url') })
        await waitForReadyState(client, input.timeout_ms)
        return {
          ok: true,
          action: input.action,
          message: `Navigated tab to ${input.url}.`,
          tab,
        }
      })
    case 'evaluate':
      return withTab(input, signal, async (client, tab) => {
        const expression = required(input.expression, 'expression')
        const frames = await attachFrameSessions(client, input.timeout_ms)
        const wantAllFrames = input.scope === 'all_frames'

        if (!wantAllFrames) {
          try {
            const result = await evaluate(client, expression, input.timeout_ms)
            return {
              ok: true,
              action: input.action,
              message: 'Evaluated JavaScript in the page.',
              tab,
              result,
              frames,
            }
          } catch (error) {
            // The snippet failed in the main frame. On site-isolated pages the
            // data usually lives in a cross-origin frame, where the main frame
            // reports either "not defined" or a null dereference on the missing
            // element. Try the frames before giving up; the original error is
            // rethrown unless a frame actually produced a value.
            if (frames.length > 0) {
              const frameResults = await evaluateAcrossFrames(
                client,
                expression,
                input.timeout_ms,
                frames,
              )
              const succeeded = frameResults.filter(
                entry => entry.error === undefined && entry.value !== undefined,
              )
              if (succeeded.length > 0) {
                return {
                  ok: true,
                  action: input.action,
                  message: `Evaluated JavaScript in ${succeeded.length} cross-origin frame${succeeded.length === 1 ? '' : 's'} after the main frame failed: ${errorMessage(error)}`,
                  tab,
                  result: frameResults,
                  frames,
                }
              }
            }
            throw error
          }
        }

        const frameResults = await evaluateAcrossFrames(
          client,
          expression,
          input.timeout_ms,
          frames,
        )
        return {
          ok: true,
          action: input.action,
          message: `Evaluated JavaScript across ${frameResults.length} frame${frameResults.length === 1 ? '' : 's'}.`,
          tab,
          result: frameResults,
          frames,
        }
      })
    case 'snapshot':
      return withTab(input, signal, async (client, tab) => {
        const frames = await attachFrameSessions(client, input.timeout_ms)
        const snapshot = (await evaluate(
          client,
          SNAPSHOT_EXPRESSION,
          input.timeout_ms,
        )) as BrowserDevToolsOutput['snapshot']

        // Merge cross-origin frame content into the same snapshot so pages
        // built from OOPIFs (payment, auth, embedded editors) are inspectable.
        if (snapshot && frames.length > 0) {
          const frameSnapshots: Array<{
            url: string
            value: Partial<NonNullable<BrowserDevToolsOutput['snapshot']>>
          }> = []
          for (const frame of frames) {
            try {
              const value = (await evaluate(
                client,
                SNAPSHOT_EXPRESSION,
                input.timeout_ms,
                frame.sessionId,
              )) as Partial<NonNullable<BrowserDevToolsOutput['snapshot']>>
              if (value) frameSnapshots.push({ url: frame.url, value })
            } catch {
              // Frame may have navigated away or be sandboxed without JS.
            }
          }
          for (const { url, value } of frameSnapshots) {
            const label = url || 'cross-origin frame'
            for (const element of value.elements ?? []) {
              snapshot.elements.push({ ...element, frame: label, selector: element.selector })
            }
            const text = (value.text ?? '').trim()
            if (text) {
              snapshot.text = `${snapshot.text}\n\n--- frame: ${label} ---\n${text}`.slice(0, 40_000)
            }
          }
        }

        const output: BrowserDevToolsOutput = {
          ok: true,
          action: input.action,
          message:
            frames.length > 0
              ? `Captured page snapshot plus ${frames.length} cross-origin frame${frames.length === 1 ? '' : 's'}.`
              : 'Captured page snapshot from DevTools.',
          tab,
          snapshot,
          frames,
        }
        if (input.include_screenshot) {
          output.screenshot = await captureScreenshot(client, input)
        }
        return output
      })
    case 'click':
      return withTab(input, signal, async (client, tab) => {
        // Coordinate click: either explicit x/y or a numbered box from the last
        // annotated screenshot. Works for shadow DOM, canvas and OOPIF content
        // where selector-based clicking cannot reach the element.
        if (input.node_index !== undefined) {
          const annotations = getAnnotations(tab.id)
          const match = annotations?.elements.find(
            element => element.index === input.node_index,
          )
          if (!match) {
            throw new Error(
              `No element number ${input.node_index} from the last annotated screenshot. Run action="screenshot" with annotate=true first.`,
            )
          }
          // The page may have scrolled since the screenshot, so prefer a fresh
          // measurement over the captured rect.
          let rect = match.rect
          try {
            const fresh = (await evaluate(
              client,
              buildRectExpression(match.selector),
              input.timeout_ms,
            )) as { x: number; y: number; width: number; height: number } | null
            if (fresh && typeof fresh.x === 'number' && fresh.width > 0) {
              rect = fresh
            }
          } catch {
            // Element is only reachable by coordinates; keep the captured rect.
          }
          const x = Math.round(rect.x + rect.width / 2)
          const y = Math.round(rect.y + rect.height / 2)
          await clickAtCoordinates(client, x, y, input.timeout_ms)
          return {
            ok: true,
            action: input.action,
            message: `Clicked element #${input.node_index} (${match.selector}) at ${x},${y}.`,
            tab,
            result: { ...match, rect, clickedAt: { x, y } },
          }
        }

        if (input.x !== undefined && input.y !== undefined) {
          await clickAtCoordinates(client, input.x, input.y, input.timeout_ms)
          return {
            ok: true,
            action: input.action,
            message: `Clicked at ${input.x},${input.y}.`,
            tab,
            result: { clickedAt: { x: input.x, y: input.y } },
          }
        }

        const selector = required(input.selector, 'selector')
        const frames = await attachFrameSessions(client, input.timeout_ms)
        try {
          const result = await evaluate(
            client,
            buildClickExpression(selector),
            input.timeout_ms,
          )
          return {
            ok: true,
            action: input.action,
            message: `Clicked ${selector}.`,
            tab,
            result,
          }
        } catch (error) {
          if (!isExecutionContextError(error) || frames.length === 0) throw error
          for (const frame of frames) {
            try {
              const result = await evaluate(
                client,
                buildClickExpression(selector),
                input.timeout_ms,
                frame.sessionId,
              )
              return {
                ok: true,
                action: input.action,
                message: `Clicked ${selector} inside frame ${frame.url}.`,
                tab,
                result,
                frames,
              }
            } catch {
              // Keep looking in the other frames.
            }
          }
          throw error
        }
      })
    case 'type_text':
      return withTab(input, signal, async (client, tab) => {
        const selector = required(input.selector, 'selector')
        const frames = await attachFrameSessions(client, input.timeout_ms)
        try {
          const result = await evaluate(
            client,
            buildTypeTextExpression(selector, input.text ?? ''),
            input.timeout_ms,
          )
          return {
            ok: true,
            action: input.action,
            message: `Typed text into ${selector}.`,
            tab,
            result,
          }
        } catch (error) {
          if (!isExecutionContextError(error) || frames.length === 0) throw error
          for (const frame of frames) {
            try {
              const result = await evaluate(
                client,
                buildTypeTextExpression(selector, input.text ?? ''),
                input.timeout_ms,
                frame.sessionId,
              )
              return {
                ok: true,
                action: input.action,
                message: `Typed text into ${selector} inside frame ${frame.url}.`,
                tab,
                result,
                frames,
              }
            } catch {
              // Keep looking in the other frames.
            }
          }
          throw error
        }
      })
    case 'stream_type_text':
      return withTab(input, signal, async (client, tab) => {
        const text = input.text ?? ''
        const typingDelayMs = input.typing_delay_ms ?? 200
        const clearBeforeTyping = input.clear !== false
        const focusResult = (await evaluate(
          client,
          buildFocusStreamTargetExpression(input.selector),
          input.timeout_ms,
        )) as Record<string, unknown>
        const initialEditorState = clearBeforeTyping
          ? null
          : await readFocusedStreamEditor(
              client,
              input.selector,
              input.timeout_ms,
            )
        if (clearBeforeTyping) {
          await clearFocusedEditor(client)
        }
        const streamResult = await streamInsertText(
          client,
          text,
          typingDelayMs,
          signal,
          {
            selector: input.selector,
            timeoutMs: input.timeout_ms,
            baseText: initialEditorState?.readable
              ? initialEditorState.text
              : '',
            exactCorrectionEnabled:
              clearBeforeTyping || initialEditorState?.readable === true,
          },
        )
        return {
          ok: true,
          action: input.action,
          message: `Streamed ${streamResult.streamedCharacters} characters into the browser editor.`,
          tab,
          result: {
            ...focusResult,
            ...streamResult,
            textLength: text.length,
            typingDelayMs,
            clearedBeforeTyping: clearBeforeTyping,
          },
        }
      })
    case 'press_key':
      return withTab(input, signal, async (client, tab) => {
        await pressKey(client, required(input.key, 'key'))
        return {
          ok: true,
          action: input.action,
          message: `Pressed ${input.key}.`,
          tab,
        }
      })
    case 'screenshot':
      return withTab(input, signal, async (client, tab) => {
        const annotate = input.annotate === true
        if (!annotate) {
          return {
            ok: true,
            action: input.action,
            message: 'Captured browser screenshot.',
            tab,
            screenshot: await captureScreenshot(client, input),
          }
        }

        // Annotated mode: label every visible control, keep the boxes for the
        // capture, then remove them so the page is left untouched.
        const annotations = await collectAnnotations(client, input.timeout_ms)
        storeAnnotations(tab.id, annotations, [])
        try {
          const screenshot = await captureScreenshot(client, input)
          return {
            ok: true,
            action: input.action,
            message: `Captured annotated screenshot with ${annotations.length} labelled control${annotations.length === 1 ? '' : 's'}. Click one with node_index.`,
            tab,
            screenshot,
            elements: annotations,
          }
        } finally {
          await evaluate(client, CLEAR_ANNOTATION_EXPRESSION, input.timeout_ms).catch(
            () => undefined,
          )
        }
      })
    case 'cdp_send':
      return sendRawCdp(input, signal)
    case 'close_tab':
      return closeTab(input, signal)
    default:
      throw new Error(`Unsupported BrowserDevTools action: ${input.action}`)
  }
}

async function launchBrowser(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsOutput> {
  const endpoint = getEndpoint(input)
  if (await canConnect(input, signal)) {
    const tabs = await listTabs(input, signal).catch(() => [])
    return {
      ok: true,
      action: input.action,
      message: `Browser DevTools is already available at ${endpoint}.`,
      endpoint,
      tab: tabs.find(tab => tab.type === 'page') ?? tabs[0],
      tabs,
    }
  }

  const browser = input.browser ?? 'auto'
  const exe = findBrowserExecutable(browser)
  const userDataDir = resolve(
    input.user_data_dir ??
      join(getLeviathanConfigHomeDir(), 'browser-devtools-profile'),
  )
  await mkdir(userDataDir, { recursive: true })

  const args = [
    `--remote-debugging-port=${input.port ?? DEFAULT_PORT}`,
    `--remote-debugging-address=${input.host ?? DEFAULT_HOST}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    input.url ?? 'about:blank',
  ]
  const child = spawn(exe.path, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()

  const deadline = Date.now() + (input.timeout_ms ?? DEFAULT_TIMEOUT_MS)
  while (Date.now() < deadline) {
    if (await canConnect(input, signal)) {
      const tabs = await listTabs(input, signal).catch(() => [])
      return {
        ok: true,
        action: input.action,
        message: `Launched ${exe.name} with DevTools at ${endpoint}.`,
        endpoint,
        browser: exe.name,
        tab: tabs.find(tab => tab.type === 'page') ?? tabs[0],
        tabs,
      }
    }
    await delay(250, signal)
  }

  throw new Error(
    `Launched ${exe.name}, but DevTools did not become ready at ${endpoint}.`,
  )
}

async function connect(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsOutput> {
  const version = await getJson<Record<string, unknown>>(
    `${getEndpoint(input)}/json/version`,
    signal,
  )
  return {
    ok: true,
    action: input.action,
    message: 'Connected to Browser DevTools.',
    endpoint: getEndpoint(input),
    result: version,
  }
}

async function listTabsOutput(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsOutput> {
  const tabs = await listTabs(input, signal)
  if (input.include_frames) {
    const tab = await getTargetTab(input, signal)
    if (tab.webSocketDebuggerUrl) {
      const client = await CdpClient.connect(tab.webSocketDebuggerUrl, signal)
      try {
        const frames = await attachFrameSessions(client, input.timeout_ms)
        return {
          ok: true,
          action: input.action,
          message: `Listed ${tabs.length} browser tab${tabs.length === 1 ? '' : 's'} and ${frames.length} cross-origin frame${frames.length === 1 ? '' : 's'} in the target tab.`,
          endpoint: getEndpoint(input),
          tabs,
          tab,
          frames,
        }
      } finally {
        client.close()
      }
    }
  }
  return {
    ok: true,
    action: input.action,
    message: `Listed ${tabs.length} browser tab${tabs.length === 1 ? '' : 's'}.`,
    endpoint: getEndpoint(input),
    tabs,
  }
}

async function newTab(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsOutput> {
  const url = input.url ?? 'about:blank'
  const tab = await getJson<BrowserDevToolsTab>(
    `${getEndpoint(input)}/json/new?${encodeURIComponent(url)}`,
    signal,
    { method: 'PUT' },
  )
  return {
    ok: true,
    action: input.action,
    message: `Opened new tab: ${url}.`,
    endpoint: getEndpoint(input),
    tab,
  }
}

async function closeTab(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsOutput> {
  const tab = await getTargetTab(input, signal)
  const text = await getText(
    `${getEndpoint(input)}/json/close/${tab.id}`,
    signal,
  )
  return {
    ok: true,
    action: input.action,
    message: text || `Closed tab ${tab.id}.`,
    endpoint: getEndpoint(input),
    tab,
  }
}

async function sendRawCdp(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsOutput> {
  const method = required(input.cdp_method, 'cdp_method')
  const params = input.cdp_params ?? {}
  const target = input.cdp_target ?? 'tab'

  if (target === 'browser') {
    const webSocketDebuggerUrl = await getBrowserWebSocketDebuggerUrl(
      input,
      signal,
    )
    const client = await CdpClient.connect(webSocketDebuggerUrl, signal)
    try {
      const result = await client.send(
        method,
        params,
        input.timeout_ms,
        input.cdp_session_id,
      )
      return {
        ok: true,
        action: input.action,
        message: `Sent browser-level CDP command ${method}.`,
        endpoint: getEndpoint(input),
        result,
      }
    } finally {
      client.close()
    }
  }

  return withTab(input, signal, async (client, tab) => {
    const result = await client.send(
      method,
      params,
      input.timeout_ms,
      input.cdp_session_id,
    )
    return {
      ok: true,
      action: input.action,
      message: `Sent tab-level CDP command ${method}.`,
      tab,
      result,
    }
  })
}

/**
 * Actions that can be replayed safely after a dropped websocket. Mirrors the
 * read-only classification used for permissions; mutating actions must never
 * be retried, or a retry could double-submit a form or duplicate typed text.
 */
const RETRYABLE_AFTER_DISCONNECT = new Set<BrowserDevToolsAction>([
  'connect',
  'list_tabs',
  'snapshot',
  'screenshot',
])

function isDisconnectError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return (
    message.includes('websocket closed') ||
    message.includes('websocket is closed') ||
    message.includes('websocket rejected') ||
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('broken pipe')
  )
}

async function withTab(
  input: BrowserDevToolsInput,
  signal: AbortSignal | undefined,
  fn: (
    client: CdpClient,
    tab: BrowserDevToolsTab,
  ) => Promise<BrowserDevToolsOutput>,
): Promise<BrowserDevToolsOutput> {
  const tab = await getTargetTab(input, signal)
  if (!tab.webSocketDebuggerUrl) {
    throw new Error(`Tab ${tab.id} does not expose a DevTools websocket URL.`)
  }

  const run = async (target: BrowserDevToolsTab) => {
    const client = await CdpClient.connect(target.webSocketDebuggerUrl!, signal)
    try {
      return await fn(client, target)
    } finally {
      client.close()
    }
  }

  try {
    const output = await run(tab)
    return { ...output, endpoint: getEndpoint(input) }
  } catch (error) {
    // A renderer restart or a tab that navigated out from under us closes the
    // socket mid-action. Read-only actions are safe to replay against a freshly
    // resolved target; anything that mutates the page is never retried here.
    if (
      !RETRYABLE_AFTER_DISCONNECT.has(input.action) ||
      !isDisconnectError(error)
    ) {
      throw error
    }
    const refreshed = await getTargetTab(input, signal).catch(() => tab)
    const output = await run(refreshed)
    return { ...output, endpoint: getEndpoint(input) }
  }
}

async function getTargetTab(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsTab> {
  const tabs = await listTabs(input, signal)
  const pages = tabs.filter(tab => tab.type === 'page')
  const tab = input.tab_id
    ? tabs.find(candidate => candidate.id === input.tab_id)
    : (pages[0] ?? tabs[0])
  if (!tab) {
    throw new Error('No Browser DevTools tabs are available.')
  }
  return tab
}

async function listTabs(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsTab[]> {
  return getJson<BrowserDevToolsTab[]>(
    `${getEndpoint(input)}/json/list`,
    signal,
  )
}

async function getBrowserWebSocketDebuggerUrl(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<string> {
  const version = await getJson<Record<string, unknown>>(
    `${getEndpoint(input)}/json/version`,
    signal,
  )
  const websocketUrl = version.webSocketDebuggerUrl
  if (typeof websocketUrl !== 'string' || !websocketUrl) {
    throw new Error(
      'Browser DevTools endpoint did not expose browser-level webSocketDebuggerUrl.',
    )
  }
  return websocketUrl
}

async function evaluate(
  client: CdpClient,
  expression: string,
  timeoutMs?: number,
  sessionId?: string,
): Promise<unknown> {
  try {
    return await evaluateRaw(client, expression, timeoutMs, sessionId)
  } catch (error) {
    if (!isSyntaxError(error)) throw error
    // The snippet declared something that already exists in the page's global
    // scope, or is a statement body. Retry inside a fresh async scope.
    for (const candidate of buildScopedEvaluateCandidates(expression)) {
      try {
        return await evaluateRaw(client, candidate, timeoutMs, sessionId)
      } catch (retryError) {
        if (!isSyntaxError(retryError)) throw retryError
      }
    }
    throw error
  }
}

async function evaluateRaw(
  client: CdpClient,
  expression: string,
  timeoutMs?: number,
  sessionId?: string,
): Promise<unknown> {
  const output = (await client.send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
    timeoutMs,
    sessionId,
  )) as CdpEvalResult

  if (output.exceptionDetails) {
    throw new Error(
      output.exceptionDetails.exception?.description ??
        output.exceptionDetails.text ??
        'JavaScript evaluation failed.',
    )
  }

  return output.result && 'value' in output.result
    ? output.result.value
    : output.result?.description
}

async function waitForReadyState(
  client: CdpClient,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await evaluate(client, 'document.readyState', 1_000)
    if (state === 'interactive' || state === 'complete') return
    await delay(150)
  }
}

async function pressKey(client: CdpClient, key: string): Promise<void> {
  const normalized = normalizeKey(key)
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    ...normalized,
  })
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...normalized,
  })
}

async function pressEditorEnter(client: CdpClient): Promise<void> {
  const enter = normalizeKey('Enter')
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    ...enter,
    text: '\r',
    unmodifiedText: '\r',
  })
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...enter,
  })
}

/**
 * Delete the characters immediately before the caret. Used to strip the
 * indentation an editor inserted automatically after a newline. Bounded so a
 * mis-measured editor cannot eat the document.
 */
async function deleteCharactersBeforeCaret(
  client: CdpClient,
  count: number,
  typingDelayMs = 0,
  signal?: AbortSignal,
): Promise<void> {
  const bounded = Math.max(0, Math.min(Math.round(count), 64))
  for (let index = 0; index < bounded; index += 1) {
    if (signal?.aborted) return
    await pressKey(client, 'Backspace')
    if (typingDelayMs > 0) {
      await delay(Math.min(typingDelayMs, 40), signal)
    }
  }
}

function normalizeKey(key: string): {
  key: string
  code: string
  windowsVirtualKeyCode: number
  nativeVirtualKeyCode: number
} {
  const lower = key.trim().toLowerCase()
  const named: Record<
    string,
    { key: string; code: string; codePoint: number }
  > = {
    enter: { key: 'Enter', code: 'Enter', codePoint: 13 },
    return: { key: 'Enter', code: 'Enter', codePoint: 13 },
    tab: { key: 'Tab', code: 'Tab', codePoint: 9 },
    escape: { key: 'Escape', code: 'Escape', codePoint: 27 },
    esc: { key: 'Escape', code: 'Escape', codePoint: 27 },
    backspace: { key: 'Backspace', code: 'Backspace', codePoint: 8 },
    delete: { key: 'Delete', code: 'Delete', codePoint: 46 },
    home: { key: 'Home', code: 'Home', codePoint: 36 },
    arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', codePoint: 37 },
    left: { key: 'ArrowLeft', code: 'ArrowLeft', codePoint: 37 },
    arrowright: { key: 'ArrowRight', code: 'ArrowRight', codePoint: 39 },
    right: { key: 'ArrowRight', code: 'ArrowRight', codePoint: 39 },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp', codePoint: 38 },
    up: { key: 'ArrowUp', code: 'ArrowUp', codePoint: 38 },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown', codePoint: 40 },
    down: { key: 'ArrowDown', code: 'ArrowDown', codePoint: 40 },
  }
  const mapped = named[lower]
  if (mapped) {
    return {
      key: mapped.key,
      code: mapped.code,
      windowsVirtualKeyCode: mapped.codePoint,
      nativeVirtualKeyCode: mapped.codePoint,
    }
  }
  if (key.length === 1) {
    const codePoint = key.toUpperCase().charCodeAt(0)
    return {
      key,
      code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: codePoint,
      nativeVirtualKeyCode: codePoint,
    }
  }
  throw new Error(`Unsupported key for BrowserDevTools press_key: ${key}`)
}

class CdpClient {
  private nextID = 1
  private closed = false
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  /** Event subscribers, keyed by CDP event name (e.g. Target.attachedToTarget). */
  private listeners = new Map<
    string,
    Set<(params: unknown, sessionId?: string) => void>
  >()

  private constructor(private readonly socket: WebSocket) {}

  static async connect(url: string, signal?: AbortSignal): Promise<CdpClient> {
    if (signal?.aborted) throw new Error('Browser DevTools connection aborted.')
    const socket = new WebSocket(url)
    const client = new CdpClient(socket)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error('Timed out connecting to Browser DevTools websocket.'),
          ),
        DEFAULT_TIMEOUT_MS,
      )
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timeout)
          reject(new Error('Failed to connect to Browser DevTools websocket.'))
        },
        { once: true },
      )
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout)
          socket.close()
          reject(new Error('Browser DevTools connection aborted.'))
        },
        { once: true },
      )
    })
    socket.addEventListener('message', event => {
      client.handleMessage(String(event.data))
    })
    socket.addEventListener('close', () => {
      client.closed = true
      for (const [id, pending] of client.pending) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('Browser DevTools websocket closed.'))
        client.pending.delete(id)
      }
    })
    return client
  }

  /**
   * Subscribe to a CDP event. Returns an unsubscribe function.
   *
   * Events were previously dropped entirely (handleMessage returned early for
   * anything without an id), which made frame-level work impossible: attaching
   * to cross-origin frames is event-driven (Target.attachedToTarget).
   */
  on(
    method: string,
    listener: (params: unknown, sessionId?: string) => void,
  ): () => void {
    const existing = this.listeners.get(method)
    if (existing) {
      existing.add(listener)
    } else {
      this.listeners.set(method, new Set([listener]))
    }
    return () => {
      this.listeners.get(method)?.delete(listener)
    }
  }

  isClosed(): boolean {
    return this.closed
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    sessionId?: string,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new Error(
          `Browser DevTools websocket is closed; cannot send ${method}.`,
        ),
      )
    }
    const id = this.nextID++
    const payload = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    })
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(buildCdpTimeoutMessage(method, timeoutMs)))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      try {
        this.socket.send(payload)
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timeout)
        reject(
          new Error(
            `Browser DevTools websocket rejected ${method}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      }
    })
  }

  close(): void {
    this.socket.close()
  }

  private handleMessage(message: string): void {
    let parsed: CdpResponse
    try {
      parsed = JSON.parse(message) as CdpResponse
    } catch {
      return
    }
    if (!parsed.id && parsed.method) {
      const listeners = this.listeners.get(parsed.method)
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(parsed.params, parsed.sessionId)
          } catch {
            // Subscriber errors must not break the protocol loop.
          }
        }
      }
      return
    }
    if (!parsed.id) return
    const pending = this.pending.get(parsed.id)
    if (!pending) return
    this.pending.delete(parsed.id)
    clearTimeout(pending.timeout)
    if (parsed.error) {
      pending.reject(
        new Error(
          [parsed.error.message, parsed.error.data].filter(Boolean).join('\n'),
        ),
      )
      return
    }
    pending.resolve(parsed.result)
  }
}

/** Cap on how many cross-origin frames a single call walks. */
const MAX_FRAME_SESSIONS = 8

/**
 * Timeouts are the most common BrowserDevTools failure in practice, and the
 * bare "command timed out" text gives the model nothing to act on.
 */
function buildCdpTimeoutMessage(method: string, timeoutMs: number): string {
  const hint =
    method === 'Runtime.evaluate'
      ? ' The expression never settled: avoid awaiting promises that may never resolve or long polling loops, and prefer returning data that is already available.'
      : method.startsWith('Page.')
        ? ' The page did not acknowledge the command: it may still be loading or the tab may be closing. Wait briefly and retry.'
        : ''
  return `Browser DevTools command timed out after ${timeoutMs}ms: ${method}.${hint}`
}

/** A SyntaxError from Runtime.evaluate, i.e. the snippet itself did not parse. */
function isSyntaxError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('SyntaxError') ||
    message.includes('has already been declared') ||
    message.includes('Unexpected token') ||
    message.includes('Unexpected end of input') ||
    message.includes('Invalid or unexpected token') ||
    message.includes('Illegal return statement')
  )
}

/**
 * Runtime.evaluate runs snippets in the page's global scope, so a second call
 * that declares `const rows = ...` again throws "Identifier 'rows' has already
 * been declared" - a failure the model cannot fix by rewording the snippet.
 * Wrapping in an async IIFE gives every call a fresh scope. Two shapes are
 * offered because the snippet may be an expression (`document.title`) or a
 * statement body (`const x = 1; return x`).
 */
function buildScopedEvaluateCandidates(expression: string): string[] {
  return [
    `(async () => {\n  return (\n${expression}\n  );\n})()`,
    `(async () => {\n${expression}\n})()`,
  ]
}

/** A detached/absent execution context, as opposed to a page-level error. */
function isExecutionContextError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase()
  return (
    message.includes('cannot find context') ||
    message.includes('execution context') ||
    message.includes('cannot find default execution context') ||
    message.includes('detached') ||
    message.includes('is not defined') ||
    message.includes('no element matched selector')
  )
}

/**
 * Attach to cross-origin (out-of-process) frames.
 *
 * With strict site isolation, iframes live in their own targets that the page
 * websocket cannot reach: Runtime.evaluate on the main target sees only the
 * main frame, and querySelector on the page document cannot see into them.
 * Target.setAutoAttach with flatten:true routes those frames over the same
 * socket, each addressed by its own sessionId.
 */
async function attachFrameSessions(
  client: CdpClient,
  timeoutMs?: number,
): Promise<BrowserDevToolsFrame[]> {
  const frames = new Map<string, BrowserDevToolsFrame>()
  const unsubscribe = client.on('Target.attachedToTarget', params => {
    const payload = params as {
      sessionId?: string
      targetInfo?: { targetId?: string; url?: string; type?: string }
    }
    const sessionId = payload.sessionId
    const info = payload.targetInfo
    if (!sessionId || !info) return
    const type = info.type ?? 'iframe'
    if (type !== 'iframe' && type !== 'page' && type !== 'webview') return
    frames.set(sessionId, {
      sessionId,
      targetId: info.targetId ?? '',
      url: info.url ?? '',
      type,
    })
  })

  try {
    await client.send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      timeoutMs,
    )
    // attachedToTarget events for frames that already exist arrive async.
    await delay(200)
  } catch {
    // Older builds may reject flatten/auto-attach; page-level control still works.
  } finally {
    unsubscribe()
  }

  return [...frames.values()].slice(0, MAX_FRAME_SESSIONS)
}

type FrameEvaluation = {
  frame: string
  sessionId?: string
  value?: unknown
  error?: string
}

/**
 * Evaluate in the main frame plus every attached cross-origin frame. Used when
 * the caller asked for all frames, or when the main-frame evaluation failed
 * with a context error that indicates the data lives in a child frame.
 */
async function evaluateAcrossFrames(
  client: CdpClient,
  expression: string,
  timeoutMs: number | undefined,
  frames: BrowserDevToolsFrame[],
): Promise<FrameEvaluation[]> {
  const results: FrameEvaluation[] = []

  try {
    results.push({
      frame: 'main',
      value: await evaluate(client, expression, timeoutMs),
    })
  } catch (error) {
    results.push({ frame: 'main', error: errorMessage(error) })
  }

  for (const frame of frames) {
    try {
      results.push({
        frame: frame.url || frame.type,
        sessionId: frame.sessionId,
        value: await evaluate(client, expression, timeoutMs, frame.sessionId),
      })
    } catch (error) {
      results.push({
        frame: frame.url || frame.type,
        sessionId: frame.sessionId,
        error: errorMessage(error),
      })
    }
  }
  return results
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getEndpoint(input: BrowserDevToolsInput): string {
  return `http://${input.host ?? DEFAULT_HOST}:${input.port ?? DEFAULT_PORT}`
}

async function canConnect(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await getJson(`${getEndpoint(input)}/json/version`, signal)
    return true
  } catch {
    return false
  }
}

async function getJson<T>(
  url: string,
  signal?: AbortSignal,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, { ...init, signal })
  if (!response.ok) {
    throw new Error(`Browser DevTools HTTP ${response.status}: ${url}`)
  }
  return (await response.json()) as T
}

async function getText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Browser DevTools HTTP ${response.status}: ${url}`)
  }
  return response.text()
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Browser DevTools operation aborted.'))
      return
    }
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new Error('Browser DevTools operation aborted.'))
      },
      { once: true },
    )
  })
}

function findBrowserExecutable(preferred: BrowserDevToolsInput['browser']): {
  name: string
  path: string
} {
  const candidates = getBrowserCandidates()
  const ordered =
    preferred && preferred !== 'auto'
      ? candidates.filter(candidate => candidate.id === preferred)
      : candidates
  const found = ordered.find(candidate => existsSync(candidate.path))
  if (found) return found

  const fallback = ordered[0] ?? candidates[0]
  if (fallback) return fallback
  throw new Error('No Chromium browser executable candidate is configured.')
}

function getBrowserCandidates(): Array<{
  id: 'edge' | 'chrome' | 'brave'
  name: string
  path: string
}> {
  if (platform() === 'win32') {
    const local =
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return [
      {
        id: 'edge',
        name: 'Microsoft Edge',
        path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      },
      {
        id: 'edge',
        name: 'Microsoft Edge',
        path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      },
      {
        id: 'chrome',
        name: 'Google Chrome',
        path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      },
      {
        id: 'chrome',
        name: 'Google Chrome',
        path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      },
      {
        id: 'chrome',
        name: 'Google Chrome',
        path: join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      },
      {
        id: 'brave',
        name: 'Brave',
        path: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      },
    ]
  }
  if (platform() === 'darwin') {
    return [
      {
        id: 'chrome',
        name: 'Google Chrome',
        path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      },
      {
        id: 'edge',
        name: 'Microsoft Edge',
        path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      },
      {
        id: 'brave',
        name: 'Brave',
        path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      },
    ]
  }
  return [
    { id: 'chrome', name: 'Google Chrome', path: 'google-chrome' },
    { id: 'chrome', name: 'Chromium', path: 'chromium' },
    { id: 'edge', name: 'Microsoft Edge', path: 'microsoft-edge' },
    { id: 'brave', name: 'Brave', path: 'brave-browser' },
  ]
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

/**
 * Draw numbered overlays on every visible interactive element and return their
 * viewport rects. A screenshot taken while these are present gives the model a
 * visual map: it can then act by clicking the numbered box (node_index), which
 * works for controls that have no usable selector, sit inside shadow DOM, or
 * live in a cross-origin frame.
 */
const ANNOTATION_ID = '__leviathan_annotation_overlay__'

export const ANNOTATE_EXPRESSION = `(() => {
  const existing = document.getElementById(${jsString(ANNOTATION_ID)});
  if (existing) existing.remove();
  const container = document.createElement('div');
  container.id = ${jsString(ANNOTATION_ID)};
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  document.documentElement.appendChild(container);

  const candidates = Array.from(document.querySelectorAll(
    'a[href], button, input, textarea, select, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="textbox"], [contenteditable="true"], [onclick]'
  ));

  const visible = element => {
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    if (rect.top > innerHeight || rect.left > innerWidth) return false;
    return true;
  };

  const selectorFor = element => {
    if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) {
      return '#' + CSS.escape(element.id);
    }
    for (const attribute of ['data-testid', 'data-test', 'name', 'aria-label', 'placeholder', 'type']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const candidate = element.tagName.toLowerCase() + '[' + attribute + '="' + CSS.escape(value) + '"]';
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    }
    const classes = Array.from(element.classList || []).slice(0, 2).map(name => '.' + CSS.escape(name)).join('');
    return element.tagName.toLowerCase() + classes;
  };

  const elements = [];
  let index = 0;
  for (const element of candidates) {
    if (!visible(element)) continue;
    index += 1;
    if (index > 60) break;
    const rect = element.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #ff2d55;border-radius:3px;box-sizing:border-box;' +
      'left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px';
    const badge = document.createElement('div');
    badge.textContent = String(index);
    badge.style.cssText = 'position:absolute;left:-2px;top:-14px;background:#ff2d55;color:#fff;' +
      'font:11px/14px monospace;padding:0 3px;border-radius:2px;white-space:nowrap';
    box.appendChild(badge);
    container.appendChild(box);
    elements.push({
      index,
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || element.value || element.getAttribute('aria-label') || '').trim().slice(0, 120),
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    });
  }

  return {
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
    elements
  };
})()`

const CLEAR_ANNOTATION_EXPRESSION = `(() => {
  const existing = document.getElementById(${jsString(ANNOTATION_ID)});
  if (existing) existing.remove();
  return true;
})()`

/** Click at viewport coordinates through real input events. */
async function clickAtCoordinates(
  client: CdpClient,
  x: number,
  y: number,
  timeoutMs?: number,
): Promise<void> {
  const base = { x, y, button: 'left' as const, clickCount: 1 }
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, button: 'none' }, timeoutMs)
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, timeoutMs)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base }, timeoutMs)
}

async function captureScreenshot(
  client: CdpClient,
  input: BrowserDevToolsInput,
): Promise<BrowserDevToolsScreenshot> {
  await client.send('Page.enable', {}, input.timeout_ms)
  const result = (await client.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    input.timeout_ms,
  )) as { data?: string }
  if (!result.data) {
    throw new Error('DevTools did not return screenshot data.')
  }
  return {
    dataUrl: `data:image/png;base64,${result.data}`,
    mediaType: 'image/png',
  }
}

async function collectAnnotations(
  client: CdpClient,
  timeoutMs?: number,
): Promise<BrowserDevToolsAnnotation[]> {
  const result = (await evaluate(client, ANNOTATE_EXPRESSION, timeoutMs)) as
    | { elements?: BrowserDevToolsAnnotation[] }
    | undefined
  const elements = result?.elements
  if (!Array.isArray(elements)) return []
  return elements.filter(
    element =>
      element &&
      typeof element.index === 'number' &&
      element.rect &&
      typeof element.rect.x === 'number' &&
      typeof element.rect.y === 'number',
  )
}

/**
 * Re-read an element's viewport rect. Annotated-screenshot coordinates go stale
 * as soon as the page scrolls, so the click path re-measures before dispatching
 * and only falls back to the captured rect when the element cannot be found.
 */
function buildRectExpression(selector: string): string {
  return `(() => {
    const element = document.querySelector(${jsString(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  })()`
}

function buildClickExpression(selector: string): string {
  return `(() => {
    const selector = ${jsString(selector)};
    const element = document.querySelector(selector);
    if (!element) throw new Error('No element matched selector: ' + selector);
    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof element.focus === 'function') element.focus();
    element.click();
    return {
      selector,
      tag: element.tagName,
      text: (element.innerText || element.textContent || '').slice(0, 300),
      href: element.href || ''
    };
  })()`
}

function buildTypeTextExpression(selector: string, text: string): string {
  return `(() => {
    const selector = ${jsString(selector)};
    const text = ${jsString(text)};
    const element = document.querySelector(selector);
    if (!element) throw new Error('No element matched selector: ' + selector);
    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof element.focus === 'function') element.focus();
    if ('value' in element) {
      element.value = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element.isContentEditable) {
      element.textContent = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } else {
      throw new Error('Matched element is not editable: ' + selector);
    }
    return { selector, tag: element.tagName, textLength: text.length };
  })()`
}

function buildFocusStreamTargetExpression(selector?: string): string {
  return `(() => {
    const requestedSelector = ${selector ? jsString(selector) : 'null'};
    const visible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        rect.width > 0 &&
        rect.height > 0;
    };
    const editableChild = element => element?.querySelector?.([
      'textarea.inputarea',
      'textarea.ace_text-input',
      '.cm-content[contenteditable="true"]',
      '.CodeMirror textarea',
      'textarea',
      'input',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ].join(','));
    const selectors = [
      requestedSelector,
      '.monaco-editor textarea.inputarea',
      '.monaco-editor textarea',
      '.cm-content[contenteditable="true"]',
      '.CodeMirror textarea',
      '.ace_text-input',
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ].filter(Boolean);
    let target = null;
    let matchedSelector = '';
    for (const candidate of selectors) {
      const element = document.querySelector(candidate);
      if (!element) continue;
      target = editableChild(element) || element;
      matchedSelector = candidate;
      break;
    }
    if (!target) {
      const active = document.activeElement;
      if (active && active !== document.body) {
        target = editableChild(active) || active;
        matchedSelector = 'document.activeElement';
      }
    }
    if (!target) {
      throw new Error('No stream_type_text target found. Provide selector for the code editor.');
    }
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    const x = rect.left + Math.min(rect.width / 2, 24);
    const y = rect.top + Math.min(rect.height / 2, 24);
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    if (typeof target.focus === 'function') target.focus();
    return {
      selector: matchedSelector,
      tag: target.tagName.toLowerCase(),
      className: String(target.className || ''),
      role: target.getAttribute('role') || '',
      ariaLabel: target.getAttribute('aria-label') || '',
      contentEditable: target.getAttribute('contenteditable') || '',
      activeTag: document.activeElement ? document.activeElement.tagName.toLowerCase() : ''
    };
  })()`
}

type StreamEditorState = {
  readable: boolean
  text: string
  strategy: string
}

type StreamEditorReplaceResult = {
  replaced: boolean
  strategy: string
}

export type StreamTypingStep = {
  text: string
  expectedText: string
  mode: 'insert' | 'newline' | 'normalize-indent'
}

export function createStreamTypingPlan(
  text: string,
  baseText = '',
): StreamTypingStep[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const steps: StreamTypingStep[] = []
  let expectedText = baseText

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? ''
    const indentation = line.match(/^[ \t]*/)?.[0] ?? ''
    const body = lineIndex === 0 ? line : line.slice(indentation.length)

    if (lineIndex > 0) {
      expectedText += indentation
      steps.push({
        text: indentation,
        expectedText,
        mode: 'normalize-indent',
      })
    }

    for (const character of Array.from(body)) {
      expectedText += character
      steps.push({
        text: character,
        expectedText,
        mode: 'insert',
      })
    }

    if (lineIndex < lines.length - 1) {
      expectedText += '\n'
      steps.push({
        text: '\n',
        expectedText,
        mode: 'newline',
      })
    }
  }

  return steps
}

function buildReadStreamEditorExpression(selector?: string): string {
  return buildStreamEditorAccessExpression(selector)
}

function buildReplaceStreamEditorExpression(
  selector: string | undefined,
  text: string,
): string {
  return buildStreamEditorAccessExpression(selector, text)
}

function buildStreamEditorAccessExpression(
  selector?: string,
  replacementText?: string,
): string {
  const replacing = replacementText !== undefined
  return `(() => {
    const requestedSelector = ${selector ? jsString(selector) : 'null'};
    const replacing = ${replacing ? 'true' : 'false'};
    const replacementText = ${replacing ? jsString(replacementText ?? '') : "''"};
    const editableSelector = [
      'textarea.inputarea',
      'textarea.ace_text-input',
      '.cm-content[contenteditable="true"]',
      '.CodeMirror textarea',
      'textarea',
      'input',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ].join(',');
    const editableChild = element => element?.matches?.(editableSelector)
      ? element
      : element?.querySelector?.(editableSelector);
    const requested = requestedSelector ? document.querySelector(requestedSelector) : null;
    const active = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const fallback = document.querySelector([
      '.monaco-editor textarea.inputarea',
      '.monaco-editor textarea',
      '.cm-content[contenteditable="true"]',
      '.CodeMirror textarea',
      '.ace_text-input',
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ].join(','));
    const target = editableChild(requested) || editableChild(active) || fallback;
    if (!target) {
      return replacing
        ? { replaced: false, strategy: 'target-not-found' }
        : { readable: false, text: '', strategy: 'target-not-found' };
    }
    const focusTarget = () => {
      if (typeof target.focus === 'function') target.focus();
    };
    const readResult = (strategy, value) => ({
      readable: true,
      text: String(value ?? ''),
      strategy
    });
    const replaceResult = strategy => {
      focusTarget();
      return { replaced: true, strategy };
    };

    const codeMirrorRoot = target.closest?.('.CodeMirror') || target.querySelector?.('.CodeMirror');
    const codeMirror = codeMirrorRoot?.CodeMirror;
    if (codeMirror && typeof codeMirror.getValue === 'function') {
      if (!replacing) return readResult('codemirror5', codeMirror.getValue());
      codeMirror.setValue(replacementText);
      const lastLine = Math.max(0, codeMirror.lineCount() - 1);
      codeMirror.setCursor(lastLine, codeMirror.getLine(lastLine).length);
      codeMirror.focus();
      return { replaced: true, strategy: 'codemirror5' };
    }

    const aceRoot = target.closest?.('.ace_editor') || target.querySelector?.('.ace_editor');
    const aceEditor = aceRoot?.env?.editor ||
      (aceRoot && globalThis.ace?.edit ? globalThis.ace.edit(aceRoot) : null);
    if (aceEditor && typeof aceEditor.getValue === 'function') {
      if (!replacing) return readResult('ace', aceEditor.getValue());
      aceEditor.setValue(replacementText, -1);
      aceEditor.focus();
      return { replaced: true, strategy: 'ace' };
    }

    const cmContent = target.matches?.('.cm-content')
      ? target
      : target.closest?.('.cm-editor')?.querySelector?.('.cm-content');
    const cmView = cmContent?.cmView?.view || cmContent?.cmView;
    if (cmView?.state?.doc && typeof cmView.dispatch === 'function') {
      if (!replacing) return readResult('codemirror6', cmView.state.doc.toString());
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: replacementText },
        selection: { anchor: replacementText.length }
      });
      cmView.focus();
      return { replaced: true, strategy: 'codemirror6' };
    }

    const monacoRoot = target.closest?.('.monaco-editor') || target.querySelector?.('.monaco-editor');
    const monacoApi = monacoRoot ? globalThis.monaco?.editor : null;
    const monacoEditors = monacoApi?.getEditors ? monacoApi.getEditors() : [];
    const focusedMonacoEditor = monacoEditors.find(editor =>
      editor.hasTextFocus?.() || editor.hasWidgetFocus?.()
    ) || monacoEditors.find(editor => editor.getDomNode?.() === monacoRoot);
    const monacoModels = monacoApi?.getModels
      ? monacoApi.getModels()
      : [];
    const monacoModel = focusedMonacoEditor?.getModel?.() ||
      (monacoModels.length === 1 ? monacoModels[0] : null);
    if (monacoModel && typeof monacoModel.getValue === 'function') {
      if (!replacing) return readResult('monaco', monacoModel.getValue());
      if (focusedMonacoEditor?.setValue) {
        focusedMonacoEditor.setValue(replacementText);
        focusedMonacoEditor.setPosition?.(monacoModel.getPositionAt(replacementText.length));
        focusedMonacoEditor.focus?.();
      } else {
        monacoModel.setValue(replacementText);
        focusTarget();
      }
      return { replaced: true, strategy: 'monaco' };
    }

    const managedEditorRoot = target.closest?.('.monaco-editor,.CodeMirror,.ace_editor,.cm-editor');
    if (managedEditorRoot) {
      return replacing
        ? { replaced: false, strategy: 'managed-editor-api-unavailable' }
        : { readable: false, text: '', strategy: 'managed-editor-api-unavailable' };
    }

    if ('value' in target) {
      if (!replacing) return readResult('native-value', target.value);
      const prototype = target.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(target, replacementText);
      else target.value = replacementText;
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: replacementText
      }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(replacementText.length, replacementText.length);
      }
      return replaceResult('native-value');
    }

    if (target.isContentEditable || target.getAttribute?.('role') === 'textbox') {
      if (!replacing) return readResult('contenteditable', target.textContent || '');
      target.textContent = replacementText;
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: replacementText
      }));
      const selection = globalThis.getSelection?.();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return replaceResult('contenteditable');
    }

    return replacing
      ? { replaced: false, strategy: 'unsupported-target' }
      : { readable: false, text: '', strategy: 'unsupported-target' };
  })()`
}

async function readFocusedStreamEditor(
  client: CdpClient,
  selector?: string,
  timeoutMs?: number,
): Promise<StreamEditorState> {
  const result = (await evaluate(
    client,
    buildReadStreamEditorExpression(selector),
    timeoutMs,
  )) as Partial<StreamEditorState> | undefined
  return {
    readable: result?.readable === true,
    text: typeof result?.text === 'string' ? result.text : '',
    strategy:
      typeof result?.strategy === 'string' ? result.strategy : 'unknown',
  }
}

async function replaceFocusedStreamEditor(
  client: CdpClient,
  selector: string | undefined,
  text: string,
  timeoutMs?: number,
  forceKeyboardFallback = false,
): Promise<StreamEditorReplaceResult> {
  if (!forceKeyboardFallback) {
    const result = (await evaluate(
      client,
      buildReplaceStreamEditorExpression(selector, text),
      timeoutMs,
    )) as Partial<StreamEditorReplaceResult> | undefined
    if (result?.replaced === true) {
      return {
        replaced: true,
        strategy:
          typeof result.strategy === 'string' ? result.strategy : 'page-api',
      }
    }
  }

  await clearFocusedEditor(client)
  if (text) {
    await client.send('Input.insertText', { text })
  }
  return { replaced: true, strategy: 'cdp-select-all' }
}

async function clearFocusedEditor(client: CdpClient): Promise<void> {
  const isMac = process.platform === 'darwin'
  const modifierKey = isMac ? 'Meta' : 'Control'
  const modifierCode = isMac ? 'MetaLeft' : 'ControlLeft'
  const modifierValue = isMac ? 4 : 2
  const modifierVirtualKey = isMac ? 91 : 17
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: modifierKey,
    code: modifierCode,
    windowsVirtualKeyCode: modifierVirtualKey,
    nativeVirtualKeyCode: modifierVirtualKey,
    modifiers: modifierValue,
  })
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: modifierValue,
  })
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: modifierValue,
  })
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: modifierKey,
    code: modifierCode,
    windowsVirtualKeyCode: modifierVirtualKey,
    nativeVirtualKeyCode: modifierVirtualKey,
  })
  await pressKey(client, 'Backspace')
}

async function selectCurrentLineIndent(client: CdpClient): Promise<void> {
  const shift = {
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 16,
    nativeVirtualKeyCode: 16,
  }
  const lineStartKey =
    process.platform === 'darwin'
      ? normalizeKey('ArrowLeft')
      : normalizeKey('Home')
  const meta = {
    key: 'Meta',
    code: 'MetaLeft',
    windowsVirtualKeyCode: 91,
    nativeVirtualKeyCode: 91,
  }
  const usesMeta = process.platform === 'darwin'
  const modifiers = usesMeta ? 12 : 8

  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    ...shift,
    modifiers: 8,
  })
  if (usesMeta) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...meta,
      modifiers,
    })
  }
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    ...lineStartKey,
    modifiers,
  })
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...lineStartKey,
    modifiers,
  })
  if (usesMeta) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...meta,
      modifiers: 8,
    })
  }
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...shift,
  })
}

async function normalizeCurrentLineIndent(
  client: CdpClient,
  indentation: string,
  typingDelayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  // Keep the cursor at least one column into the current line before selecting
  // to Home. At column zero, native textareas can extend Shift+Home into prior
  // content; the sentinel confines the selection to this line in both plain
  // and auto-indenting editors.
  await client.send('Input.insertText', { text: ' ' })
  await selectCurrentLineIndent(client)
  const characters = Array.from(indentation)

  if (characters.length === 0) {
    // The selection always contains the sentinel, so Backspace cannot merge
    // this empty line with the preceding line.
    await pressKey(client, 'Backspace')
    return
  }

  for (const character of characters) {
    if (signal?.aborted) {
      throw new Error('Browser editor streaming was aborted.')
    }
    await client.send('Input.insertText', { text: character })
    if (typingDelayMs > 0) {
      await delay(typingDelayMs, signal)
    }
  }
}

async function streamInsertText(
  client: CdpClient,
  text: string,
  typingDelayMs: number,
  signal?: AbortSignal,
  options: {
    selector?: string
    timeoutMs?: number
    baseText: string
    exactCorrectionEnabled: boolean
  } = {
    baseText: '',
    exactCorrectionEnabled: true,
  },
): Promise<{
  streamedCharacters: number
  indentationCorrections: number
  exactReplacements: number
  exactCorrectionEnabled: boolean
  exactCorrectionStrategies: string[]
  verificationAvailable: boolean
  verifiedExact: boolean
}> {
  const plan = createStreamTypingPlan(text, options.baseText)
  const normalizedText = normalizeStreamEditorText(text)
  const expectedText = options.baseText + normalizedText
  const streamedCharacters = Array.from(normalizedText).length
  const strategies = new Set<string>()
  let indentationCorrections = 0
  let exactReplacements = 0

  const reconcile = async (value: string, forceKeyboardFallback = false) => {
    const result = await replaceFocusedStreamEditor(
      client,
      options.selector,
      value,
      options.timeoutMs,
      forceKeyboardFallback,
    )
    strategies.add(result.strategy)
    exactReplacements += 1
  }

  if (options.exactCorrectionEnabled && options.baseText) {
    await reconcile(options.baseText)
  }

  for (const step of plan) {
    if (signal?.aborted) {
      throw new Error('Browser editor streaming was aborted.')
    }
    if (step.mode === 'normalize-indent') {
      const editorState = options.exactCorrectionEnabled
        ? await readFocusedStreamEditor(
            client,
            options.selector,
            options.timeoutMs,
          )
        : null
      if (editorState?.readable) {
        const expectedBeforeIndent = step.expectedText.slice(
          0,
          step.expectedText.length - step.text.length,
        )
        const currentText = normalizeStreamEditorText(editorState.text)
        const expectedPrefix = normalizeStreamEditorText(expectedBeforeIndent)
        // Measure what the editor did after the newline instead of assuming a
        // policy. Auto-indenting editors append whitespace we must remove;
        // editors without auto-indent append nothing and must be left alone.
        // Deleting unconditionally broke the latter, rewriting the whole
        // document broke the former (and looked nothing like typing).
        const autoIndent = currentText.startsWith(expectedPrefix)
          ? currentText.slice(expectedPrefix.length)
          : null
        if (autoIndent !== null && autoIndent.length > 0 && /^[ \t]+$/.test(autoIndent)) {
          await deleteCharactersBeforeCaret(
            client,
            autoIndent.length,
            typingDelayMs,
            signal,
          )
          strategies.add(`auto-indent-removed:${editorState.strategy}`)
        } else if (currentText !== expectedPrefix) {
          await reconcile(expectedBeforeIndent)
          strategies.add(`detected-indent-repair:${editorState.strategy}`)
        } else {
          strategies.add(`no-auto-indent:${editorState.strategy}`)
        }
        for (const character of Array.from(step.text)) {
          await client.send('Input.insertText', { text: character })
          if (typingDelayMs > 0) {
            await delay(typingDelayMs, signal)
          }
        }
      } else {
        await normalizeCurrentLineIndent(
          client,
          step.text,
          typingDelayMs,
          signal,
        )
        strategies.add('keyboard-line-indent-normalization')
      }
      indentationCorrections += 1
      continue
    } else if (step.mode === 'newline') {
      await pressEditorEnter(client)
    } else {
      await client.send('Input.insertText', { text: step.text })
    }
    if (typingDelayMs > 0) {
      await delay(typingDelayMs, signal)
    }
  }

  if (!options.exactCorrectionEnabled) {
    return {
      streamedCharacters,
      indentationCorrections,
      exactReplacements,
      exactCorrectionEnabled: false,
      exactCorrectionStrategies: [],
      verificationAvailable: false,
      verifiedExact: false,
    }
  }

  let finalState = await readFocusedStreamEditor(
    client,
    options.selector,
    options.timeoutMs,
  )
  let verifiedExact =
    finalState.readable &&
    normalizeStreamEditorText(finalState.text) ===
      normalizeStreamEditorText(expectedText)

  if (finalState.readable && !verifiedExact) {
    await reconcile(expectedText)
    finalState = await readFocusedStreamEditor(
      client,
      options.selector,
      options.timeoutMs,
    )
    verifiedExact =
      finalState.readable &&
      normalizeStreamEditorText(finalState.text) ===
        normalizeStreamEditorText(expectedText)
    if (!verifiedExact) {
      await reconcile(expectedText, true)
      finalState = await readFocusedStreamEditor(
        client,
        options.selector,
        options.timeoutMs,
      )
      verifiedExact =
        finalState.readable &&
        normalizeStreamEditorText(finalState.text) ===
          normalizeStreamEditorText(expectedText)
    }
    if (!verifiedExact) {
      throw new Error(
        'Browser editor content verification failed after streaming. The editor did not preserve the exact source text.',
      )
    }
  }

  return {
    streamedCharacters,
    indentationCorrections,
    exactReplacements,
    exactCorrectionEnabled: true,
    exactCorrectionStrategies: [...strategies],
    verificationAvailable: finalState.readable,
    verifiedExact,
  }
}

function normalizeStreamEditorText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

const SNAPSHOT_EXPRESSION = `(() => {
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      rect.width > 0 &&
      rect.height > 0;
  };
  const selectorFor = element => {
    if (element.id) return '#' + CSS.escape(element.id);
    const dataTest = element.getAttribute('data-testid') || element.getAttribute('data-test');
    if (dataTest) return '[' + (element.getAttribute('data-testid') ? 'data-testid' : 'data-test') + '="' + CSS.escape(dataTest) + '"]';
    const aria = element.getAttribute('aria-label');
    if (aria) return element.tagName.toLowerCase() + '[aria-label="' + CSS.escape(aria) + '"]';
    const name = element.getAttribute('name');
    if (name) return element.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      if (current.classList.length) part += '.' + [...current.classList].slice(0, 2).map(CSS.escape).join('.');
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(child => child.tagName === current.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],summary')]
    .filter(visible)
    .slice(0, 80)
    .map(element => ({
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || element.value || element.textContent || '').trim().slice(0, 160),
      ariaLabel: element.getAttribute('aria-label') || '',
      placeholder: element.getAttribute('placeholder') || '',
      role: element.getAttribute('role') || '',
      href: element.href || '',
      visible: true
    }));
  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    text: document.body ? document.body.innerText.slice(0, 6000) : '',
    elements
  };
})()`
