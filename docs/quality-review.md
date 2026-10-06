# Desktop and Files quality review

Acceptance reopened on 1 October 2026 after live use of the accelerated VM.
The design concepts are directional. Files must be a coherent, useful file
manager; reproducing a concept pixel for pixel is not the requirement.

Sources: `files-desktop-ui-plan.md`, `rendering-and-widget-v2.md`,
`files-and-desktop.md`, and the Desktop, Files, and branding concepts supplied
in the `moire-references` directory of the 1 October task workspace.
There is no checkout `.agents/skills` directory or `AGENTS.md`.

## Baseline findings

The table records the starting point, not the current candidate's status.

| Requirement                                                      | Baseline status                     | Evidence / next acceptance check                                                                  |
| ---------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Reproducible ARM64 image, tty1 session, HVF boot                 | Implemented                         | See `nixos-vm.md`; keep immutable ISO and CPU fallback                                            |
| EGL publication and KMS presentation                             | Implemented, regression unverified  | Earlier publication tests passed; repeat affected checks and live movement/resize                 |
| Live taskbar backdrop frost                                      | Defective                           | `Panel` paints opaque `pal.panel` above the blur; material geometry ignores floating panel bounds |
| Correct changing backdrop and rounded material                   | Unverified                          | Move overlapping windows through panel, repeat and interrupt movement, GPU and CPU                |
| Theme families and light/dark schemes                            | Implemented, interaction unverified | Test focus, menus, resize and taskbar across schemes                                              |
| Botanical hierarchy, restrained chrome                           | Incomplete                          | Wallpaper and palette exist; taskbar material and Files information hierarchy need work           |
| Navigation/history/breadcrumbs                                   | Implemented                         | Exercise connected routes and back/forward/up                                                     |
| Editable path / Ctrl+L                                           | Incomplete                          | Path editing exists; keyboard access and actionable errors need work                              |
| Read failures, loading, empty and filtered states                | Defective                           | Directory errors currently appear as an empty folder                                              |
| Grid thumbnails and useful list detail                           | Incomplete                          | Symbolic icons only in grid; list has no sortable metadata columns                                |
| Search, selection and keyboard parity                            | Incomplete                          | Local filtering and range selection exist; operation shortcuts and hidden-file controls missing   |
| File preview and metadata                                        | Incomplete                          | PNG inspector exists; richer metadata/text preview need connected data                            |
| Create/rename/copy/cut/paste                                     | Incomplete                          | Only auto-named folder creation; no cohesive operation UI                                         |
| Safe moves, conflicts and operation errors                       | Defective                           | Drop uses synchronous rename/copy and can replace a destination; errors only logged               |
| Recoverable deletion and undo                                    | Incomplete                          | No connected Trash operation                                                                      |
| Persistent view/sort preferences                                 | Incomplete                          | Current view is local to the window                                                               |
| Large transfers with progress, cancellation and partial recovery | Incomplete                          | Expanded brief: byte/file progress, collision choices and explicit outcomes                       |
| Persistent organisation and tagging                              | Incomplete                          | Expanded brief: connected tags/collections, browsing/filtering and relocation semantics           |
| Full selection-dependent inspector                               | Incomplete                          | Expanded brief: actual metadata, previews, operations and multi-selection behavior                |
| Useful Places and favorites                                      | Implemented, incomplete             | XDG places and favorites exist; only expose actual providers                                      |
| Popup clipping, focus, overlap and resize                        | Unverified                          | Live Files currently shows an orphan outline below a toolbar button; reproduce before accepting   |
| Devices/network/tags/advanced queue                              | Incomplete                          | Do not add disconnected placeholder controls; retain these as explicit future scope               |

## Evidence rules

Use disposable guest fixtures for all operation workflows. Never modify Josh's
real files. Record ISO hash, packaged revision, renderer/driver, steps and actual
outcome locally. Automated checks and static screenshots supplement live
interaction; they do not establish desktop acceptance by themselves.

Preserve the existing accelerated and CPU ISO baselines. Build each candidate
under a distinct name. Final acceptance requires live movement, overlap,
resize, focus, menus, repeated/interrupted transitions and ordinary Files
workflows on both affected renderer paths, followed by independent review.

## Candidate 4 checkpoint — 2 October 2026

**Acceptance remains open.** The image built and reached a tty1 Moire session
under UTM/HVF, with VirGL/ANGLE on Apple M1 Max. It is saved separately as
`vm/nixos/moire-aarch64-quality-4.iso` and `vm/Moire Quality Candidate 4.utm`.
The original CPU and accelerated images are preserved.

Implemented in this candidate:

- Floating, rounded taskbar frost with matching material geometry. CPU
  composition samples the current backdrop before drawing the panel chrome.
- Retained EGL composition refreshes the entire blur sampling region before
  applying materials. Previously, sampling stale final-frame pixels could feed
  a top overlay back into the next frame's blur.
- Shared layout measures fragments and nested rows/columns. This fixes
  overlapping Files commands and inspector details seen in live candidates.
- Closing motion publishes its exact final value, including zero opacity,
  before the scheduler stops; this addresses faint leftover tooltip outlines.
- Text editing tracks immediate selection/cursor state. Keyboard deduplication
  only filters mirrored device nodes, preserving rapid events from one keyboard.
- Files operations, collision choices, large transfer progress/cancellation,
  Trash recovery, tags, sorting, previews and inspection are connected to actual
  files. Scope and recovery limits are in [Files](apps/files.md).

Checks passed:

- Changing coloured window/backdrop with a top overlay in the blur sampling
  region: eleven partial updates match fresh full compositions on both VirGL
  and Mesa llvmpipe. The old implementation failed after movement 2.
- Files operations and window-dispatch workflows as the ordinary guest user:
  cancellation during a large file, partial recovery/retry, collisions,
  read-only directories, symlinks, metadata, tags and Trash/Restore.
- Host Files/Settings layouts across all ten theme variants and small/wide
  windows, plus command overlap and nested inspector detail spacing checks.
- Rapid keyboard events and mirrored nodes, text selection/replacement, final
  close opacity, relevant type checks, lint (warnings only) and formatting.
- The candidate also starts the full software-rendered desktop. Its taskbar
  frost was inspected; the regional CPU blur check passes.

Concrete blockers to live acceptance:

- Automated UTM pointer clicks/drags did not produce guest tablet/mouse events.
  A read-only probe of all input devices saw keyboard events but no pointer
  events during a title drag and button click. Window movement/resize cannot be
  accepted from a static screenshot or the composition regression alone.
- Longer automated typing delivered incomplete press/release sequences at the
  guest boundary: `/tmp/q/source` omitted keys and left `e` repeating, with no
  release or Enter in the raw trace. This is separate from the repaired Moire
  event filter. Short path entry worked in candidate 3, but ordinary live
  repeated/interrupted operation flows remain unverified in candidate 4.
- Native popup keyboard focus routing, full interaction across theme variants,
  and independent review remain open.

An earlier UTM host crash (`EXC_BAD_ACCESS`, `objc_msgSend`) occurred while two
graphics guests were active. Its cause is unproven. Subsequent checks use only
one graphics test guest; this does not establish that the host crash is fixed.

Local evidence is retained under `vm/verification/2026-10-01-quality/`, including
before/after graphics logs, input traces, packaged runtime and image hashes.
Post-build additions to the host checks and documentation do not change the
candidate's packaged runtime; the evidence manifest distinguishes them.

## Targeted toolbar correction — 2 October 2026

Josh clarified that file-operation commands belong in context menus. The current
source removes the persistent operation row and restores its height to the file
view. Navigation, location, search and grid/list controls remain in the toolbar.
Item and folder menus retain their operations; Shift+F10 and the Menu key open
the appropriate actions without requiring a pointer. Existing operation
shortcuts, transfers, tags, sorting and the full inspector are preserved.

Host integration checks verify the toolbar across all ten theme variants,
folder/item menu contents, Paste availability, single/group Rename availability,
keyboard context selection and the existing transfer/tag/inspector workflows.
This correction is not in the built candidate 4 image. At the source checkpoint
it was ready for a fresh image and coordinated live testing after the
input-recovery task releases VM control. No VM was operated or restarted during
the source correction. Files remains unfinished and desktop acceptance remains
open.

## Candidate 5 packaging — 2 October 2026

The toolbar correction is now packaged in
`vm/nixos/moire-aarch64-quality-5.iso`, SHA256
`4bbc46a33063648b33a18253d0f5a4e576557de417bcfb4d6f5cafc1c0c5fbcb`.
The copied ISO matches the Nix output byte for byte; 264 packaged source,
test and asset files match the recorded checkout. The packaged Files/Settings
layout and Files workflow checks pass on the ARM64 builder with Node 22.23.3.
This includes context-menu contents, keyboard selection, Paste and Rename
availability, transfers, tags and the inspector across the layout checks.

Package: `/nix/store/asfdg062nmy6n7zzsi9scdgzqm828xim-moire-0.0.0`.
Its derivation and source path, full source snapshot, build output, verification
script and packaged test output are saved locally in
`vm/verification/2026-10-02-toolbar-candidate-5/`. Candidate 4's hash is unchanged.
No VM was started, stopped or rebooted, no mounted image was replaced, and no
UI control was used. Candidate 5 has not been booted; it is ready for coordinated
live testing. Files and desktop acceptance remain open.

## App-suite candidate 8 — 2 October 2026

Candidate 8 packages the [twenty-app suite](apps/suite.md) and shared editing,
focus, clipping, native close guards, intrinsic buttons and flowing cards/text.
App work was divided into editing/reference, media/files, and utility workstreams;
root owns integration, the shared toolkit, System Monitor, Disk Usage and VM
validation. Existing Files and Process Manager were improved rather than copied.

The image is `vm/nixos/moire-aarch64-quality-8.iso`, SHA256
`2ca0a6a870c3e33a852641af98d46fd569a7ba0e667bab731534891942d61183`.
Package: `/nix/store/0rfd78bn22aabgn1n9ljrnk8kkjgvr1n-moire-0.0.0`.
The ISO matches the Nix output; 483 packaged source/test/document/asset files
match the source snapshot. All ten older host ISOs are unchanged. Only verified,
unreferenced duplicate builder ISO cache outputs were reclaimed for build space;
host images, package closures and dependency stores were preserved.

Host checks pass: 44 workspace package typechecks, formatting, and lint with no
errors (existing warnings remain). The gallery passes 800 actual app scenes
across 20 apps, 10 theme variants, two widths and two scales, with 69 selected
PNGs and no overflow or invalid scene findings. It includes intrinsic buttons,
360 wrapped paragraph comparisons, 80 nested-card resize/scroll cases, native
keyboard flows and an Editor Save As sheet. Layout success is not whole-suite
visual approval; the approved Files(v1), Notes(v1) and Music(v0) Library references were later
materialized and their actual pixels inspected. The corresponding layouts and
rich-text model remain unimplemented; alignment remains unverified. The selected
boot Silk fold(v0) and greeter(v2) pixels were also inspected as later design
references, without implementing either boot presentation or login changes.

The exact installed ARM64 package passes `scripts/test-app-suite.sh` under
Node 22.23.3 and umask077. Coverage includes atomic text saves/conflicts and
permission preservation, local Notes/events/palettes persistence, actual Window
input and close guards, Files operations/keyboard navigation, image/PDF/font
rendering, archive safety, media decoding and mpv pause/play/seek/volume/stop with
null outputs, recorder unavailable-backend behavior, MIME defaults/launch argv,
System Monitor controls, display rollback and screenshot pixel/PNG checks.
A separate disposable D-Bus session verifies the live procfs service, protected
process rejection and installed app identities.

Live QEMU 10.1.2/HVF boots NixOS and the tty1 session, with Files and Terminal.
The renderer reports llvmpipe/Mesa26.1.8 with direct GBM scanout. The actual
Screenshot app client captures 1280×800, crops and annotates it, saves/reopens a
320×240 PNG, and removes its private temporary capture. Native Image Viewer
opens the saved PNG; a screenshot shows the annotation. The installed launcher
now uses `node --import` in the app process. This fixes the native C7 Calculator
remaining alive after SIGTERM through the tsx CLI/preflight path. C8's native
Calculator exits on direct SIGTERM and on the live management service's D-Bus
Terminate request. The simple non-UI launcher fixture passed on both versions;
it was insufficient to catch this native failure. Quit sends SIGTERM; it does
not invoke an app's native unsaved-close guard.

Evidence, build log, full source snapshot, derivations, copied-image hashes,
packaged workflow results, serial boot and native screenshots are saved in
`vm/verification/2026-10-02-app-suite-candidate-8/`. Earlier failures and C6/C7
artifacts remain available in the preceding evidence folders.

