# Network controls

The C45 source checkpoint adds NetworkManager observations and a Wi-Fi detail
page to Quick Settings. Super+Q opens Quick Settings; choose Network to inspect
the current connection, Internet connectivity, available networks and local
addresses. Internet status comes from NetworkManager's connectivity observation.
A local IP address alone does not establish Internet access.

This checkpoint uses the existing management service and shared UI widgets. It
does not install or start NetworkManager, enable a radio, request authentication,
or change D-Bus policy. The NixOS configuration at C45 had no
NetworkManager backend. It therefore showed backend unavailable while retaining
local address information. Live Wi-Fi connection and native password entry are
not accepted at this checkpoint.

The later C47 QEMU configuration includes NetworkManager for virtual Ethernet
with root-only control and Polkit disabled. Wi-Fi, modem and VPN plugins remain
disabled, and Moire's default stays `readonly`. Installed guest acceptance is
recorded separately in [the VM guide](nixos-vm.md).

## Connection policy

`MOIRE_NETWORK_CONTROL` defaults to `readonly`. Reading existing observations
and refreshing status are available; scanning and connecting are disabled.
The optional `interactive` value permits operations only when the existing
NetworkManager daemon reports the necessary permissions as already granted.
An authentication challenge is not treated as permission.

The existing root-owned `/etc/moire/session.conf` can supply this setting on a
future supported system. C45 does not edit that file or change the default.
Setting `interactive` does not grant NetworkManager privileges or install its
backend. Invalid policy values produce an explicit error.

Interactive mode supports open and WPA-PSK infrastructure networks. Select a
network, enter its password when required, and choose Connect. Enterprise,
hidden and other unsupported security modes remain explicitly unavailable.
WPA personal passwords accept 8–63 printable ASCII characters or a 64-digit
hexadecimal key; the UI and service use the same validator.
Credentials are held only for the request: the field paints bullets, suppresses
copy/cut, and clears its draft on submission, dismissal or owner/AP replacement.
The service creates a temporary connection with autoconnect disabled and secrets
marked not saved. Status snapshots and error messages exclude the password.

A successful method reply means activation was requested. The page remains
pending until the daemon reports the actual active connection. Cancel targets
only the activation created by this service, with its owner, UUID, device and
connection identity rechecked. Timeouts and daemon loss can leave an unknown
outcome; they never imply rollback and never trigger an automatic retry.

## Verification

Run the focused source checks from the repository, after installing workspace
dependencies and `dbus-daemon`:

```sh
bash scripts/test-network-controls.sh
```

The command uses real private D-Bus daemons with fixture NetworkManager objects,
the production management-service/client wire path, measured UI scenes and
synthetic input through the actual shell controller. It includes existing
Quick Settings and panel regressions. It does not call a live system-network
mutation API. The same new gates are registered in the full app suite.

These checks establish source behavior, not native Wi-Fi hardware, a real
NetworkManager activation, physical keyboard behavior or tearing acceptance.
The [C45 verification directory](../vm/verification/2026-10-04-c45-network-manager/)
records the exact receipts and remaining limitations. Existing bootable images
and persistent-home data are preserved.
