import { expect, test } from 'bun:test'
import {
  getSkillListingDescription,
  MAX_LISTING_DESC_CHARS,
} from './skillDescription.js'

test('front-loads trigger guidance and keeps both fields under the cap', () => {
  const output = getSkillListingDescription({
    whenToUse:
      'TRIGGER_KEYWORD '.repeat(40) + 'Use for permitted coding challenges.',
    description:
      'DESCRIPTION_MARKER '.repeat(40) + 'Runs a verified workflow.',
  })

  expect(output.startsWith('When: TRIGGER_KEYWORD')).toBe(true)
  expect(output).toContain('| Does: DESCRIPTION_MARKER')
  expect(output.length).toBeLessThanOrEqual(MAX_LISTING_DESC_CHARS)
})

test('compacts whitespace in descriptions without trigger metadata', () => {
  expect(
    getSkillListingDescription({
      description: 'Read   PDFs\nwith layout verification.',
    }),
  ).toBe('Read PDFs with layout verification.')
})
