/**
 * The motion mode, read at the moment an entrance starts.
 *
 * Why not just the hooks: usePrefersReducedMotion() is hydration-safe, so it
 * is `false` on the first client render — exactly the render a load-triggered
 * entrance (page heroes) starts from. Deciding "reduced" there ran the full
 * movement for people who asked for less. The kit's variants are functions,
 * resolved by framer when the animation starts (in an effect, where
 * matchMedia exists), and they call liveMotionMode() then.
 *
 * Pure apart from the `env` it is handed, so it is unit-tested.
 */
import { FAILSAFE_MS, QUERY } from './presets';

export type MotionMode = { reduced: boolean; instant: boolean };

export type MotionEnv = {
  matchMedia?: (query: string) => { matches: boolean };
  document?: { documentElement: { getAttribute(name: string): string | null } };
  performance?: { now(): number };
};

const browserEnv = (): MotionEnv | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as MotionEnv));

/**
 * `hint` is what the hooks/context already know (true once they have caught
 * up); the live read can only add to it, never switch a mode off.
 * - reduced: prefers-reduced-motion matches right now.
 * - instant: the provider marked a late hydration, or has not marked anything
 *   yet and the CSS fail-safe window has already passed (children's effects
 *   run before the provider's, so the attribute is not there on first load).
 */
export function liveMotionMode(hint: Partial<MotionMode> = {}, env: MotionEnv | null | undefined = browserEnv()): MotionMode {
  let reduced = hint.reduced === true;
  let instant = hint.instant === true;
  if (!env) return { reduced, instant };
  try {
    if (!reduced && env.matchMedia) reduced = env.matchMedia(QUERY.reducedMotion).matches === true;
  } catch {
    // matchMedia unavailable: keep the hint.
  }
  if (!instant) {
    const mark = env.document?.documentElement.getAttribute('data-nx-motion') ?? null;
    if (mark === 'late') instant = true;
    else if (mark === null && env.performance) instant = env.performance.now() > FAILSAFE_MS;
  }
  return { reduced, instant };
}
