# Boot presentation, static stage

This package runs its own React root with the shared `Backdrop` and `BrandMark`. A separate Node guardian observes verified Escape-capable evdev input and owns the console lease. The child renders one bounded software frame through KMS. No Wayland server, desktop shell, application bus, fake progress, or minimum display duration is started.

C20 verifies automatic stage-2 startup through accepted React scanout, main-only READY, authenticated text release and final console-policy admission into the welcome session on two fresh QEMU/HVF boots. Its welcome pixels are inspected; the brief automatic React frame was not captured. Nine real systemd graphs separately cover startup and console policy. C19's native UTM window also delivered synthetic Escape: the actual evdev event, fresh latch, retired guardian/renderer, installed cleanup acknowledgement and readable console captures are saved in `vm/verification/2026-10-03-physical-escape/c19-utm-native`. A human physical-key test and initial automatic-stage Escape remain separate. Initrd integration and hardware animation remain unfinished. The current renderer stays static; EGL availability alone does not enable motion. A process stuck in an uninterruptible kernel/GPU ioctl cannot be promised bounded display release.

## Installed entry contract

On an ARM64 Linux Nix builder, build the standalone package with:

```sh
nix build .#moire-boot
./result/bin/moire-boot-smoke
./result/bin/moire-boot-view-smoke
```

`nix/boot.nix` precompiles separate guardian and renderer entries through
`scripts/bundle-boot.mjs` and generates the immutable Fold texture at build time.
The measured package is 9.36 MiB, with a 256.20 MiB NAR runtime closure across
55 store paths. Node and its inherited libraries dominate that closure; it is
not yet a minimal initrd runtime. A fresh frozen C17 source build, including the
evdev corrections, produces
`/nix/store/hi1cbijd23xnnj5ycac3f1b9j421nbbb-moire-boot-0.0.0` with the same
measured closure. Its installed process, React and latch-entry checks pass;
these are not native keyboard or console recovery checks. Provenance is in
`scripts/verification/c17/`. Managed cleanup described below is newer source
and is not included in that C17 standalone artifact.

The package includes the five current shared fonts and licenses, 48 SVG icons,
Yoga's embedded WASM and only Linux ARM64 Koffi. It does not retain the full
desktop/media package, Xwayland, Mesa, tsx, esbuild, npm or corepack. Runtime
startup does not regenerate artwork. The configuration uses one initial
coordinator for automatic stage-2 startup. The package is not enabled in initrd.

The guardian entry is `src/main.ts`. It expects these environment variables:

