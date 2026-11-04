import React from 'react';
import { Composition } from 'remotion';
import { FPS, TOTAL_FRAMES } from './timeline';
import { Vsl } from './Vsl';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="NixGenVSL"
    component={Vsl}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
    defaultProps={{ captions: true }}
  />
);
