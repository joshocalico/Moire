/**
 * Compositor core: clients, surfaces, scene, spawn.
 */

export type MoireVersion = {
  name: string;
  version: string;
};

export const MOIRE: MoireVersion = {
  name: "Moire",
  version: "0.0.0",
};

export { parseDesktopCommand, spawnDesktopApp, type SpawnOptions } from "./spawn";
export {
  CompositorServer,
  STAGE_GROUND,
  type CompositorShell,
  type SessionLockEnvironment,
  type SsdWindowInfo,
  type SsdAction,
} from "./server";
export {
  SessionLock,
  LOCK_PASSWORD_CAPACITY,
  type LockAuthenticator,
  type LockAuthResult,
  type LockAuthVerdict,
  type LockEntryPhase,
  type LockReason,
  type LockScreenAction,
  type LockScreenView,
  type UnlockReason,
} from "./session-lock";
export { startXwayland, findFreeXDisplay, type XwaylandHandle } from "./xwayland";
export { X11Wm, type XwmWindow, type XwmWindowType } from "./xwm";
export {
  validateCompositionScene,
  orderedCompositionLayers,
  type CompositionRect,
  type CompositionMatrix4,
  type CompositionTransform,
  type CompositionMesh,
  type PixelSurface,
  type CompositionEffect,
  type CompositionLayer,
  type CompositionScene,
  type CompositionCapabilities,
} from "./composition";
export {
  createCompositorOutputRenderer,
  resolveOutputRenderPreference,
  resolveEglPresentPreference,
  type CompositorOutputRenderer,
  type OutputRenderPreference,
  type OutputRenderTarget,
  type OutputRenderResult,
  type EglPresentPreference,
} from "./output-renderer";
export {
  IdlePolicy,
  ScreenFade,
  idlePolicyConfig,
  systemIdleTimers,
  LOCKED_SCREEN_OFF_MS,
  SUSPEND_RECHECK_MS,
  type IdleEffect,
  type IdleInhibitors,
  type IdleLockReason,
  type IdlePhase,
  type IdlePolicyConfig,
  type IdlePowerSource,
  type IdleSnapshot,
  type IdleTimers,
} from "./idle-policy";
export {
  IdleController,
  DIM_LEVEL,
  type IdleControllerHooks,
  type IdleControllerOptions,
  type IdleControllerStatus,
  type IdleOutputs,
  type IdleSummary,
} from "./idle-controller";
export { OutputPowerControl, type OutputPowerDriver } from "./output-power";
export { IdleInhibitorRegistry } from "./idle-inhibit";
export { FakeClock as FakeIdleClock } from "./idle-testing";
export {
  SecurePromptQueue,
  SECURE_PROMPT_CAPACITY,
  SECURE_PROMPT_ARMING_MS,
  SECURE_PROMPT_IDLE_MS,
  SECURE_PROMPT_WAIT_MS,
  SECURE_PROMPT_QUEUE_LIMIT,
  SECURE_PROMPT_COOL_DOWN_MS,
  SECURE_PROMPT_FLOOD_COOL_DOWN_MS,
  SECURE_PROMPT_MAX_IDENTITIES,
  type SecurePromptAction,
  type SecurePromptEntry,
  type SecurePromptPhase,
  type SecurePromptQueueOptions,
  type SecurePromptView,
} from "./secure-prompt";
export type {
  SecurePromptDetail,
  SecurePromptHandle,
  SecurePromptIdentity,
  SecurePromptOutcome,
  SecurePromptRequest,
  SecurePromptRequester,
  SecurePromptResult,
  SecurePrompts,
  SecurePromptVerdict,
} from "./secure-prompt-types";
