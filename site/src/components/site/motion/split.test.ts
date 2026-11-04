import { describe, expect, it } from 'vitest';
import { splitWords } from './split';

const join = (text: string) =>
  splitWords(text)
    .map((t) => t.text)
    .join('');

describe('splitWords', () => {
  it('splits on spaces and keeps them', () => {
    expect(splitWords('Websites that work')).toEqual([
      { type: 'word', text: 'Websites' },
      { type: 'space', text: ' ' },
      { type: 'word', text: 'that' },
      { type: 'space', text: ' ' },
      { type: 'word', text: 'work' },
    ]);
  });

  it('round-trips the exact text', () => {
    for (const s of ['  leading and trailing  ', 'line\nbreak', 'one', 'a  b', 'Built — not templated.']) {
      expect(join(s)).toBe(s);
    }
  });

  it('never breaks on a non-breaking space or a hyphen', () => {
    const words = splitWords('14 days, follow-up')
      .filter((t) => t.type === 'word')
      .map((t) => t.text);
    expect(words).toEqual(['14 days,', 'follow-up']);
  });

  it('handles empty input', () => {
    expect(splitWords('')).toEqual([]);
  });
});
