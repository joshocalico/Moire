# Native login probe on Apple Silicon

This checkpoint builds Moire's own graphical greeter under stock greetd and
logind, then launches the fixed public-password PAM probe. It does not yet
provide an authenticated desktop or prove logout from that desktop. The current
R7 image passes the native greeter and fixed-probe checkpoint, including two
correct-login/probe/fresh-greeter cycles without extra input to reveal prompts.

Run commands from the repository root. Coordinate the exclusive QEMU/HVF window
with the recovery task before starting a guest. Preserve existing VM images.

## Prerequisites

Use the existing Apple Silicon QEMU installation with `qemu-system-aarch64`,
`qemu-img`, and its `share/qemu/edk2-aarch64-code.fd` firmware, plus macOS Python 3
and `hdiutil`. Nix runs inside a dedicated NixOS builder, not on the host.

The builder requires this official installer in `vm/builders/`:

```text
nixos-minimal-26.05.11150.825e2028c29b-aarch64-linux.iso
SHA256 d621a3fc1fa60d2864729abcf3bbcfd88652c86650621d6d9025015113a0527b
Bytes 1828014080
```

[Official installer and accompanying checksum](https://releases.nixos.org/nixos/26.05/nixos-26.05.11150.825e2028c29b/).
Download once, verify against that checksum, and keep the installer read-only.
The build helper verifies its SHA256 before starting a VM. This is checksum
verification against the official HTTPS release, not a separate signature claim.

## Build

```sh
python3 scripts/build-native-login-probe.py --output moire-aarch64-native-login-probe-local.iso
```

On its first run, the command installs a dedicated 64 GiB virtual NixOS builder
disk, shuts it down normally, boots the installed builder, and builds the image
from a snapshot of current repository files and the pinned `flake.lock`. Later
runs reuse that builder. Choose a fresh output filename for each candidate; the
command refuses to overwrite an existing image or reformat an unfinished builder.

Only the builder has dependency-download networking. It has no forwarded ports
or host directory shares. A read-only source CD carries the snapshot; a separate
scratch virtual disk carries the exported image. Disk serial and size checks
guard installation and export. The builder's local serial root autologin is for
builder administration; it is not part of the login-probe image.

The resulting ISO is placed in `vm/nixos/`, verified against the guest's SHA256,
and made read-only with a matching `.build.json` receipt. `vm/verification/native-login-TIMESTAMP/` records source hashes,
console logs, QEMU commands, output identity, and preservation of previous images.
If normal shutdown fails, retain the VM reservation and diagnose the running
guest before starting another one.

For an existing ARM64 Linux Nix builder, the underlying build is:

```sh
nix build --impure --file nix/moire-native-login-probe-image.nix
```

## Boot

After the builder has shut down:

```sh
scripts/run-native-login-probe.sh vm/nixos/moire-aarch64-native-login-probe-local.iso
```

This uses HVF, a virtio GPU, keyboard and absolute-position tablet. The ISO is
read-only; the candidate has no network or attached writable data disks. The
launcher requires an explicit image path. It never selects an old image for you.
It verifies the candidate against its build receipt and refuses historical images
without a receipt for this checkpoint.
QEMU's serial monitor accepts `system_powerdown` after Ctrl-A, C, but the greeter
currently grabs the power-button input device. Normal shutdown was verified by
issuing that command immediately after complete greeter device release during a
correct PAM handoff. A power-button command while the greeter owns input is not a
reliable shutdown path. Keep the exclusive VM reservation until shutdown is
confirmed; do not reset a guest or start a competing one.

The disposable test account is `moire-pam-test`, with the public password
`moire-pam-test-only-20261004`. Do not attach personal data to this test image.
Its `/etc/moire-build.json`, also printed to the serial journal, identifies this
checkpoint and the source hashes. `desktopAcceptance` is deliberately false.

## Accepted greeter/probe checkpoint

The latest tested image is `moire-aarch64-native-login-probe-c62-r7.iso`, built
from the repository snapshot on 2026-10-05. Its SHA256 is
`52b20b4f9eec1798ddda8dbfa2a75d3f1ab6cd96b8123ab1bd8dae7d5e09a1fc`
and its size is 743612416 bytes. After coordinating the exclusive VM window:

```sh
scripts/run-native-login-probe.sh vm/nixos/moire-aarch64-native-login-probe-c62-r7.iso
```

The offline HVF test passed these workflows:

- Native graphical greeter and all three native keymap groups.
- Rapid username entry, then an asynchronous secret prompt visible without any
  additional guest input. Some early snapshots still showed Waiting; a two-second
  delay is not a prompt-latency guarantee.
- Actual PAM rejection of blank and wrong passwords.
- Two correct-password logins, each with observed UID 1000, group 100, active
  logind user session on seat0, fixed probe exit zero, and a visibly fresh greeter.
- Complete release of every retired greeter owner and normal QEMU exit zero.

Input used 20 ms key holds and 40 ms gaps, with no Shift or slower-typing
workaround. Password prompts initially focus Cancel; Tab moves to the response
field **after** the secret prompt is visible. The fixed probe itself runs in a
transient user unit and does not claim that unit is the PAM session. The earlier
login observer verifies the actual greetd PAM scope.

Evidence, screenshots and `candidate-acceptance.json` are in
`vm/verification/native-login-20261005T041348Z/`. The immutable build receipt
records build success and leaves graphical acceptance pending; the separate
acceptance record documents the subsequent live test. All previous image
metadata remained unchanged.

### Redraw repairs and their checks

The image includes three focused repairs:

- Preserve damage when Wayland frame backpressure skips a scene submission.
- Activate `wl_surface.frame` callbacks only on the following surface commit,
  so completion of an older frame cannot acknowledge an uncommitted update.
- Invalidate the CPU raster cache when scene presentation skips CPU rendering.
  Otherwise the scene damage baseline advances while pixels remain old, and a
  callback retry with empty damage can keep displaying Waiting indefinitely.

The installed Linux Node 22 checks passed the eight-owner shared-readiness
regression, native input/Wayland/output liveness, frame-at-commit ordering and
actual public Window skipped-raster regression. The last regression failed on
the previous implementation and passes against an independently rendered full
scene. The native pixel oracle was also strengthened: earlier fixtures derived
expected pixels from the same cached producer and could miss stale CPU content.
Historical fixture passes are therefore not equivalent to the stronger R7 check.

The actual candidate uses EGL llvmpipe, flat composition and direct GBM scanout.
Bounded, content-free metadata traces observed source commit, scene selection,
full GPU upload, framebuffer submission and accepted scanout. This verifies the
VM output path, not physical presentation timing or freedom from tearing.
No credential or raw UI-content trace is enabled.

### Retained diagnostic images

R4, R5 and R6 remain **unaccepted** and are preserved with their evidence:

| Image | Evidence | Limitation |
| --- | --- | --- |
| `moire-aarch64-native-login-probe-c62-r4.iso` | `native-login-20261005T024901Z` | Two cycles required slower typing and an extra Shift event. |
| `moire-aarch64-native-login-probe-c62-r5.iso` | `native-login-20261005T033330Z` | Password prompt required diagnostic Tab; no complete acceptance cycles. |
| `moire-aarch64-native-login-probe-c62-r6.iso` | `native-login-20261005T040238Z` | First rapid prompt passed; second stalled. Frame ordering repair alone was insufficient. |

The R4 TCG comparison also reproduced the input stall and exceeded a DRM
page-flip deadline (`vm/verification/native-tcg-20261005T025922Z/`). TCG is not a
qualified workaround. All those candidates shut down normally.

`scripts/probe-native-login-liveness.py` is a historical R4 scratch comparison
helper. Its `--current-wayland` option transfers only the Wayland submission
file, not the R7 Window/raster repair. It must not be used as proof that the full
current implementation passes. The image build runs the complete current checks.

## Next checkpoint

The separate [C63 native desktop](native-desktop-vm.md) now passes two
authenticated desktop/login/logout/fresh-greeter cycles in its real greetd PAM
scope. Its app workflows and graphics performance remain unqualified. Preserve R7 as the accepted probe
fallback. Desktop, app workflows and tearing remain unqualified. Existing
Parallels results are historical and do not establish acceptance of either the
current native desktop or app suite.
