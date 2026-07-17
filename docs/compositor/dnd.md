# Wayland drag and drop

Moire implements full `wl_data_device` DnD between shell, Files, and (eventually) other clients.

## Roles

| Layer | Responsibility |
| --- | --- |
| Compositor (`packages/core`) | Session: sources, offers, focus, drop serialization |
| UI Wayland backend | `startDrag`, drag icon SHM surface, receive into sinks |
| Widgets | `Draggable` / `DropTarget` + `setDndBridge` |
| Shell | Desktop reposition/folder drop + `paintDragPreview` when needed |

## Client → compositor flow (source)

1. Pointer down on `Draggable`; move ≥ 6px.
2. Bridge `startDrag(mimeTypes, getPayload, serial)`.
3. Compositor creates data source; other surfaces get offers.
4. Source attaches a source-sized drag icon (SHM), offset by the pointer-down hotspot.
5. A successful drop tears down the preview; a rejected/cancelled drop retains a compositor snapshot long enough to ease back to its start position.

## Target flow

1. Pointer enters a surface with a registered `DropTarget` (mime filter).
2. Offer negotiates types (`text/uri-list` for files).
3. Drop → `notifyDrop` → `onDrop(payload, mimeTypes)`.

## Desktop specifics

- A desktop icon press+move starts as a **local** shell drag (shell-tracked, source-sized ghost preview, no compositor DnD session). Dropping on empty desktop repositions it; dropping over another desktop folder moves it into that folder.
- If the pointer crosses onto a client surface (e.g. a Files window) while that local drag is active, the compositor **escalates**: `CompositorServer.startDesktopDrag(uri, label)` opens a real DnD session backed by a synthetic `ShellDragSource` (implements the same `sendDataSourceSend`/mimes/actions surface a real client source would, just writes the `file://` URI straight into the fd instead of proxying to a wl_client). From that point the target sees a normal `text/uri-list` offer/drop — no special-casing on the Files side.
- Escalation is checked (via an independent hit-test) **before** the normal pointer-focus update on that motion event, so the target never gets a stray hover enter ahead of the DnD enter.
- Ending an escalated drag: dropped on a client → handed off normally, shell clears its local drag state without touching the icon's saved position (the file may have moved). Dropped back on the desktop → treated as a plain reposition, not a self-copy through `acceptDesktopDrop`. Cancellation returns the ghost to the saved icon position.
- Clicks are suppressed after a drag so select does not fire on release.
- Nested `GridItem` / `ListItem` use `interactive={false}` so the `Draggable` hit layer owns press.

## Testing

- Drag a file from Files onto the desktop and into another folder.
- Drag a desktop item directly onto a desktop folder — confirm the folder highlights and the item moves into it.
- Drag a desktop icon onto an open Files window showing a different folder — confirm the file moves (rename, falling back to copy) into that folder and disappears from the desktop within the 2s poll.
- Drag a desktop icon and release it back on the desktop (or over foot, which has no DnD target) — confirm it still just repositions, no copy/duplicate.
- Confirm the preview keeps the source item size, follows the original grab point, and snaps home after Escape or a rejected drop.
- Confirm window-under-cursor still receives clicks when not over icons.

## Gaps

- Arbitrary app-provided preview content beyond Moire UI's synthesized source tile
- Internal move vs copy chooser UI (currently prefers move, same as Files↔Files)
- Headless platform has no DnD bridge
