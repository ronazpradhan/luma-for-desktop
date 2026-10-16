import { useEffect, useState } from "react";
import { api, type SignInResult } from "../api";
import { toast } from "../toast";
import { useLibrary } from "../library";
import { usePlayer } from "../player";
import { useAsync } from "./common";
import { Art } from "../components/bits";
import { SpotifySection } from "../components/SpotifySection";
import { checkForUpdates, installUpdate, useUpdate } from "../update";
import { confirmAsk } from "../components/Confirm";

const BROWSER_NAMES: Record<string, string> = { firefox: "Firefox" };
/** The open-source exporter yt-dlp recommends (Chrome Web Store; works in Edge and Brave too). */
const EXTENSION_URL = "https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc";

type Status = Awaited<ReturnType<typeof api.status>>;
/** The last status seen: Settings opens with it at once and refreshes quietly. */
let lastStatus: Status | null = null;
export const prefetchStatus = () => api.status().then((s) => { lastStatus = s; }).catch(() => {});

export function Settings() {
  const autoplay = useLibrary((s) => s.settings.autoplay);
  const setAutoplay = useLibrary((s) => s.setAutoplay);
  const fetched = useAsync(() => api.status().then((s) => (lastStatus = s)), []);
  const status = { ...fetched, data: fetched.data ?? lastStatus };
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
            <small>Keep playing similar songs when the queue ends.</small>
          </span>
          <input type="checkbox" className="switch" checked={autoplay} onChange={async (e) => { await setAutoplay(e.target.checked); usePlayer.getState().refreshAutoplay(); }} />
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
            {status.data && (
            <p>
                {yt?.signedIn
                  ? yt.account
                    ? "Your likes and playlists are in your Library."
                    : "This sign-in stopped working. Disconnect and connect again."
                  : "See your YouTube Music likes and playlists, and play hard-to-find songs."}
              </p>
            )}
          </span>
          {yt?.signedIn && <button className="btn" onClick={signOut}>Disconnect</button>}
        </div>
        {!bridge && <p className="muted small">Open the LUMA app to sign in.</p>}
        {bridge && status.data && !yt?.signedIn && yt?.canSignIn !== false && (
          <>
            <ol className="steps">
              <li>Add the <a className="link strong" href={EXTENSION_URL} target="_blank" rel="noreferrer">Get cookies.txt LOCALLY</a> extension.</li>
              <li>In a private window, sign in at music.youtube.com.</li>
              <li>Click the extension → <b>Export</b>, then choose the file here.</li>
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
            <p className="muted small">Kept encrypted on this PC. LUMA never sees your password.</p>
          </>
        )}
        {yt?.canSignIn === false && <p className="muted small">Sign-in isn't available on this PC.</p>}
        {hiddenYt > 0 && (
          <div className="import-row">
            <span className="muted small">{hiddenYt} {hiddenYt === 1 ? "playlist" : "playlists"} hidden</span>
            <button className="btn btn-quiet" onClick={async () => { useLibrary.setState({ settings: await api.settings({ hiddenYouTube: [] }) }); toast("Your YouTube Music playlists are back"); }}>Show again</button>
          </div>
        )}
      </section>

      <SpotifySection />

      <CacheSection />
      <AppSection />
      <section className="settings-group">
        <h2>About</h2>
        <dl className="about-list">
          <dt>LUMA for Windows</dt><dd>{status.data?.version ?? "…"}</dd>
          <dt>Updates</dt><dd><UpdateStatus /></dd>
          <dt>YouTube helper</dt><dd>{!status.data ? "…" : /^unavailable/i.test(status.data.ytdlp) ? "Not ready yet" : status.data.ytdlp}</dd>
        </dl>
        <p className="muted small">Made by Ronaz Pradhan.</p>
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
          <p>Downloads are in Music › LUMA.</p>
        </span>
        <button className="btn danger" onClick={uninstall}>Uninstall LUMA</button>
      </div>
    </section>
  );
}

/** Slider stops, in MB. */
const CACHE_STOPS = [0, 256, 512, 1024, 2048, 5120, 10240, 20480];
const sizeLabel = (mb: number) => (mb === 0 ? "Off" : mb < 1024 ? `${mb} MB` : `${mb / 1024} GB`);
const bytesLabel = (b: number) => (b < 1024 ** 3 ? `${Math.round(b / 1024 ** 2)} MB` : `${(b / 1024 ** 3).toFixed(1)} GB`);

/** Songs you've played, kept on this PC so they play offline: how much room they get. */
function CacheSection() {
  const saved = useLibrary((s) => s.settings.cacheLimitMb ?? 1024);
  const [stop, setStop] = useState(() => nearestStop(saved));
  const usage = useAsync(() => api.cache(), [saved]);
  useEffect(() => setStop(nearestStop(saved)), [saved]);

  async function commit(i: number) {
    const mb = CACHE_STOPS[i];
    if (mb === saved) return;
    useLibrary.setState({ settings: await api.settings({ cacheLimitMb: mb }) });
  }

  async function clear() {
    await api.clearCache();
    usage.reload();
    toast("Cleared played songs");
  }

  const u = usage.data;
  return (
    <section className="settings-group">
      <div className="account-row">
        <span>
          <h2>Offline cache</h2>
          <p>Songs you play are saved so they work offline.</p>
        </span>
        <button className="btn btn-quiet" disabled={!u?.songs} onClick={clear}>Clear</button>
      </div>
      <label className="cache-slider">
        <input
          className="range" type="range" min={0} max={CACHE_STOPS.length - 1} step={1} value={stop}
          aria-label="Cache size" aria-valuetext={sizeLabel(CACHE_STOPS[stop])}
          style={{ "--fill": `${(stop / (CACHE_STOPS.length - 1)) * 100}%` } as React.CSSProperties}
          onChange={(e) => setStop(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        />
        <b>{sizeLabel(CACHE_STOPS[stop])}</b>
      </label>
      {u && <p className="muted small">{u.songs ? `${u.songs} ${u.songs === 1 ? "song" : "songs"} · ${bytesLabel(u.bytes)}` : "Nothing saved yet"}</p>}
    </section>
  );
}

function nearestStop(mb: number) {
  let best = 0;
  CACHE_STOPS.forEach((v, i) => { if (Math.abs(v - mb) < Math.abs(CACHE_STOPS[best] - mb)) best = i; });
  return best;
}
