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
  selector?: string
  text?: string
  key?: string
  timeout_ms?: number
  user_data_dir?: string
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
    }>
  }
  screenshot?: BrowserDevToolsScreenshot
}

type CdpResponse = {
  id?: number
  result?: unknown
  error?: { message?: string; data?: string }
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
        const result = await evaluate(
          client,
          required(input.expression, 'expression'),
          input.timeout_ms,
        )
        return {
          ok: true,
          action: input.action,
          message: 'Evaluated JavaScript in the page.',
          tab,
          result,
        }
      })
    case 'snapshot':
      return withTab(input, signal, async (client, tab) => {
        const snapshot = await evaluate(
          client,
          SNAPSHOT_EXPRESSION,
          input.timeout_ms,
        )
        return {
          ok: true,
          action: input.action,
          message: 'Captured page snapshot from DevTools.',
          tab,
          snapshot: snapshot as BrowserDevToolsOutput['snapshot'],
        }
      })
    case 'click':
      return withTab(input, signal, async (client, tab) => {
        const result = await evaluate(
          client,
          buildClickExpression(required(input.selector, 'selector')),
          input.timeout_ms,
        )
        return {
          ok: true,
          action: input.action,
          message: `Clicked ${input.selector}.`,
          tab,
          result,
        }
      })
    case 'type_text':
      return withTab(input, signal, async (client, tab) => {
        const result = await evaluate(
          client,
          buildTypeTextExpression(
            required(input.selector, 'selector'),
            input.text ?? '',
          ),
          input.timeout_ms,
        )
        return {
          ok: true,
          action: input.action,
          message: `Typed text into ${input.selector}.`,
          tab,
          result,
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
        await client.send('Page.enable')
        const result = (await client.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        })) as { data?: string }
        if (!result.data) {
          throw new Error('DevTools did not return screenshot data.')
        }
        return {
          ok: true,
          action: input.action,
          message: 'Captured browser screenshot.',
          tab,
          screenshot: {
            dataUrl: `data:image/png;base64,${result.data}`,
            mediaType: 'image/png',
          },
        }
      })
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

  throw new Error(`Launched ${exe.name}, but DevTools did not become ready at ${endpoint}.`)
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
  const text = await getText(`${getEndpoint(input)}/json/close/${tab.id}`, signal)
  return {
    ok: true,
    action: input.action,
    message: text || `Closed tab ${tab.id}.`,
    endpoint: getEndpoint(input),
    tab,
  }
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
  const client = await CdpClient.connect(tab.webSocketDebuggerUrl, signal)
  try {
    const output = await fn(client, tab)
    return {
      ...output,
      endpoint: getEndpoint(input),
    }
  } finally {
    client.close()
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
    : pages[0] ?? tabs[0]
  if (!tab) {
    throw new Error('No Browser DevTools tabs are available.')
  }
  return tab
}

async function listTabs(
  input: BrowserDevToolsInput,
  signal?: AbortSignal,
): Promise<BrowserDevToolsTab[]> {
  return getJson<BrowserDevToolsTab[]>(`${getEndpoint(input)}/json/list`, signal)
}

async function evaluate(
  client: CdpClient,
  expression: string,
  timeoutMs?: number,
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

function normalizeKey(key: string): {
  key: string
  code: string
  windowsVirtualKeyCode: number
  nativeVirtualKeyCode: number
} {
  const lower = key.trim().toLowerCase()
  const named: Record<string, { key: string; code: string; codePoint: number }> = {
    enter: { key: 'Enter', code: 'Enter', codePoint: 13 },
    return: { key: 'Enter', code: 'Enter', codePoint: 13 },
    tab: { key: 'Tab', code: 'Tab', codePoint: 9 },
    escape: { key: 'Escape', code: 'Escape', codePoint: 27 },
    esc: { key: 'Escape', code: 'Escape', codePoint: 27 },
    backspace: { key: 'Backspace', code: 'Backspace', codePoint: 8 },
    delete: { key: 'Delete', code: 'Delete', codePoint: 46 },
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
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()

  private constructor(private readonly socket: WebSocket) {}

  static async connect(url: string, signal?: AbortSignal): Promise<CdpClient> {
    if (signal?.aborted) throw new Error('Browser DevTools connection aborted.')
    const socket = new WebSocket(url)
    const client = new CdpClient(socket)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out connecting to Browser DevTools websocket.')),
        DEFAULT_TIMEOUT_MS,
      )
      socket.addEventListener('open', () => {
        clearTimeout(timeout)
        resolve()
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('Failed to connect to Browser DevTools websocket.'))
      }, { once: true })
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
      for (const [id, pending] of client.pending) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('Browser DevTools websocket closed.'))
        client.pending.delete(id)
      }
    })
    return client
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = this.nextID++
    const payload = JSON.stringify({ id, method, params })
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Browser DevTools command timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      this.socket.send(payload)
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

function findBrowserExecutable(
  preferred: BrowserDevToolsInput['browser'],
): { name: string; path: string } {
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
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
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
