# Architecture overview

Moire is a monorepo Wayland desktop: a DRM compositor hosts a React-rasterized shell, and native apps are either Wayland clients (foot, LibreOffice) or `@moire/ui` apps (Files, Settings).

## Package responsibilities

```
┌─────────────────────────────────────────────────────────────┐
│  apps/session          day-0 boot (dbus + compositor + apps) │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  apps/compositor + packages/core                             │
│  Wayland socket, surfaces, xdg-shell, seat, DnD, KMS present │
│  optional ShellBridge (panel, taskbar, SSD, desktop, drops)  │
└─────────────┬───────────────────────────────┬───────────────┘
              │                               │
┌─────────────▼─────────────┐   ┌─────────────▼───────────────┐
│  packages/shell           │   │  Wayland clients             │
│  Panel, Launcher, Taskbar │   │  foot, Xwayland apps, …      │
│  DesktopIcons             │   └──────────────────────────────┘
└─────────────┬─────────────┘
              │ uses
┌─────────────▼───────────────────────────────────────────────┐
│  packages/ui  (@moire/ui)                                    │
│  Application / Window / widgets / fonts / motion / DnD API   │
│  platforms: wayland | headless                               │
└─────────────┬───────────────────────────────────────────────┘
              │ reconciles via
┌─────────────▼─────────────┐   ┌─────────────────────────────┐
│  packages/react-host      │   │  packages/theme + prefs      │
│  React → retained scene   │   │  tokens, wallpaper, settings │
│  + renderer contract      │   └─────────────────────────────┘
└───────────────────────────┘
```

| Package | Owns |
| --- | --- |
| `protocol` | Wayland message encode/decode |
| `sys` | DRM/KMS, mmap, evdev, libc FFI |
| `core` | Compositor server, clients, DnD, Xwayland hooks |
| `theme` | Design tokens, wallpaper raster |
| `prefs` | User settings + applying theme/GTK/volume |
| `react-host` | Retained scene graph, renderer contract, software renderer, hit regions |
| `ui` | Portable app SDK (no Wayland in widgets) |
| `shell` | DE chrome attached to the compositor process |
| `app-discovery` | Freedesktop `.desktop`, shared MIME, canonical file activation/Open With policy, and context-action registry |
| `dbus` | Pure-TypeScript session-bus authentication, wire codec, calls, exported objects, replies, errors, and signals |
| `apps/portal` | D-Bus-activatable `org.freedesktop.impl.portal.AppChooser` backend using the shared picker/model |

## Two React worlds

1. **In-compositor shell** — `createShell()` renders panel/launcher/taskbar/SSD/desktop with `react-host` directly inside the compositor process. The compositor publishes its top-level window model through `ShellBridge.setTasks()`, and task actions return through a narrow callback. No `Application` loop; dirty flags + `needsRepaint()`.
2. **UI apps** — Files/Settings use `Application` + `Window`, connect as normal Wayland clients, present SHM buffers each tick.

Both share widgets/tokens where possible; shell re-exports or duplicates thin wrappers (`packages/shell/src/widgets.tsx`).

Files and the desktop shell use `FileActivationService` for default opening and
call `org.moire.FileActivation1.OpenWith` for explicit application selection.
The D-Bus-activated portal process owns the one top-level chooser surface,
launches native requests, and updates MIME defaults after an explicit user
action. Sandboxed and third-party apps reach the same UI through
`org.freedesktop.portal.OpenURI` and the AppChooser backend adapter.

## Design rules

- Widgets must not import Wayland/koffi. Platforms inject behavior (`setDndBridge`, pointer events).
- Apps compose toolkit primitives; avoid custom scroll/list raster in `apps/files`.
- Theme tokens drive fill/selection/rims; avoid one-off hex in apps.
- Guest verification uses scripts under `scripts/` and `prlctl capture` — see [reference/scripts.md](../reference/scripts.md).

## Related

- [Paint order & input](./paint-and-input.md)
- [UI overview](../ui/README.md)
- [Compositor DnD](../compositor/dnd.md)
