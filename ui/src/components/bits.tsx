import { useState } from "react";
import { img, plainError } from "../api";

/** Artwork through the engine, with the crescent standing in when there is none. */
export function Art({ src, size, round = false, className = "", fallback }: { src?: string | null; size?: number; round?: boolean; className?: string; fallback?: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  const cls = `art ${round ? "art-round" : ""} ${className}`;
  if ((!src || failed) && fallback) return <>{fallback}</>;
  if (!src || failed) {
    return (
      <div className={`${cls} art-empty`} style={style} aria-hidden>
        <Crescent />
      </div>
    );
  }
  return <img className={cls} style={style} src={img(src)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

export function Crescent({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="28 26 52 52" aria-hidden>
      <path fill="currentColor" d="M51.51,32.14 A22,22 0 1,0 75.42,59.03 A18,18 0 1,1 51.51,32.14 Z" />
    </svg>
  );
}

/**
 * The now-playing marker: a moon whose lit part waxes from a sliver to full as
 * the song plays. Paused, it holds still.
 */
export function MoonPhase({ progress, playing, size = 16 }: { progress: number; playing: boolean; size?: number }) {
  const p = Math.min(1, Math.max(0, progress));
  const r = 7;
  // Terminator ellipse: its x-radius shrinks to 0 at half, then bulges the other way.
  const rx = Math.abs(1 - 2 * p) * r;
  const sweep = p < 0.5 ? 0 : 1;
  const lit = p <= 0.01 ? "" : `M8,1 A${r},${r} 0 0,1 8,15 A${rx},${r} 0 0,${sweep} 8,1 Z`;
  return (
    <svg className={`moon ${playing ? "moon-on" : ""}`} width={size} height={size} viewBox="0 0 16 16" aria-label={playing ? "Playing" : "Paused"} role="img">
      <circle cx="8" cy="8" r={r} className="moon-dark" />
      {lit && <path d={lit} className="moon-lit" />}
    </svg>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" role="status" />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Crescent size={40} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Failed({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <h3>That didn't load</h3>
      <p>{plainError(message)}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** Shimmering stand-ins shaped like what is loading: song rows. */
export function SkeletonRows({ count = 8, art = true }: { count?: number; art?: boolean }) {
  return (
    <div className="skeleton-rows" aria-label="Loading" role="status">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-row" style={{ animationDelay: `${i * 60}ms` }}>
          {art && <span className="sk sk-art" />}
          <span className="sk-lines">
            <span className="sk" style={{ width: `${46 + ((i * 37) % 30)}%` }} />
            <span className="sk sk-thin" style={{ width: `${24 + ((i * 23) % 18)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Shimmering stand-ins for a row of tiles. */
export function SkeletonShelf({ count = 6 }: { count?: number }) {
  return (
    <section className="shelf" aria-label="Loading" role="status">
      <span className="sk sk-title" />
      <div className="shelf-row">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="sk-tile" style={{ animationDelay: `${i * 70}ms` }}>
            <span className="sk sk-square" />
            <span className="sk" style={{ width: "80%" }} />
            <span className="sk sk-thin" style={{ width: "55%" }} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Download: an outlined circle with an arrow down. */
/**
 * Liked songs and Downloads: their own covers, the same in the sidebar and the
 * Library. A glossy heart with a sparkle; an arrow dropping into a tray.
 */
export function SpecialCover({ kind, size = 16 }: { kind: "liked" | "downloads"; size?: number }) {
  return (
    <span className={`special-cover ${kind}`} aria-hidden>
      {kind === "liked" ? (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <defs>
            <linearGradient id="lc-heart" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" />
              <stop offset="1" stopColor="#ffe3f1" />
            </linearGradient>
          </defs>
          <path transform="translate(0.6 2.2) scale(0.86)" fill="url(#lc-heart)" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
          <path fill="#fff" d="M20.2 1.2l.62 1.48 1.48.62-1.48.62-.62 1.48-.62-1.48-1.48-.62 1.48-.62Z" />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path fill="rgb(255 255 255 / 0.92)" d="M3.5 14.2h4.3l1.6 2.6h5.2l1.6-2.6h4.3v3.6a2.6 2.6 0 0 1-2.6 2.6H6.1a2.6 2.6 0 0 1-2.6-2.6Z" />
          <path fill="none" stroke="#fff" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" d="M12 3.2v9.6M7.8 8.8 12 13l4.2-4.2" />
        </svg>
      )}
    </span>
  );
}

export function DownloadGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v8M8.5 12.5 12 16l3.5-3.5" />
    </svg>
  );
}

/** Downloaded: a solid disc in the song's accent with a check, unmistakable next to DownloadGlyph. */
export function DownloadedBadge({ size = 18, label = "Downloaded" }: { size?: number; label?: string }) {
  return (
    <svg className="downloaded-badge" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="12" cy="12" r="10.5" fill="var(--accent)" />
      <path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="var(--night)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A playlist's cover: its own art; else a 2×2 of its songs' covers; else a
 * colourful tile (its colour from its name) with a music note.
 */
export function PlaylistCover({ art, tracks = [], name, size = 36, className = "" }: { art?: string | null; tracks?: { art?: string | null }[]; name: string; size?: number; className?: string }) {
  const arts = [...new Set(tracks.map((t) => t.art).filter(Boolean))].slice(0, 4) as string[];
  const mosaic = arts.length >= 4 ? (
    <span className={`cover-mosaic ${className}`} style={{ width: size, height: size }} aria-hidden>
      {arts.map((a) => <Art key={a} src={a} />)}
    </span>
  ) : null;
  // Its own cover when it loads; else the 2×2 of its songs.
  if (art) return <Art src={art} size={size} className={className} fallback={mosaic ?? undefined} />;
  if (mosaic) return mosaic;
  if (arts[0]) return <Art src={arts[0]} size={size} className={className} />;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className={`side-icon cover-blank ${className}`} style={{ width: size, height: size, ["--h" as string]: h }} aria-hidden>
      <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
    </span>
  );
}
