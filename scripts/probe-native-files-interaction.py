#!/usr/bin/env python3
"""Compare preserved C63 with the modifier repair in the offline installed builder."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "/nix/store/c7ldc5w182q2h2jw1mab757blbpcn67w-moire-native-desktop-0.0.0"
ENTRY = "packages/core/test/files-interaction.native.smoke.tsx"
STATE_TEST = "packages/sys/test/keyboard-state.native.smoke.ts"
PATCHES = ["packages/core/src/server.ts", "packages/sys/src/index.ts", "packages/sys/src/keyboard-state.ts", STATE_TEST]


def transfer(relative, evidence):
    source = ROOT / relative
    saved = evidence / relative
    saved.parent.mkdir(parents=True, exist_ok=True)
    saved.write_bytes(source.read_bytes())
    encoded = base64.b64encode(source.read_bytes()).decode()
    return f'''mkdir -p "$workspace/source/{source.parent.relative_to(ROOT)}"
chmod u+w "$workspace/source/{source.parent.relative_to(ROOT)}"
printf %s '{encoded}' | base64 -d > "$workspace/source/{relative}"
sha256sum "$workspace/source/{relative}"
'''


def main():
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
    evidence = ROOT / "vm/verification" / ("files-interaction-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    evidence.mkdir()
    fixture = transfer(ENTRY, evidence)
    patch = "".join(transfer(file, evidence) for file in PATCHES)
    with tempfile.TemporaryDirectory(prefix="moire-files-interaction-") as temporary:
        monitor = Path(temporary) / "monitor.sock"
        firmware = Path(qemu).parent.parent / "share/qemu/edk2-aarch64-code.fd"
        command = [qemu, "-name", "Moire device-free Files reproduction", "-machine", "virt",
                   "-accel", "hvf", "-cpu", "host", "-smp", "4", "-m", "4096", "-bios", str(firmware),
                   "-drive", f"file={disk},format=qcow2,if=none,id=builder",
                   "-device", "virtio-blk-pci,drive=builder,serial=MOIRE_NATIVE_BUILDER",
                   "-device", "virtio-rng-pci", "-nic", "none", "-display", "none", "-serial", "stdio",
                   "-monitor", f"unix:{monitor},server=on,wait=off", "-boot", "order=c"]
        (evidence / "qemu-command.json").write_text(json.dumps(command, indent=2) + "\n")
        script = f'''set -euo pipefail
test -d {PACKAGE}/lib/moire
workspace=$(mktemp -d /var/tmp/moire-files-source.XXXXXXXX)
trap 'rm -rf "$workspace"' EXIT
chmod 755 "$workspace"
cp -a {PACKAGE}/lib/moire "$workspace/source"
chmod -R a+rX "$workspace/source"
# Validate the existing compiler before exercising Moire.
esbuild="$workspace/source/node_modules/.pnpm/@esbuild+linux-arm64@0.28.1/node_modules/@esbuild/linux-arm64/bin/esbuild"
stat -c 'MOIRE_ESBUILD_SOURCE_MODE=%a' "$esbuild"
# Test the already-installed compiler directly before attributing a failure to Moire.
runuser -u nobody -- "$esbuild" --version
{fixture}
chmod u+w "$workspace/source/node_modules/.bin/tsx"
sed 's#{PACKAGE}/lib/moire#'"$workspace"'/source#g' {PACKAGE}/lib/moire/node_modules/.bin/tsx > "$workspace/source/node_modules/.bin/tsx"
# Keep the installed Node/loader and library closure, changing only the source entry.
sed -e 's#{PACKAGE}/lib/moire#'"$workspace"'/source#g' -e 's#apps/system/compositor/src/main.ts#'"{ENTRY}"'#g' {PACKAGE}/bin/moire > "$workspace/entry"
chmod 755 "$workspace/entry"
sed 's#{PACKAGE}/bin/moire#'"$workspace"'/entry#g' {PACKAGE}/bin/moire-native-desktop-direct > "$workspace/run-test"
chmod 755 "$workspace/run-test"
cd "$workspace/source"
echo MOIRE_FILES_BASELINE_BEGIN
set +e
runuser -u nobody -- "$workspace/run-test"
baseline=$?
set -e
echo MOIRE_FILES_BASELINE_EXIT=$baseline
test "$baseline" -ne 0
{patch}
echo MOIRE_FILES_FIXED_BEGIN
runuser -u nobody -- "$workspace/run-test"
echo MOIRE_FILES_FIXED_EXIT=0
sed -e 's#{PACKAGE}/lib/moire#'"$workspace"'/source#g' -e 's#apps/system/compositor/src/main.ts#'"{STATE_TEST}"'#g' {PACKAGE}/bin/moire > "$workspace/entry"
echo MOIRE_KEYBOARD_STATE_BEGIN
runuser -u nobody -- "$workspace/run-test"
echo MOIRE_NATIVE_FILES_DONE
'''
        exit_code = helper.run_guest(command, monitor, evidence / "builder.serial.log", script,
                                     rb"MOIRE_NATIVE_FILES_DONE\r?\n", 240)
    log = (evidence / "builder.serial.log").read_text(errors="replace")
    # A nonzero baseline alone can be a broken fixture; require the actual causal observation.
    baseline = log.split("MOIRE_FILES_BASELINE_BEGIN", 1)[1].split("MOIRE_FILES_FIXED_BEGIN", 1)[0]
    if not re.search(r'"stage":"native-client-key".*"alt":false', baseline):
        raise SystemExit(f"Baseline did not establish the missing mask: {evidence}")
    result = {"qemuExit": exit_code, "package": PACKAGE, "deviceAccess": 0, "imageBuilt": False,
              "physicalPresentation": False, "baselineMissingAlt": True,
              "sources": {file: hashlib.sha256((evidence / file).read_bytes()).hexdigest() for file in [ENTRY, *PATCHES]}}
    (evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"Native Files baseline/repair comparison complete: {evidence}")


if __name__ == "__main__":
    main()
