import type { OAuthProfileResponse } from './types.js'

export async function getOauthProfileFromApiKey(): Promise<
  OAuthProfileResponse | undefined
> {
  return undefined
}

export async function getOauthProfileFromOauthToken(
  _accessToken: string,
): Promise<OAuthProfileResponse | undefined> {
  return undefined
}
