/**
 * Word tokenizer for <SplitWords>. Breaks only on ordinary whitespace, so a
 * non-breaking space (U+00A0) keeps "14 days" or "$14 M" together, and
 * hyphenated words stay one unit. Whitespace tokens are kept, so joining the
 * tokens gives back the exact source text.
 */

export type WordToken = { type: 'word'; text: string } | { type: 'space'; text: string };

const BREAKS = /([ \t\n\r\f\v]+)/;
const ONLY_BREAKS = /^[ \t\n\r\f\v]+$/;

export function splitWords(text: string): WordToken[] {
  if (!text) return [];
  return text
    .split(BREAKS)
    .filter((part) => part.length > 0)
    .map((part): WordToken => (ONLY_BREAKS.test(part) ? { type: 'space', text: part } : { type: 'word', text: part }));
}
