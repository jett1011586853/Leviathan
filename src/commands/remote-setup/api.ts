/**
 * Local hard-cut boundary for the recovered remote web setup flow.
 *
 * Leviathan does not import product-account OAuth, upload GitHub tokens, or
 * create hosted remote environments. These exports keep legacy imports stable
 * while failing locally before any network or credential access.
 */
export class RedactedGithubToken {
  readonly #value: string

  constructor(raw: string) {
    this.#value = raw
  }

  reveal(): string {
    return this.#value
  }

  toString(): string {
    return '[REDACTED:gh-token]'
  }

  toJSON(): string {
    return '[REDACTED:gh-token]'
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[REDACTED:gh-token]'
  }
}

export type ImportTokenResult = {
  github_username: string
}

export type ImportTokenError =
  | { kind: 'not_signed_in' }
  | { kind: 'invalid_token' }
  | { kind: 'server'; status: number }
  | { kind: 'network' }

export async function importGithubToken(
  _token: RedactedGithubToken,
): Promise<
  | { ok: true; result: ImportTokenResult }
  | { ok: false; error: ImportTokenError }
> {
  return { ok: false, error: { kind: 'not_signed_in' } }
}

export async function createDefaultEnvironment(): Promise<boolean> {
  return false
}

export async function isSignedIn(): Promise<boolean> {
  return false
}

export function getCodeWebUrl(): string {
  return 'https://leviathan.local/code'
}
