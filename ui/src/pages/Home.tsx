import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, type Track } from "../api";
import { Art, Failed, MoonPhase, SkeletonRows, SkeletonShelf } from "../components/bits";
import { Shelf } from "../components/Shelf";
import { useLibrary } from "../library";
import { coolOnLeave, usePlayer, warmOnHover } from "../player";
import { greeting, useAsync } from "./common";

export function Home() {
  const feed = useAsync(() => api.home(), []);
  // The first load keeps today's mix; Refresh asks for a new one.
  const [fresh, setFresh] = useState(0);
  const forYou = useAsync(() => api.forYou(fresh > 0), [fresh]);
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
            <h2 className="block-title">Quick picks</h2>
            <p className="block-sub">{forYou.data?.basedOn ? `Because you play ${forYou.data.basedOn}` : "Play a few songs and these become yours"}</p>
          </div>
          <button className="btn btn-quiet" onClick={() => setFresh((n) => n + 1)} disabled={forYou.loading} aria-label="New quick picks" title="New quick picks">
            <RefreshCw size={15} className={forYou.loading ? "spin" : ""} /> Refresh
          </button>
        </header>
        {forYou.error && !forYou.data ? (
          <Failed message={forYou.error} onRetry={forYou.reload} />
        ) : !forYou.data ? (
          <SkeletonRows count={6} />
        ) : (
          <div className={`song-grid ${forYou.loading ? "is-stale" : ""}`}>
            {forYou.data.songs.slice(0, 18).map((t) => <SongCell key={t.id} track={t} />)}
          </div>
        )}
      </section>

      {feed.error && !feed.data && <Failed message={feed.error} onRetry={feed.reload} />}
      {feed.data?.shelves.map((s) => <Shelf key={s.title} title={s.title} items={s.items} />)}
      {feed.loading && !feed.data && <><SkeletonShelf /><SkeletonShelf /></>}
    </div>
  );
}

/** A wide, short card for a recently played song. */
function QuickCard({ track }: { track: Track }) {
  const isCurrent = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const playing = usePlayer((s) => isCurrent && s.playing);
  const progress = usePlayer((s) => (isCurrent && s.duration ? s.position / s.duration : 0));
  return (
    <button className={`quick ${isCurrent ? "is-current" : ""}`} onClick={() => usePlayer.getState().playTrack(track)} onPointerEnter={() => warmOnHover(track)} onPointerLeave={coolOnLeave}>
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
    <button className={`song-cell ${isCurrent ? "is-current" : ""}`} onClick={() => usePlayer.getState().playTrack(track)} onPointerEnter={() => warmOnHover(track)} onPointerLeave={coolOnLeave}>
      <Art src={track.art} size={48} />
      <span className="quick-text"><b>{track.title}</b><small>{track.artist}</small></span>
      {isCurrent && <MoonPhase progress={progress} playing={playing} />}
    </button>
  );
}
