import { useRef } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { Tile, Track } from "../api";
import { useNav } from "../nav";
import { coolOnLeave, usePlayer, warmOnHover } from "../player";
import { Art } from "./bits";
import { openPlaylistMenu } from "./PlaylistMenu";

/** A titled row of tiles that scrolls sideways. */
/** [menu]: right-clicking a playlist tile opens the playlist menu (your YouTube Music playlists). */
export function Shelf({ title, items, menu = false }: { title: string; items: Tile[]; menu?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <section className="shelf">
      <header className="shelf-head">
        <h2>{title}</h2>
        <div className="shelf-arrows">
          <button className="icon-btn" onClick={() => scroll(-1)} aria-label="Scroll left" title="Scroll left"><ChevronLeft size={18} /></button>
          <button className="icon-btn" onClick={() => scroll(1)} aria-label="Scroll right" title="Scroll right"><ChevronRight size={18} /></button>
        </div>
      </header>
      <div className="shelf-row" ref={ref}>
        {items.map((it, i) => <TileCard key={`${it.id}-${i}`} item={it} menu={menu} />)}
      </div>
    </section>
  );
}

export function TileCard({ item, menu = false }: { item: Tile; menu?: boolean }) {
  const go = useNav((s) => s.go);
  const open = () => {
    if (item.kind === "song") usePlayer.getState().playTrack(item as Track);
    else if (item.kind === "album") go({ name: "album", id: item.id });
    else if (item.kind === "playlist") go({ name: "ytplaylist", id: item.id });
    else go({ name: "artist", id: item.id });
  };
  const sub = item.kind === "song" ? (item as Track).artist : item.subtitle;
  return (
    <button className={`tile tile-${item.kind}`} onClick={open} onPointerEnter={() => item.kind === "song" && warmOnHover(item as Track)} onPointerLeave={coolOnLeave}
      onContextMenu={menu && item.kind === "playlist" ? openPlaylistMenu({ kind: "youtube", id: item.id, title: item.title }) : undefined}>
      <div className="tile-art">
        <Art src={item.art} round={item.kind === "artist"} />
        {item.kind !== "artist" && <span className="tile-play" aria-hidden><Play size={18} fill="currentColor" /></span>}
      </div>
      <div className="tile-title">{item.title}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </button>
  );
}
