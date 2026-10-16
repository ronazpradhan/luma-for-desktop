import { create } from "zustand";

type Action = { label: string; run(): void };
type ToastState = { message: string | null; action: Action | null; seq: number };

export const useToast = create<ToastState>(() => ({ message: null, action: null, seq: 0 }));

let timer: ReturnType<typeof setTimeout> | undefined;

/** A short note at the bottom of the window, gone after a few seconds; it can carry one action, like Undo. */
export function toast(message: string, opts: { action?: Action; ms?: number } = {}) {
  clearTimeout(timer);
  useToast.setState((s) => ({ message, action: opts.action ?? null, seq: s.seq + 1 }));
  timer = setTimeout(() => useToast.setState({ message: null, action: null }), opts.ms ?? 3200);
}

export function dismissToast() {
  clearTimeout(timer);
  useToast.setState({ message: null, action: null });
}
