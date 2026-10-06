# Desktop services: C36 verified checkpoint

C52 adds a source-only known Bluetooth device flow. See
[Known Bluetooth devices](bluetooth-controls.md) for its read-only production
default, private-bus checks and installed requirements. C50/C51 remain preserved.

C46 adds a source-tested read-only battery/UPS observation flow. See
[Battery status](battery-status.md) for its user flow, focused checks and the
default guest's missing UPower backend. No power actions are enabled.

C45 adds a source-tested NetworkManager Wi-Fi detail flow to the existing
service. See [Network controls](network-controls.md) for policy, supported
networks, focused checks and the current VM backend limitation. The historical
C36 native results below remain unchanged.

C34 adds session D-Bus lifecycle support, observed audio state and desktop
notifications to the existing management service. C34 is built and passes all
five installed checks. C35 fixes unchanged background audio polling, passes all
five checks against its exact installed package, and boots automatically under
direct QEMU/HVF and UTM. Native Clear All and DND On/Off now pass with actual
method receipts and independent readback. Native desktop acceptance remains
partial. C36 adds history reading keys, passes the host suite and five exact
installed gates, and verifies native Page Down/End/Home, body/Back focus and
Clear All in a fresh software session. Pointer-driven scrolling, broader input,
physical tearing and native media remain open. All earlier images are preserved.
See the [C36 review](quality-review.md#candidate-36-scrolling-and-native-keyboard-results).
The rejected initial Quick Settings draft has been replaced in source with
shared measured widgets. Josh approved the [main reference](../vm/verification/design-references/2026-10-03/quick-settings-approved.png),
[separate notification tray](../vm/verification/design-references/2026-10-03/notifications-approved.png)
and [alternate detail views](../vm/verification/design-references/2026-10-03/quick-settings-subpanels-approved.png).
Root inspected and archived their actual pixels and SHA256 receipts. The
[password states](../vm/verification/design-references/2026-10-03/wifi-password-preapproved.png)
were a pre-approved visual reference at C36; C45 implements the source flow
without activating a live network backend. Native C36 screenshots confirm the wired icon,
hidden unsupported rows and shared rounded frames at one scale/theme. Broader
appearance and physical input qualification remain open.

The service reads local interface addresses and uses an existing `wpctl` or
`pactl` backend for volume, mute and output identity. Missing tools or an absent
server produce an unavailable state. Capability metadata distinguishes an absent
backend from transient loading or failure: unsupported hardware rows are hidden,
while a known supported control stays visible through temporary failures.
Network remains visible. Typed Linux interface transport gives wired connections
an Ethernet icon, Wi-Fi its own icon, and mixed/unknown links a generic icon.
Interface addresses do not establish Internet connectivity or provide Wi-Fi
configuration. This work does not install or activate an audio server. Battery,
brightness, Bluetooth, power and suspend/resume are not implemented by this slice.

Audio actions verify the observed output before writing and read it back after
writing. A command has a 1.5-second deadline and a 64 KiB output limit. A desktop
action allows 20 seconds for the bounded command sequence. Polls coalesce while
a read is in progress. Settled background reads retain the latest observation;
equal semantic results preserve its identity and emit no change. Initial
discovery and actual mutations still publish loading. A client deadline cannot undo a backend write: the service
publishes pending state, prevents duplicate actions and publishes the eventual
observed result. Service owner changes revoke client readiness and pending
client waits. CLI inspection and mutation are separate operations; an external
sink change between them is not an atomic transaction.

The session owns `org.freedesktop.Notifications` only when the name is free.
It does not replace an existing daemon. Notifications support same-producer
replacement, expiry, dismissal, sender disappearance, bounded history and DND.
The default passive binding advertises `body` only. The production desktop
binding opts into `body` and `actions` because its separate tray presents supplied
actions and sends revision-bound `ActionInvoked` signals to the original producer.
It does not advertise images, markup, links, sound or persistence. History cannot
invoke a producer. Complete bodies and long action labels are measured and
scrollable in the tested source layout; native wheel scrolling remains
unaccepted after the C36 input trace. History opts into shared ScrollArea
keyboard focus: unmodified arrows, Page Up/Down and Home/End read the body;
Enter/Space and Tab retain action/traversal behavior. Other scroll consumers
keep their existing behavior unless they opt in. Producer names are display labels, not authenticated app identities.
Created/closed timestamps supply actual ages. The badge counts active notices,
not unread notices. Clear all captures bounded ID/revision pairs and reports
how many were dismissed or preserved after replacement/closure. DND reuses the existing notification
preference; current VM HOME/XDG persistence remains the separate storage milestone.

The panel has independent status and notification controls. Super+Q opens Quick
Settings; Super+N opens notifications. Each detail page replaces the content of
one anchored popup. Tab/Shift+Tab traverse the active FocusScope, including
shared Slider and Toggle IDs; arrows reach the focused widget, and Escape closes
the popup. Traversal reveals clipped controls before activation and preserves
modifier releases previously delivered to a client. Compact taskbars retain an
explicit Windows overflow list, including minimized windows; it resolves current
metadata and uses the existing task activation action. CPU/unqualified popup motion
is static; no unqualified entry animation is introduced.

Volume gestures keep requested drafts separate from observed output, percentage
and mute. Pointer and keyboard updates do not write on every move: one release
commits one revision/owner-bound intent. Blur, closing, disabling or service/state
replacement cancels an undispatched draft. A dispatched operation remains pending
until actual readback; deadlines never claim rollback or trigger automatic retry.
Source component tests and shell input tests remain separate from installed/native
keyboard, pointer, scale, audio and appearance acceptance. Pointer-down captures
notification activation independently of refreshed drag geometry, so a notice
replacement cannot retarget Clear all and a service restart cannot inherit an
old click. The popup owns its rounded background and frame; transparent scrolling
viewports and measured safe insets keep rails and clipped text inside it.

Normal management-service SIGTERM/SIGINT calls the production shutdown hook,
stops its watcher, disposes audio/notification resources and closes the bus.
Owned-process tests prove normal child retirement; they do not establish
uninterruptible or SIGKILL recovery. No authentication, account, seat, system-bus
policy, device permission or Nix service changes are part of C34.

The shared D-Bus codec now aligns DOUBLE to eight bytes. Independent byte checks
and a real private daemon cover mixed DOUBLE signatures. Incoming signals have
sender/path/interface/member filtering, bounded subscriptions, owner tracking,
timeouts, cancellation and disconnect cleanup. The native Open With client has
an explicit two-minute interactive deadline, closes a timed-out/canceled request
on its original unique owner, and preserves quoted paths.

From the repository, run the integrated source workflows:

```sh
bash scripts/test-app-suite.sh
```

Individual gates use the workspace TS loader, for example:

```sh
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs apps/system/management-service/src/desktop-controls.smoke.ts
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs apps/system/management-service/src/shutdown.smoke.ts
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs packages/ui/src/slider-commit.smoke.tsx
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs packages/shell/src/volume-intent.smoke.ts
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs packages/shell/src/quick-settings.smoke.tsx
```

Private-bus gates require `dbus-daemon`; all owned fixtures clean their buses,
processes and temporary files. The portal regression includes an actual wait
longer than the former ten-second generic deadline. Actual audio-server readback
is an explicit opt-in gate:

```sh
MOIRE_TEST_LIVE_AUDIO=1 node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs packages/prefs/src/audio-status.smoke.ts
```

Do not count the normal CLI protocol fixtures as that live audio gate. Before
any next image review, coordinate one graphics guest with Recovery, preserve C33,
verify the installed source/package, exercise native controls and notifications,
and test suspend/resume only after a supported backend exists. The
[daily-use plan](daily-use-plan.md) tracks those stages.

The C34 native session verifies DND On/Off with independent readback, producer
action delivery, individual dismissal and inactive history. Initial DND and Clear
all attempts also showed stale-state errors. Clear all is not accepted: the final
producer snapshot still had one active notice; its later exit closed that notice.
Fast native clicks and combined key sequences sometimes missed their expected
result, while held pointer gestures worked. The cause of that input behavior is
unassigned. Physical tearing, audible playback and microphone capture remain
unverified. This software VM has no audio backend, and audio controls stay hidden.

An unchanged background audio poll currently emits loading and final state,
advancing the shared desktop revision twice. A private-bus reproducer shows this
alone can reject an unrelated captured DND intent. The next candidate addresses
that publication behavior while retaining real state, owner and revision guards.
C34's sealed image and source snapshot remain unchanged.
