// Builds DeskDev for Windows and its installer, then publishes the installer
// to the site, where DeskDev's Settings → Desktop app links to it and the
// app's update banner looks for it:
//
//   site/public/downloads/DeskDev-Setup.exe
//   site/public/downloads/deskdev-desktop.json   {version, url, size, sha256, released}
//
//   npm run build                         (from desktop/, on Windows)
//   npm run build -- --url=https://…      point the app somewhere else (default below)
//   npm run build -- --fallback-url=…     where to go while --url doesn't answer (repeatable)
//   npm run build -- --no-publish         leave site/public alone; installer in dist/
//
// Needs the .NET SDK (6 or later) and `npm install` here (Inno Setup's
// compiler comes from the innosetup-compiler package). Bump "version" in
// package.json for every release: installed apps compare it to offer the update.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, 'dist')
const appDir = join(dist, 'app')
const downloads = join(here, '..', 'site', 'public', 'downloads')

const DEFAULT_URL = 'https://workspace.nixgensolutions.com'
// Where DeskDev answers until the domain's DNS cutover (docs/runbooks/DNS-CUTOVER.md).
// The app uses the first address that answers, so installs made now move to
// the domain by themselves once it is live.
const DEFAULT_FALLBACKS = ['https://nixgen-site.nixgensolutions.workers.dev/workspace']

const args = process.argv.slice(2)
const flags = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.split('=').slice(1).join('='))
const flag = (name) => flags(name)[0]
const publish = !args.includes('--no-publish')

if (process.platform !== 'win32') {
  console.error('The Windows app builds on Windows (dotnet + Inno Setup).')
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json version must be x.y.z, got ${version}`)

const clean = (value) => {
  const u = value.trim().replace(/\/+$/, '')
  const parsed = new URL(u)
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error(`addresses must be https (got ${u})`)
  }
  return u
}
const url = clean(flag('url') ?? process.env.DESKDEV_URL ?? DEFAULT_URL)
// An explicit --url without --fallback-url means just that address.
const fallbackUrls = (flags('fallback-url').length ? flags('fallback-url') : flag('url') ? [] : DEFAULT_FALLBACKS)
  .map(clean)
  .filter((u) => u !== url)

const run = (file, argv) => execFileSync(file, argv, { cwd: here, stdio: 'inherit' })

console.log(`\nDeskDev for Windows ${version} → ${[url, ...fallbackUrls].join(', then ')}\n`)
rmSync(dist, { recursive: true, force: true })

// 1. The app.
run('dotnet', ['publish', 'DeskDev.csproj', '-c', 'Release', '-o', appDir, `-p:Version=${version}`, '-nologo'])

// Only what runs: no symbols, API docs, the WPF control, or the loader's
// second copy (an x64 build loads the one next to the exe).
for (const name of readdirSync(appDir)) {
  if (/\.(pdb|xml)$/i.test(name) || name === 'Microsoft.Web.WebView2.Wpf.dll') rmSync(join(appDir, name))
}
rmSync(join(appDir, 'runtimes'), { recursive: true, force: true })
writeFileSync(join(appDir, 'deskdev.json'), `${JSON.stringify({ url, fallbackUrls }, null, 2)}\n`)

// 2. The installer.
const iscc = join(here, 'node_modules', 'innosetup-compiler', 'bin', 'ISCC.exe')
if (!existsSync(iscc)) throw new Error('Inno Setup compiler missing: run `npm install` in desktop/ first.')
run(iscc, ['/Qp', `/DAppVersion=${version}`, `/DAppDir=${appDir}`, `/DOutDir=${dist}`, join(here, 'installer', 'DeskDev.iss')])

const setup = join(dist, 'DeskDev-Setup.exe')
const bytes = readFileSync(setup)
const manifest = {
  version,
  url: '/downloads/DeskDev-Setup.exe',
  size: statSync(setup).size,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  released: new Date().toISOString().slice(0, 10),
}
writeFileSync(join(dist, 'deskdev-desktop.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`\nInstaller: ${setup} (${(manifest.size / 1024 / 1024).toFixed(1)} MB)`)

// 3. Onto the site. The Workers asset layer serves site/public as-is, so the
// next site deploy publishes it (Cloudflare's limit is 25 MiB a file).
if (publish) {
  if (manifest.size > 25 * 1024 * 1024) throw new Error('Installer is over the 25 MiB Workers asset limit.')
  mkdirSync(downloads, { recursive: true })
  copyFileSync(setup, join(downloads, 'DeskDev-Setup.exe'))
  writeFileSync(join(downloads, 'deskdev-desktop.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Published to site/public/downloads/ — deploy the site to put it live.`)
}
