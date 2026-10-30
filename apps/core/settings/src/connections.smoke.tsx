/**
 * The connection gaps closed on Wi‑Fi & Network, Bluetooth and Keyboard & Mouse: airplane mode,
 * joining a hidden network, VPN connect/disconnect/remove and import from a file, the proxy
 * (NetworkManager's automatic and Moire's manual), Bluetooth device kinds, battery and rename,
 * and the touchpad rows. `SETTINGS_PNG_DIR` saves the pages and sheets.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadSettings, updateSettings } from "@moire/prefs";
import { withFixture } from "@moire/app-tools/testing";
import { setUiScaleFactor } from "@moire/ui";
import { createFakeInputSettings } from "@moire/system-management/input-settings";
import { readVpnFile } from "./pages/network-backend";
import {
  networkSummary,
  proxyMode,
  proxySummary,
  vpnDetail,
  wiredTile,
} from "./pages/network-model";
import { deviceDetail, deviceIcon } from "./pages/bluetooth-model";
import { desktopSnapshot, settingsFixture, wiredOnlySnapshot } from "./testing";
import { mountSettings, overflow } from "./testing-ui";

const pictures = process.env.SETTINGS_PNG_DIR;
type App = Awaited<ReturnType<typeof mountSettings>>;
const shot = (app: App, name: string) => {
  if (pictures) app.screenshot(path.join(pictures, `${name}.png`));
};
const OFFICE = "6f1f8a3c-1111-4c3a-9a00-000000000001",
  HOME_VPN = "6f1f8a3c-1111-4c3a-9a00-000000000002";
const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");
const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfixture\n-----END CERTIFICATE-----";

// ---- Models.
{
  assert.equal(
    vpnDetail({ id: OFFICE, name: "Office", kind: "wireguard", state: "connected" }),
    "WireGuard · Connected",
  );
  const manualOff = { enabled: false, http: "", https: "", ignore: "" };
  assert.equal(proxyMode(undefined, manualOff), "none");
  assert.equal(
    proxySummary({ connection: "Halcyon", method: "auto", pacUrl: "", canChange: true }, manualOff),
    "Automatic (WPAD)",
  );
  assert.equal(
    proxyMode(
      { connection: "Halcyon", method: "auto", pacUrl: "", canChange: true },
      { ...manualOff, enabled: true, http: "p:3128" },
    ),
    "manual",
    "Moire's manual proxy wins",
  );
  const device = {
    id: "dev" as never,
    adapterId: "hci" as never,
    name: "MX",
    address: "00:00:00:00:00:00",
    paired: true as const,
    trusted: true,
    connected: true,
  };
  assert.equal(deviceIcon({ kind: "mouse" }), "mouse");
  assert.equal(deviceIcon({}), "bluetooth", "older services send no kind");
  assert.equal(deviceDetail({ ...device, battery: 12 }, false), "Connected · battery 12% · low");
  assert.equal(deviceDetail({ ...device, battery: 80 }, false), "Connected · battery 80%");
}

await withFixture(async (home) => {
  const shows = async (app: App, text: string) =>
    app.until(
      () => app.texts().includes(text),
      `Missing “${text}”: ${app.texts().slice(0, 120).join(" | ")}`,
    );
  setUiScaleFactor(1);

  // ---- Reading VPN files: WireGuard as is, OpenVPN with its files inlined, refusals.
  const downloads = path.join(home, "Downloads");
  fs.mkdirSync(path.join(downloads, "keys"), { recursive: true });
  const wireguard = path.join(downloads, "lab.conf");
  fs.writeFileSync(
    wireguard,
    `[Interface]\nPrivateKey = ${key(1)}\nAddress = 10.9.0.2/32\nPostUp = true\n[Peer]\nPublicKey = ${key(2)}\nAllowedIPs = 0.0.0.0/0\nEndpoint = lab.example.com:51820\n`,
  );
  fs.writeFileSync(path.join(downloads, "keys", "ca.crt"), PEM);
  const openvpn = path.join(downloads, "home.ovpn");
  fs.writeFileSync(
    openvpn,
    "client\ndev tun\nremote vpn.example.com 1194\nauth-user-pass\nca keys/ca.crt\n",
  );
  const lab = readVpnFile(wireguard);
  assert(lab.kind === "wireguard" && lab.name === "lab" && !lab.needsCredentials);
  assert.deepEqual(lab.ignored, ["PostUp"]);
  const homeVpn = readVpnFile(openvpn);
  assert(homeVpn.kind === "openvpn" && homeVpn.needsCredentials);
  assert(homeVpn.config.includes("<ca>") && homeVpn.config.includes("MIIBfixture"));
  fs.writeFileSync(path.join(downloads, "broken.ovpn"), "client\nremote x\nca missing.crt\n");
  const broken = readVpnFile(path.join(downloads, "broken.ovpn"));
  assert(broken.kind === "error" && /ENOENT|no such file/i.test(broken.message), broken.kind);
  fs.writeFileSync(path.join(downloads, "notes.txt"), "hello");
  assert.equal(readVpnFile(path.join(downloads, "notes.txt")).kind, "error");

  // ---- Wi‑Fi & Network: airplane mode, the hidden network, VPN rows, the proxy.
  {
    const fixture = settingsFixture(loadSettings(), { page: "network" });
    const app = await mountSettings(fixture, { width: 1020, height: 1500 });
    await shows(app, "Airplane mode");
    await shows(app, "Join another network…");
    await shows(app, "Office");
    await shows(app, "WireGuard · Connected");
    await shows(app, "OpenVPN · Not connected");
    await shows(app, "Proxy");
    app.press({ focusId: "setting:network.airplane" });
    await app.until(
      () => fixture.desktop.calls.includes("setAirplaneMode:true"),
      "airplane mode switch",
    );
    await shows(app, "On · Wi‑Fi, mobile broadband and Bluetooth are off");
    app.press({ focusId: "setting:network.airplane" });
    await app.until(
      () => fixture.desktop.calls.includes("setAirplaneMode:false"),
      "airplane mode back off",
    );

    // Join another network: name, security, password.
    app.press({ focusId: "setting:network.hidden" });
    await shows(app, "Join another network");
    app.press({ focusId: "network:hidden:ssid" });
    app.type("Attic");
    app.press({ focusId: "network:hidden:password" });
    app.type("short");
    app.press({ focusId: "network:hidden:join" });
    await shows(app, "Enter a valid WPA passphrase or hexadecimal key");
    assert(!fixture.desktop.calls.some((call) => call.startsWith("connectHiddenWifi")));
    app.press({ focusId: "network:hidden:password" });
    app.key(107, "End");
    for (let index = 0; index < 5; index++) app.key(14, "Backspace");
    app.type("short-but-long-enough");
    app.press({ focusId: "network:hidden:join" });
    await app.until(
      () =>
        fixture.desktop.calls.includes(
          'connectHiddenWifi:{"ssid":"Attic","security":"wpa-psk","password":"short-but-long-enough"}',
        ),
      `hidden network joined: ${fixture.desktop.calls.join(" ")}`,
    );

    // VPN: disconnect the connected one, connect the other, remove it from its sheet.
    app.press({ focusId: `network:vpn:${OFFICE}:disconnect` });
    await app.until(
      () => fixture.desktop.calls.includes(`deactivateVpn:${OFFICE}`),
      "VPN disconnect",
    );
    app.press({ focusId: `network:vpn:${HOME_VPN}:connect` });
    await app.until(() => fixture.desktop.calls.includes(`activateVpn:${HOME_VPN}`), "VPN connect");
    app.press({ focusId: `network:vpn:${HOME_VPN}` });
    await shows(app, "Remove this VPN");
    app.press({ focusId: "network:vpn:remove" });
    await app.until(() => fixture.desktop.calls.includes(`removeVpn:${HOME_VPN}`), "VPN remove");

    // Add a VPN from a file: the chooser, then a sheet asking for the OpenVPN password.
    app.press({ focusId: "network:vpn:add-file" });
    await shows(app, "Choose a WireGuard or OpenVPN configuration");
    app.press({ text: "Downloads" });
    await shows(app, "home.ovpn");
    app.press({ text: "home.ovpn" });
    app.press({ text: "Open" });
    await shows(app, "Add OpenVPN connection");
    await shows(app, "User name");
    shot(app, "network-vpn-import-dark-1020x1500");
    app.press({ focusId: "network:vpn:username" });
    app.type("josh");
    app.press({ focusId: "network:vpn:password" });
    app.type("pw");
    app.press({ focusId: "network:vpn:add" });
    await app.until(
      () => fixture.desktop.calls.some((call) => call.startsWith("importVpn:")),
      "VPN import",
    );
    const imported = JSON.parse(
      fixture.desktop.calls.find((call) => call.startsWith("importVpn:"))!.slice(10),
    ) as Record<string, string>;
    assert.equal(imported.kind, "openvpn");
    assert.equal(imported.name, "home");
    assert.equal(imported.username, "josh");
    assert.equal(imported.password, "pw");
    assert(imported.config!.includes("<ca>"), "referenced files are inlined");
    await shows(app, "home");

    // The proxy: Automatic goes to NetworkManager, Manual to Moire's prefs.
    app.press({ focusId: "setting:network.proxy" });
    await shows(app, "Off");
    app.press({ text: "Automatic" });
    app.press({ focusId: "network:proxy:pac" });
    app.type("http://wpad.example/wpad.dat");
    app.press({ focusId: "network:proxy:save" });
    await app.until(
      () =>
        fixture.desktop.calls.includes(
          'setProxy:{"method":"auto","pacUrl":"http://wpad.example/wpad.dat"}',
        ),
      `automatic proxy: ${fixture.desktop.calls.join(" ")}`,
    );
    app.press({ focusId: "setting:network.proxy" });
    await shows(app, "Automatic · http://wpad.example/wpad.dat");
    app.press({ text: "Manual" });
    app.press({ focusId: "network:proxy:http" });
    app.type("nope");
    app.press({ focusId: "network:proxy:save" });
    await shows(app, "Enter the HTTP proxy as host:port");
    shot(app, "network-proxy-manual-dark-1020x1500");
    app.press({ focusId: "network:proxy:http" });
    app.key(107, "End");
    for (let index = 0; index < 4; index++) app.key(14, "Backspace");
    app.type("proxy.example.com:3128");
    app.press({ focusId: "network:proxy:save" });
    await app.until(() => loadSettings().proxy.enabled, "manual proxy saved");
    assert.equal(loadSettings().proxy.http, "proxy.example.com:3128");
    await app.until(
      () => fixture.desktop.calls.includes('setProxy:{"method":"none","pacUrl":""}'),
      "NetworkManager's automatic proxy cleared for the manual one",
    );
    await shows(app, "Manual · proxy.example.com:3128");
    app.destroy();
    updateSettings({ proxy: { enabled: false, http: "", https: "", ignore: "" } });
  }

  // ---- Shared connections: a proxy change is saved to the user's own copy (asking for the
  // Wi‑Fi password the shared profile won't give up), and a network saved for everyone is
  // explained rather than offered to Forget.
  {
    const fixture = settingsFixture(loadSettings(), { page: "network" });
    const base = desktopSnapshot().wifi;
    assert(base.kind === "ready");
    fixture.desktop.set({
      wifi: {
        ...base,
        accessPoints: base.accessPoints.map((point) =>
          point.id === "/ap/1" ? { ...point, ownership: "system", canForget: false } : point,
        ),
        proxy: {
          connection: "Halcyon",
          method: "none",
          pacUrl: "",
          canChange: true,
          ownership: "system",
          copy: true,
          needsPassword: true,
        },
      },
    });
    const app = await mountSettings(fixture, { width: 1020, height: 1500 });
    await shows(app, "For Halcyon · applies to you only");
    app.press({ focusId: "setting:network.proxy" });
    await shows(app, "Off");
    app.press({ text: "Automatic" });
    await app.until(
      () => app.texts().some((text) => text.startsWith("Applies to you only: Halcyon is shared")),
      "copy hint in the proxy sheet",
    );
    await shows(app, "Wi‑Fi password for Halcyon");
    assert.deepEqual(overflow(app, 1020, 1500), [], "proxy sheet with the password field");
    shot(app, "network-proxy-copy-dark-1020x1500");
    app.press({ focusId: "network:proxy:save" });
    await shows(app, "Enter the Wi‑Fi password for Halcyon");
    assert(!fixture.desktop.calls.some((call) => call.startsWith("setProxy")));
    app.press({ focusId: "network:proxy:password" });
    app.type("fixture-pass-12");
    app.press({ focusId: "network:proxy:save" });
    await app.until(
      () =>
        fixture.desktop.calls.includes(
          'setProxy:{"method":"auto","pacUrl":"","password":"fixture-pass-12"}',
        ),
      `proxy copy: ${fixture.desktop.calls.join(" ")}`,
    );
    // Now on the user's copy: changes are their own, with no hint and no password.
    await shows(app, "For Halcyon");
    assert(!app.texts().includes("For Halcyon · applies to you only"));
    assert(!app.texts().some((text) => text.includes("fixture-pass-12")));

    // Saved for everyone: no Forget, an explanation instead.
    app.press({ focusId: "network:/ap/1:details" });
    await shows(app, "Saved for everyone on this computer");
    await shows(app, "Ask an administrator to remove it");
    assert(!app.texts().includes("Forget"), "Forget isn't offered for a shared network");
    shot(app, "network-details-shared-dark-1020x1500");
    app.destroy();
    // With the user's own copy beside it, Forget removes just that.
    const second = settingsFixture(loadSettings(), { page: "network" });
    second.desktop.set({
      wifi: {
        ...base,
        accessPoints: base.accessPoints.map((point) =>
          point.id === "/ap/1" ? { ...point, ownership: "system", canForget: true } : point,
        ),
      },
    });
    const copy = await mountSettings(second, { width: 1020, height: 1500 });
    copy.press({ focusId: "network:/ap/1:details" });
    await shows(copy, "Forget your copy");
    await shows(copy, "The shared one stays saved");
    copy.press({ focusId: "network:forget" });
    await copy.until(() => second.desktop.calls.includes("forgetWifi:/ap/1"), "Forget the copy");
    copy.destroy();
    // A VPN shared by everyone can't be removed here.
    const third = settingsFixture(loadSettings(), { page: "network" });
    third.desktop.set({
      wifi: {
        ...base,
        vpn: {
          ...base.vpn!,
          connections: base.vpn!.connections.map((vpn) =>
            vpn.id === OFFICE ? { ...vpn, ownership: "system", canRemove: false } : vpn,
          ),
        },
      },
    });
    const vpnApp = await mountSettings(third, { width: 1020, height: 1500 });
    vpnApp.press({ focusId: `network:vpn:${OFFICE}` });
    await shows(vpnApp, "Shared with everyone on this computer");
    assert(!vpnApp.texts().includes("Remove this VPN"));
    vpnApp.destroy();
  }

  // ---- Bluetooth: kinds, battery and rename.
  {
    const fixture = settingsFixture(loadSettings(), { page: "bluetooth" });
    const app = await mountSettings(fixture, { width: 1020, height: 975 });
    await shows(app, "Connected · battery 12% · low");
    await shows(app, "Connected · battery 64%");
    app.press({ focusId: "bluetooth:dev_mouse" });
    await shows(app, "Mouse");
    await shows(app, "12% · low");
    app.press({ focusId: "bluetooth:rename" });
    await shows(app, "Rename MX Master 3S");
    app.press({ focusId: "bluetooth:rename:name" });
    app.key(107, "End");
    for (let index = 0; index < 20; index++) app.key(14, "Backspace");
    app.type("x".repeat(65));
    app.press({ focusId: "bluetooth:rename:save" });
    await shows(app, "Enter a name of 1 to 64 characters");
    app.press({ focusId: "bluetooth:rename:name" });
    app.key(107, "End");
    for (let index = 0; index < 65; index++) app.key(14, "Backspace");
    app.type("Desk mouse");
    app.press({ focusId: "bluetooth:rename:save" });
    await app.until(
      () => fixture.desktop.calls.some((call) => call.includes('"name":"Desk mouse"')),
      `rename: ${fixture.desktop.calls.join(" ")} ${app.texts().slice(0, 60).join(" | ")}`,
    );
    await shows(app, "Desk mouse");
    app.destroy();
  }

  // ---- Keyboard & Mouse: touchpad rows only with a touchpad; clicking only on a clickpad.
  {
    const fixture = settingsFixture(loadSettings(), { page: "keyboard" });
    const app = await mountSettings(fixture, { width: 1020, height: 1600 });
    const pointer = () => fixture.props.services.input!.state.pointer;
    await shows(app, "Touchpad");
    await shows(app, "Tap to click");
    await shows(app, "Clicking");
    shot(app, "keyboard-touchpad-dark-1020x1600");
    app.press({ focusId: "setting:keyboard.tap-to-click" });
    await app.until(() => pointer().tapToClick === false, "tap to click off");
    app.press({ text: "Edge" });
    await app.until(() => pointer().scrollMethod === "edge", "edge scrolling");
    await app.until(
      () => !app.texts().includes("Kinetic scrolling"),
      "kinetic only for two-finger",
    );
    app.press({ text: "Corners" });
    await app.until(() => pointer().clickMethod === "areas", "click areas");
    app.press({ focusId: "setting:keyboard.disable-while-typing" });
    await app.until(() => !pointer().disableWhileTyping, "DWT off");
    app.destroy();
    const mouseOnly = settingsFixture(loadSettings(), {
      page: "keyboard",
      services: {
        input: createFakeInputSettings({
          pointerDevices: [{ name: "Virtual tablet", kind: "mouse", clickpad: false }],
        }),
      },
    });
    const plain = await mountSettings(mouseOnly, { width: 1020, height: 1600 });
    await shows(plain, "Mouse and pointer");
    assert(!plain.texts().includes("Tap to click"), "no touchpad, no touchpad rows");
    plain.destroy();
  }

  // ---- No Wi‑Fi hardware (a wired-only computer, like the VM): the page leads with the cable,
  // with no Wi‑Fi switch, network list or airplane mode, and Overview's tile reads "Network".
  {
    const wired = wiredOnlySnapshot();
    assert(wired.wifi.kind === "ready" && wired.wifi.enabled, "the radio switch still reads on");
    assert.equal(
      networkSummary(wired.wifi, wired.network),
      "Wired: Wired connection 1 · 192.168.64.43",
    );
    assert.deepEqual(wiredTile(wired.wifi, wired.network), {
      value: "Wired connected",
      detail: "192.168.64.43",
    });
    assert.deepEqual(wiredTile(wired.wifi, []), {
      value: "Not connected",
      detail: "No Wi‑Fi adapter or cable",
    });
    // Older services send no device count; they keep the Wi‑Fi page.
    const { adapters: _adapters, ...older } = wired.wifi;
    assert.equal(networkSummary(older, wired.network), "Wi‑Fi not connected · Wired: enp0s1");

    const fixture = settingsFixture(loadSettings(), { page: "network", desktop: wired });
    const app = await mountSettings(fixture, { width: 1020, height: 975 });
    await shows(app, "Wired connection 1");
    await shows(app, "Connected · 192.168.64.43 · internet access");
    await shows(app, "Wired: Wired connection 1 · 192.168.64.43");
    await shows(app, "Ethernet");
    await shows(app, "No Wi‑Fi adapter");
    await shows(app, "VPN");
    await shows(app, "Proxy");
    const texts = app.texts();
    for (const absent of [
      "On · not connected",
      "No networks in range",
      "Networks",
      "Airplane mode",
      "Join another network…",
    ])
      assert(!texts.includes(absent), `no Wi‑Fi hardware, no “${absent}”`);
    const hits = (app.window as unknown as { hits: { focusId?: string }[] }).hits;
    assert(!hits.some((hit) => hit.focusId === "setting:network.wifi"), "no Wi‑Fi switch");
    shot(app, "network-no-wifi-dark-1020x975");
    app.destroy();

    const overview = await mountSettings(
      settingsFixture(loadSettings(), { page: "overview", desktop: wiredOnlySnapshot() }),
      { width: 1020, height: 975 },
    );
    await shows(overview, "Wired connected");
    await shows(overview, "192.168.64.43");
    const tiles = overview.texts();
    assert(tiles.includes("Network"), "the tile is titled Network");
    assert(!tiles.includes("0 networks in range"), "no Wi‑Fi tile");
    shot(overview, "overview-no-wifi-dark-1020x975");
    overview.destroy();

    for (const [width, height, scale] of [
      [640, 650, 1],
      [1020, 975, 1.5],
    ] as const) {
      setUiScaleFactor(scale);
      for (const page of ["network", "overview"]) {
        const small = await mountSettings(
          settingsFixture(loadSettings(), { page, desktop: wiredOnlySnapshot() }),
          { width, height },
        );
        await small.settle(4);
        const suffix = `${width}x${height}${scale === 1 ? "" : "-scale1.5"}`;
        assert.deepEqual(overflow(small, width, height), [], `${page} no Wi‑Fi ${suffix}`);
        shot(small, `${page}-no-wifi-dark-${suffix}`);
        small.destroy();
      }
    }
    setUiScaleFactor(1);
  }

  // ---- Pictures and overflow at the gallery's sizes.
  for (const [width, height, scale] of [
    [1020, 975, 1.5],
    [640, 650, 1],
    [1020, 975, 1],
  ] as const) {
    setUiScaleFactor(scale);
    const suffix = `${width}x${height}${scale === 1 ? "" : "-scale1.5"}`;
    for (const page of ["network", "bluetooth", "keyboard"] as const) {
      const app = await mountSettings(settingsFixture(loadSettings(), { page }), {
        width,
        height,
      });
      await app.settle(4);
      assert.deepEqual(overflow(app, width, height), [], `${page} ${suffix}`);
      shot(app, `${page}-dark-${suffix}`);
      app.destroy();
    }
    const sheets: [string, string, string, string][] = [
      ["network", "setting:network.hidden", "network-hidden", "Join another network"],
      ["network", "setting:network.proxy", "network-proxy", "Automatic"],
      ["network", `network:vpn:${OFFICE}`, "network-vpn", "Remove this VPN"],
      ["bluetooth", "bluetooth:dev_mouse", "bluetooth-device", "Rename"],
    ];
    // Tall enough that every row is on screen to press; the sheet spans the full height.
    const tall = Math.max(height, 1500);
    for (const [page, focusId, name, title] of sheets) {
      const app = await mountSettings(settingsFixture(loadSettings(), { page }), {
        width,
        height: tall,
      });
      await app.settle(2);
      app.press({ focusId });
      await shows(app, title);
      assert.deepEqual(overflow(app, width, tall), [], `${name} ${suffix}`);
      shot(app, `${name}-dark-${width}x${tall}${scale === 1 ? "" : "-scale1.5"}`);
      app.destroy();
    }
  }
  setUiScaleFactor(1);
});
console.log(
  "[settings/connections] airplane mode, hidden network, VPN rows/import, proxy, shared-connection copy/forget, Bluetooth kind/battery/rename, touchpad rows and the no-Wi‑Fi-hardware page/overview passed",
);
