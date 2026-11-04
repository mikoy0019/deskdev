import { PlusIcon } from '@phosphor-icons/react/ssr';
import { Accent } from '@/components/site/Typography';
import { Bezel } from './Bezel';
import { OrbitMark } from './OrbitMark';

/**
 * Typographic "studio card" for the team section, set in a double bezel: the
 * orbital mark over a masked grid, then the studio's name, discipline,
 * one-line pitch and focus tags.
 */
export function StudioPanel({
  title,
  discipline,
  body,
  tags,
}: {
  title: string;
  discipline: string;
  body: string;
  tags: string[];
}) {
  const [lead, last] = (() => {
    const i = title.lastIndexOf(' ');
    return i < 0 ? ['', title] : [title.slice(0, i), title.slice(i + 1)];
  })();

  return (
    <Bezel innerClassName="p-7 sm:p-10">
      <div className="nx-grid-bg pointer-events-none absolute inset-0 -z-10 opacity-80" aria-hidden />

      {/* Meta row */}
      <div className="flex items-center justify-between gap-6">
        <p className="nx-eyebrow">{discipline}</p>
        <PlusIcon size={14} aria-hidden className="shrink-0 text-fg-3" />
      </div>

      <div className="my-10 sm:my-12">
        <OrbitMark />
      </div>

      <h3 className="nx-h2 text-[clamp(2.5rem,4.4vw,3.75rem)]">
        {lead && <>{lead} </>}
        <Accent>{last}</Accent>
      </h3>
      <p className="nx-body mt-5 max-w-[34rem]">{body}</p>

      <ul className="mt-8 flex flex-wrap gap-2 border-t border-line pt-6">
        {tags.map((t) => (
          <li key={t} className="nx-tag">
            {t}
          </li>
        ))}
      </ul>
    </Bezel>
  );
}
