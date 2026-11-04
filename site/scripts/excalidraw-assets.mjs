// Copies the Whiteboard's fonts (Excalidraw) into public/workspace/excalidraw/,
// so the board loads them from DeskDev instead of the esm.sh CDN Excalidraw
// falls back to. The Xiaolai family (13 MB, Chinese/Japanese handwriting) is
// left to that fallback: it loads only when such text is drawn.
//
// Runs before `next dev` and `next build` (package.json predev / prebuild).
// The copy is gitignored; window.EXCALIDRAW_ASSET_PATH points at it
// (src/deskdev/whiteboard/WhiteboardEditor.tsx).
//
//   node scripts/excalidraw-assets.mjs

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FROM = resolve(HERE, '../node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const TO = resolve(HERE, '../public/workspace/excalidraw/fonts');
const SKIP = new Set(['Xiaolai']);

if (!existsSync(FROM)) {
  console.warn('excalidraw-assets: @excalidraw/excalidraw is not installed; fonts not copied');
  process.exit(0);
}
rmSync(TO, { recursive: true, force: true });
mkdirSync(TO, { recursive: true });
let copied = 0;
for (const family of readdirSync(FROM)) {
  if (SKIP.has(family)) continue;
  cpSync(resolve(FROM, family), resolve(TO, family), { recursive: true });
  copied++;
}
console.log(`excalidraw-assets: ${copied} font families in public/workspace/excalidraw/fonts`);
