/**
 * Single-instance lock: the first start owns the app, later starts hand their request over and
 * report "forwarded"; a stale socket is reclaimed; simultaneous starts end with one owner. A
 * start's xdg-activation token (given, or from XDG_ACTIVATION_TOKEN) arrives with its request.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { claimSingleInstance, singleInstanceSocket } from "./single-instance";

type Request = { link: string | null };
const parse = (value: unknown): Request | null =>
  value && typeof value === "object" && "link" in value
    ? { link: typeof value.link === "string" ? value.link : null }
    : null;

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-single-instance-"));
try {
  const options = { directory, parse };
  const first = await claimSingleInstance<Request>("org.example.One", { link: null }, options);
  assert.equal(first.kind, "primary");
  if (first.kind !== "primary") throw new Error("unreachable");

  // Requests sent before a listener are queued, then delivered in order.
  assert.equal(
    (await claimSingleInstance("org.example.One", { link: "displays" }, options)).kind,
    "forwarded",
  );
  const received: Request[] = [];
  first.onRequest((request) => received.push(request));
  assert.deepEqual(received, [{ link: "displays" }]);
  assert.equal(
    (await claimSingleInstance("org.example.One", { link: null }, options)).kind,
    "forwarded",
  );
  assert.deepEqual(received, [{ link: "displays" }, { link: null }]);

  // A malformed request is dropped, not delivered.
  await new Promise<void>((resolve) => {
    const client = net.createConnection(singleInstanceSocket("org.example.One", directory));
    client.on("connect", () => client.write('"nope"\n'));
    // Read the reply so the socket flows to its end.
    client.resume();
    client.on("close", () => resolve());
  });
  assert.equal(received.length, 2);

  // Closing releases the app: the next start becomes the owner.
  first.close();
  const second = await claimSingleInstance<Request>("org.example.One", { link: null }, options);
  assert.equal(second.kind, "primary");
  if (second.kind === "primary") second.close();

  // A socket left by a crashed instance (nobody listening) is reclaimed.
  const stale = singleInstanceSocket("org.example.Stale", directory);
  const dead = net.createServer();
  await new Promise<void>((resolve) => dead.listen(stale, resolve));
  // Closing a listening Unix server unlinks its path; recreate a dead socket file the way a
  // SIGKILLed process leaves it.
  await new Promise<void>((resolve) => dead.close(() => resolve()));
  fs.writeFileSync(stale, "");
  const reclaimed = await claimSingleInstance<Request>(
    "org.example.Stale",
    { link: null },
    options,
  );
  assert.equal(reclaimed.kind, "primary");
  if (reclaimed.kind === "primary") reclaimed.close();

  // Starts racing each other: exactly one owns the app and gets the others' requests.
  const racers = await Promise.all(
    ["a", "b", "c"].map((link) =>
      claimSingleInstance<Request>("org.example.Race", { link }, options),
    ),
  );
  const owners = racers.filter((racer) => racer.kind === "primary");
  assert.equal(owners.length, 1, "one owner among simultaneous starts");
  const raced: Request[] = [];
  if (owners[0]?.kind === "primary") {
    owners[0].onRequest((request) => raced.push(request));
    owners[0].close();
  }
  assert.equal(raced.length, 2, "the other starts forwarded their requests");

  // Activation tokens travel with the request, from the option or the launcher's environment.
  const owner = await claimSingleInstance<Request>("org.example.Token", { link: null }, options);
  assert.equal(owner.kind, "primary");
  if (owner.kind !== "primary") throw new Error("unreachable");
  const activations: [string | null, string | null][] = [];
  owner.onRequest((request, token) => activations.push([request.link, token]));
  await claimSingleInstance(
    "org.example.Token",
    { link: "displays" },
    {
      ...options,
      activationToken: "moire-given",
    },
  );
  process.env.XDG_ACTIVATION_TOKEN = "moire-from-env";
  await claimSingleInstance("org.example.Token", { link: "network" }, options);
  assert.equal(
    process.env.XDG_ACTIVATION_TOKEN,
    undefined,
    "the token is taken out of the environment, so children do not inherit it",
  );
  await claimSingleInstance("org.example.Token", { link: "sound" }, options);
  await claimSingleInstance(
    "org.example.Token",
    { link: "power" },
    {
      ...options,
      activationToken: "x".repeat(257),
    },
  );
  // A hand-written envelope with a token that is not a string still delivers the request.
  await new Promise<void>((resolve) => {
    const client = net.createConnection(singleInstanceSocket("org.example.Token", directory));
    client.on("connect", () =>
      client.write(`${JSON.stringify({ request: { link: "about" }, activationToken: 7 })}\n`),
    );
    client.resume();
    client.on("close", () => resolve());
  });
  assert.deepEqual(activations, [
    ["displays", "moire-given"],
    ["network", "moire-from-env"],
    ["sound", null],
    ["power", null],
    ["about", null],
  ]);
  owner.close();

  assert.throws(() => singleInstanceSocket("../escape", directory), /Invalid app id/);
  console.log(
    "[app-tools/single-instance] primary, forwarding, stale reclaim, races and activation tokens ok",
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
