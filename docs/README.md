# Moire documentation

TypeScript compositing Wayland desktop: DRM/KMS compositor, React shell, and a portable UI toolkit (`@moire/ui`).

This directory is meant to be browsed as a tree or fed to a Markdown site renderer. Start here, or use [SUMMARY.md](./SUMMARY.md) as a sidebar.

## Guides

| Doc | Description |
| --- | --- |
| [Getting started (dev VM)](./dev-vm.md) | Parallels Ubuntu VM, packages, day-0 smoke |
| [Roadmap](./roadmap.md) | Shipped vs planned |
| [Files & desktop (overview)](./files-and-desktop.md) | Day-0 Files, icons, DnD summary |
| [Files, desktop & UI completeness plan](./files-desktop-ui-plan.md) | Product, widget, renderer, JSX, and delivery plan |
| [Rendering and widget v2](./rendering-and-widget-v2.md) | Active EGL, effects, scanout, and themeable-widget queue |
| [Freedesktop MIME & actions](./freedesktop-mime-and-actions.md) | Associations, Open With, action plugins |

## Architecture

| Doc | Description |
| --- | --- |
| [Overview](./architecture/overview.md) | Packages, data flow, responsibilities |
| [Paint order & input](./architecture/paint-and-input.md) | Composite stack, pointer routing |
| [react-host](./architecture/react-host.md) | Retained scene graph, renderer contract, software backend |

## UI toolkit (`@moire/ui`)

| Doc | Description |
| --- | --- |
| [UI overview](./ui/README.md) | App model, fonts, scale, theme access |
| [Application & Window](./ui/application.md) | Lifecycle, event loop, content API |
| [Widgets](./ui/widgets.md) | Full catalog, props, usage examples |
| [Motion](./ui/motion.md) | `createMotionValue`, `easeTo`, ticking |
| [Images & icons](./ui/images-and-icons.md) | PNG load, bundled icons |
| [Platforms](./ui/platforms.md) | Wayland vs headless backends |

## Theme & prefs

| Doc | Description |
| --- | --- |
| [Theme & tokens](./theme/README.md) | Tokens, type roles, spacing |
| [Wallpaper](./theme/wallpaper.md) | Atmosphere, gradient, image modes |
| [Preferences](./reference/prefs.md) | `settings.json`, apply pipeline |

## Shell & apps

| Doc | Description |
| --- | --- |
| [Shell](./shell/README.md) | Panel, launcher, SSD, ShellBridge |
| [Desktop icons](./shell/desktop.md) | Layout, hits, reposition and folder drops |
| [Files](./apps/files.md) | Places, grid/list, default folder handler, DnD |
| [Settings](./apps/settings.md) | Appearance, live apply |
| [Widget Showcase](./apps/showcase.md) | Interactive widget catalog, previews, and highlighted TSX |
| [Terminal](./apps/terminal.md) | Native VT engine, PTY transport, and rich-text terminal surface |
| [Session](./apps/session.md) | `moire-session` day-0 boot |

## Compositor

| Doc | Description |
| --- | --- |
| [Compositor index](./compositor/README.md) | Core package map |
| [Wayland DnD](./compositor/dnd.md) | `wl_data_device`, desktop drop, preview |
| [Display modes & protocols](./compositor/display-and-protocols.md) | Runtime KMS modes and desktop protocol tranche |
| [Parallels DRM present](./parallels-drm-present.md) | Why `presentKms` is required |

## Reference

| Doc | Description |
| --- | --- |
| [Guest scripts](./reference/scripts.md) | `scripts/guest-*.sh` cheat sheet |
| [Known issues](./known-issues.md) | Memory, Xwayland, CSD notes |

## Repository layout

```
apps/
  compositor/     Wayland compositor + WM
  session/        moire-session (dbus + day-0 clients)
  files/          Moire Files
  settings/       Settings
  showcase/       Interactive @moire/ui widget catalog
  terminal/       Native terminal application
  portal/         native xdg-desktop-portal AppChooser backend
packages/
  dbus/           pure-TypeScript session D-Bus wire/client/server
  protocol/       Wayland wire codec
  core/           Surfaces, xdg-shell, DnD, composite
  sys/            DRM/GBM/EGL/libinput FFI
  theme/          Tokens + wallpaper
  prefs/          User settings + apply
  react-host/     React → retained scene + renderer backends
  ui/             App SDK + widgets
  terminal/       VT buffer and Linux PTY transport
  shell/          Panel, launcher, SSD, desktop
  app-discovery/  .desktop discovery, MIME/file activation, action registry
themes/
  default/ light/ Bundled theme.json
  Moire/          GTK theme for CSD clients
```
