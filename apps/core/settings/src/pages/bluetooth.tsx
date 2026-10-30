/**
 * Bluetooth: the power switch, paired devices with Connect and Disconnect, details with Trust
 * and Forget, and nearby devices to pair while the page is open.
 */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Horizontal,
  TextBlock,
  TextField,
  Toggle,
  getUiScaleFactor,
  usePalette,
  type SettingRowSpec,
} from "@moire/ui";
import {
  bluetoothPairingBlocksConnections,
  parseBluetoothAlias,
  parseBluetoothInput,
  type BluetoothDevice,
  type BluetoothId,
  type BluetoothNearbyDevice,
  type BluetoothPairingState,
} from "@moire/system-management/bluetooth-status";
import { bluetoothSupported } from "@moire/system-management/bluetooth-status";
import { settingEntry } from "#settings/catalog";
import type { PageContext } from "#settings/context";
import type { DesktopStatus } from "#settings/desktop-state";
import type { PageContent, SheetContent } from "#settings/model";
import { infoRow, section } from "#settings-view/rows";
import { SheetBody } from "#settings-view/sheet-body";
import {
  batteryLabel,
  bluetoothSentence,
  bluetoothStatus,
  deviceDetail,
  deviceIcon,
  deviceKindLabel,
  primaryAdapter,
  sortDevices,
} from "./bluetooth-model";

const PAGE = "bluetooth";
type ReadyPairing = Extract<BluetoothPairingState, { kind: "ready" }>;

/**
 * Discover nearby devices while the page is open: take a discovery lease on the adapter when
 * the page shows, and give it back when the page goes or Settings closes.
 */
export function useBluetoothDiscovery(desktop: DesktopStatus, active: boolean) {
  const lease = useRef<{ owner: string; leaseId: BluetoothId } | null>(null);
  const latest = useRef(desktop);
  latest.current = desktop;
  const snapshot = desktop.snapshot;
  const pairing = snapshot?.bluetooth.pairing;
  const adapter = snapshot ? primaryAdapter(snapshot.bluetooth) : null;
  const ready = pairing?.kind === "ready" ? pairing : null;
  // Remember the lease this page started, so it only stops its own.
  if (ready?.lease && desktop.owner && !lease.current && ready.discovery !== "stopped")
    lease.current = { owner: desktop.owner, leaseId: ready.lease.id };
  const canStart = active && !!ready && !ready.lease && !!adapter?.powered && !!desktop.owner;
  useEffect(() => {
    if (!canStart || !adapter || !snapshot) return;
    void latest.current.run("bt-discover", (client) =>
      client.startBluetoothDiscovery({
        owner: latest.current.owner!,
        revision: snapshot.revision,
        adapterId: adapter.id,
      }),
    );
  }, [canStart]);
  useEffect(() => {
    if (active) return;
    const ours = lease.current;
    lease.current = null;
    const current = latest.current.snapshot;
    if (!ours || !current || current.bluetooth.pairing?.kind !== "ready") return;
    if (current.bluetooth.pairing.lease?.id !== ours.leaseId) return;
    void latest.current.run("bt-discover-stop", (client) =>
      client.stopBluetoothDiscovery({ ...ours, revision: current.revision }),
    );
  }, [active]);
}

function observed(context: PageContext) {
  const owner = context.desktop.owner;
  const revision = context.desktop.snapshot?.revision;
  if (!owner || revision == null) return null;
  return { owner, revision };
}

function setConnected(context: PageContext, device: BluetoothDevice, connected: boolean) {
  const request = observed(context);
  if (!request) return;
  context.attempt(PAGE, async () => {
    const failure = await context.desktop.run(`bt:${device.id}`, (client) =>
      client.setBluetoothConnected({ ...request, id: device.id, connected }),
    );
    return failure
      ? `Couldn't ${connected ? "connect" : "disconnect"} ${device.name}: ${failure}`
      : null;
  });
}

