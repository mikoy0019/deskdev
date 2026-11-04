# DeskDev for Windows

A native Windows app for DeskDev: the web app in its own window, with a taskbar icon, a Start menu
entry and its own sign-in that stays put. Under the hood it is a small .NET Framework 4.8 WinForms
program hosting WebView2, the Edge engine. Windows 10 and 11 already include both, so the installer
is about 2 MB and needs nothing else.

People download it from DeskDev → **Settings → Desktop app**, which links to
`/downloads/DeskDev-Setup.exe` on whichever host DeskDev is served from.

## What it does

- **Opens DeskDev.** `deskdev.json` next to `DeskDev.exe` lists the address DeskDev should live at,
  then the fallbacks. At start the app asks all of them at once and uses the first that answers.
  Today that is `https://workspace.nixgensolutions.com`, then the workers.dev address. Before the DNS
  cutover the app runs from workers.dev; once the domain is live, every install switches to it
  without an update. Each address has its own sign-in.
- **Keeps links in their place.** Pages on DeskDev's own host stay in the window. Everything else
  opens in the default browser: the public site, a client's website, and Google sign-in (Google
  refuses embedded browsers). Connecting Google from the app finishes in the browser. The
  connection is stored server-side, so going back to the app is enough.
- **Runs once.** A second launch brings the open window to the front.
- **Remembers the window.** Size, position and maximized state, in `%LOCALAPPDATA%\DeskDev`, next to
  the WebView2 profile (cookies, local storage, the sign-in).
- **Says when it's out of date.** At start it reads `/downloads/deskdev-desktop.json` on its host. If
  the version there is newer, a banner offers the download. Running the new installer updates in
  place: it closes the app, replaces the files, reopens it, and keeps the sign-in.
- **Tells the web app it's there.** It adds `DeskDevDesktop/<version>` to its user agent. Settings →
  Desktop app uses that to show "Installed" or "Update available" (`site/src/deskdev/lib/desktopApp.ts`).
- **Desktop notifications** for DeskDev are allowed without a prompt. Web Push (notifications while
  the app is closed) is not available in WebView2. Those keep coming through the browser or the
  installed web app (Settings → Notifications).
- **Command line:** `DeskDev.exe --url=https://…` points one run at another address (a preview, a local
  dev server on `http://localhost`). `--devtools` turns on the inspector (F12).

The installer (Inno Setup 6, `installer/DeskDev.iss`) installs per user into
`%LOCALAPPDATA%\Programs\DeskDev` without asking for admin rights. It adds a Start menu entry and an
optional desktop icon, and registers an uninstaller in Windows Settings → Apps. Uninstalling also
removes `%LOCALAPPDATA%\DeskDev`. If the WebView2 Runtime is missing (only very old Windows 10
installs), the installer offers Microsoft's download page.

## Build and publish a version

On Windows, with the .NET SDK 6 or later:

```bash
cd desktop
npm install                 # once: Inno Setup's compiler (innosetup-compiler)
npm version patch --no-git-tag-version   # 1.0.0 → 1.0.1; installed apps compare this
npm run build
```

`build.mjs` does four things:
1. Builds the app with `dotnet publish`.
2. Writes `deskdev.json`.
3. Compiles the installer into `dist/DeskDev-Setup.exe`.
4. Copies the installer to `site/public/downloads/`, with `deskdev-desktop.json` (version, size,
   SHA-256, date) next to it.

Commit those two files and deploy the site. The Workers asset layer serves them on every host,
uncached (`site/public/_headers`). Cloudflare allows 25 MiB per file, and the build refuses anything
bigger.

Options: `--url=https://…` changes the main address, `--fallback-url=https://…` (repeatable) replaces
the fallbacks, and `--no-publish` leaves `site/public` alone.

`npm start` runs the app straight from source (`dotnet run`).

## Not done yet

- **Code signing.** The installer is unsigned, so Windows SmartScreen shows "Windows protected your
  PC" until people choose More info → Run anyway (Settings → Desktop app says so). Fixing that needs a
  code-signing certificate (an OV/EV certificate, or Azure Trusted Signing), then `signtool sign` on
  `DeskDev.exe` and `DeskDev-Setup.exe` in `build.mjs`.
- **Automatic updates.** The banner points to the new installer; it doesn't install it unattended.
- **Mac.** Mac users install DeskDev from the browser instead (Settings → Mobile app).
