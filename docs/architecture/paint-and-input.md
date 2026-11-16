# Paint order and input routing

## Composite stack

Each frame in `packages/core` `CompositorServer.composite()`:

| Order | Layer | Source |
| --- | --- | --- |
| 1 | Wallpaper | `paintWallpaper` (`@moire/theme`), optional atmosphere phase |
| 2 | Desktop icons | `shell.paintDesktop` |
| 3 | Toplevel surfaces + SSD | Stack bottom→top; `shell.paintSsdWindow` after each SSD window |
| 4 | Panel, launcher, desktop menus/pickers | `shell.paint` |
| 5 | Native client popups | `xdg_popup` surfaces above shell chrome |
| 6 | Drag preview | Hotspot-anchored client surface or return-animation snapshot, else `shell.paintDragPreview` |
| 7 | Cursor | Client cursor or fallback shape |
| 8 | Present | `flushMmap` + `presentKms` (required on Parallels VIRTUAL DRM) |

Atmosphere wallpaper sets `markDirty()` while active so the desktop can drift slowly.

## Pointer button routing

Simplified path in `onPointerButton`:

1. If a DnD session is active and the button releases → `endDrag`.
2. A grabbed native popup receives inside presses; outside presses dismiss and
   are consumed before shell chrome can react.
3. `shell.onPointerButton` — top shell overlays, panel, and launcher (consumes
   both press and matching release if hit).
4. SSD hit-test (`hitSsd`) on press — move/close/maximize/minimize.
5. `updatePointerFocus` for the surface under the cursor.
6. If **no** surface under cursor → `shell.onDesktopPointerButton` (icons).
7. Otherwise focus / resize edges / forward `pointerButton` to the client.

Desktop icons remain below windows, but their context menus and Open With
picker are promoted into the final shell overlay. This keeps menus above every
toplevel while preserving desktop item placement below applications.

SSD clicks use the same interleaved ordering as paint: each stack slot's client
buffers, then its titlebar. Only client surfaces in *higher* stack slots may
occlude a titlebar. A lower window underneath exposed chrome must not veto the
SSD hit or receive a click-through.

Software-rendered overlay frames store premultiplied ARGB while scene colors
are specified as straight ARGB. Translucent primitives must preserve frame
alpha; forcing an initially transparent pixel opaque turns dismiss covers into
black fullscreen rectangles when composited later.

## Pointer motion

- Normal: update cursor, focus, hover edges, optional Xwayland ghost motion.
- Visible SSD: compositor performs the window-stack occlusion check, then
  forwards motion to the titlebar's persistent React hit regions for animated
  control feedback.
- During DnD: `updateDragFocus` only (enter/leave/motion to the target client).
- No window under cursor: `shell.onDesktopPointerMotion` for icon hover and local reposition/folder drag.

## Keyboard

- Shell: Super toggles launcher; when launcher open, Esc / arrows / Enter / typing.
- Focused client receives seat keyboard events.

## Why desktop clicks can “fail”

Desktop handlers run only when the compositor’s hit-test finds **no client surface** under the cursor. A Files or Terminal window covering icons will receive the click instead. Kill or move windows (or use `guest-prep-desktop-shot.sh`) when testing icons alone.

## Related

- [Desktop icons](../shell/desktop.md)
- [Wayland DnD](../compositor/dnd.md)
- [Parallels DRM present](../parallels-drm-present.md)
