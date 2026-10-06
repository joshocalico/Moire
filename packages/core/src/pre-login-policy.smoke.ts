import assert from "node:assert/strict";
import { CompositorServer } from "./server";

const server = new CompositorServer("/tmp/moire-pre-login-policy", "greeter", {
  mode: "greeter",
  clientPid: process.pid,
  devices: {
    open() {
      throw new Error("Policy test must acquire no devices");
    },
    close() {
      throw new Error("Policy test owns no descriptors");
    },
  },
});
const globals = new Set(server.getGlobals().map((global) => global.iface));
assert.ok(globals.has("wl_seat"));
assert.ok(globals.has("wl_shm"));
assert.ok(globals.has("xdg_wm_base"));
for (const forbidden of [
  "wl_data_device_manager",
  "zwp_primary_selection_device_manager_v1",
  "xwayland_shell_v1",
  "wl_drm",
  "zwp_linux_dmabuf_v1",
  "xdg_activation_v1",
])
  assert.equal(globals.has(forbidden), false, `${forbidden} is unavailable before login`);
console.log("ok greeter protocol boundary excludes clipboard, Xwayland, dmabuf and app activation");