Acceptance still open:

- Native pointer/keyboard/clipboard workflows: Cocoa QEMU is not exposed as a
  controllable app surface by the current computer-use inventory. Headless input
  coverage does not establish guest device delivery.
- Hardware acceleration, movement/resize tearing and the UTM/VirGL stall.
  Software GPU client dma-buf allocation is denied and falls back to EGL/wl_shm.
- C7 native retained EGL System Monitor showed ghosted text during updates.
  Its app emits one text node per cell and timed CPU renders match fresh frames;
  client wl_shm copies/damages the whole buffer. C8's software/shm client is clean. The retained EGL anomaly also reproduced
  in C8 after adding/removing Calculator: the Image Viewer name/CPU/memory row
  ghosts, and some changing numeric text is partially erased. The exact retained
  EGL/publication defect remains unproven.
- Audible playback, actual recorder input and native video output. Recorder
  cannot record without a PipeWire source; no audio device, service or permission
  was added. Document Viewer supports PDF, not Office formats. See each app's
  documented limits rather than treating backend availability as acceptance.
- Broader widget adoption and visual refinement. Notes is plain text; persistent
  rich formatting and the approved concepts are not implemented.

Root owns the next shared-renderer GPU residency pass before greeter/backdrop
work or further app expansion. First record per-client dma-buf import, readback,
CPU copy, upload and presentation timing with the actual renderer identified.
Trace the app→compositor buffer path and compare client readback against composed
output. Preserve JS logic, buffer ownership/lifetime, synchronization and the
software/SHM fallback. No shader, animated greeter or authentication changes are
part of this candidate.

## Candidate 10 renderer verification

Candidate 10 is `vm/nixos/moire-aarch64-quality-10.iso`, SHA256
`221ae6b3e78ebe2b983fe81460a6c34d6d0b3a30078a07f2231266dceb576ade`.
Its frozen source and 495 packaged files match, and all twelve older host images
remain unchanged. The installed ARM64 app suite and renderer regressions pass.
Evidence is in `vm/verification/2026-10-02-gpu-residency-candidate-10/`.

The retained System Monitor ghost was traced to React keyed placement appending
an existing scene node without detaching it. The fix preserves unique
nodes/layers/hits and matches an independently rebuilt scene through eight
container/nested placement phases and five actual process-row phases. Native
QEMU captures and the accelerated UTM desktop show clean process reorder,
addition and removal. This closes the reproduced row-ghost symptom.

UTM reports VirGL through ANGLE/Metal on Apple M1 Max and direct GBM scanout.
Its actual producer-buffer test records two imports, two GPU copies and 25,608
GPU-copy bytes, with zero CPU copy, texture-upload or GPU-readback bytes during
production. GPU execution time is unmeasured; the completion-wait call takes
22.57 ms in that run. System Monitor completes 872 GPU-backed commits. The
separate 72-workload render-node benchmark is an isolated, non-modesetting
measurement; it does not prove overall acceleration or presentation cadence.

The actual Screenshot client captures 1280×800, crops to 320×240, annotates,
saves and reopens its PNG in native Image Viewer. Saved pixels and the live
display were inspected. This is compositor capture/readback evidence, rather
than a direct KMS framebuffer capture.

Movement, resize and tear-free presentation remain unaccepted. UTM input
automation starts and ends a move without visibly delivering intermediate
positions. Stationary captures cannot resolve that gate. Both graphics guests
shut down normally and the lease was released to recovery. Audible playback,
recorder input and native video limits remain as documented above.

The redesigned Files, Notes and Music components and their new shared widgets
are subsequent source work. They are not included in Candidate 10. Their
save/reopen, input, mock-comparison and native checks must be recorded against a
fresh frozen image before acceptance.

## Candidate 11: native layout checkpoint, not accepted

`vm/nixos/moire-aarch64-quality-11.iso` is preserved read-only. Its SHA-256 is
`143bd1900a62b87a363c59f7ac7c619f924ccdcab9eeb6141bed034843f0fb24`.
All 551 recorded packaged payload files match the frozen source, and thirteen
prior fallback images remain unchanged. The exact installed renderer suite passes.

The installed app suite stops at Music's paused seek assertion with actual mpv.
Raw mpv reproduces the delayed reported position after play, pause and seek with
its default null audio buffer. An isolated writable copy using an explicit
10 ms null-output buffer passes stronger forward/backward paused seek, stability,
resume and EOF queue checks. Production playback is unchanged. The original
failed installed log is preserved; this corrected source test does not make C11
an accepted suite image. Diagnosis and rerunnable scripts are in
`vm/verification/2026-10-03-music-seek/`.

QEMU/HVF boots tty1 with the session active/running and zero restarts. Native
Files and Notes display the shared client header and symbolic app identities.
The populated app workflows are not established by these empty-state captures.
Music's 1280×820 initial window clips the playback footer on the 1280×800 guest.
The next source version launches at 1020×700 and adds an actual Window default
size/control check while preserving larger resizable tests.

`qemu-notes.png` records an incorrect test-launch environment and displays Files;
it is not Notes evidence. `qemu-notes-visible.png` records the successful Notes
launch using the compositor's actual runtime directory and display socket.
QEMU uses llvmpipe and the established EGL/wl_shm fallback. It shuts down through
normal `systemctl poweroff`, serial reports Power down, and the host process exits.
The evidence directory is `vm/verification/2026-10-03-app-suite-candidate-11/`.

## Candidate 12: installed suite and accelerated app checkpoint

The read-only `vm/nixos/moire-aarch64-quality-12.iso` has SHA-256
`1a98efe91b0b992719c03eae4b6d3cb28ee8461a30ce1c63f967c29a12084b89`.
All 552 packaged payload files match the frozen source and all fourteen prior
ISO images remain unchanged. Its exact installed ARM64 suite passes with actual
mpv decoding/IPC/null-output seek, resume and EOF checks. The gallery checks
800 frames, saves 69 PNGs and finds zero overflow or invalid states. The exact
installed renderer suite also passes through an isolated render node.

Fresh UTM/HVF reports VirGL through ANGLE/Metal on M1 Max. Its session remains
active/running with zero restarts. In actual native Notes, VM keyboard shortcuts
apply bold and highlight to the first five characters of an initially plain
note. Save writes v2 ranges; process termination and relaunch preserve the
painted formatting and unchanged body. This establishes native keyboard/save/
restart persistence. The attempted pointer Close did not close the app, so it
is not native-close-guard evidence.

Native Music recursively imports two real tagged WAV files and sidecar PNG
artwork, persists their 30/20-second durations and shows the album, queue and
whole playback footer in the corrected 1020×700 initial window. It explicitly
reports audio-output initialization failure in this soundless guest. No audible
playback is accepted and no audio device or microphone permission is added.
The first import failure came from the test fixture's root-owned app-data parent;
correcting that disposable fixture's ownership enabled the import.

Native Files displays three real entries, two folders, readable capacity/counts,
its new tab header and coherent symbols. Device workflow acceptance remains open:
a desktop click leaves shell keyboard capture active after Alt+Tab raises an
app. End/Down still navigate the desktop behind Files. A controller/client focus
handoff fix and active-scanout/timeout ownership fixes are subsequent source work.
They must be built and tested in a fresh image, not attributed to C12.

Actual native PNGs and serial actions are preserved in
`vm/verification/2026-10-03-app-suite-candidate-12/`. They confirm distinct, legible
Files/Notes/Music/taskbar symbols. They do not approve the full app suite's visual
design, all native file workflows, video/recorder backends or tear-free movement.

The actual native Benchmark completes its five-second animated workload at
25.6 presented fps, with 129 presented frames, 130 submitted frames and zero
discarded frames in its displayed result. Its live Overview also reaches about
44.8 presented fps. These are bounded workload observations, not an overall
acceleration or physical tear-free result. Reported GPU duration is unavailable;
the displayed 0% compositor share is not proof of zero compositor work.
The attempted host PNG transfer fails validation, so no saved Benchmark PNG is
claimed. The live display was inspected. UTM then shuts down normally, serial
reports Power down and its host graphics process exits.

## Candidate 13: scanout ownership and native Files workflows

The preserved read-only C13 ISO has SHA-256
`af2bbb1404b1d941ee6f7502010d8839fdb6cf15f57f9e7b6029174c0a47b05d`.
Its exact installed app suite, 800-scene gallery and isolated native renderer
checks pass. All 558 packaged source files match the snapshot, and fifteen
earlier fallback images remain unchanged.

CPU readback now alternates two dumb framebuffers. Direct GBM rendering selects
idle targets; a timeout retains possible scanout owners until matching completion
or a confirmed modeset. Portable ownership tests and the actual six-argument C
page-flip callback test pass. On the actual QEMU card, the original native oracle
fails its strict sequence-increase assertion: all three kernel events report
sequence zero. A disposable diagnostic replaces only that assertion with logging;
the remaining active-pixel, durable handoff, mode-switch and lifetime assertions
pass. This is a diagnosed failure, not a pass of the original oracle. C14 corrects
the overstated hardware timing flags and preserves the raw event payload.

Native Files keyboard selection opens Editor with the correct file URI. A
separately issued Save writes the edit, and a fresh direct Editor process displays
the saved 106-byte body. Files also displays an actual selected PNG with its
1586×992 dimensions and preview; activating it opens the matching image in
Image Viewer. Saved PNGs were inspected in
`vm/verification/2026-10-03-app-suite-candidate-13/`.

The first manually launched Files test omitted the compositor's PATH; correcting
that disposable test environment fixes activation without a production change.
Raw guest evdev observations show no mouse-button edges from attempted automated
clicks and a missing press during one rapid typing attempt, before Moire receives
the input. Native guarded close, desktop-click focus handoff and physical tearing
remain open. The source focus fix passes actual shell/Window routing regressions.
C13 shuts down normally with serial Power down, no host graphics process, and
UTM's stopped controls.

## Candidate 14: truthful timing and bounded accelerated startup failure

The immutable C14 ISO has SHA-256
`521337b248a28b102ca6b83337f1f81b8253afe4fa25475a7a6ccb23354bd039`.
All 558 packaged files match its frozen source and sixteen prior fallback ISOs
remain unchanged. Its exact installed app suite, 800-scene gallery and isolated
native renderer checks pass.

The actual exclusive QEMU/HVF KMS oracle passes with exit zero: active scanout
pixels remain immutable, retired buffers are reused, mode switching and return
pass, and repeated close is safe. Raw sequence counters are `[0,0,0]`; vsync,
hardware-clock and hardware-completion flags are false. A kernel completion can
retire a buffer without proving physical retrace or hardware timing. The session
is active/running with zero restarts before and after the test. The captured
immediate post-restart PNG contains a dark frame, so it establishes no desktop
workflow. QEMU then powers off normally and its host process exits.

Fresh UTM/HVF remains black with silent serial over a bounded seven-minute boot.
The configuration matches C13 except instance identifiers. Two process samples
and the configured serial endpoint are preserved. UTM's Stop stays at Stopping;
TERM to the exact disposable launcher clears it. This is not a normal guest
shutdown. No host reboot, permission or security change is made. The cause remains
unestablished; accelerated C14 startup and native scanout checks remain open.
Source work on the approved static backdrop and welcome presentation continues
independently. Evidence is in
`vm/verification/2026-10-03-app-suite-candidate-14/`.

## Candidate 15: native welcome and explicit boot recovery limits

C15 SHA-256 is `75cda1aefc4e42786546e3ab79ddf377657cab4b66ff36b71be5e3801d77122a`.
All 596 packaged files match the frozen source; seventeen older ISOs remain
unchanged. Exact installed app tests, 800 gallery scenes and isolated native
renderer checks pass. Actual QEMU/HVF KMS ownership/recovery/mode-switch tests
pass, with raw sequence zero and hardware timing flags unverified.

QEMU paints the fullscreen welcome through llvmpipe/SHM fallback. Its captured
framebuffer and journal timestamps prove guest rendering, not physical first
visibility. A SIGTERM to only the welcome process exercises process-failure
fallback into Files/Terminal; it is distinct from ordinary close and user Start.
QEMU powers off normally.

UTM reports virgl through ANGLE/Apple M1 Max/Metal and direct GBM scanout. Actual
keyboard navigation opens Accessibility, checks Reduce motion, dismisses with
Escape, selects Start and reaches Files/Terminal/desktop with zero service
restarts. A normal guest reboot and second Start succeed. Captures preserve the
checked state, restored Accessibility focus, welcome and desktop. This does not
explain the earlier C14 startup failure or prove physical tear-free movement.

