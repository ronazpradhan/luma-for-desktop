import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Heart, ListMusic } from "lucide-react";
import { api, img, type Lyrics } from "../api";
import { useLibrary } from "../library";
import { useNav } from "../nav";
import { usePlayer } from "../player";
import { Art, Spinner } from "./bits";
import { Seek, SourceBadge, Transport } from "./PlayerBar";

/** Full-window player: the art large on the left, lyrics that follow the song on the right. */
export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const track = usePlayer((s) => s.queue[s.index] ?? null);
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

  return (
    <div className="np" role="dialog" aria-label="Now Playing">
      {bg && <div className="np-backdrop" style={{ backgroundImage: `url("${bg}")` }} />}
      <div className="np-veil" />
      <header className="np-top">
        <button className="icon-btn round" onClick={() => setOpen(false)} aria-label="Close Now Playing"><ChevronDown size={22} /></button>
        <span className="np-from">{usePlayer.getState().sourceLabel ?? ""}</span>
        <button className={`icon-btn round ${queueOpen ? "is-on" : ""}`} onClick={() => setQueueOpen(!queueOpen)} aria-label="Queue"><ListMusic size={20} /></button>
      </header>
      <div className="np-body">
        <section className="np-left">
          <Art src={track.art} className="np-art" />
          <div className="np-meta">
            <div className="np-titles">
              <h1>{track.title}</h1>
              <p>
                {track.artistId ? <button className="link" onClick={() => { setOpen(false); go({ name: "artist", id: track.artistId! }); }}>{track.artist}</button> : track.artist}
                {track.album && <> · {track.albumId ? <button className="link" onClick={() => { setOpen(false); go({ name: "album", id: track.albumId! }); }}>{track.album}</button> : track.album}</>}
              </p>
            </div>
            <div className="np-actions">
              <SourceBadge />
              {dl?.state === "running" ? (
                <span className="dl-ring big" style={{ ["--p" as string]: dl.progress }} aria-label="Downloading" />
              ) : (
                <button className={`icon-btn round ${downloaded ? "is-on" : ""}`} disabled={downloaded} onClick={() => lib.download([track])} aria-label={downloaded ? "Downloaded" : "Download"}><Download size={20} /></button>
              )}
              <button className={`icon-btn round ${liked ? "is-on" : ""}`} onClick={() => lib.toggleLike(track)} aria-label={liked ? "Remove from Liked songs" : "Add to Liked songs"} aria-pressed={liked}>
                <Heart size={20} fill={liked ? "currentColor" : "none"} />
              </button>
            </div>
          </div>
          <Seek className="np-seek" />
          <Transport big />
        </section>
        <LyricsPane />
      </div>
    </div>
  );
}

function LyricsPane() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const position = usePlayer((s) => s.position);
  const seek = usePlayer((s) => s.seek);
  const [lyrics, setLyrics] = useState<Lyrics | "loading">("loading");
  const box = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  useEffect(() => {
    if (!track) return;
    let alive = true;
    setLyrics("loading");
    setUserScrolled(false);
    api.lyrics(track).then((l) => alive && setLyrics(l)).catch(() => alive && setLyrics(null));
    return () => { alive = false; };
  }, [track?.id]);

  const active = useMemo(() => {
    if (!lyrics || lyrics === "loading" || !lyrics.synced) return -1;
    let i = -1;
    // A little ahead, so the line lights as it is sung rather than after.
    for (let k = 0; k < lyrics.lines.length; k++) if ((lyrics.lines[k].time ?? 0) <= position + 0.25) i = k;
    return i;
  }, [lyrics, position]);

  useEffect(() => {
    if (active < 0 || userScrolled || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, userScrolled]);

  // Scrolling by hand pauses following for a few seconds.
  useEffect(() => {
    if (!userScrolled) return;
    const t = setTimeout(() => setUserScrolled(false), 4000);
    return () => clearTimeout(t);
  }, [userScrolled]);

  return (
    <section className="lyrics" ref={box} onWheel={() => setUserScrolled(true)} aria-label="Lyrics">
      {lyrics === "loading" ? (
        <div className="lyrics-note"><Spinner /> Finding lyrics</div>
      ) : !lyrics ? (
        <div className="lyrics-note">No lyrics for this song yet.</div>
      ) : (
        <>
          {!lyrics.synced && <div className="lyrics-hint">These lyrics aren't timed to the song.</div>}
          {lyrics.lines.map((l, i) => (
            <p
              key={i}
              data-line={i}
              className={`lyric ${lyrics.synced ? "lyric-synced" : ""} ${i === active ? "is-active" : ""} ${active >= 0 && i < active ? "is-past" : ""} ${!l.text ? "lyric-gap" : ""}`}
              onClick={() => lyrics.synced && l.time != null && seek(l.time)}
            >
              {l.text || "♪"}
            </p>
          ))}
          <div className="lyrics-credit">Lyrics from LRCLIB or YouTube Music</div>
        </>
      )}
    </section>
  );
}
