# Moire acceptance plan

This is the remaining implementation queue. A package build or layout check does
not close a native workflow or visual gate. Preserve every verified fallback ISO
and record source provenance for each new image. Root owns integration and the
graphics VM lease; coordinate guests with the recovery task before booting.

Latest scoped native UTM welcome/desktop checkpoint is C30. Its frozen image
passes all five installed gates, fresh QEMU/HVF and software UTM startup, native
Files conflict handling with Enter, Space and Escape, and Files → Editor typing,
saving and reopening. Exact file bytes and recovery tags match the expected
outcomes. Its bulk-copy attempt exposes a critical blocker: native Ctrl+C exits
the graphical session before copying. C31 must prevent duplicate console input
and repeat that workflow. Rounded content clipping and redundant dialog chrome
also require the shared fixes requested in the human review.
C31's native diagnostic confirms kernel SIGINT delivery to the foreground
desktop group. PAM places those processes in `session-1.scope`, outside the
service's `ControlGroup`, so the proposed VT restoration supervisor cannot use
that service cgroup as its ownership proof. That prototype is archived and has
never been activated. The current fix uses exclusive ownership of existing
evdev descriptors, with acquisition rollback and fatal teardown on failed
reacquisition. Kernel descriptor release restores ordinary input delivery.
No TTY modes, Nix unit permissions or PAM configuration change. New-device
hotplug and keys held during console handoff remain separate native gates.
See [C30 evidence](quality-review.md#candidate-30-native-transfer-and-editor-checkpoint)
for exact evidence and limits. Both guests are off, the graphics lease is
released, and every earlier fallback image is preserved. The QEMU guest reports
normal Power down, but its host wrapper exits 1; that status remains unexplained.
C29 builds the approved Files dialogs, full window borders and tab colours.
Its strict provenance and four renderer gates pass, but the installed app suite
fails a new text-oracle assumption before checking the dialog. C29 remains
unaccepted and preserved. C30 corrects that test assumption and passes the
scoped checks above; it is not broad desktop acceptance. Historical C15 and C16 results below remain
evidence for their respective frozen images.

The C20 automatic-startup checkpoint under Homebrew QEMU/HVF has two fresh
boots pass accepted React scanout, main-only READY, authenticated release and
current console-policy admission into the welcome session. Installed app,
reduced-motion and 800-frame gallery checks pass. C19 separately passes native
UTM synthetic Escape and console restoration. These do not close physical
initial-boot Escape, stalled-renderer Escape, hardware motion or tearing gates.
The C20 native output-free wire fixture was blocked by first-map geometry;
C21 fixes that lifecycle below. See
[C20 evidence](quality-review.md#candidate20-automatic-startup-checkpoint).

C21 closes the controlled native Unix/public Window output lifecycle gate:
legitimate no-output mapping, conservative idle revocation/reconnect, retained
geometry, actual changed pixels and partial damage all pass against its fresh
installed package. Full typecheck, app workflows, native renderer checks and a
fresh QEMU/HVF automatic startup pass. This does not close physical hotplug or
hardware motion. C21 and all 23 earlier host images are preserved; the graphics
lease is released. See [C21 evidence](quality-review.md#candidate21-zero-output-checkpoint).

C21 also passes a scoped native UTM renderer-stall recovery: an actual installed
renderer stopped with SIGSTOP retires after synthetic native-window Escape,
authenticated cleanup restores tty1 text mode, and saved native pixels show the
full prior journal. This is a manually restarted managed stage after automatic
boot, not initial-stage or human physical Escape. The original collector's
collected-exit-field assertion remains failed; exact PID1 invocation history
confirms successful deactivation. See
[native stall evidence](quality-review.md#candidate21-native-renderer-stall-checkpoint).

## 1. Renderer correctness and GPU residency

- **Implemented and tested:** empty EGL clips no longer disable scissoring.
  The old native regression paints 769 ghost glyph pixels; the fixed 24-frame
  VirGL run matches fresh EGL and CPU.
- **Implemented and accepted for the reproduced symptom:** React placement now moves
  existing keyed nodes rather than duplicating them. Actual System Monitor RSS
  sorting and removal reproduce C9's four-cell ghosting before the fix. The
  fixed scene has unique nodes/layers/hits and matches a separately built root.
  All thirteen expanded phases pass. C10's actual System Monitor RSS reorder,
  app addition/removal and process removal remain clean in inspected QEMU
  captures and the live accelerated UTM desktop.
- **Implemented and verified natively:** replace app dma-buf CPU snapshots and texture uploads with
  renderer-owned immutable GPU snapshots. Compare holding producer buffers with
  a GPU copy; the latter preserves early release and bounded producer pools.
- **Tested:** real VirGL producer BO reuse/destruction, BGRA/alpha/XRGB,
  resident damage and resource cleanup. The measured resident production path
  performs two imports and GPU copies with zero CPU upload/copy/readback bytes.
  CPU sync cleanup, valid black GBM maps and lazy cached fallback tests pass.
- **Verified:** real producer reuse/destruction, owned lifetimes, actual UTM
  app GPU commits, live screenshot capture/crop/annotation/save/reopen, and
  QEMU's CPU/SHM fallback. Both guests shut down normally. Native hidden-window
  and resize interaction acceptance remains open.
- **Measured with limits:** native renderer identity and actual transfer
  boundaries; 72 idle/single/all-updating workloads across counts, areas,
  overlap and blur. Native production ownership records zero CPU copy/upload/
  readback bytes. Per-surface uninstrumented operations and GPU duration stay
  null. These isolated non-modesetting workloads do not establish overall
  acceleration, occlusion savings or presentation cadence.
- **Pending:** native movement/resize tearing and accelerated UTM acceptance.
  QEMU C10 uses llvmpipe. UTM C10 reports VirGL/ANGLE Metal, direct GBM scanout
  and page-flip readiness. CUA begins/ends a move but does not visibly deliver
  intermediate positions, so movement/tearing acceptance remains open.
- **Implemented for Candidate 13, native checks pending:** CPU/EGL readback
  alternates two dumb framebuffers without writing live scanout. Direct GBM
  selects only idle targets. Timed-out or failed flips quarantine possible
  owners until matching completion or a successful modeset; late completion
  requests a fresh scene. Portable backing-pixel and actual C callback ABI
  regressions pass. Unsupported flips use blocking SetCrtc with all vsync and
  hardware presentation flags false; this fallback has no tear-free guarantee.

Evidence: `vm/verification/2026-10-02-app-suite-candidate-8/` and the active
`vm/verification/2026-10-02-gpu-residency/` experiments and
`vm/verification/2026-10-02-gpu-residency-candidate-10/`.

## 2. Shared toolkit and approved app designs

The Files transfer-dialog concept was approved on 2026-10-03, with purple window
chrome and a slightly different background-tab colour. Its PNG SHA256 is
`dd99e0d6a368c231e02515d025d00dffcbbea330b3187930ef43f1f396b9abfa`.
Direct human-message provenance and the source-specific Files/widget reviews are
in `vm/verification/2026-10-03-transfer-design-plan/`. C28 retains its focus-fix
scope. The subsequent source wave implements the three transfer compositions,
actual conflict metadata and destination navigation, authoritative active/inactive
window borders, and selected/background tabs. Omit ETA and the remaining-conflict
checkbox until they have real semantics. Static CPU, virtual and reduced-motion
paths stay static; visual alignment and native workflow acceptance require a new
image and captures.

The verified references are Files v1, Notes v1 and Music v0 in
`~/Documents/Codex/2026-10-02/task-3/approved-design-references/`.
Their manifest records hashes and versions. Their pixels have been inspected;
their layouts are **not implemented or visually accepted** in C8.

| Reference pattern                                | Shared implementation                                                     | App adoption and proof                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Files navigation, sidebar, dense list, inspector | Adaptive split panes, intrinsic toolbars, list columns and anchored menus | Left-aligned titlebar tabs; real file operations and before/after native captures   |
| Notes notebook/list/document flow                | Adaptive multi-pane layout and document editor                            | Persisted selection formatting, reusable floating toolbar, selection and undo tests |
| Music album library, queue, playback bar         | Collection views and persistent media controls                            | Real playback/queue workflows and before/after native captures                      |
| Coherent chrome, typography and spacing          | Theme-aware shared widgets and intrinsic sizing                           | Migrate representative callers; preserve keyboard, themes and accessibility         |

All rows remain **unaccepted for native reference alignment**. Shared adaptive
panes, collection lists, playback controls, native client window chrome and a
rich document model/editor are in source. Files tab/list/large-directory/drop
workflows pass through actual headless Window dispatch. Notes selection
formatting survives save, close and reopen and differs from an independently
rendered plain note; notebook, pin, move, migration and conflict checks pass.
Music exercises local tagged/embedded-art imports and observed playback state;
Candidate 12's exact installed suite also exercises actual mpv decoding, IPC,
paused seeks, resume and EOF through null audio output. The shared symbolic
icon family has distinct app identities, namespace registration and normal-size
rendering checks. They are packaged in Candidate 12. Native Notes keyboard
formatting/save/process-relaunch persistence, Music tagged-file/artwork import
and the complete initial Music footer are verified in C12 captures. Files has
real populated rows, but native navigation remains open after a reproduced
desktop focus handoff bug. The Candidate 13 focus callback has actual shell and
Window routing tests; its native gate is pending. Replace routine app coordinates and
manual size calculations through shared flow and anchoring rules. Compare actual
captures with the references at multiple widths and themes before acceptance.

## 3. App workflow depth

**Implemented and packaged:** all 20 requested apps have functional core
workflows. C8 passes the installed ARM64 suite and 800 layout scenes. The real
Screenshot client captures, crops, annotates and saves a PNG that Image Viewer
opens. Details and limitations are in `docs/apps/suite.md` and per-app docs.

**Open native acceptance:** pointer, keyboard and clipboard device delivery;
audible Music, recorder input and native video output. Recorder has no PipeWire
source in the current guest. Document Viewer supports PDF, not Office documents.
The packaged C10 Notes remains plain text. Candidate 12 Notes preserves bold,
underline and highlight in its installed workflows; native bold/highlight save
and process-relaunch persistence are verified. Native guarded close, clipboard,
Files open-edit-save/preview and audible output remain open. C12 reports missing
audio output explicitly and adds no audio device or microphone permission.
Unsupported backends must remain explicit in the apps. Do not add credentials,
paid services or new system permissions without approval.

## 4. Boot and greeter, after renderer acceptance

### Required display-manager architecture

Josh clarified this requirement on 2026-10-03 in the `loop` conversation:
three top-level application processes are **splash**, **combined greeter and
display manager**, and **the selected user session**. Each Moire UI uses its own
React environment. The selected session may be Moire or another installed
desktop. The current welcome runs inside an automatically started user session;
it is a prototype and does **not** satisfy the display-manager requirement.

The combined greeter/DM must authenticate before creating the selected user
session, discover installed desktop sessions, handle authentication and launch
failures, clean up session resources, and return to the greeter on logout or
session exit. Follow applicable freedesktop specifications and established
display-manager conventions; distinguish published standards from conventions.
Document supported Wayland/X11 session types, descriptor parsing and Exec
semantics, privileged helpers, and interoperability tests. Architecture and code
preparation are authorized. Activating PAM, account, login-security or additional
permission changes requires specific approval and is not part of current VM
acceptance. Installing other desktops is also outside current authorization.

The [saved human requirements](../vm/verification/2026-10-03-transfer-design-plan/display-manager-human-provenance.json)
were read directly from `loop` before recording this plan. The architecture
investigation is in [Display-manager design](display-manager-design.md).

- **Implemented with bounded native evidence:** own-React welcome v2, shared
  immutable backdrop and BrandMark. C15 verifies native UTM Start into the
  desktop; C20/C21 inspect the QEMU welcome. Approved-reference fidelity across
  widths/themes and hardware motion remain unaccepted.
- **Implemented and tested in stage 2:** automatic selected Silk Fold E React
  frame, main-only READY and verified text release before desktop admission.
  C20/C21 prove accepted scanout; the brief automatic artwork pixels are not
  captured. C19 verifies healthy synthetic native-window Escape; C21 additionally
  restores the native journal after an actual SIGSTOP renderer stall in a
  manually restarted managed stage. Initial automatic-stage and human physical Escape,
  plus initrd integration, remain open. No artificial display hold is added.
- **Pending hardware motion:** positive execution capability, actual retained
  per-window rendering facts and authoritative GPU opacity/visibility. EGL or
  virtual renderer names do not qualify. Persisted reduced motion is tested;
  CPU/virtual/unknown execution remains static and hidden presentation pauses.
- **Measured with limits:** bounded artwork and standalone package costs are
  recorded in boot documentation. Early initrd capability, cost and recovery
  still need their own measurements. No host-login, account or permission
  changes are authorized.

Use Moire React, its custom reconciler and widgets for all presentation. Keep
each gate open until implementation and artifact evidence are recorded here.

## C13/C14 checkpoint and C15 source integration

- **C13 native bounded pass:** actual Files PNG preview/open into Image Viewer;
  Editor save and fresh-process display of the saved file. CUA close clicks
  produced no guest pointer EV_KEY edges, so guarded Files→Editor reopen and
  native desktop focus acceptance remain open.
- **C14 native bounded pass:** the original installed KMS oracle passes on
  QEMU/HVF, including backing-pixel ownership, retired reuse, durable modeset
  handoff and repeated close. Raw sequence remains zero; vsync and hardware
  clock/completion flags remain false. The oracle is not physical tear-free proof.
- **C14 blocker:** a fresh UTM attempt stayed black and serial-silent. Bounded
  diagnostics did not identify its cause; only that disposable launcher was
  terminated. No host reboot, login or security change was made.
- **C15 source:** own React welcome v2, shared bounded Silk backdrop and licensed
  serif BrandMark, real D-Bus shell handoff, fullscreen geometry and Files launch
  feedback. Existing authorized-session fallback continues on welcome close or
  failure. Source tests cover actual Window and child/D-Bus behavior; native
  image and end-to-end acceptance are separate.
- **Boot source:** one 1280×800 own-React PNG, 792253 compressed/4096000 decoded
  bytes, parsed/scaled by actual pinned Plymouth. Headless native PNG load is
  approximately 15 ms, excluding boot/display. Escape is daemon-owned; serial
  printk suppression in upstream details is removed to retain recovery output.
  Native Escape, real logs during failure/stall, serial output, startup cost and
  DRM ownership handoff remain pending until the frozen image boots.
- **Explicitly unfinished:** running Moire React early-boot root and Silk Fold
  animation (Plymouth script owns the static fallback runtime), production
  hardware/visibility-gated ambient motion,
  audible playback/recorder input, full native acceptance of all 20 apps, physical
  movement/resize tearing and complete reference alignment. Source production
  welcome and early boot use static artwork. No additional system permissions,
  security changes, credentials or paid services are authorized.

The earlier checkpoint rows describe their named immutable images. This section
supersedes stale “C13 pending” and “greeter source pending” statements; it does
not turn source checks into native acceptance. All host fallback images are
preserved.

## C15 native checkpoint and next source wave

- C15 build/provenance, installed app suite and 800-scene gallery pass. QEMU/HVF
  KMS ownership tests pass with hardware presentation timing still unverified.
- Native UTM welcome Start reaches the desktop before and after a normal guest
  reboot. Reduced-motion checked state and Escape popover dismissal have saved
  captures. These checks do not accept boot Escape or physical movement tearing.
- Postboot actual Plymouth renders the theme. Escape removes art but stays black
  until quit restores real text. The test has no attached live boot buffer;
  initial-boot behavior remains open. Serial is independently responsive.
- Next source wave owns a bounded curved Silk refinement, authoritative surface
  visibility policy and a narrow running React boot root with a separate console
  guardian. Input must be armed before graphics; actual child exit must precede
  console restoration. Native TERM/KILL/stall console pixels/logs and initrd
  closure/cost checks are required before enabling the new runtime.
- No account, authentication, permissions, credentials or paid services changed.

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

## Candidate18 acceptance update

C18 preserves all twenty earlier host images and passes the installed 800-frame
app suite, native memfd SHM checks and actual public Window opacity/EOF workflows.
Its exact compiled boot stage also restores the complete tty1 journal after
guardian SIGKILL and renderer SIGSTOP followed by guardian SIGKILL.
See [the Candidate18 checkpoint](quality-review.md#candidate18-native-checkpoint)
for paths, hashes, observed timings and limits.

At the C18 checkpoint, boot activation remained manual. Two real failures blocked automatic handoff: systemd
can run cleanup before a surviving descendant exits, and collection of a healthy
inactive unit clears the manager InvocationID that C18 requires. The next image
needs verified cgroup lifetime/termination ordering, a protected attempt record,
authenticated historical release after collection, and a mandatory check before
every desktop start. Test these through real disposable systemd units and the
installed compiled commands, including missing release and recreated-root cases.
Also fix the actual renderer IPC disconnect shutdown error. Physical Escape,
initrd integration, output-loss authority and hardware timing remain open.

## Candidate19 acceptance update

C19 passes strict full/compiled provenance with no cache exception, the installed
app suite and 800-frame/69-PNG gallery, and native renderer checks. Seven actual
builder systemd graphs accept the protected attempt ledger and mandatory gate,
including genuine healthy GC and automatic restart rejection. The actual guest's
systemd 260.4 verifies delivered units, starts the initial session, restores the
complete tty1 journal after runtime-capped stopped-renderer/guardian-crash cleanup,
and blocks both direct start and automatic restart with missing release evidence.
Restoring the authenticated original record permits normal startup.
See [the C19 checkpoint](quality-review.md#candidate19-native-checkpoint) for
exact hashes, timings and the retained-ID versus collected-ID distinction.

The C19 next-wave requirements were isolated output-loss/public Window evidence,
native-window Escape and deliberate initial React startup. C20/C21 now meet the
controlled output and automatic stage-2 requirements through separate manager
transactions, actual readiness, bounded startup and verified stop/handoff.
They do not enable mutually conflicting boot/session starts in one target.

## Current C20/C21 acceptance and remaining priorities

C20 supplies two automatic native boots and nine real manager/console-policy
graphs. C21 additionally supplies actual Unix/public Window zero-output mapping,
idle revocation, geometry retention and fresh changed-content acceptance.
Both accept healthy collected manager identity through authenticated historical
proof. C19 supplies synthetic native UTM Escape. Preserve their distinct scopes;
none accepts initrd, physical hotplug or hardware motion.

The remaining user-facing gates are:

- Initial automatic-stage Escape during its short lifetime, and stalled-renderer
  Escape with actual console restoration; keep serial recovery independent.
- Verified retained hardware motion with authoritative GPU visibility and
  persisted reduced-motion policy. CPU, virtual and unknown execution stay static.
- Files native transfer cancellation, collision choices, partial recovery and
  retry; tags after copy/move/Trash/Restore; sorting, selection and connected
  inspector state. Existing installed/headless workflows pass but do not close
  the complete native interaction gate.
- Approved Files/Notes/Music reference comparison at small/wide sizes and
  light/dark themes, including persistent pane state, ordinary keyboard/pointer
  workflows and greeter v2 fidelity. Existing bounded captures are retained;
  whole-suite visual acceptance remains open.
- Shared icon identities and legibility at ordinary display sizes across themes.
  Existing rendering tests are evidence, not final live visual approval.
- Physical window movement/resize tearing, audible Music, microphone recording,
  native video presentation and remaining physical clipboard/input workflows.

No credentials, paid services or additional security/system permissions are
authorized. Root coordinates every graphics guest with recovery and preserves
fallback images. Exact build/run commands and current evidence are in
[the VM guide](nixos-vm.md) and [C21 review](quality-review.md#candidate21-zero-output-checkpoint).

## Candidate 31 input checkpoint

The original session now survives native Files Ctrl+A/C and Terminal PTY
Ctrl+C. A real menu Paste completes a 24-file, 192 MiB copy with exact source
and destination hashes; Terminal displays interrupt status 130. Actual
installed compositor death releases its exclusive keyboard descriptor in
148 ms. QEMU/HVF boot, managed handoff and normal shutdown pass.

Keep the failed rounded-surface visibility gate, rapid text entry, Ctrl+V and
held-key restart attempts visible. Native key release permits a new manual
session; automatic recovery is not accepted. C32 owns the rounded visibility
repair and Editor, Archive, Screenshot, Calculator and Weather regressions.
It needs fresh installed and native verification. See the
[C31 checkpoint](quality-review.md#candidate-31-installed-and-native-input-checkpoint)
for exact evidence and remaining limits.

## Candidate 33 checkpoint

All five exact installed gates and QEMU/HVF automatic boot/shutdown pass.
Native software UTM verifies Screenshot capture, explicit 640×400 crop,
Close Cancel, Overwrite Cancel, Save → Replace → Close teardown, and Files PNG
activation plus Image Viewer rotation. First-map Screenshot geometry stays
above the panel; the original session keeps zero restarts.

Native drag cropping remains a recorded failure. Trace the existing evdev
owner, compositor coordinates and public Window events together; an independent
read-only descriptor saw no events and cannot attribute the failure. Native
annotation, rapid input, physical tearing, audio/video presentation and live
recorder capture remain separate gates. The VM is stopped, the graphics lease
released, and all 36 images preserved. See [the C33 review](quality-review.md#candidate-33-installed-and-native-results)
and [daily-use sequence](daily-use-plan.md).
