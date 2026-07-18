# Shell

`@moire/shell` is the compositor-side UI: wallpaper-adjacent desktop icons, panel, launcher, server-side decorations (SSD), and input routing that is not owned by a client window.

It runs **inside** the Moire compositor process (not a separate Wayland client for DE chrome).

## Package layout

| Area | Path / symbol | Role |
| --- | --- | --- |
| Bridge | `createShell` → `ShellBridge` | Only supported compositor ↔ shell API |
| Desktop | `DesktopIcons.tsx`, controller desktop handlers | Icons on wallpaper |
| Panel / launcher / taskbar | painted via `paint` | App start, running-window state, focus and minimize/restore |
| SSD | `paintSsdWindow` / `hitSsd` | Titlebars in window z-order |

## Startup

1. Compositor constructs `createShell(spawn, onTaskAction)`.
2. Prefs load (scale, wallpaper, `showDesktopIcons`).
3. Each composite frame calls paint hooks in [paint order](../architecture/paint-and-input.md).
4. Pointer/key events route through the bridge before or instead of clients.

## `ShellBridge` API

```ts
createShell(spawn: ShellSpawn, onTaskAction?: (task: TaskWindowAction) => void): ShellBridge
```

| Method | Role |
| --- | --- |
| `paint(fb, …)` | Panel + launcher into the framebuffer |
| `setTasks(tasks)` | Publish the compositor's mapped top-level windows to the panel |
| `beginSsdFrame()` | Clear per-frame SSD hit list before stacking windows |
| `paintSsdWindow(…, window)` | One titlebar after that window’s buffers (preferred) |
| `paintSsd(…, windows)` | All SSD bars (legacy / batch) |
| `hitSsd(x, y)` | Move / close / maximize / minimize action or null |
| `onKey` | Super → launcher; launcher keyboard; returns consumed |
| `onPointerButton` | Panel / launcher hits |
| `onPointerAxis` | Launcher list scrolling |
| `onDesktopPointerButton?` | Icon select/open when **no** window under cursor |
| `onDesktopPointerMotion?` | Icon hover + local reposition/folder drag |
| `isLauncherOpen()` | Launcher visibility |
| `needsRepaint()` | Dirty chrome / motion still settling |
| `invalidateChrome()` | Drop caches after theme/prefs change |
| `paintDesktop(…)` | Blend icons after wallpaper, before windows |
| `acceptDesktopDrop(uris, x, y)` | Copy/move `file://` URIs; returns whether the drop succeeded |
| `hitDesktop(x, y)` | Drop zone above the panel |
| `paintDragPreview(…)` | Same-size desktop ghost under cursor or easing back after failure |
| `desktopDragLabel?()` | Label while a desktop icon drag/return animation is active |

Do not reach past this bridge into shell internals from `packages/core`.

Task buttons keep creation order even when window z-order changes. Pressing a
minimized task restores it, pressing an inactive task focuses it, and pressing
the focused task minimizes it. If the focused window is minimized, the
compositor promotes the next visible top-level so keyboard focus and
`_NET_ACTIVE_WINDOW` do not point at a hidden surface.

## Two React worlds

Shell uses `react-host` directly with dirty flags — **no** `Application.run()` loop. Files/Settings use `@moire/ui` `Application` as Wayland clients. Shared widgets/tokens where possible.

## Further reading

- [Desktop icons](./desktop.md)
- [Paint & input](../architecture/paint-and-input.md)
- [Compositor DnD](../compositor/dnd.md)
- [Session](../apps/session.md)
