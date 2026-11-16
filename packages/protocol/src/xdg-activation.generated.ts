/**
 * Generated Wayland wire bindings. Do not edit by hand.
 *
 * Regenerate with scripts/generate-wayland-protocol.ts. The runtime is
 * Moire's TypeScript codec and Unix socket implementation—not libwayland.
 */
import { MessageBuilder, MessageReader, type EncodedWaylandMessage } from "./index";

export const xdgActivationTokenV1 = {
  name: "xdg_activation_token_v1",
  version: 1,
  requests: {
    setSerial: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, serial: number, seat: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(serial);
        builder.object(seat);
        return builder.build(targetId, 0);
      },
    },
    setAppId: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, appId: string): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.string(appId);
        return builder.build(targetId, 1);
      },
    },
    setSurface: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, surface: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(surface);
        return builder.build(targetId, 2);
      },
    },
    commit: {
      opcode: 3,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 3);
      },
    },
    destroy: {
      opcode: 4,
      since: 1,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 4);
      },
    },
  },
  events: {
    done: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          token: reader.string(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
    error: {
      alreadyUsed: 0,
    },
  },
} as const;

export const xdgActivationV1 = {
  name: "xdg_activation_v1",
  version: 1,
  requests: {
    destroy: {
      opcode: 0,
      since: 1,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 0);
      },
    },
    getActivationToken: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 1);
      },
    },
    activate: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, token: string, surface: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.string(token);
        builder.object(surface);
        return builder.build(targetId, 2);
      },
    },
  },
  events: {},
  enums: {},
} as const;

export const WAYLAND_INTERFACES = {
  xdgActivationTokenV1,
  xdgActivationV1,
} as const;
