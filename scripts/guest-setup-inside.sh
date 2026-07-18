#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> groups"
sudo usermod -aG video,input,render "$USER" || true

echo "==> apt packages"
sudo apt-get update
sudo apt-get install -y \
  build-essential pkg-config curl ca-certificates git \
  libdrm-dev libgbm-dev libegl-dev libgles2-mesa-dev \
  libinput-dev libxkbcommon-dev libseat-dev seatd \
  wayland-protocols libwayland-dev \
  dbus dbus-user-session \
  xdg-desktop-portal xdg-desktop-portal-gtk \
  nautilus gvfs gvfs-backends foot xwayland \
  adwaita-icon-theme hicolor-icon-theme mesa-utils

# LibreOffice is large — install if missing
if ! command -v libreoffice >/dev/null 2>&1; then
  sudo apt-get install -y libreoffice || true
fi

echo "==> Node 22 + pnpm"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo corepack enable
sudo corepack prepare pnpm@9.15.0 --activate

echo "==> Parallels Tools (if ISO mounted)"
for m in /media/*/ /media/cdrom/ /mnt/; do
  if [[ -x "${m}install" ]] || [[ -x "${m}install.py" ]]; then
    echo "Found tools at $m"
    sudo "${m}install" --install-unattended-upgrade || sudo bash "${m}install" || true
  fi
done
# Also try mounting cdrom explicitly
if [[ ! -d /mnt/prltools ]]; then
  sudo mkdir -p /mnt/prltools
  sudo mount /dev/cdrom /mnt/prltools 2>/dev/null || sudo mount /dev/sr0 /mnt/prltools 2>/dev/null || true
  if [[ -x /mnt/prltools/install ]]; then
    sudo /mnt/prltools/install --install-unattended-upgrade || true
  fi
fi

echo "==> DRM devices"
ls -la /dev/dri || true
groups || true

echo "BOOTSTRAP_DONE"
