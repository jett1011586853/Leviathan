import {describe, expect, test} from 'bun:test';
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedKey,
} from '../parse-keypress.js';
import {InputEvent} from './input-event.js';

function parseKey(input: string): ParsedKey {
  const [parsed] = parseMultipleKeypresses({...INITIAL_STATE}, input);
  const key = parsed[0];

  if (!key || key.kind !== 'key') {
    throw new Error(`Expected one parsed key for ${JSON.stringify(input)}`);
  }

  return key;
}

describe('InputEvent Enter normalization', () => {
  test.each([
    ['CR', '\r'],
    ['LF', '\n'],
  ])('%s is exposed as key.return', (_name, sequence) => {
    const event = new InputEvent(parseKey(sequence));

    expect(event.key.return).toBe(true);
  });
});
