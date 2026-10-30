import assert from "node:assert/strict";
import {
  ChannelReader,
  decodeBrokerCommand,
  decodeFrontEvent,
  encodeBrokerCommand,
  encodeFrontEvent,
} from "./front-channel";
import {
  FrameReader,
  MAX_ANSWER_BYTES,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  decodeReply,
  encodeReply,
  encodeReplyMessage,
  encodeRequest,
  encodeRequestMessage,
  parseRequest,
  type GreeterReply,
  type GreeterRequest,
} from "./protocol";

const SECRET = new TextEncoder().encode("SYNTHETIC-pässwörd-😀");
let cases = 0;

/** Compare byte arrays by content, whatever their class (Buffer vs Uint8Array). */
const plain = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_key, item) => (item instanceof Uint8Array ? [...item] : item)),
  );

/** A message (no length prefix) from raw bytes. */
const message = (...bytes: number[]) => Uint8Array.from(bytes);
function rejected(input: Uint8Array, why: string) {
  const result = parseRequest(input);
  assert(!result.ok, `expected rejection: ${why}`);
  cases++;
  return result;
}

// Every request round-trips through frame → reader → parser, fed one byte at a time.
const requests: GreeterRequest[] = [
  { type: "begin", account: "alice" },
  { type: "answer", response: SECRET },
  { type: "answer", response: null },
  { type: "answer", response: new Uint8Array(0) },
  { type: "start", session: "moire" },
  { type: "cancel" },
  { type: "sessions" },
];
const frames = requests.map(encodeRequest);
const all = Buffer.concat(frames);
const reader = new FrameReader();
const messages: Buffer[] = [];
for (let index = 0; index < all.length; index++) {
  const chunk = Buffer.from(all.subarray(index, index + 1));
  for (const event of reader.push(chunk)) {
    assert.equal(event.kind, "message");
    if (event.kind === "message") messages.push(event.message);
  }
  assert.equal(chunk[0], 0, "each incoming chunk is wiped once copied");
}
assert.equal(messages.length, requests.length);
messages.forEach((bytes, index) => {
  const result = parseRequest(bytes);
  assert(result.ok, `request ${index} parses`);
  assert.deepEqual(plain(result.request), plain(requests[index]));
  cases++;
});
// Answers are bytes end to end, including non-ASCII and invalid UTF-8.
const raw = parseRequest(
  encodeRequestMessage({ type: "answer", response: Uint8Array.of(0xc3, 0x28) }),
);
assert(raw.ok && raw.request.type === "answer");
assert.deepEqual([...(raw.request.response ?? [])], [0xc3, 0x28]);
// The front's re-encoding is byte-identical to what a client sends (minus the length).
assert.deepEqual(encodeRequestMessage(requests[0]!), frames[0]!.subarray(4));
// Many frames in one chunk.
assert.equal(new FrameReader().push(Buffer.concat(frames)).length, requests.length);
cases += 3;

// Strictness: every one of these is a violation, never a best-effort parse.
const V = PROTOCOL_VERSION;
const text = (value: string) => {
  const bytes = Buffer.from(value);
  return [bytes.length & 0xff, bytes.length >> 8, ...bytes];
};
assert.equal(rejected(message(2, 0x04), "future version").ok || "version", "version");
assert.equal((parseRequest(message(2, 0x04)) as { violation: string }).violation, "version");
rejected(message(V), "no type");
rejected(message(V, 0x09), "unknown type");
rejected(message(V, 0x81), "a reply type sent as a request");
rejected(message(V, 0x04, 0), "cancel with a body");
rejected(message(V, 0x05, 0), "sessions with a body");
rejected(message(V, 0x01), "begin without an account");
rejected(message(V, 0x01, ...text("")), "empty account");
rejected(message(V, 0x01, ...text("a".repeat(33))), "account too long");
rejected(message(V, 0x01, ...text("tab\there")), "control character");
rejected(message(V, 0x01, ...text("alice"), 0), "trailing byte");
rejected(message(V, 0x01, 5, 0, 0x61), "length past the end");
rejected(message(V, 0x01, 2, 0, 0xff, 0xfe), "invalid UTF-8 in a text field");
rejected(message(V, 0x02), "answer without a flag");
rejected(message(V, 0x02, 2), "unknown answer flag");
rejected(message(V, 0x02, 0, 0), "acknowledgement with a body");
rejected(message(V, 0x02, 1, 1, 0, 0), "NUL inside an answer");
rejected(
  Uint8Array.from([
    V,
    0x02,
    1,
    (MAX_ANSWER_BYTES + 1) & 0xff,
    (MAX_ANSWER_BYTES + 1) >> 8,
    ...new Uint8Array(MAX_ANSWER_BYTES + 1).fill(0x61),
  ]),
  "answer too long",
);
rejected(message(V, 0x03, ...text("")), "empty session id");
rejected(new Uint8Array(MAX_MESSAGE_BYTES + 1), "oversized message");

