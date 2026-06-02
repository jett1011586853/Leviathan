import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'

type ExtraUsageResult =
  | { type: 'message'; value: string }
  | { type: 'browser-opened'; url: string; opened: boolean }

export async function runExtraUsage(): Promise<ExtraUsageResult> {
  return {
    type: 'message',
    value: LEGACY_ACCOUNT_FEATURE_NOTICE,
  }
}
