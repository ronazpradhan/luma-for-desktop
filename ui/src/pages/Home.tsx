import { RefreshCw } from "lucide-react";
import { api, type Track } from "../api";
import { Art, Failed, MoonPhase, Spinner } from "../components/bits";
import { Shelf } from "../components/Shelf";
import { useLibrary } from "../library";
import { usePlayer } from "../player";
import { greeting, useAsync } from "./common";

export function Home() {
  const feed = useAsync(() => api.home(), []);
  const forYou = useAsync(() => api.forYou(), []);
  const history = useLibrary((s) => s.history);
  const recent = history.slice(0, 8).map((h) => h.track);

  return (
    <div className="page">
      <header className="page-hero">
        <h1 className="hello">{greeting()}</h1>
      </header>

      {recent.length > 0 && (
        <section className="block">
          <h2 className="block-title">Jump back in</h2>
          <div className="quick-grid">
            {recent.map((t) => <QuickCard key={t.id} track={t} />)}
          </div>
        </section>
      )}

      <section className="block">
        <header className="block-head">
          <div>
            <h2 className="block-title">Suggested for you</h2>
            {forYou.data?.basedOn && <p className="block-sub">Because you played {forYou.data.basedOn}</p>}
          </div>
          <button className="btn btn-quiet" onClick={forYou.reload} disabled={forYou.loading} aria-label="New suggestions">
            <RefreshCw size={15} className={forYou.loading ? "spin" : ""} /> New suggestions
          </button>
        </header>
        {forYou.error && !forYou.data ? (
          <Failed message={forYou.error} onRetry={forYou.reload} />
        ) : !forYou.data ? (
          <div className="loading-row"><Spinner /></div>
        ) : (
          <div className={`song-grid ${forYou.loading ? "is-stale" : ""}`}>
            {forYou.data.songs.slice(0, 12).map((t) => <SongCell key={t.id} track={t} />)}
          </div>
        )}
      </section>

      {feed.error && !feed.data && <Failed message={feed.error} onRetry={feed.reload} />}
      {feed.data?.shelves.map((s) => <Shelf key={s.title} title={s.title} items={s.items} />)}
      {feed.loading && !feed.data && <div className="loading-row"><Spinner /></div>}
    </div>
  );
}

/** A wide, short card for a recently played song. */
function QuickCard({ track }: { track: Track }) {
  const isCurrent = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const playing = usePlayer((s) => isCurrent && s.playing);
  const progress = usePlayer((s) => (isCurrent && s.duration ? s.position / s.duration : 0));
  return (
    <button className={`quick ${isCurrent ? "is-current" : ""}`} onClick={() => usePlayer.getState().playTrack(track)}>
      <Art src={track.art} size={56} />
      <span className="quick-text"><b>{track.title}</b><small>{track.artist}</small></span>
      {isCurrent && <MoonPhase progress={progress} playing={playing} size={18} />}
    </button>
  );
}

function SongCell({ track }: { track: Track }) {
  const isCurrent = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const playing = usePlayer((s) => isCurrent && s.playing);
  const progress = usePlayer((s) => (isCurrent && s.duration ? s.position / s.duration : 0));
  return (
    <button className={`song-cell ${isCurrent ? "is-current" : ""}`} onClick={() => usePlayer.getState().playTrack(track)}>
      <Art src={track.art} size={48} />
      <span className="quick-text"><b>{track.title}</b><small>{track.artist}</small></span>
      {isCurrent && <MoonPhase progress={progress} playing={playing} />}
    </button>
  );
}
