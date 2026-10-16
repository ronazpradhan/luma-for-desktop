import { Heart, Maximize2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatTime } from "../api";
import { useLibrary } from "../library";
import { useNav } from "../nav";
import { usePlayer } from "../player";
import { Art, DownloadGlyph, DownloadedBadge, Spinner } from "./bits";

export function Seek({ className = "" }: { className?: string }) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const pct = duration ? (position / duration) * 100 : 0;
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  return (
    <div className={`seek ${className}`}>
      {hover && <span className="seek-tip" style={{ left: hover.x }}>{formatTime(hover.t)}</span>}
      <span className="seek-time">{formatTime(position)}</span>
      <input
        type="range"
        className="range"
        min={0}
        max={duration || 0}
        step={0.5}
        value={Math.min(position, duration || 0)}
        style={{ ["--fill" as string]: `${pct}%` }}
        onChange={(e) => seek(Number(e.target.value))}
        onPointerMove={(e) => {
          if (!duration) return;
          const r = e.currentTarget.getBoundingClientRect();
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
          const parent = e.currentTarget.parentElement!.getBoundingClientRect();
          setHover({ x: e.clientX - parent.left, t: f * duration });
        }}
        onPointerLeave={() => setHover(null)}
        aria-label="Seek"
        disabled={!duration}
      />
      <span className="seek-time">{formatTime(duration)}</span>
    </div>
  );
}

export function Transport({ big = false }: { big?: boolean }) {
  const p = usePlayer();
  const size = big ? 30 : 20;
  return (
    <div className={`transport ${big ? "transport-big" : ""}`}>
      <button className={`icon-btn ${p.shuffle ? "is-on" : ""}`} onClick={p.toggleShuffle} aria-label="Shuffle" title="Shuffle" aria-pressed={p.shuffle}><Shuffle size={big ? 20 : 17} /></button>
      <button className="icon-btn" onClick={p.previous} aria-label="Previous" title="Previous"><SkipBack size={size} fill="currentColor" /></button>
      <button className="play-btn" onClick={p.toggle} aria-label={p.playing ? "Pause" : "Play"} title={p.playing ? "Pause" : "Play"} disabled={!p.current()}>
        {p.loading ? <Spinner size={big ? 26 : 18} /> : p.playing ? <Pause size={size} fill="currentColor" /> : <Play size={size} fill="currentColor" />}
      </button>
      <button className="icon-btn" onClick={p.next} aria-label="Next" title="Next"><SkipForward size={size} fill="currentColor" /></button>
      <button className={`icon-btn ${p.repeat !== "off" ? "is-on" : ""}`} onClick={p.cycleRepeat} aria-label={p.repeat === "off" ? "Repeat" : p.repeat === "all" ? "Repeat all" : "Repeat one"} title={p.repeat === "off" ? "Repeat" : p.repeat === "all" ? "Repeat all" : "Repeat one"}>
        {p.repeat === "one" ? <Repeat1 size={big ? 20 : 17} /> : <Repeat size={big ? 20 : 17} />}
      </button>
    </div>
  );
}

/** Mute and a volume slider (in Now Playing). */
export function VolumeControl() {
  const p = usePlayer();
  const VolIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="volume-control">
      <button className="icon-btn" onClick={p.toggleMute} aria-label={p.muted ? "Unmute" : "Mute"} title={p.muted ? "Unmute" : "Mute"}><VolIcon size={18} /></button>
      <input type="range" className="range volume" min={0} max={1} step={0.01} value={p.muted ? 0 : p.volume} style={{ ["--fill" as string]: `${(p.muted ? 0 : p.volume) * 100}%` }} onChange={(e) => p.setVolume(Number(e.target.value))} aria-label="Volume" />
    </div>
  );
}

