# DeskDev Studio — Mobile

Expo SDK 56 + expo-router + React Native app for Android and iOS, the phone side of the DeskDev Studio web app (`../site/src/deskdev`, served at `/workspace`): projects with their stages (onboarding → development → launched) and onboarding form, tasks, clients with their email, **leads** (the website brief, reply clock, score, attribution, discovery form, booking link, email, convert to client), the **portfolio** editor, CRM tables, calendar, meetings, messages, EOD reports, roles & notifications (tapping one opens what it's about). Both apps share one Supabase backend and the **same store and data-layer code** (see [Shared code rule](#shared-code-rule-sitesrcdeskdevlib-is-the-source-of-truth)).

## Environment setup

Copy `.env.example` to `.env` (git-ignored) — see the comments in that file:

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
# optional: the site customers open quick-form / booking links on
EXPO_PUBLIC_SITE_URL=https://nixgensolutions.com
```

The app is **dual-mode**:

- **Local mode** (both values empty — the default): all data persists to on-device AsyncStorage; sign in with the demo accounts `admin@deskdev.local` / `admin` or `member@deskdev.local` / `member`. No network required.
- **Remote mode** (both values set): Supabase auth + Postgres + realtime sync, shared live with the web app. Use the same project URL + anon key as `site/.env.local` (`NEXT_PUBLIC_SUPABASE_*`). To create the Supabase project and apply the schema, follow `../supabase/README.md` (apply the migrations in ledger order, then create the first admin user).

## Run

```bash
npm install
npx expo start            # Metro — open in a dev client / emulator

# Native Android build (first time: prebuild regenerates mobile/android, gitignored)
npx expo prebuild --platform android
npx expo run:android
```

> The repo must live at a **spaceless path** (e.g. `C:\Dev\deskdev-studio`) — the native Android build (CMake/ninja) fails from paths containing spaces or apostrophes.

**Radon IDE:** open the repo root as a folder, then *Radon IDE: Open IDE Panel* — it auto-detects `mobile/` via `.vscode/launch.json`.

Quickest check on a phone or emulator: `npx expo start`, then open it in **Expo Go** (Android: press `a`
with an emulator running; iPhone: scan the QR code with the Camera app). Everything in the app runs in
Expo Go.

## Builds for Android and iOS (EAS)

`eas.json` has three profiles: `development` (dev client), `preview` (internal: an Android APK and an
iOS simulator build) and `production` (store builds; build numbers auto-increment remotely).

```bash
npm install -g eas-cli && eas login          # your Expo account (once)
eas init                                      # links app.json to an EAS project (once)

eas build --platform android --profile preview      # APK to install on any Android phone
eas build --platform ios --profile preview          # iOS simulator build
eas build --platform all --profile production       # Play Store AAB + App Store IPA
eas submit --platform android|ios --profile production
```

- **iOS needs EAS (or a Mac):** Windows can't compile iOS. A device or App Store build needs an Apple
  Developer account; EAS creates the certificates and profiles on the first build. Fill in
  `submit.production.ios` (appleId, ascAppId, appleTeamId) before `eas submit`.
- **Android store submit** needs `google-service-account.json` (git-ignored) for `eas submit`.
- **Environment for builds:** set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and
  (optionally) `EXPO_PUBLIC_SITE_URL` as EAS environment variables (`eas env:create`) for the
  `preview`/`production` environments — without them a build runs in local (demo) mode.
- Bundle ids: `com.maykie.deskdevstudio` on both platforms (`app.json`).
- **Not yet on mobile:** push notifications to the phone (the web app's Web Push doesn't reach a
  native app; it needs expo-notifications + a token table + send-push sending through Expo's push
  service), screenshot upload for portfolio entries (done in the web app), and the admin settings
  screens (Growth, booking, email, company calendar — web only).

## Shared code rule: `site/src/deskdev/lib` is the source of truth

The store (`src/store/useStore.ts`), the demo data (`src/data/seed.ts`) and the data layer and rules in `src/lib/` (`types`, `permissions`, `format`, `eod`, `mappers`, `adminUsers`, `db`, `realtime`, `leads`, `showcase`, `tasks`, `forms`, `projectPhase`, `quickForm`, `email`, `booking`, `chat`, `channels`) are a **byte-for-byte mirror** of `site/src/deskdev/` (DeskDev web) — the mobile app runs the web app's store. When changing any of these files:

1. Edit the file in `site/src/deskdev/lib` first.
2. Copy it to `mobile/src/lib` **in the same PR**.

This is enforced by CI: `node scripts/check-shared-drift.mjs` (repo root) fails when the two sides diverge. Genuinely platform-specific code goes inside marker regions, which the check strips before comparing (the file must be allowlisted in the script):

```ts
// PLATFORM-SPECIFIC:START
AppState.addEventListener('change', onChange)  // mobile-only shim
// PLATFORM-SPECIFIC:END
```

Not mirrored (intentionally platform-specific): `src/lib/platform.ts` — the one seam the shared code reaches the device through (AsyncStorage, expo-crypto ids/random/SHA-256, the site origin, sign-out cleanup); keep its exports equal to the web's `lib/platform.ts` — plus `src/lib/supabase.ts` (env access + AsyncStorage/AppState session handling), `src/lib/showcaseImages.ts` (no canvas: upload stays on the web) and `src/lib/theme.ts` (mobile-only).

## More docs

- `../docs/deskdev/FOUNDATION.md` — store/data-layer API reference (modes, types, permissions, store actions).
- `../docs/deskdev/FOUNDATION-THEME.md` — ink/brand token design system.
- `../supabase/README.md` — Supabase runbook: migration ledger, Vault secrets, first admin.
