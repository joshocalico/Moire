/**
 * SPA POD: PipeWire's self-describing binary values. Every POD is a `{ size, type }` header
 * (two native-endian uint32s; PipeWire runs little-endian on every Moire target) followed by
 * `size` body bytes, padded to 8. Array and Choice children are packed without padding.
 *
 * The decoder bounds depth and sizes and never reads outside its buffer; anything malformed
 * throws `PodError`. Unknown types decode to an opaque `Unknown` with their bytes.
 */
import { SpaChoice, SpaType } from "./spa";

export type PodScalar =
  | { readonly type: "None" }
  | { readonly type: "Bool"; readonly value: boolean }
  | { readonly type: "Id"; readonly value: number }
  | { readonly type: "Int"; readonly value: number }
  | { readonly type: "Long"; readonly value: bigint }
  | { readonly type: "Float"; readonly value: number }
  | { readonly type: "Double"; readonly value: number }
  | { readonly type: "Rectangle"; readonly width: number; readonly height: number }
  | { readonly type: "Fraction"; readonly num: number; readonly denom: number }
  | { readonly type: "Fd"; readonly value: bigint }
  | { readonly type: "Pointer"; readonly pointerType: number; readonly value: bigint };

export type PodScalarType = PodScalar["type"];

export type PodProp = { readonly key: number; readonly flags: number; readonly value: Pod };

export type Pod =
  | PodScalar
  | { readonly type: "String"; readonly value: string }
  | { readonly type: "Bytes"; readonly value: Uint8Array }
  | { readonly type: "Bitmap"; readonly value: Uint8Array }
  | {
      readonly type: "Array";
      readonly itemType: PodScalarType;
      readonly items: readonly PodScalar[];
    }
  | { readonly type: "Struct"; readonly fields: readonly Pod[] }
  | {
      readonly type: "Object";
      readonly objectType: number;
      readonly id: number;
      readonly props: readonly PodProp[];
    }
  | {
      readonly type: "Choice";
      readonly choice: number;
      readonly flags: number;
      readonly itemType: PodScalarType;
      readonly items: readonly PodScalar[];
    }
  | { readonly type: "Unknown"; readonly typeId: number; readonly bytes: Uint8Array };

export class PodError extends Error {}

const MAX_DEPTH = 32;
/** No single POD Moire reads or writes is anywhere near this. */
const MAX_POD_BYTES = 1 << 20;

/** Body size of each fixed-size scalar, as stored in arrays and choices. */
const SCALAR_SIZE: Record<PodScalarType, number> = {
  None: 0,
  Bool: 4,
  Id: 4,
  Int: 4,
  Long: 8,
  Float: 4,
  Double: 8,
  Rectangle: 8,
  Fraction: 8,
  Fd: 8,
  Pointer: 16,
};

const TYPE_NAME = new Map<number, Pod["type"]>(
  Object.entries(SpaType).flatMap(([name, id]) =>
    name === "Sequence" || name === "Pod" ? [] : [[id, name as Pod["type"]]],
  ),
);

const pad8 = (n: number) => (n + 7) & ~7;

// ── Encoding ─────────────────────────────────────────────────────────────

class Writer {
  bytes = new Uint8Array(256);
  view = new DataView(this.bytes.buffer);
  length = 0;

