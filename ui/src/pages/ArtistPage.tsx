import { Play, Radio } from "lucide-react";
import { api, img } from "../api";
import { Failed, Spinner } from "../components/bits";
import { Shelf } from "../components/Shelf";
import { TrackList } from "../components/TrackList";
import { usePlayer } from "../player";
import { useAsync } from "./common";

export function ArtistPage({ id }: { id: string }) {
  const res = useAsync(() => api.artist(id), [id]);
  const player = usePlayer();
  if (!res.data) return <div className="page">{res.error ? <Failed message={res.error} onRetry={res.reload} /> : <div className="loading-row"><Spinner /></div>}</div>;
  const a = res.data;
  const art = img(a.art);
  return (
    <div className="page page-artist">
      <header className="artist-head" style={art ? { backgroundImage: `url("${art}")` } : undefined}>
        <div className="artist-shade" />
        <h1>{a.name}</h1>
      </header>
      <div className="actions">
        <button className="btn btn-primary" disabled={!a.songs.length} onClick={() => player.playList(a.songs, 0, a.name)}><Play size={18} fill="currentColor" /> Play</button>
        <button className="btn" disabled={!a.songs[0]} onClick={async () => {
          const seed = a.songs[0];
          const radio = await api.radio(seed.id).catch(() => []);
          player.playList([seed, ...radio], 0, `${a.name} radio`);
        }}><Radio size={17} /> Radio</button>
      </div>
      {a.songs.length > 0 && (
        <section className="block">
          <h2 className="block-title">Popular</h2>
          <TrackList tracks={a.songs} label={a.name} numbered showArt />
        </section>
      )}
      {a.shelves.map((s) => <Shelf key={s.title} title={s.title} items={s.items} />)}
      {a.about && (
        <section className="block about">
          <h2 className="block-title">About</h2>
          <p>{a.about}</p>
        </section>
      )}
    </div>
  );
}
