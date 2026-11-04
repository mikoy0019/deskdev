import { describe, expect, it } from 'vitest';
import { formatCounter, parseCounter } from './countUp';

describe('parseCounter', () => {
  it('splits prefix, number and suffix', () => {
    expect(parseCounter('$14M+')).toEqual({ prefix: '$', target: 14, decimals: 0, grouping: false, suffix: 'M+' });
    expect(parseCounter('96%')).toMatchObject({ prefix: '', target: 96, suffix: '%' });
    expect(parseCounter('200+')).toMatchObject({ target: 200, suffix: '+' });
  });

  it('keeps decimals and thousands separators', () => {
    expect(parseCounter('4.9/5')).toMatchObject({ target: 4.9, decimals: 1, suffix: '/5' });
    expect(parseCounter('1,284 calls')).toMatchObject({ target: 1284, grouping: true, suffix: ' calls' });
  });

  it('returns null when there is no number', () => {
    expect(parseCounter('Always on')).toBeNull();
    expect(parseCounter('')).toBeNull();
  });
});

describe('formatCounter', () => {
  it('formats in-between values in the source format', () => {
    const p = parseCounter('1,284')!;
    expect(formatCounter(p, 0)).toBe('0');
    expect(formatCounter(p, 1003.6)).toBe('1,004');
    expect(formatCounter(p, 1284)).toBe('1,284');
  });

  it('keeps decimals fixed and the text around the number', () => {
    const p = parseCounter('$4.9M')!;
    expect(formatCounter(p, 0)).toBe('$0.0M');
    expect(formatCounter(p, 2.456)).toBe('$2.5M');
  });

  it('never overshoots or goes negative', () => {
    const p = parseCounter('96%')!;
    expect(formatCounter(p, 120)).toBe('96%');
    expect(formatCounter(p, -3)).toBe('0%');
  });
});
