# Removable drives

C48 adds source support for live removable-drive discovery and explicit actions in Files. C49 verifies installed UDisks without normal-user authorization. C50 verifies normal-user actions in the optional `moire-removable-desktop` image. The default VM configuration still leaves UDisks and Polkit disabled.

## Files behavior

The Drives sidebar lists removable filesystems observed through the shared management service. Opening a mounted row uses its observed mount path. Opening an unmounted row requests Mount when actions are enabled, then waits for a mounted observation before opening the initiating tab.

Drive menus offer Unmount and safe removal when applicable. A busy file transfer blocks drive actions. Unplugging a volume or losing its producer returns affected tabs and histories to Home. Favorites stay unchanged.

Safe removal stays disabled while any related volume is mounted. Unmount those volumes first. Refresh remains available beside the sidebar status, including when no volumes are listed. Switching tabs cancels pending mount-and-open navigation.

## System integration

`org.moire.Storage1` is exported at `/org/moire/Storage1` on the existing `org.moire.SystemManagement1` session name. Files opens only a session-bus client. The management service observes an already-running `org.freedesktop.UDisks2` system-bus owner; it does not activate that service.

`MOIRE_STORAGE_CONTROL` defaults to `readonly`. `interactive` permits requests through existing UDisks authorization. It does not itself grant permission or start an authentication prompt. Invalid policy fails closed. The optional C50 image supplies the bounded authorization described below. It leaves `/etc/moire` and Moire's existing groups unchanged.

Safe removal considers all related mounts, including hidden filesystems and encrypted descendants. USB PowerOff requires the relevant capability and no shared sibling hazard. Eject requires an ejectable drive. Unresolved topology disables removal. No action forces unmount, unlocks encryption, repairs, formats or automatically mounts a disk.

Permission and busy errors are explicit. A timeout or owner change can leave an unknown outcome because cancellation cannot undo a daemon action. Refresh reads current state; mutations never retry automatically.

## Verification limits

From the repository root, run the focused source checks into a new receipt directory:

```sh
python3 scripts/check-removable-drives.py --output /tmp/moire-drive-checks
```

The command saves each actual exit and log. Choose a fresh output path for a later run.

The C48 tests use private D-Bus daemons and injected drive state. UI tests use disposable directories and public Window controls. They do not mount or eject storage, connect to a production UDisks service, or validate kernel/USB behavior.

Physical removable hardware, encrypted unlock and automatic mounting remain unqualified. C48 withdrawal checks use logical mount roots; symlink aliases and physical unplug during an existing file transfer remain unqualified. See the [C48 evidence](../vm/verification/2026-10-04-c48-removable-drives/README.md).

## Installed disposable test (C49)

The `moire-storage-probe` image enables stock UDisks before Moire and sets the request policy to `interactive`. Polkit remains forced off, custom rules remain empty, and Moire keeps its existing groups. This variant supplies no new storage authorization.

The installed test used one exclusively new 64 MiB emulated USB disk, guarded by its exact size and serial `MOIREC48DISPOSABLE` before initialization. Neither the personal disk nor a host device was attached. Discovery, hot unplug, withdrawal and reconnect passed through the installed management service as UID 1000. Reconnect produced a new volume identity.

The normal user's mount request returned a typed permission denial. Separately labelled UID 0 checks mounted the fixture, read its exact marker bytes, unmounted it and powered off the USB device. Its bytes survived reconnect. Files displayed the observed mount and withdrew the row after removal.

Root's mount path was `/run/media/root/MOIRE-C48-FIXTUR`. Reading that fixture as UID 1000 returned `EACCES`. Normal-user mounting and browsing are therefore blocked under this configuration; root success does not qualify those workflows. No ACL, shared mount, fstab or authentication workaround was added.

The guest reached its desktop and powered down normally. Its QEMU process retired, but the host runner reported exit 1 without an established cause. That exit remains unqualified. Build recovery, command receipts, screenshots and the exact limitations are in the [C49 evidence](../vm/verification/2026-10-04-c49-installed-removable-drives/README.md). Build and desktop boot commands are in [the VM guide](nixos-vm.md#disposable-removable-drive-integration-c49).

## Optional normal-user authorization (C50)

The separate `moire-removable-desktop` target starts UDisks and Polkit before Moire and uses the `interactive` request policy. Neither the default target nor `moire-storage-probe` enables this allowance. Build and run commands are in [the VM guide](nixos-vm.md#optional-removable-desktop-c50).

The shipped rule permits exactly these actions when Polkit reports a local, active caller and UDisks supplies `drive.removable` as the string `"true"`:

- `org.freedesktop.udisks2.filesystem-mount`
- `org.freedesktop.udisks2.eject-media`
- `org.freedesktop.udisks2.power-off-drive`

The later deny rule rejects all other non-root Polkit requests, including stock active-user allowances. Root keeps its recovery authority. The pkexec setuid wrapper, authentication-helper socket and helper service are disabled. Native evidence records both units masked and packaged helper binaries without setuid permissions. Moire starts no authentication agent and retains its existing groups.

Root can edit `/etc/polkit-1/rules.d/00-moire-removable.rules`. The boot copies this regular file only when absent; it does not overwrite later edits. These edits belong to the RAM-backed `/etc/polkit-1` and do not persist through reboot. The immutable `01-moire-deny-unapproved.rules` rejects requests when the allowance is absent or syntax-invalid. Polkit stops at the first result, so this fallback cannot override an earlier broad YES added by root. The three-action ceiling describes the shipped rule, not arbitrary administrative edits.

Polkit 127's active flag is UID-wide and does not prove that the caller's exact process is on the foreground VT. UDisks can unmount a volume mounted by the same UID without a Polkit check. Browsing an existing mount uses filesystem permissions, and loss of session activity does not revoke open files. This policy therefore does not gate all unmounts or file reads on active-session authorization.

C50 used one new 64 MiB emulated USB disk with serial `MOIREC50DISPOSABLE`. Pointer-driven Files actions as UID 1000 mounted it, opened its observed mount path and displayed the marker file, then unmounted it. The **Eject** menu action mapped to one UDisks PowerOff request for this USB fixture; the drive disappeared. No UDisks Eject method was invoked. The `eject-media` authorization query succeeded, but optical Eject remains unqualified. Reconnect produced a new identity, and another mount/read verified the exact marker bytes survived. The production management PID's authorization log recorded local, active and removable facts. Separate checks denied unapproved actions and a non-local caller.

The guest powered down normally. QEMU and its logger each reported exit 0; these results do not resolve C49's earlier runner exit 1. The read-only C50 ISO is `vm/nixos/moire-aarch64-quality-50-removable-desktop.iso`, mode `0400`, SHA256 `84be18683b0f62c68f71a394ac78734be8a6c5342eef29bdfcc67f6c7b6c248c`. All 52 fallback images and the personal data disk remained untouched. The [C50 evidence](../vm/verification/2026-10-04-c50-removable-desktop/README.md) records the xz build recovery, native screenshots, authorization checks and process exits.

Typing, physical tearing, VT switching, physical removable hardware and optical-media behavior remain unqualified. The emulated USB success does not extend to those workflows.
