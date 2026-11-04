import { describe, expect, it } from 'vitest';
import { promoteStep, typewriterStart, typewriterStep, type TypewriterState, type TypewriterTiming } from './loops';

const T: TypewriterTiming = { type: 10, erase: 5, hold: 100, processing: 50, gap: 20 };

function run(state: TypewriterState, phrases: string[], steps: number, timing = T) {
  const seen: TypewriterState[] = [];
  let s = state;
  for (let i = 0; i < steps; i++) {
    s = typewriterStep(s, phrases, timing).next;
    seen.push(s);
  }
  return seen;
}

describe('typewriter', () => {
  it('rests on the first phrase, fully typed', () => {
    expect(typewriterStart(['Draft a follow-up', 'x'])).toEqual({ phrase: 0, chars: 17, phase: 'holding' });
  });

  it('cycles hold -> delete -> type -> process -> hold -> next phrase', () => {
    const phrases = ['ab', 'cde'];
    const seen = run(typewriterStart(phrases), phrases, 12);
    expect(seen.map((s) => `${s.phase}:${s.phrase}:${s.chars}`)).toEqual([
      'deleting:0:2',
      'deleting:0:1',
      'deleting:0:0',
      'typing:1:0',
      'typing:1:1',
      'typing:1:2',
      'typing:1:3',
      'processing:1:3',
      'holding:1:3',
      'deleting:1:3',
      'deleting:1:2',
      'deleting:1:1',
    ]);
  });

  it('waits the configured times', () => {
    const phrases = ['ab', 'cd'];
    expect(typewriterStep({ phrase: 0, chars: 0, phase: 'typing' }, phrases, T).wait).toBe(T.type);
    expect(typewriterStep({ phrase: 0, chars: 2, phase: 'typing' }, phrases, T).wait).toBe(T.processing);
    expect(typewriterStep({ phrase: 0, chars: 2, phase: 'processing' }, phrases, T).wait).toBe(T.hold);
    expect(typewriterStep({ phrase: 0, chars: 0, phase: 'deleting' }, phrases, T).wait).toBe(T.gap);
  });

  it('skips processing when its time is 0', () => {
    const next = typewriterStep({ phrase: 0, chars: 2, phase: 'typing' }, ['ab', 'cd'], { ...T, processing: 0 }).next;
    expect(next.phase).toBe('holding');
  });

  it('a single phrase just stays; no phrases is safe', () => {
    expect(typewriterStep({ phrase: 0, chars: 2, phase: 'holding' }, ['ab'], T).next).toEqual({ phrase: 0, chars: 2, phase: 'holding' });
    expect(typewriterStep({ phrase: 3, chars: 9, phase: 'typing' }, [], T).next).toEqual({ phrase: 0, chars: 0, phase: 'holding' });
  });

  it('wraps back to the first phrase', () => {
    expect(typewriterStep({ phrase: 1, chars: 0, phase: 'deleting' }, ['a', 'b'], T).next).toEqual({ phrase: 0, chars: 0, phase: 'typing' });
  });
});

describe('promoteStep', () => {
  it('promotes one item to the top per tick, never mutating', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(promoteStep(items, 0)).toEqual(['b', 'a', 'c', 'd']);
    expect(promoteStep(items, 1)).toEqual(['c', 'a', 'b', 'd']);
    expect(promoteStep(items, 2)).toEqual(['d', 'a', 'b', 'c']);
    expect(promoteStep(items, 3)).toEqual(['b', 'a', 'c', 'd']);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps every item', () => {
    let list = ['a', 'b', 'c', 'd', 'e'];
    for (let t = 0; t < 20; t++) list = promoteStep(list, t);
    expect([...list].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('handles short lists', () => {
    expect(promoteStep(['only'], 4)).toEqual(['only']);
    expect(promoteStep([], 1)).toEqual([]);
  });
});
