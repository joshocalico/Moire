/**
 * Airplane mode: Wi‑Fi and mobile broadband off through NetworkManager's radio switches, and
 * every Bluetooth adapter powered off through BlueZ. NetworkManager and BlueZ apply those as
 * rfkill soft blocks themselves, so Moire never writes /dev/rfkill.
 *
 * Turning it off turns Wi‑Fi and mobile broadband on and powers the Bluetooth adapters that were
 * on when it was turned on (all of them if this service didn't see that).
 */
import type { DesktopAirplane } from "@moire/system-management/desktop-status";
import type { DesktopWifi, WifiAdapter } from "@moire/system-management/network-status";
import type {
  BluetoothAdapter,
  BluetoothId,
  DesktopBluetooth,
} from "@moire/system-management/bluetooth-status";

/**
 * Omitted when there is no radio to switch: no Wi‑Fi device, no modem and no Bluetooth adapter
 * (a wired-only computer). Older NetworkManager observations without device counts count as
 * radios present.
 */
export function airplaneState(
  wifi: DesktopWifi,
  bluetooth: DesktopBluetooth,
  canWriteBluetooth: boolean,
): DesktopAirplane | undefined {
  const network = wifi.kind === "ready" ? wifi : null;
  const status = bluetooth.status.kind === "ready" ? bluetooth.status : null;
  const adapters = status?.adapters ?? [];
  const radios =
    !!network && (network.adapters !== 0 || (!!network.wwan && network.wwan.modems !== 0));
  if (!radios && !adapters.length) return undefined;
  const wwanOn = !!network?.wwan?.hardwareEnabled && network.wwan.enabled;
  return {
    active: !network?.enabled && !wwanOn && adapters.every((adapter) => !adapter.powered),
    canToggle:
      (!network || !!network.canToggle) &&
      (!network?.wwan?.hardwareEnabled || network.wwan.canToggle) &&
      (!adapters.length || (status?.policy === "interactive" && canWriteBluetooth)),
  };
}

export type AirplaneMemory = { restore: BluetoothId[] | null };

export async function setAirplaneMode(
  enabled: boolean,
  wifi: WifiAdapter,
  bluetooth: BluetoothAdapter,
  memory: AirplaneMemory,
): Promise<void> {
  const current = airplaneState(wifi.state, bluetooth.state, !!bluetooth.setPowered);
  if (!current?.canToggle) throw new Error("Airplane mode can't be changed on this computer");
  const status = bluetooth.state.status.kind === "ready" ? bluetooth.state.status : null;
  const adapters = status?.adapters ?? [];
  const radios = wifi.state.kind === "ready" ? wifi.setRadios : undefined;
  if (wifi.state.kind === "ready" && !radios) throw new Error("Wi-Fi radio control unavailable");
  if (enabled) {
    const powered = adapters.filter((adapter) => adapter.powered).map((adapter) => adapter.id);
    // Remember before writing, so a partial failure still restores what was on.
    if (!current.active) memory.restore = powered;
    await radios?.call(wifi, { wifi: false, wwan: false });
    for (const id of powered) await bluetooth.setPowered!({ adapterId: id, powered: false });
    return;
  }
  await radios?.call(wifi, { wifi: true, wwan: true });
  const restore = new Set(memory.restore ?? adapters.map((adapter) => adapter.id));
  for (const adapter of adapters)
    if (restore.has(adapter.id) && !adapter.powered)
      await bluetooth.setPowered!({ adapterId: adapter.id, powered: true });
  memory.restore = null;
}
