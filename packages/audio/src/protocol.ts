/**
 * PipeWire native protocol v3: framing and the messages Moire sends and handles.
 *
 * A message is a 16-byte header `{ id, opcode << 24 | size, seq, n_fds }` and `size` bytes of
 * payload: one Struct POD of arguments, possibly followed by footer PODs (ignored). Fd arguments
 * index the message's own fds, which arrive with it over SCM_RIGHTS.
 *
 * Both directions are here so the fake server in `testing/` speaks exactly what the client does.
 */
import { decodePod, encodePod, P, PodError, type Pod } from "./pod";

export const HEADER_SIZE = 16;
/** Refuse anything larger; real control messages are a few KiB. */
export const MAX_MESSAGE = 1 << 20;
const MAX_FDS = 28;
const MAX_DICT_ITEMS = 1024;

export const CoreMethod = {
  hello: 1,
  sync: 2,
  pong: 3,
  error: 4,
  getRegistry: 5,
  createObject: 6,
  destroy: 7,
} as const;
export const CoreEvent = {
  info: 0,
  done: 1,
  ping: 2,
  error: 3,
  removeId: 4,
  boundId: 5,
  addMem: 6,
  removeMem: 7,
  boundProps: 8,
} as const;
export const RegistryMethod = { bind: 1, destroy: 2 } as const;
export const RegistryEvent = { global: 0, globalRemove: 1 } as const;
export const ClientMethod = { error: 1, updateProperties: 2 } as const;
export const ClientEvent = { info: 0, permissions: 1 } as const;
/** Node, Device and Port share these opcodes (Port has no set_param). */
export const ParamsMethod = { subscribeParams: 1, enumParams: 2, setParam: 3 } as const;
export const ParamsEvent = { info: 0, param: 1 } as const;
export const MetadataMethod = { setProperty: 1, clear: 2 } as const;
export const MetadataEvent = { property: 0 } as const;

export type Dict = Readonly<Record<string, string>>;

export type RawMessage = {
  readonly id: number;
  readonly opcode: number;
  readonly seq: number;
  readonly payload: Uint8Array;
  readonly fds: readonly number[];
};

export class ProtocolError extends Error {}

// ── Framing ──────────────────────────────────────────────────────────────

export function encodeMessage(
  id: number,
  opcode: number,
  seq: number,
  args: readonly Pod[],
  nFds = 0,
): Uint8Array {
  const payload = encodePod(P.struct(...args));
  if (payload.length > MAX_MESSAGE || payload.length > 0xffffff)
    throw new ProtocolError("Message too large");
  const out = new Uint8Array(HEADER_SIZE + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, id >>> 0, true);
  view.setUint32(4, ((opcode & 0xff) << 24) | payload.length, true);
  view.setUint32(8, seq >>> 0, true);
  view.setUint32(12, nFds, true);
  out.set(payload, HEADER_SIZE);
  return out;
}

/** Reassembles messages from stream chunks; each message takes its fds from the queue. */
export class MessageReader {
  private buffer = new Uint8Array(0);
  private readonly fds: number[] = [];

  /** Without fd passing the kernel drops sent fds; their slots then read as -1. */
  constructor(private readonly fdPassing = true) {}

  push(data: Uint8Array, fds: readonly number[] = []): void {
    if (fds.length) this.fds.push(...fds);
    if (!data.length) return;
    const next = new Uint8Array(this.buffer.length + data.length);
    next.set(this.buffer);
    next.set(data, this.buffer.length);
    this.buffer = next;
  }

  /** The next whole message, or null until more bytes arrive. Throws on a malformed header. */
  next(): RawMessage | null {
    if (this.buffer.length < HEADER_SIZE) return null;
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, HEADER_SIZE);
    const word = view.getUint32(4, true);
    const size = word & 0xffffff;
    const nFds = view.getUint32(12, true);
    if (size > MAX_MESSAGE) throw new ProtocolError("Message too large");
    if (nFds > MAX_FDS) throw new ProtocolError("Too many fds in one message");
    if (this.buffer.length < HEADER_SIZE + size) return null;
    if (this.fds.length < nFds) {
      if (this.fdPassing) throw new ProtocolError("Message fds missing");
      this.fds.push(...Array.from({ length: nFds - this.fds.length }, () => -1));
    }
    const message: RawMessage = {
      id: view.getUint32(0, true),
      opcode: word >>> 24,
      seq: view.getUint32(8, true),
      payload: this.buffer.slice(HEADER_SIZE, HEADER_SIZE + size),
      fds: this.fds.splice(0, nFds),
    };
    this.buffer = this.buffer.slice(HEADER_SIZE + size);
    return message;
  }

  /** Fds received but not claimed by any message (closed by the owner on teardown). */
  drainFds(): number[] {
    return this.fds.splice(0);
  }
}

