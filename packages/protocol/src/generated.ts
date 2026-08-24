/**
 * Generated Wayland wire bindings. Do not edit by hand.
 *
 * Regenerate with scripts/generate-wayland-protocol.ts. The runtime is
 * Moire's TypeScript codec and Unix socket implementation—not libwayland.
 */
import { MessageBuilder, MessageReader, type EncodedWaylandMessage } from "./index.js";

export const wlBuffer = {
  name: "wl_buffer",
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
  },
  events: {
    release: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
  },
  enums: {
  },
} as const;

export const wlCallback = {
  name: "wl_callback",
  version: 1,
  requests: {
  },
  events: {
    done: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          callbackData: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
  },
} as const;

export const wlCompositor = {
  name: "wl_compositor",
  version: 6,
  requests: {
    createSurface: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 0);
      },
    },
    createRegion: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 1);
      },
    },
  },
  events: {
  },
  enums: {
  },
} as const;

export const wlDataDevice = {
  name: "wl_data_device",
  version: 3,
  requests: {
    startDrag: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, source: number | null, origin: number, icon: number | null, serial: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(source ?? 0);
        builder.object(origin);
        builder.object(icon ?? 0);
        builder.uint(serial);
        return builder.build(targetId, 0);
      },
    },
    setSelection: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, source: number | null, serial: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(source ?? 0);
        builder.uint(serial);
        return builder.build(targetId, 1);
      },
    },
    release: {
      opcode: 2,
      since: 2,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 2);
      },
    },
  },
  events: {
    dataOffer: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          id: reader.newId(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    enter: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          surface: reader.object(),
          x: reader.fixed(),
          y: reader.fixed(),
          id: (reader.object() || null),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    leave: {
      opcode: 2,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    motion: {
      opcode: 3,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          time: reader.uint(),
          x: reader.fixed(),
          y: reader.fixed(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    drop: {
      opcode: 4,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    selection: {
      opcode: 5,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          id: (reader.object() || null),
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
      role: 0,
    },
  },
} as const;

export const wlDataDeviceManager = {
  name: "wl_data_device_manager",
  version: 3,
  requests: {
    createDataSource: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 0);
      },
    },
    getDataDevice: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number, seat: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.object(seat);
        return builder.build(targetId, 1);
      },
    },
  },
  events: {
  },
  enums: {
    dndAction: {
      none: 0,
      copy: 1,
      move: 2,
      ask: 4,
    },
  },
} as const;

