/** Wi‑Fi & Network's pure parts: the order networks are listed in, and the words for each state. */
import {
  hasWifiAdapter,
  type DesktopWifi,
  type HiddenWifiSecurity,
  type NetworkConnectivity,
  type NetworkProxy,
  type VpnConnection,
  type WifiAccessPoint,
} from "@moire/system-management/network-status";
import type { ManualProxySettings } from "@moire/prefs";
import type { DesktopNetwork } from "@moire/system-management/desktop-status";

type ReadyWifi = Extract<DesktopWifi, { kind: "ready" }>;

/** The connected network first, then strongest first, then by name. */
export function sortAccessPoints(points: readonly WifiAccessPoint[]): WifiAccessPoint[] {
  return [...points].sort(
    (a, b) =>
      Number(b.connected) - Number(a.connected) ||
      b.strength - a.strength ||
      a.ssid.localeCompare(b.ssid),
  );
}

export function securityLabel(point: WifiAccessPoint): string {
  if (point.security === "open") return "Open network";
  if (point.security === "wpa-psk") return "WPA2 Personal";
  return "Security Moire can't join yet";
}

export function connectivityLabel(connectivity: NetworkConnectivity): string {
  switch (connectivity) {
    case "full":
      return "internet access";
    case "limited":
      return "limited connectivity";
    case "portal":
      return "sign-in needed";
    case "none":
      return "no internet";
    case "unknown":
      return "";
  }
}

export function connectedPoint(wifi: DesktopWifi): WifiAccessPoint | null {
  return wifi.kind === "ready"
    ? (wifi.accessPoints.find((point) => point.connected) ?? null)
    : null;
}

/** The hero's sentence: "On · connected to Halcyon with internet access". */
export function wifiSentence(wifi: DesktopWifi): string {
  if (wifi.kind !== "ready") return wifi.message;
  if (!wifi.hardwareEnabled) return "Off · turned off by the computer's wireless switch";
  if (!wifi.enabled) return "Off";
  if (wifi.operation.kind === "connecting") return `On · connecting to ${wifi.operation.ssid}…`;
  const point = connectedPoint(wifi);
  if (!point) return "On · not connected";
  const reach = connectivityLabel(wifi.connectivity);
  return `On · connected to ${point.ssid}${reach ? ` with ${reach}` : ""}`;
}

/** Overview's tile: the network's name, or the state when there isn't one. */
export function wifiTile(wifi: ReadyWifi): { value: string; detail: string } {
  if (!wifi.enabled || !wifi.hardwareEnabled)
    return { value: "Off", detail: "Wi‑Fi is turned off" };
  const point = connectedPoint(wifi);
  if (!point)
    return {
      value: "Not connected",
      detail: `${wifi.accessPoints.length} ${wifi.accessPoints.length === 1 ? "network" : "networks"} in range`,
    };
  const reach = connectivityLabel(wifi.connectivity);
  return { value: point.ssid, detail: reach ? `Connected · ${reach}` : "Connected" };
}

/** A network row's second line. */
export function pointDetail(point: WifiAccessPoint, wifi: ReadyWifi): string {
  if (wifi.operation.kind === "connecting" && wifi.operation.ssid === point.ssid)
    return "Connecting…";
  if (point.connected) {
    const reach = connectivityLabel(wifi.connectivity);
    return reach ? `Connected · ${reach[0]!.toUpperCase()}${reach.slice(1)}` : "Connected";
  }
  return `${securityLabel(point)}${point.saved ? " · Saved" : ""}`;
}

/** Connecting needs a password only for a secured network the computer doesn't know yet. */
export function needsPassword(point: WifiAccessPoint): boolean {
  return point.security === "wpa-psk" && !point.saved;
}

export function canJoin(point: WifiAccessPoint, wifi: ReadyWifi): boolean {
  return wifi.canConnect && wifi.enabled && point.security !== "unsupported" && !point.connected;
}

/** Wired and other non‑Wi‑Fi interfaces with their addresses. */
export function wiredConnections(network: readonly DesktopNetwork[]): DesktopNetwork[] {
  return network.filter((entry) => entry.transport !== "wifi");
}

/** Addresses of the Wi‑Fi interface, for the connected network's details. */
export function wifiAddresses(network: readonly DesktopNetwork[]): string[] {
  return network
    .filter((entry) => entry.transport === "wifi")
    .flatMap((entry) => [...entry.addresses]);
}

/** The wired connection a computer without Wi‑Fi leads with. */
export type WiredLead = Readonly<{
  /** NetworkManager's profile name ("Wired connection 1"), or the interface's. */
  name: string;
  /** The first IPv4 address, else the first address; empty when there is none. */
  address: string;
}>;

/**
 * The first wired connection, named after the primary connection when that is wired. Null when
 * nothing is plugged in.
 */
export function wiredLead(wifi: DesktopWifi, network: readonly DesktopNetwork[]): WiredLead | null {
  const entry = network.find((candidate) => candidate.transport === "wired");
  if (!entry) return null;
  const primary =
    wifi.kind === "ready" &&
    wifi.connection.kind === "active" &&
    wifi.connection.transport === "wired"
      ? wifi.connection.name
      : "";
  const address = entry.addresses.find((item) => !item.includes(":")) ?? entry.addresses[0] ?? "";
  return { name: primary || entry.name, address };
}