export function PlayerBar() {
  const p = usePlayer();
  const track = p.current();
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const liked = track ? lib.isLiked(track.id) : false;
  const dl = track ? lib.downloadState[track.id] : undefined;
  const downloaded = track ? !!lib.downloads[track.id] : false;
  // The whole pill is a seek bar: press or drag anywhere that isn't a button.
  const [scrub, setScrub] = useState<number | null>(null);
  const [hoverAt, setHoverAt] = useState<{ x: number; f: number } | null>(null);
  const progress = scrub ?? (p.duration ? Math.min(1, p.position / p.duration) : 0);
  const free = (e: React.PointerEvent) => !!p.duration && !(e.target as HTMLElement).closest("button, a, input");
  const fraction = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, f: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) };
  };

  // Scrolling over the pill turns the volume up or down, and shows the level for a moment.
  const pill = useRef<HTMLElement>(null);
  const [volumeShown, setVolumeShown] = useState(false);
  const [volumeUsed, setVolumeUsed] = useState(false);
  const hideVolume = useRef<number | undefined>(undefined);
  useEffect(() => {
    const el = pill.current;
    if (!el) return;
    // Not React's onWheel: that listener is passive, so the page would scroll too.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = usePlayer.getState();
      const step = (e.deltaY < 0 ? 1 : -1) * 0.05;
      s.setVolume(Math.round(((s.muted ? 0 : s.volume) + step) * 20) / 20);
      setVolumeUsed(true);
      setVolumeShown(true);
      clearTimeout(hideVolume.current);
      hideVolume.current = window.setTimeout(() => setVolumeShown(false), 450);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel); clearTimeout(hideVolume.current); };
  }, []);
  const level = p.muted ? 0 : p.volume;
  const VolIcon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2;

  // Always the small pill: the song, like, download and play controls. The
  // rest (seek, queue, lyrics, volume) is one click away in Now Playing.
  return (
    <footer
      ref={pill}
      title="Scroll to change the volume"
      className={`playerbar ${p.playing ? "" : "is-paused"} ${scrub != null ? "is-scrubbing" : ""} ${hoverAt ? "is-seekable" : ""}`}
      aria-label="Player"
      onPointerDown={(e) => {
        if (!free(e)) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setScrub(fraction(e).f);
      }}
      onPointerMove={(e) => {
        if (scrub != null) { const at = fraction(e); setScrub(at.f); setHoverAt(at); return; }
        setHoverAt(free(e) ? fraction(e) : null);
      }}
      onPointerUp={(e) => {
        if (scrub == null) return;
        p.seek(fraction(e).f * p.duration);
        setScrub(null);
      }}
      onPointerCancel={() => setScrub(null)}
      onPointerLeave={() => scrub == null && setHoverAt(null)}
    >
      {volumeUsed && (
        <span className={`pb-volume ${volumeShown ? "is-shown" : ""}`} role="status" aria-label={`Volume ${Math.round(level * 100)}%`}>
          <VolIcon size={15} />
          <span className="pb-volume-bar"><span style={{ width: `${level * 100}%` }} /></span>
          <b>{Math.round(level * 100)}</b>
        </span>
      )}
      {hoverAt && !volumeShown && <span className="pb-seek-tip" style={{ left: hoverAt.x }}>{formatTime(hoverAt.f * p.duration)}</span>}
      {/* The pill fills with the song's colour as it plays, like liquid. */}
      <span className={`pb-fluid ${progress > 0.002 ? "" : "is-empty"}`} style={{ ["--p" as string]: progress }} aria-hidden>
        <span className="pb-wave" />
      </span>
      <div className="pb-track">
        {track ? (
          <>
            <button key={track.id} className="pb-art" onClick={() => p.setNowPlaying(true)} aria-label="Open Now Playing" title="Open Now Playing">
              <Art src={track.art} size={44} />
              <span className="pb-expand"><Maximize2 size={14} /></span>
            </button>
            <div key={`t-${track.id}`} className="pb-text">
              <button className="pb-title" onClick={() => p.setNowPlaying(true)} title="Open Now Playing">{track.title}</button>
              <div className="pb-artist">
                {track.artistId ? <button className="link" onClick={() => go({ name: "artist", id: track.artistId! })}>{track.artist}</button> : track.artist}
              </div>
            </div>
          </>
        ) : (
          <div className="pb-idle">Pick a song to start</div>
        )}
      </div>
      <div className="pb-controls">
        {track && (
          <>
            <button className={`icon-btn pb-like ${liked ? "is-on" : ""}`} onClick={() => lib.toggleLike(track)} aria-label={liked ? "Remove from Liked songs" : "Add to Liked songs"} title={liked ? "Remove from Liked songs" : "Add to Liked songs"} aria-pressed={liked}>
              <Heart size={17} fill={liked ? "currentColor" : "none"} />
            </button>
            {dl?.state === "running" ? (
              <span className="downloaded-slot"><span className="dl-ring big" style={{ ["--p" as string]: dl.progress }} aria-label="Downloading" /></span>
            ) : downloaded ? (
              <span className="downloaded-slot"><DownloadedBadge size={18} label="Downloaded: plays without internet" /></span>
            ) : (
              <button className="icon-btn" onClick={() => lib.download([track])} aria-label="Download" title="Download"><DownloadGlyph size={17} /></button>
            )}
            <span className="pb-sep" aria-hidden />
          </>
        )}
        <Transport />
      </div>
    </footer>
  );
}
