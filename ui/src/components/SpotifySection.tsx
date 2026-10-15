import { useEffect, useState } from "react";
import { api, type SpotifySignIn, type SpotifyStatus } from "../api";
import { useLibrary } from "../library";
import { toast } from "../toast";

const BROWSER_NAMES: Record<string, string> = { firefox: "Firefox" };

/**
 * Settings: connect Spotify and bring its Liked Songs and playlists into LUMA.
 * The sign-in happens in the listener's own browser, as YouTube's does.
 */
export function SpotifySection() {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [browsers, setBrowsers] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const bridge = window.luma;
  const running = status?.import.state === "running";

  const refresh = () => api.spotify().then(setStatus).catch(() => {});
  useEffect(() => { refresh(); }, []);
  useEffect(() => { bridge?.youtubeBrowsers().then(setBrowsers).catch(() => {}); }, [bridge]);

  // While an import runs, follow it; when it ends, the new playlists appear.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const s = await api.spotify().catch(() => null);
      if (!s) return;
      setStatus(s);
      if (s.import.state !== "running") {
        useLibrary.getState().load();
        if (s.import.state === "done") toast(`Imported ${s.import.playlists} playlists from Spotify`);
      }
    }, 900);
    return () => clearInterval(t);
  }, [running]);

  async function connect(id: string, job: () => Promise<SpotifySignIn>) {
    setBusy(id);
    setProblem(null);
    try {
      const r = await job();
      if (r.ok) {
        setPasted("");
        toast(r.ok.name ? `Connected Spotify as ${r.ok.name}` : "Connected Spotify");
      } else if (!r.cancelled) setProblem(r.error ?? "That didn't work.");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    await bridge?.spotifySignOut();
    toast("Disconnected Spotify. Imported playlists stay in your library.");
    refresh();
  }

  async function importAgain() {
    await api.spotifyImport().catch((e) => setProblem((e as Error).message));
    refresh();
  }

  const imp = status?.import;
  return (
    <section className="settings-group">
      <div className="account-row">
        <span>
          <h2>Spotify</h2>
          {status?.connected && (
            <span className="account">
              <span className="side-icon spotify">S</span>
              <span>
                <b>{status.account?.name ?? "Connected"}</b>
                <small>Spotify</small>
              </span>
            </span>
          )}
          <p>
            {status?.connected
              ? "Your Spotify Liked Songs and playlists are in your Library as LUMA playlists, and play through LUMA's sources."
              : "Bring your Spotify Liked Songs and playlists into LUMA. You sign in to Spotify in your own browser, then hand LUMA that sign-in."}
          </p>
        </span>
        {!bridge ? (
          <span className="muted small">Open the LUMA app to connect</span>
        ) : status?.connected && (
          <button className="btn" onClick={disconnect}>Disconnect</button>
        )}
      </div>
      {bridge && !status?.connected && status?.canConnect !== false && (
        <>
          <ol className="steps">
            <li>
              In your browser, go to{" "}
              <a className="link strong" href="https://open.spotify.com/" target="_blank" rel="noreferrer">open.spotify.com</a>{" "}
              and sign in. Any way works there, Google too.
            </li>
            <li>Press <kbd>F12</kbd>, open <b>Application</b>, then <b>Cookies</b> › <b>https://open.spotify.com</b>.</li>
            <li>Click <b>sp_dc</b>, copy its whole <b>Value</b>, and paste it here.</li>
          </ol>
          <form
            className="actions compact"
            onSubmit={(e) => {
              e.preventDefault();
              if (pasted.trim()) connect("text", () => bridge.spotifyFromText(pasted));
            }}
          >
            <input
              className="paste"
              type="password"
              placeholder="Paste sp_dc here"
              autoComplete="off"
              spellCheck={false}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={!!busy || !pasted.trim()}>
              {busy === "text" ? "Checking with Spotify" : "Connect"}
            </button>
          </form>
          <div className="actions compact">
            <button className="btn" disabled={!!busy} onClick={() => connect("file", () => bridge.spotifyFromFile())}>
              {busy === "file" ? "Checking with Spotify" : "Or choose a cookies file"}
            </button>
            {browsers.map((b) => (
              <button key={b} className="btn" disabled={!!busy} onClick={() => connect(b, () => bridge.spotifyFromBrowser(b))}>
                {busy === b ? `Reading ${BROWSER_NAMES[b]}` : `Use ${BROWSER_NAMES[b] ?? b}'s sign-in`}
              </button>
            ))}
          </div>
          <p className="muted small">
            LUMA keeps only that one Spotify sign-in, encrypted on this PC. It never sees your password and never changes anything on Spotify. Signing out of Spotify in the browser ends it, so use a private window if you sign out often.
          </p>
        </>
      )}
      {status?.canConnect === false && <p className="muted small">Windows can't protect saved sign-ins on this PC, so LUMA can't keep one.</p>}
      {status?.connected && imp && (
        <div className="import-row">
          {imp.state === "running" ? (
            <>
              <span className="muted small">{imp.phase}{imp.total ? ` · ${imp.done} of ${imp.total}` : ""}</span>
              <span className="progress"><span style={{ width: imp.total ? `${(imp.done / imp.total) * 100}%` : "8%" }} /></span>
            </>
          ) : (
            <>
              <span className="muted small">
                {imp.state === "done"
                  ? imp.songs === 0
                    ? `Found ${imp.playlists} playlists, but Spotify sent no songs in them.${imp.unread ? ` ${imp.unread} couldn't be read.` : ""} The log (luma.log) says why.`
                    : `Imported ${imp.playlists} playlists: ${imp.found ?? imp.songs - imp.unmatched} of ${imp.songs} songs found on YouTube Music.${imp.unread ? ` ${imp.unread} playlists couldn't be read.` : ""}`
                  : imp.state === "failed" ? `The import stopped: ${imp.error}` : "Not imported yet."}
              </span>
              <button className="btn btn-quiet" onClick={importAgain}>{imp.state === "idle" ? "Import now" : "Import again"}</button>
            </>
          )}
        </div>
      )}
      {problem && <p className="problem">{problem}</p>}
    </section>
  );
}
