/**
 * WireGuard `.conf` and OpenVPN `.ovpn` files, parsed into plain values. Settings parses before
 * sending so the sheet can show what's wrong; the management service parses again, since it
 * never trusts the caller, and builds the NetworkManager profile from the result.
 *
 * Error messages are written for people and never quote key material.
 */
import { isIP } from "node:net";
import path from "node:path";

export type IpAddress = Readonly<{ address: string; prefix: number; family: 4 | 6 }>;
export type WireGuardPeer = Readonly<{
  publicKey: string;
  presharedKey: string | null;
  allowedIps: readonly string[];
  endpoint: string | null;
  persistentKeepalive: number | null;
}>;
export type WireGuardConfig = Readonly<{
  privateKey: string;
  addresses: readonly IpAddress[];
  dns: readonly string[];
  dnsSearch: readonly string[];
  listenPort: number | null;
  mtu: number | null;
  fwmark: number | null;
  peers: readonly WireGuardPeer[];
  /** Keys Moire doesn't apply (wg-quick hooks, Table, SaveConfig). */
  ignored: readonly string[];
}>;

const MAX_PEERS = 64;
const MAX_ALLOWED_IPS = 256;

function fail(message: string): never {
  throw new Error(message);
}

/** A WireGuard key: 32 bytes in base64. */
export function isWireGuardKey(value: string): boolean {
  return /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(value);
}

function integer(value: string, min: number, max: number, label: string): number {
  if (!/^\d{1,10}$/.test(value)) fail(`${label} must be a number`);
  const number = Number(value);
  if (number < min || number > max) fail(`${label} must be between ${min} and ${max}`);
  return number;
}

/** `10.0.0.2/24`, `fd00::2/64`, or a bare address (a host prefix). */
export function parseCidr(value: string, label = "Address"): IpAddress {
  const [address = "", prefixText, extra] = value.trim().split("/");
  if (extra !== undefined) fail(`${label} ${value} isn't an IP address`);
  const family = isIP(address);
  if (family !== 4 && family !== 6) fail(`${label} ${value} isn't an IP address`);
  const max = family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? max : integer(prefixText, 0, max, `${label} prefix`);
  return { address, prefix, family };
}

/** `host:port` or `[v6]:port`; the host may be a name. */
export function parseEndpoint(value: string): string {
  const match = /^(?:\[([0-9A-Fa-f:.]+)\]|([^\s:[\]]+)):(\d{1,5})$/.exec(value.trim());
  if (!match) fail(`Endpoint ${value} needs a host and port`);
  const host = match[1] ?? match[2] ?? "";
  if (match[1] && isIP(host) !== 6) fail(`Endpoint ${value} has an invalid IPv6 address`);
  if (!match[1] && !isIP(host) && !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host))
    fail(`Endpoint ${value} has an invalid host name`);
  integer(match[3]!, 1, 65535, "Endpoint port");
  return value.trim();
}

