/**
 * Thin TypeScript + koffi bindings to Linux graphics/input libraries.
 */
export { isLinux, assertLinux } from "./platform";
export { LinuxReadinessDispatcher } from "./readiness";
export { listDrmConnectors, type DrmConnectorInfo } from "./drm";
export { readDisplayIdentity, type DisplayIdentity } from "./display-identity";
export { watchDrmHotplug, type DrmHotplugEvent, type DrmHotplugMonitor } from "./drm-hotplug";
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
  type KmsPresentationFeedback,
  type Rgba,
} from "./kms";
export {
  openPath,
  closeFd,
  mmap,
  munmap,
  memcpyTo,
  flushMmap,
  socketpairUnixStream,
  clearCloexec,
  peerCredentials,
  nativeView,
  createPipe,
  ioctlFd,
  ioctlUint64,
  createMemfd,
  truncateFd,
  writeFd,
  seekFd,
  type PeerCredentials,
  PROT_READ,
  PROT_WRITE,
  MAP_SHARED,
  O_RDWR,
  O_CLOEXEC,
} from "./libc";
export { WaylandSocketServer, WaylandClientConn, type WaylandChunk } from "./unix";
export { createXkbKeymapMemfd, type KeymapMemfd } from "./keymap";
export { EvdevKeyboard, type EvdevKeyEvent } from "./evdev";
export {
  EvdevPointer,
  type EvdevPointerMotion,
  type EvdevPointerAbsolute,
  type EvdevPointerButton,
  type EvdevPointerAxis,
} from "./evdev-pointer";
export { GbmDevice, type GbmMappedPixels } from "./gbm";
export {
  EglOutputScaler,
  type EglOutputInfo,
  type EglScaleOutput,
  type EglDirectOutput,
  type EglDirectPresent,
  type EglClientPresent,
  type EglCompositionLayer,
  type EglCompositionScene,
} from "./egl-output";
