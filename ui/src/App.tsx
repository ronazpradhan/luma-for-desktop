import { useEffect, useRef } from "react";
import { useTint } from "./color";
import { NowPlaying } from "./components/NowPlaying";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { Sidebar } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { TrackMenu } from "./components/TrackMenu";
import { useLibrary } from "./library";
import { useNav } from "./nav";
import { usePlayer } from "./player";
import { ArtistPage } from "./pages/ArtistPage";
import { AlbumPage, DownloadsPage, LikedPage, PlaylistPage, YtPlaylistPage } from "./pages/Collection";
import { Home } from "./pages/Home";
import { LibraryPage } from "./pages/LibraryPage";
import { Search } from "./pages/Search";
import { Settings } from "./pages/Settings";

function Page() {
  const route = useNav((s) => s.route);
  switch (route.name) {
    case "home": return <Home />;
    case "search": return <Search q={route.q} />;
    case "library": return <LibraryPage />;
    case "liked": return <LikedPage />;
    case "downloads": return <DownloadsPage />;
    case "album": return <AlbumPage id={route.id} />;
    case "artist": return <ArtistPage id={route.id} />;
    case "ytplaylist": return <YtPlaylistPage id={route.id} />;
    case "playlist": return <PlaylistPage id={route.id} />;
    case "settings": return <Settings />;
  }
}

export function App() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const npOpen = usePlayer((s) => s.nowPlayingOpen);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const tint = useTint(track?.art);
  const route = useNav((s) => s.route);
  const main = useRef<HTMLElement>(null);
  const load = useLibrary((s) => s.load);

  useEffect(() => {
    load().catch(() => {});
    useLibrary.getState().loadYouTube();
  }, [load]);
  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [route]);

  // The song's colour lights the whole window.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--glow", tint.glow);
    root.setProperty("--accent", tint.accent);
    root.setProperty("--glow-rgb", tint.rgb.join(" "));
  }, [tint]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      const p = usePlayer.getState();
      if (e.code === "Space") { e.preventDefault(); p.toggle(); }
      else if (e.ctrlKey && e.key === "ArrowRight") { e.preventDefault(); p.next(); }
      else if (e.ctrlKey && e.key === "ArrowLeft") { e.preventDefault(); p.previous(); }
      else if (e.ctrlKey && e.key === "ArrowUp") { e.preventDefault(); p.setVolume(p.volume + 0.05); }
      else if (e.ctrlKey && e.key === "ArrowDown") { e.preventDefault(); p.setVolume(p.volume - 0.05); }
      else if (e.ctrlKey && e.key.toLowerCase() === "l") { const t = p.current(); if (t) { e.preventDefault(); useLibrary.getState().toggleLike(t); } }
      else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); useNav.getState().back(); }
    };
    addEventListener("keydown", onKey);
    const onMouse = (e: MouseEvent) => e.button === 3 && useNav.getState().back();
    addEventListener("mouseup", onMouse);
    return () => { removeEventListener("keydown", onKey); removeEventListener("mouseup", onMouse); };
  }, []);

  return (
    <div className={`app ${queueOpen ? "with-queue" : ""}`}>
      <div className="ambient" aria-hidden />
      <Sidebar />
      <div className="center">
        <TopBar />
        <main className="main" ref={main} key={JSON.stringify(route)}>
          <Page />
        </main>
      </div>
      <QueuePanel />
      <PlayerBar />
      {npOpen && <NowPlaying />}
      <TrackMenu />
      <Toast />
    </div>
  );
}
