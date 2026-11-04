/**
 * Parsing and formatting for <Counter>. The markup always holds the final
 * string ("$14M+", "1,284", "4.9/5"); the count-up animates only the first
 * number in it and keeps everything around it verbatim.
 */

export type ParsedCounter = {
  prefix: string;
  target: number;
  decimals: number;
  /** The source used thousands separators ("1,284"), so the count does too. */
  grouping: boolean;
  suffix: string;
};

const NUMBER = /^(\D*?)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/;

/** First number in `text`, with what comes before and after it. Null when there is none. */
export function parseCounter(text: string): ParsedCounter | null {
  const match = text.match(NUMBER);
  if (!match) return null;
  const [, prefix, raw, suffix] = match;
  const target = Number.parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(target)) return null;
  return {
    prefix,
    target,
    decimals: (raw.split('.')[1] ?? '').length,
    grouping: raw.includes(','),
    suffix,
  };
}

/** The display string for an in-between value of the count. */
export function formatCounter(parsed: ParsedCounter, value: number): string {
  const clamped = Math.min(Math.max(value, 0), parsed.target);
  const number = parsed.grouping
    ? clamped.toLocaleString('en-US', { minimumFractionDigits: parsed.decimals, maximumFractionDigits: parsed.decimals })
    : clamped.toFixed(parsed.decimals);
  return `${parsed.prefix}${number}${parsed.suffix}`;
}
