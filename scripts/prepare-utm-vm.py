#!/usr/bin/env python3
"""Create a diskless UTM/QEMU VM from the immutable Moire ISO."""

import argparse
import hashlib
import json
import plistlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("iso", nargs="?", type=Path, default=ROOT / "vm/nixos/moire-aarch64-accel.iso")
parser.add_argument("--output", type=Path, default=ROOT / "vm/Moire VirGL Accelerated.utm")
parser.add_argument("--display", choices=("virgl", "software"), default="virgl",
                    help="Use VirGL acceleration or an isolated virtio GPU software fallback")
parser.add_argument("--isolated", action="store_true",
                    help="Use the diskless native test profile: no network or host shares, 2 CPUs, 2 GiB RAM")
parser.add_argument("--serial-log", action="store_true",
                    help="Capture startup UART and UTM diagnostics inside this bundle")
args = parser.parse_args()
iso = args.iso.resolve()
output = args.output.resolve()
if not iso.is_file():
    parser.error(f"ISO not found: {iso}; build it first")
if output.suffix != ".utm":
    parser.error("output must be a .utm bundle")
hasher = hashlib.sha256()
with iso.open("rb") as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        hasher.update(chunk)
digest = hasher.hexdigest()
if output.exists():
    manifest = output / "moire-image.json"
    if not manifest.is_file() or json.loads(manifest.read_text())["sha256"] != digest:
        parser.error("bundle already exists with a different image; choose a new --output path")
    with (output / "config.plist").open("rb") as handle:
        existing = plistlib.load(handle)
    expected_display = "virtio-gpu-gl-pci" if args.display == "virgl" else "virtio-gpu-pci"
    if existing["Display"][0]["Hardware"] != expected_display:
        parser.error("bundle already exists with a different display; choose a new --output path")
    if args.isolated and (existing.get("Network") or existing["Sharing"].get("DirectorySharePath")
                          or existing["Sharing"].get("ClipboardSharing")):
        parser.error("existing bundle is not isolated; choose a new --output path")
    if args.serial_log and not existing["QEMU"].get("DebugLog"):
        parser.error("existing bundle has no startup diagnostics; choose a new --output path")
    print(f"Existing VM retained: {output}")
    sys.exit(0)

configuration = json.loads((ROOT / "nix/utm-virgl.json").read_text())
if args.display == "software":
    configuration["Display"][0]["Hardware"] = "virtio-gpu-pci"
configuration["Information"]["Name"] = output.stem
configuration["Information"]["UUID"] = str(uuid.uuid4()).upper()
configuration["Drive"][0]["Identifier"] = str(uuid.uuid4()).upper()
configuration["Network"][0]["MacAddress"] = "02:" + ":".join(
    f"{byte:02x}" for byte in uuid.uuid4().bytes[:5]
)
if args.isolated:
    configuration["Network"] = []
    configuration["Sharing"]["ClipboardSharing"] = False
    configuration["Sharing"].pop("DirectorySharePath", None)
    configuration["System"].update(CPU="host", CPUCount=2, MemorySize=2048)
    hardware = configuration["Display"][0]["Hardware"]
    configuration["QEMU"]["AdditionalArguments"] = [
        "-global", f"{hardware}.xres=1280", "-global", f"{hardware}.yres=800",
    ]
if args.serial_log:
    configuration["Serial"] = []
    configuration["QEMU"]["DebugLog"] = True
    # UTM splits additional arguments; retain the complete file path as one argument.
    configuration["QEMU"]["AdditionalArguments"] += [
        "-serial", '"file:' + str(output / "Data/guest-serial.log") + '"',
    ]
output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix=".moire-utm-", dir=output.parent) as staging:
    staged = Path(staging) / output.name
    data = staged / "Data"
    data.mkdir(parents=True)
    destination = data / "moire.iso"
    # APFS clones preserve the source and avoid another full ISO allocation.
    if sys.platform == "darwin":
        subprocess.run(["cp", "-c", str(iso), str(destination)], check=True)
    else:
        shutil.copyfile(iso, destination)
    destination.chmod(0o400)
    with (staged / "config.plist").open("wb") as handle:
        plistlib.dump(configuration, handle)
    (staged / "moire-image.json").write_text(
        json.dumps({"sha256": digest, "source": str(iso), "display": args.display,
                    "isolated": args.isolated, "serialLog": args.serial_log}, indent=2) + "\n"
    )
    staged.rename(output)
print(f"Created {output}")
print("Open this bundle in UTM, then press Run. It has no writable guest disk.")
