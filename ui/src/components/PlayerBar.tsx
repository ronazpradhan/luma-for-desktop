import { Heart, ListMusic, Maximize2, Mic2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
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

export function PlayerBar() {
  const p = usePlayer();
  const track = p.current();
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const liked = track ? lib.isLiked(track.id) : false;
  const dl = track ? lib.downloadState[track.id] : undefined;
  const downloaded = track ? !!lib.downloads[track.id] : false;
  const VolIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;

  // A small pill until you reach for it: hovering (or tabbing into it) opens
  // the full player, which waits a moment before shrinking back.
  const [open, setOpen] = useState(false);
  const closing = useRef<number | undefined>(undefined);
  const show = () => { clearTimeout(closing.current); setOpen(true); };
  const hide = () => { clearTimeout(closing.current); closing.current = window.setTimeout(() => setOpen(false), 700); };
  useEffect(() => () => clearTimeout(closing.current), []);
  const progress = p.duration ? Math.min(1, p.position / p.duration) : 0;

  return (
    <footer
      className={`playerbar ${open ? "is-open" : ""}`}
      aria-label="Player"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) hide(); }}
    >
      <span className="pb-progress" style={{ ["--p" as string]: progress }} aria-hidden />
      <div className="pb-track">
        {track ? (
          <>
            <button key={track.id} className="pb-art" onClick={() => p.setNowPlaying(true)} aria-label="Open Now Playing" title="Open Now Playing">
              <Art src={track.art} size={56} />
              <span className="pb-expand"><Maximize2 size={16} /></span>
            </button>
            <div key={`t-${track.id}`} className="pb-text">
              <button className="pb-title" onClick={() => p.setNowPlaying(true)}>{track.title}</button>
              <div className="pb-artist">
                {track.artistId ? <button className="link" onClick={() => go({ name: "artist", id: track.artistId! })}>{track.artist}</button> : track.artist}
              </div>
            </div>
            <button className={`icon-btn pb-like ${liked ? "is-on" : ""}`} onClick={() => lib.toggleLike(track)} aria-label={liked ? "Remove from Liked songs" : "Add to Liked songs"} title={liked ? "Remove from Liked songs" : "Add to Liked songs"} aria-pressed={liked}>
              <Heart size={18} fill={liked ? "currentColor" : "none"} />
            </button>
          </>
        ) : (
          <div className="pb-idle">Pick a song to start</div>
        )}
      </div>
      <div className="pb-center">
        <Transport />
        <Seek />
      </div>
      <div className="pb-right">
        {track && (
          dl?.state === "running" ? (
            <span className="dl-ring big" style={{ ["--p" as string]: dl.progress }} aria-label="Downloading" />
          ) : (
            downloaded ? (
              <span className="downloaded-slot"><DownloadedBadge size={20} label="Downloaded: plays without internet" /></span>
            ) : (
              <button className="icon-btn" onClick={() => lib.download([track])} aria-label="Download" title="Download">
                <DownloadGlyph size={19} />
              </button>
            )
          )
        )}
        <button className={`icon-btn ${p.nowPlayingOpen ? "is-on" : ""}`} onClick={() => p.setNowPlaying(!p.nowPlayingOpen)} aria-label="Lyrics" title="Lyrics" disabled={!track}><Mic2 size={18} /></button>
        <button className={`icon-btn ${p.queueOpen ? "is-on" : ""}`} onClick={() => p.setQueueOpen(!p.queueOpen)} aria-label="Queue" title="Queue"><ListMusic size={18} /></button>
        <button className="icon-btn" onClick={p.toggleMute} aria-label={p.muted ? "Unmute" : "Mute"} title={p.muted ? "Unmute" : "Mute"}><VolIcon size={18} /></button>
        <input type="range" className="range volume" min={0} max={1} step={0.01} value={p.muted ? 0 : p.volume} style={{ ["--fill" as string]: `${(p.muted ? 0 : p.volume) * 100}%` }} onChange={(e) => p.setVolume(Number(e.target.value))} aria-label="Volume" />
      </div>
    </footer>
  );
}
