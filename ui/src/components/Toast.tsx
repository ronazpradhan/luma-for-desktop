import { dismissToast, useToast } from "../toast";

export function Toast() {
  const { message, action, seq } = useToast();
  return (
    <div className="toast-wrap" aria-live="polite">
      {message && (
        <div key={seq} className={`toast glass-raised ${action ? "has-action" : ""}`}>
          <span>{message}</span>
          {action && (
            <button className="toast-action" onClick={() => { action.run(); dismissToast(); }}>
              {action.label}
            </button>
          )}
          {action && <span className="toast-timer" aria-hidden />}
        </div>
      )}
    </div>
  );
}
