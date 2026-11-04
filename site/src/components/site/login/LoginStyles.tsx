import type { CSSProperties } from 'react';
import { STAGGER } from '@/components/site/motion/presets';

/*
 * CSS for the login card and its controls. Rendered once by login/layout.tsx.
 *
 * Card entrance. The card sits inside a Suspense boundary that hydrates after the root, so its
 * first-load entrance is a CSS animation, not a motion-kit component:
 * - it starts on first paint and needs no JavaScript;
 * - it runs off the main thread while the page is still loading;
 * - the server and client render the same thing.
 * Emil's gate: a rare, first-visit entrance whose purpose is to stop the heading block popping in.
 * Each step rises 16px and fades in, var(--dur-reveal) on var(--ease-out), STAGGER.each (60ms)
 * apart. Form fields never animate, because people start typing (or autofill) straight away.
 * Reduced motion keeps a short fade and drops the movement.
 *
 * Controls (text actions and the password toggle):
 * - press: scale 0.97 on :active, var(--dur-press) on var(--ease-out) (kept under reduced motion,
 *   like the kit's PressScale: it is feedback in place, not travel);
 * - colour changes use `ease`;
 * - no tap flash, no double-tap-zoom delay and no long-press text selection.
 * Hover colour only applies with a mouse or trackpad.
 *
 * Text links keep .nx-link's underline draw, re-anchored under the text (.nx-login-link): the
 * links are 44px tall for touch, so the box's bottom edge sits well below the words.
 *
 * Submit / island CTA: the nested arrow disc nudges 2px toward where you are going, mouse or
 * trackpad only.
 *
 * Inline error: settles in from 4px above with a fade (200ms, ease-out) when it mounts, via
 * @starting-style, so a failed attempt reads as a response rather than a layout jump. A retry that
 * fails again remounts it and the cue repeats. Reduced motion keeps the fade only.
 *
 * Photo plate: always dark (both themes). Its ink and scrim come from the page's own off-black
 * (--bg in the dark theme, #06080d) and the dark theme's --accent-text (#8aa8f0, HSL saturation
 * 77%, 8.5:1 on the plate) for the few accented marks, so there is no second accent, nothing over
 * 80% saturation and no coloured wash. Literal values, not var(--accent-text), because the plate
 * stays dark when the page is light.
 */
const CSS = `
@keyframes nx-login-rise { from { opacity: 0; transform: translate3d(0, 16px, 0); } }
@keyframes nx-login-fade { from { opacity: 0; } }
.nx-login-rise {
  animation: nx-login-rise var(--dur-reveal) var(--ease-out) both;
  animation-delay: var(--nx-rise-delay, 0s);
}
.nx-login-tap {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  /* background-size keeps .nx-link's underline draw (this rule replaces its transition list). */
  transition: color 200ms ease, background-color 200ms ease, background-size 400ms var(--ease-out),
    scale var(--dur-press) var(--ease-out);
}
.nx-login-tap:active { scale: 0.97; }
/* .nx-link draws its underline at the bottom of the box; these links are 44px tall for touch, so
   pin the line just under the text instead of 12px below it. */
.nx-login-link { background-position: 0 calc(50% + 0.75em); }
.nx-login-alert {
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
  @starting-style { opacity: 0; transform: translate3d(0, -4px, 0); }
}
.nx-login-plate { --plate-ink: #8aa8f0; background-color: #06080d; }
.nx-login-scrim {
  background: linear-gradient(180deg, rgb(6 8 13 / 0.7) 0%, rgb(6 8 13 / 0.12) 22%, rgb(6 8 13 / 0.62) 44%,
    rgb(6 8 13 / 0.9) 62%, rgb(6 8 13 / 0.97) 100%);
}
.nx-login-cta-disc { transition: transform 200ms var(--ease-out), background-color 200ms ease; }
@media (hover: hover) and (pointer: fine) {
  .nx-login-cta:hover .nx-login-cta-disc { transform: translate3d(2px, 0, 0); background-color: rgb(255 255 255 / 0.22); }
}
@media (prefers-reduced-motion: reduce) {
  .nx-login-rise { animation-name: nx-login-fade; animation-duration: 300ms; animation-delay: 0s; }
  .nx-login-alert { transition: opacity 200ms ease; @starting-style { opacity: 0; transform: none; } }
  .nx-login-cta:hover .nx-login-cta-disc { transform: none; }
}`;

export function LoginStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}

/** One step of the card entrance; pair with `style={riseStep(n)}`. */
export const RISE = 'nx-login-rise';

/** Press + tap hygiene for the card's small controls (they own their colour transition). */
export const LOGIN_TAP = 'nx-login-tap';

/** The `n`th step of the entrance, STAGGER.each apart. */
export function riseStep(n: number): CSSProperties {
  return { ['--nx-rise-delay' as string]: `${(n * STAGGER.each).toFixed(2)}s` };
}
