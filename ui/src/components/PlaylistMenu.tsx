import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { ListEnd, Pencil, Play, Shuffle, Trash2 } from "lucide-react";
import type { Playlist } from "../api";
import { useLibrary } from "../library";
import { useNav } from "../nav";
import { usePlayer } from "../player";
import { toast } from "../toast";
import { confirmAsk } from "./Confirm";

type MenuState = { id: string | null; x: number; y: number; open(id: string, x: number, y: number): void; close(): void };

export const usePlaylistMenu = create<MenuState>((set) => ({
  id: null,
  x: 0,
  y: 0,
  open: (id, x, y) => set({ id, x, y }),
  close: () => set({ id: null }),
}));

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

/** Set when Rename is chosen from the menu, so the playlist page opens its name for editing. */
export const useRenaming = create<{ id: string | null }>(() => ({ id: null }));

/** Right-click a playlist in the sidebar or the Library. */
export function PlaylistMenu() {
  const { id, x, y, close } = usePlaylistMenu();
  const p = useLibrary((s) => s.playlists.find((pl) => pl.id === id));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!p || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(x, innerWidth - r.width - 8), top: Math.min(y, innerHeight - r.height - 8) });
    ref.current.querySelector<HTMLButtonElement>(".menu-item")?.focus();
  }, [p, x, y]);

  useEffect(() => {
    if (!id) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".menu-item") ?? [])];
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
  }, [id, close]);

  if (!p) return null;
  const act = (fn: () => void) => () => { close(); fn(); };
  const player = usePlayer.getState();
  const empty = p.tracks.length === 0;

  return (
    <div ref={ref} className="menu glass" style={pos} role="menu" aria-label={p.name}>
      <button className="menu-item" role="menuitem" disabled={empty} onClick={act(() => player.playList(p.tracks, 0, p.name))}><Play size={16} /> Play</button>
      <button className="menu-item" role="menuitem" disabled={empty} onClick={act(() => player.playList([...p.tracks].sort(() => Math.random() - 0.5), 0, p.name))}><Shuffle size={16} /> Shuffle</button>
      <button className="menu-item" role="menuitem" disabled={empty} onClick={act(() => player.addToQueue(p.tracks))}><ListEnd size={16} /> Add to queue</button>
      <hr />
      <button className="menu-item" role="menuitem" onClick={act(() => { useRenaming.setState({ id: p.id }); useNav.getState().go({ name: "playlist", id: p.id }); })}><Pencil size={16} /> Rename</button>
      <button className="menu-item menu-destructive" role="menuitem" onClick={act(() => deletePlaylistAsk(p))}><Trash2 size={16} /> Delete playlist…</button>
    </div>
  );
}
