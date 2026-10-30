/** Observed devices and explicitly owned pairing; connection is not an audio-route claim. */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Column,
  ContentCard,
  FocusScope,
  Horizontal,
  Icon,
  TextBlock,
  TextField,
  getUiScaleFactor,
  getWidgetTheme,
  measureColumnContent,
  registerIntrinsicSize,
  useWidgetTheme,
  type WidgetTheme,
} from "@moire/ui";
import type {
  BluetoothDevice,
  BluetoothId,
  BluetoothNearbyDevice,
  BluetoothPairingPrompt,
  DesktopBluetooth,
} from "@moire/system-management/bluetooth-status";
import {
  BLUETOOTH_KIND_PRESENTATION,
  bluetoothPairingBlocksConnections,
  bluetoothTrustBlocksControls,
  parseBluetoothInput,
} from "@moire/system-management/bluetooth-status";

export type BluetoothDetailsContentProps = {
  width: number;
  bluetooth: DesktopBluetooth;
  busy?: boolean;
  onBluetoothChange?: (device: BluetoothDevice, connected: boolean) => void;
  onBluetoothRefresh?: () => void;
  onBluetoothDiscoveryStart?: (adapterId: BluetoothId) => void;
  onBluetoothDiscoveryStop?: () => void;
  onBluetoothPair?: (device: BluetoothNearbyDevice) => void;
  onBluetoothPairCancel?: () => void;
  onBluetoothPromptResponse?: (promptId: BluetoothId, accepted: boolean) => void;
  onBluetoothInputResponse?: (promptId: BluetoothId, value: string) => void;
  onBluetoothTrustRequest?: (device: BluetoothDevice, trusted: boolean) => void;
  onBluetoothTrustConfirm?: (challengeId: BluetoothId) => void;
  onBluetoothTrustCancel?: (challengeId: BluetoothId) => void;
};

export function activeBluetoothPrompt(bluetooth?: DesktopBluetooth): BluetoothPairingPrompt | null {
  const pairing = bluetooth?.pairing;
  return pairing?.kind === "ready" &&
    pairing.attempt.kind === "pending" &&
    pairing.prompt?.attemptId === pairing.attempt.id &&
    pairing.prompt.deviceId === pairing.attempt.device.id
    ? pairing.prompt
    : null;
}

export function activeBluetoothTrust(bluetooth?: DesktopBluetooth) {
  const trust = bluetooth?.trust;
  const operation = trust?.kind === "ready" ? trust.operation : null;
  return bluetooth?.status.kind === "ready" &&
    !bluetoothPairingBlocksConnections(bluetooth.pairing) &&
    operation?.kind === "confirmation" &&
    bluetooth.status.devices.some((device) => device.id === operation.id)
    ? operation
    : null;
}
export function bluetoothInteractionScope(bluetooth?: DesktopBluetooth): string | null {
  const prompt = activeBluetoothPrompt(bluetooth),
    trust = activeBluetoothTrust(bluetooth);
  return prompt
    ? `quick:bluetooth:prompt:${prompt.id}`
    : trust
      ? `quick:bluetooth:trust:${trust.challengeId}`
      : null;
}

