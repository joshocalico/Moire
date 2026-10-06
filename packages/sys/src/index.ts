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
  presentKmsPixels,
  isKmsPresentationReady,
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
export { XkbKeyboardState, type KeyboardModifierMask } from "./keyboard-state";
export { EvdevKeyboard, type EvdevKeyEvent } from "./evdev";
export { openBootConsole } from "./boot-console";
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
  EglResidentImage,
  type EglDmabufSnapshotInput,
  type EglOutputInfo,
  type EglScaleOutput,
  type EglDirectOutput,
  type EglDirectPresent,
  type EglClientPresent,
  type EglCompositionLayer,
  type EglCompositionScene,
} from "./egl-output";
export { classifyEglExecution, hasOpaqueEglScene, type EglExecution } from "./egl-capability";

export {
  openManagedBootConsole,
  releaseBootConsole,
  type ManagedBootConsole,
  type BootConsoleIo,
} from "./boot-console-release";
export {
  observeBootServiceOwners,
  revalidateBootOwnerProof,
  type ExitedOwnersProof,
  type BootOwnerObservation,
} from "./boot-service-cleanup";
export {
  beginBootService,
  serviceIdentity,
  writeBootServiceRecord,
  readBootServiceLease,
  readBootServiceRelease,
  type BootServiceIdentity,
  type BootServiceLease,
  type BootServiceRelease,
  type BootServicePaths,
  type BootConsoleRecord,
  type BootSkipReason,
} from "./boot-service-state";
export {
  cleanupBootService,
  checkBootServiceRelease,
  type BootCleanupResult,
} from "./boot-service-release";

export { currentBootServiceIdentity } from "./boot-service-state";
export {
  initBootAttemptLedger,
  readBootAttemptLedger,
  recordBootAttempt,
  type BootAttemptLedger,
  type BootCurrentIdentity,
} from "./boot-attempt-ledger";
export {
  checkBootDesktopAdmission,
  parseBootAdmissionCheckpoint,
  type BootAdmissionCheckpoint,
  type BootAdmissionResult,
} from "./boot-release-admission";
export {
  observeBootManager,
  parseBootManagerObservation,
  bootManagerProperties,
  type BootManagerObservation,
  type BootManagerObserver,
} from "./boot-manager-observation";
export { notifySystemdReady } from "./systemd-notify";
export { createScrollTrace, isScrollPointerEvent, type ScrollTraceEvent } from "./scroll-trace";
export {
  createInputFixtureTrace,
  type InputFixtureTrace,
  type InputFixtureObservation,
  type InputFixtureFocus,
} from "./input-fixture-trace";

export { openLogindSeat, SeatDeviceLeases, type LogindSeat, type SeatDeviceAccess } from "./seat";
export { nativeKeyboardDeviceIo } from "./keyboard-grab";
export { nativePointerDeviceIo } from "./evdev-pointer";
