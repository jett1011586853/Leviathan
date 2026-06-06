const SECRET_ASSIGNMENT =
  /\b(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|API_KEY|AUTH_TOKEN|TOKEN)\s*=\s*(?:(["'])([^"'\s,;]+)\2|([^\s,;"']+))/gi
const PROVIDER_URL_ASSIGNMENT =
  /\b(ANTHROPIC_BASE_URL|OPENAI_BASE_URL|PROVIDER_BASE_URL|BASE_URL)\s*=\s*(?:(["'])(https?:\/\/[^"'\s,;]+)\2|(https?:\/\/[^\s,;"']+))/gi

const BEARER_TOKEN = /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._-]+/gi
const INLINE_PROVIDER_TOKEN = /\b(tp-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})\b/g
const WINDOWS_HOME_PATH = /\b[A-Za-z]:\\Users\\([^\\\s]+)((?:\\[^\s\\]+)*)/g
const WINDOWS_ABSOLUTE_PATH = /\b[A-Za-z]:\\(?!Users\\)[^\s]+/g
const WINDOWS_HOME_PATH_FORWARD = /\b[A-Za-z]:\/Users\/([^/\s]+)((?:\/[^\s/]+)*)/g
const WINDOWS_ABSOLUTE_PATH_FORWARD = /\b[A-Za-z]:\/(?!Users\/)[^\s]+/g
const UNIX_HOME_PATH = /\/home\/([^/\s]+)((?:\/[^\s/]+)*)/g

const AUTH_HEADER_KEYS = new Set([
  'authorization',
  'anthropic_auth_token',
  'anthropic_api_key',
  'api_key',
  'auth_token',
  'token',
])

const PROVIDER_URL_KEYS = new Set([
  'anthropic_base_url',
  'openai_base_url',
  'provider_base_url',
  'base_url',
])

export function redactText(text: string): string {
  return text
    .replace(BEARER_TOKEN, 'Authorization: [REDACTED_BEARER_TOKEN]')
    .replace(PROVIDER_URL_ASSIGNMENT, (_match, key: string, quote: string | undefined) => {
      return quote
        ? `${key}=${quote}[REDACTED_PROVIDER_URL]${quote}`
        : `${key}=[REDACTED_PROVIDER_URL]`
    })
    .replace(SECRET_ASSIGNMENT, (_match, key: string, quote: string | undefined) => {
      return quote ? `${key}=${quote}[REDACTED_SECRET]${quote}` : `${key}=[REDACTED_SECRET]`
    })
    .replace(INLINE_PROVIDER_TOKEN, '[REDACTED_SECRET]')
    .replace(WINDOWS_HOME_PATH, (_match, _user, rest: string = '') => {
      return `$HOME_ALIAS${rest}`
    })
    .replace(WINDOWS_ABSOLUTE_PATH, '$WORKDIR')
    .replace(WINDOWS_HOME_PATH_FORWARD, (_match, _user, rest: string = '') => {
      return `$HOME_ALIAS${rest}`
    })
    .replace(WINDOWS_ABSOLUTE_PATH_FORWARD, '$WORKDIR')
    .replace(UNIX_HOME_PATH, (_match, _user, rest: string = '') => {
      return `$HOME_ALIAS${rest}`
    })
}

function redactObjectKey(key: string): string {
  const redacted = redactText(key)
  if (redacted.startsWith('$WORKDIR')) return '$WORKDIR'
  if (redacted.startsWith('$HOME_ALIAS')) return '$HOME_ALIAS'
  return redacted
}

export function redactValue(value: unknown, keyHint = ''): unknown {
  if (typeof value === 'string') {
    if (AUTH_HEADER_KEYS.has(keyHint.toLowerCase())) {
      return '[REDACTED_AUTH_HEADER]'
    }
    if (PROVIDER_URL_KEYS.has(keyHint.toLowerCase())) {
      return '[REDACTED_PROVIDER_URL]'
    }
    return redactText(value)
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item))
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      result[redactObjectKey(key)] = redactValue(nested, key)
    }
    return result
  }

  return value
}