The initial boot splash interval was missed by the observer. In a separate
postboot exercise after stopping Moire, the actual patched Plymouth daemon paints
the theme. Physical Escape removes the art but leaves black; actual journal
output written to tty1 remains hidden until Plymouth quits, after which the real
kernel/service text is visible. This daemon lacked `--attach-to-session` and a
live boot output buffer, so the result is a scoped postboot recovery failure,
not a conclusion about initial boot. Serial remained responsive and printk was
`4 4 1 7`. Initial-boot Escape, active text/details output routing, renderer stall
recovery, and ordinary welcome close remain open.

C15 evidence is `vm/verification/2026-10-03-app-suite-candidate-15/`, including
metadata with capture sources, timing scopes and failure triggers. The next
source wave implements a running React boot tree, independent guardian and
conservative visibility policy. It is not yet an accepted initrd runtime.

C15 then shuts down normally after the postboot exercise: serial records Power
down at 417.448146, its host PID is gone and UTM exposes Play controls. The C15
ISO hash is unchanged. Graphics testing is released to the coordinated lease.

## Candidate 16 checkpoint

C16 is built with SHA-256 `88ab992cf85161eb02b422a7edc7bd163c110221da1d9b1ab1d08e15e5e4b7c7`.
Provenance matches 610 installed source files, and all 18 earlier fallback images
are unchanged. The exact installed app suite passes 800 rendered frames, 69 PNGs,
zero invalid states and zero layout overflow. Isolated Mesa renderer checks pass;
they do not exercise modesetting or physical scanout. The pinned patched Plymouth
parser also accepts the updated boot artwork.

The first coordinated native UTM boot remains black and produces no serial bytes
through roughly five minutes. QEMU consumes about 270 percent CPU. A process
sample and host unified log are saved, including redacted ANGLE errors whose
cause is unresolved. UTM Stop stalls and reports an RPC timeout. TERM to the
verified C16 PID/UUID/name stops the process; fresh UTM accessibility state
confirms Stopped. This is not normal guest poweroff. No Moire session, React boot
root, physical Escape or console-restoration result is claimed from this boot.

Evidence is `vm/verification/2026-10-03-app-suite-candidate-16/metadata.json`.
The previous C15 native welcome/desktop acceptance remains the fallback.

C16 includes a static running React boot root and independent guardian for stage-2
verification. Escape input is verified and armed before graphics mode. The
guardian waits for actual renderer exit before VT restoration; an unconfirmed
termination deadline retains ownership and input listeners. Real process tests
cover stalled JavaScript, SIGSTOP, ignored TERM and delayed exit. Native VT/CRTC
pixels, guardian-crash cleanup outside the guardian, and initrd integration remain
open. Narrow compiled packaging and production visibility updates are the next
source wave; neither enables hardware animation yet.

C16 additionally boots under Homebrew QEMU 10.1.2/HVF and displays the own React
welcome through the documented run command with `MOIRE_VM_DISPLAY=none`. The
actual software scanout is saved as `qemu-welcome.png`; llvmpipe falls back from
dma-buf allocation to EGL readback/SHM. The guest shuts down normally at monotonic
539.973618 and its host PID exits. The UTM startup cause remains unresolved.

A real input query exposes a C16 guardian bug: successful `EVIOCGBIT` returns 96
copied bytes, but `verifyEscape` expected zero. It therefore rejects the valid
keyboard and fails before graphics mode. The next source accepts positive length
and still checks KEY_ESC. A disposable RAM copy with that single correction
passes a real descriptor regression and paints the actual React boot root.
Guardian TERM restores existing tty1 journal text after a healthy child exit;
SIGSTOP of the actual renderer followed by guardian TERM also restores text after
KILL escalation. Saved QEMU scanout captures show both recoveries. Shell
kill/wait measurements are 42.200688 ms and 140.803512 ms, including command
overhead. These are postboot software-scanout probes, not physical Escape timing,
initial boot, refreshed installed-image acceptance or guardian-crash recovery.
C16 remains immutable. The known input fix and production visibility integration
are packaged in C17.

## Candidate 17 checkpoint

C17 is immutable at `vm/nixos/moire-aarch64-quality-17.iso`, SHA-256
`e71e41c25d6d216f7b085ca5ca338ee24c3806fe4e795b8aebb6c5bca5ce5c8f`.
Build provenance verifies 753 frozen source files, 617 matching installed payload
files and preservation of all 19 prior host fallback images. The exact package
is `/nix/store/jxz2lzm350rh4f0j1l5w4zivdbln7qzf-moire-0.0.0`.
The first ISO assembly ran out of builder disk; the retry used the same frozen
source after removing only an unreferenced C5 builder duplicate with a matching
preserved host image. Both build logs remain in the evidence.

The installed suite passes 800 actual app-tree frames, 69 PNGs, zero overflow
findings and zero invalid states. Isolated Mesa checks pass, including retained
rendering compared with fresh EGL. These checks do not establish every app's
physical input, playback or recording workflow.

Homebrew QEMU 10.1.2/HVF boots the image and displays the own React welcome.
The compositor uses EGL through software llvmpipe and SHM/readback fallback;
this run does not prove hardware timing or elimination of physical tearing.
The service remains active with zero automatic restarts after the probe.
C17 has not been booted in UTM; C15 remains the verified UTM fallback.

The real installed evdev regression verifies a successful 96-byte
`EVIOCGBIT` result, the actual Escape key bit, rejection of a power-only source
and descriptor cleanup. A stopped readiness dispatcher cannot publish a phantom
keyboard or leak its descriptor. No input injection, exclusive grab or permission
change is involved.

With the compositor deliberately stopped, the exact installed
`moire-boot-stage` paints the running static React Fold root on the actual KMS
output. The guardian restores the preexisting tty1 kernel/systemd journal after
normal termination and after its renderer is confirmed suspended (`Tsl`).
Measured shell termination/wait intervals are 36,863,983 ns and 136,884,972 ns.
Both independently captured restored frames contain the same full readable
journal pixels (PNG SHA-256
`10a916e26ba8b52e7e64824c4792fb70a8a7f07a710f8fd6ae05bbf0bcedb09c`).
Process inspection confirms no remaining Node renderer after either release.
Restarting the compositor succeeds and its welcome is captured again.

A live probe runs as the existing `moire` user against the installed compositor
socket, using generated private protocol bindings, actual SCM_RIGHTS and XRGB
SHM buffers. It passes initial unknown, visible/opaque-cover hidden, upper
surface destruction with idle reveal, unsubscribe, renewed subscription and
covering-client disconnect with idle reveal. The lower surface commits only
three times during initial configure; hide/reveal requires no further lower
commit. This establishes the production wire path for these opaque surfaces.
Native output-loss/transport-loss invalidation at the public Window API remains
unverified; installed wire fixtures exercise those paths. Motion stays static
without hardware classification.

Evidence: `vm/verification/2026-10-03-app-suite-candidate-17/` contains build,
provenance, installed-suite, native renderer and full serial logs plus actual
framebuffer captures. The excluded probe and its installed transcript are in
`vm/verification/2026-10-03-surface-visibility-native/`.
The guest powers down normally at monotonic 515.292271; QEMU exits zero and its
host PID is gone. The graphics lease is released.

Remaining boot gates: physical Escape, initial boot/initrd integration, refreshed
standalone-package native recovery, guardian-own-crash/descendant FD cleanup and
hardware-timed animation. No security or system permission changes were made.

## Candidate18 native checkpoint

`vm/nixos/moire-aarch64-quality-18.iso` is immutable, SHA-256
`f0110a23b36d493080569f76a3bdd37bf33897569a19d2b089878c1c612bc048`.
All twenty earlier host images remain preserved. The full package matches 628
frozen payload hashes. The compiled boot package matches 612 frozen inputs and
105 installed outputs. Its input store contains one unused unfrozen Python
bytecode cache, absent from bundle inputs, installed outputs and runtime closure.
The original strict failed audit and the narrowly documented exception are kept.
Cache filtering is a required next-source correction.

The installed suite passes 800 actual app-tree frames, 69 PNGs, zero overflow
findings and zero invalid states. Isolated Mesa checks and actual memfd SHM
buffer lifecycle checks pass. Retained rendering now replaces transparent damage
pixels instead of blending them over stale content.

QEMU 10.1.2/HVF boots the image into the existing Moire session with zero
automatic restarts. A probe running as the existing session user verifies twelve
installed source hashes, then uses the actual public Window and Wayland backend.
Opaque, partial and opaque React updates publish XRGB, ARGB and XRGB buffers and
produce visible, unknown and visible authority states. Real socket EOF revokes
visible authority. Unsubscribe and public-close-before-EOF checks also pass.
The complete probe exits zero after 1,320.507 ms. Output loss remains unverified.

The exact compiled narrow boot service paints its static React Fold root on KMS.
After guardian SIGKILL, the actual ExecStopPost helper restores KD_TEXT and
records the matching release. The same succeeds with the renderer first
confirmed SIGSTOPped. The second complete service-state observation takes
122,450,525 ns. The first timing poll ended while deactivating, so it is not a
release-latency result. Both saved framebuffer captures show the same full
preexisting tty1 journal, SHA-256
`62299f90ac37b1b2168ebb8c7aecc3a96e75dbb442209025179011e2fd76acaf`.
No guardian or renderer process remains. A renderer IPC shutdown error is
preserved and requires a source fix; it did not prevent external cleanup.

Two lifecycle failures prevent automatic boot acceptance. An actual ordinary-FD
systemd fixture passes normal main exit and main-crash/child-stop cases, but
explicit stop with a stopped main leaves a real descendant alive during cleanup.
The helper returns pending and denies release. Systemd kills the descendant only
after that helper exits. Separately, actual systemd 260.4 collects the healthy
inactive boot unit and clears its InvocationID. C18's handoff rejects the valid
historical release and leaves the desktop stopped. The supplied authenticated
historical invocation passes the compiled check, after which manual session
restart succeeds. These failures are preserved, not converted into passing tests.

The next source wave must fix service lifetime, authenticate collected-unit
history and require release admission on every desktop start. The stage remains
manual and outside initrd. Physical Escape, hardware timing, physical tearing,
and every app's physical/media workflow remain separate acceptance gates.

Evidence is in `vm/verification/2026-10-03-app-suite-candidate-18/`,
`2026-10-03-public-window-native-next/` and `2026-10-03-boot-managed-native/`.
The retained serial transcript covers native commands through normal poweroff;
initial firmware notices remain in the original tool output. Poweroff occurs at
monotonic 297.438713, QEMU exits zero, its host process is gone, and the exclusive
graphics lease is released. No user, group, capability or device grant changed.

## Candidate19 native checkpoint

`vm/nixos/moire-aarch64-quality-19.iso` is immutable, SHA-256
`e16a21a85c90fb21b77cf7facd8062f1d1918fa188a0da2c7ca249f888005d28`.
All twenty-one earlier host images remain preserved. The full package matches
637 frozen payloads. The compiled boot package matches 621 frozen inputs and
118 outputs, with thirteen declared/verified bundle entries and no bytecode
exception. Linux Node22 installed checks include real child IPC teardown,
admission/manager regressions and actual isolated ledger initialization twice.
The installed app suite and 800-frame gallery pass, with 69 PNGs, zero overflow
findings and zero invalid states. Isolated native renderer/memfd checks pass.

The managed boot unit now tracks cgroup lifetime and has a 60-second runtime
ceiling. A protected current-boot attempt ledger is published before the guardian
launches. Every desktop start requires check-only release admission. Historical
lease/release proof accepts a legitimately collected manager ID; missing state
after an attempt cannot become never-attempted admission. Renderer IPC peer loss
closes once without the previous unhandled disconnect/send errors.

Seven real disposable systemd graphs pass against the exact compiled package
on the existing builder's systemd 255. They cover initial startup, genuine healthy
unit collection, repeated gate activation, automatic restart rejection, direct
start rejection, pre-lease failure, changed invocation and missing ledger.
All 28 owned units are stopped and removed. Generated-unit validation exits zero;
432 relevant PID1 messages contain no ordering-cycle or job-pruning diagnostics.
The initial harness assertion failure is preserved: the gate correctly blocked
restart, while systemd labelled the process-free desktop activating rather than
inactive. The corrected fixture records that state without declaring execution.

The actual C19 QEMU/HVF guest runs systemd 260.4. Its delivered session and boot
units both pass `systemd-analyze verify`. Initial never-attempted admission starts
the Moire session with zero restarts. Actual bundle-manifest, renderer and cleanup
entry hashes match the strict compiled audit.

