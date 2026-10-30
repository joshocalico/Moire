#!/usr/bin/env python3
"""Build the native login probe in a dedicated NixOS QEMU/HVF guest."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import socket
import subprocess
import tarfile
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
MEDIA = "nixos-minimal-26.05.11150.825e2028c29b-aarch64-linux.iso"
MEDIA_SHA = "d621a3fc1fa60d2864729abcf3bbcfd88652c86650621d6d9025015113a0527b"

def run_guest(command, monitor, log_path, script, marker, timeout, installer=False):
    """Own one guest until normal shutdown; preserve its console on every failure."""
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    buffer = bytearray()
    with log_path.open("wb") as log:
        def wait_for(pattern, seconds):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                plain = re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", bytes(buffer))
                failed = re.search(rb"MOIRE_NATIVE_COMMAND_EXIT=([1-9][0-9]*)\r?\n", plain)
                if failed:
                    raise RuntimeError(f"Guest command exited {int(failed[1])}; see {log_path}")
                if re.search(pattern, plain):
                    buffer.clear()
                    return
                if process.poll() is not None:
                    raise RuntimeError(f"Builder exited {process.returncode}; see {log_path}")
                for key, _ in selector.select(1):
                    data = os.read(key.fileobj.fileno(), 65536)
                    if data:
                        log.write(data)
                        log.flush()
                        buffer.extend(data)
                        print(data.decode("utf8", "replace"), end="", flush=True)
            raise TimeoutError(f"Builder console marker was not reached; see {log_path}")

        def poweroff():
            with socket.socket(socket.AF_UNIX) as control:
                control.settimeout(5)
                control.connect(str(monitor))
                def prompt():
                    response = b""
                    while b"(qemu)" not in response:
                        chunk = control.recv(65536)
                        if not chunk:
                            return
                        response += chunk
                prompt()
                control.sendall(b"system_powerdown\n")
                prompt()
            deadline = time.monotonic() + 90
            while process.poll() is None:
                if time.monotonic() >= deadline:
                    raise subprocess.TimeoutExpired(command, 90)
                for key, _ in selector.select(1):
                    data = os.read(key.fileobj.fileno(), 65536)
                    if data:
                        log.write(data)
                        log.flush()
                        print(data.decode("utf8", "replace"), end="", flush=True)
            if process.returncode != 0:
                raise RuntimeError(f"QEMU exited {process.returncode}; see {log_path}")

        try:
            wait_for(rb"\]\s*[#$]", 180)
            if installer:
                process.stdin.write(b"sudo -i\n")
                process.stdin.flush()
                wait_for(rb"\]\s*#", 20)
            # Disable console echo before transferring the script. Credentials are never sent here.
            process.stdin.write(b"stty -echo\nprintf '\\nMOIRE_NATIVE_COMMAND_READY\\n'\n")
            process.stdin.flush()
            wait_for(rb"MOIRE_NATIVE_COMMAND_READY\r?\n", 20)
            encoded = base64.b64encode(script.encode()).decode()
            process.stdin.write(b"rm -f /tmp/moire-native-command.b64\n")
            for offset in range(0, len(encoded), 1024):
                process.stdin.write(f"printf %s '{encoded[offset:offset+1024]}' >> /tmp/moire-native-command.b64\n".encode())
            process.stdin.write(b"base64 -d /tmp/moire-native-command.b64 >/tmp/moire-native-command.sh; bash /tmp/moire-native-command.sh; status=$?; printf '\\nMOIRE_NATIVE_COMMAND_EXIT=%s\\n' \"$status\"\n")
            process.stdin.flush()
            wait_for(marker, timeout)
            poweroff()
        finally:
            try:
                if process.poll() is None:
                    try:
                        poweroff()
                    except (OSError, subprocess.TimeoutExpired):
                        print("Builder did not power off normally; VM ownership remains reserved. Do not start another guest.")
                        raise
            finally:
                selector.close()
    return process.returncode

def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="moire-aarch64-native-login-probe-c62.iso")
    parser.add_argument("--desktop", action="store_true", help="Build the authenticated native desktop checkpoint")
    parser.add_argument("--dm", choices=["greetd", "moire-dm"],
                        help="Login daemon for the desktop image (docs/moire-dm.md); moire-dm is the default, greetd rolls back")
    args = parser.parse_args()
    if args.dm and not args.desktop:
        parser.error("--dm selects the desktop image's login daemon; pass --desktop too")
    dm = (args.dm or "moire-dm") if args.desktop else None
    checkpoint = "c63-native-desktop" if args.desktop else "c62-native-login-probe"
    if dm == "greetd":
        checkpoint += "-greetd"
    image_base = "moire-aarch64-native-desktop" if args.desktop else "moire-aarch64-native-login-probe"
    expression = "nix/moire-native-desktop-image.nix" if args.desktop else "nix/moire-native-login-probe-image.nix"
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*\.iso", args.output):
        parser.error("Use a fresh simple ISO filename")
    if os.uname().sysname != "Darwin" or os.uname().machine != "arm64":
        parser.error("Requires Apple Silicon macOS and an exclusive Recovery VM window")
    qemu = shutil.which("qemu-system-aarch64")
    if not qemu or not shutil.which("qemu-img"):
        parser.error("Existing QEMU tools are required")
    if subprocess.run(["pgrep", "-f", r"(^|/)qemu-system-aarch64( |$)"], capture_output=True).returncode == 0:
        parser.error("Another ARM64 QEMU guest owns the VM window")
    output = ROOT / "vm/nixos" / args.output
    if output.exists():
        parser.error("Existing images are fallbacks. Choose a fresh output filename")
    receipt = output.with_suffix(".build.json")
    if receipt.exists():
        parser.error("An existing build receipt uses this output filename; choose a fresh one")
    builder = ROOT / "vm/builders"
    installer = builder / MEDIA
    if not installer.is_file() or digest(installer) != MEDIA_SHA:
        parser.error("Missing verified official NixOS installer. See docs/native-login-probe-vm.md")
    evidence = ROOT / "vm/verification" / (("native-desktop-" if args.desktop else "native-login-") + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    evidence.mkdir(parents=True)
    before = {str(p.relative_to(ROOT)): [p.stat().st_size, p.stat().st_mtime_ns, p.stat().st_mode]
              for p in (ROOT / "vm/nixos").glob("*.iso")}
    (evidence / "fallbacks-before.json").write_text(json.dumps(before, indent=2) + "\n")
    (evidence / "installer.json").write_text(json.dumps({"filename": MEDIA,
        "sha256": MEDIA_SHA, "bytes": installer.stat().st_size}, indent=2) + "\n")
    disk = builder / "moire-native-builder-c62.qcow2"
    installed = builder / "moire-native-builder-c62.installed"
    first = not disk.exists()
    if not first and not installed.exists():
        parser.error("An unfinished dedicated builder disk exists. Preserve it and diagnose before retrying")
    if first:
        subprocess.run(["qemu-img", "create", "-f", "qcow2", str(disk), "64G"], check=True)
    export = evidence / "candidate-export.raw"
    with export.open("xb") as stream:
        stream.truncate(4 * 1024 ** 3)
    with tempfile.TemporaryDirectory(prefix="moire-native-") as temporary:
        work = Path(temporary)
        payload = work / "source"
        payload.mkdir()
        hashes = {}
        # An 8.3 name survives both ISO9660 and Joliet without filename mangling.
        with tarfile.open(payload / "source.tgz", "w:gz") as archive:
            for top in ["apps", "packages", "themes", "docs", "nix", "scripts", "package.json", "pnpm-lock.yaml",
                        "pnpm-workspace.yaml", ".npmrc", "tsconfig.json", "tsconfig.base.json", "flake.nix", "flake.lock"]:
                start = ROOT / top
                files = start.rglob("*") if start.is_dir() else [start]
                for path in files:
                    relative = path.relative_to(ROOT)
                    if (not path.is_file() or path.is_symlink() or
                        any(part in {"node_modules", "dist", "__pycache__", ".git"} for part in relative.parts) or
                        path.name.startswith(".env") or path.suffix in {".log", ".pyc", ".tsbuildinfo"}):
                        continue
                    hashes[str(relative)] = digest(path)
                    archive.add(path, arcname=str(relative), recursive=False)
        (evidence / "source-sha256.json").write_text(json.dumps(hashes, indent=2) + "\n")
        source_iso = work / "source.iso"
        subprocess.run(["hdiutil", "makehybrid", "-iso", "-joliet", "-iso-volume-name", "MOIRE_NATIVE_SOURCE",
                        "-joliet-volume-name", "MOIRE_NATIVE_SOURCE",
                        "-o", str(source_iso), str(payload)], check=True, stdout=subprocess.DEVNULL)
        monitor = work / "monitor.sock"
        firmware = Path(qemu).parent.parent / "share/qemu/edk2-aarch64-code.fd"
        if not firmware.is_file():
            raise RuntimeError("Missing existing ARM64 UEFI firmware")
        command = [qemu, "-name", "Moire NixOS Native Builder", "-machine", "virt", "-accel", "hvf",
                   "-cpu", "host", "-smp", "4", "-m", "4096", "-bios", str(firmware),
                   "-drive", f"file={str(disk).replace(',', ',,')},format=qcow2,if=none,id=builder",
                   "-device", "virtio-blk-pci,drive=builder,serial=MOIRE_NATIVE_BUILDER",
                   "-drive", f"file={str(export).replace(',', ',,')},format=raw,if=none,id=export",
                   "-device", "virtio-blk-pci,drive=export,serial=MOIRE_NATIVE_EXPORT",
                   "-device", "virtio-scsi-pci,id=scsi",
                   "-drive", f"file={source_iso},format=raw,if=none,id=source,media=cdrom,readonly=on",
                   "-device", "scsi-cd,drive=source", "-device", "virtio-rng-pci",
                   "-netdev", "user,id=dependency-net", "-device", "virtio-net-pci,netdev=dependency-net",
                   "-display", "none", "-serial", "stdio", "-monitor", f"unix:{monitor},server=on,wait=off"]
        install = '''set -euo pipefail
test "$(lsblk -dn -o SERIAL /dev/vda | xargs)" = MOIRE_NATIVE_BUILDER
test "$(blockdev --getsize64 /dev/vda)" = 68719476736
parted --script /dev/vda mklabel gpt mkpart ESP fat32 1MiB 513MiB set 1 esp on mkpart primary ext4 513MiB 100%
udevadm settle
mkfs.fat -F32 -n MOIRE_EFI /dev/vda1
mkfs.ext4 -L MOIRE_BUILD_ROOT /dev/vda2
mount /dev/vda2 /mnt
mkdir -p /mnt/boot
mount /dev/vda1 /mnt/boot
nixos-generate-config --root /mnt
cat > /mnt/etc/nixos/configuration.nix <<'NIX'
{ pkgs, ... }: {
  imports = [ ./hardware-configuration.nix ];
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = false;
  boot.kernelParams = [ "console=ttyAMA0,115200" ];
  networking.hostName = "moire-native-builder";
  networking.useDHCP = true;
  services.openssh.enable = false;
  services.getty.autologinUser = "root";
  users.users.root.initialHashedPassword = "!";
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
  environment.systemPackages = [ pkgs.coreutils pkgs.util-linux pkgs.gnutar pkgs.gzip ];
  system.stateVersion = "26.05";
}
NIX
nixos-install --root /mnt --no-root-passwd
echo MOIRE_NATIVE_INSTALL_DONE
'''
        guest = '''set -euo pipefail
mkdir -p /tmp/moire-native-source
mount -o ro /dev/disk/by-label/MOIRE_NATIVE_SOURCE /tmp/moire-native-source
ls -la /tmp/moire-native-source
source_dir=$(mktemp -d /var/tmp/moire-native-source.XXXXXXXX)
tar -xzf /tmp/moire-native-source/source.tgz -C "$source_dir"
cd "$source_dir"
df -h /nix
# Each checkpoint adds a full image closure to the dedicated builder; reclaim unreferenced
# store paths when space runs low rather than failing at the final ISO write.
if [ "$(df --output=avail -B1G /nix | tail -1 | tr -d ' ')" -lt 12 ]; then
  nix-collect-garbage >/dev/null
  df -h /nix
fi
nix build --impure --file nix/moire-native-login-probe-image.nix --out-link /var/tmp/moire-native-login-result --max-jobs 2 --cores 4 -L
image=/var/tmp/moire-native-login-result/iso/moire-aarch64-native-login-probe.iso
test -f "$image"
test "$(stat -c %s "$image")" -le "$(blockdev --getsize64 /dev/vdb)"
test "$(lsblk -dn -o SERIAL /dev/vdb | xargs)" = MOIRE_NATIVE_EXPORT
echo "MOIRE_NATIVE_IMAGE_BYTES=$(stat -c %s "$image")"
echo "MOIRE_NATIVE_IMAGE_SHA=$(sha256sum "$image" | cut -d ' ' -f1)"
dd if="$image" of=/dev/vdb bs=4M conv=fsync status=progress
echo MOIRE_NATIVE_BUILD_DONE
'''
        if dm:
            expression += " --argstr dmBackend " + dm
        guest = guest.replace("nix/moire-native-login-probe-image.nix", expression).replace(
            "iso/moire-aarch64-native-login-probe.iso", "iso/" + image_base + ".iso")
        if first:
            install_command = command + [
                "-drive", f"file={installer},format=raw,if=none,id=installer,media=cdrom,readonly=on",
                "-device", "scsi-cd,drive=installer,bootindex=1", "-boot", "order=d"]
            (evidence / "installer-qemu-command.json").write_text(json.dumps(install_command, indent=2) + "\n")
            run_guest(install_command, monitor, evidence / "installer.serial.log", install,
                      rb"MOIRE_NATIVE_INSTALL_DONE\r?\n", 3600, installer=True)
            installed.write_text("NixOS dedicated builder installed; see " + str(evidence) + "\n")
        build_command = command + ["-boot", "order=c"]
        (evidence / "builder-qemu-command.json").write_text(json.dumps(build_command, indent=2) + "\n")
        exit_code = run_guest(build_command, monitor, evidence / "builder.serial.log", guest,
                              rb"MOIRE_NATIVE_BUILD_DONE\r?\n", 7200)
        serial = (evidence / "builder.serial.log").read_text(errors="replace")
        size = int(re.findall(r"MOIRE_NATIVE_IMAGE_BYTES=(\d+)", serial)[-1])
        expected = re.findall(r"MOIRE_NATIVE_IMAGE_SHA=([a-f0-9]{64})", serial)[-1]
        if not 0 < size <= export.stat().st_size:
            raise RuntimeError("Invalid exported image size")
        output.parent.mkdir(parents=True, exist_ok=True)
        with export.open("rb") as source, output.open("xb") as destination:
            remaining = size
            while remaining:
                chunk = source.read(min(8 * 1024 ** 2, remaining))
                if not chunk:
                    raise RuntimeError("Incomplete exported image")
                destination.write(chunk)
                remaining -= len(chunk)
        if digest(output) != expected:
            raise RuntimeError("Export checksum mismatch; do not boot this output")
        output.chmod(0o400)
        after = {name: [(ROOT / name).stat().st_size, (ROOT / name).stat().st_mtime_ns,
                        (ROOT / name).stat().st_mode] for name in before}
        if after != before:
            raise RuntimeError("Fallback metadata changed")
        result = {"image": str(output), "imageName": output.name, "bytes": size,
            "sha256": expected, "qemuExit": exit_code, "fallbacksPreserved": True,
            "checkpoint": checkpoint, "graphicalAcceptance": "pending",
            "evidence": str(evidence)}
        if dm:
            result["loginBackend"] = dm
        result_text = json.dumps(result, indent=2) + "\n"
        (evidence / "result.json").write_text(result_text)
        with receipt.open("x") as stream:
            stream.write(result_text)
        receipt.chmod(0o400)
        print(f"Built immutable {output}; SHA256 {expected}")

if __name__ == "__main__":
    main()
