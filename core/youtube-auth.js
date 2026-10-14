// The YouTube session the listener signed in with, the way LUMA for Android
// keeps one: its cookies, encrypted at rest with Windows' own data protection
// (Electron safeStorage), handed to yt-dlp one play at a time through a
// short-lived file only this user can read.

import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = "youtube-session.bin";

export async function openYouTubeAuth({ dataDir, vault = null }) {
  const file = path.join(dataDir, FILE);
  let cookies = null;
  if (vault) {
    try {
      cookies = JSON.parse(vault.decrypt(await readFile(file)));
    } catch {
      cookies = null;
    }
  }

  return {
    signedIn: () => !!cookies?.length,

    async set(list) {
      // Only YouTube's and Google's own cookies; yt-dlp needs nothing else.
      cookies = list.filter((c) => {
        if (!c || typeof c.name !== "string" || typeof c.value !== "string" || typeof c.domain !== "string") return false;
        const host = c.domain.replace(/^\./, "");
        return /(^|\.)(youtube|google)\.com$/.test(host);
      });
      // Without Windows' protection the session lives in memory only, never on disk in the clear.
      if (vault) await writeFile(file, vault.encrypt(JSON.stringify(cookies)));
    },

    async clear() {
      cookies = null;
      await rm(file, { force: true });
    },

    headers: (origin) => sessionHeaders(cookies, origin),

    /**
     * Runs [fn] with a Netscape cookie file for yt-dlp, deleted afterwards, or
     * with null when not signed in.
     */
    async withCookieFile(dir, fn) {
      if (!cookies?.length) return fn(null);
      const tmp = path.join(dir, `yt-cookies-${randomBytes(8).toString("hex")}.txt`);
      await writeFile(tmp, netscape(cookies), { mode: 0o600 });
      await chmod(tmp, 0o600).catch(() => {});
      try {
        return await fn(tmp);
      } finally {
        await rm(tmp, { force: true });
      }
    },
  };
}

/** Cookies from a Netscape cookies.txt (what browsers' exporters and yt-dlp write). */
export function parseNetscape(text) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice(10);
    } else if (!line.trim() || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [domain, , cpath, secure, expires, name, ...rest] = parts;
    out.push({ domain, hostOnly: !domain.startsWith("."), path: cpath, secure: secure === "TRUE", httpOnly, expirationDate: Number(expires) || undefined, name, value: rest.join("\t") });
  }
  return out;
}

/** A signed-in YouTube session carries one of these. */
export function isSignedInJar(cookies) {
  return cookies.some((c) => /(^|\.)youtube\.com$/.test(c.domain.replace(/^\./, "")) && (c.name === "SAPISID" || c.name === "__Secure-3PAPISID") && c.value);
}

export function netscape(cookies) {
  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of cookies) {
    const domain = c.domain.startsWith(".") || !c.hostOnly ? `.${c.domain.replace(/^\./, "")}` : c.domain;
    const expires = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    lines.push([domain, domain.startsWith(".") ? "TRUE" : "FALSE", c.path || "/", c.secure ? "TRUE" : "FALSE", expires, c.name, c.value].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * What YouTube Music's web player sends when signed in: the youtube.com
 * cookies and the SAPISIDHASH that proves them (as LUMA for Android does).
 */
export function sessionHeaders(cookies, origin = "https://music.youtube.com") {
  const yt = (cookies ?? []).filter((c) => /(^|\.)youtube\.com$/.test(c.domain.replace(/^\./, "")));
  const sapisid = yt.find((c) => c.name === "SAPISID")?.value ?? yt.find((c) => c.name === "__Secure-3PAPISID")?.value;
  if (!sapisid) return null;
  const ts = Math.floor(Date.now() / 1000);
  const hash = createHash("sha1").update(`${ts} ${sapisid} ${origin}`).digest("hex");
  return {
    Cookie: yt.map((c) => `${c.name}=${c.value}`).join("; "),
    Authorization: `SAPISIDHASH ${ts}_${hash}`,
    "X-Origin": origin,
    "X-Goog-AuthUser": "0",
  };
}
