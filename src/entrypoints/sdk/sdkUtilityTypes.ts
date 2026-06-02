import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/** Usage object with all required fields present (no nulls). */
export type NonNullableUsage = {
  [K in keyof Usage]: NonNullable<Usage[K]>
}
