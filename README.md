<p align="center"><img src="build/icon.png" width="96" alt="LUMA"></p>

<h1 align="center">LUMA for Windows</h1>

<p align="center">A free music player for your PC. Search almost any song, play it in seconds, download it for offline listening, and sing along with live lyrics.</p>

<p align="center">
  <a href="https://github.com/ronazpradhan/luma-for-desktop/releases/latest/download/LUMA-Setup.exe"><b>⬇ Download LUMA for Windows</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ronazpradhan/luma-for-desktop/releases">All releases</a>
</p>

<p align="center">
  <a href="https://github.com/ronazpradhan/luma-for-desktop/releases/latest"><img alt="Latest version" src="https://img.shields.io/github/v/release/ronazpradhan/luma-for-desktop?label=latest&color=8b7cf6"></a>
  <a href="https://github.com/ronazpradhan/luma-for-desktop/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/ronazpradhan/luma-for-desktop/total?color=8b7cf6"></a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-8b7cf6">
  <a href="LICENSE"><img alt="GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-8b7cf6"></a>
</p>

---

## Install

1. **[Download `LUMA-Setup.exe`](https://github.com/ronazpradhan/luma-for-desktop/releases/latest/download/LUMA-Setup.exe)** (always the newest version).
2. Open it. If Windows shows **"Windows protected your PC"**, click **More info**, then **Run anyway**. That warning appears because the installer isn't code-signed, not because something is wrong with it.
3. Follow the setup:
   - **Who it's for:** just you, or everyone who uses this PC.
   - **Where to put it:** keep the suggested folder, or click **Browse** to choose another.
   - **Install**, then leave **Run LUMA** ticked and click **Finish**.

LUMA gets a desktop shortcut and a Start menu entry. No account, no sign-up.

**Needs:** Windows 10 or 11, 64-bit, and an internet connection (downloaded songs play offline).

## Updates are automatic

You install LUMA once. After that:

- LUMA checks for a new version when it starts, then every few hours.
- If there is one, it downloads quietly in the background while you listen.
- When it's ready, a **Restart to update** button appears in the sidebar. Click it, or just keep listening: the update installs the next time you close LUMA.

You can see your version and check for updates yourself in **Settings → About**. Your liked songs, playlists and downloads stay as they are through every update.

## What it does

- **Plays almost anything, fast.** Each song is looked up on JioSaavn and YouTube at once and plays from whichever is ready first, usually in under a second.
- **Live lyrics, grouped like a lyric sheet.** Verses, choruses and bridges are labelled and spaced apart, and lyrics light up word by word when the source times each word. Click a line to jump to it.
- **Never runs out.** When your queue ends, autoplay keeps going with songs like the last one.
- **A home that learns you.** Suggestions grow from what you play, next to YouTube Music's picks and new releases.
- **Your library, on your PC.** Liked songs, your own playlists and your history are saved on this computer. Right-click any playlist to play, shuffle, rename or delete it.
- **Downloads.** Save songs to `Music\LUMA` and play them without internet.
- **Bring your music with you.**
  - **Spotify:** import your Liked Songs and playlists (*Settings → Spotify*).
  - **YouTube Music:** see your likes and playlists, and play songs that are hard to find elsewhere (*Settings → YouTube*).
- **Feels at home on Windows.** Media keys and the Windows volume flyout control playback, and the window takes on the colours of the song that's playing.

### Keyboard shortcuts

| Keys | Does |
|---|---|
| <kbd>Space</kbd> | Play or pause |
| <kbd>Ctrl</kbd> + <kbd>→</kbd> / <kbd>←</kbd> | Next / previous song |
| <kbd>Ctrl</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> | Volume up / down |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> | Search |
| <kbd>Ctrl</kbd> + <kbd>L</kbd> | Like the song that's playing |
| <kbd>Delete</kbd> | Delete the selected playlist |

## Private by design

LUMA has no accounts, no servers of its own and no tracking. It runs a small engine on your own PC that only the LUMA window can talk to. If you connect YouTube or Spotify, only that sign-in is kept, encrypted with Windows' own protection, and LUMA never sees your password. LUMA never changes anything in your Spotify or YouTube account.

## Something not working?

- **A song keeps skipping:** LUMA writes what happened to each song in a log. Press <kbd>Win</kbd> + <kbd>R</kbd>, paste `%APPDATA%\LUMA`, and open `luma.log`. The last lines usually say why. Include them if you [report a problem](https://github.com/ronazpradhan/luma-for-desktop/issues/new).
- **"Windows protected your PC" when installing:** choose **More info → Run anyway** (see [Install](#install)).
- **No update showing up:** open **Settings → About → Check for updates**. Versions from before 0.6.0 can't update themselves, so download the newest installer once from the link above. It installs over your old version and keeps your library.
- **Uninstalling:** in LUMA, open **Settings → LUMA on this PC → Uninstall LUMA**. You can also use Windows' **Settings → Apps → Installed apps → LUMA → Uninstall**. The uninstaller asks whether to delete your library (liked songs, playlists, history). Downloaded songs in `Music\LUMA` are always kept.

[Report a bug or suggest something →](https://github.com/ronazpradhan/luma-for-desktop/issues)

---

## For developers

```
npm install
npm run dev     # engine + UI with hot reload at http://localhost:5173
npm run app     # the desktop app, built from source
npm test        # engine tests
npm run dist    # Windows installer in release/ (not published)
```

### Publishing a new version

Releases are built and published by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)). Everyone's installed LUMA picks them up automatically.

```
npm version 0.6.1 --no-git-tag-version   # bump package.json
git commit -am "LUMA for Windows 0.6.1: what changed"
git tag v0.6.1
git push && git push origin v0.6.1
```

The tag must match the version in `package.json`. The workflow tests the app, builds `LUMA-Setup.exe`, and publishes a release with `latest.yml`, which is the file installed copies check for updates. To edit the release notes, open the release on GitHub after the workflow finishes.

## Credits

Made by Ronaz Pradhan. LUMA for Android is a fork of [Stash](https://github.com/rawnaldclark/Stash) by rawnaldclark, and this app reuses its approach to matching songs on JioSaavn. Lyrics come from [LyricsPlus](https://github.com/ibratabian17/lyricsplus) (the backend of [YouLy+](https://github.com/ibratabian17/YouLyPlus)), [Unison](https://github.com/better-lyrics/unison) (from [Better Lyrics](https://github.com/better-lyrics/better-lyrics)), [SimpMusic Lyrics](https://github.com/maxrave-dev/SimpMusic), [LRCLIB](https://lrclib.net) and KuGou. Thanks to the people who run them; LUMA keeps lyrics on your PC after the first look-up so each song is asked for once, and you can point it at your own LyricsPlus server in Settings. YouTube playback works the way [Spotube](https://github.com/KRTirtho/spotube)'s YouTube plugin does, through [YouTube.js](https://github.com/LuanRT/YouTube.js), with [yt-dlp](https://github.com/yt-dlp/yt-dlp) as the last resort (downloaded on first use from its official releases and checked against their published checksums). Thanks to the Spotube, YouTube.js and yt-dlp teams.

Licensed under [GPL-3.0](LICENSE).
