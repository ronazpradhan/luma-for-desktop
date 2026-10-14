import { useToast } from "../toast";

export function Toast() {
  const { message, seq } = useToast();
  return (
    <div className="toast-wrap" aria-live="polite">
      {message && <div key={seq} className="toast glass">{message}</div>}
    </div>
  );
}