export const wlDataOffer = {
  name: "wl_data_offer",
  version: 3,
  requests: {
    accept: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, serial: number, mimeType: string | null): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(serial);
        builder.string(mimeType);
        return builder.build(targetId, 0);
      },
    },
    receive: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, mimeType: string, fd: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.string(mimeType);
        builder.fd(fd);
        return builder.build(targetId, 1);
      },
    },
    destroy: {
      opcode: 2,
      since: 1,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 2);
      },
    },
    finish: {
      opcode: 3,
      since: 3,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 3);
      },
    },
    setActions: {
      opcode: 4,
      since: 3,
      destructor: false,
      encode(targetId: number, dndActions: number, preferredAction: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(dndActions);
        builder.uint(preferredAction);
        return builder.build(targetId, 4);
      },
    },
  },
  events: {
    offer: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          mimeType: reader.string(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    sourceActions: {
      opcode: 1,
      since: 3,
      decodeReader(reader: MessageReader) {
        return {
          sourceActions: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    action: {
      opcode: 2,
      since: 3,
      decodeReader(reader: MessageReader) {
        return {
          dndAction: reader.uint(),
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
      invalidFinish: 0,
      invalidActionMask: 1,
      invalidAction: 2,
      invalidOffer: 3,
    },
  },
} as const;

export const wlDataSource = {
  name: "wl_data_source",
  version: 3,
  requests: {
    offer: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, mimeType: string): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.string(mimeType);
        return builder.build(targetId, 0);
      },
    },
    destroy: {
      opcode: 1,
      since: 1,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 1);
      },
    },
    setActions: {
      opcode: 2,
      since: 3,
      destructor: false,
      encode(targetId: number, dndActions: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(dndActions);
        return builder.build(targetId, 2);
      },
    },
  },
  events: {
    target: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          mimeType: reader.string(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    send: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          mimeType: reader.string(),
          fd: reader.fd(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    cancelled: {
      opcode: 2,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    dndDropPerformed: {
      opcode: 3,
      since: 3,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    dndFinished: {
      opcode: 4,
      since: 3,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    action: {
      opcode: 5,
      since: 3,
      decodeReader(reader: MessageReader) {
        return {
          dndAction: reader.uint(),
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
      invalidActionMask: 0,
      invalidSource: 1,
    },
  },
} as const;

export const wlDisplay = {
  name: "wl_display",
  version: 1,
  requests: {
    sync: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, callback: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(callback);
        return builder.build(targetId, 0);
      },
    },
    getRegistry: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, registry: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(registry);
        return builder.build(targetId, 1);
      },
    },
  },
  events: {
    error: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          objectId: reader.object(),
          code: reader.uint(),
          message: reader.string(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    deleteId: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          id: reader.uint(),
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
      invalidObject: 0,
      invalidMethod: 1,
      noMemory: 2,
      implementation: 3,
    },
  },
} as const;

export const wlKeyboard = {
  name: "wl_keyboard",
  version: 9,
  requests: {
    release: {
      opcode: 0,
      since: 3,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 0);
      },
    },
  },
  events: {
    keymap: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          format: reader.uint(),
          fd: reader.fd(),
          size: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    enter: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          surface: reader.object(),
          keys: reader.array(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    leave: {
      opcode: 2,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          surface: reader.object(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    key: {
      opcode: 3,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          time: reader.uint(),
          key: reader.uint(),
          state: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    modifiers: {
      opcode: 4,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          modsDepressed: reader.uint(),
          modsLatched: reader.uint(),
          modsLocked: reader.uint(),
          group: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    repeatInfo: {
      opcode: 5,
      since: 4,
      decodeReader(reader: MessageReader) {
        return {
          rate: reader.int(),
          delay: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
    keymapFormat: {
      noKeymap: 0,
      xkbV1: 1,
    },
    keyState: {
      released: 0,
      pressed: 1,
    },
  },
} as const;

export const wlOutput = {
  name: "wl_output",
  version: 4,
  requests: {
    release: {
      opcode: 0,
      since: 3,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 0);
      },
    },
  },
  events: {
    geometry: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          x: reader.int(),
          y: reader.int(),
          physicalWidth: reader.int(),
          physicalHeight: reader.int(),
          subpixel: reader.int(),
          make: reader.string(),
          model: reader.string(),
          transform: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    mode: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          flags: reader.uint(),
          width: reader.int(),
          height: reader.int(),
          refresh: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    done: {
      opcode: 2,
      since: 2,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    scale: {
      opcode: 3,
      since: 2,
      decodeReader(reader: MessageReader) {
        return {
          factor: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    name: {
      opcode: 4,
      since: 4,
      decodeReader(reader: MessageReader) {
        return {
          name: reader.string(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    description: {
      opcode: 5,
      since: 4,
      decodeReader(reader: MessageReader) {
        return {
          description: reader.string(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
    subpixel: {
      unknown: 0,
      none: 1,
      horizontalRgb: 2,
      horizontalBgr: 3,
      verticalRgb: 4,
      verticalBgr: 5,
    },
    transform: {
      normal: 0,
      value90: 1,
      value180: 2,
      value270: 3,
      flipped: 4,
      flipped90: 5,
      flipped180: 6,
      flipped270: 7,
    },
    mode: {
      current: 1,
      preferred: 2,
    },
  },
} as const;

export const wlPointer = {
  name: "wl_pointer",
  version: 9,
  requests: {
    setCursor: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, serial: number, surface: number | null, hotspotX: number, hotspotY: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(serial);
        builder.object(surface ?? 0);
        builder.int(hotspotX);
        builder.int(hotspotY);
        return builder.build(targetId, 0);
      },
    },
    release: {
      opcode: 1,
      since: 3,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 1);
      },
    },
  },
  events: {
    enter: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          surface: reader.object(),
          surfaceX: reader.fixed(),
          surfaceY: reader.fixed(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    leave: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          surface: reader.object(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    motion: {
      opcode: 2,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          time: reader.uint(),
          surfaceX: reader.fixed(),
          surfaceY: reader.fixed(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    button: {
      opcode: 3,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          time: reader.uint(),
          button: reader.uint(),
          state: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    axis: {
      opcode: 4,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          time: reader.uint(),
          axis: reader.uint(),
          value: reader.fixed(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    frame: {
      opcode: 5,
      since: 5,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    axisSource: {
      opcode: 6,
      since: 5,
      decodeReader(reader: MessageReader) {
        return {
          axisSource: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    axisStop: {
      opcode: 7,
      since: 5,
      decodeReader(reader: MessageReader) {
        return {
          time: reader.uint(),
          axis: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    axisDiscrete: {
      opcode: 8,
      since: 5,
      decodeReader(reader: MessageReader) {
        return {
          axis: reader.uint(),
          discrete: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    axisValue120: {
      opcode: 9,
      since: 8,
      decodeReader(reader: MessageReader) {
        return {
          axis: reader.uint(),
          value120: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    axisRelativeDirection: {
      opcode: 10,
      since: 9,
      decodeReader(reader: MessageReader) {
        return {
          axis: reader.uint(),
          direction: reader.uint(),
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
      role: 0,
    },
    buttonState: {
      released: 0,
      pressed: 1,
    },
    axis: {
      verticalScroll: 0,
      horizontalScroll: 1,
    },
    axisSource: {
      wheel: 0,
      finger: 1,
      continuous: 2,
      wheelTilt: 3,
    },
    axisRelativeDirection: {
      identical: 0,
      inverted: 1,
    },
  },
} as const;

export const wlRegion = {
  name: "wl_region",
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
    add: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, x: number, y: number, width: number, height: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(x);
        builder.int(y);
        builder.int(width);
        builder.int(height);
        return builder.build(targetId, 1);
      },
    },
    subtract: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, x: number, y: number, width: number, height: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(x);
        builder.int(y);
        builder.int(width);
        builder.int(height);
        return builder.build(targetId, 2);
      },
    },
  },
  events: {
  },
  enums: {
  },
} as const;

export const wlRegistry = {
  name: "wl_registry",
  version: 1,
  requests: {
    bind: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, name: number, interfaceValue: string, version: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(name);
        builder.string(interfaceValue);
        builder.uint(version);
        builder.newId(id);
        return builder.build(targetId, 0);
      },
    },
  },
  events: {
    global: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          name: reader.uint(),
          interfaceValue: reader.string(),
          version: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    globalRemove: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          name: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
  },
} as const;

export const wlSeat = {
  name: "wl_seat",
  version: 9,
  requests: {
    getPointer: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 0);
      },
    },
    getKeyboard: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 1);
      },
    },
    getTouch: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 2);
      },
    },
    release: {
      opcode: 3,
      since: 5,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 3);
      },
    },
  },
  events: {
    capabilities: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          capabilities: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    name: {
      opcode: 1,
      since: 2,
      decodeReader(reader: MessageReader) {
        return {
          name: reader.string(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
    capability: {
      pointer: 1,
      keyboard: 2,
      touch: 4,
    },
    error: {
      missingCapability: 0,
    },
  },
} as const;

export const wlShell = {
  name: "wl_shell",
  version: 1,
  requests: {
    getShellSurface: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number, surface: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.object(surface);
        return builder.build(targetId, 0);
      },
    },
  },
  events: {
  },
  enums: {
    error: {
      role: 0,
    },
  },
} as const;

export const wlShellSurface = {
  name: "wl_shell_surface",
  version: 1,
  requests: {
    pong: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, serial: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(serial);
        return builder.build(targetId, 0);
      },
    },
    move: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, seat: number, serial: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(seat);
        builder.uint(serial);
        return builder.build(targetId, 1);
      },
    },
    resize: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, seat: number, serial: number, edges: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(seat);
        builder.uint(serial);
        builder.uint(edges);
        return builder.build(targetId, 2);
      },
    },
    setToplevel: {
      opcode: 3,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 3);
      },
    },
    setTransient: {
      opcode: 4,
      since: 1,
      destructor: false,
      encode(targetId: number, parent: number, x: number, y: number, flags: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(parent);
        builder.int(x);
        builder.int(y);
        builder.uint(flags);
        return builder.build(targetId, 4);
      },
    },
    setFullscreen: {
      opcode: 5,
      since: 1,
      destructor: false,
      encode(targetId: number, method: number, framerate: number, output: number | null): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(method);
        builder.uint(framerate);
        builder.object(output ?? 0);
        return builder.build(targetId, 5);
      },
    },
    setPopup: {
      opcode: 6,
      since: 1,
      destructor: false,
      encode(targetId: number, seat: number, serial: number, parent: number, x: number, y: number, flags: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(seat);
        builder.uint(serial);
        builder.object(parent);
        builder.int(x);
        builder.int(y);
        builder.uint(flags);
        return builder.build(targetId, 6);
      },
    },
    setMaximized: {
      opcode: 7,
      since: 1,
      destructor: false,
      encode(targetId: number, output: number | null): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(output ?? 0);
        return builder.build(targetId, 7);
      },
    },
    setTitle: {
      opcode: 8,
      since: 1,
      destructor: false,
      encode(targetId: number, title: string): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.string(title);
        return builder.build(targetId, 8);
      },
    },
    setClass: {
      opcode: 9,
      since: 1,
      destructor: false,
      encode(targetId: number, classValue: string): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.string(classValue);
        return builder.build(targetId, 9);
      },
    },
  },
  events: {
    ping: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    configure: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          edges: reader.uint(),
          width: reader.int(),
          height: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    popupDone: {
      opcode: 2,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
  },
  enums: {
    resize: {
      none: 0,
      top: 1,
      bottom: 2,
      left: 4,
      topLeft: 5,
      bottomLeft: 6,
      right: 8,
      topRight: 9,
      bottomRight: 10,
    },
    transient: {
      inactive: 1,
    },
    fullscreenMethod: {
      defaultValue: 0,
      scale: 1,
      driver: 2,
      fill: 3,
    },
  },
} as const;

export const wlShm = {
  name: "wl_shm",
  version: 1,
  requests: {
    createPool: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number, fd: number, size: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.fd(fd);
        builder.int(size);
        return builder.build(targetId, 0);
      },
    },
  },
  events: {
    format: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          format: reader.uint(),
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
      invalidFormat: 0,
      invalidStride: 1,
      invalidFd: 2,
    },
    format: {
      argb8888: 0,
      xrgb8888: 1,
      c8: 538982467,
      rgb332: 943867730,
      bgr233: 944916290,
      xrgb4444: 842093144,
      xbgr4444: 842089048,
      rgbx4444: 842094674,
      bgrx4444: 842094658,
      argb4444: 842093121,
      abgr4444: 842089025,
      rgba4444: 842088786,
      bgra4444: 842088770,
      xrgb1555: 892424792,
      xbgr1555: 892420696,
      rgbx5551: 892426322,
      bgrx5551: 892426306,
      argb1555: 892424769,
      abgr1555: 892420673,
      rgba5551: 892420434,
      bgra5551: 892420418,
      rgb565: 909199186,
      bgr565: 909199170,
      rgb888: 875710290,
      bgr888: 875710274,
      xbgr8888: 875709016,
      rgbx8888: 875714642,
      bgrx8888: 875714626,
      abgr8888: 875708993,
      rgba8888: 875708754,
      bgra8888: 875708738,
      xrgb2101010: 808669784,
      xbgr2101010: 808665688,
      rgbx1010102: 808671314,
      bgrx1010102: 808671298,
      argb2101010: 808669761,
      abgr2101010: 808665665,
      rgba1010102: 808665426,
      bgra1010102: 808665410,
      yuyv: 1448695129,
      yvyu: 1431918169,
      uyvy: 1498831189,
      vyuy: 1498765654,
      ayuv: 1448433985,
      nv12: 842094158,
      nv21: 825382478,
      nv16: 909203022,
      nv61: 825644622,
      yuv410: 961959257,
      yvu410: 961893977,
      yuv411: 825316697,
      yvu411: 825316953,
      yuv420: 842093913,
      yvu420: 842094169,
      yuv422: 909202777,
      yvu422: 909203033,
      yuv444: 875713881,
      yvu444: 875714137,
      r8: 538982482,
      r16: 540422482,
      rg88: 943212370,
      gr88: 943215175,
      rg1616: 842221394,
      gr1616: 842224199,
      xrgb16161616f: 1211388504,
      xbgr16161616f: 1211384408,
      argb16161616f: 1211388481,
      abgr16161616f: 1211384385,
      xyuv8888: 1448434008,
      vuy888: 875713878,
      vuy101010: 808670550,
      y210: 808530521,
      y212: 842084953,
      y216: 909193817,
      y410: 808531033,
      y412: 842085465,
      y416: 909194329,
      xvyu2101010: 808670808,
      xvyu1216161616: 909334104,
      xvyu16161616: 942954072,
      y0l0: 810299481,
      x0l0: 810299480,
      y0l2: 843853913,
      x0l2: 843853912,
      yuv4208bit: 942691673,
      yuv42010bit: 808539481,
      xrgb8888A8: 943805016,
      xbgr8888A8: 943800920,
      rgbx8888A8: 943806546,
      bgrx8888A8: 943806530,
      rgb888A8: 943798354,
      bgr888A8: 943798338,
      rgb565A8: 943797586,
      bgr565A8: 943797570,
      nv24: 875714126,
      nv42: 842290766,
      p210: 808530512,
      p010: 808530000,
      p012: 842084432,
      p016: 909193296,
      axbxgxrx106106106106: 808534593,
      nv15: 892425806,
      q410: 808531025,
      q401: 825242705,
      xrgb16161616: 942953048,
      xbgr16161616: 942948952,
      argb16161616: 942953025,
      abgr16161616: 942948929,
    },
  },
} as const;

export const wlShmPool = {
  name: "wl_shm_pool",
  version: 1,
  requests: {
    createBuffer: {
      opcode: 0,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number, offset: number, width: number, height: number, stride: number, format: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.int(offset);
        builder.int(width);
        builder.int(height);
        builder.int(stride);
        builder.uint(format);
        return builder.build(targetId, 0);
      },
    },
    destroy: {
      opcode: 1,
      since: 1,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 1);
      },
    },
    resize: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, size: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(size);
        return builder.build(targetId, 2);
      },
    },
  },
  events: {
  },
  enums: {
  },
} as const;

export const wlSubcompositor = {
  name: "wl_subcompositor",
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
    getSubsurface: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number, surface: number, parent: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.object(surface);
        builder.object(parent);
        return builder.build(targetId, 1);
      },
    },
  },
  events: {
  },
  enums: {
    error: {
      badSurface: 0,
      badParent: 1,
    },
  },
} as const;

