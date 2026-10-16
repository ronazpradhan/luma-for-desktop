import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { EyeOff, ListEnd, Pencil, Play, Shuffle, Trash2 } from "lucide-react";
import { api, type Playlist, type Track } from "../api";
import { useLibrary } from "../library";
import { useNav } from "../nav";
import { usePlayer } from "../player";
import { toast } from "../toast";
import { confirmAsk } from "./Confirm";

/** What was right-clicked: one of your playlists, a YouTube Music one, Liked songs or Downloads. */
export type MenuTarget =
  | { kind: "playlist"; id: string }
  | { kind: "youtube"; id: string; title: string }
  | { kind: "liked" }
  | { kind: "downloads" };

type MenuState = { target: MenuTarget | null; x: number; y: number; open(target: MenuTarget, x: number, y: number): void; close(): void };

export const usePlaylistMenu = create<MenuState>((set) => ({
  target: null,
  x: 0,
  y: 0,
  open: (target, x, y) => set({ target, x, y }),
  close: () => set({ target: null }),
}));

/** Right-click handler for any playlist row or tile. */
export const openPlaylistMenu = (target: MenuTarget) => (e: React.MouseEvent) => {
  e.preventDefault();
  usePlaylistMenu.getState().open(target, e.clientX, e.clientY);
};

/** Asked from the menu, the playlist page, or the Delete key on a playlist. */
export async function deletePlaylistAsk(p: Playlist) {
  const imported = p.source?.startsWith("spotify:");
  const ok = await confirmAsk({
    title: `Delete "${p.name}"?`,
    message: imported
      ? "Its songs stay in your library, and importing from Spotify again won't bring this playlist back."
      : "Its songs stay in your library.",
    action: "Delete playlist",
  });
  if (!ok) return;
  await useLibrary.getState().deletePlaylist(p.id);
  const nav = useNav.getState();
  if (nav.route.name === "playlist" && nav.route.id === p.id) nav.go({ name: "library" });
  toast(`Deleted "${p.name}"`);
}

/** A YouTube Music playlist leaves LUMA; it stays on YouTube, and Settings can bring it back. */
export async function hideYouTubeAsk(id: string, title: string) {
  const ok = await confirmAsk({
    title: `Remove "${title}" from LUMA?`,
    message: "It stays on your YouTube account. You can show it again from Settings › YouTube.",
    action: "Remove from LUMA",
  });
  if (!ok) return;
  await useLibrary.getState().hideYouTube(id, true);
  const nav = useNav.getState();
  if (nav.route.name === "ytplaylist" && nav.route.id === id) nav.go({ name: "library" });
  toast(`Removed "${title}" from LUMA`);
}

/** Set when Rename is chosen from the menu, so the playlist page opens its name for editing. */
export const useRenaming = create<{ id: string | null }>(() => ({ id: null }));

function shuffled(tracks: Track[]) {
  const a = [...tracks];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Right-click any playlist in the sidebar or the Library. */
export function PlaylistMenu() {
  const { target, x, y, close } = usePlaylistMenu();
  const lib = useLibrary();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!target || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(x, innerWidth - r.width - 8), top: Math.min(y, innerHeight - r.height - 8) });
    ref.current.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus();
  }, [target, x, y]);

  useEffect(() => {
    if (!target) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    addEventListener("mousedown", away);
    addEventListener("keydown", keys);
    addEventListener("blur", close);
    return () => {
      removeEventListener("mousedown", away);
      removeEventListener("keydown", keys);
      removeEventListener("blur", close);
    };
  }, [target, close]);

  if (!target) return null;
  const own = target.kind === "playlist" ? lib.playlists.find((p) => p.id === target.id) : undefined;
  if (target.kind === "playlist" && !own) return null;

  const name = own?.name ?? (target.kind === "youtube" ? target.title : target.kind === "liked" ? "Liked songs" : "Downloads");
  // YouTube Music playlists are read when needed; the others are already here.
  const tracks = async (): Promise<Track[]> => {
    if (own) return own.tracks;
    if (target.kind === "liked") return lib.likes;
    if (target.kind === "downloads") return Object.values(lib.downloads).sort((a, b) => b.at - a.at).map((d) => d.track);
    if (target.kind === "youtube") return (await api.ytPlaylist(target.id).catch(() => null))?.tracks ?? [];
    return [];
  };
  const withTracks = (fn: (t: Track[]) => void) => async () => {
    close();
    const list = await tracks();
    if (list.length) fn(list);
    else toast(`"${name}" has no songs to play`);
  };
  const act = (fn: () => void) => () => { close(); fn(); };
  const player = usePlayer.getState();
  const empty = own ? own.tracks.length === 0 : target.kind === "liked" ? lib.likes.length === 0 : target.kind === "downloads" ? Object.keys(lib.downloads).length === 0 : false;

  return (
    <div ref={ref} className="menu glass-raised" style={pos} role="menu" aria-label={name}>
      <button className="menu-item" role="menuitem" disabled={empty} onClick={withTracks((t) => player.playList(t, 0, name))}><Play size={16} /> Play</button>
      <button className="menu-item" role="menuitem" disabled={empty} onClick={withTracks((t) => player.playList(shuffled(t), 0, name))}><Shuffle size={16} /> Shuffle</button>
      <button className="menu-item" role="menuitem" disabled={empty} onClick={withTracks((t) => player.addToQueue(t))}><ListEnd size={16} /> Add to queue</button>
      {own && (
        <>
          <hr />
          <button className="menu-item" role="menuitem" onClick={act(() => { useRenaming.setState({ id: own.id }); useNav.getState().go({ name: "playlist", id: own.id }); })}><Pencil size={16} /> Rename</button>
          <button className="menu-item menu-destructive" role="menuitem" onClick={act(() => deletePlaylistAsk(own))}><Trash2 size={16} /> Delete playlist…</button>
        </>
      )}
      {target.kind === "youtube" && (
        <>
          <hr />
          <button className="menu-item menu-destructive" role="menuitem" onClick={act(() => hideYouTubeAsk(target.id, target.title))}><EyeOff size={16} /> Remove from LUMA…</button>
        </>
      )}
    </div>
  );
}
