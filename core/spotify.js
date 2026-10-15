// Spotify, the way LUMA for Android talks to it: the signed-in web player's
// sp_dc cookie is traded for an access token (with the web player's TOTP
// code), and your Liked Songs and playlists come from the same internal
// GraphQL API open.spotify.com uses. Read-only: nothing is changed on Spotify.

import { createHmac, randomUUID } from "node:crypto";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const GRAPHQL = "https://api-partner.spotify.com/pathfinder/v1/query";

// Kept in step with LUMA for Android's SpotifyAuthConfig.
const TOTP_VERSION = "61";
const SECRET_CIPHER = [44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78];
const CLIENT_VERSION_FALLBACK = "1.2.87.311.g2db0c2c4";
const SEED_HASHES = {
  libraryV3: "973e511ca44261fda7eebac8b653155e7caee3675abb4fb110cc1b8c78b091c3",
  fetchPlaylist: "32b05e92e438438408674f95d0fdad8082865dc32acd55bd97f5113b8579092b",
  fetchLibraryTracks: "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240",
};

/** The web player's TOTP for [timeSeconds] (RFC 6238, HMAC-SHA1, 30 s, 6 digits). */
export function totp(timeSeconds) {
  const joined = SECRET_CIPHER.map((b, i) => b ^ ((i % 33) + 9)).join("");
  const key = Buffer.from(Buffer.from(joined, "utf8").toString("hex"), "hex");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeSeconds / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export function createSpotify({ fetchImpl = fetch, log = () => {} } = {}) {
  let spDc = null;
  let token = null; // { accessToken, expiresAt, clientId, username }
  let clientToken = null;
  let clientVersion = null;
  let hashes = { ...SEED_HASHES };
  let spT = null;

  async function serverTime() {
    try {
      const r = await fetchImpl("https://open.spotify.com/", { method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8_000) });
      const t = Date.parse(r.headers.get("date") ?? "");
      return Number.isFinite(t) ? t / 1000 : Date.now() / 1000;
    } catch {
      return Date.now() / 1000;
    }
  }

  async function accessToken() {
    if (!spDc) throw Object.assign(new Error("Connect Spotify in Settings first."), { code: "SPOTIFY_SIGNIN" });
    if (token && token.expiresAt > Date.now() + 60_000) return token;
    const code = totp(await serverTime());
    const url = `https://open.spotify.com/api/token?reason=transport&productType=web-player&totp=${code}&totpServer=${code}&totpVer=${TOTP_VERSION}`;
    const r = await fetchImpl(url, {
      headers: { Cookie: `sp_dc=${spDc}`, "User-Agent": UA, Accept: "application/json", "App-Platform": "WebPlayer", Referer: "https://open.spotify.com/" },
      signal: AbortSignal.timeout(10_000),
    });
    const setCookie = r.headers.get("set-cookie") ?? "";
    spT = /sp_t=([^;]+)/.exec(setCookie)?.[1] ?? spT;
    if (!r.ok) throw new Error(`Spotify's token service answered ${r.status}`);
    const j = await r.json();
    if (j.isAnonymous || !j.accessToken) throw Object.assign(new Error("Spotify doesn't accept this sign-in any more. Connect Spotify again."), { code: "SPOTIFY_SIGNIN" });
    token = { accessToken: j.accessToken, expiresAt: j.accessTokenExpirationTimestampMs ?? Date.now() + 3_000_000, clientId: j.clientId, username: usernameFromJwt(j.accessToken) ?? j.username ?? null };
    clientToken = null;
    return token;
  }

  async function shell() {
    const r = await fetchImpl("https://open.spotify.com/", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
    return r.text();
  }

  async function version() {
    if (clientVersion) return clientVersion;
    try {
      const html = await shell();
      clientVersion = extractClientVersion(html) ?? CLIENT_VERSION_FALLBACK;
    } catch {
      clientVersion = CLIENT_VERSION_FALLBACK;
    }
    return clientVersion;
  }

  async function ensureClientToken(clientId) {
    if (clientToken) return clientToken;
    const r = await fetchImpl("https://clienttoken.spotify.com/v1/clienttoken", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify({
        client_data: {
          client_version: await version(),
          client_id: clientId,
          js_sdk_data: { device_brand: "unknown", device_model: "unknown", os: "windows", os_version: "NT 10.0", device_id: spT ?? randomUUID(), device_type: "computer" },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Spotify's client-token service answered ${r.status}`);
    const j = await r.json();
    clientToken = j.granted_token?.token;
    if (!clientToken) throw new Error("Spotify didn't grant a client token");
    return clientToken;
  }

  /** Spotify rotates query hashes with each web-player build; the live ones are in its bundle. */
  async function rescrapeHashes() {
    const html = await shell();
    const bundle = /src="(https:\/\/[^"]*\/web-player\/web-player\.[a-f0-9]+\.js)"/.exec(html)?.[1];
    if (!bundle) return false;
    const js = await (await fetchImpl(bundle, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) })).text();
    let found = 0;
    for (const m of js.matchAll(/"([A-Za-z0-9_]+)","(?:query|mutation)","([0-9a-f]{64})"/g)) {
      hashes[m[1]] = m[2];
      found++;
    }
    log(`spotify: refreshed ${found} query hashes`);
    return found > 0;
  }

  async function graphql(operationName, variables, retried = false) {
    const t = await accessToken();
    const ct = await ensureClientToken(t.clientId);
    const params = new URLSearchParams({
      operationName,
      variables: JSON.stringify(variables),
      extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hashes[operationName] } }),
    });
    const r = await fetchImpl(`${GRAPHQL}?${params}`, {
      headers: {
        Authorization: `Bearer ${t.accessToken}`, "Client-Token": ct, Accept: "application/json", "App-Platform": "WebPlayer",
        "Spotify-App-Version": await version(), Origin: "https://open.spotify.com", Referer: "https://open.spotify.com/", "User-Agent": UA,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    if (!retried && /PersistedQueryNotFound/i.test(text) && (await rescrapeHashes().catch(() => false))) return graphql(operationName, variables, true);
    if (r.status === 401 && !retried) {
      token = null;
      return graphql(operationName, variables, true);
    }
    if (!r.ok) throw new Error(`Spotify answered ${r.status} for ${operationName}`);
    return JSON.parse(text);
  }

  return {
    setSession(cookie) {
      spDc = cookie || null;
      token = null;
      clientToken = null;
    },
    connected: () => !!spDc,

    /** Who is signed in; also proves the cookie works. */
    async account() {
      const t = await accessToken();
      return { name: t.username, id: t.username };
    },

    /** Your Liked Songs, newest first, up to [cap]. */
    async likedSongs(cap = 3000) {
      const out = [];
      for (let offset = 0; offset < cap; offset += 50) {
        const j = await graphql("fetchLibraryTracks", { offset, limit: 50 });
        const items = j.data?.me?.library?.tracks?.items ?? j.data?.me?.libraryTracks?.items ?? [];
        out.push(...items.map((w) => parseTrack(w.track?.data ?? w.item?.data ?? w.itemV2?.data)).filter(Boolean));
        if (items.length < 50) break;
      }
      return out;
    },

    /** Your playlists (own and followed), without folders. */
    async playlists() {
      const out = [];
      for (let offset = 0; offset < 2000; offset += 50) {
        const j = await graphql("libraryV3", { filters: ["Playlists"], order: null, textFilter: "", features: ["LIKED_SONGS", "YOUR_EPISODES"], limit: 50, offset });
        const items = j.data?.me?.libraryV3?.items ?? [];
        for (const w of items) {
          const d = w.item?.data;
          if (d?.__typename !== "Playlist" || !d.uri?.startsWith("spotify:playlist:")) continue;
          out.push({
            id: d.uri.slice("spotify:playlist:".length),
            name: d.name ?? "Untitled",
            art: d.images?.items?.[0]?.sources?.[0]?.url ?? null,
            count: d.content?.totalCount ?? null,
          });
        }
        if (items.length < 50) break;
      }
      return out;
    },

    async playlistTracks(id, cap = 3000) {
      const out = [];
      for (let offset = 0; offset < cap; offset += 100) {
        const j = await graphql("fetchPlaylist", { uri: `spotify:playlist:${id}`, offset, limit: 100, enableWatchFeedEntrypoint: false });
        const items = j.data?.playlistV2?.content?.items ?? [];
        out.push(...items.map((w) => parseTrack(w.itemV2?.data)).filter(Boolean));
        if (items.length < 100) break;
      }
      return out;
    },
  };
}

/** A Spotify track as LUMA needs it to find the same recording on YouTube Music. */
export function parseTrack(d) {
  if (!d || !d.uri?.startsWith("spotify:track:")) return null;
  const artists = (d.artists?.items ?? []).map((a) => a.profile?.name).filter(Boolean);
  if (!d.name || !artists.length) return null;
  const ms = d.trackDuration?.totalMilliseconds ?? d.duration?.totalMilliseconds ?? 0;
  return {
    spotifyId: d.uri.slice("spotify:track:".length),
    title: d.name,
    artist: artists.join(", "),
    album: d.albumOfTrack?.name ?? null,
    duration: ms ? Math.round(ms / 1000) : null,
    art: d.albumOfTrack?.coverArt?.sources?.[0]?.url ?? null,
  };
}

export function extractClientVersion(html) {
  const direct = /"clientVersion"\s*:\s*"([^"]+)"/.exec(html)?.[1];
  if (direct) return direct;
  const encoded = /<script id="appServerConfig"[^>]*>([A-Za-z0-9+/=\s]+)<\/script>/.exec(html)?.[1];
  if (!encoded) return null;
  try {
    return /"clientVersion"\s*:\s*"([^"]+)"/.exec(Buffer.from(encoded.trim(), "base64").toString("utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

function usernameFromJwt(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return payload.sub ?? payload.username ?? null;
  } catch {
    return null;
  }
}
