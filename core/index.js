// Development entry: the engine on a fixed port for the Vite dev server, with
// a fresh key written to .dev-key (git-ignored) for vite.config to pass along.

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { startServer } from "./server.js";

const root = path.resolve(import.meta.dirname, "..");
const key = randomBytes(32).toString("hex");
writeFileSync(path.join(root, ".dev-key"), key);

await startServer({
  port: 5174,
  key,
  dataDir: path.join(root, ".dev-data"),
  musicDir: path.join(root, ".dev-data", "music"),
  devOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
});
