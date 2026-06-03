const SECRET_ASSIGNMENT =
  /\b(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|API_KEY|AUTH_TOKEN|TOKEN)\s*=\s*([^\s,;"']+)/gi

const BEARER_TOKEN = /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._-]+/gi
const INLINE_PROVIDER_TOKEN = /\b(tp-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})\b/g
const WINDOWS_HOME_PATH = /\b[A-Za-z]:\\Users\\([^\\\s]+)((?:\\[^\s\\]+)*)/g
const WINDOWS_ABSOLUTE_PATH = /\b[A-Za-z]:\\(?!Users\\)[^\s]+/g
const UNIX_HOME_PATH = /\/home\/([^/\s]+)((?:\/[^\s/]+)*)/g

const AUTH_HEADER_KEYS = new Set([
  'authorization',
  'anthropic_auth_token',
  'anthropic_api_key',
  'api_key',
  'auth_token',
  'token',
])

export function redactText(text: string): string {
  return text
    .replace(BEARER_TOKEN, 'Authorization: [REDACTED_BEARER_TOKEN]')
    .replace(SECRET_ASSIGNMENT, '$1=[REDACTED_SECRET]')
    .replace(INLINE_PROVIDER_TOKEN, '[REDACTED_SECRET]')
    .replace(WINDOWS_HOME_PATH, (_match, _user, rest: string = '') => {
      return `$HOME_ALIAS${rest}`
    })
    .replace(WINDOWS_ABSOLUTE_PATH, '$WORKDIR')
    .replace(UNIX_HOME_PATH, (_match, _user, rest: string = '') => {
      return `$HOME_ALIAS${rest}`
    })
}

export function redactValue(value: unknown, keyHint = ''): unknown {
  if (typeof value === 'string') {
    if (AUTH_HEADER_KEYS.has(keyHint.toLowerCase())) {
      return '[REDACTED_AUTH_HEADER]'
    }
    return redactText(value)
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item))
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      result[key] = redactValue(nested, key)
    }
    return result
  }

  return value
}
