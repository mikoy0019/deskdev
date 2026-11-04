import type { ChangeEvent, ReactNode } from 'react';
import { CheckIcon } from '@phosphor-icons/react';

/**
 * A consent tick box: the whole row is the label, at least 44px tall, so the
 * 20px box is never the only target. The native checkbox stays in the DOM
 * (required, focusable, announced); only its face is drawn here.
 */
export function ConsentCheck({
  id,
  name,
  checked,
  onChange,
  invalid = false,
  describedBy,
  required = false,
  children,
  className = '',
}: {
  id: string;
  name: string;
  checked: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-11 cursor-pointer touch-manipulation items-start gap-3 py-2.5 [-webkit-tap-highlight-color:transparent] ${className}`}
    >
      <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
        <input
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          required={required}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className="peer absolute inset-0 size-5 cursor-pointer appearance-none rounded-[6px] border border-line-2 bg-surface outline-none [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease] checked:border-accent checked:bg-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_38%,transparent)] aria-[invalid=true]:border-danger [@media(hover:hover)_and_(pointer:fine)]:hover:border-fg-3 [@media(hover:hover)_and_(pointer:fine)]:checked:hover:border-accent"
        />
        <CheckIcon
          size={13}
          weight="bold"
          aria-hidden
          className="pointer-events-none relative text-[var(--accent-fg)] opacity-0 transition-opacity duration-150 ease-out peer-checked:opacity-100"
        />
      </span>
      <span className="text-[0.875rem] leading-[1.45] text-fg-2">{children}</span>
    </label>
  );
}
