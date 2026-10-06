# Roadmap

## Current handoff, 2026-10-05

Read [the canonical handoff](../HANDOFF.md) before resuming. Current stopping
scope is greeter only, then another agent. The final C63 R6 image adopts Josh's
accepted centred design and has native AccountsService discovery, same-process
wrong/blank PAM denial retry, two authenticated desktop/login/logout/fresh-picker
cycles and Reduce motion proof. Animated boot splash remains unfinished, with
the original Silk Fold E v0 sample linked in the handoff. No VM is running;
the exclusive lease is released. Preserve images and coordinate future tests
with Recovery.

Next-agent priorities include boot animation/device handoff, secure lock and
suspend, hardware/tearing qualification, Wi-Fi, Bluetooth, audio, brightness and battery integration, real app/portal/input/accessibility
workflows, recovery, installation and upgrades. Hand-editable /etc configuration
is a product preference. [C44 optional persistence](daily-use-plan.md) already preserves home and `/etc/moire` across clean cold boots; this greeter image attaches no data disk and keeps edits in RAM. Sudden-loss durability and native UI saves remain unqualified.
The historical shipped/source tables below do not imply native R6 acceptance
for the wider feature set.

Status of the Moire desktop relative to day-0 and near-term work. Dates are not committed; order reflects dependency and product priority.

The current build sequence is the [daily-use integration plan](daily-use-plan.md).
C33 supplies twenty apps with passing exact installed workflow checks and a
scoped native Screenshot → Files → Image Viewer checkpoint. Native drag input,
physical tearing and wider native workflows remain unfinished. Existing
Wayland/XWayland and LibreOffice integration are foundations to preserve.

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
| Theme families                | In progress — normalized discovery, app/provider overrides, live propagation, and Theme Lab are shipped; Cupertino now has modular foundations plus core control/form/transient-surface recipes; next complete its collection/navigation/chrome recipes before starting Redmond, Plasmid, and Gnomish                         |
| App UI audit                  | Settings display controls now use shared Select/SegmentedControl widgets; migrate Settings (the last app using raw `createElement`) to JSX and continue replacing app-local sizing with intrinsic layout                                                                                                              |
| Text input / IME              | Implement `zwp_text_input_v3` with a real input-method broker; do not advertise a no-op global                                                                                                                                                                                                                        |

## Medium term

| Item                      | Notes                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| File thumbnails           | Image widget ready; generators not shipped                                                            |
| Trash / storage providers | Native freedesktop Trash and UDisks2 provider exist. [C50 optional removable image](removable-drives.md) has native mount/open/unmount/USB PowerOff proof; optical Eject remains unqualified. UDisks/Polkit stay disabled in the default greeter image. |
| Notifications             | [Session service and bounded history](desktop-services.md) exist, with replacement, expiry, actions and DND. Images, markup, sound and persisted history are unsupported; wider native UI acceptance remains scoped to existing evidence. |
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
