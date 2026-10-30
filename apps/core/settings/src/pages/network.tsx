/**
 * Wi‑Fi & Network: airplane mode, the Wi‑Fi switch, networks in range with Connect on hover, a
 * password sheet for secured networks, joining a hidden network, details with Disconnect and
 * Forget, VPN connections with import, the proxy, and wired connections.
 */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Horizontal,
  Icon,
  SignalStrength,
  TextBlock,
  TextField,
  Toggle,
  getUiScaleFactor,
  signalStrengthLabel,
  usePalette,
  type SettingRowSpec,
} from "@moire/ui";
import {
  hasWifiAdapter,
  isValidWpaPsk,
  type DesktopWifi,
  type VpnConnection,
  type WifiAccessPoint,
} from "@moire/system-management/network-status";
import { settingEntry } from "#settings/catalog";
import type { PageContext } from "#settings/context";
import type { DesktopStatus } from "#settings/desktop-state";
import type { PageContent, SheetContent } from "#settings/model";
import { infoRow, section, toggleRow } from "#settings-view/rows";
import { SheetBody } from "#settings-view/sheet-body";
import {
  canJoin,
  connectivityLabel,
  forgetOption,
  proxyScope,
  needsPassword,
  networkSummary,
  pointDetail,
  securityLabel,
  sortAccessPoints,
  wifiAddresses,
  wifiSentence,
  wiredConnections,
  wiredLead,
  wiredSentence,
  importableLabel,
  proxySummary,
  vpnDetail,
  vpnKindLabel,
} from "./network-model";
import { readVpnFile, type VpnFile } from "./network-backend";
import { HiddenNetworkSheet, ProxySheet, VpnImportSheet } from "./network-sheets";

const PAGE = "network";
/** Look for networks this often while the page is open. */
const SCAN_MS = 20_000;
type ReadyWifi = Extract<DesktopWifi, { kind: "ready" }>;

/** Scan when the page opens and every 20 s while it stays open. */
export function useWifiScanning(desktop: DesktopStatus, active: boolean) {
  const canScan = desktop.snapshot?.wifi.kind === "ready" && desktop.snapshot.wifi.canScan;
  const run = useRef(desktop.run);
  run.current = desktop.run;
  useEffect(() => {
    if (!active || !canScan) return;
    const scan = () => void run.current("wifi-scan", (client) => client.refreshWifi());
    scan();
    const timer = setInterval(scan, SCAN_MS);
    return () => clearInterval(timer);
  }, [active, canScan]);
}

/** The file picked for import, waiting for its sheet. */
let pendingImport: Extract<VpnFile, { kind: "wireguard" | "openvpn" }> | null = null;

function chooseVpnFile(context: PageContext, kinds: readonly ("wireguard" | "openvpn")[]) {
  context.openChooser({
    title: `Choose a ${importableLabel(kinds)} configuration`,
    accept: kinds.map((kind) => (kind === "wireguard" ? "conf" : "ovpn")),
    onChoose: (file) => {
      const read = readVpnFile(file);
      if (read.kind === "error") {
        context.report(PAGE, `Couldn't add the VPN: ${read.message}`);
        return;
      }
      if (!kinds.includes(read.kind)) {
        context.report(PAGE, `${vpnKindLabel(read.kind)} isn't installed on this computer`);
        return;
      }
      pendingImport = read;
      context.report(PAGE, null);
      context.openSheet(PAGE, "vpn-import");
    },
  });
}

function setVpn(context: PageContext, vpn: VpnConnection, on: boolean) {
  context.attempt(PAGE, async () => {
    const failure = await context.desktop.run(`vpn:${vpn.id}`, (client) =>
      on ? client.activateVpn(vpn.id) : client.deactivateVpn(vpn.id),
    );
    return failure ? `Couldn't ${on ? "connect" : "disconnect"} ${vpn.name}: ${failure}` : null;
  });
}

