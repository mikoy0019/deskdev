import { createContext, useContext } from 'react';
import type { Scene, SceneBeat, Word } from '../timeline';

const SceneContext = createContext<Scene | null>(null);
export const SceneProvider = SceneContext.Provider;

export function useScene(): Scene {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error('useScene() must be called inside a scene');
  return scene;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export type CueOptions = {
  /** Only search this beat (for scenes with several beats). */
  beat?: string;
  /** Which occurrence, when the phrase is spoken more than once. 0 = first. */
  nth?: number;
  /** Frames to add to the result (negative = earlier). */
  offset?: number;
};

type Match = { beat: SceneBeat; first: Word; last: Word };

function find(scene: Scene, phrase: string, opts: CueOptions): Match {
  const tokens = phrase.split(/\s+/).map(norm).filter(Boolean);
  const beats = opts.beat ? scene.beats.filter((b) => b.id === opts.beat) : scene.beats;
  if (!tokens.length) throw new Error(`Empty cue phrase in scene "${scene.id}"`);
  if (opts.beat && !beats.length) throw new Error(`Scene "${scene.id}" has no beat "${opts.beat}"`);
  let seen = 0;
  for (const beat of beats) {
    const words = beat.words.map((w) => norm(w.w));
    for (let i = 0; i + tokens.length <= words.length; i++) {
      if (tokens.every((t, j) => words[i + j] === t)) {
        if (seen === (opts.nth ?? 0)) return { beat, first: beat.words[i], last: beat.words[i + tokens.length - 1] };
        seen++;
      }
    }
  }
  const spoken = beats.map((b) => b.words.map((w) => w.w).join(' ')).join(' | ');
  throw new Error(`Cue "${phrase}" is not spoken in scene "${scene.id}". Spoken: ${spoken}`);
}

/**
 * Times animations to the voiceover. All results are scene-local frames, the same
 * clock as useCurrentFrame() inside a scene. A phrase that isn't spoken throws, so
 * a typo fails the render instead of silently mistiming.
 *
 *   const { cue, cueEnd } = useCue();
 *   const showChip = cue('instant reply');        // when "instant" starts
 *   const settle = cueEnd('book appointments');    // when "appointments" ends
 */
export function useCue() {
  const scene = useScene();
  const beatById = (id: string) => {
    const beat = scene.beats.find((b) => b.id === id);
    if (!beat) throw new Error(`Scene "${scene.id}" has no beat "${id}"`);
    return beat;
  };
  return {
    scene,
    cue: (phrase: string, opts: CueOptions = {}) => {
      const m = find(scene, phrase, opts);
      return m.beat.offset + m.first.from + (opts.offset ?? 0);
    },
    cueEnd: (phrase: string, opts: CueOptions = {}) => {
      const m = find(scene, phrase, opts);
      return m.beat.offset + m.last.to + (opts.offset ?? 0);
    },
    /** Scene-local frame where a beat's voiceover starts. */
    beatStart: (id: string) => beatById(id).offset,
    /** Scene-local frame where a beat ends (its audio plus the pause after it). */
    beatEnd: (id: string) => {
      const beat = beatById(id);
      return beat.offset + beat.frames;
    },
  };
}
