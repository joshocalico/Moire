/**
 * Generated Wayland wire bindings. Do not edit by hand.
 *
 * Regenerate with scripts/generate-wayland-protocol.ts. The runtime is
 * Moire's TypeScript codec and Unix socket implementation—not libwayland.
 */
import { MessageBuilder, MessageReader, type EncodedWaylandMessage } from "./index";

export const moireSurfaceStateManagerV1 = {
  name: "moire_surface_state_manager_v1",
  version: 2,
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
    getSurfaceState: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number, surface: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.object(surface);
        return builder.build(targetId, 1);
      },
    },
  },
  events: {},
  enums: {
    error: {
      invalidSurface: 0,
      resourceLimit: 1,
    },
  },
} as const;

export const moireSurfaceStateV1 = {
  name: "moire_surface_state_v1",
  version: 2,
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
    submission: {
      opcode: 1,
      since: 2,
      destructor: false,
      encode(targetId: number, token: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(token);
        return builder.build(targetId, 1);
      },
    },
  },
  events: {
    state: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          visibility: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    rendering: {
      opcode: 1,
      since: 2,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          token: reader.uint(),
          rendering: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
    visibility: {
      unknown: 0,
      hidden: 1,
      visible: 2,
    },
    rendering: {
      unknown: 0,
      software: 1,
      virtual: 2,
      retainedUnknown: 3,
      hardwareRetained: 4,
    },
  },
} as const;

export const WAYLAND_INTERFACES = {
  moireSurfaceStateManagerV1,
  moireSurfaceStateV1,
} as const;
