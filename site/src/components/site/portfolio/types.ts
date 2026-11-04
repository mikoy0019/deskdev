import type { MockupVariant } from './AppMockup';

/** One in-house product on /portfolio. Built from the showcase by `toProduct` (lib/showcase.ts). */
export interface Product {
  name: string;
  category: string;
  blurb: string;
  /** Brand colour of the product (swatch + mockup tint). */
  accent: string;
  variant: MockupVariant;
  url: string;
  /** Local screenshot (/products/*.png), a stored upload (https) or a remote mShots capture. */
  image: string | null;
  /** `<640w url> 640w, <1280w url> 1280w` when both stored sizes exist. */
  imageSrcSet?: string | null;
  imageAlt?: string;
  /** Bare host for display; kept when the link itself is private (`url` is then ''). */
  host?: string | null;
  /** `/portfolio/<slug>` when the product has a case study. */
  detailHref?: string | null;
  /** Do not show `image` although it is set (e.g. the capture is only the
   *  sign-in screen): the product gets the monogram plate. The file stays in
   *  /public for when it's replaced. */
  preferMockup?: boolean;
  stack: string[];
  live: boolean;
}

/** One live client site. */
export interface ClientSite {
  url: string;
  name: string;
  category: string;
  /** True when the auto-captured screenshot is known to be broken (shows an error page). */
  noShot?: boolean;
  /** The live site. Left out: `https://<url>`. null: the link is private, so the card is not a link. */
  href?: string | null;
  imageAlt?: string;
  /** `/portfolio/<slug>` when the site has a case study. */
  detailHref?: string | null;
}

/** Only screenshots we host ourselves are reliable; remote mShots captures of
 *  the product apps can come back as a 404 page, so those get the monogram plate. */
export function isLocalImage(image: string | null): image is string {
  return !!image && image.startsWith('/');
}

const MSHOTS = 'https://s.wordpress.com/mshots/';

/** A screenshot we host: a /public file or a stored upload. Never an mShots capture (see isLocalImage). */
export function isHostedImage(image: string | null): image is string {
  if (!image) return false;
  return image.startsWith('/') || (image.startsWith('https://') && !image.startsWith(MSHOTS));
}

/** The capture we host for a product, or null: it then gets the monogram plate, never browser chrome around a stand-in. */
export function hostedShot(p: Pick<Product, 'image' | 'preferMockup'>): string | null {
  return !p.preferMockup && isHostedImage(p.image) ? p.image : null;
}

/** A remote mShots capture: it can be asked for at any size, so a taller box never has to crop it sideways. */
export function isMshots(src: string) {
  return src.startsWith(MSHOTS);
}

/** An mShots capture at 1280x720 (the case-study hero); any other image is returned as is. */
export function featureShot(src: string) {
  return isMshots(src) ? src.replace(/\?w=\d+&h=\d+$/, '?w=1280&h=720') : src;
}

/**
 * The lead card's capture: the same 1280 wide page, 960 tall (4:3). From lg the
 * lead image sits in a box of about 3:2 (see ClientCard), always wider than
 * 4:3, so the capture shows a little more of the page than the 16:9 cards and
 * only ever loses its bottom edge.
 */
export function leadShot(src: string) {
  return isMshots(src) ? src.replace(/\?w=\d+&h=\d+$/, '?w=1280&h=960') : src;
}

/**
 * /public/products captures that also ship as WebP at 800 and 1600 wide
 * (<name>-800.webp and <name>-1600.webp beside the PNG, about a tenth of its
 * weight). Add a name here when its two files are added.
 */
const WEBP_SHOTS: readonly string[] = ['inbox-ai', 'invoice-chase', 'stock-sense'];

/** `srcset` of the WebP files for a local product capture, or null when it has none. */
export function localShotSet(image: string): string | null {
  const name = /^\/products\/([a-z0-9-]+)\.png$/.exec(image)?.[1];
  return name && WEBP_SHOTS.includes(name) ? `/products/${name}-800.webp 800w, /products/${name}-1600.webp 1600w` : null;
}

/**
 * A product's brand colour with its chroma pulled back toward a neutral grey
 * of the same weight (oklab mix: hue is kept exactly, saturation drops about
 * a quarter). The products keep their identity as swatches and mockup tints,
 * but none of them competes with the site's one cobalt accent.
 */
export function calm(color: string) {
  return `color-mix(in oklab, ${color} 74%, oklch(0.64 0 0))`;
}

/** "https://supernova-dashboard.vercel.app" → "supernova-dashboard.vercel.app" */
export function hostOf(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** "Four States Concrete" → "FS" */
export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** id of the page's one hidden "opens in a new tab" note; every external link
 *  points aria-describedby at it, so the heading outline stays clean. */
export const NEW_TAB_NOTE_ID = 'portfolio-new-tab-note';

export const pad2 = (n: number) => String(n).padStart(2, '0');
