/**
 * Moves focus to the page's <main> landmark, the way a skip link and a route
 * change both need it: focusable only while it holds focus (so it never
 * becomes a Tab stop), with no ring around the whole page. The next Tab lands
 * on the page's first control.
 *
 * Returns false when there is no <main> or it already contains the focus
 * (a page that focuses its own field on arrival keeps it).
 */
export function focusMain({ preventScroll = false, keepInner = false } = {}): boolean {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return false;
  if (keepInner && main.contains(document.activeElement)) return false;
  main.setAttribute('tabindex', '-1');
  main.style.outline = 'none';
  main.addEventListener(
    'blur',
    () => {
      main.removeAttribute('tabindex');
      main.style.removeProperty('outline');
    },
    { once: true },
  );
  main.focus({ preventScroll });
  return true;
}