function vpnRow(context: PageContext, vpn: VpnConnection, canManage: boolean) {
  const ui = getUiScaleFactor();
  const live = vpn.state === "connected" || vpn.state === "connecting";
  return {
    id: `vpn:${vpn.id}`,
    label: vpn.name,
    description: vpnDetail(vpn),
    icon: "vpn" as const,
    tint: vpn.state === "connected" ? 0xff3ecf8e : 0xff8a94a6,
    focusId: `network:vpn:${vpn.id}`,
    onPress: () => context.openSheet(PAGE, `vpn:${vpn.id}`),
    control: canManage
      ? {
          kind: "compact" as const,
          width: 100,
          render: () => (
            <Button
              width={100 * ui}
              height={30 * ui}
              label={live ? "Disconnect" : "Connect"}
              variant={live ? "ghost" : "secondary"}
              focusId={`network:vpn:${vpn.id}:${live ? "disconnect" : "connect"}`}
              disabled={vpn.state === "disconnecting" || context.desktop.busy === `vpn:${vpn.id}`}
              onPress={() => setVpn(context, vpn, !live)}
            />
          ),
        }
      : undefined,
  };
}

function vpnSheet(context: PageContext, vpn: VpnConnection, canManage: boolean): SheetContent {
  const ui = getUiScaleFactor();
  const remove = () => {
    context.closeSheet();
    context.attempt(PAGE, async () => {
      const failure = await context.desktop.run(`vpn:${vpn.id}`, (client) =>
        client.removeVpn(vpn.id),
      );
      return failure ? `Couldn't remove ${vpn.name}: ${failure}` : null;
    });
  };
  return {
    title: vpn.name,
    subtitle: vpnDetail(vpn),
    body: (size) => (
      <SheetBody
        {...size}
        sections={[
          section("details", undefined, [
            infoRow("type", "Type", vpnKindLabel(vpn.kind)),
            infoRow("status", "Status", vpnDetail(vpn).split(" · ")[1] ?? ""),
          ]),
          section("actions", undefined, [
            canManage && vpn.canRemove === false
              ? {
                  id: "remove-shared",
                  label: "Shared with everyone on this computer",
                  description: "Ask an administrator to remove it",
                }
              : null,
            canManage && vpn.canRemove !== false
              ? {
                  id: "remove",
                  label: "Remove this VPN",
                  description: "Its settings and keys are deleted",
                  control: {
                    kind: "compact",
                    width: 112,
                    render: () => (
                      <Button
                        width={112 * ui}
                        height={30 * ui}
                        label="Remove"
                        variant="danger"
                        focusId="network:vpn:remove"
                        onPress={remove}
                      />
                    ),
                  },
                }
              : null,
          ]),
        ]}
      />
    ),
  };
}

function connect(context: PageContext, point: WifiAccessPoint, password = "") {
  context.closeSheet();
  context.attempt(PAGE, async () => {
    const failure = await context.desktop.run("wifi-connect", (client) =>
      client.connectWifi(point.id, password),
    );
    return failure ? `Couldn't connect to ${point.ssid}: ${failure}` : null;
  });
}

function join(context: PageContext, point: WifiAccessPoint) {
  if (needsPassword(point)) context.openSheet(PAGE, `join:${point.id}`);
  else connect(context, point);
}

function networkRow(context: PageContext, wifi: ReadyWifi, point: WifiAccessPoint): SettingRowSpec {
  const ui = getUiScaleFactor();
  const joinable = canJoin(point, wifi);
  const lock: SettingRowSpec["control"] =
    point.security === "open"
      ? undefined
      : {
          kind: "compact",
          width: 16,
          render: () => (
            <Box width={14 * ui} height={14 * ui}>
              <Icon name="lock" size={14 * ui} color={context.palette.muted} symbolic />
            </Box>
          ),
        };
  return {
    id: `wifi:${point.id}`,
    label: point.ssid || "Hidden network",
    labelTone: point.connected ? "accent" : "default",
    description: pointDetail(point, wifi),
    leading: (
      <Box width={32 * ui} height={32 * ui}>
        <SignalStrength x={7 * ui} y={9 * ui} strength={point.strength} />
      </Box>
    ),
    height: 52,
    focusId: `network:${point.id}`,
    onPress: point.connected
      ? () => context.openSheet(PAGE, `wifi:${point.id}`)
      : joinable
        ? () => join(context, point)
        : undefined,
    control: point.connected
      ? {
          kind: "compact",
          width: 84,
          render: () => (
            <Button
              width={84 * ui}
              height={30 * ui}
              label="Details"
              variant="ghost"
              focusId={`network:${point.id}:details`}
              onPress={() => context.openSheet(PAGE, `wifi:${point.id}`)}
            />
          ),
        }
      : lock,
    revealControl: joinable
      ? {
          kind: "compact",
          width: 84,
          render: (_width, reveal) => (
            <Button
              width={84 * ui}
              height={30 * ui}
              label="Connect"
              focusId={`network:${point.id}:connect`}
              onHoverChange={reveal.onHoverChange}
              onFocusChange={reveal.onFocusChange}
              onPress={() => join(context, point)}
            />
          ),
        }
      : undefined,
  };
}

