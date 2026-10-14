import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the engine runs separately (npm run dev:core) and its key is
// read from .dev-key, so the dev server can pass it on; the page never sees it.
function devKey() {
  try {
    return readFileSync(new URL("./.dev-key", import.meta.url), "utf8").trim();
  } catch {
    return "";
  }
}

const engine = {
  target: "http://127.0.0.1:5174",
  changeOrigin: true,
  configure: (proxy: any) => proxy.on("proxyReq", (req: any) => req.setHeader("x-luma-key", devKey())),
};

export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { port: 5173, strictPort: true, proxy: { "/api": engine, "/stream": engine, "/img": engine } },
});
