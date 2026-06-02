import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'

export type ReferralCampaign = string

export type ReferrerRewardInfo = {
  currency: string
  amount_minor_units: number
}

export type ReferralEligibilityResponse = {
  eligible: boolean
  remaining_passes?: number | null
  referrer_reward?: ReferrerRewardInfo | null
}

export type ReferralRedemptionsResponse = {
  redemptions?: unknown[]
}

export async function fetchReferralEligibility(
  _campaign: ReferralCampaign = 'leviathan-guest-pass',
): Promise<ReferralEligibilityResponse> {
  return { eligible: false, remaining_passes: null, referrer_reward: null }
}

export async function fetchReferralRedemptions(
  _campaign: string = 'leviathan-guest-pass',
): Promise<ReferralRedemptionsResponse> {
  return { redemptions: [] }
}

export function checkCachedPassesEligibility(): {
  eligible: boolean
  needsRefresh: boolean
  hasCache: boolean
} {
  return { eligible: false, needsRefresh: false, hasCache: false }
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  BRL: 'R$',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  SGD: 'S$',
}

export function formatCreditAmount(reward: ReferrerRewardInfo): string {
  const symbol = CURRENCY_SYMBOLS[reward.currency] ?? `${reward.currency} `
  const amount = reward.amount_minor_units / 100
  const formatted = amount % 1 === 0 ? amount.toString() : amount.toFixed(2)
  return `${symbol}${formatted}`
}

export function getCachedReferrerReward(): ReferrerRewardInfo | null {
  return null
}

export function getCachedRemainingPasses(): number | null {
  return null
}

export async function fetchAndStorePassesEligibility(): Promise<ReferralEligibilityResponse | null> {
  return null
}

export async function getCachedOrFetchPassesEligibility(): Promise<ReferralEligibilityResponse | null> {
  return null
}

export async function prefetchPassesEligibility(): Promise<void> {
  void LEGACY_ACCOUNT_FEATURE_NOTICE
}
