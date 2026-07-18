# Scripts

Host and guest helpers under `scripts/`. Prefer these over ad-hoc `prlctl exec … bash -c` one-liners. Guest scripts assume the repo is mounted at `/media/psf/moire` (or `/Media/psf/moire`).

## Day-to-day guest

| Script | Purpose |
| --- | --- |
| `guest-clean-restart.sh` | Clean compositor / session restart |
| `guest-open-with-picker.sh [path]` | Open the portal-owned chooser for input and visual verification |
| `guest-pointer-drag.sh x y dx dy` | Inject a deterministic pointer drag for compositor input regression checks |
| `guest-status.sh` | Quick session / process status |
| `guest-tail-logs.sh` | Follow compositor / session logs |
| `guest-run-compositor.sh` | Run compositor alone |
| `guest-run-foot.sh` | Launch foot |
| `guest-launch-files.sh` | Launch Moire Files |
| `guest-kill-files.sh` | Kill Files clients |
| `guest-seed-desktop.sh` | Seed `~/Desktop` test files |
| `guest-prep-desktop-shot.sh` | Clear windows for icon screenshots |
| `guest-check-desktop.sh` | Desktop icon sanity checks |

Example:

```bash
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-clean-restart.sh
prlctl capture MoireDev --file ~/Projects/moire/vm/capture.png
```

## Prefs / Settings

| Script | Purpose |
| --- | --- |
| `guest-set-ui-scale.sh` | Write scale into settings |
| `guest-measure-scale.sh` | Measure applied scale |
| `guest-verify-prefs-hotreload.sh` | Hot-reload check |
| `guest-test-prefs-apply.sh` | Apply pipeline smoke |
| `guest-launch-settings-only.sh` | Settings without full session noise |
| `guest-relaunch-settings.sh` | Restart Settings |
| `guest-verify-ui-settings.sh` | UI Settings verification |

## Host bootstrap

| Script | Purpose |
| --- | --- |
| `parallels-create-moire-vm.sh` | Create Parallels Ubuntu VM |
| `guest-bootstrap.sh` / `guest-setup-inside.sh` | Guest packages / first setup |

## Build / check (host or guest)

```bash
pnpm --filter @moire/ui typecheck
pnpm --filter @moire/shell typecheck
pnpm --filter @moire/ui smoke
pnpm --filter @moire/shell smoke
pnpm --filter @moire/files smoke
```

Other `guest-test-*` / `guest-egl-*` / Nautilus scripts are historical or specialized probes — prefer Files + clean-restart for day-0 work.

See also [Dev VM](../dev-vm.md).
