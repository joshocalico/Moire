/**
 * "Open in Terminal": offered on folders and the folder background only when a terminal is
 * installed, and on an unreadable folder's empty state; it starts the terminal in that folder
 * (Moire's Terminal with `--working-directory`). A fake terminal records how it was started.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { entryId, openFiles, withHome } from "./harness";

const previousDataDirs = process.env.XDG_DATA_DIRS;

await withHome(async (home) => {
  // Only the fixture's applications count, whatever this machine has installed.
  process.env.XDG_DATA_DIRS = path.join(home, "no-system-data");
  const work = path.join(home, "Work");
  const projects = path.join(work, "Projects");
  const locked = path.join(work, "Locked");
  await fs.mkdir(projects, { recursive: true });
  await fs.mkdir(locked);
  await fs.chmod(locked, 0);
  const record = path.join(home, "terminal-launch.txt");

  try {
    // No terminal installed: nothing offers one.
    let files = await openFiles({ initialPath: work });
    try {
      await files.until(() => files.texts().includes("Projects"), "lists");
      files.rightClick(files.center(entryId(projects)));
      assert.equal(files.menu.title, "Projects");
      assert.ok(
        !files.menu.actions.some((action) => action.id === "open-in-terminal"),
        "no terminal, no Open in Terminal",
      );
    } finally {
      files.close();
    }

    // A terminal (Moire's, by its desktop id) that writes down its folder and arguments.
    const fake = path.join(home, "bin", "fake-terminal");
    await fs.mkdir(path.dirname(fake), { recursive: true });
    await fs.writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > '${record}'\n`, {
      mode: 0o755,
    });
    const applications = path.join(process.env.XDG_DATA_HOME!, "applications");
    await fs.mkdir(applications, { recursive: true });
    await fs.writeFile(
      path.join(applications, "moire-terminal.desktop"),
      `[Desktop Entry]\nType=Application\nName=Terminal\nExec=${fake}\nCategories=System;TerminalEmulator;\n`,
    );
    const launched = async (folder: string) => {
      for (let attempt = 0; attempt < 300; attempt++) {
        const text = await fs.readFile(record, "utf8").catch(() => "");
        if (text) {
          await fs.rm(record);
          // macOS reports /private/var for /var: compare real paths.
          const [cwd, ...args] = text.trimEnd().split("\n");
          assert.equal(await fs.realpath(cwd!), await fs.realpath(folder));
          assert.deepEqual(args, ["--working-directory", folder]);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail(`the terminal never started in ${folder}`);
    };

    files = await openFiles({ initialPath: work });
    try {
      await files.until(() => files.texts().includes("Projects"), "lists");
      await files.settle(5);
      // A folder's menu.
      files.rightClick(files.center(entryId(projects)));
      await files.invoke("open-in-terminal");
      await launched(projects);
      // The folder's own background menu.
      const blank = files.hits().find((hit) => hit.focusId === entryId(projects))!;
      files.rightClick({ x: blank.x + blank.width / 2, y: files.window.getHeight() - 20 });
      assert.equal(files.menu.title, "Work");
      await files.invoke("open-in-terminal");
      await launched(work);
      // Files never get one.
      await fs.writeFile(path.join(work, "notes.txt"), "x");
      files.key(63, "F5");
      await files.until(() => files.texts().includes("notes.txt"), "the new file lists");
      files.rightClick(files.center(entryId(path.join(work, "notes.txt"))));
      assert.ok(!files.menu.actions.some((action) => action.id === "open-in-terminal"));
    } finally {
      files.close();
    }

    // An unreadable folder offers a shell next to it, in the folder that holds it.
    files = await openFiles({ initialPath: locked });
    try {
      await files.until(
        () => files.texts().includes("Cannot open this folder"),
        "the unreadable folder says so",
      );
      files.click(files.center("empty:open-in-terminal"));
      await launched(work);
    } finally {
      files.close();
    }
  } finally {
    await fs.chmod(locked, 0o755);
    if (previousDataDirs === undefined) delete process.env.XDG_DATA_DIRS;
    else process.env.XDG_DATA_DIRS = previousDataDirs;
  }
  console.log(
    "[files/open-in-terminal] hidden without a terminal; folder, background and unreadable-folder launches in the right folder passed",
  );
});
