/**
 * Thin TypeScript + koffi bindings to Linux graphics/input libraries.
 */
export { isLinux, assertLinux } from "./platform.js";
export { listDrmConnectors, type DrmConnectorInfo } from "./drm.js";
export {
  openKmsOutput,
  fillKmsColor,
  setKmsMode,
  presentKms,
  closeKmsOutput,
  runClearColorLoop,
  type KmsOutput,
  type KmsMode,
  type Rgba,
} from "./kms.js";
export {
  getLibc,
  openPath,
  closeFd,
  mmap,
  munmap,
  memcpyTo,
  flushMmap,
  socketpairUnixStream,
  clearCloexec,
  peerCredentials,
  type PeerCredentials,
  PROT_READ,
  PROT_WRITE,
  MAP_SHARED,
  O_RDWR,
  O_CLOEXEC,
} from "./libc.js";
export {
  WaylandSocketServer,
  WaylandClientConn,
  type WaylandChunk,
} from "./unix.js";
export { createXkbKeymapMemfd, type KeymapMemfd } from "./keymap.js";
export { EvdevKeyboard, type EvdevKeyEvent } from "./evdev.js";
export {
  EvdevPointer,
  type EvdevPointerMotion,
  type EvdevPointerAbsolute,
  type EvdevPointerButton,
  type EvdevPointerAxis,
} from "./evdev-pointer.js";
export { GbmDevice, type GbmMappedPixels } from "./gbm.js";
