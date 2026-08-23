# Moire — Parallels Ubuntu VM runbook

Develop on macOS in Cursor; **run the compositor on Linux** (DRM/KMS + koffi FFI).

## 1. Create the VM (via `prlctl`)

From the Mac (repo root):

```bash
./scripts/parallels-create-moire-vm.sh
```

That script will:

- `prlctl create MoireDev --ostype linux --distribution ubuntu`
- Set 4 CPUs, 8 GB RAM, virtio video, 3D acceleration, 64 GB disk
- Share `~/Projects/moire` into the guest as folder `moire`
- Download Ubuntu 24.04.4 live-server arm64 ISO and attach it
- `prlctl start MoireDev`

Then finish the **Ubuntu installer in the Parallels window** (enable OpenSSH). After first boot, install **Parallels Tools** so `/Media/psf/moire` mounts.

Useful commands:

```bash
prlctl list -a
prlctl list -f                 # IP once Tools/network are up
prlctl capture MoireDev --file vm/screenshot.png
prlctl stop MoireDev
prlctl exec MoireDev --current-user -- ls /Media/psf/moire   # after Tools
```

UTM works too; this project prefers Parallels because `prlctl` is available.

## 2. Packages inside the guest

```bash
sudo apt update
sudo apt install -y \
  build-essential pkg-config \
  curl ca-certificates \
  libdrm-dev libgbm-dev libegl-dev libgles2-mesa-dev \
  libinput-dev libxkbcommon-dev libseat-dev seatd \
  wayland-protocols libwayland-dev \
  dbus dbus-user-session \
  foot \
  libreoffice \
  xwayland \
  adwaita-icon-theme hicolor-icon-theme \
  mesa-utils
```

Node 22+:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
corepack prepare pnpm@9.15.0 --activate
```

Add your user to video/input (or rely on logind/seatd on a VT):

```bash
sudo usermod -aG video,input "$USER"
# log out / back in
```

## 3. Get the repo in the guest

Shared folder (after Parallels Tools):

```bash
ssh moire@10.211.55.17   # password: see vm/CREDENTIALS.txt
cd /media/psf/moire
CI=true pnpm install --force
pnpm probe:drm
```

Expected: at least one **connected** DRM connector on `/dev/dri/card1` (virtio-GPU).

## 4. Run KMS clear-color (Phase 1)

If a display manager grabbed the GPU:

```bash
sudo systemctl stop gdm3   # or gdm
```

Then from the shared repo:

```bash
cd /media/psf/moire
CI=true MOIRE_FRAMES=120 pnpm clear-color
# or:
CI=true MOIRE_FRAMES=120 pnpm dev:compositor
```

Watch the Parallels window — you should see a pulsing solid color (dumb-buffer KMS present).

## 5. Day-0 smoke (once compositor speaks Wayland)

From the Moire session (launcher / later tooling):

| App | Notes |
| --- | --- |
| **Moire Terminal** | Default native React terminal; launched by `moire-session` |
| **foot** | Optional external Wayland interop/reference client |
| **Moire Files** | Day-0 file manager (`@moire/files`); desktop icons via shell — see [files-and-desktop.md](./files-and-desktop.md) |
| **LibreOffice** | May use XWayland; install `xwayland` |

## 6. Troubleshooting

| Symptom | Check |
| --- | --- |
| No `/dev/dri/card*` | Enable 3D in Parallels; `ls -l /dev/dri` |
| `Permission denied` on card | `video` group or run on a logind VT with seatd |
| koffi can’t load `libdrm.so.2` | `sudo apt install libdrm2 libdrm-dev` |
| GTK apps look unthemed | Missing `dbus-run-session` or Moire GTK theme helpers |
| Shared folder slow | Prefer `git clone` on a native Linux disk + push from Mac, or SSHFS |
| Capture stays solid clear-color while logs say surfaces painted | Re-`SetCrtc` after FB writes — see [parallels-drm-present.md](./parallels-drm-present.md) |
| `drmModeSetCrtc` fails with `-13` | Another process holds DRM master (gdm, or a STOP’d compositor) |
| RSS grows over time | See [known-issues.md](./known-issues.md) — per-frame buffer copies / SHM snapshots |
| Xwayland `Error getting buffer` / no X11 windows | Needs `wl_drm` (render node) for Glamor — implemented; see [known-issues.md](./known-issues.md) |

## 7. Edit on Mac, run in VM

Cursor stays on the Mac workspace (`~/Projects/moire`). In the VM, use the shared copy or `git pull` over SSH. Typecheck on either side:

```bash
pnpm typecheck
```
