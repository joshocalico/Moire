import assert from "node:assert/strict";
import React from "react";
import { createShellRoot, renderShell, SoftwareRenderer, type SceneNode } from "@moire/react-host";
import { Icon, ICON_NAMES } from "@moire/ui";
import type { DesktopWifi } from "@moire/system-management/network-status";
import { networkPresentation, unavailableNetworkPresentation } from "./network-presentation";
const wired = { name: "eth0", transport: "wired" as const, addresses: ["192.0.2.3"] };
const wifi = { name: "wlan0", transport: "wifi" as const, addresses: ["198.51.100.7"] };
assert.equal(networkPresentation([wired]).label, "Wired network");
assert.equal(networkPresentation([wifi]).label, "Wi-Fi");
assert.equal(networkPresentation([wired, wifi]).transport, "mixed");
assert.equal(networkPresentation([]).label, "Network");
const observed: Extract<DesktopWifi, { kind: "ready" }> = {
  kind: "ready",
  policy: "readonly",
  enabled: true,
  hardwareEnabled: true,
  canConnect: false,
  canScan: false,
  connectivity: "portal",
  connection: { kind: "active", transport: "wifi", name: "Observed SSID" },
  accessPoints: [],
  operation: { kind: "idle" },
};
const current = networkPresentation([wired], observed);
assert.equal(current.label, "Observed SSID");
assert.equal(
  current.transport,
  "wifi",
  "actual active link overrides unrelated local wired address",
);
assert.equal(current.detail, "Sign-in required for Internet access");
assert.equal(
  networkPresentation([wired], { ...observed, connectivity: "full" }).detail,
  "Internet connected",
);
assert.equal(
  networkPresentation([wired]).detail,
  "Internet status unavailable",
  "an address never implies Internet",
);
assert.deepEqual(
  unavailableNetworkPresentation(current),
  { transport: "wifi", label: "Wi-Fi", icon: "network", detail: "Internet status unavailable" },
  "owner loss retains artwork only, never stale SSID/Internet claim",
);
const renderer = new SoftwareRenderer();
const descendants = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(descendants)];
const frames = new Map<string, Uint8Array>();
for (const name of ["ethernet", "network", "network-globe"] as const) {
  assert(ICON_NAMES.includes(name), "transport artwork belongs to the shared family");
  const root = createShellRoot();
  renderShell(root, <Icon name={name} size={24} color={0xffeeeeee} />);
  assert(
    descendants(root.container).some((node) => node.kind === "image"),
    `${name} must use actual supported SVG, not the generic fallback`,
  );
  frames.set(name, renderer.render(root.container, { width: 24, height: 24 }).pixels.slice());
  renderShell(root, null);
}
assert.notDeepEqual(
  frames.get("ethernet"),
  frames.get("network"),
  "wired and Wi-Fi artwork is visibly distinct",
);
assert.notDeepEqual(frames.get("network-globe"), frames.get("network"));
console.log(
  "[network-presentation] actual local transport labels and three distinct shared SVG images passed; no Internet/SSID/native link claim",
);
