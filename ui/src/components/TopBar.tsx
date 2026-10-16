import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import { api } from "../api";
import { useNav } from "../nav";

/** Back, the search box, and the draggable strip the window controls sit in. */
export function TopBar() {
  const route = useNav((s) => s.route);
  const canBack = useNav((s) => s.stack.length > 1);
  const back = useNav((s) => s.back);
  const go = useNav((s) => s.go);
  const replace = useNav((s) => s.replace);
  const [text, setText] = useState(route.name === "search" ? route.q ?? "" : "");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (route.name === "search") setText(route.q ?? "");
  }, [route]);

  useEffect(() => {
    const q = text.trim();
    if (!q || !open) return setSuggestions([]);
    const t = setTimeout(() => api.suggest(q).then(setSuggestions).catch(() => {}), 160);
    return () => clearTimeout(t);
  }, [text, open]);

  // Ctrl+K or / jumps to search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea");
      if ((e.ctrlKey && e.key.toLowerCase() === "k") || (!typing && e.key === "/")) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  function submit(q: string) {
    const query = q.trim();
    if (!query) return;
    setText(query);
    setOpen(false);
    input.current?.blur();
    const r = { name: "search" as const, q: query };
    route.name === "search" ? replace(r) : go(r);
  }

  return (
    <header className="topbar">
      <button className="icon-btn round" onClick={back} disabled={!canBack} aria-label="Back" title="Back"><ChevronLeft size={20} /></button>
      <form className={`searchbox ${open && suggestions.length ? "has-list" : ""}`} role="search" onSubmit={(e) => { e.preventDefault(); submit(active >= 0 ? suggestions[active] : text); }}>
        <Search size={17} aria-hidden />
        <input
          ref={input}
          value={text}
          placeholder="Search songs, albums, artists"
          aria-label="Search"
          spellCheck={false}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(suggestions.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
            if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
          }}
        />
        {text && <button type="button" className="icon-btn" aria-label="Clear search" title="Clear search" onClick={() => { setText(""); input.current?.focus(); }}><X size={16} /></button>}
        {open && suggestions.length > 0 && (
          <ul className="suggest glass-raised" role="listbox">
            {suggestions.map((s, i) => (
              <li key={s} role="option" aria-selected={i === active}>
                <button type="button" className={i === active ? "is-active" : ""} onMouseDown={(e) => { e.preventDefault(); submit(s); }}>
                  <Search size={14} /> {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
      <div className="drag-space" />
    </header>
  );
}
