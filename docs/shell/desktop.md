# Desktop icons

Desktop = wallpaper + shell icon layer + Files as the day-0 file manager. Icons are **not** a second filesystem browser with its own DnD stack; they share Wayland data device semantics with Files.

## Behavior

| Interaction | Result |
| --- | --- |
| Click empty desktop | Clears selection (when no window under cursor) |
| Click icon | Replace selection; Ctrl toggles; Shift extends a range |
| Keyboard | Spatial arrows, Home/End, Space, Enter, Escape, and Ctrl+A |
| Double-click folder | Open through `xdg-open` → default Files handler |
| Right-click icon | Preserve an existing group selection and provide group-aware actions |
| Drag icon onto empty desktop | Reposition the selection as a group; persist relative layout |
| Drag icon onto desktop folder | Move the selected items into that folder with rollback on failure |
| Drag icon onto a client window | Escalate the complete selection as a normal `text/uri-list` Wayland source |
| Drop files on desktop | Place / copy semantics via DnD |
| Click through | If a window is under the pointer, shell does not steal the click |

Hit tests use compositor ordering: windows above icons. Shell only handles `onDesktopPointerButton` / motion when the desktop is topmost.

## Layout persistence

Path: `~/.config/moire/desktop-layout.json` (guest home under the Moire session user).

Stores icon positions keyed by path/id. Missing entries get auto-placed on a grid.

Desktop opens resolve through the same `FileActivationService` used by Files;
the shell no longer builds or embeds its own Open With list. It asks the
D-Bus-activated portal process for the same separate, draggable chooser window
as Files. That chooser can launch once or update the user default.
`moire-session` still
registers Files as the initial `inode/directory` handler; see
[Files](../apps/files.md#default-directory-handler).

## Visuals

- PNG icons from `@moire/ui` (`Icon`)
- Labels with optional scrim (`GridItem` `labelScrim`) for contrast on atmosphere wallpaper
- Drag: hotspot-anchored Wayland drag icon for client drags; a same-size shell ghost via `paintDragPreview` / `desktopDragLabel` for icon moves; cancelled/failed moves ease back to origin

## Dragging onto a client (Files)

A desktop-icon drag starts purely local (no compositor DnD session). If the pointer moves onto a client surface while dragging, the compositor promotes it into a real `wl_data_device` session via `CompositorServer.startDesktopDrag`, backed by a synthetic in-process source (`ShellDragSource` in `packages/core/src/server.ts`) rather than a real `wl_client`. The target (e.g. Files' `DropTarget`) sees a normal `text/uri-list` offer containing every selected item — no awareness that the source is shell-local. See [Wayland DnD](../compositor/dnd.md) for the full flow.

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
