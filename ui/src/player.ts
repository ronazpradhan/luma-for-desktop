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
/** The song clock, read every frame by the lyrics (a store update per frame would be too slow). */
export const playbackClock = () => ({ time: audio.currentTime, playing: !audio.paused });
audio.preload = "auto";
let loadToken = 0;
/**
 * Where the song should be by the clock: set when it starts playing, pauses or
 * is seeked. A stream that breaks can make the player jump to the end and
 * report "ended" mid-song; this tells that apart from a real ending.
 */
let anchor = { pos: 0, at: 0, running: false };
const expectedPosition = () => anchor.pos + (anchor.running ? (performance.now() - anchor.at) / 1000 : 0);
const setAnchor = (running: boolean) => { anchor = { pos: audio.currentTime, at: performance.now(), running }; };
/** One recovery per song start, so a song that keeps breaking is skipped, not retried forever. */
let recovered = -1;
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
    recovered = -1;
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
      api.log(`"${track.title}" (${track.id}) didn't start: ${(e as Error).message}`);
      set({ loading: false });
      const code = (e as { code?: string }).code;
      toast(code === "YOUTUBE_SIGNIN"
        ? `"${track.title}" needs YouTube. Connect YouTube in Settings to play songs like it.`
        : code === "YOUTUBE_BLOCKED"
          ? `YouTube is refusing this PC right now. Skipping "${track.title}".`
          : `Couldn't play "${track.title}". Skipping to the next song.`);
      setTimeout(() => token === loadToken && advance(true), 1200);
    }
  }

  /** Looks [index] up again, skipping any download, and plays it from [from] seconds. */
  async function startOnline(index: number, from = 0) {
    const track = get().queue[index];
    if (!track) return;
    const token = ++loadToken;
    recovered = token;
    set({ loading: true });
    try {
      const source = await api.resolve(track, true);
      if (token !== loadToken) return;
      set({ source });
      audio.src = streamUrl(track.id, true);
      if (from > 1) audio.addEventListener("loadedmetadata", () => { audio.currentTime = from; }, { once: true });
      await audio.play();
    } catch (e) {
      if (token !== loadToken || (e as Error).name === "AbortError") return;
      api.log(`"${track.title}" (${track.id}) didn't restart: ${(e as Error).message}`);
      toast(`Couldn't play "${track.title}". Skipping to the next song.`);
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

  /** Mid-song breakage: pick the song up again where it was, once; else skip it. */
  function recover(t: Track, at: number, why: string) {
    const fresh = recovered !== loadToken;
    api.log(`"${t.title}" (${t.id}) broke at ${at.toFixed(1)} s from ${get().source?.source ?? "?"}: ${why}${fresh ? "; looking it up again" : "; skipping"}`);
    resolved.delete(t.id);
    if (fresh) {
      if (get().source?.source === "download") toast(`The download of "${t.title}" won't play, so it's streaming instead.`);
      startOnline(get().index, at);
      return;
    }
    toast(`"${t.title}" keeps stopping. Skipping to the next song.`);
    setTimeout(() => advance(true), 1200);
  }

  audio.addEventListener("playing", () => {
    setAnchor(true);
    set({ playing: true, loading: false });
  });
  audio.addEventListener("pause", () => {
    setAnchor(false);
    set({ playing: false });
  });
  audio.addEventListener("seeked", () => setAnchor(!audio.paused));
  audio.addEventListener("waiting", () => {
    setAnchor(false);
    set({ loading: true });
  });
  audio.addEventListener("canplay", () => set({ loading: false }));
  audio.addEventListener("loadedmetadata", () => Number.isFinite(audio.duration) && set({ duration: audio.duration }));
  audio.addEventListener("ended", () => {
    const t = get().current();
    const expected = expectedPosition();
    api.log(`ended "${t?.title}" at ${audio.currentTime.toFixed(1)} of ${audio.duration.toFixed(1)} s (by the clock ${expected.toFixed(1)} s)`);
    // The player jumped to the end: the stream broke, the song didn't finish.
    if (t && Number.isFinite(audio.duration) && audio.duration - expected > 5) return recover(t, expected, "ended early");
    advance(true);
  });
  audio.addEventListener("error", () => {
    const t = get().current();
    if (!t || !audio.src) return;
    const why = `media error ${audio.error?.code ?? "?"}${audio.error?.message ? `: ${audio.error.message}` : ""}`;
    api.log(`"${t.title}" (${t.id}) failed from ${get().source?.source ?? "?"}: ${why}`);
    // A download that won't play, or a stream that broke mid-song, is picked up again.
    recover(t, expectedPosition(), why);
  });
  let lastPrefetch = "";
  audio.addEventListener("timeupdate", () => {
    set({ position: audio.currentTime });
    // Look up the next song as soon as this one is playing, so Next is instant.
    const { queue, index } = get();
    const next = queue[index + 1];
    if (next && audio.currentTime > 2 && lastPrefetch !== next.id) {
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

// ---- ahead of the click ----------------------------------------------------
// Resting the pointer on a song for a moment starts its lookup (the cheap
// sources only), so by the time it is clicked it is usually ready to play.

const warmed = new Map<string, number>();
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

export function warmOnHover(track: Track) {
  clearTimeout(hoverTimer);
  const at = warmed.get(track.id);
  if (at && Date.now() - at < 30 * 60_000) return;
  hoverTimer = setTimeout(() => {
    warmed.set(track.id, Date.now());
    api.prefetch(track).catch(() => warmed.delete(track.id));
  }, 220);
}

export function coolOnLeave() {
  clearTimeout(hoverTimer);
}

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
