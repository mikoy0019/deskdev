import beatsFile from './beats.json';
import voiceover from './generated/voiceover.json';

export const FPS = 30;
/** Frames of silence before the first word, so the video doesn't open mid-sentence. */
export const PREROLL = 12;
/** Frames a scene stays on screen into the next one, for the crossfade between them. */
export const CROSSFADE = 12;

export type Word = {
  w: string;
  /** Frame the word starts, relative to its beat's start. */
  from: number;
  /** Frame the word ends, relative to its beat's start. */
  to: number;
};

export type Beat = {
  id: string;
  chapter: string;
  text: string;
  /** Voiceover file under public/. */
  audio: string;
  /** Absolute frame where this beat's voiceover starts. */
  start: number;
  /** Frames of spoken audio. */
  audioFrames: number;
  /** Frames the beat occupies: its audio plus the pause after it. */
  frames: number;
  words: Word[];
};

const voiceoverByBeat = new Map(voiceover.beats.map((b) => [b.id, b]));

let cursor = PREROLL;
export const BEATS: Beat[] = beatsFile.beats.map((b) => {
  const vo = voiceoverByBeat.get(b.id);
  if (!vo) throw new Error(`No voiceover for beat "${b.id}". Run: npm run voiceover`);
  const beat: Beat = {
    id: b.id,
    chapter: b.chapter,
    text: b.text,
    audio: vo.file,
    start: cursor,
    audioFrames: Math.ceil(vo.duration * FPS),
    frames: Math.round((vo.duration + b.gap) * FPS),
    words: vo.words.map((w) => ({ w: w.w, from: Math.round(w.s * FPS), to: Math.round(w.e * FPS) })),
  };
  cursor += beat.frames;
  return beat;
});

export const TOTAL_FRAMES = cursor;

export const SCENE_IDS = [
  'hook',
  'who',
  'leaks',
  'reframe',
  'offers',
  'websites',
  'automation',
  'apps',
  'devs',
  'proof',
  'process',
  'risk',
  'whofor',
  'cta',
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

const SCENE_BEATS: Record<SceneId, string[]> = {
  hook: ['hook'],
  who: ['who'],
  leaks: ['leak1', 'leak2', 'leak3', 'leak4'],
  reframe: ['reframe'],
  offers: ['offers'],
  websites: ['websites'],
  automation: ['automation'],
  apps: ['apps'],
  devs: ['devs'],
  proof: ['proof'],
  process: ['process'],
  risk: ['risk'],
  whofor: ['whofor'],
  cta: ['cta'],
};

export type SceneBeat = Beat & {
  /** Frame this beat starts, relative to its scene's start. */
  offset: number;
};

export type Scene = {
  id: SceneId;
  index: number;
  /** Absolute frame the scene starts. The first scene also covers the preroll. */
  start: number;
  /** Frames the scene owns, before the crossfade into the next one. */
  frames: number;
  beats: SceneBeat[];
};

export const SCENES: Scene[] = SCENE_IDS.map((id, index) => {
  const beats = SCENE_BEATS[id].map((beatId) => {
    const beat = BEATS.find((b) => b.id === beatId);
    if (!beat) throw new Error(`Scene "${id}" lists unknown beat "${beatId}"`);
    return beat;
  });
  const start = index === 0 ? 0 : beats[0].start;
  const last = beats[beats.length - 1];
  return {
    id,
    index,
    start,
    frames: last.start + last.frames - start,
    beats: beats.map((b) => ({ ...b, offset: b.start - start })),
  };
});

export type Chapter = { id: string; title: string; index: number; start: number; end: number };

export const CHAPTERS: Chapter[] = beatsFile.chapters.map((c, index) => {
  const beats = BEATS.filter((b) => b.chapter === c.id);
  const last = beats[beats.length - 1];
  return { id: c.id, title: c.title, index, start: index === 0 ? 0 : beats[0].start, end: last.start + last.frames };
});

/** The scenes that sit under the offer rail, in rail order. */
export const OFFER_SCENES: SceneId[] = ['websites', 'automation', 'apps', 'devs'];
