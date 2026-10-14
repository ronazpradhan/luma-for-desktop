// Where the window is: a small history stack, so Back works like a browser's.

import { create } from "zustand";

export type Route =
  | { name: "home" }
  | { name: "search"; q?: string }
  | { name: "library" }
  | { name: "liked" }
  | { name: "downloads" }
  | { name: "album"; id: string }
  | { name: "artist"; id: string }
  | { name: "ytplaylist"; id: string }
  | { name: "playlist"; id: string }
  | { name: "settings" };

type NavState = {
  stack: Route[];
  route: Route;
  go(r: Route): void;
  replace(r: Route): void;
  back(): void;
};

export const useNav = create<NavState>((set, get) => ({
  stack: [{ name: "home" }],
  route: { name: "home" },
  go(r) {
    const same = JSON.stringify(r) === JSON.stringify(get().route);
    if (same) return;
    const stack = [...get().stack, r].slice(-50);
    set({ stack, route: r });
  },
  replace(r) {
    const stack = [...get().stack.slice(0, -1), r];
    set({ stack, route: r });
  },
  back() {
    const stack = get().stack;
    if (stack.length < 2) return;
    const next = stack.slice(0, -1);
    set({ stack: next, route: next[next.length - 1] });
  },
}));
