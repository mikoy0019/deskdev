import { NOSCRIPT_CSS } from './presets';

/**
 * No-JavaScript fail-safe for the motion kit. Render it once in the <head> of
 * the (site) layout (server component, no client code).
 *
 * Kit entrances carry their hidden frame as an inline style in the server
 * HTML. Without JavaScript nothing would ever animate them in, so this
 * <noscript> style shows every one of them at once. (nx.css adds the same
 * rule under `@media (scripting: none)` and for print, plus a 3s timed
 * fallback for JavaScript that fails or arrives late.)
 */
export function MotionNoScript() {
  return <noscript dangerouslySetInnerHTML={{ __html: `<style>${NOSCRIPT_CSS}</style>` }} />;
}
