import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { loadFont as loadGilda } from '@remotion/google-fonts/GildaDisplay';
import { Icon, type IconName } from '../components/Icon';
import { BrowserFrame, Card, Chip, PhoneFrame, Shot } from '../components/Surfaces';
import { Eyebrow, Headline, Reveal } from '../components/Text';
import { CLAMP, EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, FONT, LAYOUT, RADIUS, SHADOW, TYPE } from '../theme';
import { CROSSFADE } from '../timeline';

// 01 Websites: "Websites that win the job." Left: the promise, ticked off word by word.
// Right: the real Shira Salon site on desktop and phone, a visitor booking from it, and
// the salon turning up first when someone searches "salon near me".

/** A theme colour at an alpha, so every tint stays tied to the tokens. */
const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Gentle in-out for long scrolls (EASE.inOut is too steep for a slow page scroll). */
const SOFT = Easing.bezier(0.45, 0, 0.55, 1);

// ---------------------------------------------------------------- layout (px)
// Offer scene: content lives in x 140–1780, y 240–880 (the offer rail sits above).
const COL = { x: LAYOUT.padX, y: 258, w: 520 };
const BROWSER = { x: 762, y: 250, w: 940, h: 560 };
const CHROME = 47; // BrowserFrame toolbar (46) + its hairline
const SITE_W = BROWSER.w - 2; // inside the 1px frame border
const SITE_K = SITE_W / 1280; // capture px → screen px
const SITE_H = 2400 * SITE_K;
/** The site's header band in capture px; it stays pinned (sticky) while the page scrolls. */
const NAV_H = 92 * SITE_K;
/** "Book appointment" button in the desktop capture (px 101–283 × 560–609). */
const BUTTON = { x: 101 * SITE_K, y: 560 * SITE_K, w: 183 * SITE_K, h: 50 * SITE_K };

/** The salon's own typeface, for re-setting the hero copy inside the mock site only. */
const SITE_SERIF = `${loadGilda('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily}, serif`;
/** Hero copy position in capture px (measured from the faded text in the capture). */
const HERO = { x: 102, headTop: 211, headSize: 70, headLine: 73.5, headTrack: '0em', bodyTop: 449, bodySize: 17, bodyLine: 24.5, bodyW: 345 };
/** Mock-site ink colours (inside the BrowserFrame only). */
const SITE_INK = '#1f1a22';
const SITE_GREY = '#5f5a63';
const DEBUG_HERO = false;

/** The phone is laid out at 360×720 and drawn at 0.7 (252×504 on screen). */
const PHONE = { x: 1508, y: 360, w: 360, h: 720, scale: 0.7 };
const SCREEN_W = PHONE.w - 24; // inside the 11px bezel and 1px border
const SCREEN_H = PHONE.h - 24;
const STATUS = 40;
const MOBILE_H = 1600 * (SCREEN_W / 390);
/** Status-bar tint sampled from the top of the mobile capture (mock site content). */
const SALON_TOP = '#b8b0ae';
/** The mobile header band (logo, cart, price list) in screen px; also sticky. */
const MOBILE_NAV = 74 * (SCREEN_W / 390);

/** Bottom edge shared by the two floating cards (they overhang the browser a little). */
const CARD_LEFT = 792;
const CARD_BOTTOM = 846;

// ---------------------------------------------------------------- small parts

const IconTile: React.FC<{ icon: IconName; size: number; tone?: 'accent' | 'neutral' }> = ({ icon, size, tone = 'accent' }) => (
  <div
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: Math.round(size * 0.28),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: tone === 'accent' ? alpha(COLOR.accent, 0.14) : alpha(COLOR.fg, 0.04),
      border: `1px solid ${tone === 'accent' ? alpha(COLOR.accent, 0.45) : COLOR.line2}`,
      color: tone === 'accent' ? COLOR.accentText : COLOR.fg2,
    }}
  >
    <Icon name={icon} size={Math.round(size * 0.5)} />
  </div>
);

