# Roadmap

Status of the Moire desktop relative to day-0 and near-term work. Dates are not committed; order reflects dependency and product priority.

## Shipped (post-`v0.2.0`)

Moire Bench exposes the active client presentation path, GL/EGL identity,
client/compositor CPU, frame-callback and presentation-time telemetry, SHM
copy/release costs, advertised Wayland globals, and a repeatable
retained-scene workload from a native Moire application.

Checkpoint tag **`v0.2.0`** marks the tree before Files/desktop/DnD/wallpaper expansion.

| Area                                | Status                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wayland compositor + SSD            | Shipped — stack compositing, server decorations                                                                                                                                                                     |
| Session (`moire-session`)           | Shipped — D-Bus, native Terminal, Files; Files registered for `inode/directory`; no Nautilus                                                                                                                        |
| `@moire/ui` toolkit                 | Shipped — measured border-box flow/stack layout, split panes, duration tweens, controls, virtualized list/table/tree, charts, property lists, pagination, runtime SVG symbolic icons, DnD, and feedback             |
| Theme tokens + atmosphere wallpaper | Shipped — cached paint, ambient drift, prefs override                                                                                                                                                               |
| Settings (Appearance / Sound)       | Shipped — live `applySettings`, wallpaper presets                                                                                                                                                                   |
| Moire Files                         | Shipped — richer navigation/selection hierarchy, grid/list, Open With, context actions, Wayland DnD                                                                                                                 |
| Portal / session D-Bus              | Shipped baseline — internal TypeScript D-Bus stack and native AppChooser backend; remaining portal interfaces use GTK                                                                                               |
| Desktop icons                       | Shipped — paint under windows, select/open, layout persist, reposition + folder drops                                                                                                                               |
| Wayland DnD                         | Shipped — compositor session, desktop drop sink, hotspot previews + rejected-drop return animation                                                                                                                  |
| Panel / launcher chrome             | Shipped — brand-forward panel, list launcher                                                                                                                                                                        |
| Native terminal                     | Shipped baseline — composable VT buffer, rich-text view, real PTY, resize, ANSI/256/true color, alternate screen                                                                                                    |
| Display modes                       | Shipped — shared-device multi-output KMS, EDID-backed persisted arrangement/primary state, transactional Settings monitor map, per-output presentation, surface membership, hotplug and dynamic `wl_output` globals |
| Desktop protocols                   | Shipped tranche — primary selection, activation, dynamic fractional scale/viewporter, xdg-output, cursor shape                                                                                                      |
| Desktop → Files DnD                 | Shipped — desktop-icon drag escalates to a real Wayland source when it crosses onto a client window                                                                                                                 |

## Near term

| Item                          | Notes                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DnD polish                    | Retained drag previews now follow hardware-cursor motion without a software fallback; next explicit move vs copy chooser and GTK `text/uri-list` verification                                                                                                                                                         |
| Icon set                      | Runtime SVG symbolic baseline shipped; next freedesktop theme resolution and richer app/file artwork                                                                                                                                                                                                                  |
| Files UX                      | Keyed grid/list multi-selection and keyboard nav shipped; next rubber-band, type-to-select, thumbnails, conflict UI                                                                                                                                                                                                   |
| MIME / actions                | Content magic matching, external plugin discovery, richer app icons                                                                                                                                                                                                                                                   |
| Launcher                      | Icons from `.desktop`, categories, pinned apps                                                                                                                                                                                                                                                                        |
| Performance                   | Retained desktop/drag layers avoid full-frame software fallback; next reduce idle atmosphere damage and add frame pacing                                                                                                                                                                                              |
| Flexible compositor rendering | In progress — selectable software/EGL output, composition effects contract, timings, layered GLES + GBM scanout                                                                                                                                                                                                       |
| Accelerated native clients    | In progress — generated TS Wayland bindings plus pooled retained EGL/GBM dma-buf presentation are default with software/SHM fallback; rectangles, shadows, clipped images, and cached text layers avoid full-window rasterization; next glyph atlas, retained group-opacity surfaces, and compositor zero-copy import |
| Widget styling v2             | In progress — semantic recipes and foundations now cover radius, borders, density, focus, opacity, motion, and elevation; shared overlay/focus/select/dialog/toast primitives and their live showcase tranche are shipped; next state/theme matrices and remaining chrome migration                                   |
| Theme families                | Planned — Cupertino (macOS), Redmond (Windows), Plasmid (Qt/KDE), and Gnomish (GTK/GNOME), implemented as renderer-neutral Moire foundations and widget recipes                                                                                                                                                       |
| App UI audit                  | Settings display controls now use shared Select/SegmentedControl widgets; migrate Settings (the last app using raw `createElement`) to JSX and continue replacing app-local sizing with intrinsic layout                                                                                                              |
| Text input / IME              | Implement `zwp_text_input_v3` with a real input-method broker; do not advertise a no-op global                                                                                                                                                                                                                        |

## Medium term

| Item                      | Notes                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| File thumbnails           | Image widget ready; generators not shipped                                                            |
| Trash / storage providers | Native freedesktop Trash, UDisks2-backed volumes, and optional protocol providers; no GVFS dependency |
| Notifications             | Prefs field exists; no toast daemon                                                                   |
| Portal expansion          | FileChooser, Settings, Screenshot, Wallpaper, and other Moire-native backend interfaces               |
| Multi-monitor             | Per-output wallpapers, rotation, mirror mode, cross-GPU handoff, atomic KMS commits                   |
| X11 XDND                  | Out of scope for pure X11; Xwayland via Wayland DnD only                                              |

## Longer term

| Item                          | Notes                                                     |
| ----------------------------- | --------------------------------------------------------- |
| GPU / SDF chrome              | True rounded-rect path; leave CPU rims for now            |
| Cocoa / Win32 UI platforms    | `@moire/ui` platform interface already abstracts backends |
| Workspace / EWMH completeness | Partial Xwayland support today                            |
| Live / video wallpapers       | Not planned for day-0 line                                |

## Explicit non-goals (current line)

- Replacing every GTK file manager feature (search indexing, bulk rename UI, etc.)
- Broadsheet / purple-gradient / cream-serif visual directions — Moire stays teal-ink
- Pushing git tags or remotes as part of feature work unless requested

## How to extend without breaking the model

1. New interactive chrome → `@moire/ui` widget (or theme token), not one-off draw in an app.
2. New compositor protocol behavior → `packages/core`, keep widgets OS-agnostic.
3. New day-0 client → start from `moire-session` only after guest smoke; document in [apps/](./apps/).