function PasswordSheet(props: {
  context: PageContext;
  point: WifiAccessPoint;
  width: number;
  height: number;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState(false);
  const valid = isValidWpaPsk(password);
  const submit = () => {
    setTried(true);
    if (valid) connect(props.context, props.point, password);
  };
  const inner = props.width - 32 * ui;
  return (
    <Box width={props.width} height={props.height}>
      <TextBlock
        x={16 * ui}
        width={inner}
        height={36 * ui}
        text={`${props.point.ssid} uses a password (WPA2 Personal).`}
        fontSize={12}
        color={pal.muted}
        wrap
        maxLines={2}
      />
      <TextField
        x={16 * ui}
        y={44 * ui}
        width={inner}
        height={34 * ui}
        password
        autoFocus
        value={password}
        placeholder="Password"
        invalid={tried && !valid}
        focusId="network:password"
        onChange={setPassword}
        onSubmit={submit}
      />
      <TextBlock
        x={16 * ui}
        y={84 * ui}
        width={inner}
        height={18 * ui}
        text={tried && !valid ? "8 to 63 characters, or 64 hexadecimal digits" : ""}
        fontSize={11}
        color={pal.danger}
        maxLines={1}
      />
      <Horizontal
        x={16 * ui}
        y={110 * ui}
        width={inner}
        height={32 * ui}
        gap={8 * ui}
        justify="end"
      >
        <Button
          width={92 * ui}
          height={30 * ui}
          label="Cancel"
          onPress={props.context.closeSheet}
        />
        <Button
          width={100 * ui}
          height={30 * ui}
          label="Connect"
          variant="primary"
          focusId="network:password:connect"
          disabled={!password}
          onPress={submit}
        />
      </Horizontal>
    </Box>
  );
}

function detailsSheet(context: PageContext, wifi: ReadyWifi, point: WifiAccessPoint): SheetContent {
  const ui = getUiScaleFactor();
  const addresses = point.connected ? wifiAddresses(context.desktop.snapshot?.network ?? []) : [];
  const reach = connectivityLabel(wifi.connectivity);
  const action = (
    id: string,
    label: string,
    description: string,
    button: string,
    run: () => void,
    variant: "secondary" | "danger" = "secondary",
  ) => ({
    id,
    label,
    description,
    control: {
      kind: "compact" as const,
      width: 112,
      render: () => (
        <Button
          width={112 * ui}
          height={30 * ui}
          label={button}
          variant={variant}
          focusId={`network:${id}`}
          onPress={run}
        />
      ),
    },
  });
  const disconnect = () => {
    context.closeSheet();
    context.attempt(PAGE, () =>
      context.desktop.run("wifi-disconnect", (client) => client.disconnectWifi()),
    );
  };
  const forgetting = forgetOption(point, wifi);
  const forget = () => {
    context.closeSheet();
    context.attempt(PAGE, async () => {
      const failure = await context.desktop.run("wifi-forget", (client) =>
        client.forgetWifi(point.id),
      );
      return failure ? `Couldn't forget ${point.ssid}: ${failure}` : null;
    });
  };
  return {
    title: point.ssid,
    subtitle: point.connected ? `Connected${reach ? ` · ${reach}` : ""}` : securityLabel(point),
    body: (size) => (
      <SheetBody
        {...size}
        sections={[
          section("details", undefined, [
            infoRow("status", "Status", point.connected ? "Connected" : "In range"),
            infoRow("security", "Security", securityLabel(point)),
            infoRow("signal", "Signal", signalStrengthLabel(point.strength).replace("Signal ", "")),
            ...addresses.map((address, index) =>
              infoRow(
                `address:${index}`,
                address.includes(":") ? "IPv6 address" : "IPv4 address",
                address,
              ),
            ),
          ]),
          section("actions", undefined, [
            point.connected && wifi.canConnect
              ? action(
                  "disconnect",
                  "Disconnect",
                  "Leave this network until you connect again",
                  "Disconnect",
                  disconnect,
                )
              : null,
            forgetting?.kind === "forget"
              ? action(
                  "forget",
                  forgetting.label,
                  forgetting.description,
                  "Forget",
                  forget,
                  "danger",
                )
              : forgetting
                ? {
                    id: "forget-shared",
                    label: forgetting.label,
                    description: forgetting.description,
                  }
                : null,
          ]),
        ]}
      />
    ),
  };
}

export function networkPage(context: PageContext): PageContent {
  const ui = getUiScaleFactor();
  const snapshot = context.desktop.snapshot;
  if (!snapshot)
    return {
      summary: "Wi‑Fi, wired connections and VPN",
      sections: [],
      empty: {
        icon: "network",
        title: "Network controls aren't running",
        message:
          "Settings reaches Wi‑Fi through the desktop controls service, which isn't running.",
      },
    };
  const wifi = snapshot.wifi;
  const wired = wiredConnections(snapshot.network);
  const ready = wifi.kind === "ready" ? wifi : null;
  // A wired-only computer: NetworkManager runs but has no Wi‑Fi device, so the page leads with
  // the cable and offers no Wi‑Fi switch or network list.
  const noWifi = !!ready && !hasWifiAdapter(ready);
  const lead = noWifi ? wiredLead(wifi, snapshot.network) : null;
  const scanning = context.desktop.busy === "wifi-scan";
  const wifiToggle = (focusId: string) =>
    ready?.canToggle && !noWifi ? (
      <Toggle
        on={ready.enabled}
        focusId={focusId}
        disabled={context.desktop.busy === "wifi-power" || !ready.hardwareEnabled}
        onChange={(on) =>
          context.attempt(PAGE, () =>
            context.desktop.run("wifi-power", (client) => client.setWifiEnabled(on)),
          )
        }
      />
    ) : undefined;
  const points = ready && ready.enabled ? sortAccessPoints(ready.accessPoints) : [];
  const airplane = snapshot.airplane;
  const vpn = ready?.vpn;
  const manualProxy = context.prefs.values.proxy;
  const airplaneRow = airplane
    ? toggleRow(
        "network.airplane",
        airplane.active,
        (on) =>
          context.attempt(PAGE, () =>
            context.desktop.run("airplane", (client) => client.setAirplaneMode(on)),
          ),
        {
          disabled: !airplane.canToggle || context.desktop.busy === "airplane",
          description: airplane.active
            ? "On · Wi‑Fi, mobile broadband and Bluetooth are off"
            : "Turns off Wi‑Fi, mobile broadband and Bluetooth",
        },
      )
    : null;
  const wiredSection = section(
    "network.wired",
    "Wired and other connections",
    wired.map((entry) => ({
      id: `wired:${entry.name}`,
      label: entry.transport === "wired" ? "Ethernet" : entry.name,
      description: entry.addresses.length ? `Connected · ${entry.addresses[0]}` : "Connected",
      icon: entry.transport === "wired" ? "ethernet" : "network-globe",
      tint: 0xff3ecf8e,
      value: entry.name,
    })),
  );
  return {
    summary: networkSummary(wifi, snapshot.network),
    hero:
      wifi.kind === "unavailable"
        ? undefined
        : noWifi
          ? {
              kind: "status",
              icon: lead ? "ethernet" : "network-globe",
              title: lead?.name ?? "Not connected",
              detail: lead ? wiredSentence(wifi, lead) : "No Wi‑Fi adapter and no cable plugged in",
            }
          : {
              kind: "status",
              icon: "network",
              title: "Wi‑Fi",
              detail: wifiSentence(wifi),
              control: wifiToggle("setting:network.wifi"),
            },
    searchRows:
      ready?.canToggle && !noWifi
        ? [
            {
              id: "network.wifi",
              label: settingEntry("network.wifi").label,
              description: wifiSentence(wifi),
              control: {
                kind: "compact",
                width: 52,
                render: () => wifiToggle("search:network.wifi")!,
              },
            },
          ]
        : undefined,
    banners:
      ready?.policy === "readonly"
        ? [
            {
              id: "readonly",
              title: "Network changes are managed by the system",
              message:
                "You can see networks here, but joining them is turned off on this computer.",
              tone: "neutral",
              icon: "lock",
            },
          ]
        : undefined,
    sections: [
      section("network.airplane-section", undefined, [airplaneRow]),
      ...(noWifi ? [wiredSection] : []),
      ...(noWifi
        ? []
        : [
            section(
              "network.networks",
              "Networks",
              ready?.enabled
                ? [
                    ...(points.length
                      ? points.map((point) => networkRow(context, ready, point))
                      : [
                          {
                            id: "wifi:none",
                            label: scanning ? "Looking for networks…" : "No networks in range",
                            height: 52,
                          },
                        ]),
                    ready.canConnect
                      ? {
                          id: "network.hidden",
                          label: settingEntry("network.hidden").label,
                          description: settingEntry("network.hidden").description,
                          icon: "plus" as const,
                          tint: 0xff8a94a6,
                          chevron: true,
                          focusId: "setting:network.hidden",
                          onPress: () => context.openSheet(PAGE, "hidden"),
                        }
                      : null,
                  ]
                : [],
              {
                trailingWidth: 120,
                trailing: scanning ? (
                  <Badge text="Scanning…" tone="accent" height={20 * ui} />
                ) : undefined,
              },
            ),
          ]),
      section(
        "network.vpn",
        "VPN",
        vpn
          ? [
              ...vpn.connections.map((item) => vpnRow(context, item, vpn.canManage)),
              vpn.canManage
                ? {
                    id: "vpn:add",
                    label: "Add a VPN…",
                    description: `From a ${importableLabel(vpn.importable)} configuration file`,
                    icon: "plus" as const,
                    tint: 0xff8a94a6,
                    chevron: true,
                    focusId: "network:vpn:add-file",
                    onPress: () => chooseVpnFile(context, vpn.importable),
                  }
                : vpn.connections.length
                  ? null
                  : { id: "vpn:none", label: "No VPN connections" },
            ]
          : ready
            ? [
                {
                  id: "vpn:unavailable",
                  label: "VPN connections are managed by the system",
                  description: "Settings can't read this computer's saved connections",
                },
              ]
            : [],
      ),
      section("network.proxy-section", "Proxy", [
        ready || manualProxy.enabled
          ? {
              id: "network.proxy",
              label: settingEntry("network.proxy").label,
              description: ready?.proxy ? proxyScope(ready.proxy) : "For apps you open from now on",
              value: proxySummary(ready?.proxy, manualProxy),
              chevron: true,
              focusId: "setting:network.proxy",
              onPress: () => context.openSheet(PAGE, "proxy"),
            }
          : null,
      ]),
      ...(noWifi ? [] : [wiredSection]),
      ...(noWifi
        ? [
            section("network.networks", "Wi‑Fi", [
              {
                id: "wifi:no-adapter",
                label: "No Wi‑Fi adapter",
                description: "This computer has no wireless hardware",
              },
            ]),
          ]
        : []),
    ],
    sheet: (id) => {
      if (id === "proxy")
        return {
          title: "Proxy",
          subtitle: proxySummary(ready?.proxy, manualProxy),
          body: (size) => <ProxySheet context={context} proxy={ready?.proxy} {...size} />,
        };
      if (!ready) return null;
      if (id === "hidden")
        return {
          title: "Join another network",
          body: (size) => <HiddenNetworkSheet context={context} {...size} />,
        };
      if (id === "vpn-import") {
        const file = pendingImport;
        return file
          ? {
              title: `Add ${vpnKindLabel(file.kind)} connection`,
              body: (size) => <VpnImportSheet context={context} file={file} {...size} />,
            }
          : null;
      }
      const [kind, ...rest] = id.split(":");
      if (kind === "vpn") {
        const item = vpn?.connections.find((candidate) => candidate.id === rest.join(":"));
        return item && vpn ? vpnSheet(context, item, vpn.canManage) : null;
      }
      const point = ready.accessPoints.find((candidate) => candidate.id === rest.join(":"));
      if (!point) return null;
      if (kind === "join")
        return {
          title: `Join ${point.ssid}`,
          body: (size) => <PasswordSheet context={context} point={point} {...size} />,
        };
      return detailsSheet(context, ready, point);
    },
  };
}
