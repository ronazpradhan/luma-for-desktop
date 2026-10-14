import { Download, Heart, MoreHorizontal, Play } from "lucide-react";
import { formatTime, type Track } from "../api";
import { useLibrary } from "../library";
import { useNav } from "../nav";
import { usePlayer } from "../player";
import { Art, MoonPhase, Spinner } from "./bits";
import { useTrackMenu } from "./TrackMenu";

type Props = {
  tracks: Track[];
  /** Name of where these songs are from, shown in the player's queue. */
  label?: string;
  showArt?: boolean;
  showAlbum?: boolean;
  numbered?: boolean;
  playlistId?: string;
  /** Play only the tapped song (radio follows) instead of the whole list. */
  single?: boolean;
};

export function TrackList({ tracks, label, showArt = true, showAlbum = true, numbered = false, playlistId, single = false }: Props) {
  return (
    <div className={`tracks ${showAlbum ? "" : "tracks-no-album"}`} role="list">
      {tracks.map((t, i) => (
        <TrackRow key={`${t.id}-${i}`} track={t} index={i} numbered={numbered} showArt={showArt} showAlbum={showAlbum} playlistId={playlistId}
          onPlay={() => (single ? usePlayer.getState().playTrack(t) : usePlayer.getState().playList(tracks, i, label))} />
      ))}
    </div>
  );
}

function TrackRow({ track, index, numbered, showArt, showAlbum, playlistId, onPlay }: { track: Track; index: number; numbered: boolean; showArt: boolean; showAlbum: boolean; playlistId?: string; onPlay(): void }) {
  const isCurrent = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const playing = usePlayer((s) => isCurrent && s.playing);
  const loading = usePlayer((s) => isCurrent && s.loading);
  const progress = usePlayer((s) => (isCurrent && s.duration ? s.position / s.duration : 0));
  const liked = useLibrary((s) => s.likes.some((x) => x.id === track.id));
  const downloaded = useLibrary((s) => !!s.downloads[track.id]);
  const dl = useLibrary((s) => s.downloadState[track.id]);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const openMenu = useTrackMenu((s) => s.open);
  const go = useNav((s) => s.go);

  return (
    <div
      className={`row ${isCurrent ? "row-current" : ""}`}
      role="listitem"
      tabIndex={0}
      onClick={(e) => !(e.target as HTMLElement).closest("button") && onPlay()}
      onKeyDown={(e) => e.key === "Enter" && onPlay()}
      onContextMenu={(e) => { e.preventDefault(); openMenu(track, e.clientX, e.clientY, playlistId); }}
    >
      <div className="row-lead">
        {isCurrent ? (loading ? <Spinner size={14} /> : <MoonPhase progress={progress} playing={playing} />) : numbered ? <span className="row-num">{index + 1}</span> : null}
        <button className="row-play" onClick={onPlay} aria-label={`Play ${track.title}`}><Play size={14} fill="currentColor" /></button>
      </div>
      {showArt && <Art src={track.art} size={40} />}
      <div className="row-main">
        <div className="row-title">{track.title}</div>
        <div className="row-sub">
          {track.artistId ? <button className="link" onClick={() => go({ name: "artist", id: track.artistId! })}>{track.artist}</button> : track.artist}
        </div>
      </div>
      {showAlbum && (
        <div className="row-album">
          {track.albumId ? <button className="link" onClick={() => go({ name: "album", id: track.albumId! })}>{track.album}</button> : track.album}
        </div>
      )}
      <div className="row-tail">
        {dl?.state === "running" ? (
          <span className="dl-ring" style={{ ["--p" as string]: dl.progress }} aria-label="Downloading" />
        ) : downloaded ? (
          <Download size={14} className="row-downloaded" aria-label="Downloaded" />
        ) : null}
        <button className={`icon-btn row-like ${liked ? "is-on" : ""}`} onClick={() => toggleLike(track)} aria-label={liked ? "Remove from Liked songs" : "Add to Liked songs"} aria-pressed={liked}>
          <Heart size={16} fill={liked ? "currentColor" : "none"} />
        </button>
        <span className="row-time">{formatTime(track.duration)}</span>
        <button className="icon-btn row-more" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(track, r.left - 200, r.bottom + 4, playlistId); }} aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}
