/* Pure helpers for the homepage video player (VslPlayer). No DOM, no React:
   everything here is unit-tested in vsl.test.ts. */

export interface VslChapter {
  id: string;
  title: string;
  /** Seconds from the start of the film. */
  start: number;
}

/** A chapter jump lands a hair before or after a boundary; treat that as inside the new chapter. */
const BOUNDARY_SLOP = 0.05;

/** Seconds a short seek (arrow keys) moves. */
export const SEEK_STEP = 5;
/** Seconds a long seek (J / L) moves. */
export const SEEK_STEP_LONG = 10;

export function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

const safe = (s: number) => (Number.isFinite(s) && s > 0 ? s : 0);

/** 0 -> "0:00", 65.07 -> "1:05", 3725 -> "1:02:05". Bad input reads as 0:00. */
export function formatTime(seconds: number) {
  const total = Math.floor(safe(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Screen-reader form of a time: 65 -> "1 minute 5 seconds", 0 -> "0 seconds". */
export function spokenTime(seconds: number) {
  const total = Math.floor(safe(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  if (s > 0 || m === 0) parts.push(`${s} ${s === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

/** Index of the chapter playing at `time` (chapters sorted by start), or -1 when there are none. */
export function chapterIndexAt(chapters: readonly VslChapter[], time: number) {
  let index = chapters.length ? 0 : -1;
  for (let i = 0; i < chapters.length; i++) {
    if (time + BOUNDARY_SLOP >= chapters[i].start) index = i;
    else break;
  }
  return index;
}

/** Where chapter `i` ends: the next chapter's start, or the end of the film. */
export function chapterEnd(chapters: readonly VslChapter[], i: number, duration: number) {
  return chapters[i + 1]?.start ?? Math.max(duration, chapters[i]?.start ?? 0);
}

/** How far through chapter `i` playback is, 0..1. */
export function chapterProgress(chapters: readonly VslChapter[], i: number, time: number, duration: number) {
  const chapter = chapters[i];
  if (!chapter) return 0;
  const end = chapterEnd(chapters, i, duration);
  const length = end - chapter.start;
  if (length <= 0) return time >= end ? 1 : 0;
  return clamp((time - chapter.start) / length, 0, 1);
}

/** Chapter boundaries as percentages of the film, for tick marks on the seek bar (the 0% start is left out). */
export function chapterMarks(chapters: readonly VslChapter[], duration: number) {
  if (!(duration > 0)) return [];
  return chapters
    .filter((c) => c.start > 0 && c.start < duration)
    .map((c) => (c.start / duration) * 100);
}

/** Share of the film played, 0..100. */
export function percentOf(time: number, duration: number) {
  return duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0;
}

/** aria-valuetext for the seek slider: "1 minute 5 seconds of 3 minutes 1 second, What we build". */
export function seekValueText(time: number, duration: number, chapter?: VslChapter) {
  const base = `${spokenTime(time)} of ${spokenTime(duration)}`;
  return chapter ? `${base}, ${chapter.title}` : base;
}

export type VslAction =
  | { type: 'toggle' }
  | { type: 'seekBy'; seconds: number }
  | { type: 'seekTo'; to: 'start' | 'end' }
  | { type: 'mute' }
  | { type: 'fullscreen' };

/** What kind of control has focus when a key is pressed inside the player. */
export type VslKeyTarget = 'button' | 'slider' | 'other';

export interface VslKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * Maps a keydown inside the player to a player action, or null to leave the
 * key alone (so the browser and assistive tech keep their defaults).
 * - Space / K: play or pause. On a button, Space and Enter stay native clicks.
 * - Left / Right: back / forward 5 s. On the seek slider Up / Down do the same,
 *   and Home / End jump to the start / end.
 * - J / L: back / forward 10 s.  M: mute.  F: full screen.
 */
export function keyAction(e: VslKey, target: VslKeyTarget): VslAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (key) {
    case ' ':
    case 'Spacebar':
      return target === 'button' ? null : { type: 'toggle' };
    case 'k':
      return { type: 'toggle' };
    case 'ArrowLeft':
      return { type: 'seekBy', seconds: -SEEK_STEP };
    case 'ArrowRight':
      return { type: 'seekBy', seconds: SEEK_STEP };
    case 'ArrowDown':
      return target === 'slider' ? { type: 'seekBy', seconds: -SEEK_STEP } : null;
    case 'ArrowUp':
      return target === 'slider' ? { type: 'seekBy', seconds: SEEK_STEP } : null;
    case 'Home':
      return target === 'slider' ? { type: 'seekTo', to: 'start' } : null;
    case 'End':
      return target === 'slider' ? { type: 'seekTo', to: 'end' } : null;
    case 'j':
      return { type: 'seekBy', seconds: -SEEK_STEP_LONG };
    case 'l':
      return { type: 'seekBy', seconds: SEEK_STEP_LONG };
    case 'm':
      return { type: 'mute' };
    case 'f':
      return { type: 'fullscreen' };
    default:
      return null;
  }
}

/** Where a seek lands: clamped to the film, and never on the very last frame (that would end it at once). */
export function seekTarget(current: number, by: number, duration: number) {
  return clamp(current + by, 0, Math.max(0, duration - 0.1));
}
