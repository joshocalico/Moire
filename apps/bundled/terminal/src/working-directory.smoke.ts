/** Launch arguments: `--working-directory` (Files' "Open in Terminal") picks the shell's folder. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workingDirectory } from "./main";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "terminal cwd "));
try {
  assert.equal(workingDirectory(["--working-directory", folder]), folder);
  assert.equal(workingDirectory([`--working-directory=${folder}`]), folder);
  assert.equal(workingDirectory(["--command", "htop", "--working-directory", folder]), folder);
  // Relative paths resolve against the launcher's folder.
  assert.equal(
    workingDirectory(["--working-directory", path.relative(process.cwd(), folder)]),
    folder,
  );
  // Missing folders and files fall back to Home (undefined) instead of failing to start.
  assert.equal(workingDirectory(["--working-directory", path.join(folder, "gone")]), undefined);
  const file = path.join(folder, "file.txt");
  fs.writeFileSync(file, "x");
  assert.equal(workingDirectory(["--working-directory", file]), undefined);
  assert.equal(workingDirectory([]), undefined);
  const locked = path.join(folder, "locked");
  fs.mkdirSync(locked, { mode: 0 });
  if (process.getuid?.() !== 0)
    assert.equal(workingDirectory(["--working-directory", locked]), undefined, "unenterable");
  fs.chmodSync(locked, 0o755);
  console.log("terminal: --working-directory ok");
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}
