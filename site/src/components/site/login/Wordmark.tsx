import Link from 'next/link';

/**
 * "NIXGEN. | TEAM WORKSPACE" lockup.
 *  - tone="photo": fixed white ink for the dark photo panel (both themes).
 *  - tone="theme": follows the site theme (form side, phones).
 *  - compact: drops the "Team workspace" label below `sm`.
 */
export function Wordmark({ tone = 'theme', compact = false }: { tone?: 'photo' | 'theme'; compact?: boolean }) {
  const photo = tone === 'photo';
  const label = compact ? 'hidden sm:flex' : 'flex';
  return (
    <Link href="/" className="inline-flex min-h-11 items-center gap-4" aria-label="NixGen — home">
      <span className={`font-heading text-[1.1rem] font-semibold tracking-[0.14em] ${photo ? 'text-white' : 'text-fg'}`}>
        NIXGEN.
      </span>
      <span className={`${label} items-center gap-4`}>
        <span className={`h-5 w-px ${photo ? 'bg-white/30' : 'bg-line-2'}`} aria-hidden />
        <span className={`font-mono text-[0.6875rem] font-medium tracking-[0.18em] ${photo ? 'text-white/75' : 'text-fg-3'}`}>
          TEAM WORKSPACE
        </span>
      </span>
    </Link>
  );
}
