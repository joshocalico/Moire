#!/usr/bin/env bash
# Create/configure/start the Moire Ubuntu ARM64 Parallels VM via prlctl.
#
# What this automates:
#   - prlctl create/set (CPU, RAM, 3D/virtio, shared folder, disk size)
#   - Download Ubuntu 24.04 live-server arm64 ISO
#   - Attach ISO, boot order, start VM
#
# What still needs a human (or later automation):
#   - First-time Ubuntu installer in the VM window (enable OpenSSH)
#   - After install: Parallels Tools, then shared folder mounts under /Media/psf/moire
#
# Usage: ./scripts/parallels-create-moire-vm.sh
set -euo pipefail

VM_NAME="${MOIRE_VM_NAME:-MoireDev}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_DIR="${REPO_ROOT}/vm"
ISO="${VM_DIR}/ubuntu-24.04.4-live-server-arm64.iso"
ISO_URL="${MOIRE_ISO_URL:-https://cdimage.ubuntu.com/releases/24.04.4/release/ubuntu-24.04.4-live-server-arm64.iso}"

mkdir -p "${VM_DIR}"

echo "==> Ubuntu ARM64 server ISO"
if [[ ! -f "${ISO}" ]]; then
  curl -L --fail --progress-bar -o "${ISO}.partial" "${ISO_URL}"
  mv "${ISO}.partial" "${ISO}"
fi
ls -lh "${ISO}"

echo "==> Create / configure VM '${VM_NAME}'"
if prlctl list -a | awk '{print $NF}' | grep -qx "${VM_NAME}"; then
  prlctl stop "${VM_NAME}" --kill 2>/dev/null || true
else
  prlctl create "${VM_NAME}" --ostype linux --distribution ubuntu
fi

prlctl set "${VM_NAME}" --cpus "${MOIRE_VM_CPUS:-4}"
prlctl set "${VM_NAME}" --memsize "${MOIRE_VM_MEM:-8192}"
prlctl set "${VM_NAME}" --videosize 512
prlctl set "${VM_NAME}" --3d-accelerate highest || true
prlctl set "${VM_NAME}" --video-adapter-type virtio || true
prlctl set "${VM_NAME}" --usedefanswers on
prlctl set "${VM_NAME}" --efi-secure-boot off
prlctl set "${VM_NAME}" --device-set hdd0 --size 65536 || true

prlctl set "${VM_NAME}" --shf-host on
prlctl set "${VM_NAME}" --shf-host-automount on
if ! prlctl set "${VM_NAME}" --shf-host-add moire --path "${REPO_ROOT}" --mode rw --enable; then
  prlctl set "${VM_NAME}" --shf-host-set moire --path "${REPO_ROOT}" --mode rw --enable || true
fi

prlctl set "${VM_NAME}" --device-set cdrom0 --image "${ISO}" --connect
prlctl set "${VM_NAME}" --device-bootorder "cdrom0 hdd0"

echo "==> Starting ${VM_NAME}"
prlctl start "${VM_NAME}"
prlctl list -a

cat <<EOF

MoireDev is booting the Ubuntu installer.

Next (in the Parallels VM window):
  1. Install Ubuntu Server (enable OpenSSH when asked)
  2. Reboot; then install Parallels Tools from the Devices menu
  3. Shared folder should appear as /Media/psf/moire (or similar)
  4. Inside the guest:
       cd /Media/psf/moire && pnpm install && pnpm probe:drm

Useful prlctl commands:
  prlctl list -f
  prlctl capture ${VM_NAME} --file ${VM_DIR}/screenshot.png
  prlctl stop ${VM_NAME}
  prlctl exec ${VM_NAME} --current-user -- ls /Media/psf/moire   # after Tools

EOF
