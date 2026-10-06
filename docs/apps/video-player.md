# Video Player

Open local video paths or file URLs. Video plays in mpv's native Wayland window. The Moire control panel provides Play/Pause, Stop, Reopen, Previous/Next, seek, volume and Fullscreen. Multiple launch arguments form a playlist.

Supports codecs available in packaged mpv. Video is a separate native playback window, not embedded in the control panel. Subtitles, track selection and playlists beyond launch arguments are not exposed. Playback begins paused.

At EOF, the next queue entry starts playing, including consecutive entries
with the same path. The final entry stops without wrapping. Play then reopens
that entry for replay; Reopen and manual Previous/Next start paused. Stop
retires the current backend and retains the queue. Decoder and process errors
remain visible in the control panel.

Package: `apps/bundled/video-player`. Launcher: `moire-video-player`.
Required guest tools: mpv with Wayland video support.

## Verification

```bash
pnpm --filter @moire/video-player smoke
pnpm --filter @moire/video-player typecheck
```

Real generated video/audio and ffprobe duration, explicit missing-backend state. Where mpv is available, smoke also runs actual play/pause/seek/volume/stop with null output. Live video presentation remains a guest check.

Tests write only disposable fixtures with isolated HOME/XDG directories.
Live focus, overlap, resize, keyboard and output-device acceptance remains open.
