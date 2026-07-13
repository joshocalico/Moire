# Desktop icons

Desktop = wallpaper + shell icon layer + Files as the day-0 file manager. Icons are **not** a second filesystem browser with its own DnD stack; they share Wayland data device semantics with Files.

## Behavior

| Interaction | Result |
| --- | --- |
| Click empty desktop | Clears selection (when no window under cursor) |
| Click icon | Select |
| Double-click | Open (Files / default handler) |
| Drag icon | Reposition; persist layout |
| Drop files on desktop | Place / copy semantics via DnD |
| Click through | If a window is under the pointer, shell does not steal the click |

Hit tests use compositor ordering: windows above icons. Shell only handles `onDesktopPointerButton` / motion when the desktop is topmost.

## Layout persistence

Path: `~/.config/moire/desktop-layout.json` (guest home under the Moire session user).

Stores icon positions keyed by path/id. Missing entries get auto-placed on a grid.

## Visuals

- PNG icons from `@moire/ui` (`Icon`)
- Labels with optional scrim (`GridItem` `labelScrim`) for contrast on atmosphere wallpaper
- Drag: Wayland drag icon when a client drag is active; shell chip via `paintDragPreview` / `desktopDragLabel` for icon moves

## Implementation map

| File | Role |
| --- | --- |
| `packages/shell/src/DesktopIcons.tsx` | React tree |
| `packages/shell/src/controller.ts` | Selection, open, layout I/O, drag |
| Shell composite hooks | Pointer dispatch + drag blit |

## Related

- [Files app](../apps/files.md)
- [DnD](../compositor/dnd.md)
- [Files & desktop overview](../files-and-desktop.md)
