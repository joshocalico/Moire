# Bluetooth devices, pairing and explicit trust

This source slice adds BlueZ observations to Moire's existing management service
and Quick Settings. It lists already-paired devices, their adapter, address and
observed connection state. Devices with the same name retain separate identities.

Production defaults to read-only. On an explicitly interactive backend, Connect
requires a paired, trusted device whose adapter is powered. Explicit Disconnect
requires a paired, connected device whose adapter is powered; it remains available
after trust removal under the existing interactive connection policy. These controls are exercised against disposable fake BlueZ in the source
checks. No real radio or device operation is accepted by this milestone.

## Status and actions

An absent BlueZ daemon, absent adapter, powered-off adapter and an empty paired
device list are distinct states. Read failures remove stale actionable data.
Unsupported Bluetooth is hidden from the main panel; the detail view still
reports its unavailable state. A supported control remains visible through a
temporary read failure. The panel uses shared measured widgets and its existing
scrolling, focus and Back behavior.

Actions capture the desktop-service owner, revision and opaque device identity.
The service rejects stale revisions; the backend checks the current BlueZ owner,
device occurrence, pairing, trust and adapter power before writing. Removal and
reappearance produce a new device identity. A device name is never an action key.

Connection success requires observed `Connected` readback. A command reply alone
does not establish success. Pending and uncertain operations block another write.
Client cancellation or a transport deadline cannot undo a daemon operation;
late callbacks must still match the owner and device identity before they can
publish a result. `Connected` does not establish an audio route or acceptance of
any device profile.

If BlueZ changes owner during an uncertain operation, this adapter cannot verify
the old result. Connection controls remain blocked for that adapter's lifetime.
Refresh can restore observations without clearing that uncertainty.

Refresh reads existing BlueZ objects. It does not start discovery or activate an
absent daemon. Known-device Refresh does not change pairing, trust, radio power or discoverability,
and it does not register a pairing agent.

## Source-only discovery and pairing

Pairing is a separate injected capability, disabled by default. The production
service does not inject it. Interactive Connect policy alone cannot enable it.
The source checks inject `createBluezPairingAdapter({ enabled: true, connect })`
against fake BlueZ on a disposable private bus.

**Find devices** selects an already-powered adapter and acquires one discovery
session on a dedicated connection. Its lease lasts at most 30 seconds, including
pairing. **Pair** starts one selected-device attempt. Numeric comparison shows a
six-digit code and requires explicit confirmation. Local pairing authorization
also requires explicit consent. Display-only code prompts show digits to enter
on the remote device. Reject receives initial keyboard focus. Escape cancels the
prompt; leaving or closing Bluetooth controls releases the owned discovery.

An application-owned `DisplayYesNo` Agent1 handles this attempt. It never becomes
the default agent. An independently enabled input capability uses `KeyboardDisplay` and supports
local PIN/passkey entry through the existing masked text field. Pairing alone
does not enable input. PINs contain 1–16 printable ASCII characters; passkeys
contain 1–6 digits, including zero and leading zeros. Other PIN characters are
explicitly unsupported. Submit sends one typed response; Cancel, prompt replacement
and closing the view clear the transient draft. Input never enters status, preferences
or logs. Service authorization remains explicitly rejected. Incoming prompts outside the selected local attempt
are rejected. Pairing never writes `Trusted`; paired-but-untrusted devices remain ineligible
for Connect until a separate explicit trust operation completes. Pairing does not prove audio routing.
See the [BlueZ Agent API](https://bluez.readthedocs.io/en/latest/agent-api/).

Lease, attempt and single-use prompt identities bind actions to the initiating
desktop-bus caller, current BlueZ owner and exact adapter/device occurrence.
Consent and cancellation remain dispatchable while Pair is pending. Success
requires a successful local Pair reply and same-attempt observed `Paired` readback.
Lost replies, unsuccessful cancellation or replacement owners retain an explicit
unknown result. Another Pair cannot silently clear that uncertainty.

Lease expiry, caller loss, cancellation and teardown retire prompts and release
only discovery owned by this connection. Failed or uncertain discovery cleanup
closes that connection. Other applications' discovery sessions remain independent.
No cleanup request targets a replacement BlueZ owner. See the
[BlueZ Adapter API](https://bluez.readthedocs.io/en/latest/adapter-api/).

## Source-only explicit trust

Trust writes require a separate injected `trustPolicy: "interactive"`. The default
is read-only, independent of pairing, input and connection policies. Production
does not enable any of these write capabilities.

The paired-device card offers **Trust device** or **Remove trust**. The service
presents a single-use confirmation bound to the initiating desktop-bus caller,
BlueZ owner, exact device occurrence, prior observed trust and desired trust.
Cancel receives initial focus. Cancel, expiry, caller loss and changed observations
retire consent without writing. Closing or leaving the view releases owned consent.

Explicit confirmation permits one `Device1.Trusted` property write. Completion
requires exact observed `Trusted` readback. A reply alone does not establish trust;
pending and unknown outcomes block conflicting requests. Pair never invokes this
operation. Trust does not automatically Connect or retry.

**Remove trust does not disconnect the current connection.** Explicit Disconnect
remains available for an observed paired, connected device under the independent
interactive connection policy, with adapter power still required. Connect continues
to require observed trust. Trust removal does not forget the pairing.

## Verification

With workspace dependencies and `dbus-daemon` available:

```bash
./scripts/test-bluetooth-controls.sh
pnpm --filter @moire/system-management typecheck
pnpm --filter @moire/system-management-service typecheck
pnpm --filter @moire/shell typecheck
```

The focused checks use a disposable private D-Bus daemon and synthetic BlueZ
objects, plus public Window input. They cover read-only behavior, strict parsing,
owner and identity replacement, stale revisions, observed completion, pending
and uncertain outcomes, errors, disposal, and Quick Settings interaction.
Source receipts are under `vm/verification/2026-10-04-c52-known-bluetooth`.
The separately labeled source-only pairing receipt is under
`vm/verification/2026-10-04-c53-bluetooth-pairing`.
The input/trust receipt is under
`vm/verification/2026-10-04-c54-bluetooth-input-trust`. The focused flow uses synthetic
PINs and fake devices through actual BlueZ-adapter/service/client code, including
Pair → observed paired/untrusted → explicit Trust → observed trusted → manual
Connect. It also covers stale/reused consent, independent policy combinations,
held acknowledgements, uncertain outcomes, secret exclusion and post-revocation
Disconnect. These receipts do not qualify installed BlueZ, physical devices,
native input or audio.

## Installed requirements

The current VM runner exposes no Bluetooth adapter, and its Nix configuration
does not enable BlueZ. Installed testing needs separate approval for the service,
its resulting system-bus policy and a deliberately provided adapter. No Nix,
permission, service or device changes are included in this source slice.

The pinned NixOS Bluetooth module defaults `powerOnBoot` to true. A future
observation candidate needs an explicit false value and inspection of the exact
shipped policy. No new Polkit rule or privileged group is presumed necessary.
See the [pinned NixOS module](https://raw.githubusercontent.com/NixOS/nixpkgs/7fc6f2c20af09cdcaf48b92ec3121860139ec668/nixos/modules/services/hardware/bluetooth.nix)
and [BlueZ device API](https://bluez.readthedocs.io/en/latest/device-api/).