function deviceRow(
  context: PageContext,
  device: BluetoothDevice,
  interactive: boolean,
): SettingRowSpec {
  const ui = getUiScaleFactor();
  const operation = context.desktop.snapshot?.bluetooth.operation;
  const pending = operation?.kind === "pending" && operation.id === device.id;
  const action = device.connected ? "Disconnect" : "Connect";
  return {
    id: `device:${device.id}`,
    label: device.name,
    description: deviceDetail(device, pending),
    icon: deviceIcon(device),
    tint:
      device.connected && device.battery !== undefined && device.battery <= 15
        ? 0xffe0a03a
        : device.connected
          ? 0xff5aa2f0
          : 0xff8a94a6,
    chevron: true,
    focusId: `bluetooth:${device.id}`,
    onPress: () => context.openSheet(PAGE, `device:${device.id}`),
    control:
      interactive && (device.connected || device.trusted)
        ? {
            kind: "compact",
            width: 100,
            render: () => (
              <Button
                width={100 * ui}
                height={30 * ui}
                label={action}
                variant={device.connected ? "ghost" : "secondary"}
                focusId={`bluetooth:${device.id}:${action.toLowerCase()}`}
                disabled={pending || context.desktop.busy === `bt:${device.id}`}
                onPress={() => setConnected(context, device, !device.connected)}
              />
            ),
          }
        : undefined,
  };
}

function nearbyRow(
  context: PageContext,
  pairing: ReadyPairing,
  device: BluetoothNearbyDevice,
): SettingRowSpec {
  const ui = getUiScaleFactor();
  const busy = pairing.attempt.kind === "pending";
  return {
    id: `nearby:${device.id}`,
    label: device.name || device.address,
    description: device.name ? device.address : "Unnamed device",
    icon: "bluetooth",
    tint: 0xff8a94a6,
    control: {
      kind: "compact",
      width: 76,
      render: () => (
        <Button
          width={76 * ui}
          height={30 * ui}
          label="Pair"
          focusId={`bluetooth:pair:${device.id}`}
          disabled={busy || !pairing.lease}
          onPress={() => {
            const request = observed(context);
            if (!request || !pairing.lease) return;
            context.openSheet(PAGE, `pair:${device.id}`);
            context.attempt(PAGE, () =>
              context.desktop.run("bt-pair", (client) =>
                client.beginBluetoothPair({
                  ...request,
                  leaseId: pairing.lease!.id,
                  deviceId: device.id,
                }),
              ),
            );
          }}
        />
      ),
    },
  };
}

