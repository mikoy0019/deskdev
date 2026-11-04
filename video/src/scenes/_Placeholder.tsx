import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Eyebrow, Headline } from '../components/Text';
import { useScene } from '../lib/scene';
import { LAYOUT } from '../theme';

/** Stand-in until a scene is built: its id and first spoken sentence. */
export const Placeholder: React.FC = () => {
  const scene = useScene();
  const first = scene.beats[0].text.split(/(?<=[.:])\s/)[0];
  return (
    <AbsoluteFill style={{ padding: `${LAYOUT.top + 60}px ${LAYOUT.padX}px` }}>
      <Eyebrow index={String(scene.index + 1).padStart(2, '0')} at={4}>
        {scene.id} (placeholder)
      </Eyebrow>
      <Headline text={first} size="h2" at={8} maxWidth={1400} style={{ marginTop: 32 }} />
    </AbsoluteFill>
  );
};
