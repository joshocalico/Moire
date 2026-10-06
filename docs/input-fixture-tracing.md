# Disposable Screenshot input tracing

Input tracing is off by default. It observes the compositor's existing input
readers, filtering and routing, decoded Wayland delivery, and Screenshot's
actual save-path and crop callbacks. It does not open another input reader or
change input ownership. This diagnostic is separate from acceptance of native
typing, crop/save workflows or physical tearing.

Build a fresh immutable candidate and boot it with the existing helpers:

```sh
./scripts/build-vm-in-parallels.sh moire-aarch64-quality-40.iso
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-40.iso
```

The build helper requires the existing ARM64 Linux Nix builder. The boot helper
selects HVF on Apple Silicon. Use an unused image filename; the helper refuses
to replace a fallback. Disposable overlays and QMP automation remain separate
work.

## Prepare one fixture

Before starting the session, choose a fresh lowercase UUID and set
`MOIRE_INPUT_FIXTURE_TRACE` to its future path:

```text
/tmp/moire-input-fixture-<UUID>/manifest.json
```

Leave the directory absent until the real Screenshot process is launched and
focused. Manifest version 2 requires both processes' exact PID/start time,
UID, canonical working directory and canonical entry point, plus the boot ID
and declared input-device identities. The compositor
checks the focused Wayland peer PID and app ID before recording input. Another
client, an unexpected key/button, process change or keyboard focus loss ends
the observer. Input dispatch continues normally.

As the existing session user, declare those independently observed identities
in a private JSON file and arm with the matching repository preparer:

```sh
node scripts/prepare-input-fixture.mjs \
  --manifest "$MOIRE_INPUT_FIXTURE_TRACE" --spec /path/to/private-declaration.json
```

The script is a repository tool, outside the packaged runtime. If copying it
into a disposable guest for verification, bind its bytes to the candidate's
frozen source. Copy its shared
`packages/sys/src/input-fixture-process-identity.mjs` dependency too, preserving
the repository-relative layout. The preparer validates actual Linux metadata, creates a private
directory and publishes a complete manifest without replacing an existing
file. The runtime waits for staging-link cleanup before arming. A helper error
after publication does not prove that no observer armed; preserve the attempt
and inspect its records.

Declare the working directory observed in `/proc/<pid>/cwd`, including Home
when the installed compositor inherits it. Declare the separate absolute
entry point from the pinned package: `apps/system/compositor/src/main.ts` for
the compositor and `apps/bundled/screenshot/src/main.tsx` for Screenshot. Both
entry points must belong to the same source tree. Their paths must be canonical.
The observer reads a bounded Node command line and checks its executed script
slot after recognized loader options; relative Screenshot scripts resolve
against its exact working directory. A role path appearing only in a loader,
document argument or eval source cannot identify that process. Live snapshots
repeat these checks; metadata failures end diagnostics while input continues.

Both processes use the manifest's monotonic timestamp and stop after 90
seconds. Compositor details are capped at 1,024 per layer; the app shares one
512-detail budget across platform and app callbacks. Reserved overflow/end
records retain aggregate counts. A broken sink disables diagnostics and
attempts an error summary without interrupting delivery.

Only synthetic fixture input is permitted. For the keys scenario, the actual
field value may be `/tmp/c36-trace.png` or an ordered subsequence of it, allowing
dropped characters to be measured. Records contain length/hash and an exact
match flag. Default paths, unrelated text and clipboard contents are never
hashed or recorded. The pointer scenario admits numeric geometry and left
button events; it does not admit typing.

The private outputs are `compositor.jsonl` and `app.jsonl`. Each has run/boot
identity, a process sequence and monotonic time. Reader-to-router ordinals use
diagnostic WeakMaps and preserve production event objects. Aggregated pointer
motion links to the last contributing record of its component. App hit events
are separate objects, so their ordering is correlated by recorded time and
sequence rather than a fabricated cross-process ordinal. Existing client
`timeMs` fields retain their original clock and must not be compared as one
clock; use the explicit `monoNs` basis for correlation.

Keyboard read-boundary observations count each bounded batch before dispatch,
including carried/trailing bytes, permitted key edges, sync records and other
record counts. They never record unrelated key edges, scancode payloads or
arbitrary error messages. Raw-key records link to their batch ordinal; the
existing production event objects and reader-to-router links remain unchanged.
Finite error/reopen observations distinguish a read failure from framing or
dispatch failure. These diagnostics use the existing reader and retain its
current behavior; they do not repair, retry or reorder input on their own.

The native controller must use a fresh readback of the guest's remaining
monotonic budget, subtract the entire host query interval and a safety reserve,
and cap the experiment at a shorter local deadline. A later readback may only
shorten that deadline. Refuse an action if it cannot fit before expiry. The
runtime's 90-second recording limit does not cancel an already-running host
tool call. Capture and focus the empty fixture field before arming, and collect
bounded compositor logs from the exact boot/session invocation as well as its
actual PID before normal shutdown.

## Verification

```sh
node scripts/prepare-input-fixture.smoke.mjs
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs \
  packages/sys/src/input-fixture-trace.smoke.ts
bash scripts/test-app-suite.sh
```

The focused tests cover caps, expiry, scope rejection before payload output,
partial input records, duplicate filtering, unchanged event/wire forwarding,
focus retirement and public Screenshot editing/crop workflows. The whole-path
regression decodes the fixed filename's 18 actual evdev key codes
through Moire's keyboard decoder and admits all 36 down/up events through the
real diagnostic policy. It verifies every cumulative field value too.
A separate Linux metadata harness exercises the actual factory with disposable inert
processes and real device metadata, without reading devices. These controls
do not substitute for a traced native action.

The new read-boundary workstream is under
`vm/verification/2026-10-04-c40-input-read-boundary/`; its current receipts
distinguish source work, build gates and native acceptance. C39's sealed review
is under `vm/verification/2026-10-04-c39-input-trace-path/`. C39 passed host,
installed delta, build and normal native boot checks. Screenshot captured the
display, but complete filename entry failed. All 60 observed raw edges reached
the app unchanged, and all 27 field changes matched the delivered keys. The
raw hook follows reading/framing, so those observations cannot assign loss
solely to UTM. Save/crop and physical tearing remain unaccepted. A paced attempt
continued after expiry and is explicitly excluded from traced acceptance.

C38 passed build, provenance,
host and installed checks but was never booted: review found its diagnostic
key policy omitted `g` from the fixed filename. Its image, source snapshot,
original failures and passing controls remain preserved under
`vm/verification/2026-10-04-c38-input-trace-identity/`.
C37's unarmed native
blocker is documented in `docs/c37-input-trace-review.md`; its version-1 source,
image and receipts remain preserved. C35/C36 and their existing review
seals remain preserved. Coordinate every VM, serial and native-control run
with Recovery; the integration owner holds the sole testing lease.
