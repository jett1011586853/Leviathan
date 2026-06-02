import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'

export type EnvironmentKind = 'anthropic_cloud' | 'byoc' | 'bridge'
export type EnvironmentState = 'active'

export type EnvironmentResource = {
  kind: EnvironmentKind
  environment_id: string
  name: string
  created_at: string
  state: EnvironmentState
}

export type EnvironmentListResponse = {
  environments: EnvironmentResource[]
  has_more: boolean
  first_id: string | null
  last_id: string | null
}

export async function fetchEnvironments(): Promise<EnvironmentResource[]> {
  return []
}

export async function createDefaultCloudEnvironment(
  _name: string,
): Promise<EnvironmentResource> {
  throw new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}
