/**
 * Thin TypeScript + koffi bindings to Linux graphics/input libraries.
 */
export { isLinux, assertLinux } from "./platform.js";
export { LinuxReadinessDispatcher } from "./readiness.js";
export { listDrmConnectors, type DrmConnectorInfo } from "./drm.js";
export {
  readDisplayIdentity,
  type DisplayIdentity,
} from "./display-identity.js";
export {
  watchDrmHotplug,
  type DrmHotplugEvent,
  type DrmHotplugMonitor,
} from "./drm-hotplug.js";
export {
  openKmsOutput,
  openAdditionalKmsOutput,
  fillKmsColor,
  setKmsMode,
  refreshKmsOutputModes,
  switchKmsConnector,
  presentKms,
  presentKmsFramebuffer,
  setKmsCursor,
  moveKmsCursor,
  disableKmsCursor,
  closeKmsOutput,
  runClearColorLoop,
  type KmsOutput,
  type KmsMode,
  type KmsOutputRefresh,
  type KmsCursorImage,
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
export {
  EglOutputScaler,
  type EglOutputInfo,
  type EglScaleOutput,
  type EglDirectOutput,
  type EglDirectPresent,
  type EglCompositionLayer,
  type EglCompositionScene,
} from "./egl-output.js";