// Framing violations.
const tooLong = Buffer.alloc(4);
tooLong.writeUInt32LE(MAX_MESSAGE_BYTES + 1);
assert.deepEqual(new FrameReader().push(tooLong), [
  { kind: "violation", violation: "frame-length" },
]);
const tooShort = Buffer.alloc(4);
tooShort.writeUInt32LE(1);
assert.deepEqual(new FrameReader().push(tooShort), [
  { kind: "violation", violation: "frame-length" },
]);
assert.deepEqual(new FrameReader(64).push(Buffer.alloc(100, 0x20)), [
  { kind: "violation", violation: "frame-overflow" },
]);
cases += 3;

// The reader's own buffer holds no secret after the message is handed out or after wipe().
const holder = new FrameReader();
const secretFrame = encodeRequest({ type: "answer", response: SECRET });
holder.push(Buffer.from(secretFrame.subarray(0, secretFrame.length - 3)));
holder.wipe();
const internal = (holder as unknown as { buffer: Buffer }).buffer;
assert(!internal.includes(Buffer.from("SYNTHETIC")), "wipe() clears partial frames");
const [complete] = holder.push(Buffer.from(secretFrame));
assert(complete?.kind === "message");
assert(!internal.includes(Buffer.from("SYNTHETIC")), "handed-out messages leave no copy behind");
cases += 2;

// Replies round-trip; control characters in PAM text are replaced; limits cut, never overflow.
const replies: GreeterReply[] = [
  { type: "prompt", style: "secret", text: "Password: " },
  { type: "prompt", style: "info", text: "Welcome" },
  { type: "authorized" },
  { type: "scheduled" },
  { type: "cancelled" },
  { type: "error", code: "denied" },
  { type: "error", code: "unknown-session" },
  { type: "sessions", sessions: [{ id: "moire", label: "Moire desktop · C63" }] },
  { type: "sessions", sessions: [] },
];
for (const reply of replies) {
  assert.deepEqual(decodeReply(encodeReply(reply).subarray(4)), reply);
  assert.deepEqual(encodeReplyMessage(reply), encodeReply(reply).subarray(4));
  cases++;
}
assert.deepEqual(
  decodeReply(encodeReplyMessage({ type: "prompt", style: "info", text: "a\u001b[2Jb" })),
  { type: "prompt", style: "info", text: "a [2Jb" },
);
const long = decodeReply(
  encodeReplyMessage({ type: "prompt", style: "info", text: "é".repeat(400) }),
);
assert(long?.type === "prompt" && Buffer.byteLength(long.text) <= 512);
assert.equal(decodeReply(message(V, 0x82, 0)), null, "trailing byte in a reply");
assert.equal(decodeReply(message(V, 0x85, 99)), null, "unknown error code");
assert.equal(decodeReply(message(V, 0x81, 9, 0, 0)), null, "unknown prompt style");
assert.equal(decodeReply(message(2, 0x82)), null, "wrong version");
cases += 6;

// Front ↔ broker channel: round trips, bounded frames, kinds checked in each direction.
{
  const request = encodeRequestMessage({ type: "answer", response: SECRET });
  const stream = Buffer.concat([
    encodeFrontEvent({ kind: "ready", connection: 0 }),
    encodeFrontEvent({ kind: "connected", connection: 7 }),
    encodeFrontEvent({ kind: "request", connection: 7, message: request }),
  ]);
  const channel = new ChannelReader();
  const raws = [
    ...(channel.push(Buffer.from(stream.subarray(0, 11))) ?? []),
    ...(channel.push(Buffer.from(stream.subarray(11))) ?? []),
  ];
  const events = raws.map(decodeFrontEvent);
  assert.deepEqual(events.slice(0, 2), [
    { kind: "ready", connection: 0 },
    { kind: "connected", connection: 7 },
  ]);
  assert(events[2]?.kind === "request" && events[2].message.equals(request));
  // A broker command is not a front event, and vice versa.
  const [reply] = new ChannelReader().push(encodeBrokerCommand({ kind: "close", connection: 7 }))!;
  assert.equal(decodeFrontEvent(reply!), null);
  assert.deepEqual(decodeBrokerCommand(reply!), { kind: "close", connection: 7 });
  const oversized = Buffer.alloc(8);
  oversized.writeUInt32LE(1 << 20);
  assert.equal(new ChannelReader().push(oversized), null);
  cases += 4;
}

console.log(`moire-dm protocol smoke ok (${cases} cases)`);
