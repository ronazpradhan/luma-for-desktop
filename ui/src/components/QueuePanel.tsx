import { X } from "lucide-react";
import { usePlayer } from "../player";
import { useLibrary } from "../library";
import { Art, MoonPhase } from "./bits";

export function QueuePanel() {
  const p = usePlayer();
  const autoplay = useLibrary((s) => s.settings.autoplay);
  const setAutoplay = useLibrary((s) => s.setAutoplay);
  if (!p.queueOpen) return null;
  const upcoming = p.queue.map((t, i) => ({ t, i })).filter(({ i }) => i > p.index);
  const current = p.current();

  return (
    <aside className="queue glass" aria-label="Queue">
      <header className="queue-head">
        <h2>Queue</h2>
        <button className="icon-btn" onClick={() => p.setQueueOpen(false)} aria-label="Close queue"><X size={18} /></button>
      </header>
      {current && (
        <>
          <h3 className="queue-label">Now playing</h3>
          <div className="q-row is-current">
            <Art src={current.art} size={40} />
            <div className="q-text"><b>{current.title}</b><small>{current.artist}</small></div>
            <MoonPhase progress={p.duration ? p.position / p.duration : 0} playing={p.playing} />
          </div>
        </>
      )}
      <h3 className="queue-label">{p.sourceLabel ? `Next from ${p.sourceLabel}` : "Next up"}</h3>
      <div className="q-list">
        {upcoming.length === 0 && (
          <p className="queue-empty">{autoplay ? "When the queue ends, LUMA keeps going with songs like the last one." : "Nothing queued after this song."}</p>
        )}
        {upcoming.map(({ t, i }) => (
          <div key={`${t.id}-${i}`} className="q-row" role="button" tabIndex={0} onClick={() => p.jumpTo(i)} onKeyDown={(e) => e.key === "Enter" && p.jumpTo(i)}>
            <Art src={t.art} size={40} />
            <div className="q-text"><b>{t.title}</b><small>{t.artist}</small></div>
            <button className="icon-btn q-remove" onClick={(e) => { e.stopPropagation(); p.removeFromQueue(i); }} aria-label={`Remove ${t.title} from the queue`}><X size={15} /></button>
          </div>
        ))}
      </div>
      <label className="toggle-row">
        <span>
          <b>Autoplay</b>
          <small>Keep playing similar songs when the queue ends</small>
        </span>
        <input type="checkbox" className="switch" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
      </label>
    </aside>
  );
}
