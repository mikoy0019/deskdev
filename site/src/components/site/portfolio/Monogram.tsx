import styles from './portfolio.module.css';
import { initialsOf, type ClientSite } from './types';

/**
 * Accent-soft plate with the site's initials: the fallback "screenshot" for
 * sites without a usable capture. `quiet` is the faint outline version that
 * sits behind a capture while it loads.
 */
export function Monogram({ site, quiet = false }: { site: ClientSite; quiet?: boolean }) {
  return (
    <div
      aria-hidden
      className="absolute inset-0 grid place-items-center"
      style={
        quiet
          ? undefined
          : {
              background:
                'radial-gradient(120% 90% at 100% 0%, var(--accent-soft), transparent 60%), radial-gradient(90% 80% at 0% 100%, color-mix(in oklab, var(--accent-2) 10%, transparent), transparent 65%), var(--surface)',
            }
      }
    >
      {!quiet && <div className="nx-grid-bg pointer-events-none absolute inset-0 opacity-60" />}
      <div className={`relative flex flex-col items-center gap-3 text-center ${styles.thumbMono}`}>
        <span
          className="nx-numeral text-[clamp(2.25rem,9vw,4.5rem)] text-transparent"
          style={{ WebkitTextStroke: quiet ? '1px color-mix(in oklab, var(--fg-3) 45%, transparent)' : '1.25px var(--accent-text)' }}
        >
          {initialsOf(site.name)}
        </span>
        {!quiet && <span className="nx-mono hidden text-[0.75rem] text-fg-2 sm:block">{site.url}</span>}
      </div>
    </div>
  );
}
