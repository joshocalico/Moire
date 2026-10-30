/**
 * SPA POD codec and protocol framing: golden bytes for every type (worked out from the SPA
 * layout, not from this encoder), round trips, and malformed input rejected without reading past
 * the buffer.
 */
import assert from "node:assert/strict";
import { decodePod, encodePod, P, PodError, podNumbers, podProp, type Pod } from "./pod";
import {
  decodeDict,
  encodeDict,
  encodeMessage,
  MessageReader,
  messageArgs,
  methods,
  CoreMethod,
  decode,
  events,
  ProtocolError,
} from "./protocol";
import { SpaChoice, SpaObjectType, SpaParam, SpaProp } from "./spa";

let cases = 0;
function test(label: string, check: () => void) {
  check();
  console.log(`ok ${++cases} ${label}`);
}
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const bytes = (text: string) => new Uint8Array(Buffer.from(text.replace(/\s+/g, ""), "hex"));
function golden(pod: Pod, expected: string) {
  assert.equal(
    hex(encodePod(pod)),
    expected.replace(/\s+/g, ""),
    JSON.stringify(pod, (_, v) => (typeof v === "bigint" ? `${v}n` : v)),
  );
  const decoded = decodePod(bytes(expected));
  assert.deepEqual(decoded.pod, pod);
  assert.equal(decoded.end, bytes(expected).length);
}

test("scalars: golden bytes", () => {
  golden(P.none(), "00000000 01000000");
  golden(P.bool(true), "04000000 02000000 01000000 00000000");
  golden(P.id(0x10003), "04000000 03000000 03000100 00000000");
  golden(P.int(-5), "04000000 04000000 fbffffff 00000000");
  golden(P.long(-2n), "08000000 05000000 feffffff ffffffff");
  golden(P.float(1), "04000000 06000000 0000803f 00000000");
  golden(P.double(0.5), "08000000 07000000 00000000 0000e03f");
  golden(P.rectangle(320, 240), "08000000 0a000000 40010000 f0000000");
  golden(P.fraction(1, 48000), "08000000 0b000000 01000000 80bb0000");
  golden(P.fd(3), "08000000 12000000 03000000 00000000");
  golden(
    { type: "Pointer", pointerType: 0x10001, value: 0xdeadbeefn },
    "10000000 11000000 01000100 00000000 efbeadde 00000000",
  );
});

test("strings and bytes: NUL-terminated, padded to 8", () => {
  golden(P.string("abc"), "04000000 08000000 61626300 00000000");
  golden(P.string(""), "01000000 08000000 00000000 00000000");
  golden(P.string("12345678"), "09000000 08000000 3132333435363738 00000000 00000000");
  golden(P.bytes(new Uint8Array([1, 2, 3])), "03000000 09000000 01020300 00000000");
  golden({ type: "Bitmap", value: new Uint8Array([0xff]) }, "01000000 0c000000 ff000000 00000000");
  assert.equal(decodePod(encodePod(P.string("héllo ✓"))).pod.type, "String");
  assert.deepEqual(decodePod(encodePod(P.string("héllo ✓"))).pod, P.string("héllo ✓"));
  assert.throws(() => encodePod(P.string("a\0b")), PodError);
});

test("arrays and choices pack their children", () => {
  golden(P.floats([1, 0.5]), "10000000 0d000000 04000000 06000000 0000803f 0000003f");
  golden(P.array("Long", []), "08000000 0d000000 08000000 05000000");
  golden(
    P.choice(SpaChoice.Enum, "Int", [P.int(2), P.int(1), P.int(2)]),
    "1c000000 13000000 03000000 00000000 04000000 04000000 02000000 01000000 02000000 00000000",
  );
  golden(
    P.choice(SpaChoice.Range, "Fraction", [P.fraction(25, 1), P.fraction(0, 1), P.fraction(60, 1)]),
    "28000000 13000000 01000000 00000000 08000000 0b000000 19000000 01000000 00000000 01000000 3c000000 01000000",
  );
  // An empty array may declare a zero child size, as `spa_pod_builder_array(…, 0, …)` writes.
  assert.deepEqual(
    decodePod(bytes("08000000 0d000000 00000000 06000000")).pod,
    P.array("Float", []),
  );
});

