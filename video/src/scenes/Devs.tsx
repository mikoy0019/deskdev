import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Eyebrow, Headline } from '../components/Text';
import { CLAMP, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { LAYOUT } from '../theme';
import { CARD_W, type DevsTiming } from './devs/kit';
import { ProfileCard } from './devs/ProfileCard';
import { ReportCard } from './devs/ReportCard';

const GAP = 40;
const LEFT_X = LAYOUT.padX;
const RIGHT_X = LEFT_X + CARD_W + GAP;
/** The profile card starts centred, alone, then makes room for the report. */
const CENTER_X = (LAYOUT.width - CARD_W) / 2;
const CARD_TOP = 422;

/**
 * 04 Dedicated developers. "And fourth, dedicated developers. When you need ongoing
 * help, you get your own NixGen developer, full-time, part-time or on call,
 * reporting to you every day."
 */
const Devs: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, scene } = useCue();

  const reporting = cue('reporting', { offset: 3 });
  const t: DevsTiming = {
    eyebrow: cue('And', { offset: 2 }),
    headline: cue('fourth', { offset: 2 }),
    card: cue('dedicated developers', { offset: -2 }),
    online: cue('ongoing help', { offset: -4 }),
    yours: cue('your own', { offset: -4 }),
    engage: cue('NixGen developer', { offset: -2 }),
    full: cue('full-time', { offset: -4 }),
    part: cue('part-time', { offset: -5 }),
    onCall: cue('on call', { offset: -5 }),
    split: cue('on call', { offset: 10 }),
    neutral: reporting + 12,
    report: cue('reporting to you every day', { offset: -5 }),
    lines: [reporting, reporting + 6, reporting + 12],
    week: cue('day', { offset: 4 }),
  };

  // Slow drift so nothing sits frozen; the headline moves less than the cards.
  const end = scene.frames + 12;
  const drift = interpolate(frame, [0, end], [10, -14], CLAMP);
  const headDrift = interpolate(frame, [0, end], [4, -6], CLAMP);
  const slide = springAt(frame, t.split, { stiffness: 60 });

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: LAYOUT.offerTop, transform: `translateY(${headDrift}px)` }}>
        <Eyebrow index="04" at={t.eyebrow} style={{ justifyContent: 'center' }}>
          Dedicated developers
        </Eyebrow>
        <Headline text="Your own *developer.*" size="h2" at={t.headline} align="center" style={{ marginTop: 20 }} />
      </div>
      <div style={{ position: 'absolute', inset: 0, transform: `translateY(${drift}px)` }}>
        <div style={{ position: 'absolute', zIndex: 1, left: LEFT_X, top: CARD_TOP, transform: `translateX(${(CENTER_X - LEFT_X) * (1 - slide)}px)` }}>
          <ProfileCard t={t} />
        </div>
        <div style={{ position: 'absolute', left: RIGHT_X, top: CARD_TOP }}>
          <ReportCard t={t} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default Devs;
