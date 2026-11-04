# NixGen VSL: scene build guide

A 3-minute voiced video sales letter for **NixGen Solutions**, rendered with Remotion
(1920×1080, 30 fps). The voiceover (ElevenLabs, voice "Eric") is already generated, with
word-level timings. Your job is to build scenes whose visuals **follow the voice**: things
appear as they are said.

- **Viewer:** owners of local service businesses (contractors, HVAC, salons, tour operators).
- **Goal:** request a 30-minute discovery call at nixgensolutions.com.
- **Look:** the redesigned NixGen website. Editorial, restrained, expensive. Near-black field,
  one blue accent, Space Grotesk headlines with *Instrument Serif italic* accent words,
  JetBrains Mono eyebrow labels, hairline borders, soft depth. Think a Linear or Stripe
  launch film, not a stock "explainer video". Calm confidence over flash.

---

## Hard rules (the reviewer checks every one)

1. **Facts.** Say nothing about NixGen beyond the *Approved claims* below: no invented stats,
   clients, results, awards, prices or timelines. Mock UI may contain illustrative content
   (sample inbox names, sample dashboard numbers, competitor quotes) only when it is
   obviously a mock: generic first name + initial ("Maria G."), round plausible numbers, and
   a small `Sample data` label on any mock dashboard with figures.
