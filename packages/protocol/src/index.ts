/**
 * Wayland wire protocol encode/decode.
 */

export const WAYLAND_DISPLAY_DEFAULT = "wayland-0";
export const WL_HEADER_SIZE = 8;

export type WaylandHeader = {
  objectId: number;
  opcode: number;
  size: number;
};

export function decodeHeader(buf: Buffer, offset = 0): WaylandHeader {
  const objectId = buf.readUInt32LE(offset);
  const sizeOpcode = buf.readUInt32LE(offset + 4);
  const size = sizeOpcode >>> 16;
  const opcode = sizeOpcode & 0xffff;
  return { objectId, opcode, size };
}

export function encodeHeader(
  objectId: number,
  opcode: number,
  size: number,
): Buffer {
  const buf = Buffer.alloc(WL_HEADER_SIZE);
  buf.writeUInt32LE(objectId, 0);
  buf.writeUInt32LE(((size & 0xffff) << 16) | (opcode & 0xffff), 4);
  return buf;
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

/** Build a Wayland message (server → client or client → server). */
export class MessageBuilder {
  private parts: Buffer[] = [];
  private fds: number[] = [];

  uint(v: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    this.parts.push(b);
    return this;
  }

  int(v: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v, 0);
    this.parts.push(b);
    return this;
  }

  fixed(v: number): this {
    // 24.8 fixed
    return this.int((v * 256) | 0);
  }

  object(id: number): this {
    return this.uint(id);
  }

  newId(id: number): this {
    return this.uint(id);
  }

  string(s: string | null): this {
    if (s === null) {
      this.uint(0);
      return this;
    }
    const str = Buffer.from(s, "utf8");
    const len = str.length + 1; // include NUL
    this.uint(len);
    const padded = Buffer.alloc(align4(len));
    str.copy(padded);
    this.parts.push(padded);
    return this;
  }

  array(buf: Buffer): this {
    this.uint(buf.length);
    const padded = Buffer.alloc(align4(buf.length));
    buf.copy(padded);
    this.parts.push(padded);
    return this;
  }

  fd(fd: number): this {
    this.fds.push(fd);
    return this;
  }

  build(objectId: number, opcode: number): { data: Buffer; fds: number[] } {
    const body = Buffer.concat(this.parts);
    const size = WL_HEADER_SIZE + body.length;
    const header = encodeHeader(objectId, opcode, size);
    return { data: Buffer.concat([header, body]), fds: this.fds };
  }
}

export type ArgType =
  | "int"
  | "uint"
  | "fixed"
  | "object"
  | "new_id"
  | "string"
  | "array"
  | "fd";

export class MessageReader {
  private offset: number;
  private fdIndex = 0;

  constructor(
    private readonly buf: Buffer,
    private readonly fds: number[],
    headerSize = WL_HEADER_SIZE,
  ) {
    this.offset = headerSize;
  }

  uint(): number {
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  int(): number {
    const v = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  object(): number {
    return this.uint();
  }

  newId(): number {
    return this.uint();
  }

  string(): string | null {
    const len = this.uint();
    if (len === 0) return null;
    const s = this.buf.toString("utf8", this.offset, this.offset + len - 1);
    this.offset += align4(len);
    return s;
  }

  array(): Buffer {
    const len = this.uint();
    const slice = this.buf.subarray(this.offset, this.offset + len);
    this.offset += align4(len);
    return Buffer.from(slice);
  }

  fd(): number {
    const fd = this.fds[this.fdIndex++];
    if (fd === undefined) throw new Error("Missing fd in Wayland message");
    return fd;
  }
}

/** Interface name → version advertised in registry. */
export const CORE_GLOBALS = {
  wl_compositor: 4,
  wl_shm: 1,
  wl_subcompositor: 1,
  wl_seat: 5,
  wl_output: 3,
  wl_data_device_manager: 3,
  xdg_wm_base: 3,
  /** Negotiates zxdg_decoration; compositor prefers server (React SSD). */
  zxdg_decoration_manager_v1: 1,
  /**
   * Mesa/Xwayland still look up wl_drm for Glamor/EGL init even when
   * linux-dmabuf v4 feedback is present. Advertise the render node here.
   */
  wl_drm: 2,
  /** v4: format/modifier events + get_*_feedback for Mesa/GTK device discovery. */
  zwp_linux_dmabuf_v1: 4,
  /**
   * Rootless Xwayland — associate X11 windows with wl_surfaces.
   * Intended for the Xwayland client only.
   */
  xwayland_shell_v1: 1,
} as const;
