# Authenticated native desktop on Apple Silicon

For the latest UTM VirGL image and visible greeter wave, see
[the R10 UTM instructions and scoped results](native-utm-virgl.md).
The R6 acceptance below remains the preserved software fallback.

This candidate extends the accepted R7 greeter/PAM probe to Moire's current
desktop. **Two real login/logout/fresh-greeter cycles passed on 2026-10-05.**
The current R6 image adds the approved centred AccountsService user picker,
selected-user password flow and same-process wrong/blank password retry. Moving software greeter pixels and live local Reduce motion
stop/resume passed. Files parent navigation passed in both preserved R3 cycles;
parent/history navigation passed in the preserved R2 checkpoint below. Wider app
workflows and graphics timing remain unqualified. The immutable R7
probe image remains a fallback; old Parallels images do not represent this source.

Use the installer, dedicated NixOS builder and exclusive VM coordination described
in [Native login probe](native-login-probe-vm.md). From the repository root, choose
a fresh output filename:

```sh
python3 scripts/build-native-login-probe.py --desktop --output moire-aarch64-native-desktop-local.iso
scripts/run-native-login-probe.sh vm/nixos/moire-aarch64-native-desktop-local.iso
```

The build helper snapshots current sources and pinned dependencies, runs Nix
inside the dedicated Linux builder, verifies the exported ISO and preserves
fallbacks. The launcher verifies the explicitly selected image against its
receipt. The graphical VM uses HVF, virtio graphics/input, a read-only ISO, RAM
for changes, no network and no writable data disk.

Sign in as the disposable account `moire-pam-test` with the public password
`moire-pam-test-only-20261004`. In R6, click the discovered account and enter the
password in its focused field. In older username-flow images, wait for the secret
prompt, then Tab from Cancel to the response field. The fixed installed session command starts the compositor
within greetd's real active PAM session on tty1. The compositor acquires graphics
and input through logind; it does not relocate seat ownership to a user service.
The shell starts only after authenticated seat acquisition and compositor startup.
The native branch does not expose the development `StartDesktop` handoff.

Files opens initially. Existing app launchers and file associations are registered
in the disposable home directory. Open the panel's session actions and choose
**Log out** to retire owned apps, release compositor devices and return to a new
greeter. Logout remains available if the system-management service is unavailable.
Other power actions remain explicitly unavailable.

This first desktop candidate supports one managed output and SHM clients with
EGL output rendering. Xwayland, independent client GPU/dmabuf access, multi-output
hotplug and additional system permissions are outside this checkpoint. No new
groups, ACLs, Polkit policy or root renderer grants are introduced. Audio/network
and other controls depend on existing services; unavailable services are not
enabled to make a control appear functional.

The lifecycle acceptance test requires two real graphical desktop/login/logout/fresh-greeter cycles,
with actual authenticated session identity, visible current Files/shell, complete
device release, and normal VM shutdown. App workflows and physical tearing need
separate evidence. Compilation or a device-free logout test alone is not acceptance.

Preserve R7 and the final accepted desktop image before unrelated desktop work.
Keep the exclusive VM reservation until normal shutdown is confirmed.

## Current tested image: C63 R6 centred greeter

The immutable `moire-aarch64-native-desktop-c63-r6.iso` is 992876544 bytes,
mode 0400, SHA256
`ddf3ab6306b353020dfd7281f3f040784a5537eaae489fb7431879681b337902`.
The greeter displays **Moire desktop · C63 R6**.

```sh
scripts/run-native-login-probe.sh vm/nixos/moire-aarch64-native-desktop-c63-r6.iso
```

AccountsService 23.13.9 discovered `moire-pam-test`. Real wrong and blank
passwords each produced PAM `AUTH_ERR`, returned an inline error in the same
greeter PID 769 and launched no desktop. A masked draft cleared on Change user
after acknowledged cancellation. Actual native pixels show the approved centred
layout, account initials, transparent desktop trigger and undimmed flyout with
only the fixed installed Moire Wayland session. Keyboard Enter on the focused
account also reached its password field. No avatar file or arbitrary session
catalogue is read.

Correct passwords reached desktop PID 3284/session 3 and PID 5892/session 7,
both UID 1000, Class=user, Active=yes, Seat=seat0, with visible current Files and
shell. Both logouts released devices completely, deactivated their PAM scopes
and returned to fresh moving user pickers. Reduce motion held the whole frame
unchanged for 14.244 seconds and resumed when disabled. All display owners
retired before normal shutdown; the extra PAM handoff used for shutdown is not
a third accepted desktop cycle. Builder and candidate returned QEMU exit zero.

