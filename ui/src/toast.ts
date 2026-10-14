import { create } from "zustand";

type ToastState = { message: string | null; seq: number };

export const useToast = create<ToastState>(() => ({ message: null, seq: 0 }));

let timer: ReturnType<typeof setTimeout> | undefined;

/** A short note at the bottom of the window, gone after a few seconds. */
export function toast(message: string) {
  clearTimeout(timer);
  useToast.setState((s) => ({ message, seq: s.seq + 1 }));
  timer = setTimeout(() => useToast.setState({ message: null }), 3200);
}
