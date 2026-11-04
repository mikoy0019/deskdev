// Exports the rendered VSL for the website.
//
//   npm run render          renders out/nixgen-vsl.mp4 (do this first)
//   npm run export:site     encodes it for the web and writes:
//     ../site/public/vsl/nixgen-vsl.mp4        H.264 yuv420p + AAC, faststart, < 24 MB
//     ../site/public/vsl/poster.jpg            from out/poster.jpg
//     ../site/src/components/vsl/chapters.ts   chapter list generated from src/timeline.ts
//
// Options: --crf=<n> starts the quality ladder at that CRF (default 26; the film grain makes lower CRFs overshoot).
//          --skip-video only regenerates the poster and chapters.
//
// Cloudflare Workers cap static assets at 25 MiB per file, so the encode walks up a CRF
// ladder until the file fits under MAX_BYTES (with a bitrate ceiling so no scene spikes).

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = resolve(ROOT, '..', 'site');
const SRC_VIDEO = join(ROOT, 'out', 'nixgen-vsl.mp4');
const SRC_POSTER = join(ROOT, 'out', 'poster.jpg');
const OUT_DIR = join(SITE, 'public', 'vsl');
const OUT_VIDEO = join(OUT_DIR, 'nixgen-vsl.mp4');
const OUT_POSTER = join(OUT_DIR, 'poster.jpg');
const OUT_CHAPTERS = join(SITE, 'src', 'components', 'vsl', 'chapters.ts');

const MAX_BYTES = 24 * 1000 * 1000;
const CRF_STEP = 1;
const CRF_MAX = 34;

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}`));
const startCrf = Number(flag('crf')?.split('=')[1] ?? 26);
const skipVideo = Boolean(flag('skip-video'));

const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB (${(bytes / 2 ** 20).toFixed(2)} MiB)`;

/** The ffmpeg/ffprobe that ship with Remotion's compositor for this platform. */
function remotionBinary(name) {
  const scope = join(ROOT, 'node_modules', '@remotion');
  const prefix = `compositor-${process.platform}-${process.arch}`;
  const dir = readdirSync(scope).find((d) => d.startsWith(prefix));
  if (!dir) throw new Error(`No Remotion compositor for ${process.platform}-${process.arch} in ${scope}`);
  const bin = join(scope, dir, process.platform === 'win32' ? `${name}.exe` : name);
  if (!existsSync(bin)) throw new Error(`Missing ${bin}`);
  return bin;
}

function run(bin, argv) {
  const res = spawnSync(bin, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    process.stderr.write(res.stderr ?? '');
    throw new Error(`${bin} exited with ${res.status}`);
  }
  return res;
}

function probeDuration(file) {
  const res = run(remotionBinary('ffprobe'), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  return Number(res.stdout.trim());
}

function encodeVideo() {
  if (!existsSync(SRC_VIDEO)) throw new Error(`Render the video first: ${SRC_VIDEO} not found (npm run render)`);
  mkdirSync(OUT_DIR, { recursive: true });
  const ffmpeg = remotionBinary('ffmpeg');
  const tmp = `${OUT_VIDEO}.tmp.mp4`;
  console.log(`source  ${SRC_VIDEO}  ${mb(statSync(SRC_VIDEO).size)}  ${probeDuration(SRC_VIDEO).toFixed(2)} s`);

  for (let crf = startCrf; crf <= CRF_MAX; crf += CRF_STEP) {
    process.stdout.write(`encode  crf ${crf} ... `);
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', SRC_VIDEO,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
      '-maxrate', '2500k', '-bufsize', '5000k',
      // Remotion's render is full-range BT.601 (yuvj420p); browsers expect limited-range BT.709.
      '-vf', 'scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p',
      // A keyframe every 2 s so chapter jumps seek quickly.
      '-g', '60', '-keyint_min', '30',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
      '-movflags', '+faststart',
      tmp,
    ]);
    const size = statSync(tmp).size;
    console.log(mb(size));
    if (size < MAX_BYTES) {
      rmSync(OUT_VIDEO, { force: true });
      renameSync(tmp, OUT_VIDEO);
      console.log(`wrote   ${OUT_VIDEO}  ${mb(size)}  ${probeDuration(OUT_VIDEO).toFixed(2)} s`);
      return;
    }
  }
  rmSync(tmp, { force: true });
  throw new Error(`Could not get the video under ${mb(MAX_BYTES)} even at CRF ${CRF_MAX}`);
}

function copyPoster() {
  if (!existsSync(SRC_POSTER)) throw new Error(`Render the poster first: ${SRC_POSTER} not found`);
  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(SRC_POSTER, OUT_POSTER);
  console.log(`wrote   ${OUT_POSTER}  ${mb(statSync(OUT_POSTER).size)}`);
}

/** Loads src/timeline.ts (TypeScript + JSON imports) through esbuild. */
async function loadTimeline() {
  const result = await build({
    entryPoints: [join(ROOT, 'src', 'timeline.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const tmp = join(ROOT, 'out', `.timeline-${process.pid}.mjs`);
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    rmSync(tmp, { force: true });
  }
}

async function writeChapters() {
  const { CHAPTERS, FPS, TOTAL_FRAMES } = await loadTimeline();
  const round = (s) => Math.round(s * 100) / 100;
  const chapters = CHAPTERS.map((c) => ({ id: c.id, title: c.title, start: round(c.start / FPS) }));
  const duration = round(TOTAL_FRAMES / FPS);
  const body = chapters
    .map((c) => `  { id: ${JSON.stringify(c.id)}, title: ${JSON.stringify(c.title)}, start: ${c.start} },`)
    .join('\n');
  const source = `// Generated by video/scripts/export-site.mjs from video/src/timeline.ts. Do not edit by hand.
// Re-run \`npm run export:site\` in video/ after changing the voiceover or the beats.

export const VSL_CHAPTERS: { id: string; title: string; start: number /* seconds */ }[] = [
${body}
];

/** Length of the video in seconds. */
export const VSL_DURATION = ${duration};
`;
  mkdirSync(dirname(OUT_CHAPTERS), { recursive: true });
  writeFileSync(OUT_CHAPTERS, source);
  console.log(`wrote   ${OUT_CHAPTERS}  (${chapters.length} chapters, ${duration} s)`);
}

if (!skipVideo) encodeVideo();
copyPoster();
await writeChapters();