2. **Never show or name:** DeskDev, Command Desk, any location (no Philippines, Manila,
   country or city of the team), NixGen prices or packages, "+267%", Joshua Lane, Brick
   Insulation, Tyler Morgan. Never use `public/products/pos-app.png` (it's a login screen).
3. **Safe area.** Content stays inside x 140–1780, y 140–880. In the four offer scenes
   (websites, automation, apps, devs) the offer rail sits at y 132–190, so content starts at
   y ≥ 240 (`LAYOUT.offerTop`). The HUD owns y < 110 and burned-in captions own y > 900.
   Never put anything there.
4. **Theme only.** Colours from `COLOR`, type from `TYPE`/`FONT`, radii from `RADIUS`,
   shadows from `SHADOW`. Raw colours are allowed only inside mock "website" content in a
   `BrowserFrame` (white page, grey wireframe blocks). Status colours (success/warn/danger)
   only for status. One accent: blue. No purple, no gradients-as-decoration, no neon glows,
   no glassmorphism blur soup.
5. **No emoji.** Icons only via `components/Icon.tsx`.
6. **Don't edit shared files**: `src/components/*`, `src/lib/*`, `src/theme.ts`,
   `src/timeline.ts`, `src/Vsl.tsx`, `src/Root.tsx`, `src/scenes/index.ts`, `src/dev/*`,
   `scripts/*`. Other agents build on them at the same time. Need a new icon, helper or
   mock? Define it locally in your scene file, or in `src/scenes/<sceneId>/` sub-files.
   You own exactly `src/scenes/<Name>.tsx` (+ that optional folder).
7. **Motion.**
   - Everything enters with motion (`Headline`, `Reveal`, springs). Nothing pops in.
   - Key moments land **on the word**: use `cue()` and start the animation 0–6 frames
     before the word (`cue('instant reply', { offset: -4 })`).
   - Ease-out, calm. Tiny overshoot only for small confirmations (spring damping ≥ 14).
     No spinning, shaking, bouncing logos or flashy wipes.
   - Always subtly alive: give the main composition a slow drift, parallax or scroll
     (10–40 px over the scene) so no frame looks frozen for more than ~2 s.
   - Elements leaving mid-scene exit with motion (fade/slide/blur), they don't vanish.
   - Don't build a scene exit: `SceneShell` crossfades every scene out over its last 12
     frames automatically (the final scene holds).
8. **Legibility.** On-screen text is a distilled *title* for the idea, not a copy of the
   sentence being spoken (captions already show that). Headlines ≤ ~8 words. Labels ≥ 20 px;
   anything meant to be read ≥ 26 px. No text over text, no text over busy imagery without
   a scrim, contrast high enough to read at a glance.
9. **Deterministic.** No `Math.random()`, `Date`, timers or effects-driven animation. Use
   `random('seed')` from `remotion` if you need noise. Images via
   `<Img src={staticFile('clients/shira-salon.jpg')} />` (or `Shot`), never `<img>`.
10. **Cheap to render.** No `backdrop-filter`; `filter: blur()` ≤ 20 px and only on elements
    smaller than ~800 px; no huge box-shadows animated per frame on many elements.

---

## Toolkit

Read these files; they're short and documented.

| Import | What it gives you |
| --- | --- |
| `../lib/scene` | `useCue()` → `{ cue, cueEnd, beatStart, beatEnd, scene }`. `cue('phrase')` returns the scene-local frame where the phrase starts being spoken (`cueEnd` = where it ends). A phrase that isn't spoken throws. Options: `{ beat, nth, offset }`. |
| `remotion` | `useCurrentFrame()` (scene-local), `AbsoluteFill`, `Img`, `staticFile`, `interpolate`, `random`. |
| `../lib/motion` | `progress(frame, start, dur, ease)` 0→1 eased & clamped; `springAt(frame, start, config)`; `mix(a, b, t)`; `EASE.out/inOut/in`; `CLAMP`; `sec(seconds)`. |
| `../components/Text` | `<Headline text="Websites that *win the job.*" at={f} size="h2" />` (words rise from a mask; `*…*` = serif italic accent); `<Eyebrow index="01" at={f}>Websites</Eyebrow>`; `<Reveal at={f} y={24} x={0} blur={6} scale={0.96}>`; `<Lede at={f}>`. |
| `../components/Surfaces` | `<Card glow padding radius>`, `<Chip tone="accent" icon="check" size="lg">`, `<Counter to={200} at={f} dur={40} suffix="+" />`, `<BrowserFrame url="shirasalon.com" width height>`, `<PhoneFrame width height>`, `<Shot src width scroll={0..1} />` (full-page capture inside a frame), `<DrawLine at length vertical color>`. |
| `../components/Icon` | `<Icon name="check" size={24} />`. Names: check, x, arrowRight, arrowDown, globe, layout, bolt, sparkles, code, chart, trendingUp, phone, smartphone, mail, send, message, inbox, calendar, clock, moon, sun, user, users, file, dollar, creditCard, lock, key, shield, search, star, layers, mic, refresh, target, palette, alert, help, eye, mapPin, truck, box, play, wrench. |
| `../theme` | `COLOR`, `TYPE` (display/h1/h2/h3/h4/lede/body/small/eyebrow/mono/numeral), `FONT` (heading/body/serif/mono), `LAYOUT`, `RADIUS`, `SHADOW`. |

Scene component shape:

```tsx
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { useCue } from '../lib/scene';

const Websites: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue } = useCue();
  const booked = cue('booked calls', { offset: -4 });
  return <AbsoluteFill>{/* … */}</AbsoluteFill>;
};

export default Websites;
```

### Assets (`public/`)

- `clients/*.jpg`: real full-page captures of NixGen client sites, 1280×2400:
  `shira-salon` (salon, online booking), `colorado-river-expeditions` (tours, booking system),
  `upscale-rails` (real estate, investor portal), `lumina-comfort` (HVAC, lead capture),
  `tank-it-easy` (septic, multi-location), `topcore-it` (IT services, B2B site),
  `hike-wales` (travel, WebGL hero).
- `products/*.png`: apps NixGen built, 1600×1000: `supernova-dashboard` (revenue dashboard),
  `invoice-chase` (automated invoicing), `inbox-ai` (AI email assistant), `stock-sense`
  (inventory), `delivery-app` (dispatch & live tracking). **Not** `pos-app.png`.
- Look at an image (Read tool) before you place it.

### Verify your work

1. `npx tsc --noEmit -p .` must be clean for your files. Errors in *other* scene files are
   other agents' work in progress; ignore those.
2. `node scripts/still.mjs <sceneId> --auto` renders three frames per beat plus the exit into
   `out/stills/<sceneId>/<frame>.jpg`; or pick frames: `node scripts/still.mjs <sceneId> 30 140 260`.
   Frames are scene-local. Renders share two slots machine-wide, so "waiting for a render
   slot" is normal. Each call costs ~20–40 s; batch several frames per call.
3. Open **every** still with the Read tool. The still includes the real HUD and captions,
   so you can see what is being said at that frame and whether the visual matches it.
4. Check against the rules and your spec, then iterate until a demanding art director would
   ship it.

---

## Approved claims (everything the video may say about NixGen)

- Name/wordmark **NIXGEN.** (period in `COLOR.accentText`); site **nixgensolutions.com**.
- Founded **2023**. **200+ websites delivered.** Launch package: **live in 14 days**.
- **Senior team only. No juniors, no outsourcing.** A small number of clients each quarter.
- **You own the domain, the code and the content**, on your own accounts, **no lock-in**.
- **If you don't love the first design concepts, we revise until you do, at no extra charge.**
- **Reply within 12 hours. 30-minute discovery call. No pressure, no pitch deck.**
- Live preview link during development. Process phases: **Signal** (strategy call), **Compose**
  (design), **Forge** (build), **Launch**.
- Services: conversion websites; branding & identity; SEO & visibility; automation systems
  (instant replies, CRM integration with GoHighLevel, HubSpot, Salesforce, Pipedrive,
  Monday.com; automatic follow-ups and reminders); AI operations (AI assistants; an **AI voice
  agent** for inbound calls, appointment scheduling, lead qualification); revenue dashboards;
  custom apps (online booking, customer/investor portals, invoicing that chases late payments,
  inventory, dispatch/delivery); **dedicated developers**: full-time, part-time or on call,
  reporting to you every day.
- Proof (verbatim):
  - **Austin Hayes**, Owner, Service Business: **3x leads in 60 days**. Quote: "NixGen didn't
    just build us a website — they built a system that books work for us."
  - **Laith Hofayz**, Director, **Codetic**: **20+ hrs/week saved**. Quote: "The dashboard
    alone saved us 20 hours a week in manual reporting."
- Portfolio clients (real): Shira Salon, Colorado River Expeditions, Upscale Rails, Lumina
  Comfort, Tank It Easy, TopCore IT, Hike Wales, Four States Concrete (#1 local SEO; no capture).
- Products built (real): Supernova, Invoice Chase, Inbox AI, Stock Sense, Delivery App, Elev8te
  (CRM for service teams; no capture).

---

## Scene specs

Durations are approximate; read exact frames from `useCue()` / the still script output.
The spoken text is the exact voiceover. Cue phrases must be words that are actually spoken.

### hook → `Hook.tsx` (≈13 s, beat `hook`)

> "It's nine at night. Someone fills out the form on your website, and nobody answers until
> morning. By then, they've booked someone else. If you run a service business, that's not
> bad luck. It's a systems problem."

A lead lost overnight, then the reframe. Cinematic, quiet, slightly tense.

- Left: a `PhoneFrame` (≈ 360×720, top ≥ 150, bottom ≤ 870), lock screen at night: big
  time **9:04** + "PM" (Space Grotesk), small date line. Deep night tone inside the screen.
- `cue('fills out the form')`: a notification slides down in the phone: globe icon,
  "Website · New inquiry", body "Hi! Can someone quote a repair this week?", "now".
- `cue('nobody answers until morning')`: the clock fast-forwards through the night to
  **7:58 AM** over ~40 frames (digits roll), the screen warms subtly toward dawn, the
  notification ages "now" → "11h ago" and stays unread (blue dot).
- Right column (x ≈ 820–1780): mono label + big tabular counter of the unanswered time
  climbing to **11 hours** in step with the clock; label "Unanswered".
- `cue('booked someone else')`: a `danger` chip "Lead lost: booked elsewhere" lands; the
  phone dims a little.
- `cue('not bad luck')`: right column clears; headline (h1) "Not bad luck." then at
  `cue('systems problem')` "A *systems problem.*" lands as the hero line. The phone recedes
  (scale ~0.94, opacity ~0.4) so the line owns the frame.
- No NixGen branding yet (introduced next scene).

### who → `Who.tsx` (≈13.7 s, beat `who`)

> "We're NixGen. Since 2023, we've delivered more than 200 websites, plus the apps and
> automations behind them, for contractors, salons, HVAC companies, tour operators and more.
> And we keep finding the same four leaks."

- Backdrop "wall of work": a slow-drifting, gently tilted (perspective) grid of real client
  captures and product shots, low opacity under a dark scrim so text stays crisp. It becomes
  a little more visible at `cue('200')`.
- `cue('NixGen')`: big wordmark **NIXGEN.** (Space Grotesk 600, ~170 px, tracking ~0.06em,
  blue period) rises in; eyebrow "Since 2023" at `cue('2023')`.
- `cue('200')`: wordmark eases up and smaller; a big numeral counter 0 → **200+** with label
  "websites *delivered*". At `cue('apps and automations')` two chips: "+ Apps", "+ Automations".
- Industry chips appear exactly on each word: `cue('contractors')` Contractors,
  `cue('salons')` Salons, `cue('HVAC')` HVAC, `cue('tour operators')` Tour operators,
  `cue('and more')` & more.
- `cue('four leaks')`: everything settles back; a line "The same *four leaks.*" (h2) with
  four small numbered ticks 01–04 (foreshadowing the next scene).

### leaks → `Leaks.tsx` (≈31 s, beats `leak1`–`leak4`)

> leak1 "One: your website looks like everyone else's, so customers can't tell you apart, and
> they shop on price."
> leak2 "Two: slow follow-up. Inquiries sit in an inbox, and whoever answers first wins the job."
> leak3 "Three: busywork. Quotes, reminders, scheduling, and invoices you chase by hand at the
> kitchen table."
> leak4 "Four: no visibility. You know what you spend on marketing, but not what actually
> brings in paying customers."

One persistent layout; content changes at each `beatStart('leakN')` with smooth transitions.

- Left column (x 140–760): eyebrow "Leak 0N / 04"; a four-segment progress indicator (active
  segment accent); a giant numeral **0N** (`TYPE.numeral`, ~240 px) that rolls (old slides
  up and out, new rises in) at each beat; title (h2): "Looks like *everyone else.*",
  "Slow *follow-up.*", "Endless *busywork.*", "No *visibility.*"; optional one-line lede:
  "So customers shop on price." / "Whoever answers first wins." / "All by hand, after hours." /
  "Spend in. Results unknown."
- Right: one visual `Card` panel (≈ 900×600, x ≈ 860–1780, y ≈ 200–860) whose content swaps
  per leak (old content exits, new enters):
  - **leak1:** three identical grey wireframe website mockups fanned out; at
    `cue("everyone else's")` they slide into one overlapping, indistinguishable stack; at
    `cue('shop on price')` three quote tags drop in ("Quote A $480", "Quote B $450",
    "Quote C $420"), the cheapest highlighted. (Illustrative competitor quotes.)
  - **leak2:** an inbox (4–5 rows: initials avatar, "Maria G.", subject like "Quote for a new
    driveway?", time, unread dot). At `cue('sit in an inbox')` the times age (2m → 3h → 1d)
    and turn warn; at `cue('answers first')` a competitor reply card slides in: "Competitor ·
    replied in 2 min" with a success "Booked" chip.
  - **leak3:** chores pile up one per word: "Send quote: Hendricks" (`cue('Quotes')`),
    "Reminder: Tue 9:00 AM" (`cue('reminders')`), "Reschedule Friday crew"
    (`cue('scheduling')`), "Invoice #1042: 34 days overdue" in danger (`cue('invoices')`);
    at `cue('kitchen table')` a "11:42 PM" clock with a moon icon sets the late-night tone.
  - **leak4:** a table: Channel | Spent | Customers. Rows (Google Ads $2,400, Facebook $1,100,
    Flyers $600, Website —) reveal on `cue('spend on marketing')`; every Customers cell is a
    pulsing "?" (accent) from `cue('paying customers')`.

### reframe → `Reframe.tsx` (≈7 s, beat `reframe`)

> "Most owners try to fix that with five different vendors. What you need is one team that
> builds the whole system."

- Start: headline (h2) "Five vendors?".
- `cue('five different vendors')`: five small vendor cards appear staggered in a slightly
  messy row (±2° tilt, uneven y): Web designer (layout), SEO agency (search), App developer
  (code), Automation freelancer (bolt), IT help (wrench).
- `cue('one team')`: the five cards converge and merge into one centered glowing card with
  the **NIXGEN.** wordmark; headline swaps to "One team. *The whole system.*"

### offers → `Offers.tsx` (≈2.9 s, beat `offers`)

> "That's what we do, in four parts."

Very short: everything on screen by ~frame 40, then hold with a slow drift.

- Headline (h2) "Four parts. *One system.*"
- Four tiles in a row or 2×2, numbered 01–04, each with icon + title + one-line descriptor,
  staggered 3–4 frames: 01 Websites, "Built to book calls" (layout); 02 Automation & AI,
  "Every lead answered" (bolt); 03 Apps & dashboards, "Run the business" (chart);
  04 Dedicated developers, "Your own team" (users).
- Keep content at y ≥ 240: the offer rail fades in over this scene's last frames.

### websites → `Websites.tsx` (≈10.4 s, beat `websites`; rail shows 01)

> "First, websites that win the job. Custom, fast, and designed to turn visitors into booked
> calls, with the branding and SEO to get you found."

- Left column (x 140–700): eyebrow index "01" "Websites"; headline (h2) "Websites that *win
  the job.*"; feature rows that tick in on their words: Custom (`cue('Custom')`), Fast
  (`cue('fast')`), Built to book calls (`cue('booked calls')`); then at
  `cue('branding and SEO')` chips "Branding" (palette) and "SEO" (search).
- Right: a `BrowserFrame` (≈ 980×600, url "shirasalon.com") showing the Shira Salon capture
  scrolling slowly through the scene, overlapped bottom-right by a `PhoneFrame` (≈ 250×500)
  with the same site at phone width scrolling at a different rate.
- `cue('booked calls')`: a small floating card over the browser: calendar icon, "New booking
  request", success chip "Booked".
- `cue('get you found')`: a floating search card: search icon, query "salon near me", the
  Shira Salon result highlighted at the top of the results (no "#1" claim).

### automation → `Automation.tsx` (≈12.7 s, beat `automation`; rail shows 02)

> "Second, automation and AI. Every inquiry gets an instant reply and lands in your CRM.
> Follow-ups and reminders run themselves, and an AI voice agent can answer calls and book
> appointments for you."

- Eyebrow "02" "Automation & AI"; headline (h2) "Every lead, *answered.*"
- A left-to-right flow of three cards joined by drawn connectors with a travelling dot:
  1. Website form (Name "Maria G.", message "Need a quote this week"), Submit presses at
     `cue('inquiry')`.
  2. Email "Re: your quote request: Thanks Maria, we'll call you at 10:00", success chip
     "Sent instantly" at `cue('instant reply')`.
  3. CRM card "New lead · Maria G.", stage "Contacted", source "Website", with a mono line
     "HubSpot · GoHighLevel · Salesforce" at `cue('lands in your CRM')`.
- `cue('Follow-ups and reminders')`: a row of chips ticking on in sequence: "Day 1 follow-up",
  "Day 3 follow-up", "Appointment reminder".
- `cue('AI voice agent')`: a call card slides in: phone icon, "Incoming call · AI voice
  agent", animated waveform bars, line "I can book you for Tuesday at 10." Then at
  `cue('book appointments')` a success chip "Appointment booked · Tue 10:00 AM".

### apps → `Apps.tsx` (≈12.4 s, beat `apps`; rail shows 03)

> "Third, custom apps and dashboards. Online booking, customer portals, invoicing that chases
> late payments for you, and a live dashboard that shows exactly where your revenue comes from."

- Eyebrow "03" "Apps & dashboards"; headline (h2) "Custom apps & *dashboards.*"
- Four app windows (`BrowserFrame`s with real images) in a staggered, slightly 3D cascade or
  an offset grid with depth. Each one steps forward (scale up, accent border, label chip)
  exactly when spoken:
  - `cue('Online booking')`: `clients/colorado-river-expeditions.jpg`, label "Online booking".
  - `cue('customer portals')`: `clients/upscale-rails.jpg`, label "Customer portals".
  - `cue('invoicing')`: `products/invoice-chase.png`, label "Invoicing that chases late
    payments".
  - `cue('live dashboard')`: `products/supernova-dashboard.png` comes to the front, largest,
    label "Live revenue dashboard"; at `cue('revenue comes from')` a small overlay chip
    "Revenue by source" or a gentle highlight sweep.

### devs → `Devs.tsx` (≈12 s, beat `devs`; rail shows 04)

> "And fourth, dedicated developers. When you need ongoing help, you get your own NixGen
> developer, full-time, part-time or on call, reporting to you every day."

- Eyebrow "04" "Dedicated developers"; headline (h2) "Your own *developer.*"
- Left: profile card "Your NixGen developer": avatar circle (user icon, not a real person),
  "Online" status (success dot), role "Senior developer", skill chips (Websites, Automation,
  Apps). Under it a segmented control **Full-time | Part-time | On call** whose highlight
  slides to each option exactly on `cue('full-time')`, `cue('part-time')`, `cue('on call')`.
- Right, at `cue('reporting to you every day')`: a "Daily report · Today" email card building
  line by line ("Booking page shipped", "CRM sync fixed", "Tomorrow: invoice reminders") with
  a Mon–Fri strip filling with checks ("every day").
- Never show or mention DeskDev or any internal tool.

### proof → `Proof.tsx` (≈12.3 s, beat `proof`)

> "And it works. Austin Hayes, a service business owner, tripled his leads within 60 days. At
> Codetic, the dashboard alone saved the team more than 20 hours a week of manual reporting."

- Eyebrow "Proof"; headline (h2) "Real *results.*" at the start ("And it works").
- Two large cards side by side:
  - `cue('Austin Hayes')`: big numeral counting 1× → **3×** on `cue('tripled')`, label "leads
    in 60 days"; a small rising sparkline; quote "They built a system that books work for us.";
    footer: initials avatar "AH", **Austin Hayes**, "Owner, Service Business".
  - `cue('Codetic')`: big numeral **20+**, label "hours a week saved"; a small bar of manual
    reporting hours shrinking; quote "The dashboard alone saved us 20 hours a week in manual
    reporting."; footer "LH", **Laith Hofayz**, "Director, Codetic".
- Quotes are verbatim excerpts in curly quotes; no extra praise.

### process → `Process.tsx` (≈10.9 s, beat `process`)

> "Working with us is simple. We start with a strategy call about your business and your
> numbers. You watch progress on a live preview link, and a new website can go live in 14 days."

- Eyebrow "How it works"; headline (h2) "From first call to *launch.*"
- A horizontal four-node timeline across the frame: 01 Signal "Strategy call", 02 Compose
  "Design", 03 Forge "Build", 04 Launch "Go live", with a progress line that fills node to node:
  node 1 at `cue('strategy call')` (+ chip "Your business & numbers"); nodes 2–3 during
  `cue('watch progress')`, with a small browser chip "Live preview link" and a pulsing live dot
  at `cue('live preview link')`; node 4 at `cue('go live')`.
- `cue('14 days')`: a big numeral **14 days** lands (counter Day 1 → Day 14) with a day ruler
  under the line.

### risk → `Risk.tsx` (≈12.8 s, beat `risk`)

> "You own everything we build: the domain, the code and the content, on your own accounts,
> with no lock-in. And if you don't love the first design concepts, we revise until you do, at
> no extra charge."

- Two cards side by side.
  - Left "You own *everything.*": checklist rows ticking on their words: Domain
    (`cue('domain')`), Code (`cue('code')`), Content (`cue('content')`); "On your accounts"
    with key icon at `cue('your own accounts')`; accent chip "No lock-in" at `cue('no lock-in')`.
  - Right, entering at `cue('first design concepts')`: "Revisions until you *love it.*": three
    abstract design-concept thumbnails (v1, v2, v3) cycling/stacking through
    `cue('revise until you do')`, the last with a success "Approved" check; chip "No extra
    charge" at `cue('no extra charge')`.
- Eyebrow "Your terms". No "risk-free" or "guarantee" wording.

### whofor → `WhoFor.tsx` (≈11.6 s, beat `whofor`)

> "This is for service business owners who are great at the work and done doing everything
> else by hand. We take on a small number of clients each quarter, so a senior team stays on
> every project."

- Eyebrow "Who it's for". Typographic: h1 "Great at the work." at `cue('great at the work')`,
  then "Done doing it *all by hand.*" at `cue('done doing')`.
- Then a row of three items with icons, revealed on their words: "A small number of clients
  each quarter" (calendar) at `cue('small number of clients')`; "Senior team on every project"
  (users) at `cue('senior team')`; "No juniors, no outsourcing" (shield) right after.

### cta → `Cta.tsx` (≈18.5 s, beat `cta`; the voice ends ≈ 15.3 s, then a 3 s hold)

> "If that's you, go to nixgensolutions.com and tell us about your business. We'll reply within
> 12 hours to set up a 30-minute discovery call. No pressure, no pitch deck. Just a clear look
> at where you're losing time and money, and what we'd build to fix it."

- Centered. Eyebrow "Next step"; headline (h1) "Book your 30-minute *discovery call.*"
- `cue('nixgensolutions.com')`: the URL in a pill (mono) appears; at `cue('tell us')` a large
  accent button "Tell us about your business" (arrow icon) gets a cursor click (press +
  release).
- Chips on their words: "Reply within 12 hours" (clock) at `cue('12 hours')`, "No pressure" at
  `cue('No pressure')`, "No pitch deck" at `cue('no pitch deck')`.
- After the last word (≈ `cueEnd('fix it')`), transition to the **end card** for the final
  ~3 s: large **NIXGEN.** wordmark, eyebrow "Websites · Automation & AI · Apps · Developers",
  URL **nixgensolutions.com**. The HUD fades itself out; this is the last scene, so it does
  not fade out. The very last frame is a clean, centered end card.
