# Build and boot a Moire ARM64 VM

The image boots NixOS directly into the existing `moire-session` on tty1.
The current configuration starts the compositor and System Management, then
shows Moire's own React welcome. Start session confirms the real desktop shell
handoff before Files and Terminal launch. This is an already authorized local
session: closing or failing the welcome continues the existing desktop fallback.
The welcome does not authenticate or select accounts.
The ISO contains the system and Moire dependencies. Boot without `--data` for
disposable RAM state, or attach a separately created data disk to retain the
home folder and hand-edited `/etc/moire` configuration across shutdowns.

The current graphics/Files review candidate is separate from the original
milestone images. See [Quality review](quality-review.md) for verified fixes
and outstanding live acceptance checks.

## Build the image

Use Nix with flakes enabled and an `aarch64-linux` builder.

Nix reads Git-tracked files in a checkout. Add new source and Nix files to Git
before building. The Parallels helper below includes untracked source too.

```bash
nix build .#moire-vm
```

The output is `result/iso/moire-aarch64.iso`. `nix build` produces the same
default output. `flake.lock` pins NixOS and system packages; `pnpm-lock.yaml`
and the dependency hash in `nix/moire.nix` pin the JavaScript dependencies.
The package installs dependencies offline, patches native binaries for NixOS,
and runs the TypeScript sources through `tsx`, as the development session does.

