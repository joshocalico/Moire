/**
 * xdg-activation policy and the settled frame captures wait for.
 *
 * Tokens: a client gets an honoured token only while it holds the focused window; a background
 * client's token does nothing. Tokens are one-shot and expire. Activation restores a minimized
 * window and focuses it; the shell's launch tokens (issueActivationToken) work the same way.
 * Settled frames: a waiter resolves only after a composite that began after it asked.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EncodedWaylandMessage } from "@moire/protocol";
import { wlCompositor, wlDisplay, wlRegistry } from "@moire/protocol/generated";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-activation-"));
const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
const { CompositorServer, ClientSession } = await import("./server");
type Server = InstanceType<typeof CompositorServer>;
type Session = InstanceType<typeof ClientSession>;

class Connection extends EventEmitter {
  readonly peerPid = null;
  send(): boolean {
    return true;
  }
  close(): void {
    this.emit("close");
  }
  request(message: EncodedWaylandMessage): void {
    this.emit("message", message);
  }
}

function client(server: Server, id: number): { session: Session; surface: { minimized: boolean } } {
  const conn = new Connection();
  const session = new ClientSession(server, conn, id);
  conn.request(wlDisplay.requests.getRegistry.encode(1, 2));
  conn.request(wlRegistry.requests.bind.encode(2, 1, "wl_compositor", 4, 3));
  conn.request(wlCompositor.requests.createSurface.encode(3, 10));
  const surface = session.surfaceById(10);
  assert.ok(surface);
  Object.assign(surface, {
    role: "toplevel",
    mapped: true,
    width: 160,
    height: 120,
    title: `Client ${id}`,
  });
  server.registerToplevel(session, 10);
  return { session, surface };
}

try {
  const server = new CompositorServer(fixture);
  const focused = (session: Session) =>
    (server as unknown as { focusedToplevel: { session: Session } | null }).focusedToplevel
      ?.session === session;
  const settings = client(server, 1);
  const terminal = client(server, 2);
  server.focusClient(terminal.session, 10);
  assert.ok(focused(terminal.session));

  // A background client cannot mint a way to the front.
  const background = server.issueClientActivationToken(settings.session);
  server.activateWithToken(background, settings.session, 10);
  assert.ok(focused(terminal.session), "a token asked for from the background is not honoured");

  // The focused client's token raises another client's window (a launch it handed it to).
  const handed = server.issueClientActivationToken(terminal.session);
  server.setMinimized(settings.session, 10);
  assert.equal(settings.surface.minimized, true);
  server.activateWithToken(handed, settings.session, 10);
  assert.ok(focused(settings.session), "a focused client's token activates");
  assert.equal(settings.surface.minimized, false, "activation restores a minimized window");

  // One-shot.
  server.focusClient(terminal.session, 10);
  server.activateWithToken(handed, settings.session, 10);
  assert.ok(focused(terminal.session), "a used token does nothing");

  // Expired: issued longer ago than the token lifetime.
  const stale = server.issueActivationToken();
  const tokens = (server as unknown as { activationTokens: Map<string, number> }).activationTokens;
  tokens.set(stale, (tokens.get(stale) ?? 0) - 60_000);
  server.activateWithToken(stale, settings.session, 10);
  assert.ok(focused(terminal.session), "an expired token does nothing");

  // The shell's launch token, and a made-up one.
  server.activateWithToken("moire-made-up", settings.session, 10);
  assert.ok(focused(terminal.session), "a token the compositor never issued does nothing");
  server.activateWithToken(server.issueActivationToken(), settings.session, 10);
  assert.ok(focused(settings.session), "a launch token from the shell activates");

  // Unused tokens are bounded.
  for (let i = 0; i < 100; i++) server.issueActivationToken();
  assert.ok(tokens.size <= 32, "unused tokens are bounded");

  // Settled frames: only a composite that began after the request resolves it.
  const internals = server as unknown as {
    running: boolean;
    compositesStarted: number;
    resolveSettledFrames(started: number): void;
  };
  internals.running = true;
  internals.compositesStarted = 5;
  let settled = false;
  const waiting = server.settledFrame(5_000).then(() => {
    settled = true;
  });
  internals.resolveSettledFrames(5);
  await Promise.resolve();
  assert.equal(settled, false, "a composite already under way does not count");
  internals.resolveSettledFrames(6);
  await waiting;
  assert.equal(settled, true, "the next composite settles it");
  const started = Date.now();
  await server.settledFrame(20);
  assert.ok(Date.now() - started < 1000, "a frame that never settles gives up at the timeout");
  internals.running = false;

  console.log("[core/activation] token focus policy, one-shot, expiry and settled frames ok");
} finally {
  if (previous.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = previous.HOME;
  if (previous.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previous.XDG_CONFIG_HOME;
  fs.rmSync(fixture, { recursive: true, force: true });
}
