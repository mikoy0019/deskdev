import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { Background, Overlays, SceneShell } from './components/Overlays';
import { SceneProvider } from './lib/scene';
import { SCENE_COMPONENTS } from './scenes';
import { BEATS, CROSSFADE, SCENES } from './timeline';

export type VslProps = { captions: boolean };

export const Vsl: React.FC<VslProps> = ({ captions }) => (
  <AbsoluteFill>
    <Background />
    {SCENES.map((scene) => {
      const Scene = SCENE_COMPONENTS[scene.id];
      const last = scene.index === SCENES.length - 1;
      return (
        <Sequence key={scene.id} name={scene.id} from={scene.start} durationInFrames={scene.frames + (last ? 0 : CROSSFADE)}>
          <SceneProvider value={scene}>
            <SceneShell>
              <Scene />
            </SceneShell>
          </SceneProvider>
        </Sequence>
      );
    })}
    {BEATS.map((beat) => (
      <Sequence key={`vo-${beat.id}`} name={`vo ${beat.id}`} from={beat.start} durationInFrames={beat.audioFrames + 6} layout="none">
        <Audio src={staticFile(beat.audio)} />
      </Sequence>
    ))}
    <Overlays captions={captions} />
  </AbsoluteFill>
);
