import { useEffect, useRef } from "react";
import { create } from "zustand";

type Ask = { title: string; message: string; action: string; resolve(ok: boolean): void };
const useConfirm = create<{ ask: Ask | null }>(() => ({ ask: null }));

/**
 * Asks before something that can't be undone, inside LUMA's own window (the
 * browser's confirm() would be headed with the engine's address).
 */
export function confirmAsk(opts: { title: string; message: string; action: string }): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ ask: { ...opts, resolve } }));
}

export function ConfirmDialog() {
  const ask = useConfirm((s) => s.ask);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!ask) return;
    // Cancel has focus, so Enter never deletes by accident.
    cancel.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && done(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [ask]);

  function done(ok: boolean) {
    ask?.resolve(ok);
    useConfirm.setState({ ask: null });
  }

  if (!ask) return null;
  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div className="dialog glass" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
        <h2 id="dialog-title">{ask.title}</h2>
        <p id="dialog-message">{ask.message}</p>
        <div className="dialog-actions">
          <button ref={cancel} className="btn" onClick={() => done(false)}>Cancel</button>
          <button className="btn btn-destructive" onClick={() => done(true)}>{ask.action}</button>
        </div>
      </div>
    </div>
  );
}