// ── Argument access ──────────────────────────────────────────────────────

/** The arguments of a message: the fields of its first Struct POD. */
export function messageArgs(message: RawMessage): readonly Pod[] {
  let pod: Pod;
  try {
    pod = decodePod(message.payload).pod;
  } catch (error) {
    throw new ProtocolError(error instanceof PodError ? error.message : "Bad message payload");
  }
  if (pod.type !== "Struct") throw new ProtocolError("Message payload is not a Struct");
  return pod.fields;
}

function arg(args: readonly Pod[], index: number): Pod {
  const pod = args[index];
  if (!pod) throw new ProtocolError(`Missing argument ${index}`);
  return pod;
}

export function argInt(args: readonly Pod[], index: number): number {
  const pod = arg(args, index);
  if (pod.type === "Int" || pod.type === "Id") return pod.value;
  throw new ProtocolError(`Argument ${index} is ${pod.type}, not Int`);
}

export function argLong(args: readonly Pod[], index: number): bigint {
  const pod = arg(args, index);
  if (pod.type === "Long") return pod.value;
  if (pod.type === "Int") return BigInt(pod.value);
  throw new ProtocolError(`Argument ${index} is ${pod.type}, not Long`);
}

/** A string argument; PipeWire sends a NULL string as None. */
export function argString(args: readonly Pod[], index: number): string | null {
  const pod = arg(args, index);
  if (pod.type === "String") return pod.value;
  if (pod.type === "None") return null;
  throw new ProtocolError(`Argument ${index} is ${pod.type}, not String`);
}

export function argPod(args: readonly Pod[], index: number): Pod | null {
  const pod = arg(args, index);
  return pod.type === "None" ? null : pod;
}

export function argFd(args: readonly Pod[], index: number, fds: readonly number[]): number {
  const pod = arg(args, index);
  if (pod.type !== "Fd") throw new ProtocolError(`Argument ${index} is ${pod.type}, not Fd`);
  const fd = pod.value < 0n ? undefined : fds[Number(pod.value)];
  if (fd === undefined) throw new ProtocolError("Fd argument out of range");
  return fd;
}

export function encodeDict(dict: Dict): Pod {
  const entries = Object.entries(dict);
  return P.struct(
    P.int(entries.length),
    ...entries.flatMap(([k, v]) => [P.string(k), P.string(v)]),
  );
}

export function decodeDict(pod: Pod): Dict {
  if (pod.type !== "Struct") throw new ProtocolError("Dict is not a Struct");
  const [count, ...items] = pod.fields;
  if (count?.type !== "Int" || count.value < 0 || count.value > MAX_DICT_ITEMS)
    throw new ProtocolError("Bad dict size");
  if (items.length < count.value * 2) throw new ProtocolError("Truncated dict");
  const dict: Record<string, string> = Object.create(null);
  for (let i = 0; i < count.value; i++) {
    const key = items[i * 2]!;
    const value = items[i * 2 + 1]!;
    if (key.type !== "String") throw new ProtocolError("Dict key is not a String");
    if (value.type === "String") dict[key.value] = value.value;
    else if (value.type !== "None") throw new ProtocolError("Dict value is not a String");
  }
  return dict;
}

export type ParamInfo = { readonly id: number; readonly flags: number };

function encodeParamInfos(params: readonly ParamInfo[]): Pod {
  return P.struct(P.int(params.length), ...params.flatMap((p) => [P.id(p.id), P.int(p.flags)]));
}

function decodeParamInfos(pod: Pod | undefined): ParamInfo[] {
  if (pod?.type !== "Struct") return [];
  const [count, ...items] = pod.fields;
  if (count?.type !== "Int" || count.value < 0 || items.length < count.value * 2) return [];
  const out: ParamInfo[] = [];
  for (let i = 0; i < count.value; i++) {
    const id = items[i * 2]!;
    const flags = items[i * 2 + 1]!;
    if ((id.type === "Id" || id.type === "Int") && flags.type === "Int")
      out.push({ id: id.value, flags: flags.value });
  }
  return out;
}

