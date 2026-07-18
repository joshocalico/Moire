# Desktop icons

Desktop = wallpaper + shell icon layer + Files as the day-0 file manager. Icons are **not** a second filesystem browser with its own DnD stack; they share Wayland data device semantics with Files.

## Behavior

| Interaction | Result |
| --- | --- |
| Click empty desktop | Clears selection (when no window under cursor) |
| Click icon | Select |
| Double-click folder | Open through `xdg-open` → default Files handler |
| Right-click icon | Shared context menu with Open, Open With, and Show in Files |
| Drag icon onto empty desktop | Reposition; persist layout |
| Drag icon onto desktop folder | Move the item into that folder |
| Drag icon onto a client window | Escalates to a real Wayland DnD source — target receives a normal `text/uri-list` drop |
| Drop files on desktop | Place / copy semantics via DnD |
| Click through | If a window is under the pointer, shell does not steal the click |

Hit tests use compositor ordering: windows above icons. Shell only handles `onDesktopPointerButton` / motion when the desktop is topmost.

## Layout persistence

Path: `~/.config/moire/desktop-layout.json` (guest home under the Moire session user).

Stores icon positions keyed by path/id. Missing entries get auto-placed on a grid.

Desktop opens resolve through the same `FileActivationService` used by Files;
the shell no longer builds its own shortened Open With list. The canonical
picker model can launch once or update the user default. `moire-session` still
registers Files as the initial `inode/directory` handler; see
[Files](../apps/files.md#default-directory-handler).

## Visuals

- PNG icons from `@moire/ui` (`Icon`)
- Labels with optional scrim (`GridItem` `labelScrim`) for contrast on atmosphere wallpaper
- Drag: hotspot-anchored Wayland drag icon for client drags; a same-size shell ghost via `paintDragPreview` / `desktopDragLabel` for icon moves; cancelled/failed moves ease back to origin

## Dragging onto a client (Files)

A desktop-icon drag starts purely local (no compositor DnD session). If the pointer moves onto a client surface while dragging, the compositor promotes it into a real `wl_data_device` session via `CompositorServer.startDesktopDrag`, backed by a synthetic in-process source (`ShellDragSource` in `packages/core/src/server.ts`) rather than a real `wl_client`. The target (e.g. Files' `DropTarget`) sees a normal `text/uri-list` offer and drop — no awareness that the source is shell-local. See [Wayland DnD](../compositor/dnd.md) for the full flow.

## Implementation map

| File | Role |
| --- | --- |
| `packages/shell/src/DesktopIcons.tsx` | React tree |
| `packages/shell/src/controller.ts` | Selection, associations, context actions, layout I/O, drag |
| Shell composite hooks | Pointer dispatch + drag blit |

## Related

- [Files app](../apps/files.md)
- [DnD](../compositor/dnd.md)
- [Files & desktop overview](../files-and-desktop.md)
