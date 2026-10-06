#!/usr/bin/env python3
"""Run a device-free liveness reproduction against retained R4 in the NixOS builder."""
import base64
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "/nix/store/barj1rqjy4v9dhyfcd4n8j4yr0fy8ad0-moire-native-login-0.0.0"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current-wayland", action="store_true", help="Apply only the current Wayland submission fix to the scratch copy")
    parser.add_argument("--native-greeter", action="store_true", help="Exercise the actual greeter view/controller with a synthetic asynchronous reply; no PAM")
    args = parser.parse_args()
    if subprocess.run(["pgrep", "-f", r"(^|/)qemu-system-aarch64( |$)"], capture_output=True).returncode == 0:
        raise SystemExit("Another ARM64 QEMU guest owns the VM window")
    qemu = shutil.which("qemu-system-aarch64")
    if not qemu:
        raise SystemExit("Existing QEMU is required")
    disk = ROOT / "vm/builders/moire-native-builder-c62.qcow2"
    if not disk.with_suffix(".installed").exists():
        raise SystemExit("Existing installed dedicated builder required")
    spec = importlib.util.spec_from_file_location("native_builder", ROOT / "scripts/build-native-login-probe.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    evidence = ROOT / "vm/verification" / ("login-liveness-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    evidence.mkdir()
    entry = "apps/system/greeter/src/native/liveness.native.smoke.tsx" if args.native_greeter else "packages/core/src/login-liveness.native.smoke.tsx"
    source = ROOT / entry
    (evidence / source.name).write_bytes(source.read_bytes())
    encoded = base64.b64encode(source.read_bytes()).decode()
    patch = ""
    if args.current_wayland:
        wire = ROOT / "packages/ui/src/platforms/wayland/index.ts"
        (evidence / "wayland-index.ts").write_bytes(wire.read_bytes())
        wire_bytes = base64.b64encode(wire.read_bytes()).decode()
        patch = f'''printf %s '{wire_bytes}' | base64 -d > "$workspace/source/packages/ui/src/platforms/wayland/index.ts"
sha256sum "$workspace/source/packages/ui/src/platforms/wayland/index.ts"
'''
    with tempfile.TemporaryDirectory(prefix="moire-liveness-") as temporary:
        monitor = Path(temporary) / "monitor.sock"
        firmware = Path(qemu).parent.parent / "share/qemu/edk2-aarch64-code.fd"
        command = [qemu, "-name", "Moire device-free liveness reproduction", "-machine", "virt",
                   "-accel", "hvf", "-cpu", "host", "-smp", "4", "-m", "4096", "-bios", str(firmware),
                   "-drive", f"file={disk},format=qcow2,if=none,id=builder",
                   "-device", "virtio-blk-pci,drive=builder,serial=MOIRE_NATIVE_BUILDER",
                   "-device", "virtio-rng-pci", "-nic", "none", "-display", "none", "-serial", "stdio",
                   "-monitor", f"unix:{monitor},server=on,wait=off", "-boot", "order=c"]
        (evidence / "qemu-command.json").write_text(json.dumps(command, indent=2) + "\n")
        # Copy the retained package into scratch, never modify its immutable store files.
        # Reuse its exact library/Node/tsx wrapper, replacing only the trusted test entry.
        script = f'''set -euo pipefail
test -d {PACKAGE}/lib/moire
workspace=$(mktemp -d /var/tmp/moire-liveness-source.XXXXXXXX)
chmod 755 "$workspace"
cp -a {PACKAGE}/lib/moire "$workspace/source"
chmod -R a+rX "$workspace/source"
chmod u+w "$workspace/source/{source.parent.relative_to(ROOT)}"
printf %s '{encoded}' | base64 -d > "$workspace/source/{entry}"
sed -e 's#{PACKAGE}/lib/moire#'"$workspace"'/source#g' -e 's#native-login-entry.mts#{entry}#g' {PACKAGE}/bin/moire-native-login-direct > "$workspace/run-test"
chmod 755 "$workspace/run-test"
echo 'MOIRE_LIVENESS_SOURCE_PACKAGE={PACKAGE}'
sha256sum "$workspace/source/packages/sys/src/readiness.ts" "$workspace/source/{entry}"
{patch}
cd "$workspace/source"
runuser -u nobody -- "$workspace/run-test"
echo MOIRE_NATIVE_LIVENESS_DONE
'''
        exit_code = helper.run_guest(command, monitor, evidence / "builder.serial.log", script,
                                     rb"MOIRE_NATIVE_LIVENESS_DONE\r?\n", 180)
    (evidence / "result.json").write_text(json.dumps({"qemuExit": exit_code, "package": PACKAGE,
        "deviceAccess": 0, "imageBuilt": False, "currentWayland": args.current_wayland, "nativeGreeter": args.native_greeter}, indent=2) + "\n")
    print(f"Liveness reproduction complete: {evidence}")

if __name__ == "__main__":
    main()
