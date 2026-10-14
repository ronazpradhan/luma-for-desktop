// Live lyrics with LUMA for Android's motion (modelled on Spicy Lyrics):
//  - each word sweeps from dim to bright with a soft 20% edge as it is sung,
//    swelling to 1.05 and lifting a touch, with a glow that blooms and fades
//  - the line being sung is full strength; the others dim, and lines two or
//    more away blur a little more with each step
//  - gaps of 3 s or more (and long intros) show three dots that fill in turn
// LRCLIB times whole lines, so each line's time is shared across its words by
// length. Per-frame values are written straight to CSS variables from one
// animation-frame loop; React only re-renders when the active line changes.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Lyrics, type Track } from "../api";
import { playbackClock, usePlayer } from "../player";
import { Spinner } from "./bits";

const INTERLUDE_MIN_GAP = 3;
const INTERLUDE_LEAD_OUT = 0.55;
const SCROLL_GRACE_MS = 3500;
const BLUR_PER_LINE = 1.1;
const BLUR_MAX = 4;

type Word = { text: string; start: number; end: number };
type Item =
  | { kind: "line"; start: number; end: number; words: Word[]; text: string; time: number }
  | { kind: "gap"; start: number; end: number };

/** Monotone-ish curve through control points: smoothstep between neighbours. */
function curve(points: [number, number][]) {
  return (t: number) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x0, y0] = points[i - 1];
      if (t <= x1) {
        const u = (t - x0) / (x1 - x0 || 1);
        return y0 + (y1 - y0) * u * u * (3 - 2 * u);
      }
    }
    return points[points.length - 1][1];
  };
}

// Android's LyricsMotion splines.
const WordScale = curve([[0, 0.95], [0.7, 1.0505], [1, 1]]);
const WordY = curve([[0, 1 / 100], [0.9, -1 / 60], [1, 0]]);
const Glow = curve([[0, 0], [0.15, 1], [0.6, 1], [1, 0]]);
const DotScale = curve([[0, 0.75], [0.7, 1.05], [1, 1]]);
const DotY = curve([[0, 0], [0.9, -0.12], [1, 0]]);
const DotOpacity = curve([[0, 0.35], [0.6, 1], [1, 1]]);

/** Lines with word timings, plus interludes for long gaps. */
export function buildItems(lines: { time: number | null; text: string }[], duration: number): Item[] {
  const timed = lines.filter((l) => l.time != null) as { time: number; text: string }[];
  const out: Item[] = [];
  if (timed.length && timed[0].time >= INTERLUDE_MIN_GAP) out.push({ kind: "gap", start: 0, end: timed[0].time - INTERLUDE_LEAD_OUT });
  timed.forEach((l, i) => {
    const next = timed[i + 1]?.time ?? Math.max(l.time + 6, duration || 0);
    const span = Math.max(0.4, next - l.time);
    const raw = l.text.split(/\s+/).filter(Boolean);
    if (!raw.length) return;
    // Singing rarely fills the whole gap to the next line: about 0.1 s a letter.
    const chars = raw.reduce((n, w) => n + w.length, 0);
    const sung = Math.min(span * 0.92, Math.max(0.9, chars * 0.1 + 0.4));
    let at = l.time;
    const words = raw.map((w) => {
      const d = (w.length / chars) * sung;
      const word = { text: w, start: at, end: at + d };
      at += d;
      return word;
    });
    out.push({ kind: "line", start: l.time, end: l.time + sung, words, text: l.text, time: l.time });
    if (next - (l.time + sung) >= INTERLUDE_MIN_GAP && timed[i + 1]) out.push({ kind: "gap", start: l.time + sung, end: next - INTERLUDE_LEAD_OUT });
  });
  return out;
}

function activeIndexAt(items: Item[], t: number) {
  const running = items.findIndex((it) => t >= it.start && t < it.end);
  if (running >= 0) return running;
  let last = -1;
  items.forEach((it, i) => { if (it.start <= t) last = i; });
  return Math.max(0, last);
}

