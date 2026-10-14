// YouTube Music's own web API (InnerTube, the WEB_REMIX client): search, home,
// albums, artists, playlists and song radio. Metadata only — audio comes from
// resolver.js. Signed out; nothing here needs or sends an account.

const BASE = "https://music.youtube.com/youtubei/v1";

// The web client wants a recent version; a week-old date always is one.
function clientVersion() {
  const d = new Date(Date.now() - 7 * 86_400_000);
  return `1.${d.toISOString().slice(0, 10).replaceAll("-", "")}.01.00`;
}

const FILTER = {
  songs: "EgWKAQIIAWoMEA4QChADEAQQCRAF",
  albums: "EgWKAQIYAWoMEA4QChADEAQQCRAF",
  artists: "EgWKAQIgAWoMEA4QChADEAQQCRAF",
};

export function createYtMusic({ fetchImpl = fetch, hl = "en", gl = "US" } = {}) {
  async function call(endpoint, body, query = "") {
    const res = await fetchImpl(`${BASE}/${endpoint}?prettyPrint=false${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
        Origin: "https://music.youtube.com",
        Referer: "https://music.youtube.com/",
      },
      body: JSON.stringify({ ...body, context: { client: { clientName: "WEB_REMIX", clientVersion: clientVersion(), hl, gl } } }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`YouTube Music ${endpoint} answered ${res.status}`);
    return res.json();
  }

  return {
    async search(query) {
      const [songs, albums, artists] = await Promise.all([
        call("search", { query, params: FILTER.songs }),
        call("search", { query, params: FILTER.albums }).catch(() => null),
        call("search", { query, params: FILTER.artists }).catch(() => null),
      ]);
      return {
        songs: shelfItems(songs).map(parseSongRow).filter(Boolean),
        albums: shelfItems(albums).map(parseBrowseRow).filter((x) => x?.kind === "album").slice(0, 12),
        artists: shelfItems(artists).map(parseBrowseRow).filter((x) => x?.kind === "artist").slice(0, 8),
      };
    },

    async suggestions(query) {
      const json = await call("music/get_search_suggestions", { input: query });
      const out = [];
      for (const section of json.contents ?? []) {
        for (const c of section.searchSuggestionsSectionRenderer?.contents ?? []) {
          const text = runsText(c.searchSuggestionRenderer?.suggestion?.runs);
          if (text) out.push(text);
        }
      }
      return out.slice(0, 8);
    },

    async home() {
      const first = await call("browse", { browseId: "FEmusic_home" });
      const list = first.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer;
      let sections = list?.contents ?? [];
      const token = list?.continuations?.[0]?.nextContinuationData?.continuation;
      if (token) {
        const more = await call("browse", {}, `&ctoken=${encodeURIComponent(token)}&continuation=${encodeURIComponent(token)}&type=next`).catch(() => null);
        sections = sections.concat(more?.continuationContents?.sectionListContinuation?.contents ?? []);
      }
      return sections.map(parseCarousel).filter((s) => s && s.items.length);
    },

    async radio(videoId) {
      const json = await call("next", { videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true });
      return watchQueue(json).filter((t) => t.id !== videoId);
    },

    async lyricsRef(videoId) {
      const json = await call("next", { videoId });
      const tabs = json.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs ?? [];
      return tabs.map((t) => t.tabRenderer?.endpoint?.browseEndpoint?.browseId).find((id) => id?.startsWith("MPLY")) ?? null;
    },

    async plainLyrics(browseId) {
      const json = await call("browse", { browseId });
      const shelf = findKey(json, "musicDescriptionShelfRenderer");
      return shelf ? runsText(shelf.description?.runs) : null;
    },

    async album(browseId) {
      const json = await call("browse", { browseId });
      const header = findKey(json, "musicResponsiveHeaderRenderer");
      const art = bestThumb(findKey(header, "thumbnails"));
      const artist = runsText(header?.straplineTextOne?.runs);
      const artistId = header?.straplineTextOne?.runs?.find((r) => r.navigationEndpoint?.browseEndpoint)?.navigationEndpoint.browseEndpoint.browseId ?? null;
      const shelf = findKey(json, "musicShelfRenderer") ?? findKey(json, "musicPlaylistShelfRenderer");
      const title = runsText(header?.title?.runs);
      const tracks = (shelf?.contents ?? [])
        .map((c) => parseSongRow(c, { artist, album: title, albumId: browseId, art }))
        .filter(Boolean);
      return {
        id: browseId,
        title,
        subtitle: runsText(header?.subtitle?.runs),
        artist,
        artistId,
        art,
        tracks,
      };
    },

    async playlist(playlistId) {
      const browseId = playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`;
      const json = await call("browse", { browseId });
      const header = findKey(json, "musicResponsiveHeaderRenderer") ?? findKey(json, "musicDetailHeaderRenderer");
      const art = bestThumb(findKey(header, "thumbnails"));
      const shelf = findKey(json, "musicPlaylistShelfRenderer") ?? findKey(json, "musicShelfRenderer");
      return {
        id: playlistId,
        title: runsText(header?.title?.runs),
        subtitle: runsText(header?.subtitle?.runs) || runsText(header?.secondSubtitle?.runs),
        art,
        tracks: (shelf?.contents ?? []).map((c) => parseSongRow(c)).filter(Boolean),
      };
    },

    async artist(browseId) {
      const json = await call("browse", { browseId });
      const header = findKey(json, "musicImmersiveHeaderRenderer") ?? findKey(json, "musicVisualHeaderRenderer");
      const name = runsText(header?.title?.runs);
      const sections = json.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
      const top = sections.find((s) => s.musicShelfRenderer)?.musicShelfRenderer;
      return {
        id: browseId,
        name,
        art: bestThumb(findKey(header?.thumbnail, "thumbnails")),
        about: runsText(header?.description?.runs),
        songs: (top?.contents ?? []).map((c) => parseSongRow(c, { artist: name, artistId: browseId })).filter(Boolean),
        shelves: sections.map(parseCarousel).filter((s) => s && s.items.length && s.items.some((i) => i.kind !== "song")),
      };
    },
  };
}

