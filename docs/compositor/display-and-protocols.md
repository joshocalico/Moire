# Display modes and desktop protocols

Moire owns KMS mode selection in `@moire/sys`; applications never open DRM.
`@moire/core` publishes the resulting logical desktop to Wayland clients and
`apps/compositor` exposes the user-facing control boundary over Moire's native
D-Bus stack.

## Runtime mode changes

`setKmsMode(output, modeId)` is transactional:

1. Allocate and map a dumb framebuffer for the requested connector mode.
2. Register the framebuffer and ask KMS to accept the new CRTC configuration.
3. Only after a successful modeset, swap the live output fields and destroy the
   previous framebuffer.

A failed allocation or modeset therefore leaves the current output intact.
After a successful change, core clears its staging buffer, clamps the pointer
and windows, reconfigures maximized/fullscreen/oversized toplevels, invalidates
shell chrome, and sends every bound `wl_output` the complete mode list with new
current/preferred flags.

The initial mode can be selected with `MOIRE_MODE=WIDTHxHEIGHT@MILLIHZ`.

## D-Bus display service

The compositor owns `org.moire.Display1` at `/org/moire/Display1`:

| Method | Signature | Role |
| --- | --- | --- |
| `GetModes` | `→ (as modes, s current)` | Enumerate stable mode IDs |
| `SetMode` | `(s mode) → b changed` | Apply a live KMS mode |

Settings consumes this service. It does not link Koffi or import `@moire/sys`.
For guest diagnostics, use `guest-display-mode.sh list` or
`guest-display-mode.sh set 1280x720@60000`.

## Wayland protocol tranche

| Protocol | Current behavior |
| --- | --- |
| `wl_output` v3 | All DRM modes, current/preferred flags, live updates |
| `zwp_primary_selection_*` v1 | Independent middle-click selection transfer |
| `xdg_activation_v1` | One-shot tokens and focus handoff |
| `wp_fractional_scale_v1` | Native preferred scale in 120ths |
| `wp_viewporter` | Fractional-scale companion viewport objects |
| `wp_cursor_shape_v1` | Semantic text/resize/default cursor requests |

`zwp_text_input_v3` is deliberately not advertised yet. Correct support needs
an input-method broker, focus enter/leave, surrounding-text state, preedit and
commit sequencing. A no-op global would merely hide a warning while breaking
IME expectations.

## Current boundary

This is single-output display management. Hotplug, output placement,
per-output scaling and multi-monitor atomic commits remain future work. The
renderer remains independent: both the software backend and a future EGL
backend consume the output dimensions owned by core.