The actual boot renderer is SIGSTOPped before guardian SIGKILL. At the subsequent
8.438-second observation, the service remains active, the stopped renderer still
owns its descriptors, and no release exists. This is intentional cgroup lifetime,
not recovery success. The actual 60-second runtime ceiling then terminates the
owner and the compiled helper restores KD_TEXT with the matching release.
The saved framebuffer shows the full preexisting tty1 journal, SHA-256
`1753ec12edb3f0558753a0fed650f4f416d283b343a2540172e36f3a68879997`.
No renderer/guardian remains and no IPC error appears. This proves bounded
runtime-limit recovery; the later 25 ms no-op stop is not a cleanup latency.

Healthy stop and installed handoff both exit zero and the mandatory gate reruns.
The native manager ID is retained at the immediate observation. Native handoff
therefore proves the retained-ID branch; the collected-empty-ID branch is proven
separately by the real builder graph, not claimed for this guest run.

Removing only the private RAM release record makes direct desktop start fail
with no main/control PID or pending job. The actual native automatic restart also
reruns admission and rejects the missing acknowledgement. Over 7.012 seconds,
more than two configured restart intervals, main/control PIDs and pending job
remain absent and the session cgroup is removed. Its activating state is recorded
honestly. Restoring the original authenticated release bytes permits startup;
the final welcome is captured with an active session and zero restart count.

The guest powers off normally at monotonic 430.190775. QEMU exits zero, its host
process is gone and the graphics lease is released. All 780 frozen source files
remain unchanged at this checkpoint. Evidence and exact scope are in
`vm/verification/2026-10-03-app-suite-candidate-19/native-summary.json`, the
adjacent logs/captures and the systemd admission report in the service-review
directory. No user/group/capability/delegation/device/polkit grants changed.

The React boot stage remains manual and outside initrd. Physical Escape, output
loss, deliberate initial React boot, retained hardware animation, hardware timing
and physical tearing elimination remain open. The next source wave investigates
a recognized last-connector loss that currently leaves stale visibility; C19
does not claim that case. Audio/video/recording physical workflows remain scoped
separately from actual null-output and fixture tests.

## Candidate20 automatic startup checkpoint

C20 is immutable, SHA-256
`5faaca266af1a7458d7884cb059df7304b8d79eacc8d2938fad2e0b5ff4a67cc`.
All 22 earlier host ISO images are preserved. Strict provenance verifies 653
packaged payloads, 637 compiled inputs, 136 outputs and 19 boot bundle entries.
Installed app workflows, persistent reduced motion and the 800-frame gallery
pass; the gallery has 69 captures, no overflow and no invalid states. Isolated
native Mesa, retained rendering, memfd/SHM and portable availability checks pass.

Two fresh Homebrew QEMU/HVF boots automatically accept the actual React frame,
notify READY from the guardian main process, authenticate KD_TEXT release,
admit the collected historical invocation and start the welcome session through
the current console-policy gate. The second session is active with zero restarts.
Delivered-unit verification returns zero. Both inspected framebuffer captures
show the welcome; the approximately 100 ms automatic React stage was not
pixel-captured. Both guests power off normally and QEMU exits zero.

Nine actual systemd fixture cases separately pass main-only notification,
skip/timeout recovery, protected console policy across restart and a later
completed console invocation. All 42 owned units are stopped and removed;
348 owned PID1 messages show no ordering cycle or job pruning. This controlled
ordinary-FD proof is distinct from actual React/DRM evidence.

C19 additionally passes native UTM Escape delivery and full console restoration
with synthetic CUA native-window input. Eighteen collector checks pass against
the immutable image. Exact inspected artwork and restored-console JPEGs are in
`vm/verification/2026-10-03-physical-escape/c19-utm-native/`. This is not a human
physical keypress, an initial automatic-boot Escape or a stalled-renderer Escape.

C20's native output-free wire fixture is blocked by real mapping geometry:
fitToplevelToOutput assumes a DisplayOutput exists. The failed transcript is
preserved; strict registration prevents counting a partial failed map as success.
The next wave fixes legitimate zero-output lifecycle before claiming that proof.
Hardware motion, physical unplug/reconnect and physical tearing remain open.
No permissions or security grants changed. Exact package identities, monotonic
handoff observations, audit corrections and proof limits are in
`vm/verification/2026-10-03-app-suite-candidate-20/README.md`.

## Candidate21 zero-output checkpoint

C21 is immutable, SHA-256
`0ec63dc92a8f94f023e0a5f60c0ce298347842b4e458b34390fedd8d6a26705c`.
All 23 prior host images are preserved. Strict provenance matches 654 full
payloads, 638 compiled inputs and 136 outputs. All 797 snapshot files remain
unchanged at final validation. Workspace typecheck, installed app workflows and
native renderer checks pass against the fresh package.

The compositor now handles absent output geometry explicitly. Ordinary mapping
retains client geometry and completes registration; neutral fractional scale is
120 and full/max requests cannot invent an output. Actual Linux memfd/SHM mapping,
pixel copying and descriptor release pass. The independent actual private
Unix/public Window fixture passes seven cases: zero-output unknown, idle
revocation with no new client commit, stale/failed completion rejection, fresh
accepted reconnect, secondary replacement, unchanged geometry, changed content
and close cleanup. A real edit changes exactly 480 pixels with 24×20 partial
wire damage; the accepted CPU target matches its committed SHM pixels. These
controlled memory output descriptors do not prove physical hotplug or GPU output.

A fresh actual QEMU/HVF boot passes automatic React acceptance, main-only READY,
matching KD_TEXT release, historical collected-ID admission and current console
policy into an active welcome with zero restarts. Delivered units verify zero.
The welcome is inspected; read-only sampling misses the brief React artwork.
Normal powerdown is 83.217417, QEMU exits zero and its process is absent; the
graphics lease is released.

The original ISO disk-space failure, Parallels RPC error and two fixture
assumption failures are preserved. The same frozen source succeeds after a
guarded builder-only duplicate reclaim; no host fallback or runtime package is
removed. The fixture corrections run the real no-output composite step and
check requestClose's once-only callback rather than assuming a boolean return.
No production source changes are made to pass those corrected assertions.

Evidence and exact scopes are in
`vm/verification/2026-10-03-app-suite-candidate-21/README.md`. Physical hotplug,
initial/stalled-renderer physical Escape, hardware motion, physical tearing and
physical/media app acceptance remain open. No permissions or security grants
changed. C20's gallery and manager graph and C19's synthetic Escape remain
independent checkpoints.

## Candidate21 native renderer-stall checkpoint

An unchanged C21 UTM retry reached automatic scanout acceptance, main-only READY,
matching cleanup and a desktop with zero restarts. Its first native startup had
remained black/serial-silent and UTM Stop timed out. That failure and its scoped
abnormal host stop are preserved separately; the retry used the same image and
configuration with no permission changes.

Root manually restarted the installed managed stage after stopping the disposable
desktop. Exact renderer3698 held card0 in invocation
`ec4ae108c72c437caa060062ee134930`; Root verified command, start ticks and cgroup,
sent SIGSTOP and observed stateT. Synthetic Escape through the actual native UTM
window reached an independent non-grabbing event3 observer. Both captured owners
retired, cleanup3719 authenticated the same invocation with tty1 mode0, and the
native display restored the full existing journal. The desktop stayed inactive.

The original collector retains17/18 passing checks: systemd had collected the
unit and cleared its exit fields. A separate rerunnable assessment verifies the
exact root/PID1 same-boot invocation journal successful-deactivation event and all
input/release checks. No missing exit0 value or forced-signal trace is invented.
The guest powered down normally at299.723345s; exact host PID88912 was absent and
the serial bridge exited0 before Root released the VM lease.

Exact native before/after pixels, original failure, archive hash, assessment and
shutdown receipt are in `vm/verification/2026-10-03-c22-native-recovery/README.md`.
This closes the synthetic native-window recovery workflow for an actual stopped
renderer after accepted submission in a manually restarted C21 stage. Initial
startup Escape, pre-submit Escape, human physical input, hardware timing and
physical tearing remain unfinished. All immutable fallback images are preserved.

## Candidate22 graphics and app checkpoint

C22 builds on its first attempt. The immutable ISO SHA-256 is
`c06d65557ee21d6307ce7e24fd6b52271664e7dc720a9f8aed4ae338f8d55e74`.
Strict provenance matches 674 full-package payloads, 658 compiled boot inputs
and 138 outputs; all 24 earlier host fallback images retain their hashes.
Workspace types, the full installed app suite and the 800-frame, 69-PNG
installed gallery pass. Twelve installed ARM64 Files/Notes/Music comparison
cases are separate from the host comparisons and earlier C21 baseline.
The gallery's populated states do not establish empty-state acceptance.

Actual installed Linux SHM failure/reattachment checks and EGL/GBM pool,
opacity and 100-frame transfer counters pass. One older native black-buffer
check fails when raw alpha is zero rather than 255. New opaque client scenes
use XRGB, whose reserved alpha byte requires format-aware interpretation.
The original failure stays in `native-checks.log`; the corrected oracle must
also prove canonical opaque pixels before this checkpoint can claim the full
renderer suite passed. Hardware motion and physical tearing remain open.

Fresh QEMU/HVF boot `243dc0c2-aafb-4ddf-a360-54f8533c56e5` accepts its React
frame at 7.280889, sends READY at 7.281259, releases tty1 to mode 0 at 7.417790,
and records desktop startup at 7.607492. The session remains active with
MainPID 833 and zero restarts. Actual welcome pixels are inspected. A direct
existing StartDesktop API call from an accessible working directory succeeds;
its separate welcome window remains because this caller does not run the
welcome's close callback. The first attempt from inaccessible root cwd fails
EACCES and is preserved. This is API handoff evidence, not keyboard acceptance.

Actual installed Files, Notes and Music windows render through Wayland/SHM
and KMS. Their native launch captures are inspected. Notes' empty label overlaps
its Save/More header, and Files' current-folder Modified timestamp truncates.
These findings target C23, with C22 preserved. Native Music's empty state fits;
null-output mpv tests establish decoding/control rather than audible playback.
Normal guest poweroff occurs at 264.831142; QEMU exits 0 and exact host PID 309
is absent. The graphics lease is released.

Evidence: `vm/verification/2026-10-03-app-suite-candidate-22/`. No account,
permission, credential, paid-service or security-policy change occurred.

### C23 black-buffer oracle diagnosis

The revised coloured oracle reproduces a second fixture failure even after
retiring cached imports before descriptor reuse. An excluded controlled probe
records canonical GPU pixels before mapping, raw bytes, actual descriptors,
formats and operation order. Sharing one DRM open-file description across the
producer and two import devices corrupts the later coloured producer snapshot
and emits kernel errors. That negative case ends at its bounded timeout.

Opening independent descriptors for the producer, raw importer and Server
importer passes all five repeated transparent, black and coloured scenes. Raw
RGB/full ARGB, owned canonical BGRA, actual SCM_RIGHTS buffer delivery, production
Server CPU alpha normalization and cleanup all pass. The successful render-node path in production's
`GbmDevice.openForImport` opens a separate descriptor. The corrected fixture
follows that ownership and preserves the strict colour assertions. The
no-render-node production fallback still borrows the EGL renderer's KMS
descriptor; its lifetime safety is unverified and requires a separate successor
fix. The publication and residency fixtures also still share producer/import
descriptors. This result does not qualify those paths or justify forced alpha.

The controlled logs are in C23's `native-black-debug-mode-0.log` and
`native-black-debug-mode-1.log`, with the rerunnable assessment. This is actual
render-node conformance; it does not qualify scanout timing or hardware motion.
The topology comparison establishes the lifetime interference empirically;
GEM-handle destruction is an inferred mechanism, not an instrumented kernel trace.

## Candidate23 installed graphics and native app checkpoint

C23 is the immutable `vm/nixos/moire-aarch64-quality-23.iso`, SHA-256
`fbdcce6e23a2f33f306aeacada6d60878310b64b2b5a28359949718ff1085d5b`.
The copied ISO matches the Nix output; all 25 previous host images are preserved.
Strict provenance matches 676 packaged source files and 660 frozen boot inputs
with 138 boot outputs. Workspace typecheck passes.

Notes moves its empty-document prose below the real Save/More header. Files
formats the current folder's actual `stat.mtimeMs` in the existing compact
Modified row. Independent regressions fail against the preserved C22 sources
and pass against C23. The exact installed C23 app and renderer suites pass,
including five strict native DMA-BUF format/colour/opacity scenes and 24
retained-versus-fresh EGL updates. The installed gallery checks 800 frames and
69 PNGs with zero overflow findings or invalid states. The first installed-test
RPC attempt exits 255; the warmed, unchanged retry is recorded separately.

