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

Settings applies a mode as a 15-second trial. Core owns the timer and restores
the previous mode automatically unless `ConfirmMode` arrives, so rollback does
not depend on Settings remaining visible or alive. Confirmed modes are saved as
`displayMode` and restored at boot. `MOIRE_MODE=WIDTHxHEIGHT@MILLIHZ` overrides
the saved value for recovery and development.

## Connector detection and hotplug

At startup Moire reads the connected DRM connector's complete mode table and
uses the saved mode only when that display advertises it; otherwise it chooses
the connector's preferred/native mode. Connector identity, physical size and
preferred mode come from DRM rather than Parallels-specific configuration.

`@moire/sys` also owns an internal libudev monitor implemented through Koffi.
DRM change events schedule a debounced connector re-probe, backed by a
two-second reconciliation poll for virtual GPUs which coalesce notifications.
If the active connector changes its EDID/mode list, Moire updates `wl_output`,
Settings, and the shell. If the active mode disappears it selects the saved
mode when still valid, then the new preferred mode. If the connector is
unplugged, the single logical desktop is transactionally handed to another
connected connector on the same DRM card.

## D-Bus display service

The compositor owns `org.moire.Display1` at `/org/moire/Display1`:

| Method | Signature | Role |
| --- | --- | --- |
| `GetModes` | `→ (as modes, s current, s preferred)` | Enumerate stable mode IDs |
| `GetOutputInfo` | `→ (s name, i widthMm, i heightMm)` | Read live connector identity and physical size |
| `SetMode` | `(s mode) → b changed` | Begin a 15-second live mode trial |
| `ConfirmMode` | `→ b confirmed` | Keep and persist the pending mode |
| `RevertMode` | `→ b reverted` | Immediately restore the previous mode |

The service emits `Changed(as modes, s current, s preferred, s name,
i widthMm, i heightMm)` after a mode or connector update. Settings also polls
the small state endpoint so it remains correct across service restarts.

Settings consumes this service. It does not link Koffi or import `@moire/sys`.
For guest diagnostics, use `guest-display-mode.sh list`, `set` for a confirmed
change, or `try` to exercise automatic rollback.

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

This is still one logical output, but it now detects live mode-table changes
and can fail over between connectors on one DRM card. Simultaneously active
multi-monitor layout, cross-GPU handoff, output placement, rotation and
per-output scaling remain future work. The renderer remains independent: both
the software backend and a future EGL backend consume output dimensions owned
by core.