// ── Client → server methods ──────────────────────────────────────────────

export const methods = {
  hello: (version: number) => [P.int(version)],
  sync: (id: number, seq: number) => [P.int(id), P.int(seq)],
  pong: (id: number, seq: number) => [P.int(id), P.int(seq)],
  getRegistry: (version: number, newId: number) => [P.int(version), P.int(newId)],
  coreDestroy: (id: number) => [P.int(id)],
  updateProperties: (props: Dict) => [encodeDict(props)],
  bind: (id: number, type: string, version: number, newId: number) => [
    P.int(id),
    P.string(type),
    P.int(version),
    P.int(newId),
  ],
  subscribeParams: (ids: readonly number[]) => [P.ids(ids)],
  enumParams: (seq: number, id: number, index: number, num: number, filter: Pod | null) => [
    P.int(seq),
    P.id(id),
    P.int(index),
    P.int(num),
    filter ?? P.none(),
  ],
  setParam: (id: number, flags: number, param: Pod) => [P.id(id), P.int(flags), param],
  setProperty: (subject: number, key: string, type: string | null, value: string | null) => [
    P.int(subject),
    P.string(key),
    P.string(type),
    P.string(value),
  ],
  clear: () => [] as Pod[],
};

// ── Server → client events ───────────────────────────────────────────────

export type CoreInfo = {
  readonly id: number;
  readonly cookie: number;
  readonly userName: string | null;
  readonly hostName: string | null;
  readonly version: string | null;
  readonly name: string | null;
  readonly props: Dict;
};
export type GlobalInfo = {
  readonly id: number;
  readonly permissions: number;
  readonly type: string;
  readonly version: number;
  readonly props: Dict;
};
export type NodeInfo = {
  readonly id: number;
  /** Which fields changed; unchanged props and params arrive empty. */
  readonly changeMask?: bigint;
  readonly state: number;
  readonly error: string | null;
  readonly props: Dict;
  readonly params: readonly ParamInfo[];
};
export type DeviceInfo = {
  readonly id: number;
  /** Which fields changed; unchanged props and params arrive empty. */
  readonly changeMask?: bigint;
  readonly props: Dict;
  readonly params: readonly ParamInfo[];
};
export type PortInfo = {
  readonly id: number;
  /** Which fields changed; unchanged props and params arrive empty. */
  readonly changeMask?: bigint;
  readonly direction: number;
  readonly props: Dict;
  readonly params: readonly ParamInfo[];
};
export type LinkInfo = {
  readonly id: number;
  /** Which fields changed; unchanged props and params arrive empty. */
  readonly changeMask?: bigint;
  readonly outputNode: number;
  readonly outputPort: number;
  readonly inputNode: number;
  readonly inputPort: number;
  readonly state: number;
  readonly error: string | null;
  readonly props: Dict;
};
export type ParamEvent = {
  readonly seq: number;
  readonly id: number;
  readonly index: number;
  readonly next: number;
  readonly param: Pod | null;
};
export type MetadataProperty = {
  readonly subject: number;
  readonly key: string | null;
  readonly type: string | null;
  readonly value: string | null;
};

const changes = (mask: bigint | undefined) => P.long(mask ?? -1n);

/** `PW_*_CHANGE_MASK_*` bits for props and params. */
export const ChangeMask = {
  nodeProps: 1n << 3n,
  nodeParams: 1n << 4n,
  deviceProps: 1n << 0n,
  deviceParams: 1n << 1n,
  portProps: 1n << 0n,
  portParams: 1n << 1n,
  linkProps: 1n << 2n,
} as const;

