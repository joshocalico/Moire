/**
 * SPA and PipeWire constants used on the wire. Values are from the PipeWire 1.x headers
 * (`spa/utils/type.h`, `spa/param/*.h`, `pipewire/*.h`); they are ABI and never change.
 */

/** POD value types (`enum spa_type`). */
export const SpaType = {
  None: 1,
  Bool: 2,
  Id: 3,
  Int: 4,
  Long: 5,
  Float: 6,
  Double: 7,
  String: 8,
  Bytes: 9,
  Rectangle: 10,
  Fraction: 11,
  Bitmap: 12,
  Array: 13,
  Struct: 14,
  Object: 15,
  Sequence: 16,
  Pointer: 17,
  Fd: 18,
  Choice: 19,
  Pod: 20,
} as const;

/** Object types (`SPA_TYPE_OBJECT_*`). */
export const SpaObjectType = {
  PropInfo: 0x40001,
  Props: 0x40002,
  Format: 0x40003,
  ParamBuffers: 0x40004,
  ParamMeta: 0x40005,
  ParamIO: 0x40006,
  ParamProfile: 0x40007,
  ParamPortConfig: 0x40008,
  ParamRoute: 0x40009,
} as const;

/** Param ids (`enum spa_param_type`). */
export const SpaParam = {
  PropInfo: 1,
  Props: 2,
  EnumFormat: 3,
  Format: 4,
  EnumProfile: 8,
  Profile: 9,
  EnumRoute: 12,
  Route: 13,
} as const;

/** `Props` object keys (`enum spa_prop`). */
export const SpaProp = {
  volume: 0x10003,
  mute: 0x10004,
  channelVolumes: 0x10008,
  volumeBase: 0x10009,
  volumeStep: 0x1000a,
  channelMap: 0x1000b,
  softMute: 0x1000f,
  softVolumes: 0x10010,
} as const;

/** `Route` object keys (`enum spa_param_route`). */
export const SpaRoute = {
  index: 1,
  direction: 2,
  device: 3,
  name: 4,
  description: 5,
  priority: 6,
  available: 7,
  info: 8,
  profiles: 9,
  props: 10,
  devices: 11,
  profile: 12,
  save: 13,
} as const;

/** `Profile` object keys (`enum spa_param_profile`). */
export const SpaProfile = {
  index: 1,
  name: 2,
  description: 3,
  priority: 4,
  available: 5,
  info: 6,
  classes: 7,
  save: 8,
} as const;

/** `Format` object keys (`enum spa_format`). */
export const SpaFormat = {
  mediaType: 1,
  mediaSubtype: 2,
  audioFormat: 0x10001,
  audioRate: 0x10003,
  audioChannels: 0x10004,
  audioPosition: 0x10005,
} as const;

export const SpaMediaType = { audio: 1 } as const;
export const SpaMediaSubtype = { raw: 1 } as const;

/** Sample formats (`enum spa_audio_format`) Moire uses. */
export const SpaAudioFormat = { S16LE: 0x103, S32LE: 0x10b, F32LE: 0x11b } as const;

/** Channel positions (`enum spa_audio_channel`). */
export const SpaChannel = {
  MONO: 2,
  FL: 3,
  FR: 4,
  FC: 5,
  LFE: 6,
  SL: 7,
  SR: 8,
  RL: 10,
  RR: 11,
} as const;

export const SpaDirection = { input: 0, output: 1 } as const;

/** `enum spa_param_availability`. */
export const SpaAvailability = { unknown: 0, no: 1, yes: 2 } as const;

/** `enum spa_choice_type`. */
export const SpaChoice = { None: 0, Range: 1, Step: 2, Enum: 3, Flags: 4 } as const;

/** Interface type names as the registry announces them. */
export const PwType = {
  Core: "PipeWire:Interface:Core",
  Client: "PipeWire:Interface:Client",
  Registry: "PipeWire:Interface:Registry",
  Node: "PipeWire:Interface:Node",
  Device: "PipeWire:Interface:Device",
  Port: "PipeWire:Interface:Port",
  Link: "PipeWire:Interface:Link",
  Metadata: "PipeWire:Interface:Metadata",
} as const;

/** Interface versions this client speaks (`PW_VERSION_*`). */
export const PwVersion = {
  Core: 4,
  Protocol: 3,
  Client: 3,
  Registry: 3,
  Node: 3,
  Device: 3,
  Port: 3,
  Link: 3,
  Metadata: 3,
} as const;

/** Global permission bits (`PW_PERM_*`). */
export const PwPerm = { R: 0o400, W: 0o200, X: 0o100, M: 0o010 } as const;

/** Reserved proxy ids: the core and this client's own Client object. */
export const PW_ID_CORE = 0;
export const PW_ID_CLIENT = 1;
