// The library as the window sees it, kept in step with the engine.

import { create } from "zustand";
import { api, type DownloadState, type Library, type Tile, type Track } from "./api";
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
  removeFromPlaylist(id: string, trackId: string): Promise<void>;
  renamePlaylist(id: string, name: string): Promise<void>;
  deletePlaylist(id: string): Promise<void>;
  download(tracks: Track[]): Promise<void>;
  removeDownload(id: string): Promise<void>;
  setAutoplay(on: boolean): Promise<void>;
};

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

export const useLibrary = create<LibraryState>((set, get) => {
  const apply = (lib: Library) => set({ ...lib, loaded: true });

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
      // Show it at once; the engine's answer settles it.
      set({ likes: liked ? [t, ...get().likes] : get().likes.filter((x) => x.id !== t.id) });
      apply(await api.like(t, liked));
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

    async removeFromPlaylist(id, trackId) {
      apply(await api.removeFromPlaylist(id, trackId));
    },

    async renamePlaylist(id, name) {
      apply(await api.renamePlaylist(id, name));
    },

    async deletePlaylist(id) {
      apply(await api.deletePlaylist(id));
    },

    async download(tracks) {
      const todo = tracks.filter((t) => !get().downloads[t.id]);
      if (!todo.length) return;
      set({ downloadState: { ...get().downloadState, ...Object.fromEntries(todo.map((t) => [t.id, { state: "running" as const, progress: 0 }])) } });
      for (const t of todo) await api.download(t).catch(() => {});
      toast(todo.length === 1 ? `Downloading "${todo[0].title}"` : `Downloading ${todo.length} songs`);
      pollDownloads();
    },

    async removeDownload(id) {
      apply(await api.removeDownload(id));
    },

    async setAutoplay(on) {
      const settings = await api.settings({ autoplay: on });
      set({ settings });
    },
  };
});
