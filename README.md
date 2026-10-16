<p align="center"><img src="build/icon.png" width="96" alt="LUMA"></p>

<h1 align="center">🌙 LUMA for Windows</h1>

<p align="center">Free, ad-free music player. Almost any song, offline downloads, live lyrics.</p>

<p align="center">
  <a href="https://github.com/ronazpradhan/luma-for-desktop/releases/latest/download/LUMA-Setup.exe"><b>⬇ Download</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ronazpradhan/luma-for-desktop/releases">Releases</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ronazpradhan/luma-for-desktop/issues">Report a bug</a>
</p>

<p align="center">
  <a href="https://github.com/ronazpradhan/luma-for-desktop/releases/latest"><img alt="Latest version" src="https://img.shields.io/github/v/release/ronazpradhan/luma-for-desktop?label=latest&color=8b7cf6"></a>
  <a href="https://github.com/ronazpradhan/luma-for-desktop/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/ronazpradhan/luma-for-desktop/total?color=8b7cf6"></a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-8b7cf6">
  <a href="LICENSE"><img alt="GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-8b7cf6"></a>
</p>

## Install

1. [Download `LUMA-Setup.exe`](https://github.com/ronazpradhan/luma-for-desktop/releases/latest/download/LUMA-Setup.exe) and open it.
2. If Windows says *"Windows protected your PC"*: **More info → Run anyway** (the installer isn't code-signed).
3. Pick a folder, **Install**, **Finish**.

Windows 10 or 11 (64-bit). Updates install automatically.

## Features

- 🎧 **Plays almost anything** in about a second.
- 🎤 **Live lyrics**, word by word, grouped into verses and choruses.
- ⬇️ **Downloads** to `Music\LUMA` for offline listening.
- ✨ **Quick picks and new releases** from what you actually play.
- 🔁 **Autoplay** with the next songs visible in the queue.
- 📥 **Import** your Spotify and YouTube Music playlists.
- 🔒 **Private:** no account, no tracking. Everything stays on your PC.

**Shortcuts:** <kbd>Space</kbd> play/pause · <kbd>Ctrl</kbd>+<kbd>←</kbd>/<kbd>→</kbd> previous/next · <kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> volume · <kbd>Ctrl</kbd>+<kbd>K</kbd> search · <kbd>Ctrl</kbd>+<kbd>L</kbd> like

## Help

- **A song skips:** open `%APPDATA%\LUMA\luma.log` and send the last lines in an [issue](https://github.com/ronazpradhan/luma-for-desktop/issues/new).
- **Uninstall:** Settings → Uninstall LUMA. Your downloads are kept.

## Developers

```
npm install
npm run dev     # hot reload at http://localhost:5173
npm test
npm run dist    # installer in release/
```

**Release:** bump `version` in `package.json`, commit, then push a matching tag (`git tag v1.2.3 && git push origin v1.2.3`). GitHub Actions builds and publishes it, and installed copies update themselves.

## 📜 Credit is required

LUMA is open source under [GPL-3.0](LICENSE) with [attribution terms](NOTICE). If you use its code:

1. Show this in your app's About screen and README: **Based on [LUMA](https://github.com/ronazpradhan/luma-for-desktop) by Ronaz Pradhan**
2. Keep the copyright line and the [`NOTICE`](NOTICE) file.
3. Keep your version open source under GPL-3.0.
4. Mark it as modified. Don't present it as the official LUMA.

## Thanks

[Stash](https://github.com/rawnaldclark/Stash) · [Spotube](https://github.com/KRTirtho/spotube) · [YouTube.js](https://github.com/LuanRT/YouTube.js) · [yt-dlp](https://github.com/yt-dlp/yt-dlp) · Lyrics: [LyricsPlus](https://github.com/ibratabian17/lyricsplus), [Unison](https://github.com/better-lyrics/unison), [SimpMusic](https://github.com/maxrave-dev/SimpMusic), [LRCLIB](https://lrclib.net), KuGou

<p align="center"><sub>© 2026 <a href="https://github.com/ronazpradhan">Ronaz Pradhan</a></sub></p>
