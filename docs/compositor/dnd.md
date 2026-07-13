# Wayland drag and drop

Moire implements full `wl_data_device` DnD between shell, Files, and (eventually) other clients.

## Roles

| Layer | Responsibility |
| --- | --- |
| Compositor (`packages/core`) | Session: sources, offers, focus, drop serialization |
| UI Wayland backend | `startDrag`, drag icon SHM surface, receive into sinks |
| Widgets | `Draggable` / `DropTarget` + `setDndBridge` |
| Shell | Desktop reposition + `paintDragPreview` when needed |

## Client → compositor flow (source)

1. Pointer down on `Draggable`; move ≥ 6px.
2. Bridge `startDrag(mimeTypes, getPayload, serial)`.
3. Compositor creates data source; other surfaces get offers.
4. Source attaches a labeled drag icon (SHM) when available.
5. On drop or cancel, session tears down; preview stops.

## Target flow

1. Pointer enters a surface with a registered `DropTarget` (mime filter).
2. Offer negotiates types (`text/uri-list` for files).
3. Drop → `notifyDrop` → `onDrop(payload, mimeTypes)`.

## Desktop specifics

- Icon moves may use shell-local drag with a chip blit if not going through a client source.
- Clicks are suppressed after a drag so select does not fire on release.
- Nested `GridItem` / `ListItem` use `interactive={false}` so the `Draggable` hit layer owns press.

## Testing

- Drag a file from Files onto the desktop and into another folder.
- Confirm drag icon / chip follows the cursor (not only the default cursor).
- Confirm window-under-cursor still receives clicks when not over icons.

## Gaps

- Cross-app rich previews beyond label chip
- Internal move vs copy chooser UI
- Headless platform has no DnD bridge
