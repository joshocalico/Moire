export type DbusVariant = {
  signature: string;
  value: unknown;
};

export type DbusMessage = {
  type: 1 | 2 | 3 | 4;
  flags?: number;
  serial: number;
  path?: string;
  interface?: string;
  member?: string;
  errorName?: string;
  replySerial?: number;
  destination?: string;
  sender?: string;
  signature?: string;
  body?: unknown[];
};

type TypeNode = {
  code: string;
  child?: TypeNode;
  children?: TypeNode[];
};

function alignment(node: TypeNode): number {
  if (node.code === "(" || node.code === "{") return 8;
  if (node.code === "a" || "biuhsod".includes(node.code)) return 4;
  if ("nq".includes(node.code)) return 2;
  if ("xt".includes(node.code)) return 8;
  return 1;
}

function parseOne(signature: string, at: { value: number }): TypeNode {
  const code = signature[at.value++];
  if (!code) throw new Error(`Incomplete D-Bus signature: ${signature}`);
  if (code === "a") return { code, child: parseOne(signature, at) };
  if (code === "(" || code === "{") {
    const close = code === "(" ? ")" : "}";
    const children: TypeNode[] = [];
    while (signature[at.value] !== close) {
      if (at.value >= signature.length) {
        throw new Error(`Unclosed D-Bus container in ${signature}`);
      }
      children.push(parseOne(signature, at));
    }
    at.value++;
    return { code, children };
  }
  return { code };
}

function parseSignature(signature: string): TypeNode[] {
  const at = { value: 0 };
  const nodes: TypeNode[] = [];
  while (at.value < signature.length) nodes.push(parseOne(signature, at));
  return nodes;
}

export function splitSignature(signature: string): string[] {
  const at = { value: 0 };
  const parts: string[] = [];
  while (at.value < signature.length) {
    const start = at.value;
    parseOne(signature, at);
    parts.push(signature.slice(start, at.value));
  }
  return parts;
}

class Writer {
  private buffer = Buffer.alloc(256);
  offset = 0;

  constructor(private readonly baseOffset = 0) {}

  private reserve(bytes: number): void {
    if (this.offset + bytes <= this.buffer.length) return;
    let size = this.buffer.length;
    while (size < this.offset + bytes) size *= 2;
    const next = Buffer.alloc(size);
    this.buffer.copy(next, 0, 0, this.offset);
    this.buffer = next;
  }

  align(bytes: number): void {
    const padding = (bytes - ((this.baseOffset + this.offset) % bytes)) % bytes;
    this.reserve(padding);
    this.buffer.fill(0, this.offset, this.offset + padding);
    this.offset += padding;
  }

  u8(value: number): void {
    this.reserve(1);
    this.buffer.writeUInt8(value, this.offset++);
  }

  u16(value: number): void {
    this.align(2);
    this.reserve(2);
    this.buffer.writeUInt16LE(value, this.offset);
    this.offset += 2;
  }

  u32(value: number): void {
    this.align(4);
    this.reserve(4);
    this.buffer.writeUInt32LE(value >>> 0, this.offset);
    this.offset += 4;
  }

  i32(value: number): void {
    this.align(4);
    this.reserve(4);
    this.buffer.writeInt32LE(value, this.offset);
    this.offset += 4;
  }

  u64(value: bigint): void {
    this.align(8);
    this.reserve(8);
    this.buffer.writeBigUInt64LE(value, this.offset);
    this.offset += 8;
  }

  bytes(value: Buffer): void {
    this.reserve(value.length);
    value.copy(this.buffer, this.offset);
    this.offset += value.length;
  }

  patchU32(offset: number, value: number): void {
    this.buffer.writeUInt32LE(value >>> 0, offset);
  }

  finish(): Buffer {
    return this.buffer.subarray(0, this.offset);
  }
}

class Reader {
  constructor(
    readonly buffer: Buffer,
    public offset = 0,
  ) {}

  align(bytes: number): void {
    this.offset += (bytes - (this.offset % bytes)) % bytes;
  }

  u8(): number {
    return this.buffer.readUInt8(this.offset++);
  }

