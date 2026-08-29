# Compositor notes

Core Wayland server lives in `packages/core` (driven by `apps/system/compositor`). This folder documents protocol behaviors that matter to shell and toolkit authors.

## Topics

| Doc | Description |
| --- | --- |
| [Wayland DnD](./dnd.md) | `wl_data_device` session, desktop drop, drag preview |
| [Display modes & protocols](./display-and-protocols.md) | Live KMS modes, D-Bus control, protocol support |
| [Parallels DRM present](../parallels-drm-present.md) | Why `presentKms` is required on VIRTUAL DRM |
| [Paint & input](../architecture/paint-and-input.md) | Frame stack and pointer routing |

## Related packages

| Package | Role |
| --- | --- |
| `protocol` | Wire encode/decode |
| `core` | Clients, surfaces, seat, DnD, composite |
| `sys` | DRM/GBM/EGL/libinput FFI |

Output composition is runtime-selectable with
`MOIRE_RENDERER=auto|software|egl`. See
[Rendering and widget v2](../rendering-and-widget-v2.md) for the current
readback-backed EGL checkpoint, layer/effect model, direct-scanout path, and
profiling contract.
| `shell` | In-process DE chrome via `ShellBridge` |
