import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Check, Disc3, Download, Heart, ListEnd, ListPlus, Mic2, Plus, Radio, Trash2, User } from "lucide-react";
import { api, type Track } from "../api";
import { useLibrary } from "../library";
import { useNav } from "../nav";
import { usePlayer } from "../player";

type MenuState = { track: Track | null; x: number; y: number; playlistId: string | null; open(t: Track, x: number, y: number, playlistId?: string | null): void; close(): void };

export const useTrackMenu = create<MenuState>((set) => ({
  track: null,
  x: 0,
  y: 0,
  playlistId: null,
  open: (track, x, y, playlistId = null) => set({ track, x, y, playlistId }),
  close: () => set({ track: null }),
}));

/** The one song menu (right-click a row, or its ⋯ button). */
export function TrackMenu() {
  const { track, x, y, playlistId, close } = useTrackMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [picking, setPicking] = useState(false);
  const lib = useLibrary();
  const player = usePlayer();
  const go = useNav((s) => s.go);

  useLayoutEffect(() => {
    if (!track || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(x, innerWidth - r.width - 8), top: Math.min(y, innerHeight - r.height - 8) });
  }, [track, x, y, picking]);

  useEffect(() => {
    if (!track) return setPicking(false);
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    addEventListener("mousedown", away);
    addEventListener("keydown", esc);
    addEventListener("blur", close);
    return () => {
      removeEventListener("mousedown", away);
      removeEventListener("keydown", esc);
      removeEventListener("blur", close);
    };
  }, [track, close]);

  if (!track) return null;
  const act = (fn: () => void) => () => { fn(); close(); };
  const liked = lib.isLiked(track.id);
  const downloaded = !!lib.downloads[track.id];

  return (
    <div ref={ref} className="menu glass" style={pos} role="menu">
      {picking ? (
        <>
          <button className="menu-item" role="menuitem" onClick={act(async () => { const id = await lib.createPlaylist("New playlist", [track]); if (id) go({ name: "playlist", id }); })}>
            <Plus size={16} /> New playlist
          </button>
          <hr />
          {lib.playlists.map((p) => {
            const has = p.tracks.some((t) => t.id === track.id);
            return (
              <button key={p.id} className="menu-item" role="menuitem" disabled={has} onClick={act(() => lib.addToPlaylist(p.id, [track]))}>
                {has ? <Check size={16} /> : <span className="menu-gap" />} {p.name}
              </button>
            );
          })}
        </>
      ) : (
        <>
          <button className="menu-item" role="menuitem" onClick={act(() => player.playNext(track))}><ListPlus size={16} /> Play next</button>
          <button className="menu-item" role="menuitem" onClick={act(() => player.addToQueue([track]))}><ListEnd size={16} /> Add to queue</button>
          <button className="menu-item" role="menuitem" onClick={act(() => startRadio(track))}><Radio size={16} /> Start radio</button>
          <hr />
          <button className="menu-item" role="menuitem" onClick={act(() => lib.toggleLike(track))}><Heart size={16} fill={liked ? "currentColor" : "none"} /> {liked ? "Remove from Liked songs" : "Add to Liked songs"}</button>
          <button className="menu-item" role="menuitem" onClick={() => setPicking(true)}><Plus size={16} /> Add to playlist</button>
          {playlistId && (
            <button className="menu-item" role="menuitem" onClick={act(() => lib.removeFromPlaylist(playlistId, track.id))}><Trash2 size={16} /> Remove from this playlist</button>
          )}
          {downloaded ? (
            <button className="menu-item" role="menuitem" onClick={act(() => lib.removeDownload(track.id))}><Trash2 size={16} /> Remove download</button>
          ) : (
            <button className="menu-item" role="menuitem" onClick={act(() => lib.download([track]))}><Download size={16} /> Download</button>
          )}
          {(track.albumId || track.artistId) && <hr />}
          {track.albumId && <button className="menu-item" role="menuitem" onClick={act(() => go({ name: "album", id: track.albumId! }))}><Disc3 size={16} /> Go to album</button>}
          {track.artistId && <button className="menu-item" role="menuitem" onClick={act(() => go({ name: "artist", id: track.artistId! }))}><User size={16} /> Go to artist</button>}
          {player.current()?.id === track.id && (
            <button className="menu-item" role="menuitem" onClick={act(() => player.setNowPlaying(true))}><Mic2 size={16} /> Show lyrics</button>
          )}
        </>
      )}
    </div>
  );
}

async function startRadio(track: Track) {
  const radio = await api.radio(track.id).catch(() => []);
  usePlayer.getState().playList([track, ...radio.filter((t) => t.id !== track.id)], 0, `${track.title} radio`);
}