Fresh automatic QEMU/HVF boot `bdf1e1f4-7a1f-4ae8-a3ee-23e01044a816`
accepts its React frame at 7.270606, releases tty1 to mode 0 at 7.401399,
and records desktop startup at 7.593423. Session PID 834 remains active with
zero restarts. The existing StartDesktop API succeeds. Fresh actual installed
Notes and Files Wayland/KMS pixels confirm the clear empty header and complete
Modified timestamp. Their clients use the advertised SHM fallback; these are
native rendering captures, not native input workflows. An initial Notes launch
uses the incorrect executable name, exits 127 and is preserved separately;
the correct `moire-notes` entrypoint succeeds. Direct API startup leaves the
separate welcome window visible. Normal poweroff occurs at 146.172553; exact
host QEMU PID 6525 exits 0 and is absent afterwards. The graphics lease is released.

The independent render-node fixture does not prove production's borrowed KMS
fallback safe, nor qualify publication/residency fixtures that still share a
DRM descriptor. Those ownership paths are assigned to a successor. Native
transfer/tag/inspector interactions cannot be automated through the currently
available QEMU CUA surface; no new input permission or alternative host injection
is introduced. Device/context/output-bound retained motion and physical tearing
remain unverified. Audio decoding/control tests do not establish audible output
or microphone capture.

Evidence: `vm/verification/2026-10-03-app-suite-candidate-23/`.
`assess-native-boot.py` reruns the preserved UART/exit/pixel assessment;
`assess-native-black.py` reruns the controlled topology comparison. No system
permission, security-policy, account, credential or paid-service change occurred.

The full installed retry command exits 0. All 12 fresh Files/Notes/Music
comparison cases use the exact installed C23 production cohort on ARM64 Linux;
their HeadlessPlatform pixels do not establish native input or audio.

## Candidate24 installed and bounded native Files checkpoint

C24 is the immutable `vm/nixos/moire-aarch64-quality-24.iso`, SHA-256
`98ecd54420ade65b6f449493cf0518c063878bc5bf9e51ca1c2e0f30ad104153`.
The copied ISO matches the Nix output, 681 packaged source files match the
frozen source, and all 26 earlier host images retain their hashes. The installed
package is `/nix/store/nwn3rgb4xzs1h0gfv0x2wyc6qyf3szpx-moire-0.0.0`.

Files retains existing unmoved cut sources after Skip or partial cancellation
and measures transfer content so Done remains reachable. Preserved C23 sources
reproduce the failures; current public Window regressions pass, including 80
dialog cases. These are disposable-file and HeadlessPlatform workflows.
The first installed command exits 255; warmup and the unchanged retry remain
separate receipts. The retry exits 0 after app and renderer suites, independent
card1 reopen and 18-workload residency checks. Strict retained motion exits 1
as expected, preserving the negative baseline.

QEMU/HVF reaches welcome after accepted boot submission and text-mode release,
then powers down normally at 67.338326; owned PID 12821 exits 0. The first
VirGL UTM run reaches boot handoff but repeatedly times out before the desktop
socket, then powers down at 69.739692. Its unchanged retry remains black and
serial-silent. Native Stop times out; Root sends SIGTERM to verified owned
launcher PID 13827. That abnormal stop remains a separate failure receipt.

Software UTM reaches welcome and native mouse Start session attaches the desktop
at 102.282694, with session PID 837 and zero restarts. Files renders the PNG
preview and 1586×992 dimensions, then a real two-file selection totalling 42 B
with the Recovery tag. Rapid synthetic typing loses characters and retains
Shift; earlier Ctrl+X does not establish the clipboard. The popup eventually
renders after a later observation, but reliable typing, popup and transfer
workflows remain unresolved. Source and collision destination hashes, eight
tags and the empty retry directory remain unchanged. Native skip, partial move,
retry, cancellation, Done, Trash and Undo gates are incomplete. Read-only
inspection finds synchronous per-key modifiers; queue overflow and stale held
keys remain unproven hypotheses.

The software guest powers down normally at 818.038094; owned host PID 15130 is
absent, the serial bridge exits 0 and native AX reports stopped. These native
CUA checks use host synthetic input, not human physical input. C24 establishes
neither the full native Files gate nor all 20 apps, hardware motion, physical
timing or freedom from tearing. No permissions, accounts, security settings,
credentials or paid services change.

Receipts are in `vm/verification/2026-10-03-app-suite-candidate-24/`:
`metadata.json`, `installed-command-receipts.json`, the QEMU and UTM shutdown
receipts, and `native-files-assessment.json`. The input review is in
`vm/verification/2026-10-03-app-suite-candidate-24-scope/native-input-readonly-review.md`.
Before the C25 build, only its separate source preflight was complete: old
mapper and server exit 1, new mapper with old server exits 1, and both updated
exit 0. The following checkpoint records its subsequent installed and native
results.

## Candidate 25 installed and native Files checkpoint

C25 preserves 27 earlier host images. Its immutable ISO SHA256 is
`e3707bbe37248eb5acd41e558731a50f96b6d300474143f2dcc341140f5acca8`
(1,208,111,104 bytes). The 827-file frozen source matches 684 installed source
files and 668 boot inputs/138 outputs. Build, strict provenance, installed app
suite, native renderer checks, independent primary reopen, residency and strict
sustained motion all exit 0. The motion mechanism produces 300 distinct frames
with one pending frame; production display qualification remains unfinished.

A fresh read-only QEMU/HVF boot reaches the welcome with zero restarts, then
powers down normally; owned PID 22829 exits0. Software UTM separately reaches
its desktop through native CUA mouse input. Files shows complete selection
count, timestamp range and location. Actual Ctrl+A/Cut/Paste reaches a collision
with one completed move; Escape cancels it. Native Paste into a new destination
without recutting moves only the unfinished item. Strict read-only oracles
confirm source occupancy, exact file bytes, preserved collision bytes and
migrated Recovery tags at both phases.

The dialog action gate fails: Done is clipped; Skip/Cancel lie below the initial
viewport. Native wheel/thumb drag and Tab did not expose them. Headless direct
and retained CPU diagnostics pass, so no wheel-delivery or retained-renderer
cause is established. C26 is a separate scoped fix keeping actions in a visible
shared footer while details scroll. C25 is not full native Files acceptance.
The UTM guest powers down normally at 538.088958; owned launcher 23329 is absent,
serial bridge 75233 exits0 and native AX reports stopped. Receipts and screenshots
are in `vm/verification/2026-10-03-app-suite-candidate-25/`.
All prior failures remain preserved. Physical tearing, qualified hardware
motion, live audio and full native app acceptance remain open. No additional
permissions or security changes were made.

## Candidate 26 visible transfer actions

C26 fixes the clipped Files transfer actions through an optional shared Dialog
footer. Progress, paths and messages scroll in the body; Keep both, Skip,
Cancel and Done keep their full labels in the visible footer. Existing Dialog
callers without a footer retain identical pixels in 20 comparison cases. The
shared footer passes eight cases; Files passes 360 direct and retained CPU
cases across scale, viewport, path and state variants, with action glyphs
checked before any scroll. Keyboard and pointer checks pass in these host
fixtures. They do not establish native keyboard input acceptance.

The immutable ISO SHA256 is
`eefd9385d31c1c938c80eecb455e13bd46f99b054a6cf96f43f86347456bbefe`,
with 1,208,373,248 bytes. C26 preserves all 28 earlier host images. Its 828-file
frozen snapshot matches 685 packaged source files and 669 boot inputs with 138
outputs. Build, strict provenance, workspace typecheck, shared UI smoke and
all five installed gates exit 0. The installed app suite checks the 20 apps'
scripted workflows, associations and launchers. Native renderer mechanisms,
primary reopen, residency and sustained motion also pass. Production hardware
motion qualification remains unfinished; these results do not establish all
20 apps' native workflows or freedom from physical tearing.

Fresh QEMU/HVF and software UTM boots pass accepted boot frame, text-mode
release and desktop-service admission with zero restarts. QEMU displays the
welcome and exits 0 after normal guest poweroff. In software UTM, native CUA
mouse input starts the desktop. Files selects both source items with their
complete metadata, cuts and pastes them, then cancels a partial move through
the visible Cancel button. Done dismisses its stopped receipt. Paste into a
new destination without recutting moves only the unfinished file. A separate
native Skip preserves its source and the existing destination; another Paste
without recutting completes that skipped file. Native Keep both preserves
`item.txt` and moves the new file to `item (2).txt`. All five baseline/phase
oracles and the additional Keep both oracle exit 0, checking exact file bytes,
source occupancy, collision preservation, migrated tags and unaffected files.
Done dismisses each receipt without scrolling.

Two conflicts remain a concrete native repaint defect. The partial-move
conflict and the separate Keep both conflict retained an earlier progress
frame for about 30 seconds. One native Tab refreshed each to the current
conflict with all footer controls visible. The Skip conflict and subsequent
completion receipts updated automatically. Two actual Application/Files
automatic-loop probes with simulated SHM frame callbacks could not reproduce
the stall, including delayed callbacks and release-first ordering. They never
manually tick or redraw. Source tracing finds the commit, invalidation, wake
and frame-retry paths present; the native stalled frame lacks correlated
submission/callback/compositor revision evidence. No missing-wake root cause
or renderer fix is established. Tab is a recorded workaround, not acceptance
of automatic conflict refresh.

The all-skipped notice also incorrectly says Undo is available for completed
items when zero items completed. Correct outcome wording and separately
observed native keyboard focus/action tests are explicit follow-up work.
Native Trash/Undo, all 20 apps, live audio, qualified hardware motion and
physical tearing remain open. CUA actions use host synthetic input; they do
not establish human physical input. No paid services, credentials, additional
system permissions or security changes were introduced.

Both guests shut down normally. QEMU powers down at 41.698943; owned PID
28786 is absent. Software UTM powers down at 814.484502; launcher 28960 is
absent, UART bridge 68126 exits 0 and native AX reports stopped. The graphics
VM lease is released. Evidence is in
`vm/verification/2026-10-03-app-suite-candidate-26/`, including
`native-files-assessment.json`, installed/build receipts, shutdown receipts,
actual PNG captures and `async-progress-review/README.md`. Earlier failed
oracles, the corrected host process guard and prior image failures remain
preserved.

## Candidate 27 truthful transfer outcomes

C27 gives Files structured transfer receipts. A cancelled partial move reports
completed and unfinished items separately; an all-skipped move reports no items
moved and offers no Undo for that invocation. Actual committed results determine
the counts and bytes. Cancellation uses the structured cancellation error;
unrelated failures remain failures. Fifteen real filesystem outcome cases and
public Window receipt/cut-retry cases pass, alongside the existing Files checks.

The immutable ISO SHA256 is
`417f106fb8fff89cd834a307e2e778345ffc63d4119856b0f663e8ffe3f142fc`
(1,208,446,976 bytes). It preserves all 29 prior images. Its 831-file snapshot
matches 688 packaged source files and 672 boot inputs with 138 outputs. Build,
strict full/boot provenance and all five installed gates exit 0. The installed
suite covers the 20 apps' scripted workflows; renderer mechanisms, independent
primary reopen, residency and strict 300-frame sustained motion also pass.
Production hardware qualification and native acceptance of all apps remain open.

Fresh QEMU/HVF and software UTM boots reach the welcome and desktop admission
with zero session restarts. QEMU shuts down normally and exits 0. In software
UTM, native CUA keyboard input verifies Cancel with Space, Skip with Return,
Done with Return and Space, and Escape dismissal of a completed receipt.
Each action follows independently visible focus on the relevant secondary
control. Forward and reverse focus wrapping remain inside the modal. Both
cancelled and skipped cut items can be pasted to a new destination without
recutting. Read-only guest oracles exit 0 for exact bytes, source occupancy,
preserved collision files, migrated tags and unrelated fixture integrity.
The all-skipped native notice correctly omits Undo despite earlier move history.

Primary Keep both focus remains invisible: its fill and outline use the same
purple, and Pressable suppresses the fallback ring. This is a concrete shared
widget defect, with a separate fix assigned for C28. C27 does not claim native
Keep both keyboard activation or Escape cancellation acceptance. A private
Keep both fixture was prepared but left unchanged; its byte/catalog oracle
exits 0. Native path entry also dropped characters and repeated the final
letter. Its attempted navigation was not submitted, and no file moved.
That input-boundary diagnosis remains open.

