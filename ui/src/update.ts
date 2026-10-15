// App updates, as the desktop app reports them (GitHub Releases, downloaded in
// the background). In a browser there is nothing to update.

import { create } from "zustand";
import type { UpdateState } from "./api";
import { toast } from "./toast";

export const useUpdate = create<UpdateState>(() => ({ state: "idle", version: null, progress: 0, error: null }));

const bridge = window.luma;
if (bridge?.onUpdate) {
  bridge.updateState().then((s) => s && useUpdate.setState(s)).catch(() => {});
  bridge.onUpdate((s) => {
    if (s.state === "ready" && useUpdate.getState().state !== "ready") toast(`LUMA ${s.version} is ready. Restart to update.`);
    useUpdate.setState(s);
  });
}

export const installUpdate = () => bridge?.installUpdate();
export const checkForUpdates = () => bridge?.checkForUpdates().then((s) => s && useUpdate.setState(s));
