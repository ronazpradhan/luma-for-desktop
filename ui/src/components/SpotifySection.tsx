import { useEffect, useState } from "react";
import { api, type SpotifyStatus } from "../api";
import { useLibrary } from "../library";
import { toast } from "../toast";

/** Settings: connect Spotify and bring its Liked Songs and playlists into LUMA. */
export function SpotifySection() {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const bridge = window.luma;
  const running = status?.import.state === "running";

  const refresh = () => api.spotify().then(setStatus).catch(() => {});
  useEffect(() => { refresh(); }, []);

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

  async function connect() {
    if (!bridge) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await bridge.spotifySignIn();
      if (r.ok) toast(r.ok.name ? `Connected Spotify as ${r.ok.name}` : "Connected Spotify");
      else if (!r.cancelled) setProblem(r.error ?? "That didn't work.");
      await refresh();
    } finally {
      setBusy(false);
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
    <section className="settings-group glass">
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
              : "Sign in to bring your Spotify Liked Songs and playlists into LUMA. Spotify's own sign-in page opens; LUMA never sees your password and never changes anything on Spotify."}
          </p>
        </span>
        {!bridge ? (
          <span className="muted small">Open the LUMA app to connect</span>
        ) : status?.connected ? (
          <button className="btn" onClick={disconnect}>Disconnect</button>
        ) : (
          <button className="btn btn-primary" onClick={connect} disabled={busy || status?.canConnect === false}>{busy ? "Waiting for Spotify" : "Connect Spotify"}</button>
        )}
      </div>
      {!status?.connected && bridge && <p className="muted small">Sign in with your email or phone. "Continue with Google" won't work there, because Google blocks sign-in inside apps.</p>}
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
                  ? `Imported ${imp.playlists} playlists, ${imp.songs} songs${imp.unmatched ? ` (${imp.unmatched} not found on YouTube Music)` : ""}.`
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
