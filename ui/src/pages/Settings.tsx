import { useEffect, useState } from "react";
import { api, type SignInResult } from "../api";
import { toast } from "../toast";
import { useLibrary } from "../library";
import { useAsync } from "./common";
import { Art } from "../components/bits";
import { SpotifySection } from "../components/SpotifySection";

const BROWSER_NAMES: Record<string, string> = { firefox: "Firefox" };
/** The open-source exporter yt-dlp recommends (Chrome Web Store; works in Edge and Brave too). */
const EXTENSION_URL = "https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc";

export function Settings() {
  const autoplay = useLibrary((s) => s.settings.autoplay);
  const setAutoplay = useLibrary((s) => s.setAutoplay);
  const status = useAsync(() => api.status(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [browsers, setBrowsers] = useState<string[]>([]);
  const yt = status.data?.youtube;
  const bridge = window.luma;
  const hiddenYt = useLibrary((s) => s.settings.hiddenYouTube?.length ?? 0);

  useEffect(() => {
    bridge?.youtubeBrowsers().then(setBrowsers).catch(() => {});
  }, [bridge]);

  async function connect(id: string, job: () => Promise<SignInResult>) {
    setBusy(id);
    setProblem(null);
    try {
      const r = await job();
      if (r.ok) {
        toast(r.ok.name ? `Connected YouTube as ${r.ok.name}` : "Connected YouTube");
        status.reload();
        useLibrary.getState().loadYouTube();
      } else if (!r.cancelled) setProblem(r.error ?? "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    if (!bridge) return;
    await bridge.youtubeSignOut();
    toast("Disconnected YouTube");
    status.reload();
    useLibrary.setState({ youtubePlaylists: [] });
  }

  return (
    <div className="page page-narrow">
      <header className="page-hero">
        <h1 className="hello">Settings</h1>
      </header>
      <section className="settings-group">
        <label className="toggle-row">
          <span>
            <b>Autoplay</b>
            <small>When the queue ends, keep playing songs like the last one, the way YouTube Music does.</small>
          </span>
          <input type="checkbox" className="switch" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
        </label>
      </section>

      <section className="settings-group">
        <div className="account-row">
          <span>
            <h2>YouTube</h2>
            {yt?.signedIn && (
              <span className="account">
                {yt.account?.photo && <Art src={yt.account.photo} size={36} round />}
                <span>
                  <b>{yt.account?.name ?? "Connected"}</b>
                  {yt.account?.handle && <small>{yt.account.handle}</small>}
                </span>
              </span>
            )}
            <p>
              {yt?.signedIn
                ? yt.account
                  ? "Your YouTube Music likes and playlists are in your Library, and songs that aren't on JioSaavn play from YouTube with this account."
                  : "This sign-in no longer works with YouTube. Disconnect it and connect again."
                : "Connect your YouTube account to see your YouTube Music likes and playlists here, and to play songs that aren't on JioSaavn."}
            </p>
          </span>
          {yt?.signedIn && <button className="btn" onClick={signOut}>Disconnect</button>}
        </div>
        {!bridge && <p className="muted small">Open the LUMA app to sign in.</p>}
        {bridge && !yt?.signedIn && yt?.canSignIn !== false && (
          <>
            <ol className="steps">
              <li>
                In your browser, add the free <b>Get cookies.txt LOCALLY</b> extension.{" "}
                <a className="link strong" href={EXTENSION_URL} target="_blank" rel="noreferrer">Get it</a>
              </li>
              <li>Open a private window (Ctrl+Shift+N), go to music.youtube.com and sign in.</li>
              <li>Click the extension, then <b>Export</b>. It saves a .txt file.</li>
              <li>Close the private window, then choose that file here.</li>
            </ol>
            <div className="actions compact">
              <button className="btn btn-primary" disabled={!!busy} onClick={() => connect("file", () => bridge.youtubeFromFile())}>
                {busy === "file" ? "Checking with YouTube" : "Choose cookies file"}
              </button>
              {browsers.map((b) => (
                <button key={b} className="btn" disabled={!!busy} onClick={() => connect(b, () => bridge.youtubeFromBrowser(b))}>
                  {busy === b ? `Reading ${BROWSER_NAMES[b]}` : `Use ${BROWSER_NAMES[b] ?? b}'s sign-in`}
                </button>
              ))}
            </div>
            {problem && <p className="problem">{problem}</p>}
            <p className="muted small">
              LUMA keeps only the YouTube sign-in from the file, encrypted on this PC, and never sees your password. Delete the .txt file afterwards. A private window keeps this sign-in separate from your everyday browsing, so it lasts longer.
            </p>
          </>
        )}
        {yt?.canSignIn === false && <p className="muted small">Windows can't protect saved sign-ins on this PC, so LUMA can't keep one.</p>}
        {hiddenYt > 0 && (
          <div className="import-row">
            <span className="muted small">{hiddenYt} YouTube Music {hiddenYt === 1 ? "playlist is" : "playlists are"} removed from LUMA.</span>
            <button className="btn btn-quiet" onClick={async () => { useLibrary.setState({ settings: await api.settings({ hiddenYouTube: [] }) }); toast("Your YouTube Music playlists are back"); }}>Show again</button>
          </div>
        )}
      </section>

      <SpotifySection />

      <section className="settings-group">
        <h2>Where songs come from</h2>
        <p>LUMA looks for each song on JioSaavn and YouTube at once and plays whichever is ready first. Connecting YouTube above helps with songs that are hard to find. Downloads are saved to the LUMA folder in your Music folder and play without internet.</p>
      </section>
      <section className="settings-group">
        <h2>About</h2>
        <dl className="about-list">
          <dt>LUMA for Windows</dt><dd>{status.data?.version ?? "…"}</dd>
          <dt>YouTube helper</dt><dd>{!status.data ? "…" : /^unavailable/i.test(status.data.ytdlp) ? "Not ready yet" : status.data.ytdlp}</dd>
        </dl>
        <p className="muted small">Made by Ronaz Pradhan. LUMA for Android is a fork of Stash by rawnaldclark (GPL-3.0). YouTube playback follows Spotube's approach, with YouTube.js and yt-dlp. Lyrics from LRCLIB.</p>
      </section>
      <section className="settings-group">
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
