# Moire

A TypeScript **compositing Wayland desktop environment** — DRM/KMS-first, always-on scene compositing, React/Yoga shell (SSD, launcher, panel), Freedesktop app discovery, and XWayland for broad app support.

> Day-0 bar: session D-Bus, Moire Files, foot, LibreOffice, overlapping composited windows with React decorations.

## Monorepo

```
apps/
  compositor/     # Wayland compositor + WM binary
  session/        # moire-session (dbus-run-session wrapper)
  settings/       # stub
  portal/         # stub xdg-desktop-portal-moire
packages/
  protocol/       # Wayland wire codec
  core/           # surfaces, xdg-shell, scene, spawn
  sys/            # koffi FFI → libdrm, gbm, EGL, libinput, libc
  theme/          # design tokens + wallpaper (theme.json loader)
  react-host/     # react-reconciler → CPU scene graph + bitmap UI font
  app-discovery/  # Freedesktop .desktop + icons
  shell/          # SSD, launcher, panel, widget primitives
themes/default/   # theme.json + wallpaper config
themes/Moire/     # GTK3/GTK4 theme for CSD apps (LibreOffice, etc.)
docs/dev-vm.md    # Parallels Ubuntu VM + DRM/VT runbook
```

## Requirements

- **Linux** with DRM (`/dev/dri`), for real runs (develop in a Parallels/UTM Ubuntu VM from macOS)
- Node.js **≥ 22**, pnpm **9**
- System libs: see [docs/dev-vm.md](docs/dev-vm.md)

## Quick start (Linux VM)

```bash
# On the Mac — create/start the Parallels Ubuntu VM via prlctl:
./scripts/parallels-create-moire-vm.sh

# Inside the guest (after Ubuntu install + Parallels Tools):
cd /Media/psf/moire   # shared folder
pnpm install
pnpm probe:drm          # list DRM connectors via koffi
pnpm dev:compositor     # compositor (WIP)
./apps/session/moire-session
```

macOS can edit and typecheck; DRM/FFI probes need the Linux guest. See [docs/dev-vm.md](docs/dev-vm.md).

## License

MIT (pending)
