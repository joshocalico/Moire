#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 ]] || { echo 'Usage: scripts/run-native-login-probe.sh NEW-NATIVE-LOGIN.iso' >&2; exit 1; }
[[ "$(uname -s)/$(uname -m)" == Darwin/arm64 ]] || { echo 'Requires Apple Silicon macOS.' >&2; exit 1; }
[[ -f "$1" && ! -L "$1" ]] || { echo 'Expected a regular immutable ISO.' >&2; exit 1; }
python3 - "$1" <<'PY'
import hashlib, json, sys
from pathlib import Path
image = Path(sys.argv[1])
receipt = image.with_suffix('.build.json')
if not receipt.is_file() or receipt.is_symlink():
    raise SystemExit('Missing native-login build receipt. This launcher cannot boot a historical image.')
record = json.loads(receipt.read_text())
if (record.get('checkpoint') not in ('c62-native-login-probe', 'c63-native-desktop') or
    record.get('imageName') != image.name or record.get('bytes') != image.stat().st_size):
    raise SystemExit('Build receipt does not identify this native-login candidate.')
with image.open('rb') as stream:
    actual = hashlib.file_digest(stream, 'sha256').hexdigest()
if actual != record.get('sha256'):
    raise SystemExit('Image checksum differs from its build receipt; refusing to boot.')
print(f"Booting {image.name}, checkpoint {record['checkpoint']}, SHA256 {actual}")
print('Build receipt records graphical acceptance pending. Consult the separate live acceptance evidence.')
print('Authenticated desktop checkpoint.' if record['checkpoint'] == 'c63-native-desktop' else 'Fixed PAM-probe checkpoint; no desktop.')
PY
if pgrep -f '(^|/)qemu-system-aarch64( |$)' >/dev/null; then
  echo 'Another ARM64 QEMU guest owns the VM window. Coordinate with Recovery.' >&2; exit 1
fi
qemu="$(command -v qemu-system-aarch64)"
firmware="$(dirname "$qemu")/../share/qemu/edk2-aarch64-code.fd"
[[ -f "$firmware" ]] || { echo 'Missing ARM64 UEFI firmware.' >&2; exit 1; }
exec "$qemu" -name "Moire ${1##*/}" \
  -machine virt -accel hvf -cpu host -smp 2 -m 2048 -bios "$firmware" \
  -device virtio-gpu-pci,xres=1280,yres=800 -device virtio-keyboard-pci \
  -device virtio-tablet-pci -device virtio-scsi-pci,id=scsi \
  -drive "file=${1//,/,,},format=raw,if=none,id=cdrom,media=cdrom,readonly=on" \
  -device scsi-cd,drive=cdrom -device virtio-rng-pci \
  -nic none -boot order=d -display cocoa -serial mon:stdio
