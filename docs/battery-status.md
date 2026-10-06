# Battery status

C46 adds read-only battery and UPS observations to Quick Settings. When an
existing UPower service reports a present display battery, the main page shows
charge percentage and charging state. Select Battery or UPS to see power
source, the relevant time estimate and any reported low-charge warning.
Estimates remain explicitly unknown when the daemon supplies no estimate.

The existing desktop service reads UPower properties and follows changes from
its current unique owner. It uses the aggregate display device rather than
adding percentages from individual batteries. Missing devices are hidden.
Temporary read failures retain the known capability but remove charge and time
values; daemon or desktop-service loss cannot leave an old percentage presented
as current. Unsupported brightness and power controls remain unsupported.

This flow never calls a battery refresh/mutation method, changes charge
thresholds, or offers suspend, restart, shutdown or other power actions. It
does not install or activate UPower, change permissions or edit
`/etc/moire/session.conf`. Existing manual policy settings remain intact.

The C46 NixOS configuration had UPower disabled and declared no UPower
service. Its default battery row therefore remains absent. Physical battery
hardware and native guest presentation have not been accepted for C46.

The later C47 QEMU configuration includes UPower for read-only observations.
This battery-less guest uses `Ignore` for the critical power action; it must
not supply power policy for physical hardware. No present battery means the
row remains hidden. See [the VM guide](nixos-vm.md) for installed acceptance.

## Focused checks

From the repository, after installing workspace dependencies and `dbus-daemon`:

```sh
bash scripts/test-battery-status.sh
```

The command exercises the adapter through real private D-Bus daemons with
fixture UPower objects, the production desktop service/client, and measured
Quick Settings scenes with synthetic input through public Window and the
actual shell controller. Fixtures check that backend calls are property reads
only. They do not represent live hardware or permission acceptance.

The [C46 evidence directory](../vm/verification/2026-10-04-c46-battery-status/)
records the exact source, checks, target-platform evidence and remaining limits.
The [UPower display-device API](https://upower.freedesktop.org/docs/UPower.html)
defines the aggregate observation; its
[device properties](https://upower.freedesktop.org/docs/Device.html) define the
charging, percentage and estimate values.
