# Roadmap

Status of the Moire desktop relative to day-0 and near-term work. Dates are not committed; order reflects dependency and product priority.

## Shipped (post-`v0.2.0`)

Checkpoint tag **`v0.2.0`** marks the tree before Files/desktop/DnD/wallpaper expansion.

| Area | Status |
| --- | --- |
| Wayland compositor + SSD | Shipped — stack compositing, server decorations |
| Session (`moire-session`) | Shipped — D-Bus, foot, Files; Files registered for `inode/directory`; no Nautilus |
| `@moire/ui` toolkit | Shipped — layout, controls, scroll/list/grid, icons, DnD widgets, motion |
| Theme tokens + atmosphere wallpaper | Shipped — cached paint, ambient drift, prefs override |
| Settings (Appearance / Sound) | Shipped — live `applySettings`, wallpaper presets |
| Moire Files | Shipped — richer navigation/selection hierarchy, grid/list, Open With, context actions, Wayland DnD |
| Portal / session D-Bus | Shipped baseline — internal TypeScript D-Bus stack and native AppChooser backend; remaining portal interfaces use GTK |
| Desktop icons | Shipped — paint under windows, select/open, layout persist, reposition + folder drops |
| Wayland DnD | Shipped — compositor session, desktop drop sink, hotspot previews + rejected-drop return animation |
| Panel / launcher chrome | Shipped — brand-forward panel, list launcher |
| Display modes | Shipped baseline — shared-device multi-output KMS, horizontal logical layout, per-output software presentation, surface enter/leave membership, libudev hotplug reconciliation, Settings UI, dynamic `wl_output` globals |
| Desktop protocols | Shipped tranche — primary selection, activation, fractional scale/viewporter, cursor shape |
| Desktop → Files DnD | Shipped — desktop-icon drag escalates to a real Wayland source when it crosses onto a client window |

## Near term

| Item | Notes |
| --- | --- |
| DnD polish | Stronger drop highlights; explicit move vs copy chooser; verify GTK `text/uri-list` peers |
| Icon set | Richer bundled PNGs or Adwaita fallback; optional SVG later |
| Files UX | Breadcrumb path control, keyboard nav, multi-select, thumbnails, conflict UI |
| MIME / actions | Content magic matching, external plugin discovery, richer app icons |
| Launcher | Icons from `.desktop`, categories, pinned apps |
| Performance | CPU composite still hot; reduce idle dirty from atmosphere when possible |
| Text input / IME | Implement `zwp_text_input_v3` with a real input-method broker; do not advertise a no-op global |

## Medium term

| Item | Notes |
| --- | --- |
| File thumbnails | Image widget ready; generators not shipped |
| Trash / gvfs places | Network and trash backends |
| Notifications | Prefs field exists; no toast daemon |
| Portal expansion | FileChooser, Settings, Screenshot, Wallpaper, and other Moire-native backend interfaces |
| Multi-monitor | Editable/persisted placement, per-output scaling/wallpapers, mirror mode, cross-GPU handoff, atomic multi-output commits |
| X11 XDND | Out of scope for pure X11; Xwayland via Wayland DnD only |

## Longer term

| Item | Notes |
| --- | --- |
| GPU / SDF chrome | True rounded-rect path; leave CPU rims for now |
| Cocoa / Win32 UI platforms | `@moire/ui` platform interface already abstracts backends |
| Workspace / EWMH completeness | Partial Xwayland support today |
| Live / video wallpapers | Not planned for day-0 line |

## Explicit non-goals (current line)

- Replacing every GTK file manager feature (search indexing, bulk rename UI, etc.)
- Broadsheet / purple-gradient / cream-serif visual directions — Moire stays teal-ink
- Pushing git tags or remotes as part of feature work unless requested

## How to extend without breaking the model

1. New interactive chrome → `@moire/ui` widget (or theme token), not one-off draw in an app.
2. New compositor protocol behavior → `packages/core`, keep widgets OS-agnostic.
3. New day-0 client → start from `moire-session` only after guest smoke; document in [apps/](./apps/).
