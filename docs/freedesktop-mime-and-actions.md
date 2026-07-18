# Freedesktop MIME associations and file actions

Moire's first association layer lives in `@moire/app-discovery`. Files and the
desktop shell share it, so “Open”, “Open With”, and “Always Use” do not drift
into separate implementations.

## Resolution inputs

`MimeAssociationDatabase` reads the standard XDG locations in precedence
order:

1. desktop-specific and generic `mimeapps.list` files under XDG config roots
2. application `mimeapps.list` files under XDG data roots
3. `applications/mimeinfo.cache`
4. application desktop-entry `MimeType=` declarations

Path classification uses shared-mime-info `mime/globs2` (or legacy `globs`),
then follows `mime/subclasses` so a specific type can inherit handlers from a
parent such as `text/plain`. Directories resolve to `inode/directory`. A small
fallback table covers common extensions when shared-mime-info is unavailable.

The current slice does not parse shared-mime-info magic rules or sniff file
contents. That is the next accuracy step.

## Desktop entry launch

The parser retains the original `Exec=` template. `buildDesktopExec` expands
`%f`, `%F`, `%u`, `%U`, `%c`, and `%i`, handles literal `%%`, quotes paths, and
wraps terminal applications with `foot -e`.

Choosing “Always Use” updates both `[Default Applications]` and
`[Added Associations]` in `~/.config/mimeapps.list`, then refreshes the live
database.

## Context action plugins

`ContextActionRegistry` is deliberately UI-independent and process-local. A
plugin provides an id plus an `actions(context)` function. The context includes
source surface (`files` or `desktop`), semantic scope (`items`, `background`,
or `sidebar`), current directory, paths, MIME types, and directory flags.
Actions return labels, descriptions, optional icon/danger/separator metadata,
and a callback. Files and desktop background actions now use the same registry
contract as item actions.

Core Open/Open With and location actions are registered through this same API.
Future external plugin discovery can load providers into both processes without
changing `ContextMenu` or either surface's pointer handling.

## UI flow

- Right-click is carried by `react-host` hit regions as `onContextMenu`.
- `Window` dispatches right-button presses to the topmost matching region.
- The compositor shell mirrors that dispatch for desktop items and an explicit
  empty-space background trigger, even when desktop icons are hidden.
- `ContextMenu` and `OpenWithPicker` are shared `@moire/ui` viewport overlays.
- Open With combines MIME-compatible recommendations with the remaining
  discovered applications, supports search and keyboard selection, and uses
  freedesktop PNG icons from hicolor/pixmap data roots when available.
