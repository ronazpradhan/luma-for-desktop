import { useEffect } from "react";
import { ChevronDown, Download, Heart, ListMusic } from "lucide-react";
import { img } from "../api";
import { useLibrary } from "../library";
import { useNav } from "../nav";
import { usePlayer } from "../player";
import { Art } from "./bits";
import { LyricsPane } from "./Lyrics";
import { Seek, SourceBadge, Transport } from "./PlayerBar";

/** Full-window player: the art large on the left, lyrics that follow the song on the right. */
export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const next = usePlayer((s) => s.queue[s.index + 1] ?? null);
  const playing = usePlayer((s) => s.playing || s.loading);
  const sourceLabel = usePlayer((s) => s.sourceLabel);
  const setOpen = usePlayer((s) => s.setNowPlaying);
  const setQueueOpen = usePlayer((s) => s.setQueueOpen);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const lib = useLibrary();
  const go = useNav((s) => s.go);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open, setOpen]);

  if (!open || !track) return null;
  const liked = lib.isLiked(track.id);
  const downloaded = !!lib.downloads[track.id];
  const dl = lib.downloadState[track.id];
  const bg = img(track.art);
  const leave = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div className="np" role="dialog" aria-label="Now Playing">
      {bg && <div key={track.id} className="np-backdrop" style={{ backgroundImage: `url("${bg}")` }} />}
      <div className="np-veil" />
      <header className="np-top">
        <button className="icon-btn round" onClick={() => setOpen(false)} aria-label="Close Now Playing"><ChevronDown size={22} /></button>
        <span className="np-from">{sourceLabel ? `Playing from ${sourceLabel}` : ""}</span>
        <button className={`icon-btn round ${queueOpen ? "is-on" : ""}`} onClick={() => setQueueOpen(!queueOpen)} aria-label="Queue"><ListMusic size={20} /></button>
      </header>
      <div className="np-body">
        <section className="np-left">
          <div className={`np-art-wrap ${playing ? "" : "is-paused"}`}>
            <Art key={track.id} src={track.art} className="np-art" />
          </div>
          <div className="np-meta">
            <div className="np-titles">
              <h1 key={track.id}>{track.title}</h1>
              <p>
                {track.artistId ? <button className="link" onClick={leave(() => go({ name: "artist", id: track.artistId! }))}>{track.artist}</button> : track.artist}
                {track.album && <> · {track.albumId ? <button className="link" onClick={leave(() => go({ name: "album", id: track.albumId! }))}>{track.album}</button> : track.album}</>}
              </p>
            </div>
            <div className="np-actions">
              <SourceBadge />
              {dl?.state === "running" ? (
                <span className="dl-ring big" style={{ ["--p" as string]: dl.progress }} aria-label="Downloading" />
              ) : (
                <button className={`icon-btn round ${downloaded ? "is-on" : ""}`} disabled={downloaded} onClick={() => lib.download([track])} aria-label={downloaded ? "Downloaded" : "Download"}><Download size={20} /></button>
              )}
              <button className={`icon-btn round heart ${liked ? "is-on" : ""}`} onClick={() => lib.toggleLike(track)} aria-label={liked ? "Remove from Liked songs" : "Add to Liked songs"} aria-pressed={liked}>
                <Heart size={20} fill={liked ? "currentColor" : "none"} />
              </button>
            </div>
          </div>
          <Seek className="np-seek" />
          <Transport big />
          {next && (
            <button className="np-next glass" onClick={() => usePlayer.getState().next()}>
              <Art src={next.art} size={40} />
              <span><small>Up next</small><b>{next.title}</b><small>{next.artist}</small></span>
            </button>
          )}
        </section>
        <LyricsPane track={track} />
      </div>
    </div>
  );
}
