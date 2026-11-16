# Screenshot

`@moire/screenshot` captures the primary display and edits PNG images. Its
command is `moire-screenshot [image.png]`, desktop entry is
`moire-screenshot.desktop`, and app ID is `org.moire.Screenshot`.

Set a capture delay (none, 3, 5 or 10 seconds), then Capture. Cancel cancels
the delay or ignores the result of a capture already dispatched. Capture includes all
visible windows except Screenshot's own (below); the delay gives time to arrange the desktop. The backend
captures the compositor's primary-output frame. It does not provide exclusion of other windows,
region selection before capture (Select area captures the screen, then crops), or additional
output selection.

### Screenshot's own window

Like GNOME and macOS, Screenshot leaves itself out: its window is minimized for the capture and
comes back to the front with the result, for Whole screen and Select area alike
(`src/own-window.ts`). The countdown stays on screen during the delay.

1. **When Capture is pressed**, the window asks the compositor for an xdg-activation token. The
   compositor honours tokens only for the focused window, and by the end of the delay the person
   may have clicked elsewhere, so it is asked for now. Tokens last 30 s, past the longest delay.
2. **After the delay**, the window minimizes and does a display roundtrip (`Window.sync`), so the
   compositor has handled the minimize before the capture call is sent.
3. **The compositor** answers `CaptureScreenshot` from a frame composed after the call, with
   window motion (the minimize animation) settled, not from the last frame it happened to draw
   (`CompositorServer.settledFrame`, at most 1 s). No timer guesses at either step.
4. **Afterwards**, success or failure, the window activates itself with the token: restored,
   raised and focused, showing the result.

Without a token (a compositor without xdg-activation) the window stays put and is captured: a
window that could not come back would be worse.

Open PNG loads an existing file, so editing remains available when the Moire
capture service is unavailable. Drag on the preview to crop, draw with the
pen, or mark a rectangle. Annotation color accepts `#RRGGBB`. Undo removes the
last edit, and Reset restores the original image. The pen displays a live
preview while drawing. Crops require a positive area.

Enter a `.png` destination and Save PNG. The default is a dated file under
`~/Pictures/Screenshots`. Existing destinations require replacement
confirmation. Save encodes actual edited RGBA pixels, uses a temporary file
and atomic publication, and creates missing destination directories. Images
larger than 32 million pixels are rejected.

Opening another image, starting a capture or closing with unsaved edits asks
Save, Discard or Cancel. Save continues the requested action only after the
PNG is published successfully. Failed reads, captures and saves retain the
current image; canceling replacement retains the existing destination. Closing
is blocked while publication is in progress. Undoing to the saved revision
clears the unsaved state. There is no text annotation,
clipboard image transfer or non-PNG import/export.

Desktop capture calls `org.moire.Display1.CaptureScreenshot` on
`/org/moire/Display1` over the session bus. The returned private capture file
is decoded and its temporary directory is removed; edited copies remain in
memory until saved. A service failure appears in the app with the Open PNG
fallback.

### Who may capture

`CaptureScreenshot` answers the Screenshot app and nothing else; every other
caller gets `org.freedesktop.DBus.Error.AccessDenied` ("Screen capture is
limited to the Screenshot app") before anything is read from the screen. The
compositor identifies the caller from the kernel, never from what it says
(`apps/system/compositor/src/display-access.ts`):

1. **Pid from the bus daemon.** On every call the compositor asks the daemon
   for the sender's pid (`GetConnectionUnixProcessID`, which the daemon read
   from the socket's peer credentials). Nothing is cached, so a connection that
   has gone, or a pid that now belongs to another process, is judged afresh.
2. **A launch the compositor made.** That pid is followed up `/proc` to the
   nearest process the compositor itself started. Its launch record ends when
   that process exits, so a reused pid never inherits it.
3. **Pinned to the install tree.** All Moire apps run under the same `node`,
   so the executable names no app, and `moire-screenshot` is found on a `PATH`
   whose first entry, `~/.local/bin`, any of the user's processes can write.
   So whenever the compositor launches `moire-screenshot` (or the launcher's
   absolute path) it executes `apps/bundled/screenshot/moire-screenshot` from
   its own install tree, without a `PATH` lookup, and records that file. Only a
   launch recorded with that file passes. A file planted in `~/.local/bin`
   never runs as Screenshot.
4. **Same session.** The compositor starts every app with `setsid`, and the
   caller must still be in the session its launch leads. A process can leave a
   session but never join one, so what Screenshot spawns detached is not
   Screenshot: "Show in Files" runs `xdg-open`, which runs whatever directory
   handler `mimeapps.list` names.

So `busctl --user call org.moire.Display1 /org/moire/Display1
org.moire.Display1 CaptureScreenshot` from a terminal is refused, and so is
`moire-screenshot` run from a terminal (it is the terminal's launch; it can
still open and edit PNGs). While a secure prompt is on screen the capture is
refused for Screenshot too (docs/polkit-agent.md, "Captures").

The same gate gives the display layout and mode methods (`SetLayout`,
`ConfirmLayout`, `RevertLayout`, `SetMode`, `ConfirmMode`, `RevertMode`) to
Settings alone ("Display configuration is limited to Settings"). The reads
(`GetModes`, `GetOutputInfo`, `ListOutputs`) stay open: they say nothing about
what is on screen. Other apps will capture through the Screenshot and
ScreenCast portals, which ask the user ([portals](../portals.md#later)).

What the gate does not cover: code running as the user that can write the
Screenshot app's own process (ptrace where the kernel allows it, or a
development checkout the user owns) is the Screenshot app.

Run `pnpm --filter @moire/screenshot smoke` for pixels produced by the actual
software renderer, the own-window sequencing against a fake compositor
(`own-window.smoke.tsx`), cropping and annotation, PNG round trips, overwrite
protection, and actual Window crop/save input. These checks do not start a
native compositor session; the compositor capture endpoint has separate
backend coverage.

The suite also runs document revision and actual Window lifecycle regressions,
including guarded replacement, failed saves, delayed capture cancellation,
compact keyboard crop/save controls and theme/scale layouts. Native capture
and physical keyboard acceptance remain separate checks.
