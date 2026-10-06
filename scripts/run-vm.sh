#!/usr/bin/env bash
# Boot the immutable image, optionally keeping home and /etc/moire on a data disk.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QEMU="${MOIRE_QEMU:-qemu-system-aarch64}"
QEMU_BIN="$(command -v "$QEMU")" || {
  echo "Install qemu-system-aarch64 first (on macOS: brew install qemu)." >&2
  exit 1
}

IMAGE=""
DATA=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data)
      [[ $# -ge 2 && -z "$DATA" ]] || { echo 'Expected one --data PATH.' >&2; exit 1; }
      DATA="$2"; shift 2 ;;
    --help|-h)
      echo 'Usage: scripts/run-vm.sh [IMAGE.iso] [--data HOME.raw]'
      echo 'Create data first: python3 scripts/vm-data.py create'
      exit 0 ;;
    --*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) [[ -z "$IMAGE" ]] || { echo 'Expected one ISO path.' >&2; exit 1; }
       IMAGE="$1"; shift ;;
  esac
done
if [[ -z "$IMAGE" ]]; then
  IMAGE="$ROOT/result/iso/moire-aarch64.iso"
  if [[ ! -f "$IMAGE" && -f "$ROOT/vm/nixos/moire-aarch64.iso" ]]; then
    IMAGE="$ROOT/vm/nixos/moire-aarch64.iso"
  fi
fi
if [[ ! -f "$IMAGE" ]]; then
  echo "Image missing: $IMAGE. Build it with nix build .#moire-vm." >&2
  exit 1
fi
IMAGE="$(cd "$(dirname "$IMAGE")" && pwd)/$(basename "$IMAGE")"
DATA_ARGS=()
RUNNER=( "$QEMU_BIN" )
if [[ -n "$DATA" ]]; then
  [[ -f "$DATA" && ! -L "$DATA" ]] || { echo 'Data disk must be an existing regular file, not a symlink.' >&2; exit 1; }
  command -v python3 >/dev/null || { echo 'Python 3 is required for the data-disk lease.' >&2; exit 1; }
  python3 "$ROOT/scripts/vm-data.py" check-image "$IMAGE"
  DATA="$(cd "$(dirname "$DATA")" && pwd)/$(basename "$DATA")"
  # The inherited inode flock owns exclusion. Darwin's additional byte locks
  # conflict with that lease; do not acquire a second competing lock on it.
  DATA_ARGS=( -blockdev driver=file,node-name=homefile,filename=/dev/fdset/44,locking=off \
    -blockdev driver=raw,node-name=home,file=homefile \
    -device virtio-blk-pci,drive=home,serial=MOIREHOME \
    -fw_cfg name=opt/moire/home-disk,string=1 )
  RUNNER=( python3 "$ROOT/scripts/vm-data.py" run "$DATA" -- "$QEMU_BIN" )
fi

FIRMWARE="${MOIRE_QEMU_FIRMWARE:-}"
if [[ -z "$FIRMWARE" ]]; then
  for candidate in \
    "$(dirname "$QEMU_BIN")/../share/qemu/edk2-aarch64-code.fd" \
    /usr/share/qemu/edk2-aarch64-code.fd \
    /usr/share/AAVMF/AAVMF_CODE.fd; do
    if [[ -f "$candidate" ]]; then
      FIRMWARE="$candidate"
      break
    fi
  done
fi
if [[ ! -f "$FIRMWARE" ]]; then
  echo "Set MOIRE_QEMU_FIRMWARE to an ARM64 UEFI firmware file." >&2
  exit 1
fi

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) ACCEL=hvf; CPU=host; DISPLAY=cocoa ;;
  Linux/aarch64)
    CPU=host; DISPLAY=gtk
    if [[ -r /dev/kvm && -w /dev/kvm ]]; then ACCEL=kvm; else ACCEL=tcg; CPU=cortex-a72; fi ;;
  *) ACCEL=tcg; CPU=cortex-a72; DISPLAY=gtk ;;
esac

ARGS=( \
  -name Moire \
  -machine virt \
  -accel "$ACCEL" -cpu "$CPU" \
  -smp "${MOIRE_VM_CPUS:-4}" -m "${MOIRE_VM_MEMORY:-4096}" \
  -bios "$FIRMWARE" \
  -device virtio-gpu-pci,xres=1280,yres=800 \
  -device virtio-keyboard-pci \
  -device virtio-tablet-pci \
  -device virtio-scsi-pci,id=scsi \
  -drive "file=${IMAGE//,/,,},format=raw,if=none,id=cdrom,media=cdrom,readonly=on" \
  -device scsi-cd,drive=cdrom \
  -device virtio-rng-pci \
  -nic user,model=virtio-net-pci \
  -boot order=d \
  -display "${MOIRE_VM_DISPLAY:-$DISPLAY}" \
  -serial mon:stdio )
if [[ -n "$DATA" ]]; then
  ARGS+=( "${DATA_ARGS[@]}" )
fi
exec "${RUNNER[@]}" "${ARGS[@]}"
