'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { VSL_CHAPTERS, VSL_DURATION } from './chapters';
import {
  chapterIndexAt,
  chapterMarks,
  chapterProgress,
  formatTime,
  keyAction,
  percentOf,
  seekTarget,
  seekValueText,
  spokenTime,
  type VslAction,
  type VslChapter,
  type VslKeyTarget,
} from './vslLogic';
import styles from './VslPlayer.module.css';

/* ═══════════════════════════════════════════════════════════════
   Homepage VSL player — the rendered film (video/, Remotion) with
   a chapter list beside it on desktop and below it on phones.
   - Never autoplays: poster + one large Play button until asked.
   - Captions are burned into the picture, so there is no <track>.
   - Every control is a real <button> / range input. While focus is
     anywhere in the player: Space/K play-pause, ←/→ 5 s, J/L 10 s,
     M mute, F full screen (see keyAction in vslLogic.ts).
   - Motion (hover scale, bar easing, spinner) stops under
     prefers-reduced-motion in VslPlayer.module.css.
   Assets come from video/scripts/export-site.mjs, which also writes
   chapters.ts — re-run it rather than editing the list by hand.
   The poster on the page is public/vsl/poster.webp: a 1280px WebP copy
   of the exported poster.jpg (23 KB against 290 KB). vsl.test.ts fails
   when poster.jpg changes without it, and says how to remake it.
   ═══════════════════════════════════════════════════════════════ */

export interface VslPlayerProps {
  src?: string;
  poster?: string;
  chapters?: readonly VslChapter[];
  /** Seconds; replaced by the file's own duration once its metadata loads. */
  duration?: number;
  /** What the film is, for the player's accessible name. */
  title?: string;
  className?: string;
}

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

const FS_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;
const subscribeFullscreen = (onChange: () => void) => {
  FS_EVENTS.forEach((e) => document.addEventListener(e, onChange));
  return () => FS_EVENTS.forEach((e) => document.removeEventListener(e, onChange));
};
const fullscreenElement = () => {
  const doc = document as FsDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
};

const keyTarget = (el: EventTarget): VslKeyTarget => {
  if (el instanceof HTMLInputElement && el.type === 'range') return 'slider';
  if (el instanceof HTMLButtonElement) return 'button';
  return 'other';
};