/** The steps of pairing: waiting, a code to compare or type, a PIN to enter, the outcome. */
function PairingSheet(props: {
  context: PageContext;
  pairing: ReadyPairing;
  deviceId: string;
  width: number;
  height: number;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const { context, pairing } = props;
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const attempt = pairing.attempt;
  const prompt = pairing.prompt;
  const lease = pairing.lease;
  const request = observed(context);
  const inner = props.width - 32 * ui;
  const respond = (accepted: boolean) => {
    if (!request || !lease || !prompt || attempt.kind !== "pending") return;
    context.attempt(PAGE, () =>
      context.desktop.run("bt-pair", (client) =>
        client.respondBluetoothPrompt({
          ...request,
          leaseId: lease.id,
          attemptId: attempt.id,
          promptId: prompt.id,
          accepted,
        }),
      ),
    );
  };
  const cancel = () => {
    if (request && lease && attempt.kind === "pending")
      context.attempt(PAGE, () =>
        context.desktop.run("bt-pair-cancel", (client) =>
          client.cancelBluetoothPair({ ...request, leaseId: lease.id, attemptId: attempt.id }),
        ),
      );
    context.closeSheet();
  };
  const submit = () => {
    if (!request || !lease || !prompt || attempt.kind !== "pending") return;
    if (prompt.kind !== "pin-entry" && prompt.kind !== "passkey-entry") return;
    try {
      parseBluetoothInput(prompt.kind, value);
    } catch (error) {
      setInvalid(error instanceof Error ? error.message : String(error));
      return;
    }
    setInvalid(null);
    context.attempt(PAGE, () =>
      context.desktop.run("bt-pair", (client) =>
        client.respondBluetoothInput({
          ...request,
          leaseId: lease.id,
          attemptId: attempt.id,
          promptId: prompt.id,
          value,
        }),
      ),
    );
  };
  let message: string;
  let code: string | null = null;
  let buttons: ReactNode;
  const button = (label: string, onPress: () => void, primary = false, focusId?: string) => (
    <Button
      key={label}
      width={100 * ui}
      height={30 * ui}
      label={label}
      variant={primary ? "primary" : "secondary"}
      focusId={focusId}
      onPress={onPress}
    />
  );
  if (attempt.kind === "complete") {
    message = attempt.message || "Paired. The device is in My devices.";
    buttons = button("Done", context.closeSheet, true, "bluetooth:pair:done");
  } else if (
    attempt.kind === "error" ||
    attempt.kind === "canceled" ||
    attempt.kind === "unknown"
  ) {
    message = attempt.message || "Pairing didn't finish.";
    buttons = button("Close", context.closeSheet, true, "bluetooth:pair:close");
  } else if (prompt?.kind === "confirmation") {
    message = "Check that the device shows this code, then confirm.";
    code = prompt.code;
    buttons = [
      button("Cancel", () => respond(false)),
      button("Confirm", () => respond(true), true, "bluetooth:pair:confirm"),
    ];
  } else if (prompt?.kind === "authorization") {
    message = "The device asks to pair with this computer.";
    buttons = [
      button("Deny", () => respond(false)),
      button("Allow", () => respond(true), true, "bluetooth:pair:allow"),
    ];
  } else if (prompt?.kind === "display-code") {
    message = "Type this code on the device, then press Enter on it.";
    code = prompt.code;
    buttons = button("Cancel", cancel);
  } else if (prompt?.kind === "pin-entry" || prompt?.kind === "passkey-entry") {
    message =
      prompt.kind === "pin-entry"
        ? "Enter the device's PIN."
        : "Enter the passkey the device shows.";
    buttons = [button("Cancel", cancel), button("Pair", submit, true, "bluetooth:pair:submit")];
  } else {
    message = "Pairing… Follow any instructions on the device.";
    buttons = button("Cancel", cancel);
  }
  const entry = prompt?.kind === "pin-entry" || prompt?.kind === "passkey-entry";
  return (
    <Box width={props.width} height={props.height}>
      <TextBlock
        x={16 * ui}
        width={inner}
        height={36 * ui}
        text={message}
        fontSize={12}
        color={pal.muted}
        wrap
        maxLines={2}
      />
      {code ? (
        <TextBlock
          x={16 * ui}
          y={44 * ui}
          width={inner}
          height={40 * ui}
          text={code}
          fontSize={26}
          fontWeight="medium"
          horizontalAlign="center"
          verticalAlign="center"
        />
      ) : null}
      {entry ? (
        <>
          <TextField
            x={16 * ui}
            y={44 * ui}
            width={inner}
            height={34 * ui}
            autoFocus
            value={value}
            placeholder={prompt?.kind === "pin-entry" ? "PIN" : "Passkey"}
            invalid={!!invalid}
            focusId="bluetooth:pair:input"
            onChange={setValue}
            onSubmit={submit}
          />
          <TextBlock
            x={16 * ui}
            y={82 * ui}
            width={inner}
            height={18 * ui}
            text={invalid ?? ""}
            fontSize={11}
            color={pal.danger}
          />
        </>
      ) : null}
      <Horizontal
        x={16 * ui}
        y={104 * ui}
        width={inner}
        height={32 * ui}
        gap={8 * ui}
        justify="end"
      >
        {buttons}
      </Horizontal>
    </Box>
  );
}

/** The name this computer shows for a paired device (BlueZ's alias); the device keeps its own. */
function RenameSheet(props: {
  context: PageContext;
  device: BluetoothDevice;
  width: number;
  height: number;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const { context, device } = props;
  const [name, setName] = useState(device.name);
  const [invalid, setInvalid] = useState<string | null>(null);
  const inner = props.width - 32 * ui;
  const submit = () => {
    let alias: string;
    try {
      alias = parseBluetoothAlias(name);
    } catch (error) {
      setInvalid(error instanceof Error ? error.message : String(error));
      return;
    }
    const request = observed(context);
    if (!request) return;
    context.openSheet(PAGE, `device:${device.id}`);
    if (alias === device.name) return;
    context.attempt(PAGE, async () => {
      const failure = await context.desktop.run(`bt:${device.id}`, (client) =>
        client.renameBluetoothDevice({ ...request, id: device.id, name: alias }),
      );
      return failure ? `Couldn't rename ${device.name}: ${failure}` : null;
    });
  };
  return (
    <Box width={props.width} height={props.height}>
      <TextBlock
        x={16 * ui}
        width={inner}
        height={36 * ui}
        text="The name this computer shows for it. The device keeps its own name."
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
        autoFocus
        value={name}
        invalid={!!invalid}
        focusId="bluetooth:rename:name"
        onChange={(value) => {
          setInvalid(null);
          setName(value);
        }}
        onSubmit={submit}
      />
      <TextBlock
        x={16 * ui}
        y={84 * ui}
        width={inner}
        height={18 * ui}
        text={invalid ?? ""}
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
          onPress={() => context.openSheet(PAGE, `device:${device.id}`)}
        />
        <Button
          width={100 * ui}
          height={30 * ui}
          label="Rename"
          variant="primary"
          focusId="bluetooth:rename:save"
          disabled={!name.trim()}
          onPress={submit}
        />
      </Horizontal>
    </Box>
  );
}

function deviceSheet(
  context: PageContext,
  device: BluetoothDevice,
  interactive: boolean,
): SheetContent {
  const ui = getUiScaleFactor();
  const request = observed(context);
  const trust = context.desktop.snapshot?.bluetooth.trust;
  const trustReady = trust?.kind === "ready";
  const confirmation =
    trustReady && trust.operation.kind === "confirmation" && trust.operation.id === device.id
      ? trust.operation
      : null;
  const button = (
    id: string,
    label: string,
    description: string | undefined,
    action: string,
    onPress: () => void,
    variant: "secondary" | "danger" | "primary" = "secondary",
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
          label={action}
          variant={variant}
          focusId={`bluetooth:${id}`}
          onPress={onPress}
        />
      ),
    },
  });
  const forget = () => {
    if (!request) return;
    context.closeSheet();
    context.attempt(PAGE, async () => {
      const failure = await context.desktop.run(`bt:${device.id}`, (client) =>
        client.forgetBluetoothDevice({ ...request, id: device.id }),
      );
      return failure ? `Couldn't forget ${device.name}: ${failure}` : null;
    });
  };
  const requestTrust = (trusted: boolean) => {
    if (!request) return;
    context.attempt(PAGE, () =>
      context.desktop.run("bt-trust", (client) =>
        client.requestBluetoothTrust({ ...request, id: device.id, trusted }),
      ),
    );
  };
  const consent = (confirm: boolean) => {
    if (!request || !confirmation) return;
    context.attempt(PAGE, () =>
      context.desktop.run("bt-trust", (client) =>
        (confirm ? client.confirmBluetoothTrust : client.cancelBluetoothTrust)({
          ...request,
          challengeId: confirmation.challengeId,
        }),
      ),
    );
  };
  return {
    title: device.name,
    subtitle: device.connected ? "Connected" : "Not connected",
    body: (size) => (
      <SheetBody
        {...size}
        sections={[
          section("details", undefined, [
            infoRow("kind", "Type", deviceKindLabel(device)),
            device.battery !== undefined
              ? infoRow("battery", "Battery", batteryLabel(device.battery))
              : null,
            infoRow("address", "Address", device.address),
            infoRow("status", "Status", device.connected ? "Connected" : "Not connected"),
            interactive && trustReady
              ? {
                  id: "trusted",
                  label: "Trusted",
                  description: "Lets the device connect without asking",
                  control: {
                    kind: "compact",
                    width: 52,
                    render: () => (
                      <Toggle
                        on={confirmation ? confirmation.trusted : device.trusted}
                        focusId="bluetooth:trusted"
                        disabled={!!confirmation || context.desktop.busy === "bt-trust"}
                        onChange={requestTrust}
                      />
                    ),
                  },
                }
              : infoRow("trusted", "Trusted", device.trusted ? "Yes" : "No"),
          ]),
          confirmation
            ? section(
                "trust",
                confirmation.trusted ? "Trust this device?" : "Stop trusting this device?",
                [
                  button("trust-cancel", "Keep it as it is", undefined, "Cancel", () =>
                    consent(false),
                  ),
                  button(
                    "trust-confirm",
                    confirmation.trusted ? "Trust this device" : "Stop trusting",
                    confirmation.trusted
                      ? "It can connect without asking"
                      : "It will ask before connecting",
                    confirmation.trusted ? "Trust" : "Stop trusting",
                    () => consent(true),
                    "primary",
                  ),
                ],
              )
            : section("trust", undefined, []),
          section("actions", undefined, [
            interactive
              ? button("rename", "Name", device.name, "Rename", () =>
                  context.openSheet(PAGE, `rename:${device.id}`),
                )
              : null,
            interactive && (device.connected || device.trusted)
              ? button(
                  device.connected ? "disconnect" : "connect",
                  device.connected ? "Disconnect" : "Connect",
                  device.connected ? "Stays paired; connect again any time" : "Use it now",
                  device.connected ? "Disconnect" : "Connect",
                  () => setConnected(context, device, !device.connected),
                )
              : null,
            interactive
              ? button(
                  "forget",
                  "Forget this device",
                  "Pair it again to use it",
                  "Forget",
                  forget,
                  "danger",
                )
              : null,
          ]),
        ]}
      />
    ),
  };
}

