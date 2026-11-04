/** Shapes for the /about page. The data itself lives in the page file. */

export interface AboutSection {
  /** Display index, e.g. "01". */
  id: string;
  /** Section id used for in-page jump links. */
  anchor: string;
  label: string;
}

export interface Principle {
  n: string;
  /** "X over Y" — rendered with the second half muted. */
  title: string;
  body: string;
}

/** Which illustration a value tile shows (ValueVisuals.tsx). */
export type ValueVisual = 'craft' | 'scorecard' | 'compound' | 'sprint';

export interface Value {
  title: string;
  body: string;
  visual: ValueVisual;
}

export interface Milestone {
  year: string;
  title: string;
  body: string;
}

export interface StackGroup {
  label: string;
  items: string[];
}

/** "Editorial over Templated" → ["Editorial", "Templated"]; null if there's no " over ". */
export function splitOver(title: string): [string, string] | null {
  const i = title.indexOf(' over ');
  return i < 0 ? null : [title.slice(0, i), title.slice(i + 6)];
}

/** Outlined numeral stroke — the shared .nx-numeral-outline treatment (same as /services and Home). */
export const outlineClass = 'nx-numeral-outline';

/**
 * Outlined stroke for numerals that carry content (the timeline years): firm
 * enough for the 3:1 large-text contrast floor on both themes.
 */
export const outlineStrongClass =
  'text-transparent [-webkit-text-stroke:1px_color-mix(in_oklab,var(--fg)_46%,transparent)] light:[-webkit-text-stroke-color:color-mix(in_oklab,var(--fg)_58%,transparent)]';
