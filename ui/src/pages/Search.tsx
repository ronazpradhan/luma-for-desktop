import { api } from "../api";
import { Play } from "lucide-react";
import { Art, Empty, Failed, SkeletonRows, SkeletonShelf } from "../components/bits";
import { coolOnLeave, usePlayer, warmOnHover } from "../player";
import { Shelf } from "../components/Shelf";
import { TrackList } from "../components/TrackList";
import { useLibrary } from "../library";
import { useAsync } from "./common";

export function Search({ q }: { q?: string }) {
  if (!q) return <SearchStart />;
  return <Results q={q} />;
}

function Results({ q }: { q: string }) {
  const res = useAsync(() => api.search(q), [q]);
  if (res.loading && !res.data) return <div className="page"><header className="page-hero"><h1 className="hello">{q}</h1></header><SkeletonRows count={6} /><SkeletonShelf /></div>;
  if (res.error && !res.data) return <div className="page"><Failed message={res.error} onRetry={res.reload} /></div>;
  const data = res.data!;
  const nothing = !data.songs.length && !data.albums.length && !data.artists.length;
  return (
    <div className={`page ${res.loading ? "is-stale" : ""}`}>
      <header className="page-hero">
        <h1 className="hello">{q}</h1>
      </header>
      {nothing && <Empty title="Nothing found">Check the spelling, or try the artist's name.</Empty>}
      {data.songs.length > 0 && (
        <div className="top-result">
          <section>
            <h2 className="block-title">Top result</h2>
            <button className="top-card" onClick={() => usePlayer.getState().playTrack(data.songs[0])} onPointerEnter={() => warmOnHover(data.songs[0])} onPointerLeave={coolOnLeave}>
              <Art src={data.songs[0].art} />
              <h3>{data.songs[0].title}</h3>
              <p>Song · {data.songs[0].artist}</p>
              <span className="tile-play" aria-hidden><Play size={22} fill="currentColor" /></span>
            </button>
          </section>
          <section className="top-songs">
            <h2 className="block-title">Songs</h2>
            <TrackList tracks={data.songs.slice(0, 4)} single showAlbum={false} />
          </section>
        </div>
      )}
      {data.songs.length > 4 && (
        <section className="block">
          <h2 className="block-title">More songs</h2>
          <TrackList tracks={data.songs.slice(4)} single />
        </section>
      )}
      {data.artists.length > 0 && <Shelf title="Artists" items={data.artists} />}
      {data.albums.length > 0 && <Shelf title="Albums" items={data.albums} />}
    </div>
  );
}

function SearchStart() {
  const history = useLibrary((s) => s.history);
  return (
    <div className="page">
      <header className="page-hero">
        <h1 className="hello">Search</h1>
        <p className="hero-sub">Type in the box above. Ctrl+K gets you there from anywhere.</p>
      </header>
      {history.length > 0 && (
        <section className="block">
          <h2 className="block-title">Played recently</h2>
          <TrackList tracks={history.slice(0, 12).map((h) => h.track)} single />
        </section>
      )}
    </div>
  );
}