/** The hero's line for a wired connection: "Connected · 192.168.64.43 · internet access". */
export function wiredSentence(wifi: DesktopWifi, lead: WiredLead | null): string {
  if (!lead) return "Not connected";
  const reach = wifi.kind === "ready" ? connectivityLabel(wifi.connectivity) : "";
  return ["Connected", lead.address, reach].filter(Boolean).join(" · ");
}

/** Overview's tile on a computer without Wi‑Fi: "Wired connected · 192.168.64.43". */
export function wiredTile(
  wifi: DesktopWifi,
  network: readonly DesktopNetwork[],
): { value: string; detail: string } {
  const lead = wiredLead(wifi, network);
  if (!lead) return { value: "Not connected", detail: "No Wi‑Fi adapter or cable" };
  return { value: "Wired connected", detail: lead.address || lead.name };
}

export function networkSummary(
  wifi: DesktopWifi | null,
  network: readonly DesktopNetwork[],
): string {
  const wired = wiredConnections(network);
  const parts: string[] = [];
  if (wifi && wifi.kind === "ready" && !hasWifiAdapter(wifi)) {
    const lead = wiredLead(wifi, network);
    if (!lead) return "Not connected · no Wi‑Fi adapter";
    return `Wired: ${lead.name}${lead.address ? ` · ${lead.address}` : ""}`;
  }
  if (wifi?.kind === "ready") {
    const point = connectedPoint(wifi);
    parts.push(point ? `Wi‑Fi: ${point.ssid}` : wifi.enabled ? "Wi‑Fi not connected" : "Wi‑Fi off");
  }
  if (wired.length)
    parts.push(
      wired.length === 1 ? `Wired: ${wired[0]!.name}` : `${wired.length} wired connections`,
    );
  return parts.join(" · ") || "Wi‑Fi, wired connections and VPN";
}

export function vpnKindLabel(kind: VpnConnection["kind"]): string {
  return kind === "wireguard" ? "WireGuard" : kind === "openvpn" ? "OpenVPN" : "VPN";
}

/** A VPN row's second line: "WireGuard · Connected". */
export function vpnDetail(vpn: VpnConnection): string {
  const state =
    vpn.state === "connected"
      ? "Connected"
      : vpn.state === "connecting"
        ? "Connecting…"
        : vpn.state === "disconnecting"
          ? "Disconnecting…"
          : "Not connected";
  return `${vpnKindLabel(vpn.kind)} · ${state}`;
}

/** What the VPN section's import offers: "WireGuard or OpenVPN". */
export function importableLabel(kinds: readonly ("wireguard" | "openvpn")[]): string {
  return kinds.map((kind) => vpnKindLabel(kind)).join(" or ");
}

export type ProxyMode = "none" | "auto" | "manual";

/** Moire's manual proxy wins; otherwise the primary connection's NetworkManager proxy. */
export function proxyMode(proxy: NetworkProxy | undefined, manual: ManualProxySettings): ProxyMode {
  if (manual.enabled) return "manual";
  return proxy?.method ?? "none";
}

export function proxySummary(proxy: NetworkProxy | undefined, manual: ManualProxySettings): string {
  const mode = proxyMode(proxy, manual);
  if (mode === "manual") return `Manual · ${manual.http}`;
  if (mode === "auto") return proxy?.pacUrl ? `Automatic · ${proxy.pacUrl}` : "Automatic (WPAD)";
  return "Off";
}

export function hiddenSecurityLabel(security: HiddenWifiSecurity): string {
  return security === "open" ? "None" : security === "wpa-psk" ? "WPA2 Personal" : "WPA3 Personal";
}

/** What Forget offers for a saved network, or why it doesn't. */
export type ForgetOption = Readonly<{
  kind: "forget" | "shared";
  label: string;
  description: string;
}>;

/**
 * Forget removes the user's own profiles. One saved for everyone can't be removed or stopped
 * from connecting per user, so it's explained rather than offered. Older services send no
 * ownership; then any saved network can be forgotten while joining is allowed.
 */
export function forgetOption(point: WifiAccessPoint, wifi: ReadyWifi): ForgetOption | null {
  if (!point.saved) return null;
  const shared = point.ownership === "system";
  if (point.canForget ?? wifi.canConnect)
    return shared
      ? {
          kind: "forget",
          label: "Forget your copy",
          description: "The shared one stays saved",
        }
      : { kind: "forget", label: "Forget this network", description: "Remove its saved password" };
  return shared && wifi.policy === "interactive"
    ? {
        kind: "shared",
        label: "Saved for everyone on this computer",
        description: "Ask an administrator to remove it",
      }
    : null;
}

/** The proxy row's second line: which connection, and whether a change is for this user only. */
export function proxyScope(proxy: NetworkProxy): string {
  return `For ${proxy.connection}${proxy.copy ? " · applies to you only" : ""}`;
}

/** Saving `method` (and `pacUrl`) changes NetworkManager's proxy for the connection. */
export function proxyChanges(
  proxy: NetworkProxy | undefined,
  method: "none" | "auto",
  pacUrl: string,
): boolean {
  return (
    !!proxy?.canChange &&
    (proxy.method !== method || (method === "auto" && proxy.pacUrl !== pacUrl.trim()))
  );
}
