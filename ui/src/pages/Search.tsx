import { api } from "../api";
import { Empty, Failed, Spinner } from "../components/bits";
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
  if (res.loading && !res.data) return <div className="page"><div className="loading-row"><Spinner /></div></div>;
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
        <section className="block">
          <h2 className="block-title">Songs</h2>
          <TrackList tracks={data.songs} single />
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
