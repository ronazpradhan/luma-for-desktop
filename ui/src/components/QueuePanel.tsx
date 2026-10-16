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
  const from = p.autoplayFrom ?? Infinity;
  const queued = upcoming.filter(({ i }) => i < from);
  const auto = upcoming.filter(({ i }) => i >= from);
  const current = p.current();
  const row = ({ t, i }: { t: (typeof p.queue)[number]; i: number }) => (
    <div key={`${t.id}-${i}`} className="q-row" role="button" tabIndex={0} onClick={() => p.jumpTo(i)} onKeyDown={(e) => e.key === "Enter" && p.jumpTo(i)}>
      <Art src={t.art} size={40} />
      <div className="q-text"><b>{t.title}</b><small>{t.artist}</small></div>
      <button className="icon-btn q-remove" onClick={(e) => { e.stopPropagation(); p.removeFromQueue(i); }} aria-label={`Remove ${t.title} from the queue`} title="Remove"><X size={15} /></button>
    </div>
  );

  return (
    <aside className="queue glass" aria-label="Queue">
      <header className="queue-head">
        <h2>Queue</h2>
        <button className="icon-btn" onClick={() => p.setQueueOpen(false)} aria-label="Close queue" title="Close queue"><X size={18} /></button>
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
      <div className="q-list">
        {queued.length > 0 && <h3 className="queue-label">{p.sourceLabel ? `Next from ${p.sourceLabel}` : "Next up"}</h3>}
        {queued.map(row)}
        {auto.length > 0 && <h3 className="queue-label">Autoplay · similar songs</h3>}
        {auto.map(row)}
        {!queued.length && !auto.length && (
          <p className="queue-empty">{autoplay ? (p.autoplayLoading ? "Finding similar songs…" : "Similar songs will appear here.") : "Nothing queued after this song."}</p>
        )}
      </div>
      <label className="toggle-row">
        <span>
          <b>Autoplay</b>
          <small>Keep playing similar songs when the queue ends</small>
        </span>
        <input type="checkbox" className="switch" checked={autoplay} onChange={async (e) => { await setAutoplay(e.target.checked); p.refreshAutoplay(); }} />
      </label>
    </aside>
  );
}
