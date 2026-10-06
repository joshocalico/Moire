# Disposable real-PAM VM test

This separate candidate runs stock greetd/agreety and Linux PAM, then the frozen
C57 harmless session probe. It does not start Moire's compositor or desktop.
It is not secure lock or graphical-seat qualification.

The only normal account is `moire-pam-test`, UID 1000. Its deliberately public,
disposable password is `moire-pam-test-only-20261004`. Standard NixOS first-boot
account activation installs it. Never reuse this credential or attach real data.
Root is locked, autologin and SSH are disabled, and authentication denies blank
passwords. The account has no administrative or persistent device groups.

Build using the existing ARM64 Linux builder:

```sh
./scripts/build-vm-in-parallels.sh moire-aarch64-pam-test.iso moire-pam-test
```

The build refuses to overwrite any exported image. Choose a fresh output name if
that name already exists. The existing Linux builder needs room for dependencies,
ISO construction and the retained result. No broad garbage collection is part of
this command.

Coordinate an exclusive VM window with Recovery, then boot on Apple Silicon:

```sh
./scripts/run-pam-test.sh vm/nixos/moire-aarch64-pam-test.iso
```

The launcher uses HVF and a read-only ISO. Writable guest state stays in RAM. It
attaches no NIC, writable disk, host share or host device, and forwards no ports.
The VM console accepts the public test username/password. Use the monitor's
`system_powerdown` command for ordinary guest shutdown; do not mistake closing a
window for proof of normal shutdown. Discarding RAM discards credential changes.

## Native identity observations

A candidate-only observer asks login1 for the fixed launcher's actual process ID
and checks the canonical session account, UID and class against kernel
credentials. It records the PAM/logind session and cgroup before executing C57.
An observer around the harmless probe separately records its owned user-service
cgroup. These two placements must not be conflated. No environment-supplied
session ID establishes identity.

Receipts are public metadata sent to the guest journal, which this candidate also
forwards to its serial console. The fixed supervisor runs through `systemd-cat`
so its entry and exit status survive the greeter clearing tty1. That command
executes the supervisor with the same process identity and PAM session.
Fixture injection is unset by the installed
launcher, fixture executables are not installed, and arbitrary session commands
are not accepted. Profile sourcing is disabled for the fixed workload.

## Verification

The C58 revision built and booted on Apple Silicon with HVF. The actual guest
rejected an incorrect and a blank password before any authenticated probe ran.
It then completed two successful PAM login/probe/return-to-agreety cycles. Both
showed UID 1000, active tty sessions on seat0, distinct logind session scopes,
matching unique probe services, and supervisor exit code 0. The probe's user
service cgroup was recorded separately from each PAM session. Both fresh greeter
frames were inspected, both user managers stopped, and ordinary guest poweroff
ended QEMU and its runner with exit code 0.

The tested immutable image is
`vm/nixos/moire-aarch64-c58-real-pam-r2.iso`, SHA-256
`6ae1d6ae17b7c4d5b7a9f0e7585d292e97a976b361e623c1386f7017e4707b90`.
After coordinating the VM window, boot this retained image with:

```sh
./scripts/run-pam-test.sh
```

The evidence, earlier failed builds and initial native run are preserved under
`vm/verification/2026-10-05-c58-real-pam`. Recheck the final recorded workflow:

```sh
python3 vm/verification/2026-10-05-c58-real-pam/verify-native.py
```

The small builder needed guarded reclamation of two redundant ISO cache copies.
Their independently verified host copies remain read-only. Package preparation
used the builder's native Linux filesystem because the Parallels shared mount
cannot create FIFOs. Only the large ISO assembly used that shared mount. The
checkpoint's `evaluate-builder.sh` and `build-candidate.sh` record that build
route and refuse to overwrite the exported image.

This qualifies the fixed probe's native login workflow only. It does not qualify
Moire graphics, native application typing, secure lock, crash cleanup, or an
installer. Frozen C57's earlier fixture qualification is unchanged.
