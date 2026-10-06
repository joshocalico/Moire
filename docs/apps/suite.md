# Moire app suite

The session registers the apps shipped in this checkout. Open them from the
launcher; Files uses desktop MIME associations to open supported documents.
Registration fills empty defaults and preserves an existing user choice.
System Monitor improves the existing Process Manager and retains its launch ID.

## Workflows available for testing

| App                                   | Useful workflow                                                                              | Current limits                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Files](files.md)                     | Independent folder tabs, history/search, group operations/recovery, tags and previews        | No recursive/content search or cross-filesystem moves; native acceptance pending                                                                       |
| [Text Editor](editor.md)              | Open UTF-8, multiline editing, Save/Save As, unsaved-close protection                        | Plain text; bounded document size                                                                                                                      |
| [Image Viewer](image-viewer.md)       | Open image, fit/zoom/pan/rotate                                                              | Animated images show first frame; no SVG/RAW                                                                                                           |
| [Calculator](calculator.md)           | Keyboard/keypad expressions, precedence and history                                          | Session history; no scientific functions                                                                                                               |
| [Notes](notes.md)                     | Notebooks, search, pin/move, bold/underline/highlight, autosave and guarded close            | Local storage; plain-text clipboard; no sync, automatic merge or IME                                                                                   |
| [Music](music.md)                     | Recursive local import, tagged library/artwork, Albums/Artists/Songs, queue and mpv controls | Local files; bounded imports; saved queue resumes explicitly; no streaming or named playlists; audible playback and native layout acceptance pending             |
| [Archive Manager](archive-manager.md) | Inspect/extract ZIP/tar; create tar.gz                                                       | Refuses links/special entries; exclusive output paths                                                                                                  |
| System Monitor                        | Search processes, inspect CPU/memory/swap/load, quit/confirm force quit                      | Management service required; no charts/history                                                                                                         |
| [Calendar](calendar.md)               | Persistent events, month/agenda/search, timezone-aware editing                               | Local events; no calendar service                                                                                                                      |
| [Clock](clock.md)                     | Countdown, stopwatch/laps, persistent daily alarms                                           | App must remain running; no background wake service                                                                                                    |
| [Screenshot](screenshot.md)           | Capture with delay, crop, pen/box annotations, save PNG                                      | Primary display; no text annotation or region selection before capture                                                                                 |
| [Document Viewer](document-viewer.md) | Render PDF pages, navigate/zoom/pan                                                          | PDF only; no Office documents or password-entry flow                                                                                                   |
| [Video Player](video-player.md)       | Local playback with real mpv controls                                                        | Local files; separate native video window; queue from launch arguments; no subtitle/track UI                                                           |
| [Disk Usage](disk-usage.md)           | Allocated-space scan, largest-first drill-down, cancel                                       | Bounded scan; no deletion or filesystem crossing                                                                                                       |
| [Font Viewer](font-viewer.md)         | Actual font metadata and editable rendered sample                                            | First collection face; no installation, WOFF or variable-axis controls                                                                                 |
| [Characters](characters.md)           | Search curated Unicode, categories, clipboard copy                                           | Curated collection rather than full Unicode database                                                                                                   |
| [Colors](colors.md)                   | HEX/RGB editing, swatches and persistent palettes                                            | No screen eyedropper                                                                                                                                   |
| [Sound Recorder](sound-recorder.md)   | Record/stop/probe/save/discard a WAV take                                                    | Requires running PipeWire input; WAV only; no device picker or recording editor; capture acceptance pending                                            |
| [Weather](weather.md)                 | City search, forecast, cached offline fallback                                               | Network for new locations; saved forecasts offline; Celsius/km/h only; no GPS, hourly forecast or alerts                                               |
| [Dictionary](dictionary.md)           | English lookup, definitions and offline cache                                                | English only; cached words offline; no bundled database, cache refresh or pronunciation audio; phonetic glyph availability depends on the bundled font |
| [Help](help.md)                       | Search implemented workflows and shortcuts                                                   | Curated source-backed topics                                                                                                                           |

No paid service, account credential, microphone permission or additional VM
system permission is introduced by these apps. Weather and Dictionary make
explicit user-triggered requests to their documented public APIs.

## Verify workflows

