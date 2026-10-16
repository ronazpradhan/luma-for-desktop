import { useEffect, useState } from "react";
import { api, type SignInResult } from "../api";
import { toast } from "../toast";
import { useLibrary } from "../library";
import { useAsync } from "./common";
import { Art } from "../components/bits";
import { SpotifySection } from "../components/SpotifySection";
import { checkForUpdates, installUpdate, useUpdate } from "../update";
import { confirmAsk } from "../components/Confirm";

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

      <LyricsSection />
      <section className="settings-group">
        <h2>Where songs come from</h2>
        <p>LUMA looks for each song on JioSaavn and YouTube at once and plays whichever is ready first. Connecting YouTube above helps with songs that are hard to find. Downloads are saved to the LUMA folder in your Music folder and play without internet.</p>
      </section>
      <AppSection />
      <section className="settings-group">
        <h2>About</h2>
        <dl className="about-list">
          <dt>LUMA for Windows</dt><dd>{status.data?.version ?? "…"}</dd>
          <dt>Updates</dt><dd><UpdateStatus /></dd>
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

/** Where the app's own update stands, with the one action that fits. */
function UpdateStatus() {
  const u = useUpdate();
  switch (u.state) {
    case "unsupported": return <span className="muted">Only the installed app updates itself</span>;
    case "checking": return <span className="muted">Checking…</span>;
    case "downloading": return <span className="muted">Downloading LUMA {u.version}… {u.progress}%</span>;
    case "ready": return <span className="update-line">LUMA {u.version} is ready <button className="btn btn-primary btn-small" onClick={installUpdate}>Restart to update</button></span>;
    case "error": return <span className="update-line"><span className="muted">Couldn't check for updates</span> <button className="btn btn-quiet btn-small" onClick={checkForUpdates}>Try again</button></span>;
    case "current": return <span className="update-line">Up to date <button className="btn btn-quiet btn-small" onClick={checkForUpdates}>Check again</button></span>;
    default: return <span className="update-line"><button className="btn btn-quiet btn-small" onClick={checkForUpdates}>Check for updates</button></span>;
  }
}

/** LUMA on this PC: where things are, and uninstalling (only in the installed app). */
function AppSection() {
  const bridge = window.luma;
  const [installed, setInstalled] = useState(false);
  useEffect(() => { bridge?.canUninstall?.().then(setInstalled).catch(() => {}); }, [bridge]);
  if (!installed) return null;

  async function uninstall() {
    const ok = await confirmAsk({
      title: "Uninstall LUMA?",
      message: "LUMA will close and Windows' uninstaller will open. It asks whether to keep your library. Downloaded songs in Music\\LUMA are kept either way.",
      action: "Uninstall",
    });
    if (ok) await bridge?.uninstall();
  }

  return (
    <section className="settings-group">
      <div className="account-row">
        <span>
          <h2>LUMA on this PC</h2>
          <p>Downloads are in your Music folder under LUMA. You can also uninstall LUMA from Windows Settings › Apps.</p>
        </span>
        <button className="btn danger" onClick={uninstall}>Uninstall LUMA</button>
      </div>
    </section>
  );
}

/** Where lyrics come from, and an optional LyricsPlus server of your own. */
function LyricsSection() {
  const saved = useLibrary((s) => s.settings.lyricsServer ?? "");
  const [value, setValue] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setValue(saved), [saved]);

  async function save() {
    setProblem(null);
    try {
      useLibrary.setState({ settings: await api.settings({ lyricsServer: value.trim() }) });
      toast(value.trim() ? "LUMA will ask your LyricsPlus server first" : "Using the public LyricsPlus servers");
    } catch (e) {
      setProblem((e as Error).message);
    }
  }

  return (
    <section className="settings-group">
      <h2>Lyrics</h2>
      <p>LUMA asks LyricsPlus (YouLy+), Unison (Better Lyrics), SimpMusic, LRCLIB and KuGou, and shows the best: word-timed when it can be, grouped into verses and choruses. Lyrics are saved on this PC after the first look-up.</p>
      <form className="actions compact" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input className="paste" placeholder="Your own LyricsPlus server (optional), https://…" value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} aria-label="LyricsPlus server" />
        <button className="btn" type="submit" disabled={value.trim() === saved}>Save</button>
      </form>
      {problem && <p className="problem">{problem}</p>}
    </section>
  );
}
