/** Production pool/submission methods, with only native allocations and draws stubbed. No GPU claim. */
import assert from "node:assert/strict";
import { EglOutputScaler } from "./egl-output";
let nextId = 0;
const destroyed = [];
const scaler = Object.assign(Object.create(EglOutputScaler.prototype), {
  destroyed: false,
  clientTargets: new Map(),
  currentClientPool: new Map(),
  createClientTarget(channel, width, height, format = 0x34325241) {
    return {
      id: `${channel}:${++nextId}`,
      fd: nextId,
      width,
      height,
      stride: width * 4,
      format,
      modifier: 0n,
      busy: false,
    };
  },
  destroyClientTarget(target) {
    destroyed.push(target.id);
  },
  beginComposition() {
    return null;
  },
  beginFrame() {},
  paintOutput() {},
  finishGpuWork() {},
  noteTransfer() {},
});
const opaque = { width: 8, height: 8, clearColor: 0xff000000, layers: [] };
const transparent = { ...opaque, clearColor: 0 };
const render = (scene = opaque) => scaler.renderClientComposition("client", scene);
const a = render(),
  b = render();
assert.ok(a && b);
scaler.releaseClientFrame(a.id);
const c = render(transparent);
assert.ok(c);
assert.equal(c.format, 0x34325241);
const d = render();
assert.ok(d);
assert.equal(d.id, a.id);
assert.equal(d.format, 0x34325258);
scaler.releaseClientFrame(b.id);
scaler.releaseClientFrame(d.id);
assert.ok(
  scaler.hasClientFrame(a.id) && scaler.hasClientFrame(b.id),
  "returning to current XRGB pool cancels retirement",
);
scaler.releaseClientFrame(c.id);
const e = render();
assert.ok(e);
assert.equal(e.id, a.id);
// Held old geometry counts against the channel limit; repeated changes cannot allocate unbounded targets.
let held = [e, render()];
assert.ok(held.every(Boolean));
const current = render();
assert.ok(current);
held.push(current);
const before = nextId;
for (let width = 9; width < 200; width++) assert.equal(render({ ...opaque, width }), null);
assert.equal(nextId, before);
assert.equal(scaler.hasClientFrame(e.id), true);
for (const frame of held) scaler.releaseClientFrame(frame.id);
assert.equal(scaler.hasClientFrame(e.id), false);
const f = render({ ...opaque, width: 200 });
assert.ok(f);
// Software upload bridge returns to an existing held geometry pool too.
const software = "software";
const pixels = new Uint8Array(8 * 8 * 4);
const sa = scaler.renderClientFrame(software, pixels, 8, 8),
  sb = scaler.renderClientFrame(software, pixels, 8, 8);
assert.ok(sa && sb);
scaler.releaseClientFrame(sa.id);
const sc = scaler.renderClientFrame(software, new Uint8Array(9 * 8 * 4), 9, 8);
assert.ok(sc);
const sd = scaler.renderClientFrame(software, pixels, 8, 8);
assert.ok(sd);
assert.equal(sd.id, sa.id);
scaler.releaseClientFrame(sb.id);
scaler.releaseClientFrame(sd.id);
assert.ok(scaler.hasClientFrame(sa.id) && scaler.hasClientFrame(sb.id));
assert.equal(new Set(destroyed).size, destroyed.length, "native targets retire exactly once");
console.log(
  "Actual EGL client pool methods: held XRGB→ARGB→XRGB and software geometry return, total three-target channel limit across resize, retired release and unique destruction PASS (stubbed native boundary)",
);
