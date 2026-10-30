/**
 * The rail: Ctrl+B shows its labels and the choice (with the view mode) survives a real
 * restart; a file dropped on a rail place moves there; Ctrl+Alt+number goes to a place; and
 * a custom place moves among the user's own.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { notifyDrop } from "@moire/ui/testing";
import { entryId, openFiles } from "./harness";

const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8);
if (!phase) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-rail-"));
  try {
    await fs.mkdir(path.join(fixture, "folder"));
    await fs.writeFile(path.join(fixture, "folder", "item.txt"), "Disposable rail fixture");
    for (const current of ["write", "restart"])
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [...process.execArgv, fileURLToPath(import.meta.url), `--phase=${current}`],
          {
            env: {
              ...process.env,
              HOME: fixture,
              XDG_CONFIG_HOME: path.join(fixture, ".config"),
              XDG_RUNTIME_DIR: path.join(fixture, ".run"),
              XDG_DATA_HOME: path.join(fixture, ".local/share"),
            },
            stdio: "inherit",
          },
        );
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error("Files rail fixture child timed out"));
        }, 30000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code, signal) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`Files rail child exited ${code}/${signal}`));
        });
      });
    console.log(
      "[files/rail] Ctrl+B labels and view mode survive a real restart; rail drops, Ctrl+Alt+number and place order passed",
    );
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
} else {
  assert.ok(phase === "write" || phase === "restart");
  const home = process.env.HOME!;
  const config = path.join(process.env.XDG_CONFIG_HOME!, "moire", "files-view.json");
  const saved = async (): Promise<Record<string, unknown>> => {
    try {
      return JSON.parse(await fs.readFile(config, "utf8"));
    } catch {
      return {};
    }
  };
  const folder = path.join(home, "folder");
  if (phase === "write") {
    // No harness preferences: the first run starts from the defaults.
    const files = await openFiles({ initialPath: folder });
    await fs.rm(config, { force: true });
    try {
      await files.until(
        () => files.hits().some((hit) => hit.focusId === entryId(path.join(folder, "item.txt"))),
        "the folder lists",
      );
      assert.ok(!files.texts().includes("Documents"), "the rail starts as icons only");
      files.key(48, "b", { ctrl: true });
      await files.until(() => files.texts().includes("Documents"), "Ctrl+B shows the labels");
      files.key(51, "3", { ctrl: true });
      await files.until(
        async () => (await saved()).railExpanded === true && (await saved()).view === "columns",
        "both choices are saved",
      );

      // A file dropped on a rail place moves into it.
      const documents = path.join(home, "Documents");
      const at = files.center("rail:documents");
      notifyDrop(
        `${pathToFileURL(path.join(folder, "item.txt")).href}\r\n`,
        ["text/uri-list"],
        at.x,
        at.y,
      );
      await files.until(
        async () => !!(await fs.stat(path.join(documents, "item.txt")).catch(() => null)),
        "a drop on a rail place moves the file there",
      );
      await files.until(() => files.texts().includes("Done"), "the transfer receipt shows");
      files.press("Done");

      // Ctrl+Alt+number goes to the rail's places in order: Home, Recent, Desktop, …
      files.key(2, "1", { ctrl: true, alt: true });
      await files.until(() => files.texts().includes("Search Home"), "Ctrl+Alt+1 opens Home");
      files.key(3, "2", { ctrl: true, alt: true });
      await files.until(
        () => files.texts().includes("Nothing recent yet"),
        "Ctrl+Alt+2 opens Recent",
      );
    } finally {
      files.close();
    }
  } else {
    const before = await saved();
    assert.equal(before.railExpanded, true, "the labelled rail was saved");
    assert.equal(before.view, "columns");
    const files = await openFiles({ initialPath: folder, preferences: before, view: "columns" });
    try {
      await files.until(
        () => files.texts().includes("Documents"),
        "a fresh window keeps the labels",
      );
      files.click(files.center("rail:toggle"));
      await files.until(async () => (await saved()).railExpanded === false, "the badge hides them");
      assert.equal((await saved()).view, "columns", "the view mode is untouched");

      // Custom places move among themselves; built-ins keep their order.
      for (const name of ["One", "Two"]) {
        await fs.mkdir(path.join(home, name), { recursive: true });
      }
      files.key(38, "l", { ctrl: true });
      files.key(30, "a", { ctrl: true });
      files.type(path.join(home, "One"));
      files.key(28, "Enter");
      await files.until(() => files.texts().includes("One"), "One opens");
      files.key(32, "d", { ctrl: true });
      files.key(38, "l", { ctrl: true });
      files.key(30, "a", { ctrl: true });
      files.type(path.join(home, "Two"));
      files.key(28, "Enter");
      await files.until(() => files.texts().includes("Two"), "Two opens");
      files.key(32, "d", { ctrl: true });
      const places = path.join(process.env.XDG_CONFIG_HOME!, "moire", "files-places.json");
      const order = async () =>
        (JSON.parse(await fs.readFile(places, "utf8")).favorites as { label: string }[]).map(
          (place) => place.label,
        );
      await files.until(async () => (await order()).length === 2, "both are pinned");
      files.rightClick(files.center(`rail:favorite:${path.join(home, "Two")}`));
      assert.equal(files.action("move-place-down").disabled, true, "Two is the last place");
      await files.invoke("move-place-up");
      await files.until(async () => (await order())[0] === "Two", "Move Up reorders places");
      files.rightClick(files.center("rail:documents"));
      assert.equal(files.action("move-place-up").disabled, true, "built-in places stay put");
    } finally {
      files.close();
    }
  }
}