export const wlSubsurface = {
  name: "wl_subsurface",
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
    setPosition: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, x: number, y: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(x);
        builder.int(y);
        return builder.build(targetId, 1);
      },
    },
    placeAbove: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, sibling: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(sibling);
        return builder.build(targetId, 2);
      },
    },
    placeBelow: {
      opcode: 3,
      since: 1,
      destructor: false,
      encode(targetId: number, sibling: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(sibling);
        return builder.build(targetId, 3);
      },
    },
    setSync: {
      opcode: 4,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 4);
      },
    },
    setDesync: {
      opcode: 5,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 5);
      },
    },
  },
  events: {
  },
  enums: {
    error: {
      badSurface: 0,
    },
  },
} as const;

export const wlSurface = {
  name: "wl_surface",
  version: 6,
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
    attach: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, buffer: number | null, x: number, y: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(buffer ?? 0);
        builder.int(x);
        builder.int(y);
        return builder.build(targetId, 1);
      },
    },
    damage: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, x: number, y: number, width: number, height: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(x);
        builder.int(y);
        builder.int(width);
        builder.int(height);
        return builder.build(targetId, 2);
      },
    },
    frame: {
      opcode: 3,
      since: 1,
      destructor: false,
      encode(targetId: number, callback: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(callback);
        return builder.build(targetId, 3);
      },
    },
    setOpaqueRegion: {
      opcode: 4,
      since: 1,
      destructor: false,
      encode(targetId: number, region: number | null): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(region ?? 0);
        return builder.build(targetId, 4);
      },
    },
    setInputRegion: {
      opcode: 5,
      since: 1,
      destructor: false,
      encode(targetId: number, region: number | null): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(region ?? 0);
        return builder.build(targetId, 5);
      },
    },
    commit: {
      opcode: 6,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 6);
      },
    },
    setBufferTransform: {
      opcode: 7,
      since: 2,
      destructor: false,
      encode(targetId: number, transform: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(transform);
        return builder.build(targetId, 7);
      },
    },
    setBufferScale: {
      opcode: 8,
      since: 3,
      destructor: false,
      encode(targetId: number, scale: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(scale);
        return builder.build(targetId, 8);
      },
    },
    damageBuffer: {
      opcode: 9,
      since: 4,
      destructor: false,
      encode(targetId: number, x: number, y: number, width: number, height: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(x);
        builder.int(y);
        builder.int(width);
        builder.int(height);
        return builder.build(targetId, 9);
      },
    },
    offset: {
      opcode: 10,
      since: 5,
      destructor: false,
      encode(targetId: number, x: number, y: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(x);
        builder.int(y);
        return builder.build(targetId, 10);
      },
    },
  },
  events: {
    enter: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          output: reader.object(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    leave: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          output: reader.object(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    preferredBufferScale: {
      opcode: 2,
      since: 6,
      decodeReader(reader: MessageReader) {
        return {
          factor: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    preferredBufferTransform: {
      opcode: 3,
      since: 6,
      decodeReader(reader: MessageReader) {
        return {
          transform: reader.uint(),
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
      invalidScale: 0,
      invalidTransform: 1,
      invalidSize: 2,
      invalidOffset: 3,
      defunctRoleObject: 4,
    },
  },
} as const;

export const wlTouch = {
  name: "wl_touch",
  version: 9,
  requests: {
    release: {
      opcode: 0,
      since: 3,
      destructor: true,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 0);
      },
    },
  },
  events: {
    down: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          time: reader.uint(),
          surface: reader.object(),
          id: reader.int(),
          x: reader.fixed(),
          y: reader.fixed(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    up: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
          time: reader.uint(),
          id: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    motion: {
      opcode: 2,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          time: reader.uint(),
          id: reader.int(),
          x: reader.fixed(),
          y: reader.fixed(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    frame: {
      opcode: 3,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    cancel: {
      opcode: 4,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    shape: {
      opcode: 5,
      since: 6,
      decodeReader(reader: MessageReader) {
        return {
          id: reader.int(),
          major: reader.fixed(),
          minor: reader.fixed(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    orientation: {
      opcode: 6,
      since: 6,
      decodeReader(reader: MessageReader) {
        return {
          id: reader.int(),
          orientation: reader.fixed(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
  },
} as const;

export const xdgPopup = {
  name: "xdg_popup",
  version: 7,
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
    grab: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, seat: number, serial: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(seat);
        builder.uint(serial);
        return builder.build(targetId, 1);
      },
    },
    reposition: {
      opcode: 2,
      since: 3,
      destructor: false,
      encode(targetId: number, positioner: number, token: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(positioner);
        builder.uint(token);
        return builder.build(targetId, 2);
      },
    },
  },
  events: {
    configure: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          x: reader.int(),
          y: reader.int(),
          width: reader.int(),
          height: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    popupDone: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    repositioned: {
      opcode: 2,
      since: 3,
      decodeReader(reader: MessageReader) {
        return {
          token: reader.uint(),
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
      invalidGrab: 0,
    },
  },
} as const;

export const xdgPositioner = {
  name: "xdg_positioner",
  version: 7,
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
    setSize: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, width: number, height: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(width);
        builder.int(height);
        return builder.build(targetId, 1);
      },
    },
    setAnchorRect: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, x: number, y: number, width: number, height: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(x);
        builder.int(y);
        builder.int(width);
        builder.int(height);
        return builder.build(targetId, 2);
      },
    },
    setAnchor: {
      opcode: 3,
      since: 1,
      destructor: false,
      encode(targetId: number, anchor: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(anchor);
        return builder.build(targetId, 3);
      },
    },
    setGravity: {
      opcode: 4,
      since: 1,
      destructor: false,
      encode(targetId: number, gravity: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(gravity);
        return builder.build(targetId, 4);
      },
    },
    setConstraintAdjustment: {
      opcode: 5,
      since: 1,
      destructor: false,
      encode(targetId: number, constraintAdjustment: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(constraintAdjustment);
        return builder.build(targetId, 5);
      },
    },
    setOffset: {
      opcode: 6,
      since: 1,
      destructor: false,
      encode(targetId: number, x: number, y: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(x);
        builder.int(y);
        return builder.build(targetId, 6);
      },
    },
    setReactive: {
      opcode: 7,
      since: 3,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 7);
      },
    },
    setParentSize: {
      opcode: 8,
      since: 3,
      destructor: false,
      encode(targetId: number, parentWidth: number, parentHeight: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(parentWidth);
        builder.int(parentHeight);
        return builder.build(targetId, 8);
      },
    },
    setParentConfigure: {
      opcode: 9,
      since: 3,
      destructor: false,
      encode(targetId: number, serial: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(serial);
        return builder.build(targetId, 9);
      },
    },
  },
  events: {
  },
  enums: {
    error: {
      invalidInput: 0,
    },
    anchor: {
      none: 0,
      top: 1,
      bottom: 2,
      left: 3,
      right: 4,
      topLeft: 5,
      bottomLeft: 6,
      topRight: 7,
      bottomRight: 8,
    },
    gravity: {
      none: 0,
      top: 1,
      bottom: 2,
      left: 3,
      right: 4,
      topLeft: 5,
      bottomLeft: 6,
      topRight: 7,
      bottomRight: 8,
    },
    constraintAdjustment: {
      none: 0,
      slideX: 1,
      slideY: 2,
      flipX: 4,
      flipY: 8,
      resizeX: 16,
      resizeY: 32,
    },
  },
} as const;

export const xdgSurface = {
  name: "xdg_surface",
  version: 7,
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
    getToplevel: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 1);
      },
    },
    getPopup: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number, parent: number | null, positioner: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.object(parent ?? 0);
        builder.object(positioner);
        return builder.build(targetId, 2);
      },
    },
    setWindowGeometry: {
      opcode: 3,
      since: 1,
      destructor: false,
      encode(targetId: number, x: number, y: number, width: number, height: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(x);
        builder.int(y);
        builder.int(width);
        builder.int(height);
        return builder.build(targetId, 3);
      },
    },
    ackConfigure: {
      opcode: 4,
      since: 1,
      destructor: false,
      encode(targetId: number, serial: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(serial);
        return builder.build(targetId, 4);
      },
    },
  },
  events: {
    configure: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
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
      notConstructed: 1,
      alreadyConstructed: 2,
      unconfiguredBuffer: 3,
      invalidSerial: 4,
      invalidSize: 5,
      defunctRoleObject: 6,
    },
  },
} as const;

export const xdgToplevel = {
  name: "xdg_toplevel",
  version: 7,
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
    setParent: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, parent: number | null): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(parent ?? 0);
        return builder.build(targetId, 1);
      },
    },
    setTitle: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, title: string): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.string(title);
        return builder.build(targetId, 2);
      },
    },
    setAppId: {
      opcode: 3,
      since: 1,
      destructor: false,
      encode(targetId: number, appId: string): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.string(appId);
        return builder.build(targetId, 3);
      },
    },
    showWindowMenu: {
      opcode: 4,
      since: 1,
      destructor: false,
      encode(targetId: number, seat: number, serial: number, x: number, y: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(seat);
        builder.uint(serial);
        builder.int(x);
        builder.int(y);
        return builder.build(targetId, 4);
      },
    },
    move: {
      opcode: 5,
      since: 1,
      destructor: false,
      encode(targetId: number, seat: number, serial: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(seat);
        builder.uint(serial);
        return builder.build(targetId, 5);
      },
    },
    resize: {
      opcode: 6,
      since: 1,
      destructor: false,
      encode(targetId: number, seat: number, serial: number, edges: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(seat);
        builder.uint(serial);
        builder.uint(edges);
        return builder.build(targetId, 6);
      },
    },
    setMaxSize: {
      opcode: 7,
      since: 1,
      destructor: false,
      encode(targetId: number, width: number, height: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(width);
        builder.int(height);
        return builder.build(targetId, 7);
      },
    },
    setMinSize: {
      opcode: 8,
      since: 1,
      destructor: false,
      encode(targetId: number, width: number, height: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(width);
        builder.int(height);
        return builder.build(targetId, 8);
      },
    },
    setMaximized: {
      opcode: 9,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 9);
      },
    },
    unsetMaximized: {
      opcode: 10,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 10);
      },
    },
    setFullscreen: {
      opcode: 11,
      since: 1,
      destructor: false,
      encode(targetId: number, output: number | null): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.object(output ?? 0);
        return builder.build(targetId, 11);
      },
    },
    unsetFullscreen: {
      opcode: 12,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 12);
      },
    },
    setMinimized: {
      opcode: 13,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 13);
      },
    },
  },
  events: {
    configure: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          width: reader.int(),
          height: reader.int(),
          states: reader.array(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    close: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    configureBounds: {
      opcode: 2,
      since: 4,
      decodeReader(reader: MessageReader) {
        return {
          width: reader.int(),
          height: reader.int(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    wmCapabilities: {
      opcode: 3,
      since: 5,
      decodeReader(reader: MessageReader) {
        return {
          capabilities: reader.array(),
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
      invalidResizeEdge: 0,
      invalidParent: 1,
      invalidSize: 2,
    },
    resizeEdge: {
      none: 0,
      top: 1,
      bottom: 2,
      left: 4,
      topLeft: 5,
      bottomLeft: 6,
      right: 8,
      topRight: 9,
      bottomRight: 10,
    },
    state: {
      maximized: 1,
      fullscreen: 2,
      resizing: 3,
      activated: 4,
      tiledLeft: 5,
      tiledRight: 6,
      tiledTop: 7,
      tiledBottom: 8,
      suspended: 9,
      constrainedLeft: 10,
      constrainedRight: 11,
      constrainedTop: 12,
      constrainedBottom: 13,
    },
    wmCapabilities: {
      windowMenu: 1,
      maximize: 2,
      fullscreen: 3,
      minimize: 4,
    },
  },
} as const;

export const xdgWmBase = {
  name: "xdg_wm_base",
  version: 7,
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
    createPositioner: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 1);
      },
    },
    getXdgSurface: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number, surface: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.object(surface);
        return builder.build(targetId, 2);
      },
    },
    pong: {
      opcode: 3,
      since: 1,
      destructor: false,
      encode(targetId: number, serial: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(serial);
        return builder.build(targetId, 3);
      },
    },
  },
  events: {
    ping: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          serial: reader.uint(),
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
      role: 0,
      defunctSurfaces: 1,
      notTheTopmostPopup: 2,
      invalidPopupParent: 3,
      invalidSurfaceState: 4,
      invalidPositioner: 5,
      unresponsive: 6,
    },
  },
} as const;