[Evidence](../vm/verification/native-desktop-20261005T081531Z/candidate-acceptance.json)
records live acceptance separately from the unchanged initial build receipt.
Recheck the saved artifact, pixels, owners, source hashes and fallbacks:

```sh
python3 vm/verification/native-desktop-20261005T081531Z/verify-acceptance.py
```

All 67 earlier ISO size/mtime/mode records remain unchanged. R5's PAM repair is
preserved in [its acceptance record](../vm/verification/native-desktop-20261005T074513Z/candidate-acceptance.json).
R6 output remains software EGL llvmpipe LLVM 21.1.8/Mesa 26.1.8; hardware
acceleration, physical tearing, performance and wider app workflows remain
unqualified. Files reports the unavailable UDisks backend because this image
keeps that optional service disabled. See [the final handoff](../HANDOFF.md)
for the accepted design, source ownership, boot sample and remaining work.

## Preserved C63 R4 user picker

The immutable `moire-aarch64-native-desktop-c63-r4.iso` is 991037440 bytes,
mode 0400, SHA256
`b7a123d5391f11fdabfd70456a4b7325d32155afe900562230a855e728295ae0`.
The greeter displays **Moire desktop · C63 R4**.

```sh
scripts/run-native-login-probe.sh vm/nixos/moire-aarch64-native-desktop-c63-r4.iso
```

The approved guest AccountsService 23.13.9 supplies public account metadata
through a read-only provider. Actual pointer selection of `moire-pam-test`,
password entry, desktop launch, logout and a fresh moving user picker passed
twice. The native desktops were PID 3368/session 4 and PID 6132/session 8,
each UID 1000, Class=user, Active=yes, Seat=seat0. Both retired with complete
device release and their PAM scopes deactivated. Every greeter owner also
released completely. Normal ACPI shutdown after an extra authentication handoff
returned QEMU exit zero; that handoff is not a third accepted desktop cycle.

Moving backdrop pixels passed on the picker, password and both fresh post-logout
pickers. Reduce motion held the entire frame unchanged for 14.226 seconds and
resumed when switched off. Change user cleared a confirmed masked draft before
returning to choices after cancellation acknowledgement. A wrong password
produced real PAM `AUTH_ERR` and no user desktop. In this preserved R4 image, denial retires the greeter and greetd restarts it
into a fresh picker. The current R6 image uses the bounded retry repaired in R5.

Evidence is in `vm/verification/native-desktop-20261005T070814Z/`, including
`candidate-acceptance.json`, native screenshots, serial logs and a rerunnable
`verify-acceptance.py`. The build receipt and image provenance retain their
initial acceptance=false/pending values; the separate record contains live
acceptance. Installed Linux checks passed five actual Window user-picker cases
and six private D-Bus provider cases alongside existing native checks. Those
fixture checks do not claim native authentication.

Output remains software EGL with llvmpipe LLVM 21.1.8 and Mesa 26.1.8.
Hardware acceleration, performance and physical tearing remain unqualified.
The R3 Files pointer proof below is historical and was not repeated in R4.
All 65 earlier ISO size/mtime/mode records remain unchanged. See
[Native greeter user picker](native-user-picker.md) for the metadata boundary,
source checks and explicit limits.

## Preserved C63 R3 software greeter wave

The immutable `moire-aarch64-native-desktop-c63-r3.iso` is 990447616 bytes,
SHA256 `2496fcbd387432c392f30dbf8a8369175ca1dfacc8a01633028750e43e8ac5eb`.
The greeter displays **Moire desktop · C63 R3**. The QEMU window title and
launcher output identify the selected ISO, so an old Parallels copy cannot be
mistaken for this tested snapshot.

```sh
scripts/run-native-login-probe.sh vm/nixos/moire-aarch64-native-desktop-c63-r3.iso
```

Evidence is in `vm/verification/native-desktop-20261005T060554Z/`.
`candidate-acceptance.json` records the precise accepted scope. Native
backdrop-only pixels changed between `wave-initial.png` and `wave-after.png`.
In Accessibility, Tab from Stronger status text to **Reduce motion**, then Space
to toggle it. `reduced-first.png` and `reduced-held.png` have identical full-frame
pixels across 14.226 seconds. Toggling off resumed backdrop changes in
`resumed.png`. The crop excludes the clock, form and accessibility popover.

