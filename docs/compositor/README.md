# Compositor notes

Core Wayland server lives in `packages/core` (driven by `apps/compositor`). This folder documents protocol behaviors that matter to shell and toolkit authors.

## Topics

| Doc | Description |
| --- | --- |
| [Wayland DnD](./dnd.md) | `wl_data_device` session, desktop drop, drag preview |
| [Parallels DRM present](../parallels-drm-present.md) | Why `presentKms` is required on VIRTUAL DRM |
| [Paint & input](../architecture/paint-and-input.md) | Frame stack and pointer routing |

## Related packages

| Package | Role |
| --- | --- |
| `protocol` | Wire encode/decode |
| `core` | Clients, surfaces, seat, DnD, composite |
| `sys` | DRM/GBM/EGL/libinput FFI |
| `shell` | In-process DE chrome via `ShellBridge` |
