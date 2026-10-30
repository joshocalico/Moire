/**
 * NetworkManager profiles for imported VPNs, and the files they keep.
 *
 * WireGuard is built into NetworkManager; OpenVPN needs its plugin, which is found the way
 * NetworkManager finds it: a `.name` file in one of its VPN plugin directories. Moire runs no
 * NetworkManager secret agent, so secrets (the WireGuard private key, an OpenVPN password) are
 * stored with the profile (flags 0), readable only through NetworkManager.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isIP } from "node:net";
import { variant } from "@moire/dbus";
import type { VpnImportRequest } from "@moire/system-management/network-status";
import {
  parseOpenVpnConfig,
  parseWireGuardConfig,
  wireGuardInterfaceName,
  type IpAddress,
  type OpenVpnConfig,
  type WireGuardConfig,
} from "@moire/system-management/vpn-config";

export type VpnPlugin = "openvpn";
const OPENVPN_SERVICE = "org.freedesktop.NetworkManager.openvpn";
/** NixOS links plugins into /etc; other distributions install them under lib. */
const PLUGIN_DIRECTORIES = [
  "/etc/NetworkManager/VPN",
  "/usr/lib/NetworkManager/VPN",
  "/usr/lib64/NetworkManager/VPN",
  "/run/current-system/sw/lib/NetworkManager/VPN",
];
const PLUGIN_CACHE_MS = 30_000;
let pluginCache: { at: number; plugins: readonly VpnPlugin[] } | null = null;

export function installedVpnPlugins(directories = PLUGIN_DIRECTORIES): readonly VpnPlugin[] {
  const now = performance.now();
  if (directories === PLUGIN_DIRECTORIES && pluginCache && now - pluginCache.at < PLUGIN_CACHE_MS)
    return pluginCache.plugins;
  const found = new Set<VpnPlugin>();
  for (const directory of directories) {
    let entries: string[];
    try {
      entries = fs.readdirSync(directory);
    } catch {
      continue;
    }
    for (const entry of entries.filter((name) => name.endsWith(".name")).slice(0, 64)) {
      try {
        const text = fs.readFileSync(path.join(directory, entry), "utf8").slice(0, 16 * 1024);
        if (/^service\s*=\s*org\.freedesktop\.NetworkManager\.openvpn\s*$/m.test(text))
          found.add("openvpn");
      } catch {
        // An unreadable plugin description is a plugin NetworkManager can't load either.
      }
    }
  }
  const plugins = [...found];
  if (directories === PLUGIN_DIRECTORIES) pluginCache = { at: now, plugins };
  return plugins;
}

export function vpnDataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_DATA_HOME?.startsWith("/")
    ? env.XDG_DATA_HOME
    : path.join(os.homedir(), ".local", "share");
  return path.join(base, "moire", "vpn");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Remove the certificates kept for one profile; only ever a UUID-named child of `root`. */
export function removeVpnFiles(root: string, uuid: string): void {
  if (!UUID.test(uuid)) return;
  fs.rmSync(path.join(root, uuid), { recursive: true, force: true });
}

type ProfileContext = {
  uuid: string;
  user: string;
  dataDir: string;
  /** Interface names other profiles already use. */
  interfaces: ReadonlySet<string>;
};

function connection(request: VpnImportRequest, context: ProfileContext, type: string) {
  return {
    id: variant("s", request.name),
    uuid: variant("s", context.uuid),
    type: variant("s", type),
    autoconnect: variant("b", false),
    permissions: variant("as", [`user:${context.user}:`]),
  };
}

/** NetworkManager's legacy DNS lists: IPv4 as network-order integers, IPv6 as 16 bytes. */
export function ipv4Integer(address: string): number {
  const bytes = address.split(".").map(Number);
  return Buffer.from(bytes).readUInt32LE(0);
}
export function ipv6Bytes(address: string): Buffer {
  let text = address.replace(/%.*$/, "");
  // An embedded IPv4 tail (::ffff:1.2.3.4) is the last two groups.
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) throw new Error(`${address} isn't an IPv6 address`);
  const out = Buffer.alloc(16);
  groups.forEach((group, index) => out.writeUInt16BE(Number.parseInt(group, 16), index * 2));
  return out;
}

function addressData(addresses: readonly IpAddress[]) {
  return variant(
    "aa{sv}",
    addresses.map((item) => ({
      address: variant("s", item.address),
      prefix: variant("u", item.prefix),
    })),
  );
}

