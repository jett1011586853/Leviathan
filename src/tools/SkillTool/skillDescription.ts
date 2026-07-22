import type { CommandBase } from '../../types/command.js'

// Keep enough room for trigger examples while the global listing budget still
// bounds total context usage.
export const MAX_LISTING_DESC_CHARS = 512

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateWithEllipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return '…'.slice(0, maxLength)
  return `${value.slice(0, maxLength - 1)}…`
}

/**
 * Trigger guidance is intentionally first. Compatible agents match skills from
 * compact listings, so the most important "when" text must survive per-entry
 * and global truncation.
 */
export function getSkillListingDescription(
  command: Pick<CommandBase, 'description' | 'whenToUse'>,
): string {
  const description = compactWhitespace(command.description)
  const whenToUse = command.whenToUse
    ? compactWhitespace(command.whenToUse)
    : ''

  if (!whenToUse) {
    return truncateWithEllipsis(description, MAX_LISTING_DESC_CHARS)
  }

  const full = `When: ${whenToUse} | Does: ${description}`
  if (full.length <= MAX_LISTING_DESC_CHARS) return full

  const labelLength = 'When:  | Does: '.length
  const available = MAX_LISTING_DESC_CHARS - labelLength
  const triggerBudget = Math.floor(available * 0.7)
  const descriptionBudget = available - triggerBudget
  return `When: ${truncateWithEllipsis(whenToUse, triggerBudget)} | Does: ${truncateWithEllipsis(description, descriptionBudget)}`
}
