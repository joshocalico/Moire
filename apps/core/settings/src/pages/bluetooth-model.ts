/** Bluetooth's pure parts: the adapter, devices by state, and the words for them. */
import type { IconName } from "@moire/ui";
import {
  BLUETOOTH_KIND_PRESENTATION,
  type BluetoothDevice,
  type DesktopBluetooth,
} from "@moire/system-management/bluetooth-status";

export function deviceIcon(device: Pick<BluetoothDevice, "kind">): IconName {
  return BLUETOOTH_KIND_PRESENTATION[device.kind ?? "other"].icon as IconName;
}

export function deviceKindLabel(device: Pick<BluetoothDevice, "kind">): string {
  return BLUETOOTH_KIND_PRESENTATION[device.kind ?? "other"].label;
}

/** "64%", or "12% · low" when it needs charging soon. */
export function batteryLabel(battery: number): string {
  return battery <= 15 ? `${battery}% · low` : `${battery}%`;
}

export function bluetoothStatus(bluetooth: DesktopBluetooth) {
  return bluetooth.status.kind === "ready" ? bluetooth.status : null;
}

export function primaryAdapter(bluetooth: DesktopBluetooth) {
  return bluetoothStatus(bluetooth)?.adapters[0] ?? null;
}

/** Connected devices first, then by name. */
export function sortDevices(devices: readonly BluetoothDevice[]): BluetoothDevice[] {
  return [...devices].sort(
    (a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name),
  );
}

export function deviceDetail(device: BluetoothDevice, pending: boolean): string {
  if (pending) return device.connected ? "Disconnecting…" : "Connecting…";
  if (device.connected)
    return device.battery !== undefined
      ? `Connected · battery ${batteryLabel(device.battery)}`
      : "Connected";
  return device.trusted ? "Not connected" : "Not connected · not trusted";
}

/** The hero's sentence and Overview's tile. */
export function bluetoothSentence(bluetooth: DesktopBluetooth): string {
  const status = bluetoothStatus(bluetooth);
  if (!status) return bluetooth.status.kind === "ready" ? "" : bluetooth.status.message;
  const adapter = status.adapters[0];
  if (!adapter) return "No Bluetooth adapter";
  if (!adapter.powered) return "Off";
  const connected = status.devices.filter((device) => device.connected).length;
  return connected
    ? `On · ${connected} ${connected === 1 ? "device" : "devices"} connected`
    : `On · ${adapter.name}`;
}

export function bluetoothTile(bluetooth: DesktopBluetooth): { value: string; detail: string } {
  const status = bluetoothStatus(bluetooth);
  const adapter = status?.adapters[0];
  if (!status || !adapter) return { value: "Unavailable", detail: bluetoothSentence(bluetooth) };
  if (!adapter.powered) return { value: "Off", detail: "Bluetooth is turned off" };
  const connected = status.devices.filter((device) => device.connected);
  if (!connected.length)
    return {
      value: "On",
      detail: status.devices.length
        ? `${status.devices.length} paired, none connected`
        : "No devices paired yet",
    };
  return {
    value: `${connected.length} connected`,
    detail: connected.map((device) => device.name).join(", "),
  };
}
