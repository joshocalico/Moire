import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findConnectedCard, renderNodeForCard } from "./drm";

const sysfs = fs.mkdtempSync(path.join(os.tmpdir(), "moire-drm-"));
const connector = (name: string, status?: string) => {
  fs.mkdirSync(path.join(sysfs, name));
  if (status) fs.writeFileSync(path.join(sysfs, name, "status"), `${status}\n`);
};
try {
  connector("card0");
  connector("renderD128");
  connector("version");
  assert.equal(findConnectedCard(sysfs), null, "no connectors");
  connector("card0-HDMI-A-1", "disconnected");
  connector("card1-eDP-1");
  assert.equal(findConnectedCard(sysfs), null, "a connector without status is skipped");
  connector("card1-DP-2", "connected");
  assert.equal(findConnectedCard(sysfs), "/dev/dri/card1");
  assert.equal(renderNodeForCard("/dev/dri/card1", sysfs), null, "no device directory");
  fs.mkdirSync(path.join(sysfs, "card1", "device", "drm", "card1"), { recursive: true });
  assert.equal(renderNodeForCard("/dev/dri/card1", sysfs), null, "a GPU without a render node");
  fs.mkdirSync(path.join(sysfs, "card1", "device", "drm", "renderD129"));
  assert.equal(renderNodeForCard("/dev/dri/card1", sysfs), "/dev/dri/renderD129");
} finally {
  fs.rmSync(sysfs, { recursive: true });
}
console.log("drm smoke passed");
