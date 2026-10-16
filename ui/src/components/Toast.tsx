import { useToast } from "../toast";

/** Plain notes at the bottom of the window. Notes with Undo live in the sidebar, above Settings. */
export function Toast() {
  const { message, action, seq } = useToast();
  return (
    <div className="toast-wrap" aria-live="polite">
      {message && !action && <div key={seq} className="toast glass-raised">{message}</div>}
    </div>
  );
}
