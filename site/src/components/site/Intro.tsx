import { Fragment, isValidElement, type CSSProperties, type ReactNode } from 'react';
import { flattenTitle } from './Typography';
import { splitWords } from './motion/split';

/**
 * Page intro: the entrance of a hero, as plain CSS (nx.css `.nx-intro*`).
 *
 * The copy is in the server HTML and starts moving on first paint. Nothing
 * here waits for JavaScript, so the headline (the page's largest paint) is on
 * screen as soon as the stylesheet is, on a slow phone too. The motion kit's
 * load-triggered Stagger hid the same copy until hydration.
 *
 * Same sequence as the Home hero: eyebrow, the headline word by word 50ms
 * apart, then the pieces after it 60ms apart from the headline's last word.
 * No piece waits more than 0.6s. Reduced motion: nothing moves or waits.
 */
export const INTRO = { words: 80, word: 50, step: 60, cap: 600 } as const;

/** `--d`, the delay of one intro piece (ms, capped). Use with `nx-intro`, `nx-intro-word` or `nx-intro-fade`. */
export const introDelay = (ms: number) => ({ '--d': `${Math.min(Math.max(0, ms), INTRO.cap)}ms` }) as CSSProperties;

/**
 * A headline's words, each rising out of its own line mask. The words stay
 * real text with real spaces (screen readers, find-in-page and copy get the
 * sentence once); an inline element such as an accent <em> rises as one unit
 * and <br /> passes through.
 *
 * Returns the nodes for the heading and `after`: the delay for the first
 * piece that follows it (it starts with the headline's last word). Add
 * `INTRO.step` for each further piece.
 */
export function introHeadline(title: ReactNode): { words: ReactNode[]; after: number } {
  let n = 0;
  const word = (content: ReactNode, key: string) => (
    <span key={key} className="nx-kit-word-mask">
      <span className="nx-intro-word" style={introDelay(INTRO.words + n++ * INTRO.word)}>
        {content}
      </span>
    </span>
  );
  const words = flattenTitle(title).map((child, ci) => {
    if (typeof child === 'string' || typeof child === 'number') {
      return (
        <Fragment key={`t${ci}`}>
          {splitWords(String(child)).map((token, ti) => (token.type === 'space' ? token.text : word(token.text, `w${ci}-${ti}`)))}
        </Fragment>
      );
    }
    if (isValidElement(child) && child.type === 'br') return child;
    return word(child, `e${ci}`);
  });
  // Room for two more pieces after this one inside the cap.
  const after = Math.min(INTRO.words + Math.max(0, n - 1) * INTRO.word, INTRO.cap - 2 * INTRO.step);
  return { words, after };
}
