#!/usr/bin/env bash
# Isolated public-password candidate only; coordinate the VM window with Recovery first.
set -euo pipefail
[[ $# -le 1 ]] || { echo 'Usage: scripts/run-pam-test.sh [PAM-TEST.iso]' >&2; exit 1; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${1:-$root/vm/nixos/moire-aarch64-c58-real-pam-r2.iso}"
[[ -f "$image" && ! -L "$image" ]] || { echo 'Missing regular PAM test ISO.' >&2; exit 1; }
[[ "$(uname -s)/$(uname -m)" == Darwin/arm64 ]] || { echo 'This test launcher requires Apple Silicon.' >&2; exit 1; }
if pgrep -f '(^|/)qemu-system-aarch64( |$)' >/dev/null; then
  echo 'Another ARM64 QEMU guest is running; coordinate with Recovery.' >&2; exit 1
fi
qemu="$(command -v qemu-system-aarch64)"
firmware="$(dirname "$qemu")/../share/qemu/edk2-aarch64-code.fd"
[[ -f "$firmware" ]] || { echo 'Missing QEMU ARM64 firmware.' >&2; exit 1; }
exec "$qemu" -name 'Moire PUBLIC PASSWORD PAM TEST' \
  -machine virt -accel hvf -cpu host -smp 2 -m 2048 -bios "$firmware" \
  -device virtio-gpu-pci,xres=1280,yres=800 -device virtio-keyboard-pci \
  -device virtio-scsi-pci,id=scsi \
  -drive "file=${image//,/,,},format=raw,if=none,id=cdrom,media=cdrom,readonly=on" \
  -device scsi-cd,drive=cdrom -device virtio-rng-pci \
  -nic none -boot order=d -display cocoa -serial mon:stdio
