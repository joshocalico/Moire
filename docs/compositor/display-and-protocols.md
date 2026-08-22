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
If a connector changes its EDID/mode list, Moire updates `wl_output`, Settings,
and the shell. If an active mode disappears it selects the saved mode when
still valid, then the new preferred mode.

Connected outputs on one DRM card now share the DRM-master file descriptor but
own independent CRTCs, dumb framebuffers and connector mode state. Core lays
them out horizontally in one logical coordinate space. The software renderer
paints that logical desktop once, crops the appropriate region into every
output framebuffer, and presents each CRTC. Runtime connector additions and
removals add/remove `wl_output` globals; if the original primary is unplugged,
DRM-fd ownership transfers to a surviving output before its framebuffer is
released. Maximized and fullscreen windows target the output containing the
window rather than spanning the combined desktop. EDID data supplies a stable
identity (with a connector fallback), so confirmed positions, primary selection
and modes do not depend on connector enumeration order.

## D-Bus display service

The compositor owns `org.moire.Display1` at `/org/moire/Display1`:

| Method | Signature | Role |
| --- | --- | --- |
| `GetModes` | `→ (as modes, s current, s preferred)` | Enumerate stable mode IDs |
| `GetOutputInfo` | `→ (s name, i widthMm, i heightMm)` | Read live connector identity and physical size |
| `ListOutputs` | `→ a(ssssssiiiiib)` | Read stable identity, labels, mode, geometry, scale and primary state |
| `SetLayout` | `(a(siiub) outputs) → b changed` | Begin a whole-desktop position/scale/primary trial |
| `ConfirmLayout` | `→ b confirmed` | Keep and persist the pending layout by display identity |
| `RevertLayout` | `→ b reverted` | Restore the entire previous layout immediately |
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
| `wl_output` v3 | Per-connector globals, modes/geometry, live updates and `wl_surface.enter`/`leave` membership |
| `zxdg_output_manager_v1` v3 | Logical position/size plus stable connector name and EDID description |
| `zwp_primary_selection_*` v1 | Independent middle-click selection transfer |
| `xdg_activation_v1` | One-shot tokens and focus handoff |
| `wp_fractional_scale_v1` | Preferred scale follows the output containing each surface, in 120ths |
| `wp_viewporter` | Destination size and buffer scale drive logical surface geometry and scaled composition |
| `wp_cursor_shape_v1` | Semantic text/resize/default cursor requests |

`zwp_text_input_v3` is deliberately not advertised yet. Correct support needs
an input-method broker, focus enter/leave, surrounding-text state, preedit and
commit sequencing. A no-op global would merely hide a warning while breaking
IME expectations.

## Current boundary

Simultaneously active outputs on one DRM card form an editable logical desktop.
Settings provides a draggable monitor map and primary selection; core validates
the complete non-overlapping layout and owns a 15-second rollback transaction.
Rotation, mirror mode and cross-GPU handoff remain future work. Per-output
fractional scaling is effective end to end: clients render through buffer scale
or viewporter, the compositor works in logical coordinates, and the selected
software or EGL output backend scales each logical output into its physical
target. EGL automatically prefers two renderer-owned GBM framebuffers through
KMS page flips and retains the proven dumb-buffer readback path when direct
scanout allocation is unavailable. Environment overrides can force either path
for conformance and diagnosis.

## Smoke testing

The backend-neutral layout smoke uses synthetic outputs of different sizes and
a deliberately padded framebuffer pitch. It verifies horizontal coordinates,
logical bounds, monitor hit-testing, straddling/crossing output membership,
DRM-owner replacement, exact per-output crop pixels, untouched pitch padding,
mixed-DPI logical-to-physical pixels, and rejection of out-of-bounds layouts:

```bash
pnpm --filter @moire/core smoke:display
```

Inside MoireDev, the integration wrapper runs that smoke, reads the live
`ListOutputs` D-Bus topology, injects a harmless DRM udev change and confirms
the compositor/socket and topology survive:

```bash
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-smoke-multi-output.sh
```

This VM kernel has VKMS, but its module exposes the older single-connector
interface. The synthetic smoke therefore covers multi-output layout and
presentation deterministically; a same-card two-connector machine is still
needed to exercise multiple live CRTCs.
