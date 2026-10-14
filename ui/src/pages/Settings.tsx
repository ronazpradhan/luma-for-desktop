import { useEffect, useState } from "react";
import { api } from "../api";
import { toast } from "../toast";
import { useLibrary } from "../library";
import { useAsync } from "./common";

const BROWSER_NAMES: Record<string, string> = { firefox: "Firefox", edge: "Edge", chrome: "Chrome", brave: "Brave" };

export function Settings() {
  const autoplay = useLibrary((s) => s.settings.autoplay);
  const setAutoplay = useLibrary((s) => s.setAutoplay);
  const status = useAsync(() => api.status(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [browsers, setBrowsers] = useState<string[]>([]);
  const yt = status.data?.youtube;
  const bridge = window.luma;

  useEffect(() => {
    bridge?.youtubeBrowsers().then(setBrowsers).catch(() => {});
  }, [bridge]);

  async function connect(id: string, job: () => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>) {
    setBusy(id);
    setProblem(null);
    try {
      const r = await job();
      if (r.ok) {
        toast("Signed in to YouTube");
        status.reload();
      } else if (!r.cancelled) setProblem(r.error ?? "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    if (!bridge) return;
    await bridge.youtubeSignOut();
    toast("Signed out of YouTube");
    status.reload();
  }

  return (
    <div className="page page-narrow">
      <header className="page-hero">
        <h1 className="hello">Settings</h1>
      </header>
      <section className="settings-group glass">
        <label className="toggle-row">
          <span>
            <b>Autoplay</b>
            <small>When the queue ends, keep playing songs like the last one, the way YouTube Music does.</small>
          </span>
          <input type="checkbox" className="switch" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
        </label>
      </section>

      <section className="settings-group glass">
        <div className="account-row">
          <span>
            <h2>YouTube</h2>
            <p>
              {yt?.signedIn
                ? "Signed in. Songs that aren't on JioSaavn play from YouTube with your account, like LUMA on your phone."
                : "Songs that aren't on JioSaavn play from YouTube, and on some connections YouTube only allows that when you're signed in."}
            </p>
          </span>
          {yt?.signedIn && <button className="btn" onClick={signOut}>Sign out</button>}
        </div>
        {!bridge && <p className="muted small">Open the LUMA app to sign in.</p>}
        {bridge && !yt?.signedIn && yt?.canSignIn !== false && (
          <>
            <p className="muted small">
              Sign in to music.youtube.com in your browser first, then pick that browser. LUMA copies only the YouTube sign-in, keeps it encrypted on this PC, and never sees your password.
            </p>
            <div className="actions compact">
              {browsers.map((b) => (
                <button key={b} className="btn" disabled={!!busy} onClick={() => connect(b, () => bridge.youtubeFromBrowser(b))}>
                  {busy === b ? `Reading ${BROWSER_NAMES[b]}` : `Use ${BROWSER_NAMES[b] ?? b}`}
                </button>
              ))}
              <button className="btn btn-quiet" disabled={!!busy} onClick={() => connect("file", () => bridge.youtubeFromFile())}>
                Choose a cookies file
              </button>
            </div>
            {problem && <p className="problem">{problem}</p>}
          </>
        )}
        {yt?.canSignIn === false && <p className="muted small">Windows can't protect saved sign-ins on this PC, so LUMA can't keep one.</p>}
      </section>

      <section className="settings-group glass">
        <h2>Where songs come from</h2>
        <p>LUMA looks for each song on JioSaavn first (AAC, up to 320 kbps). Songs JioSaavn doesn't have play from YouTube. Downloads are saved to the LUMA folder in your Music folder and play without internet.</p>
      </section>
      <section className="settings-group glass">
        <h2>About</h2>
        <dl className="about-list">
          <dt>LUMA for Windows</dt><dd>{status.data?.version ?? "…"}</dd>
          <dt>YouTube helper (yt-dlp)</dt><dd>{status.data?.ytdlp ?? "…"}</dd>
        </dl>
        <p className="muted small">Made by Ronaz Pradhan. LUMA for Android is a fork of Stash by rawnaldclark (GPL-3.0). Lyrics from LRCLIB.</p>
      </section>
      <section className="settings-group glass">
        <h2>Shortcuts</h2>
        <dl className="keys">
          <dt><kbd>Space</kbd></dt><dd>Play or pause</dd>
          <dt><kbd>Ctrl</kbd> <kbd>→</kbd></dt><dd>Next song</dd>
          <dt><kbd>Ctrl</kbd> <kbd>←</kbd></dt><dd>Previous song</dd>
          <dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>Search</dd>
          <dt><kbd>Ctrl</kbd> <kbd>L</kbd></dt><dd>Like the playing song</dd>
          <dt><kbd>Esc</kbd></dt><dd>Close Now Playing</dd>
        </dl>
      </section>
    </div>
  );
}
