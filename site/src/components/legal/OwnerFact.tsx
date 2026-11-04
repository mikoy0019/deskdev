import { OWNER_FACTS, placeholderText, type OwnerFact as OwnerFactKey } from './facts';

/**
 * A fact only the owner can supply (PLAN Q9): the value once facts.ts has it,
 * otherwise a marked placeholder that cannot be mistaken for real text —
 * dashed accent outline, mono, and `data-owner-placeholder` so a check can
 * find any that reach production.
 */
export function OwnerFact({ fact }: { fact: OwnerFactKey }) {
  const value = OWNER_FACTS[fact]?.trim();
  if (value) return <>{value}</>;
  return (
    <mark
      data-owner-placeholder={fact}
      className="rounded-[0.35rem] border border-dashed border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-accent-soft px-1.5 py-px font-mono text-[0.85em] tracking-normal text-accent-text [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
    >
      {placeholderText(fact)}
    </mark>
  );
}