| Variable              | Meaning                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOIRE_BOOT_RENDERER` | Absolute installed renderer entry path. It is launched directly with the current Node executable, inherited loader arguments, and private IPC. |
| `MOIRE_BOOT_ARTWORK`  | Absolute installed raw RGBA Fold source, exactly 1280×800×4 bytes. The full PNG with a baked wordmark is a different asset.                    |
| `MOIRE_BOOT_TTY`      | Numbered active text VT, default `/dev/tty1`. The lease opens and validates it before graphics acquisition.                                    |
| `MOIRE_BOOT_CARD`     | Optional DRM card. Otherwise choose a card with a connected output.                                                                            |
| `MOIRE_BOOT_LATCH`    | Escape request latch, default `/run/moire-boot/console-requested`. A subsequent stage skips graphics after an Escape request.                  |

Input registration and capability verification precede `enterGraphics()` and child launch. Losing all verified recovery devices releases presentation. Escape, SIGTERM for actual stage completion, SIGINT, child failure, or malformed lifecycle IPC all end the display lifetime. The child has its own process group; the guardian signals only that group. A normal child exits immediately without waiting for the 100 ms graceful allowance. A stalled child receives SIGKILL after that allowance.

The one-second hard deadline reports `termination-failed`. It does **not** authorize VT restoration against a live DRM owner. The guardian keeps its child/recovery listeners and pending result until actual child exit. Only then does it restore/close the lease and resolve the result. Root service ordering must not launch the compositor merely because a timeout diagnostic was printed. Serial recovery must remain independent.

## Managed service and release admission

The NixOS configuration installs `moire-boot.service`, `moire-initial-startup.service`
and the explicit `moire-boot-handoff` command. The initial coordinator is the sole
automatic graphical-target entry. It starts boot in one transaction, stops and
authenticates its exact attempt, then starts the desktop in a separate transaction.
It adds no timed display hold. Manual recovery remains available:

```sh
systemctl start moire-boot.service
moire-boot-handoff
```

The service conflicts with the existing desktop so that it can acquire the
active text VT. It uses the existing local root recovery context, control-group
termination with `ExitType=cgroup`, a 60-second active runtime ceiling, and no automatic
restart. `Type=notify`, `NotifyAccess=main` and a 15-second startup deadline also
bound a pre-ready stall. Only the guardian's first validated accepted-scanout IPC
callback sends an actual native `READY=1` datagram. The renderer does not inherit
`NOTIFY_SOCKET`; skipped stages never claim readiness. Notification failure retires
the renderer and fails startup. The startup budget has substantial headroom over
C19's measured subsecond accepted frame; C20's fresh installed automatic startup also passes.
The active ceiling also bounds surviving descendants after guardian loss.
Its managed guardian closes its console
handle after direct renderer exit and reports `renderer-exited`; it never
restores KD_TEXT itself. The childless `moire-boot-cleanup` stop helper requires
stable recursive exit evidence, excluding only its own exact PID, before
restoring the recorded active VT and verifying KD_TEXT readback. A same-boot
unresolved graphics lease prevents a new invocation from overwriting it.

The root `moire-boot-state.service` initializes a protected current-boot attempt
ledger. Boot's `ExecStartPre` publishes the actual invocation before the guardian
can launch. Managed startup requires that exact ledger identity. An attempted
invocation with missing lease/release cannot become a never-attempted startup.
The initializer remains active for this boot and never downgrades existing
history. Missing, malformed or foreign-boot state fails closed.

Every desktop start requires `moire-boot-release-gate.service`, a root check-only
oneshot that runs after boot stop/cleanup. It opens no device, starts no desktop
and accepts either initialized never-attempted state or authenticated historical
release with no returning workload owners. The dedicated `--desktop-admission-check`
also rejects a protected Escape latch or authenticated console-requested skip,
rechecks the exact ownership checkpoint and rereads console intent. Automatic starts
and restarts cannot silently cover a console request. Explicit later recovery must
deliberately preserve and clear the validated request before a fresh stage; the
ownership-only `--admission-check` never clears it. A collected manager InvocationID is
accepted only through that exact current-boot history. The gate reruns during
later activation; real restart and transaction ordering remain native test gates.

Handoff captures a live manager InvocationID, or a verified historical checkpoint
if the unit has already been collected. It requests stop, checks that checkpoint
with `moire-boot-cleanup --admission-check --expect TOKEN`, and starts the desktop
as a separate transaction. Mandatory admission then checks again. Missing or
stale acknowledgement blocks startup. A stop timeout is not proof; successful
cleanup after escalation can still authorize handoff. Historical checks never
write a release, restore a VT or enter cleanup's retry loop. Cleanup never opens
DRM/input devices, changes cgroup membership or activates another VT.

Managed environment adds `MOIRE_BOOT_MANAGED=1`, `MOIRE_BOOT_UNIT`, systemd's
`INVOCATION_ID`, and `MOIRE_BOOT_SERVICE_STATE` (default `/run/moire-boot/service`).
Cleanup retries pending owners for at most `MOIRE_BOOT_CLEANUP_MS` (default
2000 ms, maximum 10000); malformed or ambiguous evidence fails immediately.
A D-state owner, failed readback or dead cleanup helper produces no successful
acknowledgement. C19 proves compiled native cleanup, ledger and ownership gate behavior
for its exact manual unit. C20's automatic coordinator/notify/console-policy graph
passes actual QEMU and separate ordinary-FD manager checks. The renderer owns IPC through an idempotent lifetime,
including actual parent loss and callback-reported status-send errors; unexpected
errors still propagate after real graphics cleanup.

The renderer requests at most 1920×1200 physical pixels through the shared KMS bound before native buffer allocation, uses a stable 4,096,000-byte source, packs CPU rows to the actual scanout pitch, and submits a single frame. Its private `scanout-accepted` message includes the actual KMS feedback after flip retirement or blocking modeset acceptance. It does not claim physical visibility, verified hardware vblank timing or tear-free output. Feedback alone never enables hardware animation.

## Scoped checks

From the repository root:

```sh
node_modules/.bin/tsc -p apps/system/boot/tsconfig.json --noEmit
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs apps/system/boot/src/guardian.smoke.ts
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs apps/system/boot/src/view.smoke.tsx
node_modules/.bin/oxlint apps/system/boot/src
```

Guardian checks use real disposable children for healthy exit, blocked JS, SIGSTOP, ignored SIGTERM, unexpected signals, missing executable, malformed/late IPC and duplicate release. Console/input are injected because no device is opened. The termination-failure check deliberately suppresses the signal boundary while a real child remains alive, verifies that restoration has not happened, then kills the fixture and verifies restoration after exit.

View checks generate the actual shared Fold source only in a temporary fixture, render the real shared React components at normal, narrow, portrait and maximum dimensions, count opaque artwork/serif pixels, verify stable retained texture identity and static motion policy, and exercise padded scanout rows. These establish source behavior, not native early-boot acceptance.
