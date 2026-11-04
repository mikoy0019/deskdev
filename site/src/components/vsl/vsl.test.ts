import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VSL_CHAPTERS, VSL_DURATION } from './chapters';
import {
  chapterEnd,
  chapterIndexAt,
  chapterMarks,
  chapterProgress,
  clamp,
  formatTime,
  keyAction,
  percentOf,
  seekTarget,
  seekValueText,
  spokenTime,
  type VslChapter,
} from './vslLogic';

const CH: VslChapter[] = [
  { id: 'a', title: 'Intro', start: 0 },
  { id: 'b', title: 'Middle', start: 30 },
  { id: 'c', title: 'End', start: 90 },
];

/* The player shows public/vsl/poster.webp, a 1280px WebP copy of the poster.jpg
   that video/scripts/export-site.mjs writes. Nothing remakes the copy on an
   export, so this pins the JPEG it was made from: a new poster fails here until
   the copy is remade (from site/) and the hash below is updated:
     node -e "require('sharp')('public/vsl/poster.jpg').resize({width:1280}).webp({quality:80,effort:6}).toFile('public/vsl/poster.webp')" */
const POSTER_SOURCE_SHA256 = 'b919963b6b83559e8d3ebfd588d9436a3f1df7203c1debcc7a92f562157df62c';
const publicVsl = (name: string) => fileURLToPath(new URL(`../../../public/vsl/${name}`, import.meta.url));

describe('poster', () => {
  it('poster.webp was made from the current poster.jpg', () => {
    const jpg = publicVsl('poster.jpg');
    if (!existsSync(jpg)) return; // a checkout without the exported film has nothing to compare
    expect(existsSync(publicVsl('poster.webp'))).toBe(true);
    expect(createHash('sha256').update(readFileSync(jpg)).digest('hex')).toBe(POSTER_SOURCE_SHA256);
  });
});

describe('generated chapters', () => {
  it('start at 0, are sorted and fit inside the film', () => {
    expect(VSL_CHAPTERS.length).toBeGreaterThan(0);
    expect(VSL_CHAPTERS[0].start).toBe(0);
    for (let i = 1; i < VSL_CHAPTERS.length; i++) {
      expect(VSL_CHAPTERS[i].start).toBeGreaterThan(VSL_CHAPTERS[i - 1].start);
    }
    expect(VSL_CHAPTERS[VSL_CHAPTERS.length - 1].start).toBeLessThan(VSL_DURATION);
    expect(new Set(VSL_CHAPTERS.map((c) => c.id)).size).toBe(VSL_CHAPTERS.length);
  });
});

describe('clamp', () => {
  it('bounds a value and maps NaN to the minimum', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(NaN, 2, 10)).toBe(2);
  });
});

describe('formatTime', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9.9)).toBe('0:09');
    expect(formatTime(65.07)).toBe('1:05');
    expect(formatTime(181.5)).toBe('3:01');
    expect(formatTime(3725)).toBe('1:02:05');
  });
  it('reads bad input as 0:00', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-4)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
  });
});

describe('spokenTime', () => {
  it('spells minutes and seconds with the right plurals', () => {
    expect(spokenTime(0)).toBe('0 seconds');
    expect(spokenTime(1)).toBe('1 second');
    expect(spokenTime(60)).toBe('1 minute');
    expect(spokenTime(61)).toBe('1 minute 1 second');
    expect(spokenTime(181.5)).toBe('3 minutes 1 second');
  });
});

describe('chapterIndexAt', () => {
  it('finds the chapter playing at a time', () => {
    expect(chapterIndexAt(CH, 0)).toBe(0);
    expect(chapterIndexAt(CH, 29.9)).toBe(0);
    expect(chapterIndexAt(CH, 30)).toBe(1);
    expect(chapterIndexAt(CH, 89)).toBe(1);
    expect(chapterIndexAt(CH, 500)).toBe(2);
  });
  it('counts a seek that lands just short of a boundary as the new chapter', () => {
    expect(chapterIndexAt(CH, 29.97)).toBe(1);
  });
  it('returns -1 with no chapters and 0 before the first', () => {
    expect(chapterIndexAt([], 10)).toBe(-1);
    expect(chapterIndexAt(CH, -3)).toBe(0);
  });
  it('matches the generated chapter list', () => {
    const leaks = VSL_CHAPTERS.findIndex((c) => c.id === 'leaks');
    expect(chapterIndexAt(VSL_CHAPTERS, VSL_CHAPTERS[leaks].start)).toBe(leaks);
    expect(chapterIndexAt(VSL_CHAPTERS, VSL_DURATION)).toBe(VSL_CHAPTERS.length - 1);
  });
});

