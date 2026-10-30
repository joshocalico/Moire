/** VPN configuration parsing and request validation, with no NetworkManager involved. */
import assert from "node:assert/strict";
import {
  inlineOpenVpnFiles,
  isWireGuardKey,
  parseCidr,
  parseEndpoint,
  parseOpenVpnConfig,
  parseWireGuardConfig,
  vpnKindFromFile,
  vpnNameFromFile,
  wireGuardInterfaceName,
} from "./vpn-config";
import {
  isValidPacUrl,
  parseDesktopWifi,
  parseHiddenWifiRequest,
  parseProxyRequest,
  parseVpnId,
  parseVpnImportRequest,
} from "./network-status";

let cases = 0;
const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");
const PRIVATE = key(1),
  PUBLIC = key(2),
  SHARED = key(3);

assert(isWireGuardKey(PRIVATE));
assert(!isWireGuardKey(PRIVATE.slice(1)));
assert(!isWireGuardKey(Buffer.alloc(31).toString("base64")));
assert(!isWireGuardKey("A".repeat(42) + "B="), "trailing bits must be zero");
cases++;

assert.deepEqual(parseCidr("10.0.0.2/24"), { address: "10.0.0.2", prefix: 24, family: 4 });
assert.deepEqual(parseCidr("fd00::2"), { address: "fd00::2", prefix: 128, family: 6 });
assert.throws(() => parseCidr("10.0.0.300/24"), /isn't an IP address/);
assert.throws(() => parseCidr("10.0.0.1/33"), /between 0 and 32/);
assert.throws(() => parseCidr("10.0.0.1/8/8"), /isn't an IP address/);
assert.equal(parseEndpoint("vpn.example.com:51820"), "vpn.example.com:51820");
assert.equal(parseEndpoint("[2001:db8::1]:51820"), "[2001:db8::1]:51820");
assert.throws(() => parseEndpoint("vpn.example.com"), /host and port/);
assert.throws(() => parseEndpoint("vpn.example.com:70000"), /between 1 and 65535/);
cases++;

const wireguard = `
# Office tunnel
[Interface]
PrivateKey = ${PRIVATE}
Address = 10.8.0.2/24, fd08::2/64
DNS = 10.8.0.1, 2001:db8::53, corp.example.com
ListenPort = 51820
MTU = 1420
PostUp = iptables -A FORWARD -i %i -j ACCEPT
Table = off

[Peer]
PublicKey = ${PUBLIC}
PresharedKey = ${SHARED}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = vpn.example.com:51820
PersistentKeepalive = 25
`;
const parsed = parseWireGuardConfig(wireguard);
assert.equal(parsed.privateKey, PRIVATE);
assert.deepEqual(
  parsed.addresses.map((item) => `${item.address}/${item.prefix}`),
  ["10.8.0.2/24", "fd08::2/64"],
);
assert.deepEqual(parsed.dns, ["10.8.0.1", "2001:db8::53"]);
assert.deepEqual(parsed.dnsSearch, ["corp.example.com"]);
assert.equal(parsed.listenPort, 51820);
assert.equal(parsed.mtu, 1420);
assert.deepEqual(parsed.ignored, ["PostUp", "Table"]);
assert.deepEqual(parsed.peers, [
  {
    publicKey: PUBLIC,
    presharedKey: SHARED,
    allowedIps: ["0.0.0.0/0", "::/0"],
    endpoint: "vpn.example.com:51820",
    persistentKeepalive: 25,
  },
]);
cases++;

for (const [config, message] of [
  ["", /no \[Interface\]/],
  [`[Interface]\nAddress = 10.0.0.2/32\n[Peer]\nPublicKey = ${PUBLIC}`, /no PrivateKey/],
  [`[Interface]\nPrivateKey = ${PRIVATE}`, /no \[Peer\]/],
  [
    `[Interface]\nPrivateKey = ${PRIVATE}\n[Peer]\nAllowedIPs = 0.0.0.0/0`,
    /Peer 1 has no PublicKey/,
  ],
  [`[Interface]\nPrivateKey = nope\n[Peer]\nPublicKey = ${PUBLIC}`, /PrivateKey isn't/],
  [`PrivateKey = ${PRIVATE}`, /before \[Interface\]/],
  [
    `[Interface]\nPrivateKey = ${PRIVATE}\nBogus = 1\n[Peer]\nPublicKey = ${PUBLIC}`,
    /unknown setting Bogus/,
  ],
  [`[Interface]\n[Interface]`, /more than one/],
  [`[Wat]`, /unknown section/],
  [
    `[Interface]\nPrivateKey = ${PRIVATE}\nDNS = not an address!\n[Peer]\nPublicKey = ${PUBLIC}`,
    /DNS entry/,
  ],
] as const) {
  assert.throws(() => parseWireGuardConfig(config), message);
}
// Errors never quote the key material that was rejected.
try {
  parseWireGuardConfig(
    `[Interface]\nPrivateKey = secret-material-xyz\n[Peer]\nPublicKey = ${PUBLIC}`,
  );
  assert.fail("expected a failure");
} catch (error) {
  assert(!String(error).includes("secret-material-xyz"));
}
cases++;

assert.equal(wireGuardInterfaceName("Office VPN", new Set()), "wg-office-vp");
assert.equal(wireGuardInterfaceName("wg0", new Set()), "wg0");
assert.equal(wireGuardInterfaceName("wg0", new Set(["wg0"])), "wg01");
assert.equal(wireGuardInterfaceName("!!!", new Set()), "wg");
for (const name of ["a".repeat(40), "wg-very-long-name-here"])
  assert(Buffer.byteLength(wireGuardInterfaceName(name, new Set([name.slice(0, 12)]))) <= 15);
assert.equal(vpnNameFromFile("/home/j/Downloads/office.conf"), "office");
assert.equal(vpnKindFromFile("x.OVPN"), "openvpn");
assert.equal(vpnKindFromFile("x.conf"), "wireguard");
assert.equal(vpnKindFromFile("x.txt"), null);
cases++;

const PEM = (label: string) =>
  `-----BEGIN ${label}-----\nMIIBfixture${label.replace(/ /g, "")}\n-----END ${label}-----`;
const ovpn = `client
dev tun
proto udp
remote vpn1.example.com 1194
remote vpn2.example.com 443 tcp
resolv-retry infinite
nobind
persist-key
cipher AES-256-GCM
auth SHA256
remote-cert-tls server
verify-x509-name vpn.example.com name
auth-user-pass
comp-lzo
key-direction 1
route-nopull
<ca>
${PEM("CERTIFICATE")}
</ca>
<tls-auth>
${PEM("OpenVPN Static key V1")}
</tls-auth>
`;
const openvpn = parseOpenVpnConfig(ovpn);
assert.deepEqual(openvpn.remotes, [
  { host: "vpn1.example.com", port: 1194, proto: "udp" },
  { host: "vpn2.example.com", port: 443, proto: "tcp" },
]);
assert.equal(openvpn.devType, "tun");
assert.equal(openvpn.authUserPass, true);
assert.equal(openvpn.keyDirection, "1");
assert(openvpn.ca?.includes("BEGIN CERTIFICATE"));
assert(openvpn.tlsAuth?.includes("OpenVPN Static key"));
assert.equal(openvpn.cert, null);
assert.deepEqual(openvpn.options, {
  cipher: "AES-256-GCM",
  auth: "SHA256",
  "remote-cert-tls": "server",
  "verify-x509-name": "name:vpn.example.com",
  "comp-lzo": "adaptive",
});
assert.deepEqual(openvpn.ignored, ["route-nopull"]);
cases++;

const referenced = `client\nremote vpn.example.com\nca ca.crt\ncert "my client.crt"\nkey keys/client.key\ntls-auth ta.key 1\n`;
const reads: string[] = [];
const inlined = inlineOpenVpnFiles(referenced, (name) => {
  reads.push(name);
  return PEM(name.endsWith(".key") ? "PRIVATE KEY" : "CERTIFICATE");
});
assert.deepEqual(reads, ["ca.crt", "my client.crt", "keys/client.key", "ta.key"]);
const tls = parseOpenVpnConfig(inlined);
assert.equal(tls.authUserPass, false);
assert(tls.cert && tls.key && tls.tlsAuth);
assert.equal(tls.keyDirection, "1");
assert.deepEqual(tls.remotes, [{ host: "vpn.example.com", port: 1194, proto: "udp" }]);
cases++;

for (const [config, message] of [
  ["dev tun\n", /isn't an OpenVPN client profile/],
  ["client\n", /no remote/],
  ["client\nremote a.example.com\nauth-user-pass\n", /no CA certificate/],
  [`client\nremote a\nca ca.crt\n`, /wasn't included/],
  [`client\nremote a\n<ca>\n${PEM("CERTIFICATE")}\n</ca>\n`, /neither a client certificate/],
  [`client\nremote a\n<ca>\n${PEM("CERTIFICATE")}\n`, /isn't closed/],
  [`client\nremote a\n<ca>\nnot pem\n</ca>\nauth-user-pass\n`, /isn't PEM/],
  [`client\nremote a\nsecret static.key\n`, /Static-key/],
  [`client\nremote a\nproto sctp\n`, /isn't udp or tcp/],
  [`client\nremote a\nauth-user-pass creds.txt\n`, /with a file/],
  [
    `client\nremote a\n<ca>\n${PEM("CERTIFICATE")}\n</ca>\n<cert>\n${PEM("CERTIFICATE")}\n</cert>\n`,
    /certificate without its key/,
  ],
  [
    `client\nremote a\n<ca>\n${PEM("CERTIFICATE")}\n</ca>\n<cert>\n${PEM("CERTIFICATE")}\n</cert>\n<key>\n-----BEGIN ENCRYPTED PRIVATE KEY-----\nx\n-----END ENCRYPTED PRIVATE KEY-----\n</key>\n`,
    /Encrypted private keys/,
  ],
] as const)
  assert.throws(() => parseOpenVpnConfig(config), message);
cases++;

assert.deepEqual(parseHiddenWifiRequest({ ssid: "Attic", security: "open", password: "" }), {
  ssid: "Attic",
  security: "open",
  password: "",
});
assert.equal(
  parseHiddenWifiRequest({ ssid: "Attic", security: "wpa-psk", password: "correct horse" })
    .security,
  "wpa-psk",
);
assert.equal(
  parseHiddenWifiRequest({ ssid: "Attic", security: "sae", password: "a".repeat(100) }).security,
  "sae",
);
for (const [request, message] of [
  [{ ssid: "", security: "open", password: "" }, /network name/],
  [{ ssid: "  ", security: "open", password: "" }, /network name/],
  [{ ssid: "é".repeat(17), security: "open", password: "" }, /32 bytes/],
  [{ ssid: "Attic", security: "wep", password: "" }, /security/],
  [{ ssid: "Attic", security: "open", password: "x" }, /no password/],
  [{ ssid: "Attic", security: "wpa-psk", password: "short" }, /WPA passphrase/],
  [{ ssid: "Attic", security: "sae", password: "short" }, /WPA3/],
] as const)
  assert.throws(() => parseHiddenWifiRequest(request), message);
cases++;

assert(isValidPacUrl(""));
assert(isValidPacUrl("http://wpad.example.com/wpad.dat"));
assert(isValidPacUrl("file:///etc/proxy.pac"));
assert(!isValidPacUrl("ftp://example.com/x.pac"));
assert(!isValidPacUrl("not a url"));
assert.deepEqual(parseProxyRequest({ method: "none", pacUrl: "http://x" }), {
  method: "none",
  pacUrl: "",
});
assert.deepEqual(parseProxyRequest({ method: "auto", pacUrl: " http://x/p.pac " }), {
  method: "auto",
  pacUrl: "http://x/p.pac",
});
assert.throws(() => parseProxyRequest({ method: "manual", pacUrl: "" }), /proxy method/);
assert.throws(() => parseProxyRequest({ method: "auto", pacUrl: "gopher://x" }), /http, https/);
cases++;

const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
assert.equal(parseVpnId(id.toUpperCase()), id);
assert.throws(() => parseVpnId("/org/freedesktop/NetworkManager/Settings/1"), /VPN identity/);
const request = parseVpnImportRequest({
  kind: "wireguard",
  name: " Office ",
  config: wireguard,
  username: "",
  password: "",
});
assert.equal(request.name, "Office");
assert.throws(
  () => parseVpnImportRequest({ kind: "pptp", name: "x", config: "x" }),
  /Unsupported VPN/,
);
assert.throws(() => parseVpnImportRequest({ kind: "wireguard", name: "", config: "x" }), /name/);
assert.throws(
  () => parseVpnImportRequest({ kind: "wireguard", name: "x", config: "x".repeat(200_000) }),
  /too large/,
);
cases++;

const base = {
  kind: "ready",
  policy: "interactive",
  enabled: true,
  hardwareEnabled: true,
  canConnect: true,
  canScan: true,
  connectivity: "full",
  connection: { kind: "none" },
  accessPoints: [],
  operation: { kind: "idle" },
};
const full = parseDesktopWifi({
  ...base,
  wwan: { enabled: true, hardwareEnabled: false, canToggle: true },
  vpn: {
    connections: [{ id, name: "Office", kind: "wireguard", state: "connected" }],
    canManage: true,
    importable: ["wireguard", "openvpn"],
  },
  proxy: { connection: "Halcyon", method: "auto", pacUrl: "", canChange: true },
});
assert(full.kind === "ready" && full.vpn?.connections[0]?.state === "connected");
assert(full.kind === "ready" && full.proxy?.method === "auto");
const older = parseDesktopWifi(base);
assert(older.kind === "ready" && !("vpn" in older) && !("wwan" in older) && !("proxy" in older));
assert.throws(
  () =>
    parseDesktopWifi({
      ...base,
      policy: "readonly",
      canConnect: false,
      canScan: false,
      vpn: { connections: [], canManage: true, importable: [] },
    }),
  /Read-only/,
);
assert.throws(
  () =>
    parseDesktopWifi({
      ...base,
      vpn: {
        connections: [
          { id, name: "a", kind: "wireguard", state: "connected" },
          { id, name: "b", kind: "wireguard", state: "connected" },
        ],
        canManage: true,
        importable: [],
      },
    }),
  /Duplicate VPN/,
);
assert.throws(
  () =>
    parseDesktopWifi({
      ...base,
      proxy: { connection: "x", method: "manual", pacUrl: "", canChange: true },
    }),
  /proxy method/,
);
cases++;
// Ownership and the actions it allows: a shared profile's change goes to the user's own copy.
const owned = parseDesktopWifi({
  ...base,
  accessPoints: [
    {
      id: "/ap/1",
      ssid: "Halcyon",
      strength: 80,
      security: "wpa-psk",
      connected: false,
      saved: true,
      ownership: "system",
      canForget: false,
    },
  ],
  vpn: {
    connections: [
      {
        id,
        name: "Office",
        kind: "wireguard",
        state: "connected",
        ownership: "system",
        canRemove: false,
      },
    ],
    canManage: true,
    importable: [],
  },
  proxy: {
    connection: "Wired connection 1",
    method: "none",
    pacUrl: "",
    canChange: true,
    ownership: "system",
    copy: true,
    needsPassword: false,
  },
});
assert(owned.kind === "ready");
assert.equal(owned.accessPoints[0]?.ownership, "system");
assert.equal(owned.accessPoints[0]?.canForget, false);
assert.equal(owned.vpn?.connections[0]?.canRemove, false);
assert.equal(owned.proxy?.copy, true);
assert.equal(owned.proxy?.needsPassword, false);
assert.throws(
  () =>
    parseDesktopWifi({
      ...base,
      proxy: { connection: "x", method: "none", pacUrl: "", canChange: true, ownership: "root" },
    }),
  /ownership/,
);
assert.throws(
  () =>
    parseDesktopWifi({
      ...base,
      policy: "readonly",
      canConnect: false,
      canScan: false,
      proxy: { connection: "x", method: "none", pacUrl: "", canChange: false, copy: true },
    }),
  /Read-only/,
);
assert.deepEqual(parseProxyRequest({ method: "auto", pacUrl: "", password: "fixture-pass-12" }), {
  method: "auto",
  pacUrl: "",
  password: "fixture-pass-12",
});
assert.deepEqual(parseProxyRequest({ method: "none", pacUrl: "", password: "" }), {
  method: "none",
  pacUrl: "",
});
assert.throws(() => parseProxyRequest({ method: "none", pacUrl: "", password: 7 }), /password/);
cases++;

console.log(`[vpn-config] ${cases} groups passed`);
