<p align="center"><img src="build/icon.png" width="96" alt="LUMA"></p>

<h1 align="center">LUMA for Windows</h1>

<p align="center">The LUMA music player, on your PC. Search YouTube Music's catalog, play it, download it, and read the lyrics as they're sung.</p>

## What it does

- **Plays fast, no sign-in needed.** Each song is looked up on JioSaavn (AAC up to 320 kbps) and on YouTube at the same time, usually ready in under a second. Resting the pointer on a song starts its lookup before you click.
- **Home that knows you.** Suggestions grow from what you play, next to YouTube Music's Quick picks and new releases.
- **Never stops.** When the queue ends, autoplay carries on with songs like the last one, the way YouTube Music does.
- **Live lyrics.** Now Playing follows the song line by line (from LRCLIB, or YouTube Music's text when there are no timed lyrics). Click a line to jump to it.
- **Your library on your PC.** Liked songs, your own playlists and history, stored on this computer.
- **Downloads.** Save songs to `Music\LUMA` and play them without internet.
- **Windows-native.** Media keys and the volume flyout's player controls work; the window takes your song's colours.

## Install

Download `LUMA-Setup.exe` from Releases and run it. Windows may show "Windows protected your PC" because the installer isn't code-signed: choose **More info**, then **Run anyway**.

## Private by design

LUMA doesn't have accounts, servers or tracking. The app runs a small engine on your own PC (`127.0.0.1` only) that answers nothing but the LUMA window: every request needs a key that changes each time LUMA starts, and requests from websites or other devices are refused. The window itself has no access to your files.

## Build it yourself

```
npm install
npm run dev     # engine + UI with hot reload at http://localhost:5173
npm test        # engine tests
npm run dist    # Windows installer in release/
```

## Credits

Made by Ronaz Pradhan. LUMA for Android is a fork of [Stash](https://github.com/rawnaldclark/Stash) by rawnaldclark; this app reuses its approach to matching songs on JioSaavn. Lyrics from [LRCLIB](https://lrclib.net). YouTube playback works the way [Spotube](https://github.com/KRTirtho/spotube)'s YouTube plugin does: asking YouTube as its own apps and mobile website, through [YouTube.js](https://github.com/LuanRT/YouTube.js), with [yt-dlp](https://github.com/yt-dlp/yt-dlp) as the last resort (downloaded on first use from its official releases and checked against their published checksums). Thanks to the Spotube, YouTube.js and yt-dlp teams.

Licensed under GPL-3.0.