export const zwpLinuxBufferParamsV1 = {
  name: "zwp_linux_buffer_params_v1",
  version: 5,
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
    add: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, fd: number, planeIdx: number, offset: number, stride: number, modifierHi: number, modifierLo: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.fd(fd);
        builder.uint(planeIdx);
        builder.uint(offset);
        builder.uint(stride);
        builder.uint(modifierHi);
        builder.uint(modifierLo);
        return builder.build(targetId, 1);
      },
    },
    create: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number, width: number, height: number, format: number, flags: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.int(width);
        builder.int(height);
        builder.uint(format);
        builder.uint(flags);
        return builder.build(targetId, 2);
      },
    },
    createImmed: {
      opcode: 3,
      since: 2,
      destructor: false,
      encode(targetId: number, bufferId: number, width: number, height: number, format: number, flags: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(bufferId);
        builder.int(width);
        builder.int(height);
        builder.uint(format);
        builder.uint(flags);
        return builder.build(targetId, 3);
      },
    },
  },
  events: {
    created: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          buffer: reader.newId(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    failed: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
  },
  enums: {
    error: {
      alreadyUsed: 0,
      planeIdx: 1,
      planeSet: 2,
      incomplete: 3,
      invalidFormat: 4,
      invalidDimensions: 5,
      outOfBounds: 6,
      invalidWlBuffer: 7,
    },
    flags: {
      yInvert: 1,
      interlaced: 2,
      bottomFirst: 4,
    },
  },
} as const;

