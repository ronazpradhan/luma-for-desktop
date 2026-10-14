// The player: one <audio> element, the queue, and what happens between songs.
// A song is looked up (resolve) before it plays; the next one is looked up
// while the current one plays, so pressing next is instant. When the queue
// runs out, autoplay continues with YouTube Music's radio for the last song.

import { create } from "zustand";
import { api, img, slim, streamUrl, type Resolved, type Track } from "./api";
import { useLibrary } from "./library";
import { toast } from "./toast";

export type Repeat = "off" | "all" | "one";

type PlayerState = {
  queue: Track[];
  index: number;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  source: Resolved | null;
  sourceLabel: string | null;
  nowPlayingOpen: boolean;
  queueOpen: boolean;

  current(): Track | null;
  playList(tracks: Track[], start?: number, label?: string): void;
  playTrack(track: Track): void;
  playNext(track: Track): void;
  addToQueue(tracks: Track[]): void;
  removeFromQueue(index: number): void;
  jumpTo(index: number): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(sec: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  setNowPlaying(open: boolean): void;
  setQueueOpen(open: boolean): void;
};

const audio = new Audio();
audio.preload = "auto";
let loadToken = 0;
const resolved = new Map<string, Promise<Resolved>>();

function lookUp(t: Track) {
  let p = resolved.get(t.id);
  if (!p) {
    p = api.resolve(t);
    resolved.set(t.id, p);
    // Forget failures and, after a while, successes (links expire).
    p.then(() => setTimeout(() => resolved.delete(t.id), 4 * 3_600_000), () => resolved.delete(t.id));
  }
  return p;
}

function storedVolume() {
  try {
    const v = Number(localStorage.getItem("luma.volume"));
    return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.8;
  } catch {
    return 0.8;
  }
}

export const usePlayer = create<PlayerState>((set, get) => {
  async function start(index: number) {
    const { queue } = get();
    const track = queue[index];
    if (!track) return;
    const token = ++loadToken;
    audio.pause();
    set({ index, loading: true, playing: false, position: 0, duration: track.duration ?? 0, source: null });
    updateSession(track);
    try {
      const source = await lookUp(track);
      if (token !== loadToken) return;
      set({ source });
      audio.src = streamUrl(track.id);
      await audio.play();
      api.recordPlay(slim(track)).then(() => useLibrary.getState().refreshSoon()).catch(() => {});
    } catch (e) {
      if (token !== loadToken) return;
      if ((e as Error).name === "AbortError") return;
      set({ loading: false });
      toast(`Couldn't play "${track.title}". Skipping it.`);
      setTimeout(() => token === loadToken && advance(true), 1200);
    }
  }

  async function extendWithRadio(): Promise<boolean> {
    const { queue } = get();
    const seed = queue[queue.length - 1];
    if (!seed) return false;
    const have = new Set(queue.map((t) => t.id));
    const radio = await api.radio(seed.id).catch(() => []);
    const fresh = radio.filter((t) => !have.has(t.id));
    if (!fresh.length) return false;
    set({ queue: [...get().queue, ...fresh] });
    return true;
  }

  async function advance(auto: boolean) {
    const { index, queue, repeat, shuffle } = get();
    if (auto && repeat === "one") return start(index);
    if (shuffle && queue.length > 1) {
      let i = index;
      while (i === index) i = Math.floor(Math.random() * queue.length);
      return start(i);
    }
    if (index + 1 < queue.length) return start(index + 1);
    if (repeat === "all" && queue.length) return start(0);
    if (useLibrary.getState().settings.autoplay && (await extendWithRadio())) return start(index + 1);
    set({ playing: false });
  }

  audio.addEventListener("playing", () => set({ playing: true, loading: false }));
  audio.addEventListener("pause", () => set({ playing: false }));
  audio.addEventListener("waiting", () => set({ loading: true }));
  audio.addEventListener("canplay", () => set({ loading: false }));
  audio.addEventListener("loadedmetadata", () => Number.isFinite(audio.duration) && set({ duration: audio.duration }));
  audio.addEventListener("ended", () => advance(true));
  audio.addEventListener("error", () => {
    const t = get().current();
    if (!t || !audio.src) return;
    resolved.delete(t.id);
    toast(`"${t.title}" stopped loading. Skipping it.`);
    setTimeout(() => advance(true), 1200);
  });
  let lastPrefetch = "";
  audio.addEventListener("timeupdate", () => {
    set({ position: audio.currentTime });
    // Look up the next song once this one is well underway.
    const { queue, index } = get();
    const next = queue[index + 1];
    if (next && audio.currentTime > 8 && lastPrefetch !== next.id) {
      lastPrefetch = next.id;
      lookUp(next).catch(() => {});
    }
    if (navigator.mediaSession && Number.isFinite(audio.duration)) {
      try {
        navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 });
      } catch { /* not every runtime accepts it */ }
    }
  });

  const volume = storedVolume();
  audio.volume = volume;

  return {
    queue: [],
    index: -1,
    playing: false,
    loading: false,
    position: 0,
    duration: 0,
    volume,
    muted: false,
    shuffle: false,
    repeat: "off",
    source: null,
    sourceLabel: null,
    nowPlayingOpen: false,
    queueOpen: false,

    current: () => get().queue[get().index] ?? null,

    playList(tracks, startAt = 0, label) {
      if (!tracks.length) return;
      set({ queue: tracks, sourceLabel: label ?? null });
      start(startAt);
    },

    playTrack(track) {
      // A single song plays on its own; autoplay radio carries on after it.
      set({ queue: [track], sourceLabel: null });
      start(0);
    },

    playNext(track) {
      const { queue, index } = get();
      if (index < 0) return get().playTrack(track);
      const q = [...queue];
      q.splice(index + 1, 0, track);
      set({ queue: q });
      toast(`"${track.title}" plays next`);
    },

    addToQueue(tracks) {
      if (get().index < 0) return get().playList(tracks);
      set({ queue: [...get().queue, ...tracks] });
      toast(tracks.length === 1 ? `Added "${tracks[0].title}" to the queue` : `Added ${tracks.length} songs to the queue`);
    },

    removeFromQueue(i) {
      const { queue, index } = get();
      if (i === index) return;
      const q = queue.filter((_, k) => k !== i);
      set({ queue: q, index: i < index ? index - 1 : index });
    },

    jumpTo(i) {
      start(i);
    },

    toggle() {
      if (!get().current()) return;
      if (audio.paused) {
        if (!audio.src) start(get().index);
        else audio.play().catch(() => {});
      } else audio.pause();
    },

    next: () => { advance(false); },

    previous() {
      if (audio.currentTime > 4 || get().index === 0) {
        audio.currentTime = 0;
        return;
      }
      start(get().index - 1);
    },

    seek(sec) {
      if (Number.isFinite(sec)) audio.currentTime = sec;
      set({ position: sec });
    },

    setVolume(v) {
      const vol = Math.min(1, Math.max(0, v));
      audio.volume = vol;
      audio.muted = false;
      set({ volume: vol, muted: false });
      try { localStorage.setItem("luma.volume", String(vol)); } catch { /* private mode */ }
    },

    toggleMute() {
      audio.muted = !audio.muted;
      set({ muted: audio.muted });
    },

    toggleShuffle: () => set({ shuffle: !get().shuffle }),
    cycleRepeat: () => set({ repeat: get().repeat === "off" ? "all" : get().repeat === "all" ? "one" : "off" }),
    setNowPlaying: (open) => set({ nowPlayingOpen: open }),
    setQueueOpen: (open) => set({ queueOpen: open }),
  };
});

// Windows media keys and the volume flyout's player card.
function updateSession(t: Track) {
  if (!("mediaSession" in navigator)) return;
  const art = img(t.art);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album ?? "",
    artwork: art ? [{ src: new URL(art, location.href).href, sizes: "544x544", type: "image/jpeg" }] : [],
  });
}

if ("mediaSession" in navigator) {
  const p = () => usePlayer.getState();
  navigator.mediaSession.setActionHandler("play", () => p().toggle());
  navigator.mediaSession.setActionHandler("pause", () => p().toggle());
  navigator.mediaSession.setActionHandler("nexttrack", () => p().next());
  navigator.mediaSession.setActionHandler("previoustrack", () => p().previous());
  navigator.mediaSession.setActionHandler("seekto", (d) => d.seekTime != null && p().seek(d.seekTime));
}
