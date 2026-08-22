# Parallels VIRTUAL DRM — present / refresh

Learning from getting foot to show up in `prlctl capture` on MoireDev.

## Symptom

- Wayland clients connect and commit; compositor logs paint surfaces.
- CPU readback of the dumb-buffer mmap matches client pixels (e.g. foot `0xff242424`).
- `prlctl capture` (and the visible display) stay on the **last modeset clear color** (teal wallpaper).
- PNG stays ~4KB / one unique color until present is fixed; after fix, capture is multi-KB with many colors.

## Cause

On Parallels’ **VIRTUAL** DRM, writing the dumb framebuffer (via `mmap` + `Uint32Array.fill` / staging flush) does **not** reliably update what is scanned out / what `prlctl capture` sees.

The guest must **re-apply the CRTC → FB mapping** after updating pixels — typically another `drmModeSetCrtc` (or a page flip). Without that, mmap readback can look correct while the display stays stale.

This is separate from:

- `koffi.view` element stores / `.set()` quirks (prefer `fills` or staging + `flushMmap`)
- DRM master conflicts (`drmModeSetCrtc` failing with `-13` when another process holds the card — including a `STOP`’d compositor)

## Readback fix (in tree)

After each composite flush:

1. `flushMmap(kms.map, stage)` — `memcpy` staging into the dumb mapping  
2. **`presentKms(kms)`** — re-`drmModeSetCrtc` with the same `fbId` / connector / mode  

See `packages/sys/src/kms.ts` (`presentKms`) and `packages/core/src/server.ts` (`composite`).

The optional direct EGL path instead rotates two renderer-owned GBM
framebuffers and queues `drmModePageFlip`. It waits for the flip event before
reusing the previous front buffer; if the driver rejects page flips before one
is queued, it falls back to the same proven `drmModeSetCrtc` operation.

## Verification

```bash
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-clean-restart.sh
prlctl capture MoireDev --file ~/Projects/moire/vm/screen-now.png
```

- **Failing present:** ~4047 bytes, single color `(24, 90, 110)`  
- **Working present:** larger PNG, many unique colors, foot region ~`(36,36,36)` / `0x242424`

Do not trust mmap samples alone — always confirm with capture.

## Ops pitfalls (related)

- Stop gdm after reboot so the compositor can be DRM master: `systemctl stop gdm3`
- Kill stuck compositors (especially state `T` / SIGSTOP) before restarting — they keep master
- Prefer guest scripts under `scripts/`; avoid `prlctl exec … | head` (hangs/kills sessions)
- Guest worktree: `/home/moire/moire` (rsync); host `node_modules` is darwin
