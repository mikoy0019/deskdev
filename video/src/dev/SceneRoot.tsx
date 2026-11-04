import React from 'react';
import { AbsoluteFill, Composition, Sequence } from 'remotion';
import { Background, Overlays, SceneShell } from '../components/Overlays';
import { SceneProvider } from '../lib/scene';
import { CROSSFADE, FPS, SCENES, type SceneId } from '../timeline';

type SceneMeta = {
  scene: SceneId;
  start: number;
  frames: number;
  beats: { id: string; offset: number; audioFrames: number; frames: number; words: { w: string; from: number; to: number }[] }[];
};

/**
 * A root with one composition, "scene-<id>", that renders a single scene exactly as
 * it appears in the video (background, HUD and captions included) on scene-local
 * frames. Each scene gets its own entry file, so a scene that doesn't compile yet
 * can't break anyone else's stills.
 */
export function sceneRoot(id: SceneId, Scene: React.ComponentType): React.FC {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`Unknown scene "${id}"`);
  const last = scene.index === SCENES.length - 1;
  const meta: SceneMeta = {
    scene: id,
    start: scene.start,
    frames: scene.frames,
    beats: scene.beats.map((b) => ({ id: b.id, offset: b.offset, audioFrames: b.audioFrames, frames: b.frames, words: b.words })),
  };

  const Stage: React.FC<{ meta: SceneMeta }> = () => (
    <AbsoluteFill>
      <Sequence from={-scene.start} layout="none">
        <Background />
      </Sequence>
      <SceneProvider value={scene}>
        <SceneShell>
          <Scene />
        </SceneShell>
      </SceneProvider>
      <Sequence from={-scene.start} layout="none">
        <Overlays />
      </Sequence>
    </AbsoluteFill>
  );

  return () => (
    <Composition
      id={`scene-${id}`}
      component={Stage}
      durationInFrames={scene.frames + (last ? 0 : CROSSFADE)}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ meta }}
    />
  );
}
