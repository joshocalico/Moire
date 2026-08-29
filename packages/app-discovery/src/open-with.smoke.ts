import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileActivationService } from "./open-with";
import type { DesktopEntry } from "./desktop";

const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_CONFIG_DIRS: process.env.XDG_CONFIG_DIRS,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_DATA_DIRS: process.env.XDG_DATA_DIRS,
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), "moire-open-with-"));
try {
  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = path.join(root, "config");
  process.env.XDG_CONFIG_DIRS = path.join(root, "config-system");
  process.env.XDG_DATA_HOME = path.join(root, "data");
  process.env.XDG_DATA_DIRS = path.join(root, "data-system");

  const apps: DesktopEntry[] = [
    {
      id: "editor.desktop",
      name: "Editor",
      comment: "Edit plain text",
      exec: "editor",
      execTemplate: "editor %f",
      terminal: false,
      categories: [],
      mimeTypes: ["text/plain"],
    },
    {
      id: "editor.desktop",
      name: "Duplicate Editor",
      exec: "duplicate-editor",
      terminal: false,
      categories: [],
      mimeTypes: ["text/plain"],
    },
    {
      id: "writer.desktop",
      name: "Writer",
      comment: "Write documents",
      exec: "writer",
      execTemplate: "writer %f",
      terminal: false,
      categories: [],
    },
  ];
  const launches: string[] = [];
  const service = new FileActivationService(({ command }) => launches.push(command), apps);
  const filePath = path.join(root, "Notes.txt");
  const initial = service.openWithModel(filePath);
  assert.equal(initial.mimeType, "text/plain");
  assert.deepEqual(
    initial.choices.map(({ id }) => id),
    ["editor.desktop", "writer.desktop"],
    "activation service did not normalize duplicate desktop ids",
  );
  assert.equal(initial.choices[0]?.recommended, true);
  assert.equal(initial.choices[1]?.recommended, false);
  assert.equal(initial.selectedId, "editor.desktop");

  service.openWith(filePath, "writer", true);
  assert.match(launches[0] ?? "", /^writer /);
  const updated = service.openWithModel(filePath);
  assert.equal(
    updated.choices.find(({ id }) => id === "writer.desktop")?.isDefault,
    true,
    "Always Use did not update the canonical model",
  );
  console.log("[app-discovery/open-with-smoke] ok");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
