import type { DesktopNetwork } from "@moire/system-management/desktop-status";
import type { DesktopWifi, NetworkConnectivity } from "@moire/system-management/network-status";
export type NetworkPresentation = Readonly<{
  transport: "wired" | "wifi" | "other" | "mixed";
  label: string;
  icon: string;
  /** Explicit daemon observation; local addresses never imply Internet access. */
  detail: string;
}>;
export function connectivityLabel(status: NetworkConnectivity): string {
  switch (status) {
    case "full":
      return "Internet connected";
    case "portal":
      return "Sign-in required for Internet access";
    case "limited":
      return "Limited Internet access";
    case "none":
      return "No Internet connection";
    case "unknown":
      return "Internet status unknown";
  }
}
export function networkPresentation(
  network: readonly DesktopNetwork[],
  wifi?: DesktopWifi,
): NetworkPresentation {
  if (wifi?.kind === "ready") {
    const connection = wifi.connection;
    if (connection.kind === "active")
      return {
        transport: connection.transport,
        label:
          connection.transport === "wifi"
            ? connection.name || "Wi-Fi"
            : connection.transport === "wired"
              ? "Wired network"
              : "Network",
        icon:
          connection.transport === "wifi"
            ? "network"
            : connection.transport === "wired"
              ? "ethernet"
              : "network-globe",
        detail: connectivityLabel(wifi.connectivity),
      };
    return {
      transport: "other",
      label: "Network",
      icon: "network-globe",
      detail: connectivityLabel(wifi.connectivity),
    };
  }
  const transports = new Set(network.map((item) => item.transport));
  const transport = transports.size > 1 ? "mixed" : (network[0]?.transport ?? "other");
  const detail = wifi
    ? wifi.kind === "loading"
      ? "Reading network status…"
      : "Network status unavailable"
    : "Internet status unavailable";
  if (transport === "wired") return { transport, label: "Wired network", icon: "ethernet", detail };
  if (transport === "wifi") return { transport, label: "Wi-Fi", icon: "network", detail };
  return { transport, label: "Network", icon: "network-globe", detail };
}

/** Keep only transport during service loss; cached SSID/Internet observations are stale. */
export function unavailableNetworkPresentation(cached?: NetworkPresentation): NetworkPresentation {
  const transport = cached?.transport ?? "other";
  const label =
    transport === "wired" ? "Wired network" : transport === "wifi" ? "Wi-Fi" : "Network";
  return {
    transport,
    label,
    icon: cached?.icon ?? "network-globe",
    detail: "Internet status unavailable",
  };
}