The partial transfer repainted its first completed move automatically, then
kept the conflict choices hidden until one native Tab. A separate all-skipped
result initially showed terminal counts and notice with a stale Cancel footer;
it automatically settled to Done without input before verified Space dismissal.
Three damage-aware actual Application/two-Window host probes could not reproduce
the conflict stall. Every relevant Files offer carried full viewport damage;
the proposed empty-damage mechanism did not occur in these cases. Neither a
client wake nor compositor root cause is established. Correlated native state,
submission, callback and compositor evidence is the next diagnostic step.

Software UTM shuts down through guest poweroff at 1170.184704. Owned launcher
36201 is absent, the serial bridge exits 0, native AX reports stopped and the
graphics process audit is empty. The graphics lease is released. Busy loop
unmount warnings and a failed final session-log collection are retained.
Earlier failed provenance attempts and collection gaps remain explicit in
`vm/verification/2026-10-03-app-suite-candidate-27/`. Native CUA captures contain
JPEG bytes despite their `.png` names; no lossless claim is made for them.
Physical tearing, live audio and broad native workflows remain unfinished.
The proposed transfer-dialog concept is still awaiting Josh's preference;
C27 is functional outcome acceptance, with no visual-design acceptance.
No additional permissions, security changes, credentials or paid services were
introduced. CUA input is host synthetic input, not proof of human physical input.

## Candidate 28 visible primary focus and native transfer boundaries

C28 fixes shared Pressable focus on primary actions: a contrasting inset ring
remains visible against the purple fill. The installed focus matrix covers five
families, dark/light themes, and direct/retained CPU rendering. Native software
UTM independently verifies forward/reverse focus between Close and Keep both,
Keep both with Return and Space, and Escape cancellation of an actual conflict.
Private file oracles exit 0: completed moves preserve the collision file, publish
the exact source bytes under the numbered destination, and move its tag;
cancellation leaves source, destination and tag unchanged. Done closes with
Return and Space. These checks use actual host synthetic keyboard input.

The immutable ISO is 1,208,360,960 bytes, mode 0400, SHA256
`851403413a9369fe8736456ac73e9d32c90b40eed9a4afb99429ed243367890e`.
Strict provenance matches 689 packaged sources and the narrow boot package.
All five installed gates exit 0: app suite, native renderer mechanisms, independent
primary reopen, residency, and sustained motion fixture checks. All 30 prior
images retain their exact hashes and sizes. Fresh QEMU/HVF and software UTM
boots verify accepted boot frame, release gate, tty1 desktop admission and zero
session restarts. Native Start session reaches the settled desktop. Both guests
shut down normally; the UTM launcher is absent, the serial bridge exits 0,
native AX reports stopped, and the graphics process audit is empty.

Two first diagnostic traces exhausted their 512-record cap during startup.
An excluded v2 observer reserves records for transfer phases and keeps bounded
aggregate omission counts. Its first Space attempt ended at the 60-second cap
while waiting and remains inconclusive for activation. A fresh timed Space
retry and Escape case capture the real conflict choice, terminal outcome and
public native/commitId submission, frame, release and presented callbacks.
The rerunnable `assess-native-traces.py` passes with seven and six complete
callback joins respectively. The simple conflicts and terminal dialogs settle
without another input. This does not establish the root cause of C27's
multi-item refresh stall, exact React commits, Wayland wire identity, compositor
output acceptance, physical scanout or freedom from tearing.

An initial private-app launch failed before opening because it inherited the
inaccessible root console directory. Launching from the installed Files
directory, as its normal wrapper does, fixes that failure without permission
changes. Earlier failures, capped traces, commands, oracles, captures and
shutdown receipts remain in
`vm/verification/2026-10-03-app-suite-candidate-28/`. Native captures may contain
JPEG bytes despite their `.png` suffix. Broad native app, live audio and hardware
motion acceptance remain unfinished.

Josh subsequently approved the transfer-dialog concept, fine purple window
borders and background-tab colours. C29 implements these in separately owned
Files, widgets and desktop workstreams; C28 remains a frozen fallback and its
acceptance does not cover the new source. The
[display-manager design](display-manager-design.md) records the requested splash,
combined greeter/DM and selected user session. The current welcome still runs
inside the existing desktop and does not authenticate; no display-manager
completion is claimed. Activating authentication, account or login-security
changes requires separate approval. No additional system permissions, security
changes, credentials or paid services were introduced.


## Candidate 29 — approved chrome and transfer design, unaccepted fixture

C29 integrates the approved Files transfer layout, full compositor window outlines
and muted plum titlebar tabs. The immutable image builds after an ISO-creation
failure for insufficient builder space. Only a hash-proved, unrooted duplicate
of a preserved host ISO is reclaimed. The original failure and a transient
Parallels exec failure remain recorded; the source snapshot is unchanged.

The ISO is 1,208,393,728 bytes, mode 0400, SHA256
`295f55283d1d73af20dd2680f652ea53e4f4c502d6f9e0fa22885c34e2ab5308`.
Strict provenance matches 698 packaged source files and the boot package.
All 31 earlier host images retain their exact hashes and sizes. The separate
native-renderer, independent-primary-reopen, residency and strict-motion fixture
gates exit 0. The installed app suite exits 1 in the new transfer-design test,
so C29 is unaccepted and no C29 graphics guest is started.

The failing independent text probe assumes every label has enclosed transparent
letter-counter pixels. At 1.5× scale, `EXISTING` has none on both macOS and the
exact Linux package. Failure occurs before examining the dialog. This does not
establish missing text or a production rendering defect. Read-only diagnostics
verify complete glyph foreground and transparent-background samples against
real text and reject a flat foreground-colour rectangle. The focused Cupertino
Keep both label preserves all 253 foreground samples and 76 enclosed negatives;
its control outline can legitimately cross exterior transparent gaps.

Evidence, failed suite, all four remaining gate receipts, actual raster captures
and immutable source are in `vm/verification/2026-10-03-app-suite-candidate-29/`.
C30 changes only the delivered test oracle plus acceptance documentation: ordinary
labels use full transparent-background negatives, while footer labels use focus-safe
negatives. It requires fresh provenance and installed/native acceptance. C28
remains the latest scoped native checkpoint. Physical tearing, hardware motion,
broad native app acceptance and live audio remain unfinished. No new permissions,
security changes or authentication activation are introduced.

## Candidate 30 — native transfer and Editor checkpoint

C30 passes all five exact installed gates and strict provenance for 698 packaged
sources plus the boot package. The immutable ISO is 1,208,320,000 bytes, mode
0400, SHA256 `3b177cfe0a67ea529160d27fc60284156143761911df12f1e00df658128fccf5`.
All 32 earlier images retain their exact bytes and hashes.

Fresh QEMU/HVF and software UTM boots pass the managed boot-frame release and
tty1 session gates. Native UTM reaches the desktop. Files tabs, active chrome,
conflict choice with Return and Space, Escape cancellation, focus navigation and
Show folder are observed in actual captures. Independent byte/tag oracles exit
0. Public native/commitId callback joins pass with eight complete joins after
Return, eight after Space and five after Escape; these are public callbacks,
not physical scanout or exact React/wire/output identity.

An isolated fixture initially lacks application registration: opening the text
file invokes xdg-open and fails with exit 3. Running the existing installed app
registration helper in that private fixture and opening fresh Files fixes its
environment. Native Files → Editor then opens the numbered destination, types
`!`, shows Unsaved, saves, closes and reopens the exact 27-byte text. The original
43-byte collision file and relocated recovery tag remain unchanged. Earlier
failed attempts, capped observers and the corrected fixture are retained.

The 24-file, 192 MiB bulk workflow is blocked. Native Ctrl+A then Ctrl+C exits
the graphical session at 04:31:08 UTC with systemd Result=success, main status 0
and no restart. UART remains available and the independently launched Files
processes survive. All source hashes remain exact and Target is empty; no bulk
copy completion is claimed. Source inspection finds no controlling-VT keyboard
mode suppression, consistent with Ctrl+C becoming a terminal interrupt. The
post-exit canonical tty state alone cannot prove its pre-exit mode because the
unit resets its TTY. C31 needs a verified input-ownership lifecycle and
before/after native evidence, without additional permissions or security changes.

Human review also requests compact transfer dialogs without redundant titlebars
and content/header clipping that respects rounded window borders. The scoped
16-capture visual review does not close that later feedback. C31 owns those
shared fixes and actual before/after captures. Physical tearing, hardware motion,
multi-item refresh and broad native app workflows remain unfinished.

Before shutdown, 47 small guest artifacts were exported with exact lengths and
SHA256 hashes. QEMU logs Power down at 228.208847 seconds, but its host wrapper
exits 1 for an unresolved reason. Software UTM logs Power down at 1093.002447,
its serial bridge exits 0, native AX shows Stopped and the host graphics process
audit is empty. Both logs retain loopback-unmount warnings. The graphics lease
is released. Evidence is in `vm/verification/2026-10-03-app-suite-candidate-30/`.
This documentation update follows C30's frozen build; it changes no packaged
product source. No authentication activation, permission grant or paid service
was introduced.

### Candidate 31 input diagnosis and implementation gate

A separate C30 diagnostic boot captures the foreground process group before
and after native Ctrl+C. The key adds pending SIGINT to the session main and
compositor while the group is stopped. Resuming the same group exits the
desktop. This diagnoses the console interrupt; it is not a successful copy
workflow. Exact artifacts and the assessment are in C31's `c30-vt-replay/`.

A second read-only boot proves that PAM puts the session main and compositor
in `/user.slice/user-1000.slice/session-1.scope`. The manager reports
`/system.slice/moire-session.service` as its control group. The proposed VT
supervisor's service-cgroup ownership proof therefore does not match the real
actors. Its source and tests are archived under `files-scope/vt-prototype/`
and excluded from the package. It was never activated. Both Nix files, the
session launcher and dependency, lockfile and sys export barrel match C30
exactly after rollback.

The replacement acquires exclusive evdev ownership on existing descriptors.
It includes VT-routable media-key siblings, requires a typing keyboard,
checks held keys, acquires before readiness registration and rolls back failed
startup. Failed same-path reacquisition shuts down the compositor and outer
session resources with a nonzero exit. The existing Linux builder keyboard
passes actual competing-grab, last-alias-close, close-on-exec and owner SIGKILL
release tests without injected input. These use a disposable C30 runtime with
the changed sources copied and hashed; the new installed package and bulk Copy
and Terminal PTY Ctrl+C still need a fresh verification. Hotplug, held-key
handoff races and mixed keyboard/pointer event devices remain explicit limits.
The topology boot powers down at 174.991888 seconds, its serial bridge exits 0,
UTM reports Stopped and the host graphics process audit is empty. The three
exported artifacts have verified lengths and hashes in `c30-cgroup-probe/`.

Actual Linux EGL corner checks pass for CSD and SSD frame masks, preserved
translucent shadows, focus colours, geometry/radius damage, child crossings,
fullscreen return and client/output scaling. The first fractional-scale oracle
incorrectly demanded a nearest-sampled background pixel at a boundary next to
a shadow. Production output uses linear sampling. The corrected oracle compares
the whole physical frame with independent bilinear sampling of the already
verified logical raster, with a maximum observed channel difference of one.
The original failure log remains preserved. Diagnostic readback is used only
for assertions; production composition's readback count does not increase.
This is a builder EGL result, not physical tearing or hardware qualification.

### Candidate 31 installed and native input checkpoint

C31's immutable ISO is 1,208,336,384 bytes, mode 0400, SHA256
`43b0e534daa605522c6f08674feb485ad26286f42ab5b11ff5d61095f25ebea2`.
Strict provenance matches 705 packaged source files and the boot package;
all 33 earlier images retain their hashes and sizes. QEMU/HVF boots the exact
image, passes the managed release gate and unit verification, and powers down
with wrapper exit 0. The installed app suite, independent primary reopen,
residency and strict-motion gates exit 0. The native-checks aggregate exits 1:
the new rounded frame has no opaque visible witness in the original tiny
visibility fixture. That result remains unaccepted. C32 repairs conservative
visibility with a proven opaque interior while preserving transparent corners.

The fresh software UTM boot reaches the existing welcome and desktop. Native
Files Ctrl+A/C keeps the original MainPID 838, zero restarts and unchanged VT
and termios state. Menu Paste copies 24 distinct 8 MiB files in 51 seconds;
the actual progress and completion dialog are captured. The independent final
oracle verifies all 192 MiB in both source and destination, with no staging
files left. An earlier oracle sampled the active transfer and failed; it is
preserved separately. Rapid location typing was garbled and Ctrl+V attempts
did not start the transfer. Those input paths are not accepted by this result.