type EntryProps = {
  width: number;
  prompt: BluetoothPairingPrompt & { kind: "pin-entry" | "passkey-entry" };
  enabled: boolean;
  onInput?: (promptId: BluetoothId, value: string) => void;
  onCancel?: () => void;
};
function entryContent(
  props: EntryProps,
  theme: WidgetTheme,
  draft: string,
  submitted: boolean,
  onChange: (value: string) => void,
  onSubmit: () => void,
  onCancel: () => void,
): ReactNode {
  const inner = props.width,
    palette = theme.foundations.palette,
    ui = getUiScaleFactor();
  let valid = false,
    message =
      props.prompt.kind === "pin-entry"
        ? "Enter the PIN provided by the device (1–16 ASCII characters)."
        : "Enter the device passkey (1–6 digits).";
  if (draft) {
    try {
      parseBluetoothInput(props.prompt.kind, draft);
      valid = true;
    } catch (error) {
      message = error instanceof Error ? error.message : "Invalid pairing input";
    }
  }
  return (
    <Column width={inner} gap={8 * ui}>
      <TextBlock
        width={inner}
        text={
          props.enabled ? message : "PIN/passkey input is unavailable under current system policy."
        }
        fontSize={11}
        color={draft && !valid ? palette.danger : palette.muted}
        wrap
      />
      <Button
        label="Cancel pairing"
        focusId={`quick:bluetooth:prompt:reject:${props.prompt.id}`}
        autoFocus
        disabled={!props.onCancel}
        onPress={onCancel}
      />
      <TextField
        width={inner}
        password
        value={draft}
        placeholder={props.prompt.kind === "pin-entry" ? "PIN" : "Passkey"}
        disabled={!props.enabled || submitted || !props.onInput}
        onChange={onChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
      <Button
        label={props.prompt.kind === "pin-entry" ? "Send PIN" : "Send passkey"}
        focusId={`quick:bluetooth:prompt:submit:${props.prompt.id}`}
        disabled={!props.enabled || !valid || submitted || !props.onInput}
        onPress={onSubmit}
      />
    </Column>
  );
}
function BluetoothEntryPrompt(props: EntryProps): ReactNode {
  const theme = useWidgetTheme(),
    [draft, setDraft] = useState("");
  const privateDraft = useRef(""),
    live = useRef(true),
    consumed = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      privateDraft.current = "";
    };
  }, []);
  const cancel = () => {
    if (!live.current) return;
    privateDraft.current = "";
    consumed.current = true;
    setDraft("");
    props.onCancel?.();
  };
  const tree = entryContent(
    props,
    theme,
    draft,
    consumed.current,
    (value) => {
      if (!live.current || consumed.current) return;
      privateDraft.current = value;
      setDraft(value);
    },
    () => {
      if (!live.current || consumed.current || !props.enabled || !props.onInput) return;
      const value = privateDraft.current;
      try {
        parseBluetoothInput(props.prompt.kind, value);
      } catch {
        return;
      }
      consumed.current = true;
      privateDraft.current = "";
      setDraft("");
      props.onInput(props.prompt.id, value);
    },
    cancel,
  );
  const height = measureColumnContent(
    {
      width: props.width,
      children: entryContent(
        props,
        theme,
        "",
        false,
        () => {},
        () => {},
        () => {},
      ),
    },
    theme,
  ).height;
  return (
    <FocusScope
      id={`quick:bluetooth:prompt:${props.prompt.id}`}
      width={props.width}
      height={height}
      trap
      onEscape={cancel}
    >
      {tree}
    </FocusScope>
  );
}
registerIntrinsicSize(BluetoothEntryPrompt, (props, theme) =>
  measureColumnContent(
    {
      width: props.width,
      children: entryContent(
        props,
        theme,
        "",
        false,
        () => {},
        () => {},
        () => {},
      ),
    },
    theme,
  ),
);

/** The main disclosure and detail page use the same observed status caption. */
export function bluetoothSummary(bluetooth?: DesktopBluetooth): string {
  const status = bluetooth?.status;
  if (!status || status.kind === "unavailable") return "Bluetooth unavailable";
  if (status.kind !== "ready")
    return status.kind === "loading" ? "Reading device status…" : "Device status unavailable";
  if (!status.adapters.some((adapter) => adapter.powered)) return "Bluetooth is off";
  const connected = status.devices.filter((device) => device.connected).length;
  if (connected) return `${connected} known device${connected === 1 ? "" : "s"} connected`;
  return status.devices.length ? `${status.devices.length} paired devices` : "No paired devices";
}