function list(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Parse a wg-quick configuration. Throws with a message to show. */
export function parseWireGuardConfig(text: string): WireGuardConfig {
  let section: "interface" | "peer" | null = null;
  let privateKey: string | null = null;
  const addresses: IpAddress[] = [];
  const dns: string[] = [];
  const dnsSearch: string[] = [];
  let listenPort: number | null = null,
    mtu: number | null = null,
    fwmark: number | null = null;
  const peers: {
    publicKey: string | null;
    presharedKey: string | null;
    allowedIps: string[];
    endpoint: string | null;
    persistentKeepalive: number | null;
  }[] = [];
  const ignored = new Set<string>();
  let sawInterface = false;
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/[#;].*$/, "").trim();
    if (!line) continue;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) {
      const name = header[1]!.toLowerCase();
      if (name === "interface") {
        if (sawInterface) fail("The file has more than one [Interface] section");
        sawInterface = true;
        section = "interface";
      } else if (name === "peer") {
        if (peers.length >= MAX_PEERS) fail(`At most ${MAX_PEERS} peers are supported`);
        section = "peer";
        peers.push({
          publicKey: null,
          presharedKey: null,
          allowedIps: [],
          endpoint: null,
          persistentKeepalive: null,
        });
      } else fail(`Line ${index + 1}: unknown section [${header[1]}]`);
      continue;
    }
    const pair = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(line);
    if (!pair) fail(`Line ${index + 1} isn't a key = value setting`);
    const key = pair[1]!.toLowerCase(),
      value = pair[2]!.trim();
    if (!section) fail(`Line ${index + 1} comes before [Interface]`);
    if (section === "interface") {
      switch (key) {
        case "privatekey":
          if (!isWireGuardKey(value)) fail("PrivateKey isn't a WireGuard key");
          privateKey = value;
          break;
        case "address":
          for (const item of list(value)) addresses.push(parseCidr(item));
          break;
        case "dns":
          for (const item of list(value)) {
            if (isIP(item)) dns.push(item);
            else if (/^[A-Za-z0-9.-]{1,253}$/.test(item)) dnsSearch.push(item);
            else fail(`DNS entry ${item} is neither an address nor a domain`);
          }
          break;
        case "listenport":
          listenPort = integer(value, 0, 65535, "ListenPort");
          break;
        case "mtu":
          mtu = integer(value, 576, 9000, "MTU");
          break;
        case "fwmark":
          fwmark =
            value === "off"
              ? 0
              : /^0x[0-9a-f]{1,8}$/i.test(value)
                ? Number.parseInt(value.slice(2), 16)
                : integer(value, 0, 0xffff_ffff, "FwMark");
          break;
        case "table":
        case "preup":
        case "postup":
        case "predown":
        case "postdown":
        case "saveconfig":
          ignored.add(pair[1]!);
          break;
        default:
          fail(`Line ${index + 1}: unknown setting ${pair[1]}`);
      }
    } else {
      const peer = peers.at(-1)!;
      switch (key) {
        case "publickey":
          if (!isWireGuardKey(value)) fail("A peer's PublicKey isn't a WireGuard key");
          peer.publicKey = value;
          break;
        case "presharedkey":
          if (!isWireGuardKey(value)) fail("A peer's PresharedKey isn't a WireGuard key");
          peer.presharedKey = value;
          break;
        case "allowedips":
          for (const item of list(value)) {
            const cidr = parseCidr(item, "AllowedIPs");
            peer.allowedIps.push(`${cidr.address}/${cidr.prefix}`);
          }
          if (peer.allowedIps.length > MAX_ALLOWED_IPS)
            fail(`A peer may list at most ${MAX_ALLOWED_IPS} AllowedIPs`);
          break;
        case "endpoint":
          peer.endpoint = parseEndpoint(value);
          break;
        case "persistentkeepalive":
          peer.persistentKeepalive = value === "off" ? 0 : integer(value, 0, 65535, "Keepalive");
          break;
        default:
          fail(`Line ${index + 1}: unknown peer setting ${pair[1]}`);
      }
    }
  }
  if (!sawInterface) fail("This isn't a WireGuard configuration: it has no [Interface]");
  if (!privateKey) fail("The [Interface] section has no PrivateKey");
  if (!peers.length) fail("The configuration has no [Peer]");
  return {
    privateKey,
    addresses,
    dns,
    dnsSearch,
    listenPort,
    mtu,
    fwmark,
    peers: peers.map((peer, index) => {
      if (!peer.publicKey) fail(`Peer ${index + 1} has no PublicKey`);
      return { ...peer, publicKey: peer.publicKey };
    }),
    ignored: [...ignored],
  };
}

export type OpenVpnRemote = Readonly<{ host: string; port: number; proto: "udp" | "tcp" }>;
export type OpenVpnConfig = Readonly<{
  remotes: readonly OpenVpnRemote[];
  devType: "tun" | "tap";
  /** PEM text for each file the profile needs. */
  ca: string | null;
  cert: string | null;
  key: string | null;
  tlsAuth: string | null;
  tlsCrypt: string | null;
  keyDirection: "0" | "1" | null;
  /** The server asks for a user name and password. */
  authUserPass: boolean;
  /** NetworkManager's `vpn.data` options other than files and remotes. */
  options: Readonly<Record<string, string>>;
  ignored: readonly string[];
}>;

/** Directives that only shape the client process, which NetworkManager runs its own way. */
const OPENVPN_HARMLESS = new Set([
  "client",
  "nobind",
  "persist-key",
  "persist-tun",
  "resolv-retry",
  "verb",
  "mute",
  "mute-replay-warnings",
  "auth-nocache",
  "explicit-exit-notify",
  "pull",
  "tls-client",
  "redirect-gateway",
  "setenv",
  "script-security",
  "up",
  "down",
  "block-outside-dns",
  "auth-retry",
  "ignore-unknown-option",
  "remote-random-hostname",
  "connect-retry",
  "connect-retry-max",
  "server-poll-timeout",
  "sndbuf",
  "rcvbuf",
  "fast-io",
  "pull-filter",
  "route-delay",
]);
const INLINE = ["ca", "cert", "key", "tls-auth", "tls-crypt"] as const;
type InlineName = (typeof INLINE)[number];

