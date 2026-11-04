// Renders stills so a scene can be checked without rendering the whole video.
//
//   node scripts/still.mjs <scene> <frame> [frame ...]   scene-local frames, e.g. hook 30 120 300
//   node scripts/still.mjs <scene> --auto                  three frames per beat, plus the exit
//   node scripts/still.mjs full <frame> [frame ...]        absolute frames of the whole video
//
// Writes out/stills/<scene>/<frame>.jpg (1920x1080) and prints each path.
// Several agents render at once on a machine with little free memory, so at most
// two renders run at a time across all processes; extra calls wait their turn.

import { bundle } from '@remotion/bundler';
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLOTS = 2;
const LOCKS = join(ROOT, 'out', '.locks');
const STALE_MS = 10 * 60 * 1000;

const [target, ...rest] = process.argv.slice(2);
if (!target || (!rest.length && target !== 'full')) {
  console.error('usage: node scripts/still.mjs <scene|full> <frame ...> | --auto');
  process.exit(1);
}

const full = target === 'full';
const entryPoint = full ? join(ROOT, 'src', 'index.ts') : join(ROOT, 'src', 'dev', 'entries', `${target}.tsx`);
if (!existsSync(entryPoint)) {
  console.error(`No entry for "${target}" (${entryPoint})`);
  process.exit(1);
}

let slot = null;
const release = () => {
  if (slot) rmSync(slot, { recursive: true, force: true });
  slot = null;
};
process.on('exit', release);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

async function acquire() {
  mkdirSync(LOCKS, { recursive: true });
  let waited = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const candidate = join(LOCKS, `slot-${i}`);
      try {
        mkdirSync(candidate);
        return candidate;
      } catch {
        try {
          if (Date.now() - statSync(candidate).mtimeMs > STALE_MS) rmSync(candidate, { recursive: true, force: true });
        } catch {
          // Released between our two calls; try again.
        }
      }
    }
    if (!waited) console.log('waiting for a render slot...');
    waited = true;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

slot = await acquire();
const outDir = join(ROOT, 'out', '.bundles', `${target}-${process.pid}`);
try {
  const serveUrl = await bundle({ entryPoint, outDir, enableCaching: true, publicDir: join(ROOT, 'public') });
  const browser = await openBrowser('chrome');
  try {
    const id = full ? 'NixGenVSL' : `scene-${target}`;
    const composition = await selectComposition({ serveUrl, id, inputProps: {}, puppeteerInstance: browser });

    let frames;
    if (rest.includes('--auto')) {
      if (full) {
        frames = [];
        for (let f = 15; f < composition.durationInFrames; f += 300) frames.push(f);
      } else {
        const { meta } = composition.props;
        frames = meta.beats.flatMap((b) => [b.offset + 24, b.offset + Math.round(b.audioFrames * 0.55), b.offset + b.audioFrames - 6]);
        frames.push(meta.frames + 6);
      }
    } else {
      frames = rest.map(Number).filter((n) => Number.isFinite(n));
    }
    frames = [...new Set(frames.map((f) => Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(f)))))].sort((a, b) => a - b);

    const dir = join(ROOT, 'out', 'stills', target);
    mkdirSync(dir, { recursive: true });
    for (const frame of frames) {
      const output = join(dir, `${frame}.jpg`);
      await renderStill({ composition, serveUrl, output, frame, imageFormat: 'jpeg', jpegQuality: 88, puppeteerInstance: browser, overwrite: true, inputProps: {} });
      console.log(output);
    }
    console.log(`${composition.id}: ${composition.durationInFrames} frames`);
  } finally {
    await browser.close({ silent: true }).catch(() => {});
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
  release();
}