export function wireGuardSettings(
  request: VpnImportRequest,
  config: WireGuardConfig,
  context: ProfileContext,
): Record<string, unknown> {
  const v4 = config.addresses.filter((item) => item.family === 4);
  const v6 = config.addresses.filter((item) => item.family === 6);
  const dns4 = config.dns.filter((item) => isIP(item) === 4);
  const dns6 = config.dns.filter((item) => isIP(item) === 6);
  // Search domains belong with whichever family carries the tunnel's addresses.
  const searchOn4 = v4.length > 0 || !v6.length;
  return {
    connection: {
      ...connection(request, context, "wireguard"),
      "interface-name": variant("s", wireGuardInterfaceName(request.name, context.interfaces)),
    },
    wireguard: {
      "private-key": variant("s", config.privateKey),
      "private-key-flags": variant("u", 0),
      ...(config.listenPort !== null ? { "listen-port": variant("u", config.listenPort) } : {}),
      ...(config.mtu !== null ? { mtu: variant("u", config.mtu) } : {}),
      ...(config.fwmark !== null ? { fwmark: variant("u", config.fwmark) } : {}),
      peers: variant(
        "aa{sv}",
        config.peers.map((peer) => ({
          "public-key": variant("s", peer.publicKey),
          "allowed-ips": variant("as", peer.allowedIps),
          ...(peer.endpoint ? { endpoint: variant("s", peer.endpoint) } : {}),
          ...(peer.presharedKey
            ? {
                "preshared-key": variant("s", peer.presharedKey),
                "preshared-key-flags": variant("u", 0),
              }
            : {}),
          ...(peer.persistentKeepalive !== null
            ? { "persistent-keepalive": variant("u", peer.persistentKeepalive) }
            : {}),
        })),
      ),
    },
    ipv4: v4.length
      ? {
          method: variant("s", "manual"),
          "address-data": addressData(v4),
          ...(dns4.length ? { dns: variant("au", dns4.map(ipv4Integer)) } : {}),
          ...(searchOn4 && config.dnsSearch.length
            ? { "dns-search": variant("as", config.dnsSearch) }
            : {}),
        }
      : { method: variant("s", "disabled") },
    ipv6: v6.length
      ? {
          method: variant("s", "manual"),
          "address-data": addressData(v6),
          ...(dns6.length ? { dns: variant("aay", dns6.map(ipv6Bytes)) } : {}),
          ...(!searchOn4 && config.dnsSearch.length
            ? { "dns-search": variant("as", config.dnsSearch) }
            : {}),
        }
      : { method: variant("s", "ignore") },
  };
}

/** OpenVPN directives as NetworkManager-openvpn names them in `vpn.data`. */
const OPENVPN_OPTIONS: Readonly<Record<string, string>> = {
  cipher: "cipher",
  auth: "auth",
  "tls-version-min": "tls-version-min",
  "remote-cert-tls": "remote-cert-tls",
  "verify-x509-name": "verify-x509-name",
  "comp-lzo": "comp-lzo",
  compress: "compress",
  "tun-mtu": "tunnel-mtu",
  mssfix: "mssfix",
  "reneg-sec": "reneg-seconds",
  "data-ciphers": "data-ciphers",
  "data-ciphers-fallback": "data-ciphers-fallback",
  "tls-cipher": "tls-cipher",
  ping: "ping",
  "ping-restart": "ping-restart",
  "ping-exit": "ping-exit",
  fragment: "fragment-size",
  float: "float",
  "remote-random": "remote-random",
};

/** Write the profile's certificates where NetworkManager's OpenVPN service can read them. */
function writeOpenVpnFiles(config: OpenVpnConfig, directory: string): Record<string, string> {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const files: Record<string, string> = {};
  const write = (key: string, name: string, content: string | null) => {
    if (!content) return;
    const file = path.join(directory, name);
    fs.writeFileSync(file, content, { mode: 0o600 });
    files[key] = file;
  };
  write("ca", "ca.crt", config.ca);
  write("cert", "client.crt", config.cert);
  write("key", "client.key", config.key);
  write("ta", "tls-auth.key", config.tlsAuth);
  write("tls-crypt", "tls-crypt.key", config.tlsCrypt);
  return files;
}

export function openVpnSettings(
  request: VpnImportRequest,
  config: OpenVpnConfig,
  context: ProfileContext,
  files: Readonly<Record<string, string>>,
): Record<string, unknown> {
  if (config.authUserPass && (!request.username || !request.password))
    throw new Error("This VPN needs a user name and password");
  const data: Record<string, string> = {
    remote: config.remotes
      .map((remote) => `${remote.host}:${remote.port}:${remote.proto}`)
      .join(", "),
    "dev-type": config.devType,
    "connection-type": config.cert ? (config.authUserPass ? "password-tls" : "tls") : "password",
    ...files,
  };
  if (config.keyDirection && files.ta) data["ta-dir"] = config.keyDirection;
  for (const [option, value] of Object.entries(config.options)) {
    const key = OPENVPN_OPTIONS[option];
    if (!key) continue;
    data[key] = option === "comp-lzo" && value === "no" ? "no-by-default" : value;
  }
  if (config.authUserPass) {
    data.username = request.username;
    data["password-flags"] = "0";
  }
  return {
    connection: connection(request, context, "vpn"),
    vpn: {
      "service-type": variant("s", OPENVPN_SERVICE),
      data: variant("a{ss}", data),
      ...(config.authUserPass ? { secrets: variant("a{ss}", { password: request.password }) } : {}),
    },
    ipv4: { method: variant("s", "auto") },
    ipv6: { method: variant("s", "auto") },
  };
}

/** Parse the request's configuration and build its profile, writing any files it needs. */
export function vpnProfileSettings(
  request: VpnImportRequest,
  context: ProfileContext,
): Record<string, unknown> {
  if (request.kind === "wireguard")
    return wireGuardSettings(request, parseWireGuardConfig(request.config), context);
  const config = parseOpenVpnConfig(request.config);
  if (config.authUserPass && (!request.username || !request.password))
    throw new Error("This VPN needs a user name and password");
  const directory = path.join(context.dataDir, context.uuid);
  try {
    return openVpnSettings(request, config, context, writeOpenVpnFiles(config, directory));
  } catch (error) {
    removeVpnFiles(context.dataDir, context.uuid);
    throw error;
  }
}
