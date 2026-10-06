/** Device-free Linux Unix/SCM_RIGHTS proof of rejected-import ownership and recovery. */
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { decodeHeader, type EncodedWaylandMessage } from "@moire/protocol";
import {
  wlBuffer,
  wlCompositor,
  wlDisplay,
  wlRegistry,
  wlShm,
  wlShmPool,
  wlSurface,
  wpPresentation,
  wpPresentationFeedback,
  zwpLinuxDmabufV1 as dmabuf,
  zwpLinuxBufferParamsV1 as params,
} from "@moire/protocol/generated";
import {
  moireSurfaceStateManagerV1 as manager,
  moireSurfaceStateV1 as observation,
} from "@moire/protocol/surface-state";
import {
  closeFd,
  createMemfd,
  socketpairUnixStream,
  truncateFd,
  WaylandClientConn,
} from "@moire/sys";

async function run(): Promise<void> {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "moire-import-failure-")),
  );
  const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = directory;
  process.env.XDG_CONFIG_HOME = path.join(directory, "config");
  const { CompositorServer, ClientSession } = await import("./server");
  const server = new CompositorServer(directory);
  const [clientFd, serverFd] = socketpairUnixStream();
  const client = new WaylandClientConn(
    new net.Socket({ fd: clientFd, readable: true, writable: true }),
  );
  const receiver = new WaylandClientConn(
    new net.Socket({ fd: serverFd, readable: true, writable: true }),
  );
  // close() starts net.Socket destruction. The later close event stops each
  // owned epoll dispatcher and frees native transport scratch, so await it
  // before propagating a failed assertion out of the fixture.
  const clientClosed = new Promise<void>((resolve) => client.once("close", resolve));
  const receiverClosed = new Promise<void>((resolve) => receiver.once("close", resolve));
  const session = new ClientSession(server, receiver, 1);
  const producerFds: number[] = [];
  const deliveredFds: number[] = [];
  const received: Buffer[] = [];
  const transportErrors: unknown[] = [];
  let incoming = Buffer.alloc(0);
  receiver.on("message", (chunk: { fds: number[] }) => deliveredFds.push(...chunk.fds));
  client.on("message", (chunk: { data: Buffer }) => {
    incoming = Buffer.concat([incoming, chunk.data]);
    while (incoming.length >= 8) {
      const header = decodeHeader(incoming);
      assert.ok(header.size >= 8);
      if (incoming.length < header.size) break;
      received.push(Buffer.from(incoming.subarray(0, header.size)));
      incoming = incoming.subarray(header.size);
    }
  });
  client.on("error", (error: unknown) => transportErrors.push(error));
  receiver.on("error", (error: unknown) => transportErrors.push(error));
  const events = (id: number, opcode = 0) =>
    received.filter((data) => {
      const header = decodeHeader(data);
      return header.objectId === id && header.opcode === opcode;
    });
  const send = (message: EncodedWaylandMessage) =>
    assert.equal(client.send(message.data, message.fds), true);
  const wait = async (predicate: () => boolean) => {
    const deadline = performance.now() + 3000;
    while (!predicate()) {
      assert.deepEqual(transportErrors, [], "native Unix transport errors");
      assert.ok(performance.now() < deadline, "native Unix protocol fixture timed out");
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  };
  const roundtrip = async () => {
    const before = events(99).length;
    send(wlDisplay.requests.sync.encode(1, 99));
    await wait(() => events(99).length > before);
  };
  const latestRendering = (id: number) => {
    const event = events(id, observation.events.rendering.opcode).at(-1);
    assert.ok(event);
    const result = observation.events.rendering.decode(event);
    assert.equal(result.rendering, 0, "no accepted output presentation exists in this fixture");
    return result;
  };
  const producer = (name: string, bytes: Buffer) => {
    const fd = createMemfd(name, 1);
    producerFds.push(fd);
    truncateFd(fd, bytes.length);
    fs.writeSync(fd, bytes, 0, bytes.length, 0);
    return fd;
  };
  const pixels = (color: number) => {
    const bytes = Buffer.alloc(64);
    for (let i = 0; i < bytes.length; i += 4) bytes.writeUInt32LE(color, i);
    return bytes;
  };
  const commit = (
    surfaceId: number,
    observationId: number,
    bufferId: number | null,
    token: number,
    callback?: number,
  ) => {
    if (bufferId !== null) send(wlSurface.requests.attach.encode(surfaceId, bufferId, 0, 0));
    send(observation.requests.submission.encode(observationId, token));
    if (callback !== undefined) send(wlSurface.requests.frame.encode(surfaceId, callback));
    send(wlSurface.requests.commit.encode(surfaceId));
  };
  const rejectBuffer = async (id: number, fd: number, width = 4, height = 4) => {
    // This memfd is deliberately advertised with a non-linear modifier and no
    // GBM importer. It is an unsupported transport fixture, not a DMA/GPU BO.
    const before = deliveredFds.length;
    send(dmabuf.requests.createParams.encode(6, 40));
    send(params.requests.add.encode(40, fd, 0, 0, width * 4, 0, 1));
    send(params.requests.createImmed.encode(40, id, width, height, 0x34325241, 0));
    send(params.requests.destroy.encode(40));
    await roundtrip();
    assert.equal(deliveredFds.length, before + 1, "real SCM_RIGHTS descriptor delivery");
    const delivered = deliveredFds.at(-1);
    assert.ok(delivered !== undefined);
    assert.notEqual(delivered, fd, "compositor owns a distinct transferred descriptor");
    return delivered;
  };
  const retire = async (bufferId: number, delivered: number, original: number) => {
    send(wlBuffer.requests.destroy.encode(bufferId));
    await roundtrip();
    assert.throws(
      () => fs.fstatSync(delivered),
      { code: "EBADF" },
      "retirement closes transferred fd",
    );
    assert.ok(fs.fstatSync(original).isFile(), "client still owns its producer descriptor");
  };
  try {
    assert.equal(server.getGbm(), null, "device-free unsupported-import boundary");
    send(wlDisplay.requests.getRegistry.encode(1, 2));
    await roundtrip();
    const globals = events(2).map((event) => wlRegistry.events.global.decode(event));
    for (const [name, id, version] of [
      [wlCompositor.name, 3, 4],
      [wlShm.name, 5, 1],
      [dmabuf.name, 6, 3],
      [manager.name, 7, 2],
      [wpPresentation.name, 8, 1],
    ] as const) {
      const global = globals.find((item) => item.interfaceValue === name);
      assert.ok(global);
      assert.ok(global.version >= version);
      send(wlRegistry.requests.bind.encode(2, global.name, name, version, id));
    }
    for (const [id, observationId] of [
      [10, 14],
      [30, 34],
    ] as const) {
      send(wlCompositor.requests.createSurface.encode(3, id));
      send(manager.requests.getSurfaceState.encode(7, observationId, id));
    }
    const goodBytes = pixels(0xff3167ad);
    const goodFd = producer("moire-valid-shm", goodBytes);
    send(wlShm.requests.createPool.encode(5, 20, goodFd, goodBytes.length));
    send(wlShmPool.requests.createBuffer.encode(20, 21, 0, 4, 4, 16, 1));
    await roundtrip();
    const poolFd = deliveredFds.at(-1);
    assert.ok(poolFd !== undefined);
    const badFd = producer("moire-unavailable-import", pixels(0xffabcdef));
    const firstDelivered = await rejectBuffer(41, badFd);
    send(wpPresentation.requests.feedback.encode(8, 30, 51));
    commit(30, 34, 41, 11, 50);
    await roundtrip();
    const first = session.surfaceById(30);
    assert.ok(first);
    console.log(
      JSON.stringify({
        phase: "first-rejected",
        mapped: first.mapped,
        revision: first.revision,
        releases: events(41).length,
        callbacks: events(50).length,
        rendering: latestRendering(34),
      }),
    );
    assert.equal(
      first.mapped,
      false,
      "unavailable readback must not fabricate mapped black content",
    );
    assert.equal(first.content, null);
    assert.equal(first.revision, 0);
    assert.equal(first.renderingSourceAccepted, false);
    assert.equal(latestRendering(34).token, 0);
    assert.equal(events(41).length, 1, "unmapped rejection immediately releases storage");
    assert.equal(events(50).length, 0, "rejection does not fabricate a frame tick");
    assert.deepEqual(first.frameCallbacks, [50], "callback may wait for the next valid source");
    assert.equal(events(51, wpPresentationFeedback.events.presented.opcode).length, 0);
    assert.deepEqual(
      first.presentationFeedbacks,
      [],
      "failed source has no feedback awaiting composition",
    );
    assert.equal(events(51, wpPresentationFeedback.events.discarded.opcode).length, 1);
    assert.deepEqual(first.releaseBuffers, [], "immediate release must not be queued twice");
    await retire(41, firstDelivered, badFd);
    commit(30, 34, 21, 12);
    await roundtrip();
    const reattached = session.surfaceById(30);
    assert.ok(reattached?.content);
    assert.equal(reattached.mapped, true);
    assert.deepEqual(reattached.content.pixels, new Uint8Array(goodBytes));
    assert.equal(
      events(51, wpPresentationFeedback.events.discarded.opcode).length,
      1,
      "reattach cannot duplicate rejected-source feedback discard",
    );
    assert.equal(latestRendering(34).token, 12);
    // Invoke the actual production completion primitive. There is deliberately
    // no output/device or scheduler here, and no accepted output presentation.
    session.finishSurfaceFrame(reattached);
    await roundtrip();
    assert.equal(events(50).length, 1, "successful reattach completes the pending callback once");
    assert.equal(events(21).length, 1);
    assert.equal(events(41).length, 1);

    send(wpPresentation.requests.feedback.encode(8, 10, 64));
    commit(10, 14, 21, 22, 61);
    await roundtrip();
    const surface = session.surfaceById(10);
    assert.ok(surface?.content);
    const lastGood = surface.content;
    const saved = lastGood.pixels.slice();
    const revision = surface.revision;
    const geometry = [surface.width, surface.height, surface.bufferWidth, surface.bufferHeight];
    session.finishSurfaceFrame(surface);
    await roundtrip();
    assert.equal(events(61).length, 1);
    assert.equal(events(21).length, 2);
    assert.deepEqual(surface.readyPresentationFeedbacks, [64]);
    const secondDelivered = await rejectBuffer(42, badFd, 8, 2);
    send(wlSurface.requests.attach.encode(10, 42, 0, 0));
    await roundtrip();
    assert.deepEqual(
      [surface.width, surface.height, surface.bufferWidth, surface.bufferHeight],
      geometry,
      "pending attachment cannot resize committed last-good geometry",
    );
    send(wpPresentation.requests.feedback.encode(8, 10, 65));
    commit(10, 14, null, 77, 62);
    await roundtrip();
    assert.equal(surface.content, lastGood, "failed attach retains last-good owned content");
    assert.deepEqual(lastGood.pixels, saved, "failed readback cannot alter last-good bytes");
    assert.equal(surface.revision, revision);
    assert.deepEqual(
      [surface.width, surface.height, surface.bufferWidth, surface.bufferHeight],
      geometry,
    );
    assert.equal(surface.mapped, true);
    assert.equal(surface.renderingSourceAccepted, false);
    assert.equal(surface.bufferAttached, false);
    assert.equal(latestRendering(14).token, 0, "failed latest source is uncertified");
    assert.equal(events(65, wpPresentationFeedback.events.discarded.opcode).length, 1);
    assert.deepEqual(surface.presentationFeedbacks, []);
    assert.deepEqual(
      surface.readyPresentationFeedbacks,
      [64],
      "previous composited feedback survives rejection",
    );
    assert.equal(events(42).length, 0, "mapped source retains normal completion release ordering");
    assert.deepEqual(surface.releaseBuffers, [42]);
    session.finishSurfaceFrame(surface);
    await roundtrip();
    assert.equal(events(62).length, 1);
    assert.equal(events(42).length, 1);
    assert.deepEqual(
      surface.readyPresentationFeedbacks,
      [64],
      "failed source cannot enter ready presentation feedback",
    );
    assert.equal(events(65, wpPresentationFeedback.events.presented.opcode).length, 0);
    assert.equal(
      events(51, wpPresentationFeedback.events.presented.opcode).length,
      0,
      "no fake output presentation during recovery",
    );
    commit(10, 14, null, 78);
    await roundtrip();
    assert.equal(surface.content, lastGood);
    assert.deepEqual(lastGood.pixels, saved);
    assert.equal(surface.revision, revision);
    assert.equal(surface.renderingSourceAccepted, false);
    assert.equal(latestRendering(14).token, 0, "idle commit cannot recertify the failed source");
    await retire(42, secondDelivered, badFd);
    const recovery = pixels(0xff9124bb);
    fs.writeSync(goodFd, recovery, 0, recovery.length, 0);
    commit(10, 14, 21, 80, 63);
    await roundtrip();
    assert.notEqual(surface.content, lastGood);
    assert.deepEqual(surface.content?.pixels, new Uint8Array(recovery));
    assert.equal(surface.revision, revision + 1);
    assert.deepEqual(
      [surface.width, surface.height, surface.bufferWidth, surface.bufferHeight],
      geometry,
    );
    assert.equal(surface.renderingSourceAccepted, true);
    assert.equal(latestRendering(14).token, 80);
    assert.deepEqual(
      reattached.content.pixels,
      new Uint8Array(goodBytes),
      "other surface snapshot remains independent",
    );
    session.finishSurfaceFrame(surface);
    await roundtrip();
    assert.equal(events(63).length, 1);
    assert.equal(events(21).length, 3);
    assert.equal(events(41).length, 1);
    assert.equal(events(42).length, 1);
    assert.equal(events(65, wpPresentationFeedback.events.discarded.opcode).length, 1);
    assert.equal(events(65, wpPresentationFeedback.events.presented.opcode).length, 0);
    assert.equal(deliveredFds.length, 3);
    assert.deepEqual(transportErrors, []);
    console.log(
      "PASS: actual Linux Unix/SCM_RIGHTS, memfd/SHM and ClientSession handlers; rejected first/mapped import, last-good pixels/revision/geometry, sticky token0, valid recovery and single release. Completion primitive is explicit; no output presentation/GPU/physical-device claim.",
    );
    session.destroy();
    assert.throws(
      () => fs.fstatSync(poolFd),
      { code: "EBADF" },
      "session teardown closes transferred SHM pool fd",
    );
    assert.ok(fs.fstatSync(goodFd).isFile());
  } finally {
    session.destroy();
    receiver.close();
    client.close();
    server.stop();
    for (const fd of producerFds) closeFd(fd);
    await Promise.all([clientClosed, receiverClosed]);
    for (const key of ["HOME", "XDG_CONFIG_HOME"] as const) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.platform === "linux") {
  try {
    await run();
  } catch (error) {
    // Preserve the failure while allowing the stopped native readiness waits
    // to complete. A fatal top-level throw can strand their asynchronous close.
    console.error(error);
    process.exitCode = 1;
  }
} else
  console.log(
    "SKIP dmabuf-failure native Unix/SCM_RIGHTS: Linux only; no native proof on this host.",
  );
