# Committed GPU contents

Moire previously mapped each committed app dma-buf to CPU pixels and uploaded
those pixels again for retained composition. The renderer now imports supported
single-plane ARGB8888/XRGB8888 buffers and copies them into immutable textures
owned by the compositor. App logic and the reconciler remain JavaScript.

Two ownership designs were considered. Holding the producer buffer through
future retained redraws avoids a GPU copy, but requires a new buffer lease,
release scheduling and teardown contract. An owned GPU snapshot completes with
`glFinish` during commit. The existing early `wl_buffer.release` stays safe,
producer pools remain bounded and later redraws use independent contents.
The chosen first pass pays one GPU copy and a completion wait per changed app
buffer. Explicit fences and direct client scanout remain separate work.

The renderer's weak map associates backend-neutral `OwnedPixelSurface` objects
with native textures. Retained layers preserve that object identity and sample
the texture directly. Visibility and input gates check content presence rather
than pixels. Replacing, unmapping or destroying a surface destroys its snapshot;
session shutdown destroys snapshots before the EGL context. Destroying the
producer's wl_buffer or exported fd does not invalidate an owned snapshot.

CPU/SHM commits retain their CPU path. If GPU import is unsupported or fails,
commit uses GBM import/map or a LINEAR dma-buf mmap fallback. GPU-owned contents
have a lazy, cached BGRA getter for CPU composition, cursor and diagnostic
consumers. Ordinary retained composition does not access that getter. A lost GPU
context cannot promise recovery of unread old snapshots; later commits must
provide fresh contents. Unsupported buffer flags and multi-plane formats use
the fallback path. No new permission or service is introduced.