function content(props: BluetoothDetailsContentProps, theme: WidgetTheme): ReactNode {
  const ui = getUiScaleFactor(),
    palette = theme.foundations.palette;
  const width = props.width,
    gap = 10 * ui;
  const { status, operation } = props.bluetooth;
  const waiting = operation.kind === "pending";
  const uncertain = operation.kind === "unknown";
  const label = (text: string, color = palette.muted, fontSize = 11) => (
    <TextBlock width={width} text={text} fontSize={fontSize} color={color} wrap />
  );
  const refresh = props.onBluetoothRefresh ? (
    <Button
      label="Refresh device status"
      focusId="quick:bluetooth:refresh"
      disabled={props.busy || waiting}
      onPress={props.onBluetoothRefresh}
    />
  ) : null;
  if (status.kind !== "ready")
    return (
      <Column width={width} gap={gap}>
        {label(bluetoothSummary(props.bluetooth), palette.text, 14)}
        {label(status.message)}
        {operation.kind === "unknown" || operation.kind === "error"
          ? label(operation.message, palette.danger)
          : null}
        {refresh}
      </Column>
    );
  const interactive = status.policy === "interactive";
  const pairing = props.bluetooth.pairing?.kind === "ready" ? props.bluetooth.pairing : null;
  const attempt = pairing?.attempt;
  const pendingPair = attempt?.kind === "pending";
  const uncertainPair = attempt?.kind === "unknown" || pairing?.discovery === "unknown";
  const searching = pairing?.discovery === "starting" || pairing?.discovery === "scanning";
  const prompt = activeBluetoothPrompt(props.bluetooth);
  const trust = props.bluetooth.trust?.kind === "ready" ? props.bluetooth.trust : null;
  const trustBlocked = bluetoothTrustBlocksControls(props.bluetooth.trust);
  const trustConfirmation = activeBluetoothTrust(props.bluetooth);
  const pairingActions =
    !props.busy && !waiting && !uncertain && !pendingPair && !uncertainPair && !trustBlocked;
  const inner = Math.max(0, width - 20 * ui);
  const cancel = () => props.onBluetoothPairCancel?.();
  const trustDevice = trustConfirmation
    ? status.devices.find((candidate) => candidate.id === trustConfirmation.id)
    : null;
  if (trustConfirmation && trustDevice) {
    const device = trustDevice;
    const cancelTrust = () => props.onBluetoothTrustCancel?.(trustConfirmation.challengeId);
    const card = (
      <ContentCard width={width} padding={10 * ui} gap={8 * ui}>
        <TextBlock
          width={inner}
          text={`${trustConfirmation.trusted ? "Trust" : "Remove trust from"} ${device.name || "this device"}?`}
          fontSize={15}
          wrap
        />
        <TextBlock width={inner} text={device.address} fontSize={11} color={palette.muted} wrap />
        <TextBlock
          width={inner}
          text={
            trustConfirmation.trusted
              ? "Trusted devices may connect automatically and use Bluetooth services without asking again. Continue only for a device you recognize."
              : "Remove automatic trust from this device. Removing trust alone does not disconnect an existing connection."
          }
          fontSize={12}
          wrap
        />
        <Button
          label="Cancel"
          focusId={`quick:bluetooth:trust:cancel:${trustConfirmation.challengeId}`}
          autoFocus
          disabled={!props.onBluetoothTrustCancel}
          onPress={cancelTrust}
        />
        <Button
          label={trustConfirmation.trusted ? "Trust device" : "Remove trust"}
          focusId={`quick:bluetooth:trust:confirm:${trustConfirmation.challengeId}`}
          disabled={!props.onBluetoothTrustConfirm}
          onPress={() => props.onBluetoothTrustConfirm?.(trustConfirmation.challengeId)}
        />
      </ContentCard>
    );
    const height = measureColumnContent({ width, children: card }, theme).height;
    return (
      <Column width={width}>
        <FocusScope
          id={`quick:bluetooth:trust:${trustConfirmation.challengeId}`}
          width={width}
          height={height}
          trap
          onEscape={cancelTrust}
        >
          {card}
        </FocusScope>
      </Column>
    );
  }
  let pairingPrompt: ReactNode = null;
  if (prompt && attempt?.kind === "pending") {
    const consent = prompt.kind === "confirmation" || prompt.kind === "authorization";
    const card = (
      <ContentCard width={width} padding={10 * ui} gap={8 * ui}>
        <TextBlock
          width={inner}
          text={`Pair with ${attempt.device.name || "this device"}?`}
          fontSize={15}
          wrap
        />
        <TextBlock
          width={inner}
          text={attempt.device.address}
          fontSize={11}
          color={palette.muted}
          wrap
        />
        {prompt.kind === "confirmation" ? (
          <>
            <TextBlock
              width={inner}
              text="Confirm only if both devices show this code."
              fontSize={12}
              wrap
            />
            <TextBlock
              width={inner}
              text={prompt.code}
              fontSize={26}
              fontWeight="medium"
              color={palette.accentLine}
              wrap
            />
          </>
        ) : prompt.kind === "authorization" ? (
          <TextBlock
            width={inner}
            text="Allow this device to pair? This does not grant trust or authorize services."
            fontSize={12}
            wrap
          />
        ) : prompt.kind === "display-code" ? (
          <>
            <TextBlock
              width={inner}
              text="Enter this code on the other device."
              fontSize={12}
              wrap
            />
            <TextBlock
              width={inner}
              text={prompt.code}
              fontSize={26}
              fontWeight="medium"
              color={palette.accentLine}
              wrap
            />
            <TextBlock
              width={inner}
              text={`${prompt.entered} of ${prompt.code.length} digits entered`}
              fontSize={11}
              color={palette.muted}
              wrap
            />
          </>
        ) : (
          <BluetoothEntryPrompt
            key={`${prompt.id}:${prompt.kind}:${pairing?.inputEnabled === true}`}
            width={inner}
            prompt={prompt}
            enabled={pairing?.inputEnabled === true}
            onInput={props.onBluetoothInputResponse}
            onCancel={props.onBluetoothPairCancel}
          />
        )}
        {prompt.kind !== "pin-entry" && prompt.kind !== "passkey-entry" ? (
          <Button
            label={consent ? "Reject pairing" : "Cancel pairing"}
            focusId={`quick:bluetooth:prompt:reject:${prompt.id}`}
            autoFocus
            disabled={consent ? !props.onBluetoothPromptResponse : !props.onBluetoothPairCancel}
            onPress={() =>
              consent ? props.onBluetoothPromptResponse?.(prompt.id, false) : cancel()
            }
          />
        ) : null}
        {consent ? (
          <Button
            label={prompt.kind === "confirmation" ? "Confirm matching code" : "Allow pairing"}
            focusId={`quick:bluetooth:prompt:accept:${prompt.id}`}
            disabled={!props.onBluetoothPromptResponse}
            onPress={() => props.onBluetoothPromptResponse?.(prompt.id, true)}
          />
        ) : null}
      </ContentCard>
    );
    const height = measureColumnContent({ width, children: card }, theme).height;
    pairingPrompt = (
      <FocusScope
        id={`quick:bluetooth:prompt:${prompt.id}`}
        width={width}
        height={height}
        trap
        onEscape={cancel}
      >
        {card}
      </FocusScope>
    );
  }
  // A consent prompt is the whole disclosure body. Later controls annotated
  // with the enclosing scope would otherwise outrank this modal in Window.
  if (pairingPrompt) return <Column width={width}>{pairingPrompt}</Column>;
  return (
    <Column width={width} gap={gap}>
      {trust?.operation.kind === "pending"
        ? label(
            trust.operation.trusted
              ? "Setting trust; waiting for observed device status…"
              : "Removing trust; waiting for observed device status…",
            palette.accentLine,
          )
        : null}
      {trust?.operation.kind === "unknown" || trust?.operation.kind === "error"
        ? label(
            `${trust.operation.kind === "unknown" ? "Trust outcome unknown. " : ""}${trust.operation.message}`,
            palette.danger,
          )
        : null}
      {pendingPair && !prompt ? (
        <ContentCard width={width} padding={10 * ui} gap={8 * ui}>
          <TextBlock
            width={inner}
            text={`Pairing with ${attempt.device.name || "device"}…`}
            fontSize={14}
            wrap
          />
          <TextBlock
            width={inner}
            text={`${attempt.device.address} · Waiting for observed paired status`}
            fontSize={11}
            color={palette.muted}
            wrap
          />
          <Button
            label="Cancel pairing"
            focusId="quick:bluetooth:pair:cancel"
            disabled={!props.onBluetoothPairCancel}
            onPress={cancel}
          />
        </ContentCard>
      ) : null}
      {attempt && attempt.kind !== "idle" && attempt.kind !== "pending"
        ? label(
            `${attempt.kind === "unknown" ? "Pairing outcome unknown. " : ""}${attempt.message}`,
            attempt.kind === "unknown" || attempt.kind === "error" ? palette.danger : palette.muted,
          )
        : null}
      {pairing?.message
        ? label(
            pairing.message,
            pairing.discovery === "unknown" || pairing.discovery === "error"
              ? palette.danger
              : palette.muted,
          )
        : null}
      {(pairing?.adapters ?? status.adapters).map((adapter) => (
        <ContentCard key={adapter.id} width={width} padding={10 * ui} gap={4 * ui}>
          <TextBlock
            width={Math.max(0, width - 20 * ui)}
            text={adapter.name || "Bluetooth adapter"}
            fontSize={14}
            wrap
          />
          <TextBlock
            width={Math.max(0, width - 20 * ui)}
            text={adapter.powered ? "Radio on" : "Radio off"}
            fontSize={11}
            color={palette.muted}
            wrap
          />
          {pairing ? (
            <Button
              label="Find devices"
              focusId={`quick:bluetooth:discover:${adapter.id}`}
              disabled={
                !adapter.powered ||
                !!pairing.lease ||
                !pairingActions ||
                !props.onBluetoothDiscoveryStart
              }
              onPress={() => {
                if (adapter.powered && pairingActions && !pairing.lease)
                  props.onBluetoothDiscoveryStart?.(adapter.id);
              }}
            />
          ) : null}
        </ContentCard>
      ))}
      {pairing ? (
        <Column width={width} gap={gap}>
          {label(
            searching
              ? "Looking for nearby devices · Search stops after 30 seconds"
              : uncertainPair
                ? "Discovery is blocked while the previous outcome is unknown"
                : pairing.lease
                  ? "Discovery stopped · Stop discovery to release this search"
                  : "Choose Find devices to start a 30-second search",
          )}
          {pairing.lease ? (
            <Button
              label="Stop discovery"
              focusId="quick:bluetooth:discover:stop"
              disabled={!props.onBluetoothDiscoveryStop}
              onPress={props.onBluetoothDiscoveryStop}
            />
          ) : null}
          {label("Nearby devices", palette.text, 14)}
          {searching && !pairing.devices.length ? label("No nearby devices found yet") : null}
          {pairing.devices.map((device) => {
            const enabled =
              pairingActions &&
              searching &&
              pairing.lease?.adapterId === device.adapterId &&
              !!props.onBluetoothPair;
            return (
              <ContentCard key={device.id} width={width} padding={10 * ui} gap={6 * ui}>
                <TextBlock
                  width={inner}
                  text={device.name || "Unnamed nearby device"}
                  fontSize={14}
                  wrap
                />
                <TextBlock
                  width={inner}
                  text={device.address}
                  fontSize={11}
                  color={palette.muted}
                  wrap
                />
                <Button
                  label="Pair"
                  focusId={`quick:bluetooth:pair:${device.id}`}
                  disabled={!enabled}
                  onPress={() => {
                    if (enabled) props.onBluetoothPair?.(device);
                  }}
                />
              </ContentCard>
            );
          })}
          {label(
            pairing.inputEnabled === true
              ? "Pairing never adds trust automatically. Service authorization is unsupported."
              : "Pairing never adds trust automatically. PIN entry and service authorization are unsupported.",
          )}
        </Column>
      ) : null}
      {!interactive
        ? label(
            pairing
              ? "Connection controls are read-only"
              : "System policy allows Bluetooth status only",
          )
        : null}
      {operation.kind === "pending"
        ? label(
            operation.connected
              ? "Connecting; waiting for device status…"
              : "Disconnecting; waiting for device status…",
            palette.accentLine,
          )
        : null}
      {operation.kind === "error" || operation.kind === "unknown"
        ? label(
            `${operation.kind === "unknown" ? "Connection outcome unknown. " : ""}${operation.message}`,
            palette.danger,
          )
        : null}
      {label(status.devices.length ? "Paired devices" : "No paired devices", palette.text, 14)}
      {status.devices.map((device) => {
        const adapter = status.adapters.find((item) => item.id === device.adapterId);
        const enabled =
          interactive &&
          !!adapter?.powered &&
          (device.connected || device.trusted) &&
          !props.busy &&
          !waiting &&
          !uncertain &&
          !pendingPair &&
          !uncertainPair &&
          !trustBlocked &&
          !!props.onBluetoothChange;
        const kind = BLUETOOTH_KIND_PRESENTATION[device.kind ?? "other"];
        const detail = `${kind.label} · ${device.address} · ${adapter?.name || "Bluetooth adapter"}`;
        const restriction = !adapter?.powered
          ? "Radio off · Connection actions unavailable"
          : !device.trusted
            ? device.connected
              ? "Not trusted · You can disconnect this connection"
              : "Not trusted · Connection actions unavailable"
            : !props.onBluetoothChange && interactive
              ? "Connection actions unavailable"
              : "";
        const inner = Math.max(0, width - 20 * ui);
        return (
          <ContentCard key={device.id} width={width} padding={10 * ui} gap={6 * ui}>
            <Horizontal width={inner} height={20 * ui} gap={8 * ui} align="center">
              <Icon name={kind.icon} size={16 * ui} color={palette.muted} symbolic />
              <TextBlock
                width={Math.max(0, inner - 24 * ui)}
                text={device.name || "Unnamed paired device"}
                fontSize={14}
                maxLines={1}
              />
            </Horizontal>
            <TextBlock width={inner} text={detail} fontSize={11} color={palette.muted} wrap />
            <TextBlock
              width={inner}
              text={
                device.connected
                  ? device.battery !== undefined
                    ? `Connected · ${device.battery}% battery`
                    : "Connected"
                  : "Disconnected"
              }
              fontSize={12}
              color={device.connected ? palette.accentLine : palette.muted}
              wrap
            />
            {restriction ? (
              <TextBlock
                width={inner}
                text={restriction}
                fontSize={11}
                color={palette.muted}
                wrap
              />
            ) : null}
            <Button
              label={device.connected ? "Disconnect" : "Connect"}
              focusId={`quick:bluetooth:device:${device.id}`}
              disabled={!enabled}
              onPress={() => {
                if (enabled) props.onBluetoothChange?.(device, !device.connected);
              }}
            />
            {trust ? (
              <Button
                label={device.trusted ? "Remove trust" : "Trust device"}
                focusId={`quick:bluetooth:trust:request:${device.id}`}
                disabled={
                  !props.onBluetoothTrustRequest ||
                  !!props.busy ||
                  waiting ||
                  uncertain ||
                  pendingPair ||
                  uncertainPair ||
                  trustBlocked
                }
                onPress={() => {
                  if (
                    !props.busy &&
                    !waiting &&
                    !uncertain &&
                    !pendingPair &&
                    !uncertainPair &&
                    !trustBlocked
                  )
                    props.onBluetoothTrustRequest?.(device, !device.trusted);
                }}
              />
            ) : null}
            {trust && device.trusted ? (
              <TextBlock
                width={inner}
                text="Removing trust alone does not disconnect."
                fontSize={11}
                color={palette.muted}
                wrap
              />
            ) : null}
          </ContentCard>
        );
      })}
      {!pairing ? label("Discovery and pairing are unavailable under current system policy") : null}
      {refresh}
    </Column>
  );
}

export function measureBluetoothDetailsContent(
  props: BluetoothDetailsContentProps,
  theme = getWidgetTheme(),
) {
  return measureColumnContent({ width: props.width, children: content(props, theme) }, theme);
}
export function BluetoothDetailsContent(props: BluetoothDetailsContentProps): ReactNode {
  return content(props, useWidgetTheme());
}
registerIntrinsicSize(BluetoothDetailsContent, (props, theme) =>
  measureBluetoothDetailsContent(props, theme),
);
