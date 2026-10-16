import { api } from "../api";
import { Play } from "lucide-react";
import { Art, Empty, Failed, SkeletonRows, SkeletonShelf } from "../components/bits";
import { coolOnLeave, usePlayer, warmOnHover } from "../player";
import { Shelf } from "../components/Shelf";
import { TrackList } from "../components/TrackList";
import { useNav } from "../nav";
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

/** Moods and genres to start from: each card runs its search. */
const CATEGORIES: { label: string; q: string; from: string; to: string }[] = [
  { label: "Bollywood hits", q: "Bollywood hits", from: "#e8475f", to: "#8a1f6b" },
  { label: "Punjabi", q: "Punjabi hits", from: "#f59f2b", to: "#c2410c" },
  { label: "Nepali", q: "Nepali songs", from: "#e23b3b", to: "#1e3a8a" },
  { label: "Pop", q: "Pop hits", from: "#ec4899", to: "#7c3aed" },
  { label: "Hip-hop", q: "Hip hop", from: "#475569", to: "#0f172a" },
  { label: "Lo-fi", q: "Lofi", from: "#6366f1", to: "#312e81" },
  { label: "Romantic", q: "Romantic songs", from: "#f43f5e", to: "#9f1239" },
  { label: "Sad songs", q: "Sad songs", from: "#3b82f6", to: "#1e3a5f" },
  { label: "Party", q: "Party songs", from: "#d946ef", to: "#6b21a8" },
  { label: "Workout", q: "Workout music", from: "#22c55e", to: "#14532d" },
  { label: "Chill", q: "Chill songs", from: "#14b8a6", to: "#134e4a" },
  { label: "Indie", q: "Indie songs", from: "#a3a635", to: "#4d5114" },
  { label: "Rock", q: "Rock songs", from: "#b91c1c", to: "#27272a" },
  { label: "K-pop", q: "K-pop", from: "#f472b6", to: "#4f46e5" },
  { label: "Sufi", q: "Sufi songs", from: "#d4a017", to: "#6b4410" },
  { label: "90s Bollywood", q: "90s Bollywood songs", from: "#fb7185", to: "#7c2d12" },
  { label: "Acoustic", q: "Acoustic songs", from: "#a16207", to: "#422006" },
  { label: "EDM", q: "EDM", from: "#06b6d4", to: "#3730a3" },
];

function SearchStart() {
  const go = useNav((s) => s.go);
  return (
    <div className="page">
      <header className="page-hero">
        <h1 className="hello">Search</h1>
        <p className="hero-sub">Type in the box above, or start from a mood. Ctrl+K gets you to search from anywhere.</p>
      </header>
      <section className="block">
        <h2 className="block-title">Browse all</h2>
        <div className="category-grid">
          {CATEGORIES.map((c) => (
            <button key={c.label} className="category" style={{ ["--from" as string]: c.from, ["--to" as string]: c.to }} onClick={() => go({ name: "search", q: c.q })}>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
