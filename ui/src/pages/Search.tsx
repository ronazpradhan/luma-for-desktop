import { useEffect, useState } from "react";
import { api } from "../api";
import { Play } from "lucide-react";
import { Art, Empty, Failed, SkeletonRows, SkeletonShelf } from "../components/bits";
import { coolOnLeave, usePlayer, warmOnHover } from "../player";
import { Shelf, TileCard } from "../components/Shelf";
import { TrackList } from "../components/TrackList";
import { useNav } from "../nav";
import { useAsync } from "./common";

export function Search({ q }: { q?: string }) {
  if (!q) return <SearchStart />;
  return <Results q={q} />;
}

type Filter = "all" | "songs" | "artists" | "albums";

function Results({ q }: { q: string }) {
  const res = useAsync(() => api.search(q), [q]);
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => setFilter("all"), [q]);
  if (res.loading && !res.data) return <div className="page"><div className="chips"><span className="sk" style={{ width: 280, height: 34, borderRadius: 999 }} /></div><SkeletonRows count={6} /><SkeletonShelf /></div>;
  if (res.error && !res.data) return <div className="page"><Failed message={res.error} onRetry={res.reload} /></div>;
  const data = res.data!;
  const nothing = !data.songs.length && !data.albums.length && !data.artists.length;
  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: 1 },
    { id: "songs", label: "Songs", count: data.songs.length },
    { id: "artists", label: "Artists", count: data.artists.length },
    { id: "albums", label: "Albums", count: data.albums.length },
  ];

  return (
    <div className={`page ${res.loading ? "is-stale" : ""}`}>
      <div className="chips" role="tablist" aria-label="Show">
        {chips.filter((c) => c.count > 0).map((c) => (
          <button key={c.id} role="tab" aria-selected={filter === c.id} className={`chip ${filter === c.id ? "is-on" : ""}`} onClick={() => setFilter(c.id)}>{c.label}</button>
        ))}
      </div>
      {nothing && <Empty title="Nothing found">Check the spelling, or try the artist's name.</Empty>}

      {filter === "all" && (
        <>
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
                <TrackList tracks={data.songs.slice(1, 5)} single showAlbum={false} />
              </section>
            </div>
          )}
          {data.artists.length > 0 && <Shelf title="Artists" items={data.artists} />}
          {data.albums.length > 0 && <Shelf title="Albums" items={data.albums} />}
          {data.songs.length > 5 && (
            <section className="block">
              <header className="block-head">
                <h2 className="block-title">More songs</h2>
                <button className="btn btn-quiet" onClick={() => setFilter("songs")}>See all songs</button>
              </header>
              <TrackList tracks={data.songs.slice(5, 11)} single />
            </section>
          )}
        </>
      )}
      {filter === "songs" && <TrackList tracks={data.songs} single />}
      {filter === "artists" && <div className="tile-grid">{data.artists.map((a) => <TileCard key={a.id} item={a} />)}</div>}
      {filter === "albums" && <div className="tile-grid">{data.albums.map((a) => <TileCard key={a.id} item={a} />)}</div>}
    </div>
  );
}

/** Moods to start from (a vibe, not a country or language): each card runs its search. */
const CATEGORIES: { label: string; q: string; from: string; to: string }[] = [
  { label: "Late night", q: "late night vibes songs", from: "#4338ca", to: "#1e1b4b" },
  { label: "Feel good", q: "feel good songs", from: "#f59e0b", to: "#c2410c" },
  { label: "Heartbreak", q: "heartbreak songs", from: "#3b82f6", to: "#1e3a5f" },
  { label: "Chill", q: "chill songs", from: "#14b8a6", to: "#134e4a" },
  { label: "Focus", q: "focus music", from: "#64748b", to: "#1e293b" },
  { label: "Workout", q: "workout songs", from: "#22c55e", to: "#14532d" },
  { label: "Party", q: "party songs", from: "#d946ef", to: "#6b21a8" },
  { label: "Romance", q: "love songs", from: "#f43f5e", to: "#9f1239" },
  { label: "Rainy day", q: "rainy day songs", from: "#60a5fa", to: "#334155" },
  { label: "Road trip", q: "road trip songs", from: "#fb923c", to: "#7c2d12" },
  { label: "Dreamy", q: "dreamy songs", from: "#c084fc", to: "#4c1d95" },
  { label: "Lo-fi", q: "lofi beats", from: "#6366f1", to: "#312e81" },
  { label: "Hype", q: "hype songs", from: "#ef4444", to: "#450a0a" },
  { label: "Acoustic", q: "acoustic songs", from: "#a16207", to: "#422006" },
  { label: "Indie", q: "indie songs", from: "#a3a635", to: "#4d5114" },
  { label: "Throwbacks", q: "throwback songs", from: "#fb7185", to: "#7c2d12" },
  { label: "Sleep", q: "sleep music", from: "#1e40af", to: "#0b1023" },
  { label: "Sad hours", q: "sad songs", from: "#475569", to: "#0f172a" },
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
