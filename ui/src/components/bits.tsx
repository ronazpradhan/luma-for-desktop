import { useState } from "react";
import { img } from "../api";

/** Artwork through the engine, with the crescent standing in when there is none. */
export function Art({ src, size, round = false, className = "" }: { src?: string | null; size?: number; round?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  const cls = `art ${round ? "art-round" : ""} ${className}`;
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
      <p>{message}</p>
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
