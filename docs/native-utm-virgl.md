# Boot the native desktop with VirGL in UTM

Use UTM 4.7.5 (118) on Apple Silicon. UTM 4.5.3 (99) stalled before Linux
with the VirGL device in this test. The updated UTM reached the unchanged R6
user picker with VirGL through ANGLE/Metal on the M1 Max and direct GBM scanout.
The previous app remains in `vm/tools/UTM-4.5.3.app`.

Coordinate an exclusive VM window with Recovery before a build or boot.
From the repository root, build a fresh immutable image:

```sh
python3 scripts/build-native-login-probe.py --desktop --output moire-aarch64-native-desktop-c63-r10-virgl-wave.iso
```

The builder refuses existing filenames. Choose a new name for later builds.
It verifies the exported image and preserves earlier images.

Prepare the isolated UTM bundle once:

```sh
python3 scripts/prepare-utm-vm.py vm/nixos/moire-aarch64-native-desktop-c63-r10-virgl-wave.iso --output 'vm/Moire C63 R10 VirGL.utm' --display virgl --isolated --serial-log
```

Open this bundle in UTM. Accept the custom-argument notice for this reviewed
configuration. It uses HVF, two CPUs, 2 GiB RAM, a 1280×800 virtio GPU, USB input,
a read-only ISO and fresh firmware. It has no network, host shares or writable
guest data disk. The serial log and UTM diagnostics stay inside the bundle.

After the bundle is registered, boot it with one command:

```sh
/Applications/UTM.app/Contents/MacOS/utmctl start 'Moire C63 R10 VirGL'
```

Check the greeter footer for **Moire desktop · C63 R10**. Select `moire-pam-test`
and use the public test password `moire-pam-test-only-20261004`. Files opens in
the authenticated desktop. Quick settings → Power → Log out returns to the
greeter. Accessibility → Reduce motion stops the wave locally.

Request normal guest shutdown with:

```sh
/Applications/UTM.app/Contents/MacOS/utmctl stop 'Moire C63 R10 VirGL' --request
```

Check that the VM is stopped before releasing ownership or starting another
guest. A successful command return acknowledges the request; it does not prove
guest shutdown. R6 stayed running after this request under UTM, so its forced
cleanup is recorded separately from lifecycle acceptance.

## Scope and verification

R10 fixes the compositor's virtual-output observation for uploaded SHM pixels
and the UI's bounded-wave admission. Its animation clock includes elapsed time
between accepted frames, capped at 100ms per step. The greeter uses a visible
16-second horizontal and 22-second vertical drift cycle with responsive
overscan. Other Backdrop consumers keep their existing slow ambient profile.
The greeter requires a matching current
commit, successful visible output, a frame opportunity and the existing motion
preference. Ordinary windows retain their default policy. Unknown execution,
readback, stale commits, replaced sources and output loss do not grant motion.

VirGL remains classified as virtual. This test does not qualify physical display
timing, tear-free output, general app animation or performance. No PAM,
AccountsService, groups, ACLs or Polkit access changes accompany the motion fix.

Run the focused source checks:

```sh
pnpm --filter @moire/core exec tsx src/rendering-authority.smoke.ts
pnpm --filter @moire/ui exec tsx src/retained-motion-admission.smoke.ts
pnpm --filter @moire/ui exec tsx src/platforms/wayland/rendering.smoke.ts
MOIRE_UI_PLATFORM=headless MOIRE_UI_ACCELERATION=software pnpm --filter @moire/greeter exec tsx src/native/wave.smoke.tsx
```

R10 passed the following native UTM checks on 2026-10-06 (Adelaide):

- VirGL through ANGLE/Metal and direct GBM output reached the actual greeter.
- Live screenshots showed clear crest displacement with fixed account geometry.
- Reduce motion held the wave visually for 29.05 seconds, then motion resumed.
  Exact native pixel equality is not claimed; the source fixture tests exact stop.
- Wrong and blank passwords reached real PAM and returned `AUTH_ERR` in the
  same greeter process (770), without starting a desktop.
- Correct PAM login reached an active user session on seat0 (UID 1000,
  compositor 3293) with VirGL and Files visible.
- Log out released the desktop devices, retired session-3.scope and returned
  to a fresh moving greeter (3415).

Rapid automated text entry lost fixture characters and caused an extra PAM
denial. Deliberate individual keys succeeded. The cause of that input issue is
still undiagnosed. R10 normal shutdown is untested; it is left running at the
greeter for user inspection. This is scoped graphics/login evidence, not full
lifecycle acceptance. Coordinate with Recovery before starting another guest.

R10 is 992909312 bytes, mode 0400, SHA256
`72cc0a59cea7ec860f46efaeb1cf853d3c38790a686861f7ae6996da336740a1`.
Build evidence is in `vm/verification/native-desktop-20261005T145827Z/`.
Native observations, copied serial/debug logs and final configuration are in
`vm/verification/utm-r6-graphics-20261006/`; `r10-result.json` records limits.
Recheck the preserved artifact and journal evidence with:

```sh
python3 vm/verification/utm-r6-graphics-20261006/verify-r10.py
```

The verifier checks artifacts and journals; it does not repeat live visual tests.
Old UTM stall diagnostics remain in `vm/verification/utm-r6-virgl-20261006/`.

## Use the preserved software fallback

The accepted R6 software image and its original UTM bundle remain unchanged.
Boot the command-line fallback after the UTM guest is stopped:

```sh
scripts/run-native-login-probe.sh vm/nixos/moire-aarch64-native-desktop-c63-r6.iso
```

See [the R6 native acceptance](native-desktop-vm.md) for its two real PAM
desktop and logout cycles, moving software pixels and normal shutdown evidence.
R8 and R9 are preserved as intermediate builds without native VirGL wave
acceptance. R9's original drift was too subtle for Josh to see, so it is not
accepted as visible animation.