export const zwpLinuxDmabufFeedbackV1 = {
  name: "zwp_linux_dmabuf_feedback_v1",
  version: 5,
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
  },
  events: {
    done: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    formatTable: {
      opcode: 1,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          fd: reader.fd(),
          size: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    mainDevice: {
      opcode: 2,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          device: reader.array(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    trancheDone: {
      opcode: 3,
      since: 1,
      decodeReader(reader: MessageReader) {
        void reader;
        return {};
      },
      decode(data: Buffer, fds: number[] = []) {
        void data;
        void fds;
        return {};
      },
    },
    trancheTargetDevice: {
      opcode: 4,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          device: reader.array(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    trancheFormats: {
      opcode: 5,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          indices: reader.array(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    trancheFlags: {
      opcode: 6,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          flags: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
    trancheFlags: {
      scanout: 1,
    },
  },
} as const;

export const zwpLinuxDmabufV1 = {
  name: "zwp_linux_dmabuf_v1",
  version: 5,
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
    createParams: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, paramsId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(paramsId);
        return builder.build(targetId, 1);
      },
    },
    getDefaultFeedback: {
      opcode: 2,
      since: 4,
      destructor: false,
      encode(targetId: number, id: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        return builder.build(targetId, 2);
      },
    },
    getSurfaceFeedback: {
      opcode: 3,
      since: 4,
      destructor: false,
      encode(targetId: number, id: number, surface: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.object(surface);
        return builder.build(targetId, 3);
      },
    },
  },
  events: {
    format: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          format: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
    modifier: {
      opcode: 1,
      since: 3,
      decodeReader(reader: MessageReader) {
        return {
          format: reader.uint(),
          modifierHi: reader.uint(),
          modifierLo: reader.uint(),
        };
      },
      decode(data: Buffer, fds: number[] = []) {
        const reader = new MessageReader(data, fds);
        return this.decodeReader(reader);
      },
    },
  },
  enums: {
  },
} as const;

export const zxdgDecorationManagerV1 = {
  name: "zxdg_decoration_manager_v1",
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
    getToplevelDecoration: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, id: number, toplevel: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.newId(id);
        builder.object(toplevel);
        return builder.build(targetId, 1);
      },
    },
  },
  events: {
  },
  enums: {
  },
} as const;

export const zxdgToplevelDecorationV1 = {
  name: "zxdg_toplevel_decoration_v1",
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
    setMode: {
      opcode: 1,
      since: 1,
      destructor: false,
      encode(targetId: number, mode: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        builder.uint(mode);
        return builder.build(targetId, 1);
      },
    },
    unsetMode: {
      opcode: 2,
      since: 1,
      destructor: false,
      encode(targetId: number): EncodedWaylandMessage {
        const builder = new MessageBuilder();
        return builder.build(targetId, 2);
      },
    },
  },
  events: {
    configure: {
      opcode: 0,
      since: 1,
      decodeReader(reader: MessageReader) {
        return {
          mode: reader.uint(),
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
      unconfiguredBuffer: 0,
      alreadyConstructed: 1,
      orphaned: 2,
      invalidMode: 3,
    },
    mode: {
      clientSide: 1,
      serverSide: 2,
    },
  },
} as const;

export const WAYLAND_INTERFACES = {
  wlBuffer,
  wlCallback,
  wlCompositor,
  wlDataDevice,
  wlDataDeviceManager,
  wlDataOffer,
  wlDataSource,
  wlDisplay,
  wlKeyboard,
  wlOutput,
  wlPointer,
  wlRegion,
  wlRegistry,
  wlSeat,
  wlShell,
  wlShellSurface,
  wlShm,
  wlShmPool,
  wlSubcompositor,
  wlSubsurface,
  wlSurface,
  wlTouch,
  xdgPopup,
  xdgPositioner,
  xdgSurface,
  xdgToplevel,
  xdgWmBase,
  zwpLinuxBufferParamsV1,
  zwpLinuxDmabufFeedbackV1,
  zwpLinuxDmabufV1,
  zxdgDecorationManagerV1,
  zxdgToplevelDecorationV1,
} as const;