Native Terminal runs `sleep 60` on its real PTY. Ctrl+C interrupts it and
`echo $?` displays 130. The desktop stays in the same session, with no pending
SIGINT on the main, management service or compositor. The exact installed
Linux descriptor checks pass competing ownership, alias lifetime,
close-on-exec and child SIGKILL release. In UTM, an ordinary-user probe kills
the actual installed compositor and acquires its formerly busy keyboard
descriptor after 148 ms. It injects no keys and writes no VT state.

A subsequent manual restart fails closed because the kernel still reports
held key codes 12 and 20. The failed restart journal is retained and the loop
is stopped. Native minus/t press-and-release clears both keys; a new manual
session starts, Enter activates the welcome, and the desktop is captured.
The origin of the held keys is not independently attributed to Moire or host
automation. Automatic recovery and rapid text entry remain unaccepted.

Eighteen small guest artifacts are exported with exact lengths and SHA256
hashes. UTM powers down at monotonic 797.548333, the UART bridge exits 0,
native AX reports Stopped and the host graphics-process audit is empty.
The graphics lease is released. Evidence, original failures and scoped
assessments are in `vm/verification/2026-10-03-app-suite-candidate-31/`.
No new permission, security change or authentication activation is introduced.
Physical tearing, hardware timing, broad native app workflows and live audio
remain unfinished.

### Candidate 32: installed checks and native Screenshot checkpoint

C32 preserves all 34 preceding images. Its immutable ISO is
`vm/nixos/moire-aarch64-quality-32.iso`, 1,208,320,000 bytes, SHA256
`fa790c2a72ded8a3da059f5c5464bd33cd83b6ea2535b9437296e0d4d4da9bb1`.
The exact installed package is
`/nix/store/3969d8zf2f63p7pcaizsz4qrss34cv9c-moire-0.0.0`.
The installed app suite, native renderer checks, primary reopen, residency and
strict motion checks each exit 0. The final gallery checks 800 frames with no
overflow or invalid surfaces. A fresh QEMU/HVF boot automatically reaches the
session and powers down normally. These checks do not establish physical
tear-free presentation or native interaction with every app.

In a separate software-display UTM boot, native Enter opens the desktop.
Screenshot captures the display; explicit bounds crop it to 640×400.
Cancel on unsaved close and Cancel on overwrite retain the buffer and preserve
the existing PNG's exact hash. Save and Replace publish a 68,013-byte PNG and
close the Screenshot process. Exported guest evidence verifies the same
session PID 839 with zero restarts throughout. An independent PNG decoder
checks the saved dimensions and pixels.

Three native failures remain explicit. Drag cropping produces 1×1 rather than
the intended selection. Screenshot's bottom status falls behind the panel.
Opening the saved PNG from Files fails with Image Viewer exit 127. A diagnostic
using the Files process environment and its actual user identity shows that
the launcher's login shell resets PATH; a non-login shell retains the existing
app and runtime paths. Rapid repeated key entry remains unqualified. These
findings are assigned to C33; none is waived by the installed or gallery checks.

UTM powers down at monotonic 1046.286328, native AX reports stopped, the UART
bridge exits 0 and no QEMU graphics process remains. All 855 frozen source files
and all 35 resulting fallback images are hash-verified before releasing the
graphics lease. Exact receipts, native captures, original failures and exported
PNGs are in `vm/verification/2026-10-03-app-suite-candidate-32/`.
Permissions and security settings are unchanged.

## Candidate 33 integration

C33 integrates Music import recovery, video queue completion and replay,
selected-font sample pages, Calendar close protection, independent Clock
notices, and shared Calendar/Clock/Colors persistence. Files activation uses
the existing session PATH. Screenshot uses delivered release endpoints and
rejects stationary crops. The compositor preserves work-area allocation when
focus follows first mapping, and fits normal and maximized frames above the
panel on the selected output.

The current host suite and renderer checks pass. The gallery checks 800 frames
and 69 PNGs with no overflow or invalid-state findings. The final 13 focused checks and affected type checks also pass after the
storage cleanup followup and source-relative work-area regression. Normal Core
build passes. Exact installed and scoped native results follow below. CPU rounded-group clipping is
an excluded prototype; its EGL resource lifecycle is not implemented.

Evidence and preserved negative controls are under
`vm/verification/2026-10-03-app-suite-candidate-33/`. All fallback ISOs are
preserved. Nix, boot and VM configuration remain byte-identical to C32; no
additional system permission or security change is included.

### Candidate 33 installed and native results

The immutable ISO is `vm/nixos/moire-aarch64-quality-33.iso`, 1,208,414,208
bytes, mode 0400, SHA256
`18503b3318d77a3af665673898b528a834f283fe97ae9165d80f54186a45bb0e`.
The exact package is `/nix/store/aiavpk5jsdisxny4clzkz11rwgldl1ir-moire-0.0.0`.
All five installed gates exit 0: full app suite, native renderer checks,
primary reopen, residency and strict motion. Provenance matches 725 packaged
source files and the actual ISO build's boot dependency. QEMU/HVF reaches
the automatic session, passes managed boot admission and unit verification,
and powers down with wrapper exit 0.

A fresh software-display UTM boot reaches welcome and desktop. Screenshot's
first mapped frame and footer stay above the panel. Capture saves a 1280×800
PNG. Explicit bounds crop the buffer to 640×400; Close Cancel and Overwrite
Cancel retain edits and preserve the original file hash. Save → Replace →
Close publishes a 68,013-byte PNG and retires both Screenshot processes.
Files opens it through the PNG association in Image Viewer, which displays
and rotates it without changing the saved bytes. Session MainPID 837 and
zero restarts remain constant. Twelve guest artifacts pass exact export
length/hash checks; an independent PNG decoder checks all five exported PNGs.

Native drag cropping still fails: the attempted gesture yields no positive
selection and is rejected while the saved original remains intact. The
read-only observer of the two existing pointer devices receives zero records
and no errors. The production reader attempts exclusive `EVIOCGRAB`, so this
observation cannot establish whether transport motion was absent. Instrument
the actual owner to distinguish guest input, compositor routing and app
delivery before changing behavior. Native annotation and rapid text entry
remain unqualified. Physical tearing, audible playback, native video, live
recorder capture and native acceptance of all twenty apps remain open. Real
mpv decode/queue/EOF checks used null audio/video outputs.

UTM powers down normally at monotonic 589.308840. Native AX shows stopped,
the UART bridge exits 0, and no graphics guest process remains. All 868 frozen
source files and all 36 resulting images pass the final integrity check before
the graphics lease and source freeze are released. The initial integrity
verifier's mistaken fallback count is preserved alongside its corrected pass;
the initial Linux mpv fixture failure and its diagnosed repair are also retained.
Documentation updates after release do not change this image's frozen source.

The next daily-use slices are described in [the integration plan](daily-use-plan.md).

## Candidate 34 desktop services source milestone

The host backend integration checkpoint passed the complete app suite in
590.425 seconds, affected type checks, lint and formatting. Its exact 27-file
source cohort is archived with
[`backend-review.json`](../vm/verification/2026-10-03-app-suite-candidate-34/root-scope/backend-review.json)
and [`integration-checks.json`](../vm/verification/2026-10-03-app-suite-candidate-34/root-scope/integration-checks.json).
The initial aggregate wrapper timed out at 300 seconds and found one formatting
issue; both failures and first logs remain preserved. The final bounded wrapper
completed successfully. Lint returned zero with existing/deliberate array/spread
warnings; it is not a zero-warning claim.

The production service/client passes real private-D-Bus volume/mute readback,
notification replacement/dismiss/history/DND, stale revisions, spoofed senders,
late timed writes with pending/retry protection, service-owner replacement and
slow-read coalescing. The codec's DOUBLE alignment defect is proven by an
independent byte oracle and real daemon. Actual normal SIGTERM/SIGINT fixture
parents retire their owned CLI descendants through the production shutdown hook.
Open With survives a real wait beyond the former ten-second generic deadline and
closes timed-out/canceled requests on their original owner.

The old Quick Settings visual draft is rejected. The 720 functional widget frames
prove focus/geometry/disabled behavior, not visual approval. Josh approved the
[main panel](../vm/verification/design-references/2026-10-03/quick-settings-approved.png),
[separate notification tray](../vm/verification/design-references/2026-10-03/notifications-approved.png)
and [expanded alternate views](../vm/verification/design-references/2026-10-03/quick-settings-subpanels-approved.png).
Root opened the actual reference pixels. Matching shared-widget implementation is
integrated in source; the password follow-up visual direction is pre-approved. Those approvals
do not activate credential, network, authentication or power backends.

At this source checkpoint there was no C34 installed image or native acceptance. C33's ISO and review
bundle copy were independently rehashed unchanged at `18503b…bb0e`, 1,208,414,208
bytes and mode 0400. No graphics VM was booted or controlled during this source
milestone. Live audio-server readback, physical graphics/input, native appearance,
suspend/resume and the persistence milestone remain separate gates. See
[desktop services](desktop-services.md) for capabilities, limits and commands.


C34 now has a separate notification bell/tray, naturally measured main/details
views, typed hardware support and network transport, and a compact Windows list
that restores hidden minimized tasks. Unsupported hardware rows disappear;
Network stays visible with distinct wired, Wi-Fi and generic symbols. Cached
support survives outer loading/error states without presenting cached device
values or addresses as current observations.

Independent review reproduced two integration failures before source freeze:
an opaque scrolling viewport covered the popup frame, and a status update
between pointer-down and pointer-up retargeted Clear all to newly arrived notices.
The popup now owns its background; press activation captures its original
semantic callback separately from refreshed drag geometry. The actual controller
regressions cover same-count replacement, intervening motion and service-owner
replacement. Original captures, failing fixtures and earlier receipts remain
preserved. At that checkpoint final source-suite, packaged and native gates were pending.


The final C34 UI source gate passed the complete suite in 696.772 seconds,
affected type checks, lint and formatting. All 65 source hashes stayed stable.
[`SOURCE-READY.json`](../vm/verification/2026-10-03-app-suite-candidate-34/ui-integration/SOURCE-READY.json)
binds the archived cohort and logs. The integrated controller proof passes 722
CPU frames, and the final popup proof passes 1,440 direct/retained frames with
2,556,240 corner/border samples and zero mismatches. Actual captured notification
replacement/motion/owner-restart workflows pass; compact Network and hidden
minimized-window access pass. The canonical icon audit covers 670 size/tint
frames. Those receipts establish source results. Later installed and native results follow.


## Candidate 34 installed and native results

C34 is a sealed, bootable ARM64 image: `vm/nixos/moire-aarch64-quality-34.iso`,
1,208,516,608 bytes, mode 0400, SHA256
`df57cdfb531ae285bc7dc4399e51daf26afc153b57b9f7f449982baf15fb9add`.
Its actual package is `/nix/store/1mh6p4m0wgcm77lfzimi7caan1slw531-moire-0.0.0`.
The [build receipts](../vm/verification/2026-10-03-app-suite-candidate-34/image-scope/build-after-backup-command-receipts.json)
record four successful commands, 772 matching packaged source files and the
boot package's membership in the actual ISO dependency graph.

All five [installed checks](../vm/verification/2026-10-03-app-suite-candidate-34/image-scope/installed-explicit-session/command-receipts.json)
returned zero: complete app suite, native renderer checks, primary-node reopen,
residency and strict sustained motion. The first installed invocation failed
because the packaged daemon's implicit session-config path was missing on the
Ubuntu builder. Its original failure is preserved. The rerun uses the same Nix
daemon and its shipped standard config explicitly for owned private test buses;
no production configuration, policy, permissions or security settings changed.
These installed workflows include headless app/Window tests and real media
decode to a null output; they do not establish all twenty native app workflows
or audible playback.

The [direct QEMU/HVF boot](../vm/verification/2026-10-03-app-suite-candidate-34/image-scope/qemu-boot-assessment.json)
starts the normal `moire-session.service` automatically with zero restarts and
the production session daemon using its default config. Normal guest poweroff
and process absence were observed. The separate UTM Software boot runs the
same exact package and boot image. Its [native review](../vm/verification/2026-10-03-app-suite-candidate-34/image-scope/native-review.json)
binds real service-owner/PID readback, boot ID, fifteen hash-checked guest
artifacts and preserved native screenshots.