export const events = {
  coreInfo: (info: CoreInfo) => [
    P.int(info.id),
    P.int(info.cookie),
    P.string(info.userName),
    P.string(info.hostName),
    P.string(info.version),
    P.string(info.name),
    changes(undefined),
    encodeDict(info.props),
  ],
  done: (id: number, seq: number) => [P.int(id), P.int(seq)],
  ping: (id: number, seq: number) => [P.int(id), P.int(seq)],
  error: (id: number, seq: number, res: number, message: string) => [
    P.int(id),
    P.int(seq),
    P.int(res),
    P.string(message),
  ],
  removeId: (id: number) => [P.int(id)],
  boundId: (id: number, globalId: number) => [P.int(id), P.int(globalId)],
  addMem: (id: number, type: number, fdIndex: number, flags: number) => [
    P.int(id),
    P.id(type),
    P.fd(fdIndex),
    P.int(flags),
  ],
  global: (info: GlobalInfo) => [
    P.int(info.id),
    P.int(info.permissions),
    P.string(info.type),
    P.int(info.version),
    encodeDict(info.props),
  ],
  globalRemove: (id: number) => [P.int(id)],
  nodeInfo: (info: NodeInfo) => [
    P.int(info.id),
    P.int(0),
    P.int(0),
    changes(info.changeMask),
    P.int(0),
    P.int(0),
    P.id(info.state),
    P.string(info.error),
    encodeDict(info.props),
    encodeParamInfos(info.params),
  ],
  deviceInfo: (info: DeviceInfo) => [
    P.int(info.id),
    changes(info.changeMask),
    encodeDict(info.props),
    encodeParamInfos(info.params),
  ],
  portInfo: (info: PortInfo) => [
    P.int(info.id),
    P.id(info.direction),
    changes(info.changeMask),
    encodeDict(info.props),
    encodeParamInfos(info.params),
  ],
  linkInfo: (info: LinkInfo) => [
    P.int(info.id),
    P.int(info.outputNode),
    P.int(info.outputPort),
    P.int(info.inputNode),
    P.int(info.inputPort),
    changes(info.changeMask),
    P.int(info.state),
    P.string(info.error),
    P.none(),
    encodeDict(info.props),
  ],
  param: (event: ParamEvent) => [
    P.int(event.seq),
    P.id(event.id),
    P.int(event.index),
    P.int(event.next),
    event.param ?? P.none(),
  ],
  property: (property: MetadataProperty) => [
    P.int(property.subject),
    P.string(property.key),
    P.string(property.type),
    P.string(property.value),
  ],
};

export const decode = {
  coreInfo(args: readonly Pod[]): CoreInfo {
    return {
      id: argInt(args, 0),
      cookie: argInt(args, 1),
      userName: argString(args, 2),
      hostName: argString(args, 3),
      version: argString(args, 4),
      name: argString(args, 5),
      props: decodeDict(arg(args, 7)),
    };
  },
  global(args: readonly Pod[]): GlobalInfo {
    const type = argString(args, 2);
    if (!type) throw new ProtocolError("Global without a type");
    return {
      id: argInt(args, 0),
      permissions: argInt(args, 1),
      type,
      version: argInt(args, 3),
      props: decodeDict(arg(args, 4)),
    };
  },
  nodeInfo(args: readonly Pod[]): NodeInfo {
    return {
      id: argInt(args, 0),
      changeMask: argLong(args, 3),
      state: argInt(args, 6),
      error: argString(args, 7),
      props: decodeDict(arg(args, 8)),
      params: decodeParamInfos(args[9]),
    };
  },
  deviceInfo(args: readonly Pod[]): DeviceInfo {
    return {
      id: argInt(args, 0),
      changeMask: argLong(args, 1),
      props: decodeDict(arg(args, 2)),
      params: decodeParamInfos(args[3]),
    };
  },
  portInfo(args: readonly Pod[]): PortInfo {
    return {
      id: argInt(args, 0),
      direction: argInt(args, 1),
      changeMask: argLong(args, 2),
      props: decodeDict(arg(args, 3)),
      params: decodeParamInfos(args[4]),
    };
  },
  linkInfo(args: readonly Pod[]): LinkInfo {
    return {
      id: argInt(args, 0),
      outputNode: argInt(args, 1),
      outputPort: argInt(args, 2),
      inputNode: argInt(args, 3),
      inputPort: argInt(args, 4),
      changeMask: argLong(args, 5),
      state: argInt(args, 6),
      error: argString(args, 7),
      props: decodeDict(arg(args, 9)),
    };
  },
  param(args: readonly Pod[]): ParamEvent {
    return {
      seq: argInt(args, 0),
      id: argInt(args, 1),
      index: argInt(args, 2),
      next: argInt(args, 3),
      param: argPod(args, 4),
    };
  },
  property(args: readonly Pod[]): MetadataProperty {
    return {
      subject: argInt(args, 0),
      key: argString(args, 1),
      type: argString(args, 2),
      value: argString(args, 3),
    };
  },
};