test("struct and object nest with padding", () => {
  golden(
    P.struct(P.int(1), P.string("a")),
    "20000000 0e000000 04000000 04000000 01000000 00000000 02000000 08000000 61000000 00000000",
  );
  golden(
    P.object(SpaObjectType.Props, SpaParam.Props, { [SpaProp.mute]: P.bool(true) }),
    "20000000 0f000000 02000400 02000000 04000100 00000000 04000000 02000000 01000000 00000000",
  );
  const props = P.object(SpaObjectType.Props, SpaParam.Props, [
    { key: SpaProp.channelVolumes, flags: 0, value: P.floats([0.25, 0.5]) },
    { key: SpaProp.mute, flags: 8, value: P.bool(false) },
    { key: 0x1000000, flags: 0, value: P.struct(P.string("x"), P.none(), P.long(1n)) },
  ]);
  const decoded = decodePod(encodePod(props)).pod;
  assert.deepEqual(decoded, props);
  assert.deepEqual(podNumbers(podProp(decoded, SpaProp.channelVolumes)), [0.25, 0.5]);
});

test("large PODs grow the encoder's buffer without corrupting it", () => {
  // Regression: a header write must not use a view replaced by the growth it triggers.
  const big = P.struct(
    ...Array.from({ length: 64 }, (_, i) =>
      P.object(SpaObjectType.Props, SpaParam.Props, {
        [SpaProp.channelVolumes]: P.floats([i / 64, 1 - i / 64]),
        [SpaProp.mute]: P.bool(i % 2 === 0),
      }),
    ),
  );
  const bytes = encodePod(big);
  assert.ok(bytes.length > 4096);
  assert.deepEqual(decodePod(bytes).pod, big);
});

test("unknown types survive as opaque bytes", () => {
  const sequence = bytes("08000000 10000000 00000000 00000000");
  const decoded = decodePod(sequence).pod;
  assert.deepEqual(decoded, { type: "Unknown", typeId: 16, bytes: new Uint8Array(8) });
  assert.equal(hex(encodePod(decoded)), hex(sequence));
});

test("malformed PODs are rejected inside their buffer", () => {
  const bad = [
    "04000000", // truncated header
    "08000000 04000000 01000000", // body past the end
    "04000000 08000000 61626364", // unterminated string
    "02000000 04000000 01000000 00000000", // short Int
    "0c000000 0d000000 04000000 06000000 0000", // ragged array
    "0c000000 0d000000 08000000 06000000 00000000", // wrong child size
    "10000000 0f000000 02000400 02000000 04000100 00000000", // object property header only
  ];
  for (const sample of bad) assert.throws(() => decodePod(bytes(sample)), PodError, sample);
  let deep: Pod = P.int(0);
  for (let i = 0; i < 40; i++) deep = P.struct(deep);
  assert.throws(() => encodePod(deep), PodError);
  // Hand-built deep nesting: each Struct claims the rest of the buffer.
  const depth = 40;
  const nested = Buffer.alloc(depth * 8 + 16);
  for (let i = 0; i < depth; i++) {
    nested.writeUInt32LE(nested.length - (i + 1) * 8, i * 8);
    nested.writeUInt32LE(14, i * 8 + 4);
  }
  nested.writeUInt32LE(4, depth * 8);
  nested.writeUInt32LE(4, depth * 8 + 4);
  assert.throws(() => decodePod(nested), PodError);
});

test("dicts: count then key/value strings; NULL values skipped", () => {
  const dict = { "media.class": "Audio/Sink", "node.name": "x" };
  assert.deepEqual({ ...decodeDict(encodeDict(dict)) }, dict);
  const withNull = P.struct(P.int(2), P.string("a"), P.string("1"), P.string("b"), P.none());
  assert.deepEqual({ ...decodeDict(withNull) }, { a: "1" });
  assert.throws(() => decodeDict(P.struct(P.int(3), P.string("a"))), ProtocolError);
});

