# Moire

A TypeScript **compositing Wayland desktop environment** — DRM/KMS-first, always-on scene compositing, React/Yoga shell (SSD, launcher, panel), Freedesktop app discovery, and XWayland for broad app support.

> Day-0 bar: session D-Bus, Moire Files, native Terminal, LibreOffice, overlapping composited windows with React decorations.

## Documentation

Full docs tree (roadmap, architecture, widget catalog, shell/apps, DnD, prefs): **[docs/README.md](docs/README.md)**.  
Sidebar / SUMMARY for MD renderers: [docs/SUMMARY.md](docs/SUMMARY.md).

## Monorepo

```
apps/
  compositor/     # Wayland compositor + WM binary
  session/        # moire-session (dbus + day-0 clients)
  files/          # Moire Files
  settings/       # Appearance / prefs UI
  showcase/       # interactive @moire/ui catalog
  terminal/       # native terminal emulator
  portal/         # native xdg-desktop-portal AppChooser backend
packages/
  dbus/           # pure-TypeScript session D-Bus wire/client/server
  protocol/       # Wayland wire codec
  core/           # surfaces, xdg-shell, DnD, composite
  sys/            # koffi FFI → libdrm, gbm, EGL, libinput, libc
  theme/          # design tokens + wallpaper
  prefs/          # settings.json + apply
  react-host/     # react-reconciler → CPU scene graph + TTF
  ui/             # @moire/ui app SDK + widgets
  terminal/       # VT screen model + Linux PTY transport
  shell/          # SSD, launcher, panel, desktop icons
  app-discovery/  # Freedesktop .desktop + MIME/file activation
themes/           # bundled theme.json + GTK Moire theme
docs/             # full documentation tree (start at docs/README.md)
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
