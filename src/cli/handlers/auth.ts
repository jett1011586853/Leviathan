/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import { ACCOUNT_LOGIN_STATUS, LEGACY_ACCOUNT_FEATURE_NOTICE, PRODUCT_NAME } from '../../leviathan/branding.js'
import type { OAuthTokens } from '../../services/oauth/types.js'
import { getAPIProvider } from '../../utils/model/providers.js'

/**
 * Compatibility path for still-recovered account-backed integrations.
 * Public Leviathan login entry points do not call this function.
 */
export async function installOAuthTokens(tokens: OAuthTokens): Promise<void> {
  void tokens
  throw new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}

export async function authLogin(_options: {
  email?: string
  sso?: boolean
  console?: boolean
}): Promise<void> {
  process.stdout.write(`${ACCOUNT_LOGIN_STATUS}\n`)
}

export async function authStatus(opts: {
  json?: boolean
  text?: boolean
}): Promise<void> {
  const output = {
    product: PRODUCT_NAME,
    accountLoginRequired: false,
    apiProvider: getAPIProvider(),
    status: ACCOUNT_LOGIN_STATUS,
  }

  if (opts.text) {
    process.stdout.write(`${PRODUCT_NAME}: account sign-in disabled.\n`)
    process.stdout.write(`${ACCOUNT_LOGIN_STATUS}\n`)
    process.stdout.write(`API provider: ${output.apiProvider}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  }
  process.exit(0)
}

export async function authLogout(): Promise<void> {
  process.stdout.write(`${ACCOUNT_LOGIN_STATUS}\n`)
  process.exit(0)
}
