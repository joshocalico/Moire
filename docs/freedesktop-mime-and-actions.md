# Freedesktop MIME associations and file actions

Moire's association and activation layer lives in `@moire/app-discovery`.
`FileActivationService` is the canonical source for MIME lookup, recommended
and other applications, default state, icon resolution, duplicate removal,
desktop-entry command expansion, launching, and “Always Use”. The portal owns
its complete `OpenWithModel`; Files and the desktop shell call the native
chooser interface instead of constructing or embedding picker choices.

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
wraps `Terminal=true` applications with `moire-terminal --command`, preserving
the same expansion and quoting path while keeping the session on native Moire
chrome.

Choosing “Always Use” updates both `[Default Applications]` and
`[Added Associations]` in `~/.config/mimeapps.list`, then refreshes the live
database.

## Session D-Bus and portal

`@moire/dbus` implements the session-bus protocol directly in TypeScript:
EXTERNAL authentication over Unix sockets, name ownership, typed method calls,
exported objects, replies, errors, signals, variants, arrays, dictionaries, and
introspection. It is deliberately independent of the compositor and renderer.

`apps/system/portal` is D-Bus activatable as
`org.freedesktop.impl.portal.desktop.moire` and implements
`org.freedesktop.impl.portal.AppChooser`. The backend exports cancellable
request objects, accepts live choice updates, and renders the same
`OpenWithPicker` and application metadata for every caller. Its standalone,
resizable top-level surface deliberately requests no server decoration. A
client-rendered header drag region starts the compositor's native interactive
move, while Cancel and Escape close the focused task. An explicit “Set as
Default” updates `mimeapps.list` before the selected application is returned or
launched. The session
installs its `.portal`, `moire-portals.conf`, and D-Bus service files into the
active XDG data home. `xdg-desktop-portal` remains the sandbox-facing frontend;
interfaces Moire does not implement continue to use the GTK backend.

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
