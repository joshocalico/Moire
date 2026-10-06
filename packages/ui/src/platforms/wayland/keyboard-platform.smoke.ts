/** Portable wire fixtures exercise production dispatch and ordinary temporary FDs only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mock } from "node:test";
import {
  MessageBuilder,
  MessageReader,
  decodeHeader,
  type EncodedWaylandMessage,
} from "@moire/protocol";
import { wlKeyboard, wlSeat } from "@moire/protocol/generated";
import { WaylandPlatform } from "./index";
import { WaylandKeyboard } from "./keyboard";
import type { ClientKeymap } from "./keymap-types";

const seatId = 50;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "moire-keyboard-platform-fixture-"));
let fileSerial = 0;
let cases = 0;

function invokePrivate(platform: WaylandPlatform, name: string, ...args: unknown[]): void {
  const method: unknown = Reflect.get(platform, name);
  assert.equal(typeof method, "function", `Missing production method ${name}`);
  if (typeof method !== "function") throw new Error(`Missing production method ${name}`);
  method.apply(platform, args);
}

class FixtureKeymap implements ClientKeymap {
  destroyed = 0;
  resets = 0;
  updateMask(): void {}
  translate() {
    return {};
  }
  modifiers() {
    return { shift: false, ctrl: false, alt: false, meta: false };
  }
  reset(): void {
    this.resets++;
  }
  destroy(): void {
    this.destroyed++;
  }
}

class WirePlatform extends WaylandPlatform {
  readonly requests: EncodedWaylandMessage[] = [];
  readonly maps: FixtureKeymap[] = [];

  constructor(version: number) {
    super();
    assert(Reflect.set(this, "seatVersion", version));
    assert(Reflect.set(this, "seatId", seatId));
    const keyboard: unknown = Reflect.get(this, "keyboard");
    assert(keyboard instanceof WaylandKeyboard);
    const options: unknown = Reflect.get(keyboard, "options");
    assert(options !== null && typeof options === "object");
    assert(
      Reflect.set(options, "createKeymap", () => {
        const map = new FixtureKeymap();
        this.maps.push(map);
        return map;
      }),
    );
  }

  override sendMessage(message: EncodedWaylandMessage, fds: number[] = []): void {
    assert.deepEqual(fds, [], "The fixture sends no native requests or descriptors");
    this.requests.push({ data: Buffer.from(message.data), fds: [...message.fds] });
  }

  capabilities(value: number): void {
    const message = new MessageBuilder()
      .uint(value)
      .build(seatId, wlSeat.events.capabilities.opcode);
    invokePrivate(
      this,
      "handleSeatCapabilities",
      wlSeat.events.capabilities.opcode,
      new MessageReader(message.data, message.fds),
    );
  }

  requestedKeyboardId(): number {
    const requests = this.requests.filter((message) => {
      const header = decodeHeader(message.data);
      return header.objectId === seatId && header.opcode === wlSeat.requests.getKeyboard.opcode;
    });
    const request = requests.at(-1);
    assert(request, "Production seat handler must request a keyboard");
    return new MessageReader(request.data, request.fds).newId();
  }

  releaseCount(id: number): number {
    return this.requests.filter((message) => {
      const header = decodeHeader(message.data);
      return header.objectId === id && header.opcode === wlKeyboard.requests.release.opcode;
    }).length;
  }

  dispatch(...messages: EncodedWaylandMessage[]): void {
    invokePrivate(this, "onChunk", {
      data: Buffer.concat(messages.map((message) => message.data)),
      fds: messages.flatMap((message) => message.fds),
    });
  }

  currentMap(): FixtureKeymap {
    const map = this.maps.at(-1);
    assert(map);
    return map;
  }
}

function realFd(source = Buffer.from("xkb_keymap { /* deterministic fixture */ };\0")): number {
  const filename = path.join(folder, String(++fileSerial));
  fs.writeFileSync(filename, source);
  return fs.openSync(filename, "r");
}

function keymapMessage(id: number, fd: number): EncodedWaylandMessage {
  return new MessageBuilder()
    .uint(wlKeyboard.enums.keymapFormat.xkbV1)
    .fd(fd)
    .uint(fs.fstatSync(fd).size)
    .build(id, wlKeyboard.events.keymap.opcode);
}

