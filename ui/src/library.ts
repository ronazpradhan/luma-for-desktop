// The library as the window sees it, kept in step with the engine.

import { create } from "zustand";
import { api, setKeepalive, type DownloadState, type Library, type Tile, type Track } from "./api";
import { toast } from "./toast";

type LibraryState = Library & {
  loaded: boolean;
  /** Your playlists in YouTube Music (Liked music first), when YouTube is connected. */
  youtubePlaylists: Tile[];
  loadYouTube(): Promise<void>;
  /** Removes a YouTube Music playlist from LUMA (or brings it back); YouTube itself is untouched. */
  hideYouTube(id: string, hidden: boolean): Promise<void>;
  downloadState: DownloadState;
  load(): Promise<void>;
  refreshSoon(): void;
  isLiked(id: string): boolean;
  toggleLike(t: Track): Promise<void>;
  createPlaylist(name: string, tracks?: Track[]): Promise<string | null>;
  addToPlaylist(id: string, tracks: Track[]): Promise<void>;
  removeFromPlaylist(id: string, trackId: string): void;
  renamePlaylist(id: string, name: string): Promise<void>;
  deletePlaylist(id: string): void;
  download(tracks: Track[]): Promise<void>;
  removeDownload(id: string): void;
  setAutoplay(on: boolean): Promise<void>;
};

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

const UNDO_MS = 5000;

/**
 * Removals wait 5 s before they reach the engine, so Undo can take them back
 * with nothing lost (a playlist keeps its place, a song its position). Until
 * then they're hidden from what the window shows.
 */
type Pending = { hide(lib: Library): Library; commit(): Promise<Library | void>; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();

export const useLibrary = create<LibraryState>((set, get) => {
  let raw: Library | null = null;
  const view = (lib: Library) => [...pending.values()].reduce((l, p) => p.hide(l), lib);
  const apply = (lib: Library) => { raw = lib; set({ ...view(lib), loaded: true }); };
  const reapply = () => raw && set({ ...view(raw) });

  /** Hides something now, removes it for real in 5 s, and offers Undo meanwhile. */
  function later(key: string, message: string, hide: Pending["hide"], commit: Pending["commit"]) {
    cancel(key);
    const p: Pending = {
      hide,
      commit,
      timer: setTimeout(async () => {
        pending.delete(key);
        const lib = await commit().catch(() => undefined);
        if (lib) apply(lib);
        else reapply();
      }, UNDO_MS),
    };
    pending.set(key, p);
    reapply();
    toast(message, { action: { label: "Undo", run: () => cancel(key) }, ms: UNDO_MS });
  }
  function cancel(key: string) {
    const p = pending.get(key);
    if (!p) return false;
    clearTimeout(p.timer);
    pending.delete(key);
    reapply();
    return true;
  }
  // Closing LUMA within the 5 s still carries the removals out.
  addEventListener("pagehide", () => {
    setKeepalive(true);
    for (const [key, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(key);
      p.commit().catch(() => {});
    }
  });

  function pollDownloads() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      const state = await api.downloads().catch(() => null);
      if (!state) return;
      set({ downloadState: state });
      if (!Object.values(state).some((d) => d.state === "running")) {
        clearInterval(pollTimer);
        pollTimer = undefined;
        get().load();
      }
    }, 700);
  }

  return {
    likes: [],
    playlists: [],
    history: [],
    downloads: {},
    settings: { autoplay: true, volume: 0.8, hiddenYouTube: [] },
    loaded: false,
    downloadState: {},
    youtubePlaylists: [],

    async loadYouTube() {
      const r = await api.youtubeLibrary().catch(() => null);
      set({ youtubePlaylists: r?.playlists ?? [] });
    },

    async hideYouTube(id, hidden) {
      const now = get().settings.hiddenYouTube ?? [];
      if (hidden) {
        const title = get().youtubePlaylists.find((p) => p.id === id)?.title ?? "playlist";
        toast(`Removed "${title}" from LUMA`, { action: { label: "Undo", run: () => { get().hideYouTube(id, false); } }, ms: UNDO_MS });
      }
      const next = hidden ? [...new Set([...now, id])] : now.filter((x) => x !== id);
      set({ settings: await api.settings({ hiddenYouTube: next }) });
    },

    async load() {
      apply(await api.library());
    },

    refreshSoon() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => get().load().catch(() => {}), 400);
    },

    isLiked: (id) => get().likes.some((t) => t.id === id),

    async toggleLike(t) {
      const liked = !get().isLiked(t.id);
      if (liked) {
        // Liking again while an unlike waits just cancels it: the song keeps its place.
        if (cancel(`unlike:${t.id}`)) return;
        set({ likes: [t, ...get().likes] });
        apply(await api.like(t, true));
        return;
      }
      later(`unlike:${t.id}`, "Removed from Liked songs",
        (lib) => ({ ...lib, likes: lib.likes.filter((x) => x.id !== t.id) }),
        () => api.like(t, false));
    },

    async createPlaylist(name, tracks = []) {
      const { created, library } = await api.createPlaylist(name, tracks);
      apply(library);
      toast(`Created "${created.name}"`);
      return created.id;
    },

    async addToPlaylist(id, tracks) {
      apply(await api.addToPlaylist(id, tracks));
      const p = get().playlists.find((x) => x.id === id);
      toast(tracks.length === 1 ? `Added to ${p?.name ?? "playlist"}` : `Added ${tracks.length} songs to ${p?.name ?? "playlist"}`);
    },

    removeFromPlaylist(id, trackId) {
      const name = get().playlists.find((p) => p.id === id)?.name ?? "playlist";
      later(`remove:${id}:${trackId}`, `Removed from "${name}"`,
        (lib) => ({ ...lib, playlists: lib.playlists.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p)) }),
        () => api.removeFromPlaylist(id, trackId));
    },

    async renamePlaylist(id, name) {
      apply(await api.renamePlaylist(id, name));
    },

    deletePlaylist(id) {
      const name = get().playlists.find((p) => p.id === id)?.name ?? "playlist";
      later(`delete:${id}`, `Deleted "${name}"`,
        (lib) => ({ ...lib, playlists: lib.playlists.filter((p) => p.id !== id) }),
        () => api.deletePlaylist(id));
    },

    async download(tracks) {
      const todo = tracks.filter((t) => !get().downloads[t.id]);
      if (!todo.length) return;
      set({ downloadState: { ...get().downloadState, ...Object.fromEntries(todo.map((t) => [t.id, { state: "running" as const, progress: 0 }])) } });
      for (const t of todo) await api.download(t).catch(() => {});
      toast(todo.length === 1 ? `Downloading "${todo[0].title}"` : `Downloading ${todo.length} songs`);
      pollDownloads();
    },

    removeDownload(id) {
      const title = get().downloads[id]?.track.title;
      later(`undownload:${id}`, title ? `Removed the download of "${title}"` : "Removed the download",
        (lib) => { const downloads = { ...lib.downloads }; delete downloads[id]; return { ...lib, downloads }; },
        () => api.removeDownload(id));
    },

    async setAutoplay(on) {
      const settings = await api.settings({ autoplay: on });
      set({ settings });
    },
  };
});
