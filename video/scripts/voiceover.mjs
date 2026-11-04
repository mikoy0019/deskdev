// Generates the VSL voiceover, one audio file per beat, plus word timings the
// composition uses for captions and for cueing animations on spoken words.
//
//   node scripts/voiceover.mjs                 ElevenLabs (key from the repo's .env.local)
//   node scripts/voiceover.mjs --provider=sapi  Windows built-in voice, offline stand-in
//   node scripts/voiceover.mjs --only=hook,cta  regenerate some beats, keep the rest
//
// Output: public/vo/<beat>.(mp3|wav) and src/generated/voiceover.json.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../scripts/lib/env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The repo keeps one env file for every secret; scripts/lib/env.mjs finds it
// (root .env.local, then the legacy web/.env.local; DESKDEV_ENV_FILE overrides).
const FFPROBE = join(ROOT, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffprobe.exe');
const MANIFEST = join(ROOT, 'src', 'generated', 'voiceover.json');
const VO_DIR = join(ROOT, 'public', 'vo');

// "Eric": smooth, trustworthy American narration. Override with ELEVENLABS_VOICE_ID.
const DEFAULT_VOICE = 'cjVigY5qzO86Huf0OWal';
const MODEL = 'eleven_multilingual_v2';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

// A copy, so the key never lands in process.env (and the child processes below).
const env = { ...process.env };
loadEnv({ into: env });
const provider = args.provider ?? (env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'sapi');
const { beats } = JSON.parse(readFileSync(join(ROOT, 'src', 'beats.json'), 'utf8'));
const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;

/** Text as the voice should say it: `say` pairs swap display text for spoken text. */
const spoken = (beat) =>
  (beat.say ?? []).reduce((t, [show, say]) => t.split(show).join(say), beat.text);

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

/** Folds the spoken words of each `say` pair back into the single word shown on screen. */
function restoreDisplayWords(words, beat) {
  for (const [show, say] of beat.say ?? []) {
    const target = say.split(/\s+/).map(norm);
    for (let i = 0; i + target.length <= words.length; i++) {
      if (target.every((t, j) => norm(words[i + j].w) === t)) {
        const last = words[i + target.length - 1];
        const trailing = last.w.match(/[^A-Za-z0-9]*$/)[0];
        words.splice(i, target.length, { w: show + trailing, s: words[i].s, e: last.e });
      }
    }
  }
  return words;
}

function duration(file) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(String(out).trim());
}

/** Groups ElevenLabs character timings into words. */
function wordsFromAlignment({ characters, character_start_times_seconds: s, character_end_times_seconds: e }) {
  const words = [];
  let cur = null;
  characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      cur = null;
      return;
    }
    if (!cur) {
      cur = { w: '', s: s[i], e: e[i] };
      words.push(cur);
    }
    cur.w += ch;
    cur.e = e[i];
  });
  return words;
}

async function elevenlabs(beat, index) {
  const voice = env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        text: spoken(beat),
        model_id: MODEL,
        // Neighbouring beats keep intonation continuous across the per-beat files.
        previous_text: index > 0 ? spoken(beats[index - 1]) : undefined,
        next_text: index < beats.length - 1 ? spoken(beats[index + 1]) : undefined,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} on "${beat.id}": ${await res.text()}`);
  const body = await res.json();
  const file = join(VO_DIR, `${beat.id}.mp3`);
  writeFileSync(file, Buffer.from(body.audio_base64, 'base64'));
  return { file, voice, words: wordsFromAlignment(body.alignment) };
}

/** Windows SAPI stand-in: robotic, but offline and with real word timings. */
function sapi(targets) {
  const input = join(VO_DIR, '_sapi-input.json');
  writeFileSync(input, JSON.stringify(targets.map((b) => ({ id: b.id, text: spoken(b), out: join(VO_DIR, `${b.id}.wav`) }))));
  const out = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'sapi.ps1'), '-InputPath', input,
  ]);
  rmSync(input);
  return JSON.parse(String(out));
}

mkdirSync(VO_DIR, { recursive: true });
mkdirSync(dirname(MANIFEST), { recursive: true });

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { beats: [] };
const targets = beats.filter((b) => !only || only.has(b.id));
const generated = new Map();

if (provider === 'elevenlabs') {
  if (!env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not found in the env file (.env.local at the repo root)');
  for (const beat of targets) {
    const { file, voice, words } = await elevenlabs(beat, beats.indexOf(beat));
    generated.set(beat.id, { file, voice, words });
    console.log(`elevenlabs  ${beat.id.padEnd(8)} ${duration(file).toFixed(2)}s`);
  }
} else {
  for (const r of sapi(targets)) {
    generated.set(r.id, { file: r.out, voice: r.voice, words: r.words });
    console.log(`sapi        ${r.id.padEnd(8)} ${duration(r.out).toFixed(2)}s`);
  }
}

const manifest = {
  provider: only ? previous.provider : provider,
  beats: beats.map((beat) => {
    const g = generated.get(beat.id);
    if (!g) return previous.beats.find((p) => p.id === beat.id);
    const dur = duration(g.file);
    const words = restoreDisplayWords(g.words, beat);
    return {
      id: beat.id,
      file: `vo/${g.file.split(/[\\/]/).pop()}`,
      voice: g.voice,
      duration: Number(dur.toFixed(3)),
      words: words.map((w) => ({ w: w.w, s: Number(w.s.toFixed(3)), e: Number(Math.min(w.e, dur).toFixed(3)) })),
    };
  }),
};

if (manifest.beats.some((b) => !b)) throw new Error('Some beats have no audio yet; run without --only first.');
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
const total = manifest.beats.reduce((t, b) => t + b.duration, 0);
console.log(`\n${manifest.beats.length} beats, ${total.toFixed(1)}s of voiceover -> ${MANIFEST}`);
