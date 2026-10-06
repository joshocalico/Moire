/** Reproduce actual shell traversal independently of QEMU's input producer. */
import assert from "node:assert/strict";
import { installUiFonts } from "@moire/ui";
import { createShell } from "./controller";

await installUiFonts();
let logouts = 0;
const shell = createShell(
  () => ({}),
  () => {},
  undefined,
  undefined,
  () => {
    logouts++;
  },
);
shell.setPrimaryOutput({ x: 0, y: 0, width: 1280, height: 800 });
shell.setDesktopStatus({ kind: "unavailable", message: "No management service" });
const paint = () => shell.chromeRaster(1280, 800);
const edge = (code: number, value: number) => {
  shell.onKey({ code, value });
  paint();
};
const key = (code: number) => {
  edge(code, 1);
  edge(code, 0);
};
paint();
edge(125, 1);
key(16);
edge(125, 0);
edge(42, 1);
key(15);
edge(42, 0);
key(28);
key(15);
key(28);
assert.equal(logouts, 1, "Super+Q → Shift+Tab → Enter → Tab → Enter dispatches logout");
console.log("Actual shell keyboard logout traversal passed; no native input/output claim.");