const Hairline: React.FC<{ p: number; edge: 'top' | 'bottom' }> = ({ p, edge }) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      ...(edge === 'top' ? { top: 0 } : { bottom: 0 }),
      width: `${p * 100}%`,
      height: 1,
      background: COLOR.line2,
    }}
  />
);

/** Round check that fills accent and draws its tick. `p` may overshoot a touch (spring). */
const Tick: React.FC<{ p: number; draw: number; opacity: number }> = ({ p, draw, opacity }) => (
  <div
    style={{
      width: 38,
      height: 38,
      flexShrink: 0,
      borderRadius: 19,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity,
      background: alpha(COLOR.accent, Math.min(1, Math.max(0, p))),
      border: `1.5px solid ${p > 0.02 ? COLOR.accent : COLOR.line2}`,
      transform: `scale(${mix(0.72, 1, p)})`,
      color: COLOR.accentFg,
    }}
  >
    <div style={{ display: 'flex', clipPath: `inset(0 ${(1 - draw) * 100}% 0 0)` }}>
      <Icon name="check" size={21} stroke={2.6} />
    </div>
  </div>
);

/** One promise in the left column; it slides in just before its word and ticks on it. */
const FeatureRow: React.FC<{ icon: IconName; label: string; at: number; top?: boolean }> = ({ icon, label, at, top }) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, at, 18);
  const line = progress(frame, at - 2, 26, EASE.inOut);
  const tick = springAt(frame, at + 4, { damping: 15, stiffness: 160 });
  const draw = progress(frame, at + 7, 9);
  return (
    <div style={{ position: 'relative', height: 76, display: 'flex', alignItems: 'center', gap: 20 }}>
      {top ? <Hairline p={line} edge="top" /> : null}
      <Hairline p={line} edge="bottom" />
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          opacity: enter,
          transform: `translateX(${(1 - enter) * -18}px)`,
        }}
      >
        <IconTile icon={icon} size={46} tone="neutral" />
        <span style={{ ...TYPE.h4, color: COLOR.fg }}>{label}</span>
      </div>
      <Tick p={tick} draw={draw} opacity={enter} />
    </div>
  );
};

const BLEED = 4;

/** The top strip of a capture pinned in place, like a sticky site header. `lift` 0..1 adds its shadow. */
const StickyBand: React.FC<{ src: string; width: number; imgH: number; height: number; lift: number }> = ({ src, width, imgH, height, lift }) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      // starts a few px above the clip edge so its top edge never shows (no seam with the page under it)
      top: -BLEED,
      width,
      height: height + BLEED,
      overflow: 'hidden',
      // mock site chrome: a soft drop shadow once content scrolls beneath
      boxShadow: `0 1px 0 rgba(31, 26, 34, ${0.08 * lift}), 0 10px 22px -12px rgba(31, 26, 34, ${0.45 * lift})`,
    }}
  >
    <Img src={staticFile(src)} style={{ position: 'absolute', left: 0, top: BLEED, width, height: imgH }} />
  </div>
);

/** The salon's real mobile site, scrolled, under a status bar tinted like the page. */
const MobileSite: React.FC<{ scroll: number }> = ({ scroll }) => (
  <>
    <div style={{ position: 'absolute', left: 0, top: STATUS, width: SCREEN_W, height: SCREEN_H - STATUS, overflow: 'hidden', background: '#fff9f9' }}>
      <Img
        src={staticFile('clients/shira-salon-mobile.jpg')}
        style={{ position: 'absolute', left: 0, top: 0, width: SCREEN_W, height: MOBILE_H, transform: `translateY(${-scroll}px)` }}
      />
      <StickyBand src="clients/shira-salon-mobile.jpg" width={SCREEN_W} imgH={MOBILE_H} height={MOBILE_NAV} lift={Math.min(1, scroll / 30)} />
    </div>
    <div style={{ position: 'absolute', left: 0, top: 0, width: SCREEN_W, height: STATUS + 2, background: SALON_TOP }} />
    <div
      style={{
        position: 'absolute',
        bottom: 9,
        left: '50%',
        width: 124,
        height: 5,
        marginLeft: -62,
        borderRadius: 3,
        background: alpha(COLOR.bg, 0.42),
      }}
    />
  </>
);

