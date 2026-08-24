import assert from "node:assert/strict";
import { MessageBuilder, MessageReader, decodeHeader } from "./index.js";
import {
  wlDataDevice,
  wlRegistry,
  wlShm,
  wlSurface,
  wpPresentation,
  wpPresentationFeedback,
  xdgPositioner,
} from "./generated.js";

function registryBindUsesGenericNewIdLayout(): void {
  const message = wlRegistry.requests.bind.encode(
    2,
    7,
    "wl_compositor",
    4,
    9,
  );
  assert.deepEqual(message.fds, []);
  assert.deepEqual(decodeHeader(message.data), {
    objectId: 2,
    opcode: 0,
    // 8-byte header + uint + string length + 16-byte padded payload +
    // version + new_id.
    size: 40,
  });
  const reader = new MessageReader(message.data, []);
  assert.equal(reader.uint(), 7);
  assert.equal(reader.string(), "wl_compositor");
  assert.equal(reader.uint(), 4);
  assert.equal(reader.newId(), 9);
}

function fileDescriptorsStayOutOfBand(): void {
  const message = wlShm.requests.createPool.encode(3, 8, 42, 4096);
  assert.deepEqual(message.fds, [42]);
  const reader = new MessageReader(message.data, message.fds);
  assert.equal(reader.newId(), 8);
  assert.equal(reader.fd(), 42);
  assert.equal(reader.int(), 4096);
}

function fixedAndNullableArgumentsRoundTrip(): void {
  const enter = new MessageBuilder()
    .uint(31)
    .object(12)
    .fixed(14.5)
    .fixed(22.25)
    .object(0)
    .build(6, wlDataDevice.events.enter.opcode);
  assert.deepEqual(wlDataDevice.events.enter.decode(enter.data), {
    serial: 31,
    surface: 12,
    x: 14.5,
    y: 22.25,
    id: null,
  });

  const attach = wlSurface.requests.attach.encode(10, null, 2, -3);
  const reader = new MessageReader(attach.data, []);
  assert.equal(reader.object(), 0);
  assert.equal(reader.int(), 2);
  assert.equal(reader.int(), -3);
}

function xmlMetadataIsRetained(): void {
  assert.equal(wlSurface.requests.destroy.destructor, true);
  assert.equal(xdgPositioner.requests.setReactive.since, 3);
}

function presentationTimeRoundTrips(): void {
  const request = wpPresentation.requests.feedback.encode(14, 22, 31);
  const requestReader = new MessageReader(request.data, []);
  assert.equal(requestReader.object(), 22);
  assert.equal(requestReader.newId(), 31);

  const event = new MessageBuilder()
    .uint(0)
    .uint(52)
    .uint(125_000_000)
    .uint(16_666_667)
    .uint(0)
    .uint(900)
    .uint(wpPresentationFeedback.enums.kind.vsync)
    .build(31, wpPresentationFeedback.events.presented.opcode);
  assert.deepEqual(wpPresentationFeedback.events.presented.decode(event.data), {
    tvSecHi: 0,
    tvSecLo: 52,
    tvNsec: 125_000_000,
    refresh: 16_666_667,
    seqHi: 0,
    seqLo: 900,
    flags: 1,
  });
}

registryBindUsesGenericNewIdLayout();
fileDescriptorsStayOutOfBand();
fixedAndNullableArgumentsRoundTrip();
xmlMetadataIsRetained();
presentationTimeRoundTrips();
console.log("generated Wayland protocol smoke: ok");