// ---- parsing ---------------------------------------------------------------

export function runsText(runs) {
  return (runs ?? []).map((r) => r.text).join("");
}

/** The first value under [key] anywhere in [node], depth-first. */
export function findKey(node, key) {
  if (!node || typeof node !== "object") return undefined;
  if (Object.hasOwn(node, key)) return node[key];
  for (const v of Object.values(node)) {
    const hit = findKey(v, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Largest thumbnail, asked for at 544 px when Google's image server can resize it. */
export function bestThumb(thumbs) {
  const url = Array.isArray(thumbs) && thumbs.length ? thumbs[thumbs.length - 1].url : null;
  if (!url) return null;
  return /googleusercontent\.com|ggpht\.com/.test(url) ? url.replace(/=w\d+-h\d+.*$/, "=w544-h544-l90-rj") : url;
}

function shelfItems(json) {
  if (!json) return [];
  const sections = json.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  return sections.flatMap((s) => s.musicShelfRenderer?.contents ?? []);
}

function pageType(run) {
  return run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
}

const DURATION = /^\d{1,2}(:\d{2}){1,2}$/;

export function toSeconds(text) {
  if (!text || !DURATION.test(text)) return null;
  return text.split(":").reduce((acc, n) => acc * 60 + Number(n), 0);
}

/**
 * A song row (search, album, playlist, artist top songs, Quick picks). [fallback]
 * fills what album and artist pages leave out of their rows.
 */
export function parseSongRow(item, fallback = {}) {
  const r = item?.musicResponsiveListItemRenderer;
  if (!r) return null;
  const id = r.playlistItemData?.videoId ?? findKey(r.overlay, "videoId");
  if (!id) return null;
  const cols = (r.flexColumns ?? []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []);
  const title = runsText(cols[0]);
  if (!title) return null;
  const meta = cols.slice(1).flat();
  const artists = meta.filter((x) => pageType(x) === "MUSIC_PAGE_TYPE_ARTIST" || pageType(x) === "MUSIC_PAGE_TYPE_USER_CHANNEL");
  const albumRun = meta.find((x) => pageType(x) === "MUSIC_PAGE_TYPE_ALBUM");
  const fixed = (r.fixedColumns ?? []).map((c) => runsText(c.musicResponsiveListItemFixedColumnRenderer?.text?.runs));
  const durationText = [...meta.map((x) => x.text), ...fixed].find((t) => DURATION.test(t?.trim() ?? ""));
  // A row with no linked artist names them in its first plain segment, unless
  // that is a play count (album pages) or a type label.
  const plain = meta.length && !artists.length ? meta[0].text : null;
  const plainArtist = plain && !/^(Song|Video|Episode)$/.test(plain) && !/\d.*(plays|views)$/i.test(plain) ? plain : null;
  const artist = artists.map((a) => a.text).join(", ") || fallback.artist || plainArtist || "";
  return {
    kind: "song",
    id,
    title,
    artist,
    artistId: artists[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? fallback.artistId ?? null,
    album: albumRun?.text ?? fallback.album ?? null,
    albumId: albumRun?.navigationEndpoint?.browseEndpoint?.browseId ?? fallback.albumId ?? null,
    duration: toSeconds(durationText?.trim()),
    art: bestThumb(r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) ?? fallback.art ?? null,
    explicit: !!findKey(r.badges, "musicInlineBadgeRenderer")?.icon?.iconType?.includes("EXPLICIT"),
  };
}

/** A search row that opens a page: an album or an artist. */
function parseBrowseRow(item) {
  const r = item?.musicResponsiveListItemRenderer;
  const nav = r?.navigationEndpoint?.browseEndpoint;
  if (!nav) return null;
  const type = nav.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  const cols = (r.flexColumns ?? []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []);
  const base = { id: nav.browseId, title: runsText(cols[0]), subtitle: runsText(cols[1]), art: bestThumb(r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) };
  if (type === "MUSIC_PAGE_TYPE_ALBUM") return { kind: "album", ...base };
  if (type === "MUSIC_PAGE_TYPE_ARTIST") return { kind: "artist", ...base };
  return null;
}

/** A tile in a carousel: an album, a playlist, an artist, or a song. */
function parseTile(item) {
  if (item.musicResponsiveListItemRenderer) return parseSongRow(item);
  const r = item.musicTwoRowItemRenderer;
  if (!r) return null;
  const title = runsText(r.title?.runs);
  const subtitle = runsText(r.subtitle?.runs);
  const art = bestThumb(findKey(r.thumbnailRenderer, "thumbnails"));
  const watch = r.navigationEndpoint?.watchEndpoint;
  if (watch?.videoId) {
    return { kind: "song", id: watch.videoId, title, artist: subtitle.split(" • ").find((s) => !/views|plays/i.test(s) && s !== "Song" && s !== "Video") ?? subtitle, art, duration: null, album: null };
  }
  const nav = r.navigationEndpoint?.browseEndpoint;
  if (!nav) return null;
  const type = nav.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  if (type === "MUSIC_PAGE_TYPE_ALBUM") return { kind: "album", id: nav.browseId, title, subtitle, art };
  if (type === "MUSIC_PAGE_TYPE_PLAYLIST") return { kind: "playlist", id: nav.browseId.replace(/^VL/, ""), title, subtitle, art };
  if (type === "MUSIC_PAGE_TYPE_ARTIST") return { kind: "artist", id: nav.browseId, title, subtitle, art };
  return null;
}

function parseCarousel(section) {
  const c = section.musicCarouselShelfRenderer;
  if (!c) return null;
  const title = runsText(c.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs);
  if (!title) return null;
  return { title, items: (c.contents ?? []).map(parseTile).filter(Boolean) };
}

/** The rows of a `next` response's queue: what YouTube Music plays after a song. */
export function watchQueue(json) {
  const tabs = json.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs ?? [];
  const rows = tabs[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents ?? [];
  return rows
    .map((row) => row.playlistPanelVideoRenderer ?? row.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer)
    .filter((r) => r?.videoId)
    .map((r) => {
      const runs = r.longBylineText?.runs ?? [];
      const artists = runs.filter((x) => pageType(x) === "MUSIC_PAGE_TYPE_ARTIST");
      const albumRun = runs.find((x) => pageType(x) === "MUSIC_PAGE_TYPE_ALBUM");
      return {
        kind: "song",
        id: r.videoId,
        title: runsText(r.title?.runs),
        artist: artists.map((a) => a.text).join(", ") || runsText(runs).split(" • ")[0],
        artistId: artists[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? null,
        album: albumRun?.text ?? null,
        albumId: albumRun?.navigationEndpoint?.browseEndpoint?.browseId ?? null,
        duration: toSeconds(runsText(r.lengthText?.runs)),
        art: bestThumb(r.thumbnail?.thumbnails),
      };
    });
}