  u16(): number {
    this.align(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.align(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  i32(): number {
    this.align(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u64(): bigint {
    this.align(8);
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }
}

function writeString(writer: Writer, value: unknown, signature = false): void {
  const bytes = Buffer.from(String(value), "utf8");
  if (signature) writer.u8(bytes.length);
  else writer.u32(bytes.length);
  writer.bytes(bytes);
  writer.u8(0);
}

function entries(value: unknown): [unknown, unknown][] {
  if (value instanceof Map) return [...value.entries()];
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

function writeValue(writer: Writer, node: TypeNode, value: unknown): void {
  writer.align(alignment(node));
  switch (node.code) {
    case "y":
      writer.u8(Number(value));
      return;
    case "b":
      writer.u32(value ? 1 : 0);
      return;
    case "n":
    case "q":
      writer.u16(Number(value));
      return;
    case "i":
      writer.i32(Number(value));
      return;
    case "u":
    case "h":
      writer.u32(Number(value));
      return;
    case "x":
    case "t":
      writer.u64(BigInt(value as bigint | number | string));
      return;
    case "d": {
      const bytes = Buffer.alloc(8);
      bytes.writeDoubleLE(Number(value), 0);
      writer.bytes(bytes);
      return;
    }
    case "s":
    case "o":
      writeString(writer, value);
      return;
    case "g":
      writeString(writer, value, true);
      return;
    case "v": {
      const variant = value as DbusVariant;
      if (!variant?.signature) throw new Error("D-Bus variant needs a signature");
      writeString(writer, variant.signature, true);
      const variantNode = parseSignature(variant.signature)[0];
      if (!variantNode) throw new Error("D-Bus variant signature is empty");
      writeValue(writer, variantNode, variant.value);
      return;
    }
    case "a": {
      const child = node.child;
      if (!child) throw new Error("D-Bus array is missing its element type");
      const lengthAt = writer.offset;
      writer.u32(0);
      writer.align(alignment(child));
      const start = writer.offset;
      if (child.code === "{") {
        for (const pair of entries(value)) writeValue(writer, child, pair);
      } else {
        const values = Buffer.isBuffer(value) ? [...value] : (value as unknown[]);
        for (const item of values ?? []) writeValue(writer, child, item);
      }
      writer.patchU32(lengthAt, writer.offset - start);
      return;
    }
    case "(":
    case "{": {
      const values = value as unknown[];
      for (let index = 0; index < (node.children?.length ?? 0); index++) {
        writeValue(writer, node.children![index]!, values[index]);
      }
      return;
    }
    default:
      throw new Error(`Unsupported D-Bus type ${node.code}`);
  }
}

function readString(reader: Reader, signature = false): string {
  const length = signature ? reader.u8() : reader.u32();
  const value = reader.buffer.toString("utf8", reader.offset, reader.offset + length);
  reader.offset += length + 1;
  return value;
}

function readValue(reader: Reader, node: TypeNode): unknown {
  reader.align(alignment(node));
  switch (node.code) {
    case "y":
      return reader.u8();
    case "b":
      return reader.u32() !== 0;
    case "n":
    case "q":
      return reader.u16();
    case "i":
      return reader.i32();
    case "u":
    case "h":
      return reader.u32();
    case "x":
    case "t":
      return reader.u64();
    case "d": {
      const value = reader.buffer.readDoubleLE(reader.offset);
      reader.offset += 8;
      return value;
    }
    case "s":
    case "o":
      return readString(reader);
    case "g":
      return readString(reader, true);
    case "v": {
      const signature = readString(reader, true);
      const variantNode = parseSignature(signature)[0];
      if (!variantNode) throw new Error("D-Bus variant signature is empty");
      return { signature, value: readValue(reader, variantNode) } satisfies DbusVariant;
    }
    case "a": {
      const child = node.child;
      if (!child) throw new Error("D-Bus array is missing its element type");
      const byteLength = reader.u32();
      reader.align(alignment(child));
      const end = reader.offset + byteLength;
      if (child.code === "{" && child.children?.[0]?.code === "s") {
        const result: Record<string, unknown> = {};
        while (reader.offset < end) {
          const [key, value] = readValue(reader, child) as [string, unknown];
          result[key] = value;
        }
        return result;
      }
      const result: unknown[] = [];
      while (reader.offset < end) result.push(readValue(reader, child));
      return child.code === "y" ? Buffer.from(result as number[]) : result;
    }
    case "(":
    case "{":
      return (node.children ?? []).map((child) => readValue(reader, child));
    default:
      throw new Error(`Unsupported D-Bus type ${node.code}`);
  }
}

export function encodeBody(signature: string, values: unknown[]): Buffer {
  const writer = new Writer(0);
  const nodes = parseSignature(signature);
  if (nodes.length !== values.length) {
    throw new Error(`D-Bus body ${signature} expects ${nodes.length} values, got ${values.length}`);
  }
  nodes.forEach((node, index) => writeValue(writer, node, values[index]));
  return writer.finish();
}

export function decodeBody(signature: string, body: Buffer): unknown[] {
  const reader = new Reader(body);
  return parseSignature(signature).map((node) => readValue(reader, node));
}

const headerFieldCodes = {
  path: [1, "o"],
  interface: [2, "s"],
  member: [3, "s"],
  errorName: [4, "s"],
  replySerial: [5, "u"],
  destination: [6, "s"],
  sender: [7, "s"],
  signature: [8, "g"],
} as const;

export function encodeMessage(message: DbusMessage): Buffer {
  const signature = message.signature ?? "";
  const body = encodeBody(signature, message.body ?? []);
  const headerWriter = new Writer(16);
  for (const [key, [code, fieldSignature]] of Object.entries(headerFieldCodes)) {
    const value = message[key as keyof DbusMessage];
    if (value == null || value === "") continue;
    headerWriter.align(8);
    headerWriter.u8(code);
    writeValue(
      headerWriter,
      { code: "v" },
      {
        signature: fieldSignature,
        value,
      },
    );
  }
  const fields = headerWriter.finish();
  const headerEnd = 16 + fields.length;
  const bodyStart = (headerEnd + 7) & ~7;
  const output = Buffer.alloc(bodyStart + body.length);
  output.writeUInt8("l".charCodeAt(0), 0);
  output.writeUInt8(message.type, 1);
  output.writeUInt8(message.flags ?? 0, 2);
  output.writeUInt8(1, 3);
  output.writeUInt32LE(body.length, 4);
  output.writeUInt32LE(message.serial, 8);
  output.writeUInt32LE(fields.length, 12);
  fields.copy(output, 16);
  body.copy(output, bodyStart);
  return output;
}

export function messageByteLength(buffer: Buffer): number | null {
  if (buffer.length < 16) return null;
  if (buffer[0] !== "l".charCodeAt(0)) {
    throw new Error("Moire D-Bus currently supports little-endian peers only");
  }
  const bodyLength = buffer.readUInt32LE(4);
  const fieldsLength = buffer.readUInt32LE(12);
  return ((16 + fieldsLength + 7) & ~7) + bodyLength;
}

export function decodeMessage(buffer: Buffer): DbusMessage {
  const total = messageByteLength(buffer);
  if (total == null || buffer.length < total) throw new Error("Incomplete D-Bus message");
  const fieldsLength = buffer.readUInt32LE(12);
  const fieldsEnd = 16 + fieldsLength;
  const fieldsReader = new Reader(buffer, 16);
  const fields = new Map<number, unknown>();
  while (fieldsReader.offset < fieldsEnd) {
    fieldsReader.align(8);
    if (fieldsReader.offset >= fieldsEnd) break;
    const code = fieldsReader.u8();
    const variant = readValue(fieldsReader, { code: "v" }) as DbusVariant;
    fields.set(code, variant.value);
  }
  const signature = String(fields.get(8) ?? "");
  const bodyStart = (fieldsEnd + 7) & ~7;
  const bodyLength = buffer.readUInt32LE(4);
  return {
    type: buffer.readUInt8(1) as DbusMessage["type"],
    flags: buffer.readUInt8(2),
    serial: buffer.readUInt32LE(8),
    path: fields.get(1) as string | undefined,
    interface: fields.get(2) as string | undefined,
    member: fields.get(3) as string | undefined,
    errorName: fields.get(4) as string | undefined,
    replySerial: fields.get(5) as number | undefined,
    destination: fields.get(6) as string | undefined,
    sender: fields.get(7) as string | undefined,
    signature,
    body: decodeBody(signature, buffer.subarray(bodyStart, bodyStart + bodyLength)),
  };
}