export function bluetoothPage(context: PageContext): PageContent {
  const ui = getUiScaleFactor();
  const snapshot = context.desktop.snapshot;
  if (!snapshot || !bluetoothSupported(snapshot.bluetooth))
    return {
      summary: "Keyboards, mice, headphones and more",
      sections: [],
      empty: {
        icon: "bluetooth",
        title: "Bluetooth isn't available",
        message:
          snapshot?.bluetooth.status.kind === "unavailable"
            ? snapshot.bluetooth.status.message
            : "Settings reaches Bluetooth through the desktop controls service, which isn't running.",
      },
    };
  const bluetooth = snapshot.bluetooth;
  const status = bluetoothStatus(bluetooth);
  const adapter = primaryAdapter(bluetooth);
  const interactive = status?.policy === "interactive";
  const pairing = bluetooth.pairing?.kind === "ready" ? bluetooth.pairing : null;
  const devices = sortDevices(status?.devices ?? []);
  const connected = devices.filter((device) => device.connected).length;
  const powerToggle = (focusId: string) =>
    interactive && adapter && observed(context) ? (
      <Toggle
        on={adapter.powered}
        focusId={focusId}
        disabled={
          context.desktop.busy === "bt-power" ||
          bluetoothPairingBlocksConnections(bluetooth.pairing)
        }
        onChange={(powered) =>
          context.attempt(PAGE, () =>
            context.desktop.run("bt-power", (client) =>
              client.setBluetoothPowered({ ...observed(context)!, adapterId: adapter.id, powered }),
            ),
          )
        }
      />
    ) : undefined;
  const searching = pairing?.discovery === "starting" || pairing?.discovery === "scanning";
  const nearby = pairing && adapter?.powered ? pairing.devices : [];
  return {
    summary: !adapter
      ? "No Bluetooth adapter"
      : connected
        ? `${connected} ${connected === 1 ? "device" : "devices"} connected`
        : adapter.powered
          ? "On"
          : "Off",
    hero: {
      kind: "status",
      icon: "bluetooth",
      title: "Bluetooth",
      detail: bluetoothSentence(bluetooth),
      control: powerToggle("setting:bluetooth.power"),
    },
    searchRows: powerToggle("search:bluetooth.power")
      ? [
          {
            id: "bluetooth.power",
            label: settingEntry("bluetooth.power").label,
            description: bluetoothSentence(bluetooth),
            control: {
              kind: "compact",
              width: 52,
              render: () => powerToggle("search:bluetooth.power")!,
            },
          },
        ]
      : undefined,
    banners:
      status?.policy === "readonly"
        ? [
            {
              id: "readonly",
              title: "Bluetooth changes are managed by the system",
              message:
                "You can see devices here, but connecting them is turned off on this computer.",
              tone: "neutral",
              icon: "lock",
            },
          ]
        : undefined,
    sections: [
      section(
        "bluetooth.devices",
        "My devices",
        adapter?.powered || devices.length
          ? devices.length
            ? devices.map((device) => deviceRow(context, device, interactive && !!adapter?.powered))
            : [
                {
                  id: "device:none",
                  label: "No devices paired yet",
                  description: "Pair one from Nearby devices below",
                },
              ]
          : [],
      ),
      section(
        "bluetooth.nearby",
        "Nearby devices",
        pairing && adapter?.powered
          ? nearby.length
            ? nearby.map((device) => nearbyRow(context, pairing, device))
            : [
                {
                  id: "nearby:none",
                  label: searching ? "Looking for devices…" : "No devices found",
                  description: "Put the device in pairing mode",
                },
              ]
          : [],
        {
          trailingWidth: 120,
          trailing: searching ? (
            <Badge text="Searching…" tone="accent" height={20 * ui} />
          ) : undefined,
        },
      ),
    ],
    sheet: (id) => {
      const [kind, ...rest] = id.split(":");
      const target = rest.join(":");
      if (kind === "pair" && pairing) {
        const device = pairing.devices.find((candidate) => candidate.id === target);
        const attemptDevice = pairing.attempt.kind === "idle" ? null : pairing.attempt.device;
        return {
          title: `Pair ${device?.name || attemptDevice?.name || "device"}`,
          body: (size) => (
            <PairingSheet context={context} pairing={pairing} deviceId={target} {...size} />
          ),
        };
      }
      const device = devices.find((candidate) => candidate.id === target);
      if (device && kind === "rename" && interactive)
        return {
          title: `Rename ${device.name}`,
          body: (size) => <RenameSheet context={context} device={device} {...size} />,
        };
      return device ? deviceSheet(context, device, interactive && !!adapter?.powered) : null;
    },
  };
}