/* ── Icons (decorative; every button carries its own aria-label) ── */
const PlayIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
    <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z" />
  </svg>
);
const PauseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
const ReplayIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);
const VolumeIcon = ({ muted }: { muted: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
    {muted ? (
      <path d="m16 9 5 6M21 9l-5 6" />
    ) : (
      <>
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </>
    )}
  </svg>
);
const FullscreenIcon = ({ exit }: { exit: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    {exit ? (
      <path d="M9 3v4a2 2 0 0 1-2 2H3M21 9h-4a2 2 0 0 1-2-2V3M3 15h4a2 2 0 0 1 2 2v4M15 21v-4a2 2 0 0 1 2-2h4" />
    ) : (
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    )}
  </svg>
);

const pad = (n: number) => String(n).padStart(2, '0');

export function VslPlayer({
  src = '/vsl/nixgen-vsl.mp4',
  poster = '/vsl/poster.webp',
  chapters = VSL_CHAPTERS,
  duration: initialDuration = VSL_DURATION,
  title = 'NixGen overview',
  className = '',
}: VslPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const frameId = useId();
  const noteId = useId();

  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);

  const fullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => {
      const el = fullscreenElement();
      return el instanceof HTMLElement && el.dataset.vslFrame === frameId;
    },
    () => false,
  );

  // The file can fail while the page is still server HTML (preload="metadata"
  // starts before hydration); that error event is never replayed to onError.
  useEffect(() => {
    if (videoRef.current?.error) setFailed(true);
  }, []);

  const current = chapterIndexAt(chapters, time);
  const currentChapter = chapters[current];
  const showPoster = !started || ended;

  /* ── Commands ── */
  const play = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.ended) v.currentTime = 0;
    setStarted(true);
    // A source that failed gets a fresh attempt on each press. The message
    // stays up until a frame can play (onCanPlay), so a retry never flickers.
    if (v.error) v.load();
    v.play()?.catch(() => {
      setPlaying(false);
      if (v.error || v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) setFailed(true);
    });
  };
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) play();
    else v.pause();
  };
  const seek = (to: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = to;
    setTime(to);
    setStarted(true);
    setEnded(to >= duration);
  };
  const playChapter = (start: number) => {
    seek(start);
    play();
  };
  const toggleMute = () => {
    const v = videoRef.current;
    if (v) v.muted = !v.muted;
  };
  const toggleFullscreen = () => {
    const doc = document as FsDocument;
    if (fullscreenElement()) {
      (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
      return;
    }
    const frame = frameRef.current as FsElement | null;
    const request = frame?.requestFullscreen ?? frame?.webkitRequestFullscreen;
    if (frame && request) {
      Promise.resolve(request.call(frame)).catch(() => {});
      return;
    }
    // iPhone Safari: only the <video> itself can go full screen.
    (videoRef.current as IosVideo | null)?.webkitEnterFullscreen?.();
  };

  /** The big poster button goes away once playback starts; keep keyboard focus in the player. */
  const startFromPoster = () => {
    playRef.current?.focus({ preventScroll: true });
    play();
  };

  const run = (action: VslAction) => {
    const v = videoRef.current;
    switch (action.type) {
      case 'toggle':
        return toggle();
      case 'seekBy':
        return seek(seekTarget(v?.currentTime ?? time, action.seconds, duration));
      case 'seekTo':
        return seek(action.to === 'start' ? 0 : duration);
      case 'mute':
        return toggleMute();
      case 'fullscreen':
        return toggleFullscreen();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const action = keyAction(e, keyTarget(e.target));
    if (!action) return;
    e.preventDefault();
    run(action);
  };

  const pct = percentOf(time, duration);
  const marks = chapterMarks(chapters, duration);

  return (
    // The group only listens for the shortcuts that bubble up from its own buttons and slider.
    <div className={`${styles.root} ${className}`} role="group" aria-label={`${title} video`} onKeyDown={onKeyDown}>
      <div ref={frameRef} className={styles.frame} data-vsl-frame={frameId} data-fullscreen={fullscreen || undefined}>
        <div className={styles.stage} data-failed={failed || undefined}>
          {/* Pointer convenience: clicking the picture plays / pauses. The Play button below is the accessible control. */}
          <video
            ref={videoRef}
            className={styles.video}
            src={src}
            poster={poster}
            preload="metadata"
            playsInline
            aria-label={title}
            aria-describedby={noteId}
            onClick={toggle}
            onPlay={() => {
              setPlaying(true);
              setStarted(true);
              setEnded(false);
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setEnded(true);
              setWaiting(false);
            }}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onSeeked={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setDuration(d);
            }}
            onWaiting={() => setWaiting(true)}
            onPlaying={() => {
              setWaiting(false);
              setFailed(false);
            }}
            onCanPlay={() => {
              setWaiting(false);
              setFailed(false);
            }}
            onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
            onError={() => {
              setFailed(true);
              setPlaying(false);
              setWaiting(false);
            }}
          />
          <p id={noteId} className={styles.srOnly}>
            Captions are part of the picture.
          </p>

          {showPoster && !failed && (
            <button
              type="button"
              className={`${styles.overlay} ${ended ? styles.overlayEnded : ''}`}
              onClick={startFromPoster}
              aria-label={ended ? `Replay the ${title} video` : `Play the ${title} video, ${spokenTime(duration)}`}
            >
              {!ended && (
                <span className={styles.chip} aria-hidden>
                  <span className={styles.chipDot} />
                  Watch · {formatTime(duration)}
                </span>
              )}
              <span className={styles.disc} aria-hidden>
                {ended ? <ReplayIcon size={34} /> : <span className={styles.discPlay}><PlayIcon size={34} /></span>}
              </span>
            </button>
          )}

          {waiting && playing && !failed && <span className={styles.spinner} aria-hidden />}

          {failed && (
            <div className={styles.error} role="alert">
              <p>The video could not load.</p>
              <a className={styles.errorLink} href={src}>
                Open the video file
              </a>
            </div>
          )}
        </div>

        <div className={styles.controls}>
          <button
            ref={playRef}
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={toggle}
            aria-label={playing ? 'Pause' : ended ? 'Replay' : 'Play'}
          >
            {playing ? <PauseIcon /> : ended ? <ReplayIcon /> : <span className={styles.discPlay}><PlayIcon /></span>}
          </button>

          <div className={styles.seek} style={{ '--vsl-fill': pct / 100 } as CSSProperties}>
            <span className={styles.rail} aria-hidden />
            <span className={styles.fill} aria-hidden />
            {marks.map((m) => (
              <span key={m} className={styles.tick} style={{ left: `${m}%` }} aria-hidden />
            ))}
            <input
              type="range"
              className={styles.range}
              min={0}
              max={duration}
              step={0.1}
              value={Math.min(time, duration)}
              onChange={(e) => seek(Number(e.currentTarget.value))}
              aria-label="Seek"
              aria-valuetext={seekValueText(time, duration, currentChapter)}
            />
          </div>

          <span className={styles.time} aria-hidden>
            {formatTime(time)} <span className={styles.timeSep}>/</span> {formatTime(duration)}
          </span>

          <button type="button" className={styles.btn} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            <VolumeIcon muted={muted} />
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          >
            <FullscreenIcon exit={fullscreen} />
          </button>
        </div>
      </div>

      <nav className={styles.chapters} aria-label="Video chapters">
        <p className={styles.chaptersHead}>
          <span>Chapters</span>
          <span className={styles.chaptersCount}>{pad(chapters.length)}</span>
        </p>
        <ol className={styles.list}>
          {chapters.map((c, i) => {
            const isCurrent = started && i === current;
            const progress = isCurrent ? chapterProgress(chapters, i, time, duration) : 0;
            return (
              <li key={c.id} className={styles.item}>
                <button
                  type="button"
                  className={styles.chapter}
                  data-current={isCurrent || undefined}
                  data-done={(started && i < current) || undefined}
                  onClick={() => playChapter(c.start)}
                  aria-current={isCurrent ? 'true' : undefined}
                  aria-label={`Chapter ${i + 1}: ${c.title}, from ${spokenTime(c.start)}`}
                  style={{ '--vsl-progress': progress } as CSSProperties}
                >
                  <span className={styles.chapterIndex} aria-hidden>
                    {pad(i + 1)}
                  </span>
                  <span className={styles.chapterTitle}>{c.title}</span>
                  <span className={styles.chapterTime} aria-hidden>
                    {formatTime(c.start)}
                  </span>
                  <span className={styles.chapterBar} aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Announces each chapter once as playback reaches it. */}
      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {started && currentChapter ? `Chapter ${current + 1}: ${currentChapter.title}` : ''}
      </p>
    </div>
  );
}

export default VslPlayer;