/** Floating notification after the visitor clicks "Book appointment". */
const BookingCard: React.FC<{ chip: number }> = ({ chip }) => (
  <Card padding="20px 22px" radius={RADIUS.lg - 4} style={{ width: 620, display: 'flex', alignItems: 'center', gap: 20, boxShadow: SHADOW.float }}>
    <IconTile icon="calendar" size={58} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 26, lineHeight: 1.2, color: COLOR.fg, whiteSpace: 'nowrap' }}>
        New booking request
      </div>
      <div style={{ fontFamily: FONT.body, fontWeight: 400, fontSize: 21, lineHeight: 1.3, color: COLOR.fg2, marginTop: 6, whiteSpace: 'nowrap' }}>
        Facial · Thu, 10:00 AM
      </div>
    </div>
    <div style={{ opacity: Math.min(1, Math.max(0, chip) * 1.6), transform: `scale(${mix(0.7, 1, chip)})`, transformOrigin: '50% 50%' }}>
      <Chip tone="success" icon="check" size="lg">
        Booked
      </Chip>
    </div>
  </Card>
);

const QUERY = 'salon near me';

/** A search, typed, with the salon's listing highlighted at the top of the results. */
const SearchCard: React.FC<{ typed: number; rows: number[]; hi: number; caret: number }> = ({ typed, rows, hi, caret }) => {
  const shown = QUERY.slice(0, Math.round(typed * QUERY.length));
  const h = Math.min(1, Math.max(0, hi));
  const rowStyle = (p: number): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    height: 74,
    padding: '0 16px',
    borderRadius: 14,
    opacity: p,
    transform: `translateY(${(1 - p) * 12}px)`,
  });
  return (
    <Card padding={20} radius={RADIUS.lg - 2} style={{ width: 520, boxShadow: SHADOW.float }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          height: 62,
          padding: '0 22px',
          borderRadius: RADIUS.pill,
          background: alpha(COLOR.fg, 0.05),
          border: `1px solid ${COLOR.line2}`,
        }}
      >
        <Icon name="search" size={24} color={COLOR.fg2} />
        <span style={{ fontFamily: FONT.body, fontWeight: 400, fontSize: 26, color: COLOR.fg, whiteSpace: 'pre' }}>{shown}</span>
        <span style={{ width: 2, height: 30, marginLeft: -12, borderRadius: 1, background: COLOR.accentText, opacity: caret }} />
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div
          style={{
            ...rowStyle(rows[0]),
            background: alpha(COLOR.accent, 0.13 * h),
            border: `1px solid ${alpha(COLOR.accent, 0.55 * h)}`,
            transform: `translateY(${(1 - rows[0]) * 12}px) scale(${mix(0.985, 1, hi)})`,
          }}
        >
          <IconTile icon="mapPin" size={46} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 26, lineHeight: 1.15, color: COLOR.fg }}>Shira Salon</div>
            <div style={{ ...TYPE.mono, fontSize: 20, lineHeight: 1.3, marginTop: 3, color: COLOR.accentText }}>shirasalon.com</div>
          </div>
        </div>
        {[
          [196, 132],
          [164, 112],
        ].map(([a, b], i) => (
          <div key={i} style={{ ...rowStyle(rows[i + 1] * 0.9), border: '1px solid transparent' }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: alpha(COLOR.fg, 0.05), border: `1px solid ${COLOR.line}` }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: a, height: 13, borderRadius: 7, background: alpha(COLOR.fg, 0.13) }} />
              <div style={{ width: b, height: 10, borderRadius: 5, background: alpha(COLOR.fg, 0.07) }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

/**
 * The desktop capture was taken mid-way through the site's own hero fade-in, so its
 * headline is a pale ghost. Re-set that copy in the site's typeface (Gilda Display) on
 * top, in capture pixels, and let it play its entrance as the page loads.
 */
const HeroCopy: React.FC<{ head: number; body: number }> = ({ head, body }) => (
  <div style={{ position: 'absolute', left: 0, top: 0, width: 1280, transform: `scale(${SITE_K})`, transformOrigin: '0 0' }}>
    <div
      style={{
        position: 'absolute',
        left: HERO.x,
        top: HERO.headTop,
        fontFamily: SITE_SERIF,
        fontWeight: 400,
        fontSize: HERO.headSize,
        lineHeight: `${HERO.headLine}px`,
        letterSpacing: HERO.headTrack,
        color: DEBUG_HERO ? 'rgba(255, 0, 0, 0.55)' : SITE_INK,
        whiteSpace: 'pre',
        opacity: head,
        transform: `translateY(${(1 - head) * 26}px)`,
      }}
    >
      {'Smart\nbeauty for\nskin & nails'}
    </div>
    <div
      style={{
        position: 'absolute',
        left: HERO.x,
        top: HERO.bodyTop,
        width: HERO.bodyW,
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: HERO.bodySize,
        lineHeight: `${HERO.bodyLine}px`,
        color: DEBUG_HERO ? 'rgba(255, 0, 0, 0.55)' : SITE_GREY,
        opacity: body,
        transform: `translateY(${(1 - body) * 14}px)`,
      }}
    >
      Glow begins with care—our facials and nail services bring balance, beauty, and lasting results.
    </div>
  </div>
);

/** A plain arrow pointer (mock UI), tip at (x, y). */
const Cursor: React.FC<{ x: number; y: number; press: number; opacity: number }> = ({ x, y, press, opacity }) => (
  <svg
    width={32}
    height={38}
    viewBox="0 0 32 38"
    style={{
      position: 'absolute',
      left: x - 3,
      top: y - 3,
      opacity,
      transform: `scale(${1 - press * 0.14})`,
      transformOrigin: '3px 3px',
      filter: `drop-shadow(0 6px 10px ${alpha(COLOR.bg, 0.55)})`,
    }}
  >
    <path
      d="M3 3 L3 29 L9.8 22.6 L14.6 33.4 L19.4 31.3 L14.7 20.8 L24.2 20.8 Z"
      fill={COLOR.fg}
      stroke={COLOR.bg}
      strokeWidth={1.7}
      strokeLinejoin="round"
    />
  </svg>
);

// ---------------------------------------------------------------- scene

const Websites: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, scene } = useCue();
  const end = scene.frames + CROSSFADE;

  const T = {
    eyebrow: 2,
    browser: 4,
    phone: 16,
    head1: cue('websites', { offset: -4 }),
    head2: cue('win the job', { offset: -4 }),
    custom: cue('Custom', { offset: -4 }),
    fast: cue('fast', { offset: -4 }),
    visitor: cue('visitors', { offset: -4 }),
    book: cue('booked calls', { offset: -4 }),
    click: cue('booked'),
    calls: cue('calls'),
    branding: cue('branding', { offset: -4 }),
    seo: cue('SEO', { offset: -4 }),
    search: cue('get you found', { offset: -6 }),
    found: cue('found', { offset: -2 }),
  };

  // Slow drift for the whole right-hand composition; the phone sits nearer, so it moves more.
  const life = frame / end;
  const bx = mix(10, -10, life);
  const by = mix(6, -6, life);
  const px = mix(14, -16, life);
  const py = mix(4, -12, life);

  // Desktop page: eases down a little, rests while the visitor clicks "Book", then scrolls on.
  const restFrom = T.visitor - 4;
  const restTo = T.calls + 12;
  const scroll =
    interpolate(frame, [26, restFrom], [0, 56], { ...CLAMP, easing: SOFT }) +
    interpolate(frame, [restTo, end], [0, 130], { ...CLAMP, easing: SOFT });
  // Phone page: its own, slightly quicker scroll.
  const phoneScroll = interpolate(frame, [40, end], [0, 540], { ...CLAMP, easing: SOFT });

  // Entrances.
  const bIn = springAt(frame, T.browser, { stiffness: 70 });
  const siteIn = progress(frame, T.browser + 4, 18);
  const pIn = springAt(frame, T.phone, { stiffness: 70 });
  // The site's own hero copy plays its entrance as the page loads.
  const heroHead = DEBUG_HERO ? 1 : progress(frame, T.browser + 14, 26);
  const heroBody = DEBUG_HERO ? 1 : progress(frame, T.browser + 22, 22);

  // The visitor: pointer travels to "Book appointment" and clicks on "booked".
  const button = {
    x: BROWSER.x + 1 + BUTTON.x + BUTTON.w / 2 + bx,
    y: BROWSER.y + 1 + CHROME + BUTTON.y + BUTTON.h / 2 - scroll + by,
  };
  const cursorIn = progress(frame, T.visitor, 10);
  const travel = progress(frame, T.visitor + 2, 22, SOFT);
  const leave = progress(frame, T.click + 16, 16);
  const arc = Math.sin(Math.PI * travel) * 28;
  const cursor = {
    x: mix(1300, button.x + 6, travel) + arc * 0.35 + leave * 22,
    y: mix(512, button.y + 4, travel) - arc + leave * 16,
  };
  const press = progress(frame, T.click - 1, 4) * (1 - progress(frame, T.click + 4, 7));
  const ripple = progress(frame, T.click + 1, 18);

  // Booking card: in right after the click, "Booked" on "calls", out before the search.
  const bookIn = springAt(frame, T.click + 3, { stiffness: 110 });
  const bookChip = springAt(frame, T.calls + 2, { damping: 15, stiffness: 160 });
  const bookOut = progress(frame, T.seo + 6, 14, EASE.inOut);

  // Search card: typed query, results, the salon highlighted on "found".
  const sIn = springAt(frame, T.search, { stiffness: 110 });
  const typed = progress(frame, T.search + 1, 8, Easing.linear);
  const rows = [0, 1, 2].map((i) => progress(frame, T.search + 7 + i * 2, 10));
  const hi = springAt(frame, T.found, { damping: 15, stiffness: 150 });
  const caret = typed > 0 ? 1 - progress(frame, T.found + 6, 8) : 0;

  const focus = progress(frame, T.search, 22, EASE.inOut);

  const float = Math.sin(frame / 34) * 3;

  return (
    <AbsoluteFill>
      {/* Left column: the promise */}
      <div style={{ position: 'absolute', left: COL.x, top: COL.y, width: COL.w }}>
        <Eyebrow index="01" at={T.eyebrow}>
          Websites
        </Eyebrow>
        <div style={{ marginTop: 30 }}>
          <Headline text="Websites that" at={T.head1} size="h2" />
          <Headline text="*win the job.*" at={T.head2} size="h2" stagger={4} />
        </div>
        <div style={{ marginTop: 40 }}>
          <FeatureRow icon="layout" label="Custom" at={T.custom} top />
          <FeatureRow icon="bolt" label="Fast" at={T.fast} />
          <FeatureRow icon="calendar" label="Built to book calls" at={T.book} />
        </div>
        <div style={{ marginTop: 34, display: 'flex', gap: 14 }}>
          <Reveal at={T.branding} y={14} blur={4} scale={0.94}>
            <Chip tone="accent" icon="palette" size="lg">
              Branding
            </Chip>
          </Reveal>
          <Reveal at={T.seo} y={14} blur={4} scale={0.94}>
            <Chip tone="accent" icon="search" size="lg">
              SEO
            </Chip>
          </Reveal>
        </div>
      </div>

      {/* Desktop: the real site, scrolling */}
      <div
        style={{
          position: 'absolute',
          left: BROWSER.x,
          top: BROWSER.y,
          opacity: bIn,
          transform: `translate(${bx}px, ${by + (1 - bIn) * 44}px) scale(${mix(0.965, 1, bIn)})`,
          transformOrigin: '50% 100%',
        }}
      >
        <BrowserFrame url="shirasalon.com" width={BROWSER.w} height={BROWSER.h} style={{ boxSizing: 'border-box' }}>
          {/* the page paints in from the frame's own dark, not from a white slab */}
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, background: COLOR.surface }} />
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: siteIn }}>
            {/* the scrolling page, clipped under the sticky header so nothing peeks above it */}
            <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, clipPath: `inset(${scroll > 0.5 ? NAV_H - 2 : 0}px 0 0 0)` }}>
              <Shot src={staticFile('clients/shira-salon.jpg')} width={SITE_W} scroll={scroll / SITE_H} maxScroll={1} />
              <div style={{ position: 'absolute', left: 0, top: 0, transform: `translateY(${-scroll}px)` }}>
                <HeroCopy head={heroHead} body={heroBody} />
              </div>
            </div>
            <StickyBand src="clients/shira-salon.jpg" width={SITE_W} imgH={SITE_H} height={NAV_H} lift={Math.min(1, scroll / 24)} />
            {/* focus pull: the page dims a touch while the search card is up */}
            <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, background: COLOR.bg, opacity: 0.24 * focus }} />
            {/* the button darkens a touch while it's pressed */}
            <div
              style={{
                position: 'absolute',
                left: BUTTON.x,
                top: BUTTON.y - scroll,
                width: BUTTON.w,
                height: BUTTON.h,
                background: alpha(COLOR.bg, 0.28),
                opacity: press,
              }}
            />
          </div>
        </BrowserFrame>
      </div>

      {/* Floating cards over the browser */}
      {bookIn > 0.001 && bookOut < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: CARD_LEFT + bx,
            bottom: LAYOUT.height - CARD_BOTTOM - by - float,
            opacity: Math.min(1, bookIn * 1.5) * (1 - bookOut),
            transform: `translateY(${(1 - bookIn) * 22 + bookOut * 14}px) scale(${mix(0.96, 1, bookIn)})`,
            transformOrigin: '30% 100%',
            filter: (1 - bookIn) * 6 + bookOut * 6 > 0.05 ? `blur(${(1 - Math.min(1, bookIn)) * 6 + bookOut * 6}px)` : undefined,
          }}
        >
          <BookingCard chip={bookChip} />
        </div>
      ) : null}
      {sIn > 0.001 ? (
        <div
          style={{
            position: 'absolute',
            left: CARD_LEFT + bx,
            bottom: LAYOUT.height - CARD_BOTTOM - by - float,
            opacity: Math.min(1, sIn * 1.5),
            transform: `translateY(${(1 - sIn) * 26}px) scale(${mix(0.96, 1, sIn)})`,
            transformOrigin: '30% 100%',
            filter: sIn < 0.98 ? `blur(${(1 - sIn) * 6}px)` : undefined,
          }}
        >
          <SearchCard typed={typed} rows={rows} hi={hi} caret={caret} />
        </div>
      ) : null}

      {/* Phone: the same site at phone width, nearer the camera */}
      <div
        style={{
          position: 'absolute',
          left: PHONE.x,
          top: PHONE.y,
          width: PHONE.w * PHONE.scale,
          height: PHONE.h * PHONE.scale,
          // opacity resolves early so the phone never sits half-transparent over the browser; motion carries the entrance
          opacity: Math.min(1, pIn * 3),
          transform: `translate(${px}px, ${py + (1 - pIn) * 10}px) scale(${mix(0.9, 1, pIn)})`,
          transformOrigin: '50% 50%',
        }}
      >
        <div style={{ width: PHONE.w, height: PHONE.h, transform: `scale(${PHONE.scale})`, transformOrigin: '0 0' }}>
          <PhoneFrame width={PHONE.w} height={PHONE.h} screen={SALON_TOP} style={{ boxSizing: 'border-box' }}>
            <MobileSite scroll={phoneScroll} />
          </PhoneFrame>
        </div>
      </div>

      {/* The visitor's pointer and click */}
      {cursorIn > 0 && leave < 1 ? (
        <>
          {ripple > 0 && ripple < 1 ? (
            <div
              style={{
                position: 'absolute',
                left: button.x + 6 - mix(8, 46, ripple),
                top: button.y + 4 - mix(8, 46, ripple),
                width: mix(8, 46, ripple) * 2,
                height: mix(8, 46, ripple) * 2,
                borderRadius: '50%',
                border: `2px solid ${COLOR.fg}`,
                opacity: (1 - ripple) * 0.75,
              }}
            />
          ) : null}
          <Cursor x={cursor.x} y={cursor.y} press={press} opacity={cursorIn * (1 - leave)} />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

export default Websites;