Imports honour plane offsets, stride and modifiers. Raw CPU mmap is restricted
to explicitly LINEAR buffers. CPU START/END synchronization brackets the actual
copy. Black and transparent pixels are valid and no longer treated as failed
readbacks. EGL sampling is normalized once into the retained renderer's BGRA
channel convention; XRGB forces alpha to one. File descriptors remain caller
owned under the [Khronos dma-buf import contract](https://registry.khronos.org/EGL/extensions/EXT/EGL_EXT_image_dma_buf_import.txt).

## Verification and measurements

```bash
./scripts/test-renderer.sh
MOIRE_RENDER_NODE=/dev/dri/renderD128 MOIRE_EGL_CAPABILITY_NODE=/dev/dri/renderD128 ./scripts/test-renderer.sh
MOIRE_RENDER_NODE=/dev/dri/renderD128 \
  node_modules/.bin/tsx packages/sys/src/egl-residency-benchmark.ts
```

The first command runs CPU checks on macOS. Linux also runs actual EGL/GBM
tests. Load the installed package's `moire-session` wrapper environment when
testing a Nix package. Set `MOIRE_TEST_ROOT` to its `lib/moire` directory.
Choose a DRM node that supports exportable GBM buffers; a software render node
may reject allocations.

The native test overwrites and destroys a real producer BO before reading old
snapshots. It checks non-square BGRA, alpha, XRGB, cached damage, state restoration
and cleanup. An injected adapter test separately checks lazy CPU fallback. The
24-frame EGL oracle compares retained updates with fresh EGL and CPU images.
Its empty-clip regression failed on the previous renderer with 769 ghost glyph
pixels; the fixed VirGL run matches both oracles. This proves the clipping defect,
while C9 still showed the original live System Monitor symptom. A separate
regression then reproduced the app's actual timed RSS sorting: React placement
duplicated keyed host scene nodes and all four cell layers. Removing the process
left two ghost rows. Comparing with an independently constructed React root
exposed 740 to 1398 incorrect pixels; the earlier fresh-renderer comparison used
the same corrupted root and missed this. Placement now detaches a child before
moving it. The new regression checks unique node/layer identities, row hits,
order, removal and independent root pixels. All thirteen expanded phases pass.
C10's installed ARM64 tests and live QEMU app pass. The inspected native
captures show RSS row movement, Calculator addition/removal and Image Viewer
removal without duplicate text. The accelerated UTM desktop also remains clean
through hundreds of timed updates.

Set `MOIRE_GPU_METRICS=1` to collect actual imports, GPU copies, texture uploads,
CPU copies, readbacks and `glFinish` elapsed waits. GPU execution time is unknown
without a GPU timer query. A completion wait is elapsed CPU-side call time,
not measured GPU duration or process CPU consumption. Per-surface records at
client teardown distinguish CPU and GPU storage; uninstrumented work stays null.

The benchmark uses real exported producer BOs and GPU output publication. It
does not modeset or claim KMS presentation. It compares one, four and twelve
idle, single-updating and all-updating windows. Producer work, snapshots and
consumer composition are measured separately. Use `MOIRE_BENCH_ITERATIONS=2`
for a quick check, `MOIRE_BENCH_WINDOW=640x400` for larger windows,
`MOIRE_BENCH_OVERLAP=0` for tiled layouts and `MOIRE_BENCH_BLUR=1` for blur.
It reports when twelve large windows cannot fit without overlap. Occlusion
savings and actual presentation cadence are not measured by this script.

Evidence: `vm/verification/2026-10-02-gpu-residency/`. The builder reports
`virgl (Apple M1 Max (Compat))`, Mesa 26.1.8. The QEMU/HVF fallback image uses
llvmpipe; those results must remain separate.

C10 evidence is in `vm/verification/2026-10-02-gpu-residency-candidate-10/`.
UTM reports VirGL through ANGLE/Metal on Apple M1 Max. Direct GBM scanout is
selected and KMS page-flips become ready. Actual Image Viewer commits record
dma-buf transport and compositor GPU storage. Those per-surface records leave
uninstrumented operation fields null. The separate `utm-resident.log` records
two real imports and GPU copies, with zero CPU copy, texture upload and GPU
readback bytes during production composition. A live desktop capture then
crops, annotates, saves and reopens a PNG in Image Viewer. The copied PNGs were
inspected. Screenshot readback is intentional and is outside that zero-transfer
production phase.

The 72 C9 benchmark workloads pass their transfer assertions. For twelve
updating 640x400 windows over twenty iterations, resident ownership removes
245.76 MB of CPU copying and the same texture-upload volume. Consumer elapsed
composition is 91.28 ms for CPU snapshots and 24.69 ms for GPU snapshots in that
run. This is a synthetic isolated comparison, not an overall FPS or acceleration
claim. Total process CPU and wall time do not establish an overall speedup.

Native movement and tearing acceptance remain open. UTM computer-use gestures
start and end a native move, but do not visibly deliver intermediate positions
to the guest window. No tear-free conclusion follows from stationary captures.
Both C10 guests powered off normally; root released the graphics testing lease.

## Rendering authority and motion qualification

The private surface-state protocol version 2 associates a nonzero submission
token with the immediately following surface commit. The compositor reports
rendering facts only for that commit's exact content and output generation.
A missing or failed buffer attachment can leave the last good pixels visible,
but revokes rendering authority until a valid new buffer snapshot arrives.
An idle commit cannot turn those old pixels into an accepted new submission.
Version 1 clients retain their existing visibility behavior.

The client exports XRGB only when the actual submitted scene proves full opaque
coverage. Other scenes use ARGB. Each client channel has at most three live
targets across current and retired geometries. Held targets cause backpressure;
release destroys retired native targets and their cached Wayland buffers.

Current EGL facts identify software, virtual or unknown execution. A virtual
transport can have host hardware backing, as the earlier VirGL/ANGLE/Metal
evidence shows. That alone does not bind a particular accepted frame to a
qualified hardware output. Renderer names, vendor strings and successful GBM
allocation cannot grant the hardware-retained motion state.

The missing adapter must bind the actual EGL context and device to its output,
track context/output loss, and establish retained GPU composition for the exact
visible accepted submission without production CPU copying or readback. It also
needs native presentation and animation timing evidence. The current adapter
does not establish those facts, so production ambient motion remains static.
Reduced motion, hidden or unknown visibility, fallback and context loss also
pause or demote the backdrop. Hidden motion retains its last phase without
advancing. Unknown visibility, fallback and context loss reset canonical
geometry. No user override bypasses this qualification.

Candidate 22 tests exercise the real submission/acceptance boundary, stale and
repeated tokens, shared presenter loss, failed attachments, pool retirement and
persisted reduced motion. Its render-node test separately checks actual EGL/GBM
opacity formats, held target ownership and idle transfer counters. It does not
modeset a card or establish physical tearing, hardware timing or animation.

## Import descriptor ownership and the motion gate

A separate GBM import device needs a separate DRM open-file description. `dup`
or SCM_RIGHTS of the DRM device descriptor shares its per-file GEM state.
`GbmDevice.openForImport` now opens render nodes independently, then ordinarily
reopens the live KMS device through `/proc/self/fd/<fd>` if those attempts fail.
Construction transfers ownership only after success; failed construction closes
that opened descriptor. Total failure throws into the existing unavailable
import path. It never borrows the EGL/KMS descriptor. Access checks remain in
place, and no DRM authentication, master or permission changes are requested.
Destroy is terminal and idempotent, including after numeric descriptor reuse.

Native successor probes exercise the actual selection helper with only render
candidate opens rejected at the typed boundary. Existing builder renderD128 and
primary card1 both pass same-device reopen, strict raw/canonical colour and
format/size transitions, import retirement, producer survival and double-destroy
with actual descriptor reuse. This driver does not expose drm-client-id in
fdinfo: fresh file identity follows ordinary-open semantics and the lifetime
oracle, rather than a queried client ID. These non-modesetting probes do not
prove physical render-node removal or every driver's primary-node mapping.

The preserved C24 positive diagnostic exposed a scheduling problem. Its real
Greeter and Window produced 25 accepted diagnostic submissions, 49 authority
callbacks and 48 component reconciliations. Pending submissions revoked
authority, and Greeter's redraw subscription turned each pause and resume into
another component commit. The C24 strict diagnostic failed intentionally. It
did not prove pixel flicker or frozen animation. Its source and negative receipts
remain in `vm/verification/2026-10-03-greeter-motion-diagnostic/` and the C25
evidence directory below.

### Per-window retained motion admission

C25 adds `Window.getRetainedMotionAdmission()`. This stable capability registers
presentation participants, but cannot qualify rendering or advance another
window. Window owns the controller and supplies actual submitted tokens,
rendering state, compositor frame opportunities, visibility and teardown.
Gated oscillations leave the legacy global motion registry. Existing software
UI animations retain their separate path.

Greeter passes this capability to Backdrop instead of reconciling on every
rendering-state transition. Before a new native presentation attempt, the
controller pauses its participants and retains their phase. Pending submissions
still revoke public rendering authority. Matching qualified acceptance and a
frame opportunity for the current token resume paint-only motion. Either event
may arrive first. A zero-delta wake does not consume the opportunity, and native
backpressure waits for an actual transport retry. A scheduling wake alone does
not mark the scene dirty, so a queued wake followed by hiding cannot publish an
extra frame. Actual loss, uncertain visibility and reduced motion remain
conservative. Closing a window retires only its own participants.

The strict actual Window and Greeter diagnostic now passes 300 accepted frames
with 300 attempted presentations, one additional component reconciliation after
initial publication and at most one pending frame. It records 300 distinct
retained image positions and 300 distinct nonuniform CPU raster hashes. First
and last captures were inspected. Tests also
cover stale context, output, token and scene evidence, both callback orders,
pending idle ticks, transport backpressure, queued hidden wakes, reduced motion,
loss, replacement owners and teardown. Two actual Window instances verify that
pending, hidden, lost or closed participants in one window do not advance,
pause or consume the other window's accepted opportunity.

Source is in `packages/ui/src/retained-motion-admission.ts`, `motion.ts`,
`window.ts`, `backdrop/backdrop.tsx` and `apps/system/greeter/src/`. Rerun the
focused checks with:

```bash
pnpm exec tsx packages/ui/src/retained-motion-admission.smoke.ts
MOIRE_GREETER_REQUIRE_SUSTAINED_MOTION=1 \
  pnpm exec tsx apps/system/greeter/src/motion.smoke.tsx
```

Evidence, source hashes, the preserved C24 failure and inspected CPU captures
are in `vm/verification/2026-10-03-greeter-motion-admission/`. The positive
adapter uses explicitly owned diagnostic context and output generations. It
does not qualify a physical device, execute native GPU motion or prove a frame
budget or tear-free output. Production still lacks the hardware qualification
adapter and remains static. This is C25 source evidence, not a claim that a C25
image has been built or installed.

### Failed import retention and recovery

C25 removes the CPU fallback's fabricated black frame when readback is
unavailable. A successful all-zero readback remains valid. GBM and linear mmap
readbacks stage fresh bytes before committing them into reusable last-good
storage. Surfaced read or cleanup exceptions therefore leave the previous
snapshot's bytes intact. The resident EGL snapshot path is unchanged. The CPU
fallback pays temporary snapshot storage and a copy when reusing old storage.

A rejected attachment retains last-good content, revision and committed
dimensions. Attachment no longer changes dimensions before snapshot success.
The failed source stays uncertified with token zero, including later idle
commits, until a valid attachment recovers it. Rejected commit presentation
feedback is discarded immediately. Previously composited feedback awaiting
output completion survives. Buffer release and frame callbacks remain separate:
an unmapped first rejection releases its buffer immediately without fabricating
a frame callback. A mapped last-good surface retains normal completion release
ordering. Pending callbacks can complete after a later valid attachment.

`packages/core/src/dmabuf-map.smoke.ts` checks staged bytes, offset and padded
rows, valid black pixels, unsupported modifiers and injected read, END, unmap
and GBM exceptions. The actual Linux Unix/SCM_RIGHTS fixture in
`dmabuf-failure.native.smoke.ts` uses production ClientSession handlers and
memfd/SHM storage. It rejects an 8×2 buffer after a valid 4×4 snapshot, checks
pending and failed geometry, sticky token zero, exact descriptor retirement,
single release, presentation discard and valid recovery.

The final Linux preflight has normal exits: old mapper and server exit 1 for
fabricated mapped black, new mapper with old server exits 1 for missing first
buffer release, and both new components exit 0. Logs and exact staged source
hashes are in
`vm/verification/2026-10-03-app-suite-candidate-25/import-preflight/final/`.
This runs staged source against the existing installed C24 package environment,
not an installed C25 image. The unsupported-modifier memfd is a deliberate
transport rejection fixture, not a native DMA allocation. The test explicitly
invokes `finishSurfaceFrame`; it does not prove output scheduling, scanout,
accepted presentation or hardware execution.

Native syscall failures remain a limitation. `dmaBufSync` ignores the raw
`ioctlUint64` return code, and `packages/sys/src/libc.ts` ignores the `munmap`
return code. Injected throwing END and unmap failures prove staged byte
retention, but an actual syscall returning -1 is not surfaced by those wrappers.
The source must not be described as proving successful native synchronization
or cleanup in that case. Unsupported SYNC behavior also requires an explicit
compatibility policy before tightening that boundary.

Qualification still needs a reviewed adapter binding actual EGLDisplay/context,
EGLDevice/DRM device, client and compositor source/commit generation, output
connector/CRTC generation and actual accepted presentation. A host ANGLE/Metal
route needs evidence from its owning host context, tied to guest resources;
VirGL strings and UTM graphics toggles cannot provide it. Transfer counters and
CPU glFinish elapsed time are separate from GPU execution/physical display
measurements. Loss, fallback, readback, hidden visibility, reduced motion and
teardown must revoke qualification. The sustained diagnostic app-loop gate now
passes. Native qualified motion, frame-budget and tear-free evidence remain
unfinished.
