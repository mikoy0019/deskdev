import React from 'react';
import { interpolateColors, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../../components/Icon';
import { Card } from '../../components/Surfaces';
import { EASE, mix, progress, springAt } from '../../lib/motion';
import { COLOR, FONT, RADIUS, SHADOW, TYPE } from '../../theme';
import { Avatar, CARD_H, CARD_W, MonoLabel, tint, type DevsTiming } from './kit';

const PAD = 36;
const INNER_W = CARD_W - PAD * 2;
const AVATAR = 112;
const SKILLS_Y = PAD + AVATAR + 28;
const SKILLS_H = 50;
const PILL_H = 44;
/** Height before the engagement section unfolds. */
const COMPACT_H = SKILLS_Y + SKILLS_H + PAD;
const DIVIDER_Y = SKILLS_Y + SKILLS_H + 30;
const LABEL_Y = DIVIDER_Y + 28;
const CONTROL_Y = LABEL_Y + 24 + 14;
const CONTROL_H = 68;
const FULL_H = CONTROL_Y + CONTROL_H + PAD;
/**
 * While compact, the card sits centred in the content zone (y 400–880 at a 422 top);
 * it rises to the shared top as the engagement section unfolds.
 */
const COMPACT_LIFT = Math.round((400 + 880) / 2 - COMPACT_H / 2 - 422);

const SKILLS: { label: string; icon: IconName }[] = [
  { label: 'Websites', icon: 'layout' },
  { label: 'Automation', icon: 'bolt' },
  { label: 'Apps', icon: 'chart' },
];

const OPTIONS = ['Full-time', 'Part-time', 'On call'];

/** Fade + short slide for the small pieces inside the card. */
function enter(frame: number, at: number, dur = 16) {
  return progress(frame, at, dur, EASE.out);
}

/** The highlight slides to each option on its word; labels brighten as it arrives. */
const Segmented: React.FC<{ t: DevsTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const inset = 5;
  const seg = (INNER_W - 2 - inset * 2) / 3;
  const thumbIn = springAt(frame, t.full, { stiffness: 170 });
  const pos = springAt(frame, t.part, { stiffness: 150 }) + springAt(frame, t.onCall, { stiffness: 150 });
  // Once all three have been named, the highlight widens over the whole control and
  // softens, so the closing hold reads as "any of the three", not "on call only".
  const n = progress(frame, t.neutral, 22, EASE.inOut);
  const thumbLeft = mix(inset + pos * seg, inset, n);
  const thumbW = mix(seg, seg * 3, n);
  return (
    <div
      style={{
        position: 'relative',
        width: INNER_W,
        height: CONTROL_H,
        boxSizing: 'border-box',
        borderRadius: RADIUS.md,
        background: tint(COLOR.fg, 0.035),
        border: `1px solid ${COLOR.line2}`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: inset,
          left: thumbLeft,
          width: thumbW,
          height: CONTROL_H - 2 - inset * 2,
          boxSizing: 'border-box',
          borderRadius: RADIUS.md - inset,
          background: interpolateColors(n, [0, 1], [COLOR.accent, tint(COLOR.accent, 0.16)]),
          border: `1px solid ${interpolateColors(n, [0, 1], [tint(COLOR.accent, 0), tint(COLOR.accent, 0.5)])}`,
          opacity: thumbIn,
          transform: `scale(${0.9 + 0.1 * thumbIn})`,
        }}
      >
        {/* The glow belongs to the single selection; it fades as the highlight widens. */}
        <div style={{ position: 'absolute', inset: -1, borderRadius: RADIUS.md - inset, boxShadow: SHADOW.accent, opacity: 1 - n }} />
      </div>
      <div style={{ position: 'absolute', inset, display: 'flex' }}>
        {OPTIONS.map((label, i) => {
          const on = thumbIn * Math.max(0, 1 - Math.abs(pos - i));
          return (
            <div
              key={label}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONT.body,
                fontWeight: 500,
                fontSize: 26,
                letterSpacing: '-0.01em',
                color: interpolateColors(n, [0, 1], [interpolateColors(on, [0, 1], [COLOR.fg2, COLOR.accentFg]), COLOR.fg]),
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * "Your NixGen developer": arrives compact (avatar, role, skills), goes Online on
 * "ongoing help", takes the accent border on "your own", then unfolds the
 * Full-time | Part-time | On call control just before those words are spoken.
 */
export const ProfileCard: React.FC<{ t: DevsTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const shown = progress(frame, t.card, 26, EASE.out);
  const unfold = springAt(frame, t.engage, { stiffness: 90 });
  const height = mix(COMPACT_H, FULL_H, unfold);
  const glow = progress(frame, t.yours, 24, EASE.out);

  // Presence: dot pops on "ongoing help", then a soft ping repeats so the card stays alive.
  const dot = springAt(frame, t.online, { damping: 14, stiffness: 160 });
  const since = frame - t.online;
  const ping = since >= 0 ? (since % 54) / 40 : 1;
  const pingT = Math.min(1, ping);

  const avatarIn = enter(frame, t.card + 4, 20);
  const labelIn = enter(frame, t.card + 7);
  const roleIn = enter(frame, t.card + 9);
  const onlineIn = enter(frame, t.online + 2);
  const dividerIn = progress(frame, t.engage + 5, 18, EASE.inOut);
  const engageLabelIn = enter(frame, t.engage + 7);
  const controlIn = enter(frame, t.engage + 9, 18);
  const metaIn = enter(frame, t.card + 23);

  return (
    <div
      style={{
        position: 'relative',
        width: CARD_W,
        height: CARD_H,
        opacity: shown,
        transform: `translateY(${(1 - shown) * 36 + COMPACT_LIFT * (1 - unfold)}px) scale(${0.97 + 0.03 * shown})`,
        transformOrigin: '50% 0%',
      }}
    >
      {/* Accent depth behind the card once it is "yours". */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: CARD_W, height, borderRadius: RADIUS.lg, boxShadow: SHADOW.accent, opacity: glow }} />
      <Card padding={0} style={{ position: 'absolute', left: 0, top: 0, width: CARD_W, height, boxSizing: 'border-box' }}>
        {/* Identity row */}
        <div style={{ position: 'absolute', left: PAD, top: PAD, display: 'flex', alignItems: 'center', gap: 28 }}>
          <div style={{ opacity: avatarIn, transform: `scale(${0.86 + 0.14 * avatarIn})` }}>
            <Avatar size={AVATAR} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <MonoLabel style={{ opacity: labelIn, transform: `translateY(${(1 - labelIn) * 10}px)` }}>Your NixGen developer</MonoLabel>
            <div style={{ ...TYPE.h3, color: COLOR.fg, opacity: roleIn, transform: `translateY(${(1 - roleIn) * 12}px)` }}>Senior developer</div>
          </div>
        </div>

        {/* Presence: a status pill top-right, so the identity row spans the card. */}
        <div
          style={{
            position: 'absolute',
            right: PAD,
            top: PAD + AVATAR / 2 - PILL_H / 2,
            height: PILL_H,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 20px 0 16px',
            borderRadius: RADIUS.pill,
            background: tint(COLOR.success, 0.08),
            border: `1px solid ${tint(COLOR.success, 0.32)}`,
            opacity: onlineIn,
            transform: `translateX(${(1 - onlineIn) * 14}px)`,
          }}
        >
          <div style={{ position: 'relative', width: 14, height: 14, transform: `scale(${dot})` }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: `2px solid ${COLOR.success}`,
                opacity: since >= 0 ? 0.5 * (1 - pingT) : 0,
                transform: `scale(${1 + 1.4 * pingT})`,
              }}
            />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: COLOR.success }} />
          </div>
          <div style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 24, lineHeight: '28px', color: COLOR.success }}>Online</div>
        </div>

        {/* Skills */}
        <div style={{ position: 'absolute', left: PAD, top: SKILLS_Y, height: SKILLS_H, display: 'flex', alignItems: 'center', gap: 12 }}>
          {SKILLS.map((s, i) => {
            const p = enter(frame, t.card + 11 + i * 4);
            return (
              <div
                key={s.label}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 20px',
                  borderRadius: RADIUS.pill,
                  background: tint(COLOR.fg, 0.05),
                  border: `1px solid ${COLOR.line2}`,
                  color: COLOR.fg2,
                  fontFamily: FONT.body,
                  fontWeight: 500,
                  fontSize: 22,
                  lineHeight: '28px',
                  opacity: p,
                  transform: `translateY(${(1 - p) * 12}px)`,
                }}
              >
                <Icon name={s.icon} size={20} color={COLOR.accentText} />
                {s.label}
              </div>
            );
          })}
        </div>

        <MonoLabel
          style={{
            position: 'absolute',
            right: PAD,
            top: SKILLS_Y + (SKILLS_H - 24) / 2,
            opacity: metaIn,
            transform: `translateY(${(1 - metaIn) * 10}px)`,
          }}
        >
          Dedicated
        </MonoLabel>

        {/* Engagement */}
        <div
          style={{
            position: 'absolute',
            left: PAD,
            top: DIVIDER_Y,
            width: INNER_W,
            height: 1,
            background: COLOR.line2,
            transform: `scaleX(${dividerIn})`,
            transformOrigin: '0 50%',
          }}
        />
        <MonoLabel
          style={{ position: 'absolute', left: PAD, top: LABEL_Y, opacity: engageLabelIn, transform: `translateY(${(1 - engageLabelIn) * -10}px)` }}
        >
          Engagement
        </MonoLabel>
        <div style={{ position: 'absolute', left: PAD, top: CONTROL_Y, opacity: controlIn, transform: `translateY(${(1 - controlIn) * -14}px)` }}>
          <Segmented t={t} />
        </div>
      </Card>
      {/* Accent border drawn over the card's hairline. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: CARD_W,
          height,
          boxSizing: 'border-box',
          borderRadius: RADIUS.lg,
          border: `1px solid ${tint(COLOR.accent, 0.6)}`,
          opacity: glow,
        }}
      />
    </div>
  );
};
