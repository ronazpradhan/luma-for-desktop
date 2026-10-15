// The window's line to LUMA's engine. In the desktop app the per-launch key
// comes from the preload bridge; in development the Vite proxy adds it.

export type Track = {
  kind?: "song";
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  album?: string | null;
  albumId?: string | null;
  duration?: number | null;
  art?: string | null;
};

export type Tile =
  | (Track & { kind: "song" })
  | { kind: "album" | "playlist" | "artist"; id: string; title: string; subtitle?: string; art?: string | null };

export type Shelf = { title: string; items: Tile[] };
export type Album = { id: string; title: string; subtitle: string; artist: string; artistId: string | null; art: string | null; tracks: Track[] };
export type YtPlaylist = { id: string; title: string; subtitle: string; art: string | null; tracks: Track[] };
export type Artist = { id: string; name: string; art: string | null; about: string; songs: Track[]; shelves: Shelf[] };
export type SearchResults = { songs: Track[]; albums: Tile[]; artists: Tile[] };
export type Playlist = { id: string; name: string; tracks: Track[]; createdAt: number; art: string | null };
export type Library = {
  likes: Track[];
  playlists: Playlist[];
  history: { track: Track; at: number }[];
  downloads: Record<string, { track: Track; at: number; size: number }>;
  settings: { autoplay: boolean; volume: number };
};
export type Lyrics = { synced: boolean; lines: { time: number | null; text: string }[] } | null;
export type Resolved = { source: "jiosaavn" | "youtube" | "download"; codec: string; kbps?: number | null };
export type DownloadState = Record<string, { state: "running" | "done" | "failed"; progress: number; error?: string }>;

export type SpotifyImport =
  | { state: "idle" }
  | { state: "running"; done: number; total: number; phase: string }
  | { state: "done"; at: number; playlists: number; songs: number; unmatched: number }
  | { state: "failed"; error: string; code?: string };
export type SpotifyStatus = { connected: boolean; canConnect: boolean; account: { name: string | null } | null; import: SpotifyImport };
export type YouTubeAccount = { name: string | null; handle: string | null; photo: string | null };
export type SignInResult = { ok: YouTubeAccount | false; error?: string; cancelled?: boolean };

declare global {
  interface Window {
    luma?: {
      key: string;
      platform: string;
      youtubeBrowsers(): Promise<string[]>;
      youtubeFromBrowser(browser: string): Promise<SignInResult>;
      youtubeFromFile(): Promise<SignInResult>;
      youtubeSignOut(): Promise<boolean>;
      spotifySignIn(): Promise<{ ok: { name: string | null } | false; error?: string; cancelled?: boolean }>;
      spotifySignOut(): Promise<boolean>;
    };
  }
}

const key = window.luma?.key ?? null;

function withKey(path: string) {
  if (!key) return path;
  return `${path}${path.includes("?") ? "&" : "?"}k=${encodeURIComponent(key)}`;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (key) headers["x-luma-key"] = key;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `LUMA's engine answered ${res.status}`), { code: data.code as string | undefined });
  return data as T;
}

/** Only what the library stores; extra fields from search rows are dropped. */
export function slim(t: Track): Track {
  return { id: t.id, title: t.title, artist: t.artist, artistId: t.artistId ?? null, album: t.album ?? null, albumId: t.albumId ?? null, duration: t.duration ?? null, art: t.art ?? null };
}

export const api = {
  status: () => call<{ version: string; ytdlp: string; youtube: { signedIn: boolean; canSignIn: boolean; account: YouTubeAccount | null } }>("GET", "/api/status"),
  spotify: () => call<SpotifyStatus>("GET", "/api/spotify"),
  spotifyImport: () => call<{ import: SpotifyImport }>("POST", "/api/spotify/import", {}),
  youtubeLibrary: () => call<{ playlists: Tile[] }>("GET", "/api/youtube/library"),
  home: () => call<{ shelves: Shelf[] }>("GET", "/api/home"),
  forYou: () => call<{ basedOn: string | null; songs: Track[] }>("GET", "/api/foryou"),
  search: (q: string) => call<SearchResults>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  suggest: (q: string) => call<string[]>("GET", `/api/suggest?q=${encodeURIComponent(q)}`),
  album: (id: string) => call<Album>("GET", `/api/album/${id}`),
  artist: (id: string) => call<Artist>("GET", `/api/artist/${id}`),
  ytPlaylist: (id: string) => call<YtPlaylist>("GET", `/api/ytplaylist/${id}`),
  radio: (id: string) => call<Track[]>("GET", `/api/radio/${id}`),
  lyrics: (t: Track) => call<Lyrics>("POST", "/api/lyrics", { track: slim(t) }),
  resolve: (t: Track, online = false) => call<Resolved>("POST", "/api/resolve", { track: slim(t), online }),
  log: (message: string) => call<{ ok: true }>("POST", "/api/log", { message }).catch(() => {}),
  prefetch: (t: Track) => call<{ ready: boolean }>("POST", "/api/prefetch", { track: slim(t) }),
  library: () => call<Library>("GET", "/api/library"),
  like: (t: Track, liked: boolean) => call<Library>("POST", "/api/like", { track: slim(t), liked }),
  recordPlay: (t: Track) => call<{ ok: true }>("POST", "/api/history", { track: slim(t) }),
  createPlaylist: (name: string, tracks: Track[] = []) => call<{ created: Playlist; library: Library }>("POST", "/api/playlists", { name, tracks: tracks.map(slim) }),
  renamePlaylist: (id: string, name: string) => call<Library>("PATCH", `/api/playlists/${id}`, { name }),
  deletePlaylist: (id: string) => call<Library>("DELETE", `/api/playlists/${id}`),
  addToPlaylist: (id: string, tracks: Track[]) => call<Library>("POST", `/api/playlists/${id}/tracks`, { tracks: tracks.map(slim) }),
  removeFromPlaylist: (id: string, trackId: string) => call<Library>("DELETE", `/api/playlists/${id}/tracks/${trackId}`),
  download: (t: Track) => call<{ ok: true }>("POST", "/api/download", { track: slim(t) }),
  downloads: () => call<DownloadState>("GET", "/api/downloads"),
  removeDownload: (id: string) => call<Library>("DELETE", `/api/download/${id}`),
  settings: (patch: Partial<Library["settings"]>) => call<Library["settings"]>("PATCH", "/api/settings", patch),
};

export const streamUrl = (id: string, online = false) => withKey(`/stream/${id}${online ? "?online=1" : ""}`);

/** Artwork through the engine: same-origin, so its colours can be read. */
export const img = (url?: string | null) => (url ? withKey(`/img?u=${encodeURIComponent(url)}`) : undefined);

export function formatTime(sec?: number | null) {
  if (sec == null || !Number.isFinite(sec)) return "";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
