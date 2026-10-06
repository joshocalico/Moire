# C37 bounded input trace: pre-arm blocker

C37 builds and boots automatically into Moire under the existing ARM64/HVF software UTM configuration. The input trace was **never armed**. Its manifest and private output directory remained absent. This cohort provides no acceptance evidence for saved Screenshot pixels, cropping, clipboard workflows, lost keystrokes, or physical tearing.

## What blocked the trace

The native compositor has a canonical working directory of `/home/moire`. This matches the installed session contract: `nix/moire-vm.nix` sets the session working directory, and the compositor wrapper passes its absolute immutable entrypoint without changing directory. The trace parser and preparer incorrectly require the compositor working directory to end with `/apps/system/compositor`.

The observed compositor was PID 6430, UID 1000 in all four UID fields, start ticks `19366`, boot ID `bae568ad-c4ca-4e40-a972-43ab9fa560b6`. Its absolute entrypoint was `/nix/store/j5l8ydz5vnpsiq2siyyhnc3h9fk87blw-moire-0.0.0/lib/moire/apps/system/compositor/src/main.ts`. Existing input descriptors belonged to that compositor; no second device reader was opened.

The correction should validate the declared canonical working directory exactly and validate the role's entrypoint separately using bounded command-line inspection. Retain exact PID, UID, start ticks, boot ID, device identity, focus, private sink, deadline and budget checks. Changing the production compositor working directory would also change the directory inherited by external programs and Xwayland, so it is an unnecessary runtime change for this diagnostic requirement.

## Verification and limits

- C37 image build returned 0. Boot-package verification returned 0. Packaged source provenance matched the frozen source snapshot.
- The host app suite returned 0. Final focused controls covering the subsequent diagnostic source adjustments also returned 0. Actual Linux fixture metadata controls returned 0; they did not exercise native input devices.
- The first normal session boot had tracing off. The deliberate RAM-only trace opt-in used the same normal session unit, with an absent future manifest. The session remained active with zero service restarts.
- Native preparation reached the desktop and Files. Two Apps-button preparation clicks did not visibly open the launcher. No synthetic path typing or diagnostic save/crop attempt followed; the independent process metadata blocker stopped this cohort before arming.
- Normal guest poweroff completed, the serial bridge returned 0, UTM showed Stopped with capture off, and no VM/serial process remained. Live ISO unmount warnings are retained in the serial log.
- Post-run verification returned 0 for all 931 frozen source files, 44 earlier image copies, four prior review seals, and both read-only C37 image copies. Earlier C35/C36 acceptance records remain unchanged.
- The five complete installed app gates were not rerun for C37. Native app-suite workflows and physical scanout/tearing remain open.

## Preserved candidate

`vm/nixos/moire-aarch64-quality-37.iso` is 1,208,451,072 bytes, mode `0400`, SHA-256 `641885e08b5c948e27ba829b58b16f3fa85eda1669d694af531a32ce4653ce1f`. The matching UTM copy is `vm/Moire Quality 37 Software.utm/Data/moire.iso`.

Build: `./scripts/build-vm-in-parallels.sh moire-aarch64-quality-37.iso`

Prepare a fresh software UTM bundle with `scripts/prepare-utm-vm.py`; do not overwrite this candidate or earlier bundles. The normal one-command build and QEMU boot instructions remain in `docs/nixos-vm.md`.

Evidence: `vm/verification/2026-10-04-c37-input-trace/native-review.json`, `native-prearm-facts.json`, `utm-serial.log`, `native-actions.json`, and `preservation-after-native.json`. The source snapshot was frozen before this review document was added.