Install with the pinned pnpm version, then run the repeatable suite:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm -r run typecheck
./scripts/test-app-suite.sh
```

Tests use disposable files and isolated HOME/XDG state. The media tests create
real fixtures and exercise real utilities. When mpv exists they verify JSON IPC,
decoding, pause/play, seeking, volume and stop using null audio/video outputs.
Recorder capture requires an explicitly supplied disposable PipeWire source and
`MOIRE_TEST_AUDIO_INPUT=1`; the normal run checks unavailable-backend handling.
Headless app controls are exercised through actual Window input where documented.
These checks do not establish live audio, GPU presentation or microphone capture.

The headless gallery can be regenerated with:

```bash
corepack pnpm --filter @moire/ui exec tsx scripts/app-suite-gallery.smoke.tsx
```

## Shared toolkit stage

Files, Notes and Music now implement their pane and document workflows through
the shared toolkit. `WindowFrame` provides application identity and real window
actions. `AdaptivePanes` owns pane allocation, divider input and compact overlays
while keeping pane state mounted. Files uses titlebar tabs, `NavigationSidebar`,
a virtualized `Table` and keyed `Grid`; its operation pipeline remains shared
across tabs. Notes uses `DocumentEditor` with saved formatting ranges, selection
undo and a floating selection toolbar. Music uses measured collection rows and
`PlaybackBar` with a queue that survives pane changes and resize.

The apps also exercise clipboard transfer, scoped focus, clipped pointer
dispatch and native close guards. Editor and Notes use recipe-owned intrinsic
Button sizing. Help and Dictionary use natural text/card flow rather than
estimating paragraph heights and manually stacking coordinates. See
[the widget APIs](../ui/widgets.md).

Recorded headless evidence includes Files' tab state, 1,200-file sorting,
group Copy/Trash/Undo/Restore and DnD; Notes' rich save/reopen, painted formatting,
selection, clipboard and close conflicts; and Music's real media metadata,
artwork, queue and observed IPC playback state. Captures and verification notes
are in `vm/verification/2026-10-02-app-suite/{files-v1-headless,notes-v1-headless,music-v0-headless}`.
Music's host workflow uses an explicitly labelled child-process IPC fixture
when mpv is unavailable; that fixture does not prove decoding or audible output.

These workflows are implemented and headless tested. Native interaction and
full-suite visual approval remain open. Candidate 11's Music verification
needed a null-output test correction and exposed native layout clipping.
The corrections require fresh packaged/native verification. Candidate 11 has
no suite acceptance claim.

## VM stage

Build a fresh image using [the ARM64 VM commands](../nixos-vm.md). Backend tools
are packaged with the session: FFmpeg, mpv, Poppler, libarchive, fontconfig and
PipeWire utilities. Merely including PipeWire utilities does not create an
input or grant access to a microphone.

Without a data disk, writable state lives in RAM and disappears at power-off.
C44's [persistent home option](../nixos-vm.md#keep-home-and-system-configuration-c44)
retains home-backed notes, events, palettes, library metadata and files across
boots. Editor, preferences and Notes storage APIs have passed exact cold-boot
readback; individual native app workflows still need their own acceptance.
Disposable overlays remain a separate future milestone.

Candidate 8 boots a live QEMU/HVF session. Its exact installed ARM64 package
passes the workflow suite and isolated D-Bus/procfs service checks. The actual
Screenshot client captures the EGL primary output, crops and annotates it, saves
a PNG and removes its temporary capture. The native Image Viewer opens that
saved result. Evidence is recorded in [the quality review](../quality-review.md).

Live keyboard/pointer and native clipboard acceptance, audible playback, real
recorder input, native video presentation and whole-suite visual approval remain
open. Candidate 8's rendering evidence used llvmpipe and the wl_shm fallback.
That checkpoint establishes fallback behavior, not improved GPU residency,
performance or tear-free movement. Current renderer evidence is tracked in the
[quality review](../quality-review.md). Preserve every fallback ISO and run only
one graphics test VM at a time.

## Candidate 32 source stage

This candidate adds conservative rounded-window visibility proofs, Editor
document-history isolation and UTF-8 byte limits, Archive publication safety
and compact controls, Screenshot unsaved-image guards, focused Calculator
activation, Weather request invalidation, and Help entries for all twenty apps.
Host and Linux source regressions are recorded under
`vm/verification/2026-10-03-app-suite-candidate-32`. Installed image and native
acceptance are required before this candidate is accepted. Later media and
Calendar/Clock/Colors changes are being prepared outside this candidate.

## Candidate 33 integration

Calendar, Clock and Colors use one shared local-storage implementation. Saves
compare the loaded revision and use a cooperative lock before publishing.
Active or unknown lock owners produce an error; an interrupted owner is
reclaimed only when its process is confirmed dead. This coordinates Moire
writers. An external program that ignores the lock can still race publication.

Source workflow checks cover independent processes, two app windows, retained
drafts, malformed data, failed publication and interrupted saves. Candidate 33
also improves Music import, video queue completion, font sample layout,
Calendar close protection and Clock's individual timer and alarm notices.
The exact C33 installed suite and four renderer/reopen/residency/motion gates
pass. Native Screenshot precise crop, close/overwrite cancellation and saved
PNG activation through Files to Image Viewer pass. Native drag cropping still
fails safely; annotation, rapid typing, audio/video/capture devices and broad
native app acceptance remain open. See [the C33 results](../quality-review.md#candidate-33-installed-and-native-results).

Calendar, Clock and Colors distinguish committed saves from pending cleanup. A cleanup warning offers Retry, which only retries owned temporary-file cleanup and does not save another copy. The shared store retains at most eight pending leases per process and refuses a ninth write before publication if cleanup still cannot complete. This limit does not bound orphan directories across crashes or restarts; unknown ownership is left untouched.