Native successes are limited and concrete: a held pointer opens Quick Settings
and the separate tray; the wired glyph and actual interface addresses appear;
unsupported rows are hidden; keyboard navigation enters and returns from network
details. DND On and Off have independent service readbacks. The monitored Off
request uses current revision 421 and the service accepts it. A keyboard
notification action reaches its original producer, and an individual pointer
dismissal closes the selected notice. Keyboard navigation opens history, whose
closed entries have no producer action controls. Screenshots show the rounded
shared frame at one scale/theme.

Initial DND and native Clear all attempts also show stale-state errors. Clear
all is failed: notice 4 remained active in the producer's final snapshot at
13:06:45.137 UTC and closed two milliseconds later when that producer exited.
The resulting empty tray is not success evidence for Clear all. Several fast
clicks and combined key sequences miss their expected result, while held
gestures work; no production input cause is established. Long-body scrolling,
all twenty native apps, rapid typing/clipboard, physical tearing and native
audio/video/recording remain open. C33's native crop failure remains preserved.

A private-bus old-source reproducer identifies needless revision churn:
identical audio refresh advances revision 3 to 5, emits loading then unchanged
ready state and rejects a captured DND intent without a policy write. Native
monitoring also observes loading/unavailable pairs every five seconds with
unchanged facts. The next candidate fixes semantic publication without removing
actual state/owner/revision guards. This evidence does not assign every missed
native input or stale screenshot to that one cause.

All 915 C34 source hashes matched after native testing, before documentation
or next-candidate edits. The [final integrity receipt](../vm/verification/2026-10-03-app-suite-candidate-34/image-scope/images-after-native.json)
checks the previous 36 fallback images and C33/C34 review copies. The guest was
normally powered off, the serial bridge exited zero, input capture was released
and no graphics VM processes remained before the Root lease was released.


## Candidate 35 audio polling source fix

C35 changes three source/test files. Settled background audio reads retain the
last observation and publish only changed semantics; initial discovery remains
loading. Equal results preserve the frozen observation object. Mutations still
publish loading, resolve the actual default, write and verify readback. Real
changes, errors and recovery still advance the desktop revision. Owner, exact
revision, busy, cancellation and no-auto-retry guards are unchanged.

The preserved [old-source regression](../vm/verification/2026-10-03-app-suite-candidate-35/desktop-scope/old-regression.log)
fails on identical refresh revision 3 to 5. The fixed production adapter/service
uses a real private daemon and passes with revision 2 unchanged, zero poll events
and a successful captured DND write. Twenty-six adapter cases and expanded
private-bus checks cover unchanged ready/unavailable/error polling, captured
notification batches, real changes rejecting old intents, cancellation and
resource retirement. [Independent review](../vm/verification/2026-10-03-app-suite-candidate-35/widgets-scope/audio-review/review.json)
passes both checks on the owner's final three hashes. Initial fixture/type errors
are retained; simulated executable support was corrected only in the fixture.
No live audio or native improvement is inferred from these source results.
C34 remains sealed; C35's actual build and installed/native results follow below.

## Candidate 35 installed and native results

C35 is sealed at `vm/nixos/moire-aarch64-quality-35.iso`, SHA256
`c4ba2b80cb93bcdcb4325c86ea9491375b9989643b032211208be0528aaa127d`,
1,208,446,976 bytes, mode `0400`. Its exact package is
`/nix/store/rkja0lxnxl103l098pyzb8hqvzxwhv0d-moire-0.0.0`.
Actual build, packaged-source verifier, boot dependency membership and boot
verifier all exit 0. The frozen cohort has 915 source files, with exactly three
source/test changes since C34; 772 packaged files match. Targeted source checks
pass. The full host suite was not rerun for C35; C34's unchanged cohort and the
full exact C35 installed suite are recorded separately.

All five installed checks exit 0: full app suite, native checks, primary reopen,
residency and strict motion. The fixture uses the same shipped D-Bus daemon and
standard session configuration as C34, through an adapter confined to its private
test PATH. Production QEMU/HVF and UTM boot both use normal `--session`, with
automatic active/running Moire and zero restarts. No bus policy or system
configuration change is involved. CPU and null-output media workflows do not
establish native playback or microphone support.

The native software UTM boot ID is
`422251fe-4a0e-485d-b10c-d8792f42c091`. Actual management/compositor PIDs 3411/3412
run from the exact package. The evidence harness only reads state, seeds owned
notices and monitors existing methods; it does not invoke DND or dismissal.

- Idle polling remains quiet for 18 seconds: four equal full observations,
  revision 3 unchanged, updating=false and zero Changed signals. Audio accurately
  remains unavailable because neither `wpctl` nor `pactl` is installed.
- A native fast click invokes compositor `:1.33` → service `:1.32`
  `DismissMany`, request serial 9, expected revision 9, pairs 3/3, 2/2, 1/1.
  The correlated actual reply reports dismissed 3/skipped 0. Producer `:1.38`,
  PID 4071, receives three NotificationClosed signals with reason 2. Independent
  readbacks at 9.263 seconds after the request and 6.009 seconds later show the
  notices closed while that same
  producer remains alive. The empty tray therefore proves dismissal before
  producer cleanup, unlike C34's failed Clear All attempt.
- Fast single clicks switch DND On/Off; correlated successful methods and
  independent state readback show true/false. Closed history entries display
  without action buttons. Wired status shows actual local addresses with the
  distinct wired icon and hides unsupported hardware rows.

Native long-body scrolling was attempted but did not visibly move the body;
screenshots 07/08 retain that failure. Selected single clicks pass, but broader
pointer timing, rapid typing, clipboard and cross-device event ordering remain
unaccepted. C33's native drag-crop failure is still open. All 20 native app
workflows, physical tearing, accelerated presentation and native media/audio/
recording have not passed this review. No broader acceptance is inferred.

The harness exports evidence before cleanup, takes a final independent readback
with the producer alive, drains the monitor, then closes the producer. Finalize,
owned monitor and producer waits all exit 0. Forty-six artifacts pass exact byte
length and SHA256 export checks. Restricted unprivileged `/proc` reads retain
EACCES explicitly; existing-root process identity and daemon PID/UID observations
provide separate corroboration. No additional permissions or security changes
were made.

Normal poweroff completes; the serial bridge exits0, fresh UTM accessibility
shows stopped and Capture Input 0, and no graphics or serial bridge process
remains. All 915 frozen source files still match before the result documentation
update. All 37 prior immutable images and C33/C34/C35 review copies retain their
hashes; there are 38 immutable image checkpoints. The sole graphics lease is
released and Recovery was notified.

Evidence: `vm/verification/2026-10-03-app-suite-candidate-35/` contains
`image-scope/native-review.json`, installed command receipts, exported native
artifacts, screenshots, serial log, source/fallback checks and independent
workstream reviews. Build/run commands are in [the VM guide](nixos-vm.md#candidate-35-verified-checkpoint).

## Candidate 36 scrolling and native keyboard results

C36 is sealed at `vm/nixos/moire-aarch64-quality-36.iso`, SHA256
`3adeb23d65f962cb21d52ad43146c3e8f3f5bdbe589c89b16a91254bde2d1158`,
1,208,614,912 bytes, mode `0400`. Its exact package is
`/nix/store/qw2kn2xsm219xwn39jp1kzd3426c08pv-moire-0.0.0`.
The boot package is proven in the actual ISO's recursive build dependencies.
All 775 packaged files and 756 boot inputs match the 918-file frozen source.
Thirteen existing source/test files changed and three were added since C35.

Shared ScrollArea/ScrollColumn now offer explicit keyboard focus and immutable
scroll metrics. Notification history opts in; active producer controls and
other consumers preserve their existing contract. Unmodified arrows, Page
Up/Down and Home/End move the reading body. Modifier combinations do not.
Enter, Space and Tab retain their existing action/focus behavior. Focus survives
a shrink to non-scrolling content and regrowth. Synchronous logical offsets
preserve batched repeats. This is a new reading affordance; the baseline resize
diagnostic also passed, so no old resize failure is claimed.

The default-off bounded trace observes allowed raw pointer records before
decoding, axis routing, shell hit/offset/extent and CPU paint checksums. It does
not force redraws or collect key/button payloads, app text, filenames or raw
buffers. A throwing log sink disables tracing without interrupting input.
High-resolution wheel records are observed; high-resolution-only synthesis is
not added. CPU overlay paint is separate from native presentation.

Validation passes on the final source: shared public Window reading, repeat,
modifier, Slider/TextArea ownership and resize workflows; 40 notification
theme/scheme/scale/transport cases; two actual shell workflows with 762 CPU
frames; trace budget/deadline/sink checks; focused types and lint. Six existing
lint warnings remain. The full host app suite exits 0, as do all five exact
installed gates: app suite, native checks, primary reopen, residency and strict
motion. Linux media prerequisites skipped on the host remain explicit; the
installed cohort covers its supported non-native workflows.

An initial footer pixel assertion failed because moving the remembered pointer
away from Back ended its existing hover animation. All changed footer pixels
were inside the Back button. The fixture now positions the pointer and settles
existing motion before comparing the fixed footer. Failing captures/logs remain
preserved; this finding did not justify a production layout/cache fix.

Direct QEMU/HVF starts the automatic tty1 session with zero restarts and powers
off normally. Software UTM uses EGL llvmpipe/Mesa 26.1.8 with direct GBM scanout.
Native results are two separate cohorts:

- First boot `8a51643c-280d-4b6c-b9a9-802b926205a3` starts automatically.
  A RAM-only opt-in diagnostic restart observes mouse wheel REL8=21 and
  REL11=2520, then SYN, axis21 at `640,400`, no popup hit and an unconsumed route.
  Both tablet and mouse opened successfully; the eight cached context records
  contain SYN only, with no supported coordinate motion. Clicks do not open the
  tray. The later captured drag occurs after the 120-second trace deadline and
  cannot establish missing raw events. This narrows the blocker to movement
  delivery/reading in that cohort, without assigning its root cause. No native
  wheel offset or paint result is accepted.
- Fresh boot `e75a68dd-f2f2-41c1-902a-1bb3301f6729` runs the normal package
  without diagnostic overrides, active/running with zero restarts. Captured
  `Meta_L+n` opens the actual tray. Enter on focused Clear All invokes compositor
  `:1.33` → service `:1.32`, serial9, revision9, pairs3/3,2/2,1/1. The matched
  reply reports dismissed3/skipped0. Producer `:1.37`, PID3883, receives three
  reason2 close signals and remains alive for readbacks 5.828 seconds after the
  request and 6.006 seconds later. The helper never invokes the dismissal.
- In that second boot, Enter opens passive history with initial body focus.
  Page Down visibly moves numbered text from BEGIN/01 to lines23–56/MID. End
  displays lines55–72, END and the final notice; Home restores BEGIN/01.
  Reviewed header/footer interiors and the Back button remain pixel-identical
  across these captures. Tab visibly focuses Back, Shift+Tab restores body
  focus, and Back returns to the empty active tray using Space or Enter.
  No new producer actions are observed; states remain closed at revision14.
  The method monitor covers DismissMany/SetDND, not every possible RPC. These
  screenshots establish visible reading at one software theme/scale; this
  cohort has no CPU offset trace. Rapid attempt captures are retained but
  delayed, isolated captures establish focus, avoiding stale-frame acceptance.

The native image files returned by the capture API contain JPEG data despite
their `.png` names. Reviews decode the actual format; small boundary differences
do not establish unclipped pixels or exact full-region equality. An uncaptured
shortcut opened UTM's New VM sheet; it was canceled without creating anything.
The captured guest route was then verified separately.

Both producers/monitors finalize and their owned waits exit 0. Twenty-two first
cohort and 33 second cohort guest artifacts pass exact byte-length/SHA256 export
checks. Both UTM boots power off normally, both serial bridges exit 0, capture
is 0, and no QEMU/launcher/serial bridge remains. Recovery is notified and the
graphics lease released. All 918 frozen source hashes match before result docs;
all 38 prior host images and C33–C36 review copies retain full hashes and `0400`.
A historical cache ISO was copied before reclaiming its verified duplicate;
its runtime provenance remains unverified. Forty host image files are preserved.

Wheel/pointer movement, rapid typing/clipboard, cross-device ordering, C33's
failed native drag crop, all twenty native app workflows, physical tearing,
accelerated presentation and native audio/video/recording remain open. Native
DND was not repeated in C36; C35 evidence retains its original scope.

Evidence: `vm/verification/2026-10-04-app-suite-candidate-36/`, including
`image-scope/native-review.json`, `image-scope/native-keyboard/`, independent
input/image/widget/method reviews, installed receipts, source snapshot and full
preservation checks. Commands are in [the VM guide](nixos-vm.md#candidate-36-verified-checkpoint).
