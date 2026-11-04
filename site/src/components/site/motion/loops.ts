/**
 * State machines for the perpetual Bento primitives (Typewriter, AutoSortList).
 * Pure and deterministic: the components only schedule the next step, so the
 * sequence itself is unit-tested and identical on every run (no Math.random,
 * nothing that could differ between server and client).
 */

export type TypewriterPhase = 'typing' | 'holding' | 'processing' | 'deleting';

export type TypewriterState = {
  /** Index into the phrase list. */
  phrase: number;
  /** Characters of the phrase currently shown. */
  chars: number;
  phase: TypewriterPhase;
};

export type TypewriterTiming = {
  /** ms per typed character. */
  type: number;
  /** ms per deleted character (deleting is faster than typing). */
  erase: number;
  /** ms a finished phrase stays fully shown. */
  hold: number;
  /** ms of the "processing" shimmer after a phrase is typed; 0 skips the phase. */
  processing: number;
  /** ms of empty line before the next phrase starts. */
  gap: number;
};

export const TYPEWRITER_TIMING: TypewriterTiming = { type: 55, erase: 24, hold: 1800, processing: 1100, gap: 320 };

/** The resting state rendered on the server and for reduced motion: first phrase, fully typed. */
export function typewriterStart(phrases: readonly string[]): TypewriterState {
  return { phrase: 0, chars: phrases[0]?.length ?? 0, phase: 'holding' };
}

/**
 * One step of the loop: typing → (processing) → holding → deleting → next
 * phrase. Returns the next state and how long to wait before taking it.
 */
export function typewriterStep(
  state: TypewriterState,
  phrases: readonly string[],
  timing: TypewriterTiming = TYPEWRITER_TIMING,
): { next: TypewriterState; wait: number } {
  const count = phrases.length;
  if (count === 0) return { next: { phrase: 0, chars: 0, phase: 'holding' }, wait: timing.hold };
  const phrase = ((state.phrase % count) + count) % count;
  const full = phrases[phrase].length;

  switch (state.phase) {
    case 'typing':
      if (state.chars < full) return { next: { phrase, chars: state.chars + 1, phase: 'typing' }, wait: timing.type };
      return timing.processing > 0
        ? { next: { phrase, chars: full, phase: 'processing' }, wait: timing.processing }
        : { next: { phrase, chars: full, phase: 'holding' }, wait: timing.hold };
    case 'processing':
      return { next: { phrase, chars: full, phase: 'holding' }, wait: timing.hold };
    case 'holding':
      // A single phrase never deletes itself: it just stays.
      if (count === 1) return { next: { phrase, chars: full, phase: 'holding' }, wait: timing.hold };
      return { next: { phrase, chars: full, phase: 'deleting' }, wait: timing.erase };
    case 'deleting':
      if (state.chars > 0) return { next: { phrase, chars: state.chars - 1, phase: 'deleting' }, wait: timing.erase };
      return { next: { phrase: (phrase + 1) % count, chars: 0, phase: 'typing' }, wait: timing.gap };
  }
}

/**
 * One "prioritising" step for AutoSortList: the item at a moving position is
 * promoted to the top, so over a cycle every item takes a turn at #1 and the
 * rest shift down by one. Returns a new array; never mutates.
 */
export function promoteStep<T>(items: readonly T[], tick: number): T[] {
  const n = items.length;
  if (n < 2) return items.slice();
  const from = 1 + (((tick % (n - 1)) + (n - 1)) % (n - 1));
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.unshift(moved);
  return next;
}