function assertClosed(fd: number): void {
  assert.throws(
    () => fs.fstatSync(fd),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "EBADF",
  );
}

function withCloseCounts(
  run: (closes: number[]) => void,
  beforeClose: (fd: number) => void = () => {},
): void {
  const original = fs.closeSync;
  const closes: number[] = [];
  const patched = mock.method(fs, "closeSync", (fd: number) => {
    closes.push(fd);
    try {
      beforeClose(fd);
    } finally {
      original(fd);
    }
  });
  try {
    run(closes);
  } finally {
    patched.mock.restore();
  }
}

function installMap(wire: WirePlatform): number {
  const fd = realFd();
  wire.dispatch(keymapMessage(wire.requestedKeyboardId(), fd));
  assertClosed(fd);
  assert.deepEqual(wire.getKeyboardMapping(), { kind: "available" });
  return fd;
}

function test(name: string, run: () => void): void {
  run();
  cases++;
  console.log("ok " + name);
}

try {
  for (const version of [1, 2, 5]) {
    test(`seat version ${version} removes ownership and gates release on production dispatch`, () => {
      const wire = new WirePlatform(version);
      wire.capabilities(2);
      const firstId = wire.requestedKeyboardId();
      installMap(wire);
      const firstMap = wire.currentMap();
      wire.capabilities(2);
      assert.equal(
        wire.requestedKeyboardId(),
        firstId,
        "Repeated capabilities cannot allocate another keyboard",
      );
      wire.capabilities(0);
      assert.deepEqual(wire.getKeyboardMapping(), { kind: "unavailable", reason: "disconnected" });
      assert.equal(firstMap.destroyed, 1);
      assert.equal(wire.releaseCount(firstId), version >= 3 ? 1 : 0);
      wire.capabilities(0);
      assert.equal(
        wire.releaseCount(firstId),
        version >= 3 ? 1 : 0,
        "Repeated removal cannot release twice",
      );
      wire.capabilities(2);
      const secondId = wire.requestedKeyboardId();
      assert.notEqual(secondId, firstId, "Readded capability must use a new keyboard object");
      installMap(wire);
      const secondMap = wire.currentMap();
      wire.disconnect();
      wire.disconnect();
      assert.equal(firstMap.destroyed, 1);
      assert.equal(secondMap.destroyed, 1);
      assert.equal(wire.releaseCount(firstId), version >= 3 ? 1 : 0);
      assert.equal(wire.releaseCount(secondId), version >= 3 ? 1 : 0);
    });
  }

  test("queued retired keyboard keymap closes once and cannot replace the current mapping", () => {
    const wire = new WirePlatform(5);
    wire.capabilities(2);
    const oldId = wire.requestedKeyboardId();
    installMap(wire);
    const oldMap = wire.currentMap();
    wire.capabilities(0);
    wire.capabilities(2);
    installMap(wire);
    const activeMap = wire.currentMap();
    withCloseCounts((closes) => {
      const staleFd = realFd();
      const before = closes.length;
      wire.dispatch(keymapMessage(oldId, staleFd));
      assert.deepEqual(closes.slice(before), [staleFd], "Stale FD must close exactly once");
      assertClosed(staleFd);
      assert.deepEqual(wire.getKeyboardMapping(), { kind: "available" });
      assert.equal(wire.maps.length, 2, "Stale event cannot construct another keymap");
      assert.equal(oldMap.destroyed, 1);
      assert.equal(activeMap.destroyed, 0);
      const guardFd = realFd(Buffer.from("reused descriptor guard"));
      try {
        assert.equal(guardFd, staleFd, "Fixture must reuse the released descriptor number");
        const afterGuardOpen = closes.length;
        wire.disconnect();
        wire.disconnect();
        assert.deepEqual(
          closes.slice(afterGuardOpen),
          [],
          "Teardown cannot close the transferred FD again",
        );
        assert(fs.fstatSync(guardFd).isFile(), "Descriptor reuse guard must remain open");
      } finally {
        fs.closeSync(guardFd);
      }
    });
    assert.equal(activeMap.destroyed, 1);
  });

  test("missing-FD stale keymap cannot interrupt later messages in the same production chunk", () => {
    const wire = new WirePlatform(5);
    wire.capabilities(2);
    const oldId = wire.requestedKeyboardId();
    wire.capabilities(0);
    wire.capabilities(2);
    installMap(wire);
    const map = wire.currentMap();
    let laterDispatches = 0;
    const sentinelId = 9001;
    wire.setHandler(sentinelId, () => {
      laterDispatches++;
    });
    const malformed = new MessageBuilder()
      .uint(wlKeyboard.enums.keymapFormat.xkbV1)
      .uint(32)
      .build(oldId, wlKeyboard.events.keymap.opcode);
    const later = new MessageBuilder().build(sentinelId, 0);
    assert.doesNotThrow(() => wire.dispatch(malformed, later));
    assert.equal(laterDispatches, 1, "Later event must survive malformed stale input");
    assert.deepEqual(wire.getKeyboardMapping(), { kind: "available" });
    assert.equal(wire.maps.length, 1);
    assert.equal(map.destroyed, 0);
    wire.disconnect();
    assert.equal(map.destroyed, 1);
  });

  test("teardown closes a pending FD from an incomplete message once and clears its bytes", () => {
    const wire = new WirePlatform(5);
    wire.capabilities(2);
    withCloseCounts((closes) => {
      const fd = realFd();
      const message = keymapMessage(wire.requestedKeyboardId(), fd);
      const before = closes.length;
      invokePrivate(wire, "onChunk", { data: message.data.subarray(0, 7), fds: message.fds });
      assert.deepEqual(closes.slice(before), [], "Incomplete message must retain FD ownership");
      assert.deepEqual(Reflect.get(wire, "pendingFds"), [fd]);
      wire.disconnect();
      assert.deepEqual(closes.slice(before), [fd]);
      assertClosed(fd);
      assert.deepEqual(Reflect.get(wire, "pendingFds"), []);
      assert.deepEqual(Reflect.get(wire, "buf"), Buffer.alloc(0));
      const guardFd = realFd(Buffer.from("pending FD reuse guard"));
      try {
        assert.equal(guardFd, fd, "Fixture must reuse the released descriptor number");
        const afterGuardOpen = closes.length;
        wire.disconnect();
        assert.deepEqual(closes.slice(afterGuardOpen), []);
        assert(fs.fstatSync(guardFd).isFile());
      } finally {
        fs.closeSync(guardFd);
      }
    });
  });

  test("consumed active keymap FD leaves the pending queue before teardown and descriptor reuse", () => {
    const wire = new WirePlatform(5);
    wire.capabilities(2);
    let consumedFd: number | null = null;
    let checkedBeforeClose = false;
    withCloseCounts(
      (closes) => {
        const fd = realFd();
        consumedFd = fd;
        const before = closes.length;
        wire.dispatch(keymapMessage(wire.requestedKeyboardId(), fd));
        assert(
          checkedBeforeClose,
          "Ownership transfer must be observed inside the production close call",
        );
        consumedFd = null;
        assert.deepEqual(closes.slice(before), [fd]);
        assertClosed(fd);
        assert.deepEqual(
          Reflect.get(wire, "pendingFds"),
          [],
          "Consumer must remove ownership immediately",
        );
        const map = wire.currentMap();
        const guardFd = realFd(Buffer.from("active FD reuse guard"));
        try {
          assert.equal(guardFd, fd, "Fixture must reuse the released descriptor number");
          const afterGuardOpen = closes.length;
          wire.disconnect();
          wire.disconnect();
          assert.equal(map.destroyed, 1);
          assert.deepEqual(
            closes.slice(afterGuardOpen),
            [],
            "Transferred FD cannot remain in teardown ownership",
          );
          assert(fs.fstatSync(guardFd).isFile());
        } finally {
          fs.closeSync(guardFd);
        }
      },
      (fd) => {
        if (fd !== consumedFd) return;
        assert.deepEqual(
          Reflect.get(wire, "pendingFds"),
          [],
          "Transfer must precede the consumer's close",
        );
        checkedBeforeClose = true;
      },
    );
  });

  console.log(
    JSON.stringify({
      suite: "Wayland keyboard platform dispatch fixtures",
      cases,
      actualExitCode: 0,
      deterministicKeymapFixture: true,
      realTemporaryFileDescriptors: true,
      nativeXkbLayoutProof: false,
      displayConnections: 0,
      seatConnections: 0,
      deviceAccess: 0,
    }),
  );
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}