The current software wave is an explicit greeter-only Window policy. It requires
actual current-token software output acceptance, visible geometry and a matching
frame opportunity. Submission or a frame callback alone cannot start it.
The existing Wayland gate allows one outstanding frame; motion advances at most
once per 100ms using the existing scheduler. Ordinary windows keep hardware-only
admission. Unknown/replaced accepted output and backend loss revoke motion;
new pending commits hold their phase. The checkbox uses application overrides
with `source=application`, never user-session preferences or pre-authentication
home discovery. The immutable Silk source and per-window ownership are reused.

Two actual login/logout cycles reached native desktops PID 3271/session 3 and
PID 5902/session 7, each UID 1000, Class=user, Active=yes, Seat=seat0. Both
released devices completely and their PAM scopes retired. Fresh greeters after
both logouts showed moving backdrop pixels. The greeter owners 761, 3403 and
6004 also retired with complete release. Files Alt+Up reached Home in both
cycles. R2's history navigation repair is retained, but R3 did not repeat its
history workflow. Normal ACPI shutdown during an extra authenticated handoff
returned QEMU exit zero; this is not a third accepted cycle. The builder also
exited zero, and all earlier ISO size/mtime/mode records remain unchanged.

Linux Node 22 build checks exercised admission, wire token/acceptance ordering,
CPU backdrop pixels and the actual checkbox, alongside the existing native
keymap, input/raster liveness, Files modifier and retirement checks. Source-only
observations are explicitly synthetic; native acceptance rests on the running
VM pixels and session logs. `source-checks.json` and `source-sha256.json` record
these checks and the image's sources.

Output remains **software EGL, llvmpipe LLVM 21.1.8, Mesa 26.1.8**.
`frame-cost-observations.json` records a bounded journal sample and full-output
damage of 1024000 pixels with a 4096000-byte client SHM buffer. Journal receipt
spacing is not motion-step or physical display timing, and copy duration was
not instrumented. No hardware acceleration, smoothness, performance or tear-free
claim follows from the moving pixels. The separate pointer proof below covers
Files sidebar and folder navigation; full associations and the wider app suite
remain unqualified. Preserve C63 R3, C63 R2 and R7 before
further work.

## Files pointer proof on unchanged C63 R3

Evidence: `vm/verification/pointer-abs-20261005T062623Z/pointer-acceptance.json`.
Actual absolute tablet input changed the visible Files directory: Home from
several different directories, Downloads and Desktop sidebar entries, and a
double-click on Documents. Guest evdev logs establish input delivery, and the
screenshots establish the resulting directory. No production defect was
reproduced, so no source repair or replacement image was needed.

