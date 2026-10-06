import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { bootRendererEnvironment } from "./main";

const original = { ...process.env, NOTIFY_SOCKET: "@guardian-only", MOIRE_BOOT_CARD: "/old" };
const environment = bootRendererEnvironment(original, "/dev/dri/card-fixture");
assert.equal(original.NOTIFY_SOCKET, "@guardian-only");
assert.equal(original.MOIRE_BOOT_CARD, "/old");
assert.equal(environment.NOTIFY_SOCKET, undefined);
const child = spawnSync(
  process.execPath,
  [
    "-e",
    "console.log(JSON.stringify({notify:process.env.NOTIFY_SOCKET ?? null,card:process.env.MOIRE_BOOT_CARD}))",
  ],
  {
    env: environment,
    encoding: "utf8",
    timeout: 5000,
  },
);
assert.equal(child.error, undefined);
assert.equal(child.status, 0);
assert.deepEqual(JSON.parse(child.stdout), { notify: null, card: "/dev/dri/card-fixture" });
console.log("boot renderer actual child environment excludes guardian readiness socket PASS");
