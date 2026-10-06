import assert from "node:assert/strict";
import { once } from "node:events";
import { OwnedDesktopApps } from "./owned-apps";

async function main() {
  const apps = new OwnedDesktopApps();
  const quote = (value: string) => JSON.stringify(value);
  const child = apps.spawn({
    exec: `${quote(process.execPath)} -e ${quote("setInterval(() => {}, 1000)")}`,
  });
  await once(child, "spawn");
  const first = apps.stop();
  assert.equal(apps.stop(), first);
  await first;
  assert.equal(child.signalCode, "SIGTERM");
  assert.throws(() => apps.spawn({ exec: process.execPath }), /logging out/);
  console.log(
    "Owned apps: real process group TERM, repeated stop and no launch during logout passed.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
