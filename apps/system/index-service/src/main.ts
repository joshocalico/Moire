/**
 * moire-index: the session's file index for Files search. `--check` only proves this Node's
 * SQLite can hold the index (the nix build runs it) and exits.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionBus } from "@moire/dbus";
import { INDEX_BUS } from "@moire/system-management/index-status";
import { indexEnvironment } from "./config";
import { attachIndexInterface } from "./dbus";
import { checkSqliteSupport } from "./schema";
import { IndexService } from "./service";

/** The lowest CPU priority, so a crawl never takes time from what the user is doing. */
const LOWEST_NICE = 19;

/** Idle I/O class: the kernel serves the crawl's reads only when no one else is reading. */
function lowerPriority(): void {
  try {
    os.setPriority(LOWEST_NICE);
  } catch {
    // Not permitted in some sandboxes; the batching still keeps the crawl gentle.
  }
  const ionice = spawn("ionice", ["-c", "3", "-p", String(process.pid)], { stdio: "ignore" });
  ionice.on("error", () => {
    // ionice is optional (util-linux); without it the crawl keeps normal I/O priority.
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    console.log(`[index] node:sqlite ${checkSqliteSupport()} with FTS5 ok`);
    return;
  }
  lowerPriority();
  const bus = await SessionBus.connect();
  const service = new IndexService({ env: indexEnvironment(), watchConfig: true });
  const detach = attachIndexInterface(bus, service);
  if ((await bus.requestName(INDEX_BUS)) !== 1) {
    detach();
    bus.close();
    throw new Error(`Could not own ${INDEX_BUS}`);
  }
  let stopping: Promise<void> | null = null;
  const shutdown = () => {
    stopping ??= service
      .stop()
      .catch((error: unknown) => console.error("[index] shutdown:", error))
      .finally(() => {
        detach();
        bus.close();
      });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  bus.onDisconnect(shutdown);
  await service.start();
  console.log(`[index] ready as ${INDEX_BUS}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    console.error("[index] fatal:", error);
    process.exit(1);
  });