The earlier HMP attempt reproduced an unchanged frame without pointer motion.
In [QEMU 10.1.2's HMP implementation](https://raw.githubusercontent.com/qemu/qemu/v10.1.2/ui/ui-hmp-cmds.c),
`mouse_move` sends relative axes; this VM's selected device is an absolute
tablet. The successful diagnostic instead used absolute `input-send-event`
coordinates through a private, owned UNIX QMP socket. This socket grants no TCP
access and was used only for input/query diagnostics; VM lifecycle automation
remains deferred.

`scripts/qemu-pointer-probe.py` validates the socket owner and selected absolute
device, scales coordinates for the fixed 1280×800 output, and saves input
requests/replies in an evidence directory. For a running diagnostic instance:

```sh
python3 scripts/qemu-pointer-probe.py --socket /path/to/owned/input.sock \
  --evidence /path/to/evidence click 120 211
```

The helper itself passed live Home/Desktop navigation. Both diagnostic VMs
released their native session owners and exited normally with QEMU status zero;
all fallback image metadata remained unchanged. Scrolling, dragging, file
associations, other apps and physical tearing are outside this pointer proof.

## Earlier authentication checkpoint

The preserved read-only image is `moire-aarch64-native-desktop-c63.iso`,
990439424 bytes, SHA256
`2e3012cee3b179f11730d38ed0b198e8238575462cf237a073df323684ac2547`.
To boot that exact tested snapshot after coordinating the VM window:

```sh
scripts/run-native-login-probe.sh vm/nixos/moire-aarch64-native-desktop-c63.iso
```

Evidence is in `vm/verification/native-desktop-20261005T043829Z/`, including
`candidate-acceptance.json`, serial logs and desktop/logout/fresh-greeter screenshots.
The actual compositor owners were PID 3270 and 5901, each in an active UID 1000
user session on seat0 (`session-3.scope`, `session-7.scope`). Both retired with
complete release, their PAM scopes deactivated, and greetd displayed a fresh
native greeter. Three native keymap groups passed. Normal shutdown returned QEMU
exit zero; previous image metadata remained unchanged.

This is **authentication/session-lifecycle acceptance only**. Files rendered its
current view, but Alt-Up and a monitor-injected Home click did not visibly change
the directory. At that checkpoint the cause was not isolated. The keyboard modifier cause and
repair are documented below. Pointer navigation, associations and the broader
app workflows remain unqualified.
The software EGL renderer also needs performance work, and no physical tearing
qualification is claimed. Preserve this checkpoint before those investigations.

The first build evaluation stopped on a conflicting ISO volume-ID override,
produced no image, and shut down normally. The corrected build and its installed
Linux Node 22 liveness, callback ordering, raster recovery, app retirement and
logout-dispatch checks passed. The failed evaluation evidence remains in
`vm/verification/native-desktop-20261005T043734Z/`.

## Native Files keyboard regression

The C63 navigation fault was a missing compositor modifier event. The client
correctly follows the advertised XKB masks, but C63 sent only keys and zero masks
on focus entry. Alt-Up therefore arrived as an unmodified ArrowUp. The repair
tracks server XKB state from the same keymap memfd, sends changed masks after
key delivery, and initializes focus from the current mask. Repeat packets do
not change lock or depression state. The keymap producer is unchanged.

After reserving the dedicated offline builder window, reproduce the preserved
C63 failure and compare the repair with:

```sh
python3 scripts/probe-native-files-interaction.py
```

`vm/verification/files-interaction-20261005T051358Z/result.json` records the
successful comparison and normal QEMU exit zero. The baseline delivered
ArrowUp with Alt false and no directory action. The repair delivered Alt true,
applied Files' actual parent-directory action, and matched both SHM pixels and
the damaged output against a separate fresh full-scene raster. The test runs
as UID 65534 through a Linux pipe, the real evdev reader, compositor/shell, Unix
Wayland socket and public Files window. It acquires no devices, seat, PAM session
or GPU. Shift/Ctrl/Alt/Super edges, Shift text, Caps Lock, stable repeats and a
fresh client initialized from held modifiers also passed native XKB checks.

The desktop package runs these focused native checks while building. Their
types can be checked with:

```sh
pnpm --filter @moire/core exec tsc --noEmit -p ../../scripts/tsconfig.native-files.json
```

Earlier comparison attempts stopped in fixture setup, before input delivery:
the launcher inherited an inaccessible `/root` working directory, then the
fixture needed a direct shell-source import. These failures are retained and
do not count as baseline reproduction. The existing non-native
`keyboard-focus.smoke.mjs` fixture assumes unavailable-keymap text translation
from before the mask-only client and fails that assumption; it is not counted
as passing evidence.

The older Home-click attempt never established evdev pointer delivery. Pointer
navigation, file associations, other apps and physical tearing remain outside
this keyboard proof.

## Preserved Files navigation checkpoint: C63 R2

The read-only `moire-aarch64-native-desktop-c63-r2.iso` is 990521344 bytes,
SHA256 `bb59de8e35c214f892077115fe9b4310f0589abd92df3027a85673d3bcd081b8`.
After coordinating the VM window, boot this exact tested snapshot:

```sh
scripts/run-native-login-probe.sh vm/nixos/moire-aarch64-native-desktop-c63-r2.iso
```

Evidence is in `vm/verification/native-desktop-20261005T051611Z/`, including
`candidate-acceptance.json`. Two real login/logout/fresh-greeter cycles passed
with compositor PID 3270 in `session-3.scope` and PID 6242 in `session-7.scope`.
Both were active UID 1000 user sessions on seat0. Both released devices
completely, and both PAM scopes deactivated. Files visibly navigated from
Desktop to Home with Alt-Up in each session. Alt-Left returned to Desktop and
Alt-Right restored Home during the first session; the captured folder contents
and breadcrumb changed accordingly.

The session-menu test initially assumed a fixed Tab count and selected other
controls. Use Super-Q, then Shift-Tab to reach the final session-action control,
Enter to open Power, then Tab and Enter for Log out. Confirm the visible target
before activation. A separate `packages/shell/src/logout-keyboard.smoke.ts`
checks this traversal against the actual shell. The corrected native path
completed both logouts; no menu implementation repair or latency qualification
is claimed.

The builder and graphical candidate both shut down normally with QEMU exit
zero. All earlier fallback sizes, timestamps and modes remained unchanged.
C63 and R7 are still preserved. The extra authenticated handoff used for normal
ACPI shutdown is not counted as a third desktop cycle.

This acceptance covers authentication/session lifecycle and Files keyboard
parent/history navigation only. Pointer activation, file associations, broader
app workflows, animation timing, software EGL performance and physical tearing
remain unqualified. The renderer is llvmpipe with direct GBM scanout; this is
not evidence of hardware acceleration or physical display timing.
