import { ArrowDownCircle, Download, Heart, Home, Library, Plus, Search, Settings } from "lucide-react";
import { installUpdate, useUpdate } from "../update";
import { dismissToast, useToast } from "../toast";
import { useLibrary } from "../library";
import { useNav, type Route } from "../nav";
import { Art } from "./bits";
import { deletePlaylistAsk, hideYouTubeAsk, openPlaylistMenu } from "./PlaylistMenu";

export function Sidebar() {
  const route = useNav((s) => s.route);
  const go = useNav((s) => s.go);
  const playlists = useLibrary((s) => s.playlists);
  const allYt = useLibrary((s) => s.youtubePlaylists);
  const hidden = useLibrary((s) => s.settings.hiddenYouTube);
  const ytPlaylists = allYt.filter((p) => !hidden?.includes(p.id));
  const likes = useLibrary((s) => s.likes.length);
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const update = useUpdate();
  const undo = useToast();

  const item = (r: Route, icon: React.ReactNode, label: string) => (
    <button className={`nav-item ${route.name === r.name ? "is-active" : ""}`} onClick={() => go(r)} title={label} aria-current={route.name === r.name ? "page" : undefined}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <aside className="sidebar glass">
      <div className="brand">
        <img src="./logo.svg" alt="" width={30} height={30} />
        <span>LUMA</span>
      </div>
      <nav className="nav">
        {item({ name: "home" }, <Home size={18} />, "Home")}
        {item({ name: "search" }, <Search size={18} />, "Search")}
        {item({ name: "library" }, <Library size={18} />, "Library")}
      </nav>
      <div className="side-section">
        <div className="side-head">
          <span>Your music</span>
          <button className="icon-btn" aria-label="New playlist" title="New playlist" onClick={async () => { const id = await createPlaylist("New playlist"); if (id) go({ name: "playlist", id }); }}>
            <Plus size={16} />
          </button>
        </div>
        <div className="side-list">
          <button className={`side-row ${route.name === "liked" ? "is-active" : ""}`} onClick={() => go({ name: "liked" })} onContextMenu={openPlaylistMenu({ kind: "liked" })} title="Liked songs" aria-current={route.name === "liked" ? "page" : undefined}>
            <span className="side-icon liked"><Heart size={15} fill="currentColor" /></span>
            <span className="side-text"><b>Liked songs</b><small>{likes} {likes === 1 ? "song" : "songs"}</small></span>
          </button>
          <button className={`side-row ${route.name === "downloads" ? "is-active" : ""}`} onClick={() => go({ name: "downloads" })} onContextMenu={openPlaylistMenu({ kind: "downloads" })} title="Downloads" aria-current={route.name === "downloads" ? "page" : undefined}>
            <span className="side-icon"><Download size={15} /></span>
            <span className="side-text"><b>Downloads</b><small>On this PC</small></span>
          </button>
          {ytPlaylists.map((p) => (
            <button key={`yt-${p.id}`} className={`side-row ${route.name === "ytplaylist" && route.id === p.id ? "is-active" : ""}`} onClick={() => go({ name: "ytplaylist", id: p.id })} title={p.title}
              aria-current={route.name === "ytplaylist" && route.id === p.id ? "page" : undefined}
              onContextMenu={openPlaylistMenu({ kind: "youtube", id: p.id, title: p.title })}
              onKeyDown={(e) => { if (e.key === "Delete") { e.preventDefault(); hideYouTubeAsk(p.id); } }}>
              {p.id === "LM" ? <span className="side-icon yt"><Heart size={15} fill="currentColor" /></span> : <Art src={p.art} size={36} />}
              <span className="side-text"><b>{p.title}</b><small>YouTube Music</small></span>
            </button>
          ))}
          {playlists.map((p) => (
            <button key={p.id} className={`side-row ${route.name === "playlist" && route.id === p.id ? "is-active" : ""}`} onClick={() => go({ name: "playlist", id: p.id })} title={p.name}
              aria-current={route.name === "playlist" && route.id === p.id ? "page" : undefined}
              onContextMenu={openPlaylistMenu({ kind: "playlist", id: p.id })}
              onKeyDown={(e) => { if (e.key === "Delete") { e.preventDefault(); deletePlaylistAsk(p); } }}>
              <Art src={p.art} size={36} />
              <span className="side-text"><b>{p.name}</b><small>{p.tracks.length} {p.tracks.length === 1 ? "song" : "songs"}</small></span>
            </button>
          ))}
        </div>
      </div>
      {update.state === "ready" && (
        <button className="nav-item update-ready" onClick={installUpdate} title={`Restart to update to LUMA ${update.version}`}>
          <ArrowDownCircle size={18} />
          <span>Restart to update</span>
        </button>
      )}
      {undo.action && undo.message && (
        <div key={undo.seq} className="side-undo" role="status" title={undo.message}>
          <span>{undo.message}</span>
          <button className="toast-action" onClick={() => { undo.action?.run(); dismissToast(); }}>{undo.action.label}</button>
          <span className="toast-timer" aria-hidden />
        </div>
      )}
      {item({ name: "settings" }, <Settings size={18} />, "Settings")}
    </aside>
  );
}