describe('chapterEnd / chapterProgress', () => {
  it('ends a chapter at the next start, the last at the film end', () => {
    expect(chapterEnd(CH, 0, 120)).toBe(30);
    expect(chapterEnd(CH, 2, 120)).toBe(120);
  });
  it('reports progress through a chapter as 0..1', () => {
    expect(chapterProgress(CH, 1, 0, 120)).toBe(0);
    expect(chapterProgress(CH, 1, 60, 120)).toBe(0.5);
    expect(chapterProgress(CH, 1, 100, 120)).toBe(1);
    expect(chapterProgress(CH, 2, 105, 120)).toBe(0.5);
    expect(chapterProgress(CH, 9, 10, 120)).toBe(0);
  });
  it('handles a duration shorter than the last start', () => {
    expect(chapterProgress(CH, 2, 95, 0)).toBe(1);
    expect(chapterProgress(CH, 2, 80, 0)).toBe(0);
  });
});

describe('chapterMarks / percentOf', () => {
  it('places ticks for every chapter after the first', () => {
    expect(chapterMarks(CH, 120)).toEqual([25, 75]);
    expect(chapterMarks(CH, 0)).toEqual([]);
    expect(chapterMarks(CH, 60)).toEqual([50]);
  });
  it('turns a time into a clamped percentage', () => {
    expect(percentOf(30, 120)).toBe(25);
    expect(percentOf(200, 120)).toBe(100);
    expect(percentOf(10, 0)).toBe(0);
  });
});

describe('seekValueText', () => {
  it('describes the position for the slider', () => {
    expect(seekValueText(65, 181.5, CH[1])).toBe('1 minute 5 seconds of 3 minutes 1 second, Middle');
    expect(seekValueText(0, 60)).toBe('0 seconds of 1 minute');
  });
});

describe('seekTarget', () => {
  it('clamps to the film and stops short of the last frame', () => {
    expect(seekTarget(10, -15, 120)).toBe(0);
    expect(seekTarget(10, 5, 120)).toBe(15);
    expect(seekTarget(118, 10, 120)).toBeCloseTo(119.9);
    expect(seekTarget(5, 5, 0)).toBe(0);
  });
});

describe('keyAction', () => {
  it('toggles on Space (not on a button, where Space is a native click) and on K', () => {
    expect(keyAction({ key: ' ' }, 'other')).toEqual({ type: 'toggle' });
    expect(keyAction({ key: ' ' }, 'slider')).toEqual({ type: 'toggle' });
    expect(keyAction({ key: ' ' }, 'button')).toBeNull();
    expect(keyAction({ key: 'Enter' }, 'button')).toBeNull();
    expect(keyAction({ key: 'k' }, 'button')).toEqual({ type: 'toggle' });
    expect(keyAction({ key: 'K' }, 'other')).toEqual({ type: 'toggle' });
  });
  it('seeks with the arrows, J and L', () => {
    expect(keyAction({ key: 'ArrowLeft' }, 'button')).toEqual({ type: 'seekBy', seconds: -5 });
    expect(keyAction({ key: 'ArrowRight' }, 'slider')).toEqual({ type: 'seekBy', seconds: 5 });
    expect(keyAction({ key: 'j' }, 'other')).toEqual({ type: 'seekBy', seconds: -10 });
    expect(keyAction({ key: 'L' }, 'other')).toEqual({ type: 'seekBy', seconds: 10 });
  });
  it('keeps Up / Down / Home / End for the page unless the slider has focus', () => {
    expect(keyAction({ key: 'ArrowUp' }, 'button')).toBeNull();
    expect(keyAction({ key: 'ArrowDown' }, 'other')).toBeNull();
    expect(keyAction({ key: 'Home' }, 'button')).toBeNull();
    expect(keyAction({ key: 'ArrowUp' }, 'slider')).toEqual({ type: 'seekBy', seconds: 5 });
    expect(keyAction({ key: 'ArrowDown' }, 'slider')).toEqual({ type: 'seekBy', seconds: -5 });
    expect(keyAction({ key: 'Home' }, 'slider')).toEqual({ type: 'seekTo', to: 'start' });
    expect(keyAction({ key: 'End' }, 'slider')).toEqual({ type: 'seekTo', to: 'end' });
  });
  it('mutes on M and goes full screen on F', () => {
    expect(keyAction({ key: 'm' }, 'button')).toEqual({ type: 'mute' });
    expect(keyAction({ key: 'F' }, 'other')).toEqual({ type: 'fullscreen' });
  });
  it('leaves modified keys and everything else alone', () => {
    expect(keyAction({ key: 'f', ctrlKey: true }, 'other')).toBeNull();
    expect(keyAction({ key: 'l', metaKey: true }, 'other')).toBeNull();
    expect(keyAction({ key: 'ArrowLeft', altKey: true }, 'other')).toBeNull();
    expect(keyAction({ key: 'Tab' }, 'button')).toBeNull();
    expect(keyAction({ key: 'x' }, 'other')).toBeNull();
  });
});
