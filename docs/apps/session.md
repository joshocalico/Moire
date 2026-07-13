# Guest session

How Moire runs inside the Parallels guest (MoireDev).

## Day-0 apps

| App | Role |
| --- | --- |
| Files | File manager |
| foot | Terminal |

Nautilus is intentionally out of the Moire session once Files is verified.

## Runtime dirs

- Wayland socket under `$HOME/.moire-runtime` (session sets `XDG_RUNTIME_DIR` here).
- Config under `~/.config/moire/`.

## Scripts

Host-side helpers live in repo `scripts/` — prefer those over fragile `prlctl exec … bash -c`.

| Script | Purpose |
| --- | --- |
| `scripts/guest-clean-restart.sh` | Clean compositor / session restart in guest |
| (others) | See [Scripts](../reference/scripts.md) |

Typical verify loop from the host:

```bash
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-clean-restart.sh
prlctl capture MoireDev --file ~/Projects/moire/vm/capture.png
```

## More

- [Dev VM](../dev-vm.md)
- [Known issues](../known-issues.md)
- [Parallels DRM present](../parallels-drm-present.md)
