// Downloads full-height screenshots of NixGen portfolio sites (via WordPress mshots,
// the same service the site's portfolio grid uses) and copies the app product shots
// from the site. mshots answers with a placeholder until a capture is ready, so this
// polls until it gets a real JPEG.
//
//   node scripts/fetch-shots.mjs

import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITES = {
  'four-states-concrete': 'fourstatesconcreterepair.com',
  'shira-salon': 'shirasalon.com',
  'lumina-comfort': 'luminacomfort.com',
  'colorado-river-expeditions': 'coloradoriverexpeditions.com',
  'upscale-rails': 'upscalerails.com',
  'tank-it-easy': 'tankiteasyco.com',
  'topcore-it': 'topcoreit.com',
  'hike-wales': 'hikewales.com',
};

const outDir = join(ROOT, 'public', 'clients');
mkdirSync(outDir, { recursive: true });

const shot = (domain) =>
  `https://s.wordpress.com/mshots/v1/${encodeURIComponent(`https://${domain}`)}?w=1280&h=2400&vpw=1280&vph=2400`;

async function fetchShot(slug, domain) {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const res = await fetch(shot(domain), { redirect: 'follow' });
    const type = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    // A finished capture is a JPEG well past the size of the "generating" placeholder.
    if (res.ok && type.includes('jpeg') && buf.length > 40_000) {
      writeFileSync(join(outDir, `${slug}.jpg`), buf);
      return `${slug}: ${Math.round(buf.length / 1024)} KB`;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return `${slug}: no capture after 12 tries`;
}

const results = await Promise.all(Object.entries(SITES).map(([slug, domain]) => fetchShot(slug, domain)));
console.log(results.join('\n'));

const productsSrc = join(ROOT, '..', 'site', 'public', 'products');
const productsOut = join(ROOT, 'public', 'products');
mkdirSync(productsOut, { recursive: true });
for (const f of readdirSync(productsSrc)) copyFileSync(join(productsSrc, f), join(productsOut, f));
console.log(`copied ${readdirSync(productsOut).length} product shots`);
