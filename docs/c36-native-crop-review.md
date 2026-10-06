# C36 native capture, crop and typing follow-up

The unchanged C36 image reached its Moire session and launched Screenshot
through Apps. Primary display capture succeeded at 1280 × 800. Native crop/save
acceptance is blocked by input delivery: a complete path became `6rn`, and an
isolated drag was rejected as zero-area. No new runtime fix or image is claimed.

Boot the preserved checkpoint:

```sh
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-36.iso
```

Build a future candidate under a new name:

```sh
./scripts/build-vm-in-parallels.sh moire-aarch64-next.iso
```

The native test used the existing **Moire Quality 36 Software** UTM VM.
Root held the graphics, native-control and serial lease while Recovery held
all VM actions. Boot ID was `2952bd24-1acc-40d0-975e-b6cbeaed0ee4`; the installed
package was `/nix/store/qw2kn2xsm219xwn39jp1kzd3426c08pv-moire-0.0.0`.
The normal tty1 unit stayed active/running with MainPID 839 and zero restarts.
Compositor PID 3413 and Screenshot PID 3898 remained alive at the final check.
No diagnostic service override or second input reader was used.

## Observed native results

| Workflow | Result and limit |
| --- | --- |
| Apps → Screenshot → Capture | Actual preview and status reported primary display capture, 1280 × 800. |
| Save-path entry | One capture-off native `typeText` call requested `/home/moire/c36-native-crop/original.png`. The focused footer settled at `6rn`; Save reported a missing `.png` extension and retained the unsaved image. |
| Captured keyboard diagnostic | A separate `/tmp/c36-base.png` burst and explicit editing keys produced no visible edit. Raw key delivery, modifier state and app-local receipt were not traced, so the cause remains unassigned. |
| First drag | A launcher popup contaminated the attempt. It is excluded from isolated crop acceptance. |
| Isolated reverse drag | The popup was absent and the guest cursor was visibly inside the image before the action. The host drag requested (1700,1115) → (875,600) in the 2560 × 1676 native capture. Screenshot reported `Drag a crop region with a positive width and height`; its footer remained 1280 × 800. The guest cursor did not visibly follow the full host drag. |
| Saved PNG and clipboard | Neither requested baseline PNG existed. Exact saved-pixel crop verification and Editor clipboard/save/reopen workflows were not executed. |

The existing release-endpoint and nonpositive-area crop fixes are present in
C36. This attempt demonstrated rejection without reducing the source to 1 × 1.
It does not identify which host, evdev, compositor, Wayland or client boundary
failed to deliver the complete gesture. Historical C32/C33 failures and the
successful C36 capture-off notification wheel cohort remain separate evidence.

## Delivered-event controls and next investigation

Two source audits found no existing complete keyboard delivery trace.
The public Window/TextField preserved complete path bursts with no intermediate
ticks. A new reusable test additionally passed four direct/retained CPU cases
at scales 1 and 1.5, covering cumulative edits, submit, selection, delete and
external controlled replacement. UI typecheck, lint and formatting passed.
These controls do not establish native UTM key delivery. Production TextField
remains unchanged; the control is registered in the app-suite runner.

Run the control:

```sh
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs \
  packages/ui/src/text-field-batched.smoke.tsx
```

The next diagnostic should correlate a bounded private-fixture sequence on the
compositor-owned input FD, accepted/routed event counts and decoded client
receipt. Existing scroll tracing excludes button edges and keyboard events.
A concurrent plain reader under an input grab cannot prove absence. Do not
assign overflow, stale modifiers, focus or field reconciliation without that
evidence. Physical tearing also remains unqualified.

## Preservation and evidence

Evidence is in `vm/verification/2026-10-04-c36-native-crop`: seven native JPEGs,
native action records, twelve exported guest artifacts with checked lengths
and SHA-256 hashes, independent source reviews and delivered-event controls.
The early process search incorrectly looked for an absolute Screenshot command;
the real process uses relative `src/main.tsx`. Its `/proc/3898/cwd` establishes
the installed Screenshot directory. The failed search is retained.

Normal guest poweroff completed; the serial bridge exited 0, native UTM showed
Stopped with Capture Input 0, and no host QEMU process remained. Shutdown logged
busy live-media loop mounts before `Power down`; it did not remain running.
Both preservation checks matched all 919 recorded source/document files and
all 44 read-only image copies, including C35/C36 and earlier fallbacks.
The new test/control registration and these result documents were added
after that final check and are recorded separately. Original native seals are
preserved. No paid service, credential, permission or security change was made.