test("message framing: golden hello, reassembly across chunks, fd accounting", () => {
  const hello = encodeMessage(0, CoreMethod.hello, 1, methods.hello(4));
  assert.equal(
    hex(hello),
    "00000000 18000001 01000000 00000000 10000000 0e000000 04000000 04000000 04000000 00000000".replace(
      /\s+/g,
      "",
    ),
  );
  const sync = encodeMessage(0, CoreMethod.sync, 2, methods.sync(0, 7));
  const addMem = encodeMessage(0, 6, 3, events.addMem(1, 2, 0, 0), 1);
  const reader = new MessageReader();
  const stream = Buffer.concat([hello, sync, addMem]);
  reader.push(stream.subarray(0, 5));
  assert.equal(reader.next(), null);
  reader.push(stream.subarray(5, 45));
  const first = reader.next()!;
  assert.deepEqual([first.id, first.opcode, first.seq], [0, CoreMethod.hello, 1]);
  assert.equal(reader.next(), null);
  reader.push(stream.subarray(45), [42]);
  const second = reader.next()!;
  assert.deepEqual(messageArgs(second), methods.sync(0, 7));
  const third = reader.next()!;
  assert.deepEqual(third.fds, [42]);
  assert.equal(reader.next(), null);
  // Without fd passing the dropped fd reads as -1 instead of failing the connection.
  const lossy = new MessageReader(false);
  lossy.push(addMem);
  assert.deepEqual(lossy.next()!.fds, [-1]);
  const strict = new MessageReader();
  strict.push(addMem);
  assert.throws(() => strict.next(), ProtocolError);
  const huge = Buffer.alloc(16);
  huge.writeUInt32LE(0x00ffffff, 4);
  const guard = new MessageReader();
  guard.push(huge);
  assert.throws(() => guard.next(), ProtocolError);
});

test("events round trip through their decoders", () => {
  const wire = (args: Pod[]) => {
    const reader = new MessageReader();
    reader.push(encodeMessage(5, 0, 0, args));
    return messageArgs(reader.next()!);
  };
  const global = {
    id: 52,
    permissions: 0o770,
    type: "PipeWire:Interface:Node",
    version: 3,
    props: { "node.name": "a" },
  };
  const decodedGlobal = decode.global(wire(events.global(global)));
  assert.deepEqual({ ...decodedGlobal, props: { ...decodedGlobal.props } }, global);
  const node = decode.nodeInfo(
    wire(
      events.nodeInfo({
        id: 52,
        changeMask: 8n,
        state: 3,
        error: null,
        props: { a: "b" },
        params: [{ id: 2, flags: 7 }],
      }),
    ),
  );
  assert.deepEqual(
    [node.id, node.changeMask, node.state, node.error, { ...node.props }, node.params],
    [52, 8n, 3, null, { a: "b" }, [{ id: 2, flags: 7 }]],
  );
  const link = decode.linkInfo(
    wire(
      events.linkInfo({
        id: 9,
        outputNode: 1,
        outputPort: 2,
        inputNode: 3,
        inputPort: 4,
        state: 4,
        error: null,
        props: {},
      }),
    ),
  );
  assert.deepEqual(
    [link.outputNode, link.outputPort, link.inputNode, link.inputPort, link.state],
    [1, 2, 3, 4, 4],
  );
  const port = decode.portInfo(
    wire(events.portInfo({ id: 7, direction: 1, props: { "port.name": "FL" }, params: [] })),
  );
  assert.equal(port.props["port.name"], "FL");
  const param = decode.param(
    wire(events.param({ seq: 3, id: 2, index: 0, next: 1, param: P.int(1) })),
  );
  assert.deepEqual(param, { seq: 3, id: 2, index: 0, next: 1, param: P.int(1) });
  const property = decode.property(
    wire(events.property({ subject: 0, key: "k", type: null, value: null })),
  );
  assert.deepEqual(property, { subject: 0, key: "k", type: null, value: null });
});

console.log(`POD codec: ${cases} cases passed.`);
