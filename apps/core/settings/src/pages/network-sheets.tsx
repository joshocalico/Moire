/**
 * Wi‑Fi & Network's form sheets: joining a hidden network, importing a VPN, and the proxy.
 * Each validates with the same parsers the management service uses before it sends anything.
 */
import React, { useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Horizontal,
  SegmentedControl,
  TextBlock,
  TextField,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import {
  isValidPacUrl,
  parseHiddenWifiRequest,
  type HiddenWifiSecurity,
  type NetworkProxy,
} from "@moire/system-management/network-status";
import { isProxyAddress, type ManualProxySettings } from "@moire/prefs";
import type { PageContext } from "#settings/context";
import type { VpnFile } from "./network-backend";
import {
  importableLabel,
  proxyChanges,
  proxyMode,
  vpnKindLabel,
  type ProxyMode,
} from "./network-model";

const PAGE = "network";
const FIELD = 34;
const LABEL = 18;
/** A label and its field. */
const ROW = LABEL + FIELD + 10;

/** A sheet's content: labelled fields, then a message line and the buttons. */
function Form(props: {
  width: number;
  height: number;
  intro?: string;
  fields: readonly { label: string; render: (x: number, y: number, width: number) => ReactNode }[];
  message: string;
  error: boolean;
  submitLabel: string;
  submitFocusId: string;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  /** Rows of fixed content (unscaled) drawn above the fields. */
  header?: { height: number; render: (x: number, y: number, width: number) => ReactNode };
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const inner = props.width - 32 * ui;
  let y = 0;
  const parts: ReactNode[] = [];
  if (props.intro) {
    parts.push(
      <TextBlock
        key="intro"
        x={16 * ui}
        y={y}
        width={inner}
        height={36 * ui}
        text={props.intro}
        fontSize={12}
        color={pal.muted}
        wrap
        maxLines={2}
      />,
    );
    y += 40 * ui;
  }
  if (props.header) {
    parts.push(<Box key="header">{props.header.render(16 * ui, y, inner)}</Box>);
    y += (props.header.height + 10) * ui;
  }
  for (const [index, field] of props.fields.entries()) {
    parts.push(
      <TextBlock
        key={`label:${index}`}
        x={16 * ui}
        y={y}
        width={inner}
        height={LABEL * ui}
        text={field.label}
        fontSize={12}
        color={pal.text}
        maxLines={1}
      />,
      <Box key={`field:${index}`}>{field.render(16 * ui, y + LABEL * ui, inner)}</Box>,
    );
    y += ROW * ui;
  }
  return (
    <Box width={props.width} height={props.height}>
      {parts}
      <TextBlock
        x={16 * ui}
        y={y}
        width={inner}
        height={32 * ui}
        text={props.message}
        fontSize={11}
        color={props.error ? pal.danger : pal.muted}
        wrap
        maxLines={2}
      />
      <Horizontal
        x={16 * ui}
        y={y + 38 * ui}
        width={inner}
        height={32 * ui}
        gap={8 * ui}
        justify="end"
      >
        <Button width={92 * ui} height={30 * ui} label="Cancel" onPress={props.onCancel} />
        <Button
          width={100 * ui}
          height={30 * ui}
          label={props.submitLabel}
          variant="primary"
          focusId={props.submitFocusId}
          disabled={!props.canSubmit}
          onPress={props.onSubmit}
        />
      </Horizontal>
    </Box>
  );
}

const SECURITY: readonly { id: HiddenWifiSecurity; label: string }[] = [
  { id: "open", label: "None" },
  { id: "wpa-psk", label: "WPA2" },
  { id: "sae", label: "WPA3" },
];

export function HiddenNetworkSheet(props: {
  context: PageContext;
  width: number;
  height: number;
}): ReactNode {
  const ui = getUiScaleFactor();
  const [ssid, setSsid] = useState("");
  const [security, setSecurity] = useState<HiddenWifiSecurity>("wpa-psk");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    let request;
    try {
      request = parseHiddenWifiRequest({
        ssid,
        security,
        password: security === "open" ? "" : password,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const { context } = props;
    context.closeSheet();
    context.attempt(PAGE, async () => {
      const failure = await context.desktop.run("wifi-connect", (client) =>
        client.connectHiddenWifi(request),
      );
      return failure ? `Couldn't join ${request.ssid}: ${failure}` : null;
    });
  };
  return (
    <Form
      width={props.width}
      height={props.height}
      intro="For a network that doesn't show its name. Ask its owner for the name and password."
      fields={[
        {
          label: "Network name",
          render: (x, y, width) => (
            <TextField
              x={x}
              y={y}
              width={width}
              height={FIELD * ui}
              autoFocus
              value={ssid}
              placeholder="Name (SSID)"
              invalid={!!error && !ssid.trim()}
              focusId="network:hidden:ssid"
              onChange={setSsid}
              onSubmit={submit}
            />
          ),
        },
        {
          label: "Security",
          render: (x, y, width) => (
            <SegmentedControl
              x={x}
              y={y}
              width={Math.min(width, 260 * ui)}
              height={32 * ui}
              value={security}
              options={SECURITY}
              onChange={(id) => setSecurity(id as HiddenWifiSecurity)}
            />
          ),
        },
        ...(security === "open"
          ? []
          : [
              {
                label: "Password",
                render: (x: number, y: number, width: number) => (
                  <TextField
                    x={x}
                    y={y}
                    width={width}
                    height={FIELD * ui}
                    password
                    value={password}
                    placeholder="Password"
                    invalid={!!error && !!ssid.trim()}
                    focusId="network:hidden:password"
                    onChange={setPassword}
                    onSubmit={submit}
                  />
                ),
              },
            ]),
      ]}
      message={error ?? ""}
      error={!!error}
      submitLabel="Join"
      submitFocusId="network:hidden:join"
      canSubmit={!!ssid.trim() && (security === "open" || !!password)}
      onSubmit={submit}
      onCancel={props.context.closeSheet}
    />
  );
}

export function VpnImportSheet(props: {
  context: PageContext;
  file: Extract<VpnFile, { kind: "wireguard" | "openvpn" }>;
  width: number;
  height: number;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { file, context } = props;
  const [name, setName] = useState(file.name);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const ready = !!name.trim() && (!file.needsCredentials || (!!username && !!password));
  const submit = () => {
    if (!ready) return;
    context.closeSheet();
    context.attempt(PAGE, async () => {
      const failure = await context.desktop.run("vpn-import", (client) =>
        client.importVpn({
          kind: file.kind,
          name: name.trim(),
          config: file.config,
          username: file.needsCredentials ? username : "",
          password: file.needsCredentials ? password : "",
        }),
      );
      return failure ? `Couldn't add ${name.trim()}: ${failure}` : null;
    });
  };
  const field = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    focusId: string,
    secret = false,
  ) => ({
    label,
    render: (x: number, y: number, width: number) => (
      <TextField
        x={x}
        y={y}
        width={width}
        height={FIELD * ui}
        password={secret}
        autoFocus={focusId === "network:vpn:name"}
        value={value}
        focusId={focusId}
        onChange={onChange}
        onSubmit={submit}
      />
    ),
  });
  return (
    <Form
      width={props.width}
      height={props.height}
      intro={
        file.kind === "wireguard"
          ? "A WireGuard tunnel. Its keys are kept by NetworkManager."
          : "An OpenVPN profile. Its certificates are kept in your home folder."
      }
      fields={[
        field("Name", name, setName, "network:vpn:name"),
        ...(file.needsCredentials
          ? [
              field("User name", username, setUsername, "network:vpn:username"),
              field("Password", password, setPassword, "network:vpn:password", true),
            ]
          : []),
      ]}
      message={
        file.ignored.length
          ? `Not used by ${vpnKindLabel(file.kind)} here: ${file.ignored.join(", ")}`
          : ""
      }
      error={false}
      submitLabel="Add VPN"
      submitFocusId="network:vpn:add"
      canSubmit={ready}
      onSubmit={submit}
      onCancel={context.closeSheet}
    />
  );
}

/**
 * Off, Automatic (a PAC file, through NetworkManager) or Manual (Moire's environment). On a
 * connection shared by everyone, a NetworkManager change is saved to the user's own copy of it
 * ("applies to you only"); a shared secured Wi‑Fi's password can't be read, so it's asked for.
 */
export function ProxySheet(props: {
  context: PageContext;
  proxy: NetworkProxy | undefined;
  width: number;
  height: number;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { context, proxy } = props;
  const manual: ManualProxySettings = context.prefs.values.proxy;
  const [mode, setMode] = useState<ProxyMode>(proxyMode(proxy, manual));
  const [pacUrl, setPacUrl] = useState(proxy?.pacUrl ?? "");
  const [http, setHttp] = useState(manual.http);
  const [https, setHttps] = useState(manual.https);
  const [ignore, setIgnore] = useState(manual.ignore);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canAuto = !!proxy?.canChange;
  // NetworkManager keeps the connection's own proxy; manual and off clear it.
  const method = mode === "auto" ? "auto" : "none";
  const changes = proxyChanges(proxy, method, pacUrl);
  const askPassword = changes && !!proxy?.needsPassword;
  const submit = () => {
    if (mode === "auto" && !isValidPacUrl(pacUrl.trim()))
      return setError("Enter an http, https or file address, or leave it empty");
    if (mode === "manual" && !isProxyAddress(http))
      return setError("Enter the HTTP proxy as host:port");
    if (mode === "manual" && https.trim() && !isProxyAddress(https))
      return setError("Enter the HTTPS proxy as host:port, or leave it empty");
    if (askPassword && !password)
      return setError(`Enter the Wi‑Fi password for ${proxy?.connection ?? "this network"}`);
    context.closeSheet();
    const enabled = mode === "manual";
    if (enabled !== manual.enabled || enabled)
      context.prefs.set(
        { proxy: { enabled, http: http.trim(), https: https.trim(), ignore: ignore.trim() } },
        { label: enabled ? "Manual proxy turned on" : "Manual proxy turned off", page: PAGE },
      );
    if (changes)
      context.attempt(PAGE, async () => {
        const failure = await context.desktop.run("proxy", (client) =>
          client.setProxy({
            method,
            pacUrl: method === "auto" ? pacUrl.trim() : "",
            ...(askPassword ? { password } : {}),
          }),
        );
        return failure ? `Couldn't change the proxy: ${failure}` : null;
      });
  };
  const text = (
    value: string,
    onChange: (value: string) => void,
    focusId: string,
    placeholder: string,
  ) => ({
    render: (x: number, y: number, width: number) => (
      <TextField
        x={x}
        y={y}
        width={width}
        height={FIELD * ui}
        value={value}
        placeholder={placeholder}
        focusId={focusId}
        onChange={(next) => {
          setError(null);
          onChange(next);
        }}
        onSubmit={submit}
      />
    ),
  });
  const passwordField = askPassword
    ? [
        {
          label: `Wi‑Fi password for ${proxy?.connection ?? "this network"}`,
          render: (x: number, y: number, width: number) => (
            <TextField
              x={x}
              y={y}
              width={width}
              height={FIELD * ui}
              password
              value={password}
              placeholder="Password"
              focusId="network:proxy:password"
              onChange={(next) => {
                setError(null);
                setPassword(next);
              }}
              onSubmit={submit}
            />
          ),
        },
      ]
    : [];
  const modeFields =
    mode === "auto"
      ? [
          {
            label: "Configuration address (PAC)",
            ...text(pacUrl, setPacUrl, "network:proxy:pac", "Empty finds it on the network"),
          },
        ]
      : mode === "manual"
        ? [
            { label: "HTTP proxy", ...text(http, setHttp, "network:proxy:http", "host:port") },
            {
              label: "HTTPS proxy",
              ...text(https, setHttps, "network:proxy:https", "Same as HTTP"),
            },
            {
              label: "Go direct for",
              ...text(ignore, setIgnore, "network:proxy:ignore", "localhost, .example.com"),
            },
          ]
        : [];
  const fields = [...modeFields, ...passwordField];
  const note =
    changes && proxy?.copy
      ? `Applies to you only: ${proxy.connection} is shared, so you get your own copy.`
      : mode === "manual"
        ? "Apps you open after saving use it; open apps keep their old setting."
        : mode === "auto"
          ? `For ${proxy?.connection ?? "this connection"}, through NetworkManager.`
          : proxy && !canAuto && proxy.ownership === "system"
            ? `${proxy.connection} is shared by everyone on this computer; only an administrator can set its automatic proxy.`
            : "Apps connect directly.";
  return (
    <Form
      width={props.width}
      height={props.height}
      header={{
        height: 32,
        render: (x, y, width) => (
          <SegmentedControl
            x={x}
            y={y}
            width={Math.min(width, 300 * ui)}
            height={32 * ui}
            value={mode}
            options={[
              { id: "none", label: "Off" },
              { id: "auto", label: "Automatic", disabled: !canAuto },
              { id: "manual", label: "Manual" },
            ]}
            onChange={(id) => {
              setError(null);
              setMode(id as ProxyMode);
            }}
          />
        ),
      }}
      fields={fields}
      message={error ?? note}
      error={!!error}
      submitLabel="Save"
      submitFocusId="network:proxy:save"
      canSubmit
      onSubmit={submit}
      onCancel={context.closeSheet}
    />
  );
}

/** Shown when the picked file can't be imported. */
export function importHint(kinds: readonly ("wireguard" | "openvpn")[]): string {
  return `Add a ${importableLabel(kinds)} configuration file`;
}