export function LyricsPane({ track }: { track: Track }) {
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const [lyrics, setLyrics] = useState<Lyrics | "loading">("loading");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const userScrollAt = useRef(0);

  useEffect(() => {
    let alive = true;
    setLyrics("loading");
    setActive(0);
    api.lyrics(track).then((l) => alive && setLyrics(l)).catch(() => alive && setLyrics(null));
    return () => { alive = false; };
  }, [track.id]);

  const items = useMemo(() => (lyrics && lyrics !== "loading" && lyrics.synced ? buildItems(lyrics.lines, duration) : []), [lyrics, duration]);

  // One frame loop drives every word and dot; React hears only line changes.
  useEffect(() => {
    if (!items.length || !box.current) return;
    const root = box.current;
    let raf = 0;
    let shownActive = -1;
    const tick = () => {
      const { time } = playbackClock();
      const a = activeIndexAt(items, time);
      if (a !== shownActive) {
        shownActive = a;
        setActive(a);
        // Lines leaving the animated window go back to their CSS resting state
        // (sung = bright, upcoming = dim), which also undoes a backwards seek.
        root.querySelectorAll<HTMLElement>("[data-item]").forEach((el) => {
          const i = Number(el.dataset.item);
          if (Math.abs(i - a) <= 1) return;
          el.querySelectorAll<HTMLElement>(".w").forEach((s) => s.removeAttribute("style"));
        });
      }
      for (let i = Math.max(0, a - 1); i <= Math.min(items.length - 1, a + 1); i++) {
        const it = items[i];
        const el = root.querySelector<HTMLElement>(`[data-item="${i}"]`);
        if (!el) continue;
        if (it.kind === "line") {
          const spans = el.querySelectorAll<HTMLElement>(".w");
          it.words.forEach((w, k) => {
            const s = spans[k];
            if (!s) return;
            const p = Math.min(1, Math.max(0, (time - w.start) / (w.end - w.start || 1)));
            const phase = time < w.start ? 0 : time >= w.end ? 2 : 1;
            s.style.setProperty("--g", String(phase === 1 ? -0.2 + 1.2 * p : phase === 2 ? 1 : -0.2));
            s.style.setProperty("--s", String(phase === 1 ? WordScale(p) : phase === 2 ? 1 : 0.95));
            s.style.setProperty("--y", String(phase === 1 ? WordY(p) : 0));
            s.style.setProperty("--glow", String(phase === 1 ? Glow(p) : 0));
          });
        } else {
          const p = Math.min(1, Math.max(0, (time - it.start) / (it.end - it.start || 1)));
          el.querySelectorAll<HTMLElement>(".dot").forEach((d, k) => {
            const dp = Math.min(1, Math.max(0, p * 3 - k));
            d.style.setProperty("--ds", String(DotScale(dp)));
            d.style.setProperty("--dy", String(DotY(dp)));
            d.style.setProperty("--do", String(DotOpacity(dp)));
          });
          // The group breathes out just before the next line comes in.
          el.style.setProperty("--gs", String(p > 0.92 ? 1 - (p - 0.92) / 0.08 * 0.6 : 1));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [items]);

  // Keep the sung line about a third of the way down, unless you're scrolling.
  useEffect(() => {
    if (!box.current || Date.now() - userScrollAt.current < SCROLL_GRACE_MS) return;
    const el = box.current.querySelector<HTMLElement>(`[data-item="${active}"]`);
    if (!el) return;
    const top = el.offsetTop - box.current.clientHeight * 0.34;
    box.current.scrollTo({ top, behavior: "smooth" });
  }, [active]);

  if (lyrics === "loading") return <section className="lyrics"><div className="lyrics-note"><Spinner /> Finding lyrics</div></section>;
  if (!lyrics) return <section className="lyrics"><div className="lyrics-note">No lyrics for this song yet.</div></section>;

  if (!lyrics.synced) {
    return (
      <section className="lyrics lyrics-plain" aria-label="Lyrics">
        <div className="lyrics-hint">These lyrics aren't timed to the song.</div>
        {lyrics.lines.map((l, i) => <p key={i} className="plain-line">{l.text || " "}</p>)}
        <div className="lyrics-credit">Lyrics from LRCLIB or YouTube Music</div>
      </section>
    );
  }

  return (
    <section className="lyrics" ref={box} aria-label="Lyrics" onWheel={() => { userScrollAt.current = Date.now(); }}>
      {items.map((it, i) => {
        const distance = Math.abs(i - active);
        const state = i === active ? "is-active" : i < active ? "is-sung" : "is-next";
        const blur = i === active || distance <= 1 ? 0 : Math.min(BLUR_PER_LINE * (distance - 1), BLUR_MAX);
        if (it.kind === "gap") {
          return (
            <div key={i} data-item={i} className={`interlude ${state}`} aria-hidden>
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          );
        }
        return (
          <p key={i} data-item={i} className={`lyric ${state}`} style={{ filter: blur ? `blur(${blur}px)` : undefined }} onClick={() => seek(it.time)}>
            {it.words.map((w, k) => <span key={k} className="w">{w.text}</span>)}
          </p>
        );
      })}
      <div className="lyrics-credit">Lyrics from LRCLIB</div>
    </section>
  );
}