/** OpenVPN's quoting: double quotes, backslash escapes, else whitespace splits. */
function words(line: string): string[] {
  const out: string[] = [];
  let current = "",
    quoted = false,
    any = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (char === "\\" && index + 1 < line.length) {
      current += line[++index];
      any = true;
    } else if (char === '"') {
      quoted = !quoted;
      any = true;
    } else if (!quoted && /\s/.test(char)) {
      if (any) out.push(current);
      current = "";
      any = false;
    } else {
      current += char;
      any = true;
    }
  }
  if (quoted) fail("A quoted value isn't closed");
  if (any) out.push(current);
  return out;
}

function pem(name: string, body: string): string {
  const text = body.trim();
  if (!text) fail(`The <${name}> block is empty`);
  if (text.length > 64 * 1024) fail(`The <${name}> block is too large`);
  if (!/-----BEGIN [A-Za-z0-9 ]+-----/.test(text)) fail(`The ${name} isn't PEM text`);
  return `${text}\n`;
}

/**
 * Inline the files a profile names (`ca ca.crt`) so the import is one self-contained text.
 * `read` resolves a name relative to the profile and returns its text, or throws.
 */
export function inlineOpenVpnFiles(text: string, read: (name: string) => string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || /^[#;<]/.test(trimmed)) return line;
      const parts = words(trimmed);
      const name = parts[0]?.toLowerCase();
      if (!name || !(INLINE as readonly string[]).includes(name)) return line;
      const file = parts[1];
      if (!file || file === "[inline]") return line;
      const content = read(file);
      const direction =
        name === "tls-auth" && parts[2] !== undefined ? `\nkey-direction ${parts[2]}` : "";
      return `<${name}>\n${content.trim()}\n</${name}>${direction}`;
    })
    .join("\n");
}

