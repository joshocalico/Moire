# Music

Music imports and plays local audio. Its launcher is `moire-music`, desktop
entry `moire-music.desktop`, and app ID `org.moire.Music`.

## Library and playback

Import a local file, file URL or folder. Folder imports scan recursively without
following nested symlinks; a directly selected symlink resolves to its target.
The scanner reads title, artist, album, year, track number and duration through
ffprobe. Untagged titles use the filename, and untagged albums group by folder.
Artwork comes from adjacent `cover.png` or `folder.png`, or an embedded picture
converted to PNG by ffmpeg. Missing or undecodable artwork does not prevent
an otherwise readable audio track from entering the library.

Albums, Artists, Songs and Recently added browse the imported library. Search
matches title, artist and album. Play album, Shuffle and Add to queue use the
visible tracks. Arrows, Home, End and Enter navigate track collections. The
queue supports playback of a chosen entry, Remove selected and Clear upcoming.

Previous, Play/Pause, Next, Stop, seek and volume operate through mpv JSON IPC.
Automatic queue advancement requires a real EOF event. Files opened through
launch arguments or file associations start paused. Stop closes playback while
retaining the queue; Resume reopens the current track at its last observed
position. Pane changes and resize retain playback and queue state. The shared window header provides move,
minimize, maximize and close actions; compact pane controls expose the library
and queue when the panes cannot fit side by side.

Required guest tools are mpv, ffprobe and ffmpeg. Supported audio codecs depend
on the packaged utilities. The local path field is an import workflow, not a
native file picker.

## Storage and limits

The library is stored in `$XDG_DATA_HOME/moire/music/library.json`, or
`~/.local/share/moire/music/library.json`. Saves use an exclusive write lock,
a revision check and atomic replacement. Malformed storage is preserved.
Reload reads changes made by another window before further edits. Removing a
library entry leaves the original audio file in place.

The queue is stored beside the library in `queue.json`. Ordered entries have
separate identities, so repeated copies of a track remain distinct. Music
restores the current entry and last observed playback position, then waits
stopped for an explicit Resume action. It opens paused, seeks, and only then
starts playback. Missing media stays in the queue; a playback attempt reports
the failure and the existing Remove and Next actions remain available.

Queue saves use the shared revision-checked atomic store. Active playback
checkpoints at most once every five seconds; pause, stop, queue edits and close
flush the latest observed position. A requested seek is not saved as a position
until the backend reports it. Abrupt termination can lose the most recent
checkpoint interval. Save failures keep this window's draft and stop automatic
saves. Retry save preserves the loaded revision. Reload saved queue asks before
discarding the draft and stops playback; it does not overwrite another window's
changes or malformed saved bytes. Closing with an unsaved draft does not
make it durable; only a successful save does.

Imports are cancellable and limited to 5,000 tracks and 16 folder levels.
Unreadable files produce warnings; readable tracks can still be imported.
The queue supports up to 5,000 entries within a 10 MiB saved-data limit.
There are no streaming services, named playlists, favorites, recommendations, repeat mode or
output-device chooser. Sidecar artwork supports PNG. Album grouping uses
performer and album or folder; dedicated compilation album-artist grouping
remains a follow-up.

The immutable ISO keeps writable state in RAM. The saved library and artwork
cache survive app relaunch during that boot and disappear when the VM powers
off. The queue follows the same writable-home lifetime as the library. Original
media supplied through an external filesystem follows that
filesystem's own lifetime.

## Verification

```bash
pnpm --filter @moire/music smoke
pnpm --filter @moire/music typecheck
pnpm --filter @moire/music smoke:queue
```

The smoke creates disposable HOME/XDG/TMP fixtures, tagged FLAC media and actual
embedded artwork. Real Window input checks paused file-association loading,
observed playback time, pause stability, seek position, EOF advancement, queue
removal, stop/restart, resize and library removal. When mpv is installed, the
workflow runs with null audio and video outputs. Otherwise it reports a real
child-process IPC fixture, which proves protocol and queue behavior rather than
media decoding. A separate backend smoke checks missing mpv.

The focused `smoke:queue` command requires actual mpv and uses null audio/video
outputs. It checks private storage, independent-process reopening and the
public Window queue/resume workflow. It does not substitute an IPC fixture for
media decoding. Source-stage receipts are in
`vm/verification/2026-10-04-c51-music-persistence`; this change is not in the
preserved C50 image. The ARM64 Linux source checks passed 31 storage cases,
seven independent processes and actual mpv Window workflows at two scales,
plus a focused check at the default 1020×700 window size. Audible output and
installed/native acceptance remain separate checks.

With workspace dependencies and mpv available, the same focused checks can run
through `./scripts/test-music-queue.sh`. Add `--default-window` for the bounded
default-size queue/resume check. Set `MOIRE_MUSIC_QUEUE_CAPTURE_DIR` to save
captures from these focused checks.

`MOIRE_MUSIC_CAPTURE_DIR` selects the capture directory. The workflow renders
wide and short compact windows across theme variants and UI scales 1 and 1.5.
Headless captures and their backend notes are in
`vm/verification/2026-10-02-app-suite/music-v0-headless`. The cover art comes
from the repository botanical asset in generated local media, not a claimed
user library or the reference mock's album.

Candidate 11's Music check needed a null-output test correction and exposed
native default layout clipping. The corrections require fresh packaged/native
verification; Candidate 11 is not accepted.
Audible playback, native focus/overlap/resize, output-device behavior and approved
visual-reference comparison remain live guest checks. Headless frames do not
establish native Wayland or GPU acceptance.
