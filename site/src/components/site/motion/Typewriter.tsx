'use client';

import { memo, useEffect, useRef } from 'react';
import { useLoopGate } from './hooks';
import { TYPEWRITER_TIMING, typewriterStart, typewriterStep, type TypewriterState, type TypewriterTiming } from './loops';

export type TypewriterProps = {
  /** Phrases typed in turn (sample prompts in a mockup). Label figures inside as sample data. */
  phrases: readonly string[];
  /** Show a shimmering "processing" beat after each phrase is typed. Default true. */
  processing?: boolean;
  /** Screen-reader text. Omit and the whole thing is decorative (aria-hidden). */
  srText?: string;
  className?: string;
  timing?: Partial<TypewriterTiming>;
};

/**
 * Taste's command-input loop: types a phrase, shimmers while "processing",
 * holds, deletes, types the next. Writes text straight into the DOM (no React
 * render per character) and only runs while visible on screen, the tab is
 * visible and motion is allowed; otherwise it rests on the first phrase,
 * fully typed — which is also what the server renders.
 *
 * `data-state` on the root (typing | processing | holding | deleting) lets a
 * parent style the surrounding mockup per phase.
 */
export const Typewriter = memo(function Typewriter({ phrases, processing = true, srText, className = '', timing }: TypewriterProps) {
  const root = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const state = useRef<TypewriterState>(typewriterStart(phrases));
  const running = useLoopGate(root);
  const key = phrases.join('\u0000');
  const timingKey = JSON.stringify(timing ?? {});

  useEffect(() => {
    const t: TypewriterTiming = { ...TYPEWRITER_TIMING, ...(JSON.parse(timingKey) as Partial<TypewriterTiming>), ...(processing ? {} : { processing: 0 }) };
    const list = key ? key.split('\u0000') : [];
    const paint = (s: TypewriterState) => {
      if (text.current) text.current.textContent = (list[s.phrase] ?? '').slice(0, s.chars);
      root.current?.setAttribute('data-state', s.phase);
    };
    if (!running) {
      // Rest on a complete phrase (no half-typed word left on screen).
      const s = state.current;
      state.current = { phrase: s.phrase, chars: list[s.phrase]?.length ?? 0, phase: 'holding' };
      paint(state.current);
      return;
    }
    let timer = 0;
    const tick = () => {
      const { next, wait } = typewriterStep(state.current, list, t);
      state.current = next;
      paint(next);
      timer = window.setTimeout(tick, wait);
    };
    timer = window.setTimeout(tick, t.hold);
    return () => window.clearTimeout(timer);
  }, [running, key, timingKey, processing]);

  const first = phrases[0] ?? '';
  return (
    <span className={`nx-kit-typewriter ${className}`.trim()}>
      {srText ? <span className="sr-only">{srText}</span> : null}
      <span ref={root} aria-hidden data-state="holding" className="nx-kit-typewriter-line">
        <span ref={text}>{first}</span>
        <span className="nx-kit-caret nx-kit-loop" />
        <span className="nx-kit-typewriter-shimmer nx-kit-loop" />
      </span>
    </span>
  );
});
