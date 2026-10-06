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
| `onSsdPointerMotion(event)` | Hover feedback after compositor z-order/occlusion checks |
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

Each decorated window keeps a persistent React titlebar root. Its raster strip
is cached while idle and rerasterized only while theme, title, focus,
maximize/restore state, or control motion changes. This preserves eased hover
feedback without tying SSD rendering to the software framebuffer; an EGL
backend consumes the same scene/raster contract. Rounded top corners, the focus
jewel, restrained inactive controls, and semantic minimize/restore/close glyphs
all live in `TitleBar.tsx`. The compositor decides whether chrome is actually
visible before forwarding hover, preventing feedback through an occluding
window.

Task buttons keep creation order even when window z-order changes. Pressing a
minimized task restores it, pressing an inactive task focuses it, and pressing
the focused task minimizes it. If the focused window is minimized, the
compositor promotes the next visible top-level so keyboard focus and
`_NET_ACTIVE_WINDOW` do not point at a hidden surface.

## Launcher input and process startup

Super toggles the launcher. Up/Down select applications, Enter starts the selected
application, and Escape dismisses the launcher. Search keys route to the shared
`SearchField` editor, including caret movement, Home/End, Delete, Ctrl+A, and
Shift selection. Its pointer hit places the caret. The shell currently translates
raw evdev keys with a US layout; client XKB/composition does not apply to shell
search.

Shell pointer grabs belong to the button that started them. Right-click invokes
context actions when available, and ordinary button activation belongs to left
release. A retained React commit rebinds the pressed hit by identity, so removing
an application or task while pressed cannot activate a stale callback. Clicks
inside launcher chrome stay in the launcher; its backdrop dismisses outside
clicks. Pointer hit tests also honor rounded controls and ancestor clips, so
partly visible application rows cannot activate through the launcher footer.

For spawn callbacks that expose Node-style `once`, launcher startup stays pending
until `spawn` or `error`. Pending launches cannot start twice. Startup failure
keeps the search and selection for retry and displays feedback in the footer.
Dismissal cancels that attempt's UI feedback, so a late process event cannot
reopen the launcher. Callbacks without process events retain immediate success
behavior. This confirms process creation, not application window readiness or
subsequent exit status.

Run `pnpm --filter @moire/shell smoke:launcher` for disposable application-entry
fixtures, actual search editing, pointer ownership, all five theme families in
both variants, and real Node `ENOENT`/spawn/retry paths. The existing `smoke`
command covers panel, desktop, drag, and SSD scene behavior.

## Two React worlds

Shell uses `react-host` directly with dirty flags — **no** `Application.run()` loop. Files/Settings use `@moire/ui` `Application` as Wayland clients. Shared widgets/tokens where possible.

## Further reading

- [Desktop icons](./desktop.md)
- [Paint & input](../architecture/paint-and-input.md)
- [Compositor DnD](../compositor/dnd.md)
- [Session](../apps/session.md)
