import { useEffect, useState } from "react";
import { EyeOff, Pencil, Play, Shuffle, Trash2 } from "lucide-react";
import { api, type Track } from "../api";
import { DownloadGlyph, DownloadedBadge, Empty, Failed, PlaylistCover, SkeletonRows } from "../components/bits";
import { TrackList } from "../components/TrackList";
import { useLibrary } from "../library";
import { useNav } from "../nav";
import { usePlayer } from "../player";
import { useAsync } from "./common";
import { deletePlaylistAsk, hideYouTubeAsk, useRenaming } from "../components/PlaylistMenu";

type Header = { kind: string; title: string; subtitle?: string; art?: string | null; artistId?: string | null; artist?: string };

/** The page shape every list of songs shares: a header, the actions, the songs. */
function CollectionView({ header, tracks, label, showAlbum = true, numbered = false, playlistId, extra, empty }: {
  header: Header; tracks: Track[]; label: string; showAlbum?: boolean; numbered?: boolean; playlistId?: string; extra?: React.ReactNode; empty?: React.ReactNode;
}) {
  const player = usePlayer();
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const missing = tracks.filter((t) => !lib.downloads[t.id]);
  const total = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  const minutes = Math.round(total / 60);

  return (
    <div className="page">
      <header className="collection-head">
        <PlaylistCover art={header.art} tracks={tracks} name={header.title} size={220} className="collection-art" />
        <div className="collection-text">
          <span className="collection-kind">{header.kind}</span>
          <h1>{header.title}</h1>
          <p>
            {header.artistId ? <button className="link strong" onClick={() => go({ name: "artist", id: header.artistId! })}>{header.artist}</button> : header.artist}
            {header.subtitle && <span className="muted">{header.artist ? " · " : ""}{header.subtitle}</span>}
          </p>
          <p className="muted small">{tracks.length} {tracks.length === 1 ? "song" : "songs"}{minutes ? `, ${minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`}` : ""}</p>
        </div>
      </header>
      <div className="actions">
        <button className="btn btn-primary" disabled={!tracks.length} onClick={() => player.playList(tracks, 0, label)}><Play size={18} fill="currentColor" /> Play</button>
        <button className="btn" disabled={!tracks.length} onClick={() => { player.playList(tracks, Math.floor(Math.random() * tracks.length), label); if (!player.shuffle) player.toggleShuffle(); }}><Shuffle size={17} /> Shuffle</button>
        {tracks.length > 0 && (
          missing.length ? (
            <button className="btn" onClick={() => lib.download(missing)}>
              <DownloadGlyph size={17} /> {missing.length === tracks.length ? "Download all" : `Download ${missing.length} more`}
            </button>
          ) : (
            <span className="btn btn-done"><DownloadedBadge size={18} label="" /> All downloaded</span>
          )
        )}
        {extra}
      </div>
      {tracks.length ? <TrackList tracks={tracks} label={label} showAlbum={showAlbum} numbered={numbered} showArt={!numbered} playlistId={playlistId} /> : empty}
    </div>
  );
}

function Loading({ error, reload }: { error: string | null; reload(): void }) {
  if (error) return <div className="page"><Failed message={error} onRetry={reload} /></div>;
  return (
    <div className="page">
      <header className="collection-head">
        <span className="sk collection-art" />
        <div className="collection-text" style={{ flex: 1 }}>
          <span className="sk sk-thin" style={{ width: 80 }} />
          <span className="sk" style={{ width: "50%", height: 44 }} />
          <span className="sk sk-thin" style={{ width: 160 }} />
        </div>
      </header>
      <SkeletonRows count={10} />
    </div>
  );
}

export function AlbumPage({ id }: { id: string }) {
  const res = useAsync(() => api.album(id), [id]);
  if (!res.data) return <Loading error={res.error} reload={res.reload} />;
  const a = res.data;
  const kind = /single/i.test(a.subtitle) ? "Single" : /ep\b/i.test(a.subtitle) ? "EP" : "Album";
  const year = a.subtitle.match(/\b(19|20)\d{2}\b/)?.[0];
  return <CollectionView header={{ kind, title: a.title, art: a.art, artist: a.artist, artistId: a.artistId, subtitle: year }} tracks={a.tracks} label={a.title} showAlbum={false} numbered />;
}

export function YtPlaylistPage({ id }: { id: string }) {
  const res = useAsync(() => api.ytPlaylist(id), [id]);
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  if (!res.data) return <Loading error={res.error} reload={res.reload} />;
  const p = res.data;
  return (
    <CollectionView header={{ kind: "Playlist", title: p.title, art: p.art, subtitle: p.subtitle }} tracks={p.tracks} label={p.title}
      extra={
        <>
          <button className="btn" onClick={async () => { const nid = await lib.createPlaylist(p.title, p.tracks); if (nid) go({ name: "playlist", id: nid }); }}>Save to your music</button>
          {lib.youtubePlaylists.some((y) => y.id === id) && <button className="btn danger" onClick={() => hideYouTubeAsk(id)}><EyeOff size={16} /> Remove from LUMA</button>}
        </>
      } />
  );
}

export function PlaylistPage({ id }: { id: string }) {
  const lib = useLibrary();
  const renaming = useRenaming((s) => s.id === id);
  const [editing, setEditing] = useState(renaming);
  const p = lib.playlists.find((x) => x.id === id);
  useEffect(() => {
    if (renaming) { setEditing(true); useRenaming.setState({ id: null }); }
  }, [renaming]);
  if (!p) return <div className="page"><Empty title="This playlist is gone">It was deleted.</Empty></div>;
  return (
    <CollectionView
      header={{ kind: "Your playlist", title: p.name, art: p.art }}
      tracks={p.tracks}
      label={p.name}
      playlistId={p.id}
      empty={<Empty title="No songs yet">Right-click any song and choose Add to playlist.</Empty>}
      extra={
        <>
          {editing ? (
            <form className="rename" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("name"); lib.renamePlaylist(p.id, String(v)); setEditing(false); }}>
              <input name="name" defaultValue={p.name} autoFocus maxLength={120} aria-label="Playlist name" onBlur={(e) => { lib.renamePlaylist(p.id, e.target.value); setEditing(false); }} />
            </form>
          ) : (
            <button className="btn" onClick={() => setEditing(true)}><Pencil size={16} /> Rename</button>
          )}
          <button className="btn danger" onClick={() => deletePlaylistAsk(p)}><Trash2 size={16} /> Delete playlist</button>
        </>
      }
    />
  );
}

export function LikedPage() {
  const likes = useLibrary((s) => s.likes);
  return <CollectionView header={{ kind: "Your music", title: "Liked songs" }} tracks={likes} label="Liked songs" empty={<Empty title="No liked songs yet">Tap the heart on any song to keep it here.</Empty>} />;
}

export function DownloadsPage() {
  const downloads = useLibrary((s) => s.downloads);
  const tracks = Object.values(downloads).sort((a, b) => b.at - a.at).map((d) => d.track);
  const size = Object.values(downloads).reduce((s, d) => s + (d.size ?? 0), 0);
  return (
    <CollectionView header={{ kind: "On this PC", title: "Downloads", subtitle: size ? `${(size / 1_048_576).toFixed(0)} MB` : undefined }} tracks={tracks} label="Downloads"
      extra={tracks.length > 0 && <button className="btn danger" onClick={() => useLibrary.getState().clearDownloads()}><Trash2 size={16} /> Clear downloads</button>}
      empty={<Empty title="Nothing downloaded yet">Downloaded songs play without internet.</Empty>} />
  );
}
