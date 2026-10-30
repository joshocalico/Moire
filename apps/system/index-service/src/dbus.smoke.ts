/**
 * `org.moire.Index` over a private dbus-daemon: every method through the typed client, the
 * coalesced `Changed` signal, named errors, and the client noticing the service come and go.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { SessionBus } from "@moire/dbus";
import {
  EMPTY_QUERY,
  EVERYWHERE,
  INDEX_BUS,
  INDEX_INTERFACE,
  INDEX_PATH,
  IndexClientError,
  indexSearchable,
  observeIndexStatus,
  type IndexClient,
} from "@moire/system-management/index-status";
import { attachIndexInterface } from "./dbus";
import { homeFixture, write } from "./fixture";
import { IndexService, type IndexSettings } from "./service";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 5000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(10);
  }
}

const fixture = homeFixture("dbus");
const file = (relative: string) => path.join(fixture.home, relative);
write(file("Documents/Budget 2026.ods"), "not really a spreadsheet");
write(file("Documents/plan.md"), "harbour expansion");
write(
  path.join(fixture.root, "state/moire/recent/org.moire.Editor.json"),
  JSON.stringify([file("Documents/plan.md")]),
);

const daemon = spawn(
  process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
  [
    process.env.MOIRE_TEST_DBUS_CONFIG
      ? `--config-file=${process.env.MOIRE_TEST_DBUS_CONFIG}`
      : "--session",
    "--nofork",
    "--nopidfile",
    `--address=unix:path=${path.join(fixture.root, "bus")}`,
    "--print-address=1",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(daemon, "exit");
let address = "";
let daemonError: Error | null = null;
daemon.stdout.on("data", (bytes) => (address += bytes.toString()));
daemon.on("error", (error) => (daemonError = error));
const buses: SessionBus[] = [];
let client: IndexClient | null = null;
let service: IndexService | null = null;
try {
  await until(
    () => address.includes("\n") || daemonError !== null || daemon.exitCode !== null,
    "daemon",
  );
  if (daemonError) throw daemonError;
  const connect = async () => {
    const bus = await SessionBus.connect(address.trim());
    buses.push(bus);
    return bus;
  };
  const clientBus = await connect();
  client = await observeIndexStatus(clientBus);
  await until(() => client!.state.kind === "unavailable", "no service yet");

  let settings: IndexSettings = { enabled: true, excludes: [] };
  service = new IndexService({
    env: fixture.env,
    readSettings: () => settings,
    activity: { battery: async () => null, loadPerCpu: () => 0 },
    watch: false,
  });
  const serverBus = await connect();
  const detach = attachIndexInterface(serverBus, service);
  assert.equal(await serverBus.requestName(INDEX_BUS), 1);
  let signals = 0;
  await clientBus.subscribeSignal(
    { sender: INDEX_BUS, path: INDEX_PATH, interface: INDEX_INTERFACE, member: "Changed" },
    () => signals++,
  );
  await service.start();
  await service.idle();
  await until(
    () => client!.state.kind === "ready" && client!.state.status.state === "ready",
    "ready status",
  );
  assert(indexSearchable(client.state));
  assert(signals >= 1 && signals < 10, `Changed is coalesced (${signals} signals)`);

  const result = await client.search({ ...EMPTY_QUERY, words: ["budget"] }, EVERYWHERE, 8);
  assert.equal(result.best?.path, file("Documents/Budget 2026.ods"));
  assert.equal(result.source, "index");
  const text = await client.search({ ...EMPTY_QUERY, words: ["harbour"] }, fixture.home, 8);
  assert.equal(text.best?.reason.kind, "text");
  assert.equal((await client.kindCounts(fixture.home)).kinds.document, 2);
  assert.equal((await client.recent(5))[0]?.path, file("Documents/plan.md"));
  await client.reindex(file("Documents"));
  await assert.rejects(client.reindex("/outside"), (error: unknown) => {
    assert(error instanceof IndexClientError);
    return error.code === "invalid";
  });

  // Malformed calls get the interface's own error names.
  const raw = (member: string, signature: string, body: unknown[]) =>
    clientBus.call({
      destination: INDEX_BUS,
      path: INDEX_PATH,
      interface: INDEX_INTERFACE,
      member,
      signature,
      body,
    });
  await assert.rejects(
    raw("Search", "ssu", ["{not json", "", 8]),
    /org\.moire\.Index\.Error\.invalid/,
  );
  await assert.rejects(
    raw("Search", "ssu", [JSON.stringify(EMPTY_QUERY), "relative", 8]),
    /Error\.invalid/,
  );
  await assert.rejects(raw("KindCounts", "s", ["relative/path"]), /Error\.invalid/);

  // Turning indexing off: status says so, searches are refused by name.
  settings = { enabled: false, excludes: [] };
  await service.applySettings();
  await until(
    () => client!.state.kind === "ready" && client!.state.status.state === "disabled",
    "disabled",
  );
  assert(!indexSearchable(client.state));
  await assert.rejects(client.search(EMPTY_QUERY, EVERYWHERE, 8), (error: unknown) => {
    assert(error instanceof IndexClientError);
    return error.code === "disabled";
  });

  // The service going away is visible to the client.
  detach();
  serverBus.close();
  await until(() => client!.state.kind === "unavailable", "service gone");
  console.log("[index-service/dbus.smoke] ok");
} finally {
  await client?.dispose();
  await service?.stop();
  for (const bus of buses) bus.close();
  if (daemon.exitCode === null) daemon.kill("SIGTERM");
  await Promise.race([exited, sleep(2000)]);
  fixture.remove();
}
