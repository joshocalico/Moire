/**
 * Thin TypeScript + koffi bindings to Linux graphics/input libraries.
 */
export { isLinux, assertLinux } from "./platform";
export { LinuxReadinessDispatcher } from "./readiness";
export { findConnectedCard, listDrmConnectors, renderNodeForCard, type DrmConnectorInfo } from "./drm";
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
  dropKmsMaster,
  retainKmsScanout,
  isKmsScanoutSettled,
  runClearColorLoop,
  type KmsOutput,
  type KmsMode,
  type KmsOutputRefresh,
  type KmsCursorImage,
  type KmsPresentationFeedback,
  type Rgba,
} from "./kms";
export { setKmsOutputPower } from "./kms-power";
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
export { createXkbKeymapMemfd, type KeymapMemfd, type XkbRuleNames } from "./keymap";
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
export {
  classifyPointerDevice,
  createPointerAccelerator,
  evdevSupports,
  MiddleButtonEmulator,
  NEUTRAL_POINTER_CONFIG,
  parseSysfsBitmap,
  pointerAccelFactor,
  swapHandedButton,
  touchpadSupports,
  type PointerAccelProfile,
  type PointerClickMethod,
  type PointerConfigOption,
  type PointerDeviceConfig,
  type PointerDeviceConfigTarget,
  type PointerDeviceInfo,
  type PointerDeviceKind,
  type PointerScrollMethod,
} from "./pointer-config";
export {
  readTouchpadGeometry,
  touchpadGeometryFrom,
  TouchpadDecoder,
  type TouchpadFrame,
  type TouchpadGeometry,
} from "./touchpad-device";
export {
  DEFAULT_TOUCHPAD_OPTIONS,
  TouchpadGestures,
  type TouchpadOptions,
  type TouchpadOutput,
} from "./touchpad-gesture";
export {
  formatTouchpadRecording,
  parseTouchpadRecording,
  replayTouchpadRecording,
  type TouchpadRecording,
} from "./touchpad-recording";
export { GbmDevice, type GbmMappedPixels } from "./gbm";
export {
  EglOutputScaler,
  EglResidentImage,
  outputColorMatrix,
  type OutputColorScale,
  type EglDmabufSnapshotInput,
  type EglOutputInfo,
  type EglScaleOutput,
  type EglDirectOutput,
  type EglDirectPresent,
  type EglClientPresent,
  type EglCompositionLayer,
  type EglCompositionScene,
  type EglProducerTarget,
} from "./egl-output";
export { createGles3, type Gles3 } from "./gles3";
export {
  BOOT_HANDOFF_DIR,
  completeBootRelease,
  lastBootRelease,
  holdDisplayAcrossExit,
  publishStageHandoff,
  readStageHandoff,
  STAGE_HANDOFF_DIR,
  bootReleaseWantsFrame,
  markBootPresented,
  markBootPresenting,
  readBootActive,
  waitForBootPresenting,
  monotonicMs,
  publishBootActive,
  readBootFrame,
  readBootRelease,
  requestBootRelease,
  watchBootPresented,
  watchBootReleaseRequest,
  type BootHandoffActive,
  type BootHandoffFrame,
  type BootHandoffRelease,
} from "./boot-handoff";
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
export {
  openPipeWireStream,
  PipeWireStream,
  type OpenPipeWireStream,
  type PipeWireStreamOptions,
  type PipeWireStreamState,
} from "./pipewire-stream";
