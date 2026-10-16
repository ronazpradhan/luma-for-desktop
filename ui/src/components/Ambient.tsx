import { useEffect, useState } from "react";
import { img } from "../api";

/**
 * The window's background: the playing song's artwork, huge, blurred and
 * slowly drifting, under the song's colour. A new song fades in over the
 * last one instead of cutting.
 */
export function Ambient({ art }: { art?: string | null }) {
  const [layers, setLayers] = useState<{ key: number; url: string }[]>([]);

  useEffect(() => {
    if (!art) return;
    const url = img(art);
    if (!url) return;
    // Wait for the picture, so the fade shows it rather than an empty layer.
    const probe = new Image();
    let cancelled = false;
    probe.onload = () => !cancelled && setLayers((now) => (now.at(-1)?.url === url ? now : [...now.slice(-1), { key: Date.now(), url }]));
    probe.src = url;
    return () => { cancelled = true; };
  }, [art]);

  return (
    <div className="ambient" aria-hidden>
      {layers.map((l, i) => (
        <div key={l.key} className={`ambient-art ${i === layers.length - 1 ? "is-in" : "is-out"}`} style={{ backgroundImage: `url("${l.url}")` }} />
      ))}
      <div className="ambient-light" />
    </div>
  );
}