/** Parse a self-contained `.ovpn` (files inlined). Throws with a message to show. */
export function parseOpenVpnConfig(text: string): OpenVpnConfig {
  const remotes: { host: string; port: number | null; proto: "udp" | "tcp" | null }[] = [];
  const blocks: Partial<Record<InlineName, string>> = {};
  const options: Record<string, string> = {};
  const ignored = new Set<string>();
  let devType: "tun" | "tap" | null = null;
  let defaultPort = 1194;
  let defaultProto: "udp" | "tcp" = "udp";
  let keyDirection: "0" | "1" | null = null;
  let authUserPass = false;
  let sawClient = false;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line || /^[#;]/.test(line)) continue;
    const open = /^<([a-z-]+)>$/.exec(line);
    if (open) {
      const name = open[1]!;
      const end = lines.findIndex(
        (candidate, at) => at > index && candidate.trim() === `</${name}>`,
      );
      if (end < 0) fail(`The <${name}> block isn't closed`);
      const body = lines.slice(index + 1, end).join("\n");
      if ((INLINE as readonly string[]).includes(name))
        blocks[name as InlineName] = pem(name, body);
      else ignored.add(`<${name}>`);
      index = end;
      continue;
    }
    const [directive = "", ...args] = words(line);
    const name = directive.toLowerCase();
    const first = args[0] ?? "";
    switch (name) {
      case "client":
      case "tls-client":
        sawClient = true;
        break;
      case "remote": {
        if (!first) fail(`Line ${index + 1}: remote needs a host`);
        if (!/^[A-Za-z0-9.-]{1,253}$/.test(first))
          fail(`Remote ${first} isn't a host name or IPv4 address`);
        remotes.push({
          host: first,
          port: args[1] ? integer(args[1], 1, 65535, "Remote port") : null,
          proto: args[2] ? protocol(args[2]) : null,
        });
        break;
      }
      case "port":
      case "rport":
        defaultPort = integer(first, 1, 65535, "Port");
        break;
      case "proto":
        defaultProto = protocol(first);
        break;
      case "dev":
      case "dev-type":
        if (first.startsWith("tun")) devType = "tun";
        else if (first.startsWith("tap")) devType = "tap";
        else fail(`Device ${first} isn't tun or tap`);
        break;
      case "key-direction":
        if (first !== "0" && first !== "1") fail("key-direction must be 0 or 1");
        keyDirection = first;
        break;
      case "auth-user-pass":
        if (args.length) fail("auth-user-pass with a file isn't supported; enter them in Settings");
        authUserPass = true;
        break;
      case "ca":
      case "cert":
      case "key":
      case "tls-auth":
      case "tls-crypt":
        if (first !== "[inline]") fail(`The ${name} file ${first} wasn't included`);
        if (name === "tls-auth" && args[1] !== undefined) {
          if (args[1] !== "0" && args[1] !== "1") fail("tls-auth direction must be 0 or 1");
          keyDirection = args[1];
        }
        break;
      case "cipher":
      case "auth":
      case "tls-version-min":
      case "remote-cert-tls":
      case "tun-mtu":
      case "mssfix":
      case "reneg-sec":
      case "data-ciphers":
      case "data-ciphers-fallback":
      case "tls-cipher":
      case "ping":
      case "ping-restart":
      case "ping-exit":
      case "fragment":
        if (!first || first.length > 512) fail(`Line ${index + 1}: ${name} needs a value`);
        options[name] = first;
        break;
      case "verify-x509-name":
        if (!first) fail("verify-x509-name needs a name");
        // NetworkManager writes `type:name`; OpenVPN's default type is subject.
        options[name] = `${args[1] ?? "subject"}:${first}`;
        break;
      case "comp-lzo":
        options[name] = first || "adaptive";
        break;
      case "compress":
        options[name] = first || "yes";
        break;
      case "float":
      case "remote-random":
        options[name] = "yes";
        break;
      case "secret":
        fail("Static-key OpenVPN profiles aren't supported");
        break;
      case "pkcs12":
        fail("PKCS#12 bundles aren't supported; export the certificate and key as PEM");
        break;
      default:
        if (OPENVPN_HARMLESS.has(name)) break;
        ignored.add(directive);
    }
  }
  if (!sawClient && !remotes.length) fail("This isn't an OpenVPN client profile");
  if (!remotes.length) fail("The profile names no remote server");
  if (remotes.length > 16) fail("At most 16 remote servers are supported");
  if (!blocks.ca) fail("The profile has no CA certificate");
  if (!!blocks.cert !== !!blocks.key) fail("The profile has a certificate without its key");
  if (!blocks.cert && !authUserPass)
    fail("The profile has neither a client certificate nor a user name and password");
  if (blocks.key && /ENCRYPTED/.test(blocks.key))
    fail("Encrypted private keys aren't supported yet; decrypt the key first");
  return {
    remotes: remotes.map((remote): OpenVpnRemote => ({
      host: remote.host,
      port: remote.port ?? defaultPort,
      proto: remote.proto ?? defaultProto,
    })),
    devType: devType ?? "tun",
    ca: blocks.ca,
    cert: blocks.cert ?? null,
    key: blocks.key ?? null,
    tlsAuth: blocks["tls-auth"] ?? null,
    tlsCrypt: blocks["tls-crypt"] ?? null,
    keyDirection,
    authUserPass,
    options,
    ignored: [...ignored],
  };
}

function protocol(value: string): "udp" | "tcp" {
  const lower = value.toLowerCase();
  if (lower.startsWith("udp")) return "udp";
  if (lower.startsWith("tcp")) return "tcp";
  return fail(`Protocol ${value} isn't udp or tcp`);
}

/** A display name from the file: `office-vpn.conf` → `office-vpn`. */
export function vpnNameFromFile(file: string): string {
  return (
    path
      .basename(file)
      .replace(/\.(conf|ovpn)$/i, "")
      .slice(0, 64) || "VPN"
  );
}

/** The VPN kind a file's extension suggests. */
export function vpnKindFromFile(file: string): "wireguard" | "openvpn" | null {
  if (/\.conf$/i.test(file)) return "wireguard";
  if (/\.ovpn$/i.test(file)) return "openvpn";
  return null;
}

/** A kernel interface name (≤ 15 bytes) for a WireGuard profile, avoiding `taken`. */
export function wireGuardInterfaceName(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 12) || "wg";
  const stem = base.startsWith("wg") ? base : `wg-${base}`.slice(0, 12);
  if (!taken.has(stem)) return stem;
  for (let suffix = 1; suffix < 1000; suffix++) {
    const candidate = `${stem.slice(0, 12)}${suffix}`.slice(0, 15);
    if (!taken.has(candidate)) return candidate;
  }
  return fail("No free WireGuard interface name");
}
