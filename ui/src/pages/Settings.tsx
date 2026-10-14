import { api } from "../api";
import { useLibrary } from "../library";
import { useAsync } from "./common";

export function Settings() {
  const autoplay = useLibrary((s) => s.settings.autoplay);
  const setAutoplay = useLibrary((s) => s.setAutoplay);
  const status = useAsync(() => api.status(), []);
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
