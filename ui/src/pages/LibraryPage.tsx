import { Download, Heart, Plus } from "lucide-react";
import { Art, Empty } from "../components/bits";
import { Shelf } from "../components/Shelf";
import { TrackList } from "../components/TrackList";
import { useLibrary } from "../library";
import { useNav } from "../nav";
import { deletePlaylistAsk, openPlaylistMenu } from "../components/PlaylistMenu";

export function LibraryPage() {
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const downloads = Object.keys(lib.downloads).length;
  const yt = lib.youtubePlaylists.filter((p) => !lib.settings.hiddenYouTube?.includes(p.id));
  return (
    <div className="page">
      <header className="page-hero">
        <h1 className="hello">Library</h1>
      </header>
      <section className="block">
        <div className="tile-grid">
          <button className="tile tile-special" onClick={() => go({ name: "liked" })} onContextMenu={openPlaylistMenu({ kind: "liked" })}>
            <div className="tile-art special liked"><Heart size={40} fill="currentColor" /></div>
            <div className="tile-title">Liked songs</div>
            <div className="tile-sub">{lib.likes.length} {lib.likes.length === 1 ? "song" : "songs"}</div>
          </button>
          <button className="tile tile-special" onClick={() => go({ name: "downloads" })} onContextMenu={openPlaylistMenu({ kind: "downloads" })}>
            <div className="tile-art special"><Download size={40} /></div>
            <div className="tile-title">Downloads</div>
            <div className="tile-sub">{downloads} {downloads === 1 ? "song" : "songs"}</div>
          </button>
          {lib.playlists.map((p) => (
            <button key={p.id} className="tile" onClick={() => go({ name: "playlist", id: p.id })}
              onContextMenu={openPlaylistMenu({ kind: "playlist", id: p.id })}
              onKeyDown={(e) => { if (e.key === "Delete") { e.preventDefault(); deletePlaylistAsk(p); } }}>
              <div className="tile-art"><Art src={p.art} /></div>
              <div className="tile-title">{p.name}</div>
              <div className="tile-sub">{p.tracks.length} {p.tracks.length === 1 ? "song" : "songs"}</div>
            </button>
          ))}
          <button className="tile tile-special" onClick={async () => { const id = await lib.createPlaylist("New playlist"); if (id) go({ name: "playlist", id }); }}>
            <div className="tile-art special dashed"><Plus size={40} /></div>
            <div className="tile-title">New playlist</div>
          </button>
        </div>
      </section>
      {yt.length > 0 && <Shelf title="From YouTube Music" items={yt} menu />}
      <section className="block">
        <h2 className="block-title">History</h2>
        {lib.history.length ? <TrackList tracks={lib.history.slice(0, 40).map((h) => h.track)} single /> : <Empty title="Nothing played yet">Songs you play show up here.</Empty>}
      </section>
    </div>
  );
}