  reserve(n: number): number {
    const at = this.length;
    const need = at + n;
    if (need > MAX_POD_BYTES) throw new PodError("POD too large");
    if (need > this.bytes.length) {
      const next = new Uint8Array(Math.max(need, this.bytes.length * 2));
      next.set(this.bytes.subarray(0, this.length));
      this.bytes = next;
      this.view = new DataView(next.buffer);
    }
    this.length = need;
    return at;
  }
  u32(value: number) {
    // Reserve first: it may replace `view`.
    const at = this.reserve(4);
    this.view.setUint32(at, value >>> 0, true);
  }
  align() {
    const padded = pad8(this.length);
    const at = this.reserve(padded - this.length);
    this.bytes.fill(0, at, padded);
  }
  done(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

function typeId(type: Pod["type"]): number {
  if (type === "Unknown") throw new PodError("Unknown PODs carry their own type id");
  return SpaType[type];
}

function scalarBody(w: Writer, pod: PodScalar) {
  const size = SCALAR_SIZE[pod.type];
  const at = w.reserve(size);
  const v = w.view;
  switch (pod.type) {
    case "None":
      return;
    case "Bool":
      v.setInt32(at, pod.value ? 1 : 0, true);
      return;
    case "Id":
      v.setUint32(at, pod.value >>> 0, true);
      return;
    case "Int":
      v.setInt32(at, pod.value | 0, true);
      return;
    case "Long":
      v.setBigInt64(at, BigInt.asIntN(64, pod.value), true);
      return;
    case "Float":
      v.setFloat32(at, pod.value, true);
      return;
    case "Double":
      v.setFloat64(at, pod.value, true);
      return;
    case "Rectangle":
      v.setUint32(at, pod.width >>> 0, true);
      v.setUint32(at + 4, pod.height >>> 0, true);
      return;
    case "Fraction":
      v.setUint32(at, pod.num >>> 0, true);
      v.setUint32(at + 4, pod.denom >>> 0, true);
      return;
    case "Fd":
      v.setBigInt64(at, BigInt.asIntN(64, pod.value), true);
      return;
    case "Pointer":
      v.setUint32(at, pod.pointerType >>> 0, true);
      v.setUint32(at + 4, 0, true);
      v.setBigUint64(at + 8, BigInt.asUintN(64, pod.value), true);
      return;
  }
}

function packed(w: Writer, itemType: PodScalarType, items: readonly PodScalar[]) {
  w.u32(SCALAR_SIZE[itemType]);
  w.u32(SpaType[itemType]);
  for (const item of items) {
    if (item.type !== itemType) throw new PodError(`Mixed ${itemType} array`);
    scalarBody(w, item);
  }
}

function write(w: Writer, pod: Pod, depth: number) {
  if (depth > MAX_DEPTH) throw new PodError("POD nested too deeply");
  const header = w.reserve(8);
  const start = w.length;
  w.view.setUint32(header + 4, pod.type === "Unknown" ? pod.typeId : typeId(pod.type), true);
  switch (pod.type) {
    case "String": {
      const text = Buffer.from(pod.value, "utf8");
      if (text.includes(0)) throw new PodError("POD strings cannot contain NUL");
      const at = w.reserve(text.length + 1);
      w.bytes.set(text, at);
      w.bytes[at + text.length] = 0;
      break;
    }
    case "Bytes":
    case "Bitmap":
      w.bytes.set(pod.value, w.reserve(pod.value.length));
      break;
    case "Unknown":
      w.bytes.set(pod.bytes, w.reserve(pod.bytes.length));
      break;
    case "Array":
      packed(w, pod.itemType, pod.items);
      break;
    case "Choice":
      w.u32(pod.choice);
      w.u32(pod.flags);
      packed(w, pod.itemType, pod.items);
      break;
    case "Struct":
      for (const field of pod.fields) write(w, field, depth + 1);
      break;
    case "Object":
      w.u32(pod.objectType);
      w.u32(pod.id);
      for (const prop of pod.props) {
        w.u32(prop.key);
        w.u32(prop.flags);
        write(w, prop.value, depth + 1);
      }
      break;
    default:
      scalarBody(w, pod);
  }
  w.view.setUint32(header, w.length - start, true);
  w.align();
}

export function encodePod(pod: Pod): Uint8Array {
  const w = new Writer();
  write(w, pod, 0);
  return w.done();
}

// ── Decoding ─────────────────────────────────────────────────────────────

function scalarAt(view: DataView, at: number, type: PodScalarType): PodScalar {
  switch (type) {
    case "None":
      return { type };
    case "Bool":
      return { type, value: view.getInt32(at, true) !== 0 };
    case "Id":
      return { type, value: view.getUint32(at, true) };
    case "Int":
      return { type, value: view.getInt32(at, true) };
    case "Long":
      return { type, value: view.getBigInt64(at, true) };
    case "Float":
      return { type, value: view.getFloat32(at, true) };
    case "Double":
      return { type, value: view.getFloat64(at, true) };
    case "Rectangle":
      return { type, width: view.getUint32(at, true), height: view.getUint32(at + 4, true) };
    case "Fraction":
      return { type, num: view.getUint32(at, true), denom: view.getUint32(at + 4, true) };
    case "Fd":
      return { type, value: view.getBigInt64(at, true) };
    case "Pointer":
      return {
        type,
        pointerType: view.getUint32(at, true),
        value: view.getBigUint64(at + 8, true),
      };
  }
}

function scalarType(id: number): PodScalarType {
  const name = TYPE_NAME.get(id);
  if (!name || !(name in SCALAR_SIZE)) throw new PodError(`Unsupported array child type ${id}`);
  return name as PodScalarType;
}

function readPacked(view: DataView, at: number, end: number) {
  if (at + 8 > end) throw new PodError("Truncated array child");
  const childSize = view.getUint32(at, true);
  const itemType = scalarType(view.getUint32(at + 4, true));
  const items: PodScalar[] = [];
  const expected = SCALAR_SIZE[itemType];
  // An empty array may declare a zero child size; otherwise it must match the type.
  if (childSize !== expected && !(childSize === 0 && at + 8 === end))
    throw new PodError(`Bad ${itemType} child size ${childSize}`);
  if (expected > 0) {
    if ((end - at - 8) % expected !== 0) throw new PodError("Ragged array body");
    for (let item = at + 8; item < end; item += expected)
      items.push(scalarAt(view, item, itemType));
  }
  return { itemType, items };
}

function read(
  bytes: Uint8Array,
  view: DataView,
  at: number,
  limit: number,
  depth: number,
): { pod: Pod; end: number } {
  if (depth > MAX_DEPTH) throw new PodError("POD nested too deeply");
  if (at + 8 > limit) throw new PodError("Truncated POD header");
  const size = view.getUint32(at, true);
  const id = view.getUint32(at + 4, true);
  const body = at + 8;
  const end = body + size;
  if (size > MAX_POD_BYTES || end > limit) throw new PodError("POD body exceeds its buffer");
  const next = Math.min(limit, body + pad8(size));
  const name = TYPE_NAME.get(id);
  const need = (n: number) => {
    if (size < n) throw new PodError(`Short ${name} POD`);
  };
  let pod: Pod;
  switch (name) {
    case undefined:
      pod = { type: "Unknown", typeId: id, bytes: bytes.slice(body, end) };
      break;
    case "String": {
      need(1);
      if (bytes[end - 1] !== 0) throw new PodError("Unterminated POD string");
      pod = { type: "String", value: Buffer.from(bytes.subarray(body, end - 1)).toString("utf8") };
      break;
    }
    case "Bytes":
    case "Bitmap":
      pod = { type: name, value: bytes.slice(body, end) };
      break;
    case "Array":
      pod = { type: "Array", ...readPacked(view, body, end) };
      break;
    case "Choice":
      need(16);
      pod = {
        type: "Choice",
        choice: view.getUint32(body, true),
        flags: view.getUint32(body + 4, true),
        ...readPacked(view, body + 8, end),
      };
      break;
    case "Struct": {
      const fields: Pod[] = [];
      for (let field = body; field < end;) {
        const child = read(bytes, view, field, end, depth + 1);
        fields.push(child.pod);
        field = child.end;
      }
      pod = { type: "Struct", fields };
      break;
    }
    case "Object": {
      need(8);
      const props: PodProp[] = [];
      for (let prop = body + 8; prop < end;) {
        if (prop + 8 > end) throw new PodError("Truncated object property");
        const child = read(bytes, view, prop + 8, end, depth + 1);
        props.push({
          key: view.getUint32(prop, true),
          flags: view.getUint32(prop + 4, true),
          value: child.pod,
        });
        prop = child.end;
      }
      pod = {
        type: "Object",
        objectType: view.getUint32(body, true),
        id: view.getUint32(body + 4, true),
        props,
      };
      break;
    }
    default:
      need(SCALAR_SIZE[name as PodScalarType]);
      pod = scalarAt(view, body, name as PodScalarType);
  }
  return { pod, end: next };
}

/** Decode the POD at `offset`; `end` is the offset just past its padding. */
export function decodePod(bytes: Uint8Array, offset = 0): { pod: Pod; end: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return read(bytes, view, offset, bytes.length, 0);
}

// ── Builders and readers ─────────────────────────────────────────────────

export const P = {
  none: (): Pod => ({ type: "None" }),
  bool: (value: boolean): PodScalar => ({ type: "Bool", value }),
  id: (value: number): PodScalar => ({ type: "Id", value }),
  int: (value: number): PodScalar => ({ type: "Int", value }),
  long: (value: bigint): PodScalar => ({ type: "Long", value }),
  float: (value: number): PodScalar => ({ type: "Float", value }),
  double: (value: number): PodScalar => ({ type: "Double", value }),
  fd: (index: number): PodScalar => ({ type: "Fd", value: BigInt(index) }),
  /** A string, or None for null as PipeWire encodes a NULL `const char *`. */
  string: (value: string | null): Pod =>
    value === null ? { type: "None" } : { type: "String", value },
  bytes: (value: Uint8Array): Pod => ({ type: "Bytes", value }),
  rectangle: (width: number, height: number): PodScalar => ({ type: "Rectangle", width, height }),
  fraction: (num: number, denom: number): PodScalar => ({ type: "Fraction", num, denom }),
  struct: (...fields: Pod[]): Pod => ({ type: "Struct", fields }),
  array: (itemType: PodScalarType, items: readonly PodScalar[]): Pod => ({
    type: "Array",
    itemType,
    items,
  }),
  floats: (values: readonly number[]): Pod => P.array("Float", values.map(P.float)),
  ids: (values: readonly number[]): Pod => P.array("Id", values.map(P.id)),
  /** Properties in key order; `undefined` values are left out. */
  object: (
    objectType: number,
    id: number,
    props: Readonly<Record<number, Pod | undefined>> | readonly PodProp[],
  ): Pod => ({
    type: "Object",
    objectType,
    id,
    props: Array.isArray(props)
      ? props
      : Object.entries(props).flatMap(([key, value]) =>
          value ? [{ key: Number(key), flags: 0, value: value as Pod }] : [],
        ),
  }),
  choice: (
    choice: number,
    itemType: PodScalarType,
    items: readonly PodScalar[],
    flags = 0,
  ): Pod => ({
    type: "Choice",
    choice,
    flags,
    itemType,
    items,
  }),
  enumChoice: (itemType: PodScalarType, items: readonly PodScalar[]): Pod =>
    P.choice(SpaChoice.Enum, itemType, items),
};

/** The property `key` of an Object POD, if present. */
export function podProp(pod: Pod | undefined, key: number): Pod | undefined {
  return pod?.type === "Object" ? pod.props.find((prop) => prop.key === key)?.value : undefined;
}

/** A Choice's default (its first value); other PODs pass through. */
export function podValue(pod: Pod | undefined): Pod | undefined {
  return pod?.type === "Choice" ? pod.items[0] : pod;
}

export function podNumber(pod: Pod | undefined): number | undefined {
  const value = podValue(pod);
  switch (value?.type) {
    case "Int":
    case "Id":
    case "Float":
    case "Double":
      return value.value;
    case "Long":
      return Number(value.value);
    default:
      return undefined;
  }
}

export function podBool(pod: Pod | undefined): boolean | undefined {
  const value = podValue(pod);
  return value?.type === "Bool" ? value.value : undefined;
}

export function podString(pod: Pod | undefined): string | undefined {
  return pod?.type === "String" ? pod.value : undefined;
}

export function podNumbers(pod: Pod | undefined): number[] | undefined {
  if (pod?.type !== "Array") return undefined;
  return pod.items.flatMap((item) => {
    const n = podNumber(item);
    return n === undefined ? [] : [n];
  });
}
