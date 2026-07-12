# Known issues (follow-ups)

## Launcher “works” but apps never appear (2026-07-12)

**Cause:** Session used `XDG_RUNTIME_DIR=/run/user/1000` via `runuser` with no logind session. systemd deleted `/run/user/1000`, removing the Wayland socket path while the compositor kept running (in-process launcher still painted). Spawned apps could not connect.

**Fix:** Guest session uses `$HOME/.moire-runtime` instead.

## Gradual memory leak → OOM (logged 2026-07-12, patched same day)

**Symptom:** Compositor RSS grows steadily while the session runs (foot + Nautilus). CPU stays high (~30–40% on MoireDev) from the CPU composite path. After ~2h on MoireDev the kernel OOM-killed `node` (compositor):

```
Out of memory: Killed process … (node) total-vm:45671280kB, anon-rss:7774460kB
```

**Fixes applied:**

1. **`composite()`** — paint from `surf.pixels` directly (no `Buffer.from` every frame).
2. **`koffi.alloc` hot paths** — reuse scratch for `recvmsg`/`sendmsg`, `presentKms` connectors, and GBM import structs (was a native leak at ~60–200 Hz).
3. **Minimized surfaces** — still fire frame callbacks + `wl_buffer.release` (arrays were unbounded).
4. **Pixel snapshots** — reuse per-surface `Uint8Array` when size is unchanged.
5. **Commit logging** — gated behind `MOIRE_DEBUG_SURFACE=1`.
6. **Client disconnect** — purge `xwayByWid` / `xwayPendingBySerial`; clear surface pixels on destroy.

**Still watch:** large foot `wl_shm` pool mmaps (RSS floor); full-frame `presentKms` every tick (CPU).

## Xwayland / X11 apps (updated 2026-07-12)

**Working:**
- **Rootless Xwayland (default)** via `-rootless` + `-wm` socketpair; XWM in TypeScript; per-window `wl_surface` + React SSD (no nested “Xwayland on :N” window)
- Pairing: `WL_SURFACE_SERIAL` from XWM matched to `xwayland_shell_v1` surfaces (orphan path when Wayland `set_serial` races or is absent)
- Glamor via **`wl_drm`** / PRIME (`create_prime_buffer`)
- XRGB dmabuf snapshots force opaque alpha; GBM preferred over empty mmap
- Nautilus may keep CSD when it requests CLIENT mode

**Rootful fallback:** `MOIRE_XWAYLAND=rootful` for the nested screen.

**Still later:** full EWMH/transients; hide `xwayland_shell` from non-Xwayland clients; `WM_DELETE_WINDOW` close; confirm why Ubuntu’s Xwayland 23.2 sometimes skips `set_serial` on the wire.