On Apple Silicon, Nix needs a Linux builder for this output. A Darwin-only
Nix installation cannot build the Linux system closure. See the
[Nixpkgs macOS Linux builder guide](https://github.com/NixOS/nixpkgs/blob/nixos-26.05/doc/packages/darwin-builder.section.md).

### Use the existing Parallels build guest

For this repository's `MoireDev` Ubuntu ARM64 VM, install Nix and `rsync` in
the guest, start the VM, and share the repo at `/media/psf/moire`. Then build
from the Mac with one command:

```bash
./scripts/build-vm-in-parallels.sh
```

The helper copies the current source, including untracked source files, to a
temporary native guest directory. It excludes host dependencies and VM files,
builds through the same flake, and copies the ISO to
`vm/nixos/moire-aarch64.iso` on the Mac. The boot command finds that output too.
Set `MOIRE_BUILD_VM` or `MOIRE_GUEST_REPO` if your VM or shared path differs.

## Boot the image

Install QEMU on macOS with `brew install qemu`, then run:

```bash
./scripts/run-vm.sh
```

The launcher selects HVF and the host CPU on Apple Silicon. It starts a
4-core, 4 GiB guest with ARM64 UEFI, a 1280×800 virtio GPU, a virtio keyboard,
an absolute pointer tablet, and user-mode networking. The ISO is read-only.
No host Nix store or shared source tree is required by the running VM.

### Disposable desktop-service integration (C47)

The QEMU configuration now includes NetworkManager for its virtual Ethernet
and UPower for read-only power observations. NetworkManager replaces dhcpcd;
Wi-Fi, modem and VPN plugins are disabled. Polkit stays disabled, network
changes require root, and Moire retains its existing groups and read-only
network policy. NixOS adds the standard NetworkManager service accounts.

Build and boot a fresh disposable candidate without the personal data disk:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-my-desktop-services.iso
./scripts/run-vm.sh vm/nixos/moire-aarch64-my-desktop-services.iso
```

The helper refuses an existing image filename; choose another fresh filename
for a subsequent build. Existing fallback images remain available.

UPower's critical power action is explicitly `Ignore` in this battery-less
guest. This disables automatic critical-battery sleep/shutdown protection and
must not be reused on physical battery hardware. The VM exposes no physical
Wi-Fi or battery; their absence is an expected unsupported state. Installed
integration passed on October 4 with the corrected candidate:

```bash
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-47-desktop-services-fixed.iso
```

The first candidate installed UPower without starting it. The corrected image
starts UPower and orders both backend services before Moire. A cold boot
verified the installed daemons, root-only network permissions, internal DHCP,
DNS resolution and read-only observations through Moire's production service
as UID 1000. The real Quick Settings panel and detail page displayed the wired
connection; no battery row appeared. Three focused private-fixture checks also
passed from the installed package. Refresh was issued through the UI and
captured while updating; its completed UI transition was not recorded.

Evidence and screenshots are under
`vm/verification/2026-10-04-c47-installed-desktop-services`. Both candidate
images and all earlier fallbacks are preserved. Neither run attached the
personal disk. Physical Wi-Fi, battery hardware, power actions, physical
keyboard typing and tearing remain unqualified.

### Disposable removable-drive integration (C49)

The separate `moire-storage-probe` target starts stock UDisks before Moire.
The default image does not enable UDisks. Polkit stays off, custom rules stay
empty, and Moire's groups stay unchanged. Its `interactive` policy permits
requests through existing authorization; it does not grant disk access.

Build a fresh candidate with the existing ARM64 builder:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-my-storage-probe.iso moire-storage-probe
```

With an ARM64 Linux Nix builder, the flake command is:

```bash
nix build .#moire-storage-probe
```

Boot the preserved C49 desktop in disposable RAM state:

```bash
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-49-storage-probe.iso
```

This desktop command attaches no USB fixture or personal disk. The bounded
installed storage test used a separate recorded launch with one exclusively
new 64 MiB emulated USB disk. Its launcher refuses to reuse that fixture.

The first build ran out of working space during image assembly. The exact
same derivation succeeded with a per-command `build-dir` in the existing
shared VM area. The recovery script and its logs are preserved in
`vm/verification/2026-10-04-c49-installed-removable-drives`. No disk resize,
permission change or broad garbage collection was used. Future builds need
room for both the temporary compressed filesystem and the final ISO.

Installed discovery, hotplug and normal-user permission denial passed.
Root-only mount, exact-byte read, unmount and USB PowerOff passed separately.
Root's mount remained inaccessible to UID 1000, so normal-user mounting and
browsing remain blocked. The guest powered down and QEMU retired; the host
runner's exit 1 is unresolved. See [Removable drives](removable-drives.md)
for the acceptance boundaries. All earlier fallback images remain preserved.

### Optional removable desktop (C50)

The separate `moire-removable-desktop` target enables the approved three-action
removable-storage allowance. The default image and `moire-storage-probe` keep
Polkit off. The candidate retains Moire's groups and disables privileged
authentication helpers. Read [the authorization limits](removable-drives.md#optional-normal-user-authorization-c50)
before using this target.

With an ARM64 Linux Nix builder, build it from the repository root:

```bash
nix build .#moire-removable-desktop
```

With the existing Parallels builder, choose a fresh output filename:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-my-removable-desktop.iso moire-removable-desktop
./scripts/run-vm.sh vm/nixos/moire-aarch64-my-removable-desktop.iso
```

The helper refuses existing image filenames. To boot the preserved checkpoint:

```bash
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-50-removable-desktop.iso
```

These launch commands attach neither a USB fixture nor the personal data disk.
C50's separate recorded launch attached one new emulated USB disk. Pointer-driven
Files actions as UID 1000 passed mount, browse, unmount, withdrawal and
reconnect with exact marker-byte preservation. The **Eject** menu action mapped
to one UDisks PowerOff request for this USB fixture. No UDisks Eject method was
invoked; only its authorization query passed, and optical Eject remains unqualified.
QEMU and logger exits were both 0 after normal poweroff. C49's runner exit 1
remains unresolved.

The C50 ISO is preserved with mode `0400` and SHA256
`84be18683b0f62c68f71a394ac78734be8a6c5342eef29bdfcc67f6c7b6c248c`.
The target uses xz squashfs compression to fit the constrained builder.
Earlier failed attempts and successful recovery receipts remain in
[the C50 evidence](../vm/verification/2026-10-04-c50-removable-desktop/README.md).
All 52 fallback images and personal data stayed untouched. Typing, tearing,
VT switching, real removable hardware and optical media remain unqualified.

To boot a copied image, pass its path:

```bash
./scripts/run-vm.sh /path/to/moire-aarch64.iso
```

Set `MOIRE_VM_CPUS` or `MOIRE_VM_MEMORY` to change the resources. Memory is in
MiB. Set `MOIRE_QEMU` to choose another QEMU executable, or
`MOIRE_QEMU_FIRMWARE` to choose an ARM64 UEFI firmware file. The launcher finds
Homebrew's bundled firmware by default.

## Keep home and system configuration (C44)

C44 keeps the immutable ISO and adds one independent raw ext4 data disk.
Create it once; the creator refuses an existing file or symlink:

```bash
python3 scripts/vm-data.py create
```

The default is the sparse 8 GiB `vm/data/moire-home.raw`. On this Mac, creation
uses the existing shared MoireDev builder's e2fsprogs. On Linux, it uses local
e2fsprogs. Neither path installs software. A different destination and size
can be supplied with `create /path/to/home.raw --size-gib 16`.

Build a new image under a fresh filename, preserving fallback images:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-my-build.iso
```

Boot the tested C44 image with the data disk:

```bash
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-44-persist-fixed.iso --data vm/data/moire-home.raw
```

For a fresh build, substitute its filename. Persistence requires an image with
the `MOIRE_AARCH64_P1` ISO volume label; the launcher refuses older RAM-only
fallbacks when `--data` is supplied. Omitting `--data` retains RAM-only boot.
The launcher holds an exclusive lease on the disk until QEMU exits. Always use
this launcher for that disk; a second launch is refused.

The data disk supplies `/home/moire` and `/etc/moire`. Documents, Notes and
preferences beneath home persist; the rest of the writable system stays in
RAM. Boot validates the disk and existing ownership, checks ext4 without
repairing it, and mounts it without formatting or migration. If a requested
disk is missing or invalid, the desktop stays stopped and the existing serial
recovery console remains available. It does not silently switch to RAM.

`/etc/moire/session.conf` is a root-owned environment file read on each session
start. Edit it from the existing serial root console; use `NAME=value` lines,
not shell commands. It initially contains:

```ini
MOIRE_RENDERER=auto
MOIRE_EGL_PRESENT=auto
MOIRE_UI_ACCELERATION=auto
```

Existing files and legitimate manual permissions are retained. User preferences
remain in home; Settings does not gain write access to this system config.
After editing, restart `moire-session` or reboot to apply the values.

Shut down with `poweroff` from the serial console and wait for QEMU to exit.
Back up the data disk while the VM is stopped. Immediate QEMU termination is
not a clean data shutdown. Disposable qcow2 overlays and QMP lifecycle
automation remain separate future work.

On October 4, C44 saved a UTF-8 document, preferences and a note through the
installed production APIs as UID 1000. After a clean power-off and cold boot,
an independent host-preserved expectation verified exact bytes, owners and
modes through those APIs. A manual system config edit also survived and was
observed in the restarted compositor's environment. Evidence is under
`vm/verification/2026-10-04-c44-persistent-home`. This verifies storage and
session startup; native typing, sudden power loss and physical tearing remain
unqualified.

## Inspect a boot

The QEMU window shows tty1 and the Moire desktop. The configured static Silk
boot theme leaves Escape to Plymouth's real log display. Native Escape and
serial recovery acceptance remain pending for the new candidate. The launching terminal is a
local root recovery console over the guest's serial port. It is not exposed
over the network. Inspect the session there:

```bash
systemctl status moire-session --no-pager
journalctl -b -t moire-session --no-pager
cat /tmp/moire-terminal.log
cat /tmp/moire-files.log
cat /tmp/moire-system-management.log
```

The journal's `[renderer]` line reports the selected compositor backend.
`MOIRE_RENDERER`, `MOIRE_EGL_PRESENT`, and `MOIRE_UI_ACCELERATION` default to
`auto`. Mesa, GBM, EGL, GLES, and the XKB keymaps are included. EGL selection
depends on the virtual GPU and the host QEMU build. HVF accelerates the CPU;
it does not itself provide GPU acceleration.

To force an EGL diagnostic run from the serial console:

```bash
mkdir -p /run/systemd/system/moire-session.service.d
printf '[Service]\nEnvironment=MOIRE_RENDERER=egl\n' > /run/systemd/system/moire-session.service.d/renderer.conf
systemctl daemon-reload
systemctl restart moire-session
journalctl -b -t moire-session --no-pager -n 80
```

Shut down with `poweroff` in the serial console and wait for QEMU to exit.
A boot without `--data` starts with fresh writable state. With `--data`, home
and `/etc/moire` survive; other writable system state starts fresh.

## Update dependencies

After changing `pnpm-lock.yaml`, set the `pnpmDeps.hash` in `nix/moire.nix` to
`lib.fakeHash`, build `nix build .#moire`, then replace it with the `got:` hash
reported by Nix. Rebuild the image afterwards.

The original milestone uses immutable ISO media and RAM state. C44 adds the
optional independent data disk above. Disposable qcow2 overlays and QMP
lifecycle automation remain later work.

## Verified on Apple Silicon

On 2026-09-30, the image built in the ARM64 Ubuntu `MoireDev` guest and booted
with Homebrew QEMU 10.1.2, HVF, and its bundled ARM64 UEFI firmware. Moire
started automatically on tty1 with Files, Terminal, System Management, and
rootless Xwayland. Logind reported an active Wayland session on VT 1.

The compositor selected EGL with Mesa 26.1.8 llvmpipe and direct GBM scanout.
This is CPU rendering through EGL, not host GPU acceleration. Native apps retain EGL scene rendering and publish through `wl_shm` when GBM
allocation fails on the virtual GPU's render node. Both apps stayed running and displayed their
windows. The Super key opened the launcher, and Escape dismissed it.
The compositor received absolute pointer events from the virtio tablet.

A file created in the guest home directory disappeared after shutdown and
a fresh boot. The guest root was `tmpfs`, the ISO was mounted read-only, and
the Moire service was active with zero restarts.

Session output uses the `moire-session` journal identifier. PAM places the
desktop in a logind session scope, so filtering only by the system service
unit misses some compositor output.

## Graphics and themes verification

The October 1 graphics fix completes GL rendering before exporting a frame or
handing a direct buffer to KMS. Mesa llvmpipe's CPU-backed GBM buffers were
visible before asynchronous GL work completed; `glFlush` alone did not prevent
black tiles and torn frames. The publication regression test maps the exported
buffer immediately, without a GL readback that would hide the race. It failed
with the old implementation and passes 60 complete alternating frames with the
fix. Completion adds a CPU/GPU synchronization point; an explicit-fence path is
future optimization work.

The VM uses the primary DRM node for compositor scanout. Native apps use the
render node without elevated permissions. If that node cannot allocate an
exportable buffer, retained EGL renders into a readback buffer and publishes
through `wl_shm`; a software scene is the final fallback. This QEMU build still
uses llvmpipe, so this is EGL support without host GPU acceleration.

From the local serial root console, load the packaged runtime and run the
real graphics checks:

```bash
package=$(dirname "$(dirname "$(readlink -f /run/current-system/sw/bin/moire-session)")")
source <(sed '/^exec /,$d' "$package/bin/moire-session")
cd "$package/lib/moire"
node_modules/.bin/tsx packages/sys/src/egl-publication.smoke.ts
MOIRE_RENDER_NODE=/dev/dri/card0 MOIRE_TEST_DIRECT_OUTPUT=1 \
  node_modules/.bin/tsx packages/sys/src/egl-output.smoke.ts
```

Change themes in Settings → Appearance. For a reproducible live check from
that same recovery console, the helper writes the same desktop preferences:

```bash
runuser -u moire -- env HOME=/home/moire \
  node_modules/.bin/tsx packages/prefs/src/set-theme.ts cupertino dark
```

Repeat for `moire`, `redmond`, `plasmid`, and `gnomish`, with `dark` or `light`.
Running apps and shell chrome reload together. Restore `moire dark` when done.
Theme previews and their checks are described in
[Personalization and themes](ui/personalization.md).

Session setup installs writable desktop-entry copies, so restarting
`moire-session` also succeeds with an immutable package. The image creates
standard home folders and includes the wallpaper under Pictures for a real
PNG preview. Writable settings and files still disappear when the VM shuts
down; the immutable ISO and RAM-state milestone is unchanged.

## Desktop polish verification

The October 1 polish pass improves the shared controls, title bars and panel
icons, Files, and Settings Appearance. It keeps the custom native reconciler
and all five theme families. Other apps receive the shared widget and chrome
changes; their individual layouts were not redesigned.

The final ISO was built with the Parallels helper and booted from read-only
media under HVF. The packaged EGL publication check passed 60 complete frames,
the direct-output check passed, and `moire-session` remained active with zero
restarts after resizing, search, and theme changes. The UI polish and desktop
rendering checks also passed inside the ARM64 guest. Workspace typechecks,
native theme checks, shell checks, and Files Places checks passed on the host.

Pointer resizing verified Files at 1020, 600, 320, and 200 logical pixels wide
and Settings at 480 and 320 pixels wide. Native Wayland windows previously
advertised their preferred opening size as their minimum. Resizable windows
now leave the minimum unspecified, allowing the compositor's size constraints
and responsive app layouts to work. Fixed windows keep their fixed size hints.

In the live VM, Ctrl+F focused Files search and typed input showed the
no-match state; Escape cleared it. Settings menus accepted Down, End, Home,
and Enter across repeated open/choose cycles. Cupertino dark and Gnomish light
applied to running native app controls and shell chrome together. Moire dark
was restored afterwards. The native rendering check covers all ten
family/scheme combinations at six app window sizes.

Representative Moire dark samples after this pass spent about 1.6–2.3 ms
building the compositor scene and 52–55 ms in EGL output. Earlier samples
with Settings visible spent about 60–64 ms in output. The scenes differ, so
these are diagnostics, not a controlled speed comparison. Software llvmpipe
output remains the dominant cost; this pass does not add host GPU acceleration.

Run the regression checks described in
[Personalization and themes](ui/personalization.md). In the packaged guest,
after loading the runtime as above, the new checks are:

```bash
node_modules/.bin/tsx packages/ui/src/polish.smoke.tsx
node_modules/.bin/tsx packages/ui/scripts/desktop-polish.smoke.tsx
```

Files search is limited to filenames in the current folder. PNG previews
remain in the inspector; the grid uses symbolic file icons. This pass does
not introduce recursive search, thumbnail caching, or persistent VM state.

## Accelerate graphics with UTM's QEMU build

The installed Homebrew QEMU 10.1.2 has no OpenGL support: it rejects
`virtio-gpu-gl-pci` and `cocoa,gl=on`. Its HVF CPU acceleration still works.
The installed UTM 4.5.3 bundles QEMU with VirGL and ANGLE, allowing this same
Linux image to render on the M1 Max GPU through Metal. UTM describes its
[Linux VirGL support as experimental](https://docs.getutm.app/settings-qemu/devices/display/).
This path uses QEMU/HVF, with the Apple Virtualization backend disabled.

Build a separate output to preserve the working CPU image:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-accel.iso
```

With a native Linux builder, use `nix build .#moire-vm` and pass its resulting
ISO path to the preparation command below. Python 3 creates a UTM bundle from
`nix/utm-virgl.json`:

```bash
./scripts/prepare-utm-vm.py
# Or: ./scripts/prepare-utm-vm.py result/iso/moire-aarch64.iso
```

The default bundle is `vm/Moire VirGL Accelerated.utm`. It contains a copy of
the ISO (an APFS clone on this Mac), one read-only CD device, and no guest disk.
It selects four CPUs, 4096 MiB RAM, `virtio-gpu-gl-pci`, USB input, and a local
pseudo-TTY serial console. Directory and clipboard sharing are disabled.
Guest writable state remains in RAM; UTM keeps its own firmware variables and
configuration in the bundle. The helper retains an existing bundle with the
same image hash and refuses to overwrite one containing a different image.
For a new build, use `--output 'vm/Moire VirGL New.utm'` and open that bundle.

Register the default bundle once with UTM → File → Open, then press Run.
Subsequent boots use one command:

```bash
./scripts/run-vm-utm.sh
```

The launcher uses UTM's documented
[local start URL](https://docs.getutm.app/advanced/remote-control/) for the
registered name `Moire VirGL Accelerated`. A custom bundle name must be started
in UTM. Registration and the generated bundle's boot were verified through
the UTM UI; the URL launcher was checked against the documented API and for
shell syntax. `utmctl list` timed out with OSStatus -1712 on this installation,
so it is not required by the launcher.

To recover the CPU path, run `./scripts/run-vm.sh`. Its image and defaults were
preserved. The diagnostic image also booted with that launcher and llvmpipe.

### Verify the actual GPU renderer

In UTM's home window, the running VM reports a Serial (TTY) path such as
`/dev/ttys007`. Connect locally with `screen /dev/ttys007 115200`, then use the
runtime setup and graphics commands above. The path can change between boots.
Check `journalctl -b -t moire-session --no-pager` and the native app logs.
The verified renderer was:

```text
virgl (ANGLE (Apple, Apple M1 Max, OpenGL 4.1 Metal - 91.7))
OpenGL ES 3.0 Mesa 26.1.8
```

The compositor selected direct GBM scanout. Files and Terminal independently
reported retained EGL/dmabuf presentation on `/dev/dri/renderD128`, with the
same hardware renderer and no `wl_shm` allocation fallback. The guest DRM
device was virtio (`1af4:1050`). HVF alone or the presence of a DRM node is not
proof of hardware rendering; require the renderer string in both stages.

The packaged publication check passed 60 complete alternating frames on both
backends. It keeps immediate raw mmap for the original llvmpipe regression.
Hardware resources require the driver's transfer path for CPU inspection,
so the VirGL branch imports and maps through GBM, as the compositor does.
An initial raw-mmap-only check read stale hardware backing storage; changing
the diagnostic's consumer path fixed that test without changing the renderer.
The direct-output check also passed on both backends. Final-image native
layout/rendering checks passed all ten theme schemes. Live desktop inspection
showed complete app windows, wallpaper and chrome. These checks cover the
previous incomplete-frame fault; they do not constitute a recording of every
host display refresh or a guarantee against all host presentation tearing.

### Compare completed render times

Stop the desktop during this isolated benchmark. After loading the packaged
runtime from the recovery console:

```bash
systemctl stop moire-session
node_modules/.bin/tsx packages/sys/src/egl-benchmark.ts
# In the accelerated VM, reject a software renderer:
MOIRE_REQUIRE_HARDWARE=1 node_modules/.bin/tsx packages/sys/src/egl-benchmark.ts
systemctl start moire-session
```

Run each VM separately. The probe uses 1280×800 output, eight overlapping
retained layers, rounded corners and shadows, 15 warmup frames, and three
60-frame batches. It measures composition plus direct GBM output, including
the publication `glFinish`; it excludes KMS/host display presentation.

The October 1 measurements used the same original ISO on both backends,
SHA256 `f1ea24d72c75f05926b918615981ff46eac4ca10fa20316656f3a6abd81c9473`.
They preceded the later diagnostic-image rebuild. CPU warmup and batches
0–2 completed first, followed by GPU warmup and batches 0–2. Both VMs remained
booted with their desktops stopped; only one benchmark ran at a time. There
was no counterbalanced run order or thermal/frequency control.

On this M1 Max, with four guest CPUs and 4 GiB RAM for each backend:

| Backend                                | Batch means (ms/frame) | Median range  | p95 range     |
| -------------------------------------- | ---------------------- | ------------- | ------------- |
| Homebrew QEMU 10.1.2 / llvmpipe        | 24.190, 24.179, 24.268 | 24.144–24.162 | 24.511–24.745 |
| UTM 4.5.3 / QEMU 7.2.0 / VirGL / Metal | 16.409, 16.520, 17.802 | 15.229–17.068 | 22.934–27.866 |

The original raw captures are saved locally in
`vm/verification/2026-10-01-acceleration/` (ignored VM artifacts). See
`cpu-serial.log` and `gpu-serial.log` for the complete captured benchmark
stdout, including all batch records and terminal control sequences.
`cpu-batches.jsonl` and `gpu-batches.jsonl` preserve the emitted records in a
readable form. `metadata.json` records the image hash, renderer, resources,
workload, warmup/batch protocol, and run order; `versions.txt` records the
installed QEMU/UTM versions. `original-guest-benchmark.ts` preserves the exact
probe run against the original packaged runtime. The probe emits per-batch
statistics; it does not save individual frame samples. All six records were
checked against the table above without rerunning or replacing the timings.

VirGL reduced mean completed render time by about 26–32% (1.36–1.48×
throughput), or about 30% / 1.43× across the three equal-sized batches.
This compares the available complete VM stacks, including their
different QEMU versions; it does not isolate the GPU driver alone. The derived
56–61 versus 41 frames/second describe this probe, not desktop refresh rate.
Native client buffers still pass through GBM CPU mapping in the compositor,
so the desktop is not an entirely zero-copy GPU pipeline. Explicit fences and
removing those transfers remain future performance work.

## Graphics and Files quality candidate — 2 October 2026

Candidate 4 built and booted under UTM/HVF with the retained EGL/VirGL renderer.
It includes the taskbar material, changing-backdrop, input and Files changes
described in [Quality review](quality-review.md). It is a review checkpoint;
live tearing, window interaction and full workflow acceptance remain open.
The original `moire-aarch64.iso` and `moire-aarch64-accel.iso` are preserved.

Build subsequent revisions under a fresh name:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-quality-next.iso
```

The CPU fallback boots that image with one command:

```bash
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-next.iso
```

For acceleration, prepare a separately named UTM bundle, open it once in UTM,
then press Run:

```bash
./scripts/prepare-utm-vm.py vm/nixos/moire-aarch64-quality-next.iso --output 'vm/Moire Quality Next.utm'
open -a UTM 'vm/Moire Quality Next.utm'
```

The installed candidate 4 can subsequently be started with one command:

```bash
open -a UTM 'utm://start?name=Moire%20Quality%20Candidate%204'
```

Run only one graphics test VM at a time. These bundles have immutable ISO
media and RAM state, with no writable disk or host-folder sharing. The bundle
preparer refuses to replace an existing bundle with different ISO contents.
Use a fresh name for each revision.

The packaged changing-backdrop regression can be repeated in the candidate's
local serial recovery console:

```bash
package=$(dirname "$(dirname "$(readlink -f /run/current-system/sw/bin/moire-session)")")
source <(sed '/^exec /,$d' "$package/bin/moire-session")
cd "$package/lib/moire"
node --import "$package/lib/moire/packages/sys/node_modules/tsx/dist/loader.mjs" packages/sys/src/egl-output.smoke.ts
GBM_ALWAYS_SOFTWARE=1 LIBGL_ALWAYS_SOFTWARE=1 MOIRE_RENDER_NODE=/dev/dri/card0 node --import "$package/lib/moire/packages/sys/node_modules/tsx/dist/loader.mjs" packages/sys/src/egl-output.smoke.ts
sudo -u moire env HOME=/home/moire node --import "$package/lib/moire/packages/sys/node_modules/tsx/dist/loader.mjs" apps/bundled/files/src/filesystem.smoke.ts
sudo -u moire env HOME=/home/moire node --import "$package/lib/moire/packages/sys/node_modules/tsx/dist/loader.mjs" packages/ui/scripts/files-workflow.smoke.tsx
```

Check the renderer printed by each run. `LIBGL_ALWAYS_SOFTWARE` alone did not
force this GBM path to llvmpipe; `GBM_ALWAYS_SOFTWARE` was also needed. These
tests cover real composition and disposable filesystem effects. They do not
prove that a live drag is tear-free. Input traces currently block automated
live acceptance: pointer events do not reach the guest, and some long typing
sequences arrive with missing releases. Evidence and exact image hashes are
saved locally in `vm/verification/2026-10-01-quality/metadata.json`.

The toolbar correction is packaged separately in
`vm/nixos/moire-aarch64-quality-5.iso`, SHA256
`4bbc46a33063648b33a18253d0f5a4e576557de417bcfb4d6f5cafc1c0c5fbcb`.
Its build, source/package provenance and packaged checks are saved in
`vm/verification/2026-10-02-toolbar-candidate-5/`. Candidate 4 is unchanged.
At that checkpoint candidate 5 was not boot-tested. The later app-suite check
below supersedes that acceptance status.

## App-suite candidate 8 — 2 October 2026

The verified app-suite checkpoint is `vm/nixos/moire-aarch64-quality-8.iso`:
SHA256 `2ca0a6a870c3e33a852641af98d46fd569a7ba0e667bab731534891942d61183`.
It contains the [twenty-app suite](apps/suite.md), shared input/editing/layout
fixes and packaged media utilities. It boots to tty1 with Files and Terminal
under Homebrew QEMU 10.1.2 using HVF on Apple Silicon.

Boot the existing verified image:

```bash
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-8.iso
```

Build the current checkout as a new image, then boot it:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-apps-next.iso
./scripts/run-vm.sh vm/nixos/moire-aarch64-apps-next.iso
```

The build helper refuses any existing output filename. Candidate 8 and all ten
older fallback ISOs remain preserved. No overlays or QMP lifecycle automation
are added. The existing Parallels Linux builder supplies the ARM64 Nix build.

The software virtio GPU uses EGL/llvmpipe and direct GBM scanout. Client dma-buf
allocation fails on this path and falls back to EGL through `wl_shm`; this is
not proof of hardware acceleration or tear-free movement. The actual Screenshot
client captures that output, crops/annotates/saves/reopens a PNG, and Image
Viewer displays the result in a native Moire window. System Monitor's live D-Bus
Quit now terminates a native Calculator process: installed launchers use Node's
TypeScript loader in one process instead of the `tsx` CLI/preflight child.

Build/source/package provenance, all installed-package workflow checks, serial
boot output and native screenshots are in
`vm/verification/2026-10-02-app-suite-candidate-8/`. The copied ISO matches the
Nix output and 483 packaged source/test/document/asset files match the snapshot.
The earlier C7 check exposed the launcher issue; C7 remains a fallback, not the
recommended candidate. Its simple non-UI termination fixture passed, so the
native Calculator check is the evidence for the actual fix.

## Renderer candidate 10 — 2 October 2026

The latest verified renderer image is `vm/nixos/moire-aarch64-quality-10.iso`,
SHA256 `221ae6b3e78ebe2b983fe81460a6c34d6d0b3a30078a07f2231266dceb576ade`.
It includes the app-suite core and the retained process-row and GPU-buffer
ownership fixes. All twelve older host images remain unchanged.

```bash
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-10.iso
```

It also boots in the separately prepared `vm/Moire VirGL C10.utm` bundle.
UTM reports VirGL/ANGLE Metal and direct GBM scanout; real GPU buffer reuse,
process updates and screenshot crop/annotation/save/reopen pass. Homebrew QEMU
continues to verify the llvmpipe/SHM fallback. Movement and resize tearing remain
open because native automation does not deliver visible intermediate drag
positions. See [Quality review](quality-review.md) for evidence and limits.

Files, Notes and Music redesigns following this checkpoint are current-source
work and require a fresh image. Build them without replacing a fallback:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-apps-next.iso
./scripts/run-vm.sh vm/nixos/moire-aarch64-apps-next.iso
```

The UTM/VirGL candidate-5 stall remains unresolved. A separate HVF serial
check booted the same C5 ISO to NixOS login; only its own stalled QEMU process
was stopped after targeted graceful commands timed out. Do not infer that the
UTM path is repaired from the working software-GPU session.

## Candidates 13–14 and the next welcome image

Candidate 13 verifies native Files PNG preview, Image Viewer opening the actual
file URI, and Editor saving/relaunching the real document. Guarded Files→Editor
reopen and reliable native pointer edges remain open. Candidate 14 verifies
actual QEMU/HVF KMS buffer ownership, retired reuse, modeset recovery and repeated
close. Its raw flip sequence is zero and hardware/vsync timing is unverified.
The fresh UTM C14 attempt stayed black with no serial output; it is a bounded
startup blocker, not an accepted accelerated desktop. See the exact provenance,
logs and captures in the candidate 13/14 evidence directories and quality review.

Boot the verified Candidate 15 image:

```bash
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-15.iso
```

Candidate 15's installed suite and native renderer checks pass. The UTM/VirGL
welcome reaches Files, Terminal and the desktop through actual keyboard Start;
the workflow also passes after a normal guest reboot. Saved native captures
include the welcome, reduced-motion checkbox, Escape popover dismissal and
desktop. The production welcome is
static. Hardware-gated animation and hidden-window visibility integration remain
unfinished. A running Moire React early-boot root and Silk Fold animation are
also unfinished: Plymouth script owns the current static fallback runtime.
The boot theme contains one bounded PNG, with no React runtime in
the initrd. Plymouth quits before Moire takes tty1/DRM ownership. Its upstream
details and text plugins are patched to retain live serial kernel messages.
Initial-boot Escape and recovery during stalled presentation remain unaccepted.
A postboot daemon test renders the real theme, but Escape yields a black frame
until daemon exit restores text; this instance had no attached live boot buffer.
It does not establish initial-boot behavior. No account, authentication, host-login or permission
changes are introduced by this presentation wave.

Candidate 16 is built and preserves all 18 earlier fallback images. Its installed
app suite passes 800 frames and 69 PNG captures with no invalid states or layout
overflow; isolated native Mesa renderer checks also pass. Its first UTM boot
remained black with no serial output for roughly five minutes. UTM Stop stalled
and reported an RPC timeout; terminating the verified guest process returned UTM
to Stopped. This is a startup blocker, not a successful guest shutdown or a test
of the React boot renderer. The cause is still unresolved. Evidence is in
`vm/verification/2026-10-03-app-suite-candidate-16/`.

The same C16 image boots under Homebrew QEMU 10.1.2/HVF and displays the Moire
welcome through llvmpipe/SHM fallback. A real input query found that C16's boot
guardian rejects successful `EVIOCGBIT` queries because they return a positive
byte count. The source fix and real descriptor regression target C17. A disposable
RAM copy with that correction paints the React boot root and restores existing
console text after normal termination and a stopped renderer. This establishes
postboot software-scanout recovery only; physical Escape and refreshed installed
package acceptance remain open.

C16 includes an experimental `moire-boot-stage` command for a running static
React boot root and independent console guardian. Native Escape, stalled-child
console recovery and guardian-crash cleanup remain unverified. The command uses
the full desktop package in stage 2; it is not an initrd runtime. Narrow compiled
packaging and authoritative window visibility are being implemented for the next
candidate.

Boot C31 for the scoped native input checkpoint. Files Ctrl+A/C preserves the
session; menu Paste completes a verified 192 MiB copy, and Terminal Ctrl+C
returns status 130. C30 and C28 remain preserved fallbacks. C31's rounded
visibility renderer gate, rapid text entry and Ctrl+V remain unaccepted; C32
requires fresh verification of those repairs and app fixes. See the quality
review for the exact scope and remaining graphics checks:

```bash
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-31.iso
```

For a new build, choose an unused filename. The helper refuses to overwrite an
existing image. For example, the next candidate can be built and booted with:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-quality-31.iso
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-31.iso
```

C20 automatically starts the managed React stage, waits for its first accepted
frame, verifies release to text mode, then starts the Moire welcome session.
Two fresh Homebrew QEMU/HVF boots pass this sequence. The installed app suite,
800-frame gallery, isolated Mesa checks and nine real systemd transaction cases
also pass. C19 separately passes native UTM Escape and console restoration using
synthetic native-window input. See the
[C20 checkpoint](quality-review.md#candidate20-automatic-startup-checkpoint)
for exact evidence and limits. Preserve C15 and all later fallback images.
C21 additionally passes a fresh automatic boot and real private Unix/public
Window tests for zero-output mapping, idle revocation, conservative reconnect,
retained geometry and changed pixels with partial damage. It passes workspace
typecheck, the installed app suite and native renderer checks. Its original
disk-space failure and fixture corrections are preserved. See the
[C21 checkpoint](quality-review.md#candidate21-zero-output-checkpoint).
C21 also passes a separately restarted managed-stage recovery test in native UTM.
After its accepted React frame, the exact renderer was stopped with SIGSTOP.
One synthetic native-window Escape restored the existing kernel/systemd journal.
The original collector's 17/18 result is preserved; a separate assessment checks
the same invocation's successful PID1 deactivation after manager state collection.
The initial black UTM startup attempt and unchanged successful retry remain
separate evidence. This does not establish a human physical key or automatic
initial-stage Escape. See the [native stall checkpoint](quality-review.md#candidate21-native-renderer-stall-checkpoint).

Candidate 22 adds commit-bound rendering authority, bounded EGL target
pools and conservative motion integration, plus Files, Notes, Music and shared
icon improvements. Its installed app acceptance passes; its original native
black-buffer fixture failure is preserved and resolved by the C23 oracle.
Initial-boot physical Escape, display-loss hardware tests,
verified hardware motion and physical tearing remain open.

For artwork generation and measured limits, see [Silk boot artwork](../themes/boot/README.md).

C22 is now built and preserves all 24 prior host images. It passes strict source
provenance, installed app workflows, 800 gallery frames and 12 native Linux
headless app comparison cases. A fresh QEMU/HVF boot reaches the welcome and the
existing API starts its desktop shell. Files, Notes and Music render in native
Wayland/KMS windows; direct API launch does not close the separate welcome.
One legacy raw-alpha graphics oracle and two native empty-state/layout findings
remain recorded for C23. See the [C22 checkpoint](quality-review.md#candidate22-graphics-and-app-checkpoint).

C23 preserves all 25 prior images and passes strict source/boot provenance,
workspace typecheck, the exact installed app and renderer suites, and the
800-frame gallery. Its corrected five-scene native DMA-BUF oracle preserves
strict colour and canonical opacity assertions. A fresh automatic QEMU/HVF boot
and native Notes/Files launch captures confirm both layout fixes, followed by
normal poweroff. See the [C23 checkpoint](quality-review.md#candidate23-installed-graphics-and-native-app-checkpoint).
Native input workflows, the borrowed KMS import fallback, qualified hardware
motion and physical tearing remain separate open gates.

### Explicit software UTM display fallback

The UTM generator defaults to VirGL. To test the ordinary software virtio display
in a separate bundle, use an unused output path:

```bash
./scripts/prepare-utm-vm.py vm/nixos/moire-aarch64-quality-26.iso --display software --output 'vm/Moire Quality 26 Software.utm'
```

Open that bundle in UTM and Run. The generator preserves existing bundles and
rejects a display-mode mismatch. This changes the display device only; no new
sharing, microphone, input or security permissions are required. The existing
C26 bundle is preserved, so use another unused bundle path to create a second
copy. C26 software UTM reaches the desktop and passes native Files Cancel,
Skip, Keep both, retry without recutting and Done dismissal, with exact bytes
and tags checked separately. Its fixed footer exposes the complete action
labels without scrolling. Two conflicts needed one native Tab to refresh their
stale progress frame. That intermittent repaint defect, separate native
keyboard-action acceptance and full native app acceptance remain open. C24
VirGL failed before its Wayland socket; accelerated output remains unverified.
See the [C26 review](quality-review.md#candidate-26-visible-transfer-actions)
for exact evidence and limits.

### Candidate 32 checkpoint

This preserved checkpoint boots automatically under QEMU/HVF:

```bash
./scripts/build-vm-in-parallels.sh moire-aarch64-quality-32-rebuild.iso
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-32.iso
```

The build command uses a fresh filename because existing images are preserved
fallbacks. A rebuild contains the current checkout; the frozen C32 source and
hashes are recorded in its verification directory. For a separate native UTM
test, generate a fresh bundle:

```bash
./scripts/prepare-utm-vm.py vm/nixos/moire-aarch64-quality-32.iso --display software --output 'vm/Moire Quality 32 Software Recheck.utm'
```

C32 passes all five exact installed gates, the 800-frame gallery and a fresh
automatic QEMU boot and shutdown. Its native Screenshot precise crop, close
cancellation, overwrite cancellation and final save pass. Native drag cropping,
panel overlap and Files-to-Image-Viewer activation fail and remain assigned to
the next candidate. Physical tearing and broad native app workflows remain
unverified. See the [C32 review](quality-review.md#candidate-32-installed-checks-and-native-screenshot-checkpoint).

## Candidate 33 app and graphics integration

Build the current checkout into a fresh immutable image, then boot it with automatic HVF selection on Apple Silicon:

```sh
./scripts/build-vm-in-parallels.sh moire-aarch64-quality-33-rebuild.iso
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-33-rebuild.iso
```

The filename must be unused: previous images remain fallbacks. The frozen validation candidate uses `vm/nixos/moire-aarch64-quality-33.iso`; rebuilding later includes the current checkout rather than reproducing that checkpoint's source automatically. Frozen source, package provenance and actual test results are recorded in `vm/verification/2026-10-03-app-suite-candidate-33`. Read those receipts before treating native graphics, input or app workflows as accepted.

For a separate native software display bundle:

```sh
./scripts/prepare-utm-vm.py vm/nixos/moire-aarch64-quality-33.iso --display software --output 'vm/Moire Quality 33 Software Recheck.utm'
```

Open the resulting bundle in UTM and press Run. Coordinate with the VM owner before launching; only one graphics guest is tested at a time. The immutable base uses RAM for guest writes. Disposable qcow2 overlays and QMP lifecycle automation remain a later milestone.

To boot the already built, validated checkpoint:

```sh
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-33.iso
```

C33 passes all five installed gates and automatic QEMU/HVF boot and normal
shutdown. Native software UTM verifies capture, precise cropping, canceled
close/overwrite, save-before-close, and Files PNG activation in Image Viewer.
The Screenshot footer stays above the panel. Drag cropping remains a concrete
native failure; physical tearing and broad native app acceptance are unverified.
All 36 images remain preserved. See [the scoped results](quality-review.md#candidate-33-installed-and-native-results).


## Candidate 34 desktop-controls image

Build a fresh immutable image from the integrated app-suite and desktop source:

```sh
./scripts/build-vm-in-parallels.sh moire-aarch64-quality-34.iso
```

Boot it with QEMU; the launcher selects HVF on Apple Silicon:

```sh
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-34.iso
```

The builder refuses to replace an existing image. Keep C33 and the earlier
fallbacks. Guest writes remain in RAM. Super+Q opens the shared Quick Settings
popup, Super+N opens the separate notification tray, and compact taskbars expose
hidden windows through their Windows list. Network remains visible; unsupported
hardware rows are hidden. C34 is built, sealed read-only and verified against
its actual Nix output and packaged source. All five installed checks pass and
direct HVF boot starts the normal session without the test daemon adapter.
Native desktop review is partial; see [the quality review](quality-review.md#candidate-34-installed-and-native-results).
Because the existing C34 filename is protected, choose a fresh image filename
for any later source change. Keep at least about 3 GiB free in the builder for
the temporary and final ISO during assembly. The storage recovery receipts
retain exact backups and restore commands for retired old verification stages;
no broad store cleanup or permission change is required.

The repeatable source gate is:

```sh
python3 vm/verification/2026-10-03-app-suite-candidate-34/ui-integration/check-integration.py
```

Each run preserves its own logs and exact source hashes. Successful CPU widget,
private-bus and app workflows do not establish physical tearing, audible sound,
microphone capture, authentication or suspend/resume support.

## Candidate 35 verified checkpoint

C35 is a preserved sealed image. Boot it from the repository with one command;
the launcher selects HVF on Apple Silicon:

```sh
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-35.iso
```

Build later source changes into a fresh filename with one command:

```sh
./scripts/build-vm-in-parallels.sh moire-aarch64-next.iso
```

Choose an unused filename; the builder refuses to overwrite any fallback.
The underlying Linux-builder target remains `nix build .#moire-vm`. C35's
915-file frozen source snapshot, lockfile, build logs and package/ISO provenance
are preserved in `vm/verification/2026-10-03-app-suite-candidate-35/image-scope/`.
The SHA256 of `moire-aarch64-quality-35.iso` is
`c4ba2b80cb93bcdcb4325c86ea9491375b9989643b032211208be0528aaa127d`.
It is 1,208,446,976 bytes and read-only (`0400`). All 37 prior images and the
C33/C34/C35 software UTM review copies still match their recorded hashes.

The full installed app suite, native checks, primary reopen, residency and strict
motion checks all exit 0 against the exact C35 package. Direct QEMU/HVF and UTM
both launch the normal tty1 session automatically. C35 fixes unchanged audio
polling and verifies native Clear All and DND On/Off. Long-body wheel scrolling,
broader input, screenshot drag cropping, physical tearing and native media
qualification remain open. See [the scoped review](quality-review.md#candidate-35-installed-and-native-results).

The guest was powered off normally after evidence export; UTM is stopped with
input capture released and the coordinated graphics lease released. Guest data
still lives in RAM. Disposable overlays and QMP lifecycle automation remain the
next storage milestone. No new permissions, credentials or security changes
were introduced.

## Candidate 36 verified checkpoint

C36 adds opt-in keyboard reading to the shared scrolling widget and notification
history. It is the current sealed review image. Boot it with one command:

```sh
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-36.iso
```

Build subsequent source into an unused filename:

```sh
./scripts/build-vm-in-parallels.sh moire-aarch64-next.iso
```

The Linux-builder target remains `nix build .#moire-vm`. Rebuilding current source
does not automatically restore an earlier frozen checkpoint. C36's 918-file
snapshot and exact package/boot provenance are in
`vm/verification/2026-10-04-app-suite-candidate-36/image-scope/`.
The ISO is 1,208,614,912 bytes, mode `0400`, SHA256
`3adeb23d65f962cb21d52ad43146c3e8f3f5bdbe589c89b16a91254bde2d1158`.
The host suite and all five exact installed gates exit 0. Direct QEMU/HVF and
two UTM boots start the normal tty1 session automatically with zero restarts.

In the captured UTM software session, Super+N opens notifications. Tab selects
an action and Enter activates it. History initially focuses its reading body;
Page Down, End and Home visibly reach the middle, final notice and beginning.
Tab selects Back; Shift+Tab returns to the body. Back accepts Enter or Space.
Native Clear All has a matched service reply and independent readback while the
same producer remains alive. One uncaptured shortcut reached UTM's own New VM
sheet instead; capture and the guest's visible result must be checked.

Native wheel acceptance remains open. The bounded trace sees ordinary and
high-resolution wheel records reach Moire, but the cursor remains at `640,400`
and no notification viewport is hit. The observed context has no supported
pointer motion. This does not assign the cause to host control, UTM, the input
reader or rendering. Broader typing, drag cropping, physical tearing,
accelerated presentation and native media remain unaccepted.

For a RAM-only scroll diagnostic, add
`Environment=MOIRE_SCROLL_TRACE=1` to a session drop-in under `/run`, reload
systemd and restart the session as in the renderer example above. It is off by
default, arms on the first wheel event and stops after 120 seconds, 512 records
or 128 wheel records. It records allowed pointer coordinates/axes, hit bounds,
offsets and CPU paint checksums; it excludes key/button payloads and app text.
CPU paint evidence does not establish display presentation. Read it through
`journalctl -b -t moire-session`; a unit-only filter misses the desktop scope.

Both UTM runs were normally powered off after export; input capture and the
graphics lease are released. All 38 prior host images retain their full hashes,
as do C33–C36 software UTM copies. A separately preserved historical cache ISO
has unverified runtime provenance; it is a recovery copy, not an accepted image.
The first build ran out of builder space. Only verified, unrooted duplicate ISO
store paths were reclaimed after preserving full matching copies; no broad
garbage collection was used. Leave enough temporary capacity for both the ISO
and its build work. RAM state, disposable overlays and QMP scope are unchanged.
See [the scoped results](quality-review.md#candidate-36-scrolling-and-native-keyboard-results).
