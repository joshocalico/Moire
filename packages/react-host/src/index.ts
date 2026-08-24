import type { FunctionComponent, ReactNode } from "react";
import { createContext } from "react";
import Reconciler from "react-reconciler";
import {
  DefaultEventPriority,
  DiscreteEventPriority,
  LegacyRoot,
} from "react-reconciler/constants.js";
import { drawText as drawBitmapText, FONT_H, measureText as measureBitmapText } from "./font.js";
import {
  getTextRenderer,
  type TextDrawStyle,
} from "./text-renderer.js";
import type {
  RendererBackend,
  RetainedClip,
  RetainedLayer,
  RetainedSceneFrame,
  RenderViewport,
  SoftwareFrame,
} from "./renderer.js";

export type {
  RendererBackend,
  RenderFrame,
  RetainedClip,
  RetainedLayer,
  RetainedSceneFrame,
  RenderViewport,
  SoftwareFrame,
} from "./renderer.js";

// Present at runtime in React 19; @types/react-reconciler may lag.
const NoEventPriority = 0;

export type SceneKind = "group" | "rect" | "text" | "image";

/** A numeric presentation value which may be advanced without a React commit. */
export type LiveNumber = number | { get(): number };

export type HitPointerEvent = {
  /** Absolute position in the root framebuffer. */
  x: number;
  y: number;
  /** Position relative to the hit region's top-left. */
  localX: number;
  localY: number;
  button?: "left" | "right" | "middle";
  deltaY?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

/** Backward-compatible alias for pointer events delivered to press handlers. */
export type HitPressEvent = HitPointerEvent;

export type HitHandler = (ev: HitPressEvent) => void;

export type HitKeyEvent = {
  code: number;
  key?: string;
  text?: string;
  repeat?: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** Absolute geometry of the focused hit receiving this key, when present. */
  targetBounds?: { x: number; y: number; width: number; height: number };
};

export type HitKeyHandler = (ev: HitKeyEvent) => void;
export type HitGlobalKeyHandler = (ev: HitKeyEvent) => boolean | void;

type HostPointerProps = {
  onPress?: HitHandler;
  onPointerEnter?: HitHandler;
  onPointerLeave?: HitHandler;
  onPointerDown?: HitHandler;
  onPointerMove?: HitHandler;
  onPointerUp?: HitHandler;
  onContextMenu?: HitHandler;
  onWheel?: (ev: HitPointerEvent) => void;
  data?: unknown;
  onDropHoverChange?: (hovering: boolean) => void;
  focusable?: boolean;
  /** Deliver Tab to this focused surface instead of moving widget focus. */
  captureTab?: boolean;
  autoFocus?: boolean;
  focusId?: string;
  onFocusChange?: (focused: boolean) => void;
  onKeyDown?: HitKeyHandler;
  onKeyUp?: HitKeyHandler;
  /** Key handler evaluated before focused-widget dispatch. Return true to consume. */
  onGlobalKeyDown?: HitGlobalKeyHandler;
  /** Nearest declarative focus traversal boundary. */
  focusScopeId?: string;
  focusScopeTrap?: boolean;
  focusScopeActive?: boolean;
};

export type GroupProps = HostPointerProps & {
  x?: number;
  y?: number;
  translateX?: LiveNumber;
  translateY?: LiveNumber;
  width?: number;
  height?: number;
  clip?: boolean;
  opacity?: LiveNumber;
  children?: ReactNode;
};

export type RectProps = HostPointerProps & {
  x?: number;
  y?: number;
  width: number;
  height: number;
  fill?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
  shadow?: BoxShadow;
};

/** Renderer-neutral outer shadow for elevated rectangular surfaces. */
export type BoxShadow = {
  color: number;
  blurRadius: number;
  offsetX?: number;
  offsetY?: number;
  spread?: number;
};

export type TextProps = {
  x?: number;
  y?: number;
  text: string;
  color?: number;
  scale?: number;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
};

export type ImageProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  imagePixels: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  opacity?: LiveNumber;
};

export type SceneNode = {
  kind: SceneKind;
  id: string;
  x: number;
  y: number;
  /** Paint-only transforms: excluded from layout, resolved for paint and hits. */
  translateX?: LiveNumber;
  translateY?: LiveNumber;
  width: number;
  height: number;
  fill?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
  shadow?: BoxShadow;
  color?: number;
  text?: string;
  clip?: boolean;
  imagePixels?: Uint8Array;
  imageWidth?: number;
  imageHeight?: number;
  opacity?: number;
  /** Integer pixel scale for bitmap glyphs (1 = default). */
  scale?: number;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  onPress?: HitHandler;
  onPointerEnter?: HitHandler;
  onPointerLeave?: HitHandler;
  onPointerDown?: HitHandler;
  onPointerMove?: HitHandler;
  onPointerUp?: HitHandler;
  onContextMenu?: HitHandler;
  onWheel?: (ev: HitPointerEvent) => void;
  focusable?: boolean;
  captureTab?: boolean;
  autoFocus?: boolean;
  focusId?: string;
  onFocusChange?: (focused: boolean) => void;
  onKeyDown?: HitKeyHandler;
  onKeyUp?: HitKeyHandler;
  onGlobalKeyDown?: HitGlobalKeyHandler;
  focusScopeId?: string;
  focusScopeTrap?: boolean;
  focusScopeActive?: boolean;
  /** Opaque payload for position-aware lookups (e.g. DnD drop-target resolution). */
  data?: unknown;
  /**
   * Fired when this specific region gains/loses "a compatible drag is
   * hovering here" — geometric, per-instance, so two regions carrying the
   * same `data` (e.g. a breadcrumb and a sidebar row for the same path)
   * never cross-highlight each other.
   */
  onDropHoverChange?: (hovering: boolean) => void;
  children: SceneNode[];
  parent: SceneNode | null;
};

export type HitRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  onPress?: HitHandler;
  onPointerEnter?: HitHandler;
  onPointerLeave?: HitHandler;
  onPointerDown?: HitHandler;
  onPointerMove?: HitHandler;
  onPointerUp?: HitHandler;
  onContextMenu?: HitHandler;
  onWheel?: (ev: HitPointerEvent) => void;
  focusable?: boolean;
  captureTab?: boolean;
  autoFocus?: boolean;
  focusId?: string;
  onFocusChange?: (focused: boolean) => void;
  onKeyDown?: HitKeyHandler;
  onKeyUp?: HitKeyHandler;
  onGlobalKeyDown?: HitGlobalKeyHandler;
  focusScopeId?: string;
  focusScopeTrap?: boolean;
  focusScopeActive?: boolean;
  /** Opaque payload for position-aware lookups (e.g. DnD drop-target resolution). */
  data?: unknown;
  /** See `SceneNode.onDropHoverChange`. */
  onDropHoverChange?: (hovering: boolean) => void;
};

let nextId = 1;
let currentUpdatePriority: number = NoEventPriority;

function makeNode(
  kind: SceneKind,
  props: Record<string, unknown>,
): SceneNode {
  return {
    kind,
    id: `n${nextId++}`,
    x: Number(props.x ?? 0),
    y: Number(props.y ?? 0),
    translateX: props.translateX as LiveNumber | undefined,
    translateY: props.translateY as LiveNumber | undefined,
    width: Number(props.width ?? 0),
    height: Number(props.height ?? 0),
    fill: props.fill as number | undefined,
    radius: props.radius != null ? Number(props.radius) : undefined,
    stroke: props.stroke as number | undefined,
    strokeWidth:
      props.strokeWidth != null ? Number(props.strokeWidth) : undefined,
    shadow: props.shadow as BoxShadow | undefined,
    color: props.color as number | undefined,
    text: props.text as string | undefined,
    clip: props.clip as boolean | undefined,
    imagePixels: props.imagePixels as Uint8Array | undefined,
    imageWidth: props.imageWidth != null ? Number(props.imageWidth) : undefined,
    imageHeight: props.imageHeight != null ? Number(props.imageHeight) : undefined,
    opacity: props.opacity as LiveNumber | undefined,
    scale: props.scale != null ? Number(props.scale) : undefined,
    fontSize: props.fontSize != null ? Number(props.fontSize) : undefined,
    fontWeight: props.fontWeight as string | undefined,
    fontFamily: props.fontFamily as string | undefined,
    onPress: props.onPress as HitHandler | undefined,
    onPointerEnter: props.onPointerEnter as HitHandler | undefined,
    onPointerLeave: props.onPointerLeave as HitHandler | undefined,
    onPointerDown: props.onPointerDown as HitHandler | undefined,
    onPointerMove: props.onPointerMove as HitHandler | undefined,
    onPointerUp: props.onPointerUp as HitHandler | undefined,
    onContextMenu: props.onContextMenu as HitHandler | undefined,
    onWheel: props.onWheel as ((ev: HitPointerEvent) => void) | undefined,
    focusable: props.focusable as boolean | undefined,
    captureTab: props.captureTab as boolean | undefined,
    autoFocus: props.autoFocus as boolean | undefined,
    focusId: props.focusId as string | undefined,
    onFocusChange: props.onFocusChange as
      | ((focused: boolean) => void)
      | undefined,
    onKeyDown: props.onKeyDown as HitKeyHandler | undefined,
    onKeyUp: props.onKeyUp as HitKeyHandler | undefined,
    onGlobalKeyDown: props.onGlobalKeyDown as HitGlobalKeyHandler | undefined,
    focusScopeId: props.focusScopeId as string | undefined,
    focusScopeTrap: props.focusScopeTrap as boolean | undefined,
    focusScopeActive: props.focusScopeActive as boolean | undefined,
    children: [],
    parent: null,
  };
}

function textStyleOf(node: SceneNode): TextDrawStyle {
  return {
    color: node.color,
    scale: node.scale,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    fontFamily: node.fontFamily,
  };
}

function measureNodeText(text: string, style: TextDrawStyle): { width: number; height: number } {
  const custom = getTextRenderer();
  if (custom) return custom.measure(text, style);
  const s = style.scale ?? 1;
  return { width: measureBitmapText(text, s), height: FONT_H * s };
}

function applyProps(node: SceneNode, props: Record<string, unknown>): void {
  if ("x" in props) node.x = Number(props.x ?? 0);
  if ("y" in props) node.y = Number(props.y ?? 0);
  if ("translateX" in props) {
    node.translateX = props.translateX as LiveNumber | undefined;
  }
  if ("translateY" in props) {
    node.translateY = props.translateY as LiveNumber | undefined;
  }
  if ("width" in props) node.width = Number(props.width ?? 0);
  if ("height" in props) node.height = Number(props.height ?? 0);
  if ("fill" in props) node.fill = props.fill as number | undefined;
  if ("radius" in props) {
    node.radius = props.radius != null ? Number(props.radius) : undefined;
  }
  if ("stroke" in props) node.stroke = props.stroke as number | undefined;
  if ("strokeWidth" in props) {
    node.strokeWidth =
      props.strokeWidth != null ? Number(props.strokeWidth) : undefined;
  }
  if ("shadow" in props) node.shadow = props.shadow as BoxShadow | undefined;
  if ("color" in props) node.color = props.color as number | undefined;
  if ("text" in props) node.text = props.text as string | undefined;
  if ("clip" in props) node.clip = props.clip as boolean | undefined;
  if ("imagePixels" in props) node.imagePixels = props.imagePixels as Uint8Array | undefined;
  if ("imageWidth" in props) {
    node.imageWidth = props.imageWidth != null ? Number(props.imageWidth) : undefined;
  }
  if ("imageHeight" in props) {
    node.imageHeight = props.imageHeight != null ? Number(props.imageHeight) : undefined;
  }
  if ("opacity" in props) {
    node.opacity = props.opacity as LiveNumber | undefined;
  }
  if ("scale" in props) {
    node.scale = props.scale != null ? Number(props.scale) : undefined;
  }
  if ("fontSize" in props) {
    node.fontSize = props.fontSize != null ? Number(props.fontSize) : undefined;
  }
  if ("fontWeight" in props) {
    node.fontWeight = props.fontWeight as string | undefined;
  }
  if ("fontFamily" in props) {
    node.fontFamily = props.fontFamily as string | undefined;
  }
  if ("onPress" in props) node.onPress = props.onPress as HitHandler | undefined;
  if ("onPointerEnter" in props) {
    node.onPointerEnter = props.onPointerEnter as HitHandler | undefined;
  }
  if ("onPointerLeave" in props) {
    node.onPointerLeave = props.onPointerLeave as HitHandler | undefined;
  }
  if ("onPointerDown" in props) {
    node.onPointerDown = props.onPointerDown as HitHandler | undefined;
  }
  if ("onPointerMove" in props) {
    node.onPointerMove = props.onPointerMove as HitHandler | undefined;
  }
  if ("onPointerUp" in props) {
    node.onPointerUp = props.onPointerUp as HitHandler | undefined;
  }
  if ("onContextMenu" in props) {
    node.onContextMenu = props.onContextMenu as HitHandler | undefined;
  }
  if ("onWheel" in props) {
    node.onWheel = props.onWheel as ((ev: HitPointerEvent) => void) | undefined;
  }
  if ("focusable" in props) node.focusable = props.focusable as boolean | undefined;
  if ("captureTab" in props) node.captureTab = props.captureTab as boolean | undefined;
  if ("autoFocus" in props) node.autoFocus = props.autoFocus as boolean | undefined;
  if ("focusId" in props) node.focusId = props.focusId as string | undefined;
  if ("onFocusChange" in props) {
    node.onFocusChange = props.onFocusChange as
      | ((focused: boolean) => void)
      | undefined;
  }
  if ("onKeyDown" in props) {
    node.onKeyDown = props.onKeyDown as HitKeyHandler | undefined;
  }
  if ("onKeyUp" in props) {
    node.onKeyUp = props.onKeyUp as HitKeyHandler | undefined;
  }
  if ("onGlobalKeyDown" in props) {
    node.onGlobalKeyDown = props.onGlobalKeyDown as HitGlobalKeyHandler | undefined;
  }
  if ("focusScopeId" in props) {
    node.focusScopeId = props.focusScopeId as string | undefined;
  }
  if ("focusScopeTrap" in props) {
    node.focusScopeTrap = props.focusScopeTrap as boolean | undefined;
  }
  if ("focusScopeActive" in props) {
    node.focusScopeActive = props.focusScopeActive as boolean | undefined;
  }
  if ("data" in props) node.data = props.data;
  if ("onDropHoverChange" in props) {
    node.onDropHoverChange = props.onDropHoverChange as
      | ((hovering: boolean) => void)
      | undefined;
  }
  if (node.kind === "text" && node.text) {
    const m = measureNodeText(node.text, textStyleOf(node));
    node.width = m.width;
    node.height = m.height;
  }
}

type HostContext = Record<string, never>;

const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  supportsMicrotasks: true,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1 as unknown as number,
  scheduleMicrotask:
    typeof queueMicrotask === "function"
      ? queueMicrotask
      : (fn: () => void) => Promise.resolve().then(fn),

  getCurrentEventPriority: () => DefaultEventPriority,
  setCurrentUpdatePriority(p: number) {
    currentUpdatePriority = p;
  },
  getCurrentUpdatePriority() {
    return currentUpdatePriority;
  },
  resolveUpdatePriority() {
    return currentUpdatePriority !== NoEventPriority
      ? currentUpdatePriority
      : DiscreteEventPriority;
  },
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition() {
    return false;
  },
  trackSchedulerEvent() {},
  resolveEventType() {
    return null;
  },
  resolveEventTimeStamp() {
    return -1.1;
  },

  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},

  getRootHostContext: (): HostContext => ({}),
  getChildHostContext: (parent: HostContext): HostContext => parent,
  prepareForCommit: () => null,
  resetAfterCommit: (container: SceneNode) => {
    rootCommitListeners.get(container)?.();
  },
  createInstance(type: string, props: Record<string, unknown>): SceneNode {
    const kind = (
      type === "image" || type === "rect" || type === "text" ? type : "group"
    ) as SceneKind;
    return makeNode(kind, props);
  },
  appendInitialChild(parent: SceneNode, child: SceneNode): void {
    child.parent = parent;
    parent.children.push(child);
  },
  finalizeInitialChildren(node: SceneNode): boolean {
    if (node.kind === "text" && node.text) {
      const m = measureNodeText(node.text, textStyleOf(node));
      node.width = m.width;
      node.height = m.height;
    }
    return false;
  },
  prepareUpdate(): unknown {
    return true;
  },
  shouldSetTextContent(): boolean {
    return false;
  },
  createTextInstance(text: string): SceneNode {
    const m = measureNodeText(text, {});
    return makeNode("text", {
      text,
      x: 0,
      y: 0,
      width: m.width,
      height: m.height,
    });
  },
  getPublicInstance(instance: SceneNode): SceneNode {
    return instance;
  },
  appendChild(parent: SceneNode, child: SceneNode): void {
    child.parent = parent;
    parent.children.push(child);
  },
  appendChildToContainer(container: SceneNode, child: SceneNode): void {
    child.parent = container;
    container.children.push(child);
  },
  insertBefore(parent: SceneNode, child: SceneNode, before: SceneNode): void {
    child.parent = parent;
    const i = parent.children.indexOf(before);
    if (i < 0) parent.children.push(child);
    else parent.children.splice(i, 0, child);
  },
  insertInContainerBefore(
    container: SceneNode,
    child: SceneNode,
    before: SceneNode,
  ): void {
    insertBefore(container, child, before);
  },
  removeChild(parent: SceneNode, child: SceneNode): void {
    const i = parent.children.indexOf(child);
    if (i >= 0) parent.children.splice(i, 1);
    child.parent = null;
  },
  removeChildFromContainer(container: SceneNode, child: SceneNode): void {
    removeChild(container, child);
  },
  // React 19 / reconciler ≥0.31: (instance, type, oldProps, newProps, fiber).
  // Older hosts used (instance, updatePayload, type, oldProps, newProps).
  commitUpdate(
    node: SceneNode,
    typeOrPayload: unknown,
    _oldPropsOrType: unknown,
    newPropsOrOld: unknown,
    maybeFiberOrNewProps?: unknown,
  ): void {
    const next =
      typeof typeOrPayload === "string" || typeof typeOrPayload === "number"
        ? (newPropsOrOld as Record<string, unknown>)
        : ((maybeFiberOrNewProps ?? newPropsOrOld) as Record<string, unknown>);
    applyProps(node, next);
  },
  commitTextUpdate(node: SceneNode, _old: string, next: string): void {
    node.text = next;
    const m = measureNodeText(next, textStyleOf(node));
    node.width = m.width;
    node.height = m.height;
  },
  hideInstance(): void {},
  hideTextInstance(): void {},
  unhideInstance(): void {},
  unhideTextInstance(): void {},
  clearContainer(container: SceneNode): void {
    container.children = [];
  },
  maySuspendCommit(): boolean {
    return false;
  },
  preloadInstance(): boolean {
    return true;
  },
  startSuspendingCommit(): void {},
  suspendInstance(): void {},
  waitForCommitToBeReady(): null {
    return null;
  },
};

function insertBefore(parent: SceneNode, child: SceneNode, before: SceneNode): void {
  child.parent = parent;
  const i = parent.children.indexOf(before);
  if (i < 0) parent.children.push(child);
  else parent.children.splice(i, 0, child);
}

function removeChild(parent: SceneNode, child: SceneNode): void {
  const i = parent.children.indexOf(child);
  if (i >= 0) parent.children.splice(i, 1);
  child.parent = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reconciler = Reconciler(hostConfig as any);

const rootCommitListeners = new WeakMap<SceneNode, () => void>();

export type ShellRoot = {
  container: SceneNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fiber: any;
};

export type ShellRootOptions = {
  /** Called when React commits state outside an explicit renderShell call. */
  onCommit?: () => void;
};

export function createShellRoot(options: ShellRootOptions = {}): ShellRoot {
  const container = makeNode("group", { x: 0, y: 0, width: 0, height: 0 });
  if (options.onCommit) rootCommitListeners.set(container, options.onCommit);
  const fiber = reconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    "",
    () => {},
    null,
  );
  return { container, fiber };
}

export function renderShell(root: ShellRoot, element: ReactNode): void {
  // Sync commit so rasterize sees the tree in the same compositor frame.
  // Runtime has updateContainerSync; @types may lag.
  const r = reconciler as typeof reconciler & {
    updateContainerSync?: typeof reconciler.updateContainer;
    flushSyncWork?: () => void;
  };
  if (typeof r.updateContainerSync === "function") {
    r.updateContainerSync(element, root.fiber, null, () => {});
    r.flushSyncWork?.();
  } else {
    reconciler.updateContainer(element, root.fiber, null, () => {});
  }
}

function resolveLiveNumber(value: LiveNumber | undefined, fallback = 0): number {
  if (value == null) return fallback;
  return typeof value === "number" ? value : value.get();
}

function absPos(node: SceneNode): { x: number; y: number } {
  let x = node.x + resolveLiveNumber(node.translateX);
  let y = node.y + resolveLiveNumber(node.translateY);
  let p = node.parent;
  while (p) {
    x += p.x + resolveLiveNumber(p.translateX);
    y += p.y + resolveLiveNumber(p.translateY);
    p = p.parent;
  }
  return { x, y };
}

type CollectedFocusScope = {
  id: string;
  trap: boolean;
  active: boolean;
};

export function collectHits(
  node: SceneNode,
  out: HitRegion[] = [],
  inheritedScope?: CollectedFocusScope,
): HitRegion[] {
  const { x, y } = absPos(node);
  const scope = node.focusScopeId
    ? {
        id: node.focusScopeId,
        trap: node.focusScopeTrap !== false,
        active: node.focusScopeActive !== false,
      }
    : inheritedScope;
  if (
    (node.onPress ||
      node.onPointerEnter ||
      node.onPointerLeave ||
      node.onPointerDown ||
      node.onPointerMove ||
      node.onPointerUp ||
      node.onContextMenu ||
      node.onWheel ||
      node.onGlobalKeyDown ||
      node.focusable ||
      // A pure position lookup tag (e.g. DropZone) with no pointer handlers
      // still needs to be findable by hitTestDropData.
      node.data !== undefined) &&
    node.width > 0 &&
    node.height > 0
  ) {
    out.push({
      x,
      y,
      width: node.width,
      height: node.height,
      radius: node.radius,
      onPress: node.onPress,
      onPointerEnter: node.onPointerEnter,
      onPointerLeave: node.onPointerLeave,
      onPointerDown: node.onPointerDown,
      onPointerMove: node.onPointerMove,
      onPointerUp: node.onPointerUp,
      onContextMenu: node.onContextMenu,
      onWheel: node.onWheel,
      focusable: node.focusable,
      captureTab: node.captureTab,
      autoFocus: node.autoFocus,
      focusId: node.focusId ?? node.id,
      onFocusChange: node.onFocusChange,
      onKeyDown: node.onKeyDown,
      onKeyUp: node.onKeyUp,
      onGlobalKeyDown: node.onGlobalKeyDown,
      focusScopeId: scope?.id,
      focusScopeTrap: scope?.trap,
      focusScopeActive: scope?.active,
      data: node.data,
      onDropHoverChange: node.onDropHoverChange,
    });
  }
  for (const c of node.children) collectHits(c, out, scope);
  return out;
}

/** Geometry-aware hit test shared by input dispatchers and renderer backends. */
export function hitRegionContains(
  hit: HitRegion,
  x: number,
  y: number,
): boolean {
  return insideRoundedRect(
    x,
    y,
    hit.x,
    hit.y,
    hit.width,
    hit.height,
    hit.radius ?? 0,
  );
}

function renderSoftwareFrame(
  root: SceneNode,
  fbW: number,
  fbH: number,
  reusablePixels?: Uint8Array,
): SoftwareFrame {
  const requiredBytes = fbW * fbH * 4;
  const pixels = reusablePixels?.byteLength === requiredBytes
    ? reusablePixels
    : new Uint8Array(requiredBytes);
  pixels.fill(0);
  const fb = new Uint32Array(pixels.buffer);
  const pitchPx = fbW;

  type PaintBounds = { x0: number; y0: number; x1: number; y1: number };
  const visualBounds = (node: SceneNode): PaintBounds | null => {
    let bounds: PaintBounds | null =
      node.kind === "rect" || node.kind === "image"
        ? { x0: 0, y0: 0, x1: node.width, y1: node.height }
        : node.kind === "text"
          // Glyph bearings and antialias coverage can extend just outside the
          // measured advance box. Preserve that fringe in opacity layers.
          ? { x0: -2, y0: -2, x1: node.width + 2, y1: node.height + 2 }
          : null;
    if (node.kind === "rect" && node.shadow) {
      const spread = Math.max(0, node.shadow.spread ?? 0);
      const extent = Math.max(0, node.shadow.blurRadius) + spread;
      const offsetX = node.shadow.offsetX ?? 0;
      const offsetY = node.shadow.offsetY ?? 0;
      bounds = {
        x0: Math.min(bounds?.x0 ?? 0, offsetX - extent),
        y0: Math.min(bounds?.y0 ?? 0, offsetY - extent),
        x1: Math.max(bounds?.x1 ?? node.width, node.width + offsetX + extent),
        y1: Math.max(bounds?.y1 ?? node.height, node.height + offsetY + extent),
      };
    }
    for (const child of node.children) {
      const childBounds = visualBounds(child);
      if (!childBounds) continue;
      const translated = {
        x0: child.x + resolveLiveNumber(child.translateX) + childBounds.x0,
        y0: child.y + resolveLiveNumber(child.translateY) + childBounds.y0,
        x1: child.x + resolveLiveNumber(child.translateX) + childBounds.x1,
        y1: child.y + resolveLiveNumber(child.translateY) + childBounds.y1,
      };
      bounds = bounds
        ? {
            x0: Math.min(bounds.x0, translated.x0),
            y0: Math.min(bounds.y0, translated.y0),
            x1: Math.max(bounds.x1, translated.x1),
            y1: Math.max(bounds.y1, translated.y1),
          }
        : translated;
    }
    if (node.kind === "group" && node.clip) {
      if (!bounds) return null;
      const clipped = {
        x0: Math.max(0, bounds.x0),
        y0: Math.max(0, bounds.y0),
        x1: Math.min(node.width, bounds.x1),
        y1: Math.min(node.height, bounds.y1),
      };
      return clipped.x1 > clipped.x0 && clipped.y1 > clipped.y0
        ? clipped
        : null;
    }
    return bounds;
  };

  const paint = (
    node: SceneNode,
    target: Uint32Array,
    targetW: number,
    targetH: number,
    targetPitch: number,
    x: number,
    y: number,
  ) => {
    if (node.kind === "rect") {
      const radius = Math.max(0, node.radius ?? 0);
      const strokeWidth = Math.max(0, node.strokeWidth ?? 1);
      if (node.shadow && (node.shadow.color >>> 24) > 0) {
        fillRoundedBoxShadow(
          target,
          targetPitch,
          targetW,
          targetH,
          x,
          y,
          node.width,
          node.height,
          radius,
          node.shadow,
        );
      }
      if (node.fill != null) {
        if (radius > 0) {
          fillRoundedRect(
            target,
            targetPitch,
            targetW,
            targetH,
            x,
            y,
            node.width,
            node.height,
            radius,
            node.fill,
          );
        } else {
          fillRect(
            target,
            targetPitch,
            targetW,
            targetH,
            x,
            y,
            node.width,
            node.height,
            node.fill,
          );
        }
      }
      if (node.stroke != null && strokeWidth > 0) {
        fillRoundedStroke(
          target,
          targetPitch,
          targetW,
          targetH,
          x,
          y,
          node.width,
          node.height,
          radius,
          strokeWidth,
          node.stroke,
        );
      }
    } else if (node.kind === "text" && node.text) {
      const style = textStyleOf(node);
      style.color = node.color ?? 0xffffffff;
      const custom = getTextRenderer();
      if (custom) {
        custom.draw(target, targetPitch, targetW, targetH, x, y, node.text, style);
      } else {
        drawBitmapText(
          target,
          targetPitch,
          targetW,
          targetH,
          x,
          y,
          node.text,
          style.color,
          node.scale ?? 1,
        );
      }
    } else if (
      node.kind === "image" &&
      node.imagePixels &&
      node.imageWidth &&
      node.imageHeight
    ) {
      blitImage(
        target,
        targetPitch,
        targetW,
        targetH,
        x,
        y,
        node.width,
        node.height,
        node.imagePixels,
        node.imageWidth,
        node.imageHeight,
        node.opacity == null ? undefined : resolveLiveNumber(node.opacity),
      );
    }

    if (
      node.kind === "group" &&
      (node.clip || (node.opacity != null && resolveLiveNumber(node.opacity) !== 1))
    ) {
      const nodeOpacity = resolveLiveNumber(node.opacity, 1);
      if (nodeOpacity <= 0) return;
      const bounds = node.clip
        ? { x0: 0, y0: 0, x1: node.width, y1: node.height }
        : visualBounds(node);
      if (!bounds) return;
      const layerX = Math.floor(bounds.x0);
      const layerY = Math.floor(bounds.y0);
      const layerW = Math.max(0, Math.ceil(bounds.x1) - layerX);
      const layerH = Math.max(0, Math.ceil(bounds.y1) - layerY);
      if (layerW === 0 || layerH === 0) return;
      const layer = new Uint32Array(layerW * layerH);
      for (const c of node.children) {
        paint(
          c,
          layer,
          layerW,
          layerH,
          layerW,
          c.x + resolveLiveNumber(c.translateX) - layerX,
          c.y + resolveLiveNumber(c.translateY) - layerY,
        );
      }
      blitPixels(
        target,
        targetPitch,
        targetW,
        targetH,
        x + layerX,
        y + layerY,
        layer,
        layerW,
        layerW,
        layerH,
        nodeOpacity,
      );
      return;
    }
    for (const c of node.children) {
      paint(
        c,
        target,
        targetW,
        targetH,
        targetPitch,
        x + c.x + resolveLiveNumber(c.translateX),
        y + c.y + resolveLiveNumber(c.translateY),
      );
    }
  };
  paint(
    root,
    fb,
    fbW,
    fbH,
    pitchPx,
    root.x + resolveLiveNumber(root.translateX),
    root.y + resolveLiveNumber(root.translateY),
  );
  return { pixels, width: fbW, height: fbH };
}

/** Deterministic CPU implementation of the backend-neutral scene renderer. */
export class SoftwareRenderer implements RendererBackend<SoftwareFrame> {
  readonly id = "software";
  private pixels: Uint8Array | undefined;

  render(root: SceneNode, viewport: RenderViewport): SoftwareFrame {
    const frame = renderSoftwareFrame(
      root,
      viewport.width,
      viewport.height,
      this.pixels,
    );
    this.pixels = frame.pixels;
    return frame;
  }
}

/**
 * CPU compositor for the same retained layers consumed by EGL. Static text,
 * strokes and images therefore keep their raster-cache benefits when a client
 * falls back to wl_shm; only layer composition is repeated for each frame.
 */
export class RetainedSoftwareRenderer {
  readonly id = "retained-software";
  private pixels: Uint8Array | undefined;

  render(scene: RetainedSceneFrame): SoftwareFrame {
    const requiredBytes = scene.width * scene.height * 4;
    const reusable = this.pixels?.byteLength === requiredBytes;
    const pixels = reusable
      ? this.pixels!
      : new Uint8Array(requiredBytes);
    const target = new Uint32Array(pixels.buffer);
    const damage = reusable
      ? scene.damage ?? [{ x: 0, y: 0, width: scene.width, height: scene.height }]
      : [{ x: 0, y: 0, width: scene.width, height: scene.height }];
    for (const rect of damage) {
      fillRect(
        target,
        scene.width,
        scene.width,
        scene.height,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        scene.clearColor >>> 0,
      );
    }

    for (const layer of scene.layers) {
      for (const rect of damage) {
        const clip = intersectClip(layer.clip, rect);
        if (clip.width <= 0 || clip.height <= 0) continue;
        compositeRetainedLayer(target, scene.width, scene.height, {
          ...layer,
          clip,
        });
      }
    }

    this.pixels = pixels;
    return { pixels, width: scene.width, height: scene.height };
  }
}

function compositeRetainedLayer(
  target: Uint32Array,
  targetWidth: number,
  targetHeight: number,
  layer: RetainedLayer,
): void {
  const destination = layer.destination;
  if (
    destination.width <= 0 ||
    destination.height <= 0 ||
    layer.sourceWidth <= 0 ||
    layer.sourceHeight <= 0
  ) return;

  const clipX0 = layer.clip ? Math.floor(layer.clip.x) : 0;
  const clipY0 = layer.clip ? Math.floor(layer.clip.y) : 0;
  const clipX1 = layer.clip
    ? Math.ceil(layer.clip.x + layer.clip.width)
    : targetWidth;
  const clipY1 = layer.clip
    ? Math.ceil(layer.clip.y + layer.clip.height)
    : targetHeight;
  const bounds = {
    x0: Math.max(0, clipX0),
    y0: Math.max(0, clipY0),
    x1: Math.min(targetWidth, clipX1),
    y1: Math.min(targetHeight, clipY1),
  };
  if (bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) return;

  if (layer.dropShadow && (layer.dropShadow.color >>> 24) > 0) {
    fillRoundedBoxShadow(
      target,
      targetWidth,
      targetWidth,
      targetHeight,
      destination.x,
      destination.y,
      destination.width,
      destination.height,
      Math.max(0, layer.cornerRadius ?? 0),
      layer.dropShadow,
      bounds,
    );
  }

  const x0 = Math.max(bounds.x0, Math.floor(destination.x));
  const y0 = Math.max(bounds.y0, Math.floor(destination.y));
  const x1 = Math.min(bounds.x1, Math.ceil(destination.x + destination.width));
  const y1 = Math.min(bounds.y1, Math.ceil(destination.y + destination.height));
  const opacity = Math.max(0, Math.min(1, layer.opacity ?? 1));
  const radius = Math.max(0, layer.cornerRadius ?? 0);
  const source = new Uint32Array(
    layer.pixels.buffer,
    layer.pixels.byteOffset,
    Math.floor(layer.pixels.byteLength / 4),
  );
  const sourcePitch = Math.floor(layer.sourceStride / 4);

  // Solid layers dominate widget scenes. Preserve the software renderer's
  // direct-fill performance instead of routing every pixel through the
  // general scaled texture sampler.
  if (
    layer.sourceWidth === 1 &&
    layer.sourceHeight === 1 &&
    opacity === 1 &&
    (source[0]! >>> 24) === 0xff &&
    x0 === Math.floor(destination.x) &&
    y0 === Math.floor(destination.y) &&
    x1 === Math.ceil(destination.x + destination.width) &&
    y1 === Math.ceil(destination.y + destination.height)
  ) {
    if (radius > 0) {
      fillRoundedRect(
        target,
        targetWidth,
        targetWidth,
        targetHeight,
        destination.x,
        destination.y,
        destination.width,
        destination.height,
        radius,
        source[0]!,
      );
    } else {
      fillRect(
        target,
        targetWidth,
        targetWidth,
        targetHeight,
        destination.x,
        destination.y,
        destination.width,
        destination.height,
        source[0]!,
      );
    }
    return;
  }

  // Text, strokes and unscaled images are already rasterized at destination
  // size. Avoid repeated coordinate division in the generic scaling loop.
  if (
    radius === 0 &&
    Number.isInteger(destination.x) &&
    Number.isInteger(destination.y) &&
    destination.width === layer.sourceWidth &&
    destination.height === layer.sourceHeight
  ) {
    const originX = destination.x | 0;
    const originY = destination.y | 0;
    for (let y = y0; y < y1; y++) {
      const sourceRow = (y - originY) * sourcePitch;
      const targetRow = y * targetWidth;
      for (let x = x0; x < x1; x++) {
        const pixel = source[sourceRow + x - originX]!;
        if ((pixel >>> 24) === 0) continue;
        blendPremultiplied(
          target,
          targetRow + x,
          (pixel >>> 16) & 0xff,
          (pixel >>> 8) & 0xff,
          pixel & 0xff,
          (pixel >>> 24) & 0xff,
          opacity,
        );
      }
    }
    return;
  }

  for (let y = y0; y < y1; y++) {
    const sourceY = Math.min(
      layer.sourceHeight - 1,
      Math.max(
        0,
        Math.floor(
          ((y + 0.5 - destination.y) * layer.sourceHeight) /
            destination.height,
        ),
      ),
    );
    for (let x = x0; x < x1; x++) {
      const coverage = radius > 0
        ? roundedRectCoverage(
            x + 0.5,
            y + 0.5,
            destination.x,
            destination.y,
            destination.width,
            destination.height,
            radius,
          )
        : 1;
      if (coverage <= 0) continue;
      const sourceX = Math.min(
        layer.sourceWidth - 1,
        Math.max(
          0,
          Math.floor(
            ((x + 0.5 - destination.x) * layer.sourceWidth) /
              destination.width,
          ),
        ),
      );
      const pixel = source[sourceY * sourcePitch + sourceX]!;
      blendPremultiplied(
        target,
        y * targetWidth + x,
        (pixel >>> 16) & 0xff,
        (pixel >>> 8) & 0xff,
        pixel & 0xff,
        (pixel >>> 24) & 0xff,
        opacity * coverage,
      );
    }
  }
}

type RetainedRasterCache = {
  key: string;
  pixels: Uint8Array;
  width: number;
  height: number;
  revision: number;
  lastSeen: number;
};

type RetainedLayerSnapshot = {
  signature: string;
  bounds: RetainedClip;
};

function retainedLayerBounds(
  layer: RetainedLayer,
  viewport: RenderViewport,
): RetainedClip {
  let left = layer.destination.x;
  let top = layer.destination.y;
  let right = layer.destination.x + layer.destination.width;
  let bottom = layer.destination.y + layer.destination.height;
  if (layer.dropShadow) {
    const spread = Math.max(0, layer.dropShadow.spread ?? 0);
    const extent = Math.max(0, layer.dropShadow.blurRadius) + spread;
    left = Math.min(left, layer.destination.x + layer.dropShadow.offsetX - extent);
    top = Math.min(top, layer.destination.y + layer.dropShadow.offsetY - extent);
    right = Math.max(
      right,
      layer.destination.x + layer.destination.width + layer.dropShadow.offsetX + extent,
    );
    bottom = Math.max(
      bottom,
      layer.destination.y + layer.destination.height + layer.dropShadow.offsetY + extent,
    );
  }
  if (layer.clip) {
    left = Math.max(left, layer.clip.x);
    top = Math.max(top, layer.clip.y);
    right = Math.min(right, layer.clip.x + layer.clip.width);
    bottom = Math.min(bottom, layer.clip.y + layer.clip.height);
  }
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  const clippedRight = Math.min(viewport.width, Math.ceil(right));
  const clippedBottom = Math.min(viewport.height, Math.ceil(bottom));
  return {
    x,
    y,
    width: Math.max(0, clippedRight - x),
    height: Math.max(0, clippedBottom - y),
  };
}

function retainedLayerSignature(layer: RetainedLayer): string {
  return JSON.stringify({
    revision: layer.revision,
    sourceWidth: layer.sourceWidth,
    sourceHeight: layer.sourceHeight,
    sourceStride: layer.sourceStride,
    destination: layer.destination,
    clip: layer.clip,
    opacity: layer.opacity,
    sampling: layer.sampling,
    cornerRadius: layer.cornerRadius,
    dropShadow: layer.dropShadow,
  });
}

function coalesceDamage(rects: readonly RetainedClip[]): RetainedClip[] {
  const result: RetainedClip[] = [];
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    let merged = { ...rect };
    for (let index = result.length - 1; index >= 0; index--) {
      const current = result[index]!;
      const separate =
        merged.x > current.x + current.width ||
        merged.x + merged.width < current.x ||
        merged.y > current.y + current.height ||
        merged.y + merged.height < current.y;
      if (separate) continue;
      const left = Math.min(merged.x, current.x);
      const top = Math.min(merged.y, current.y);
      const right = Math.max(merged.x + merged.width, current.x + current.width);
      const bottom = Math.max(merged.y + merged.height, current.y + current.height);
      merged = { x: left, y: top, width: right - left, height: bottom - top };
      result.splice(index, 1);
    }
    result.push(merged);
  }
  return result;
}

function intersectClip(a: RetainedClip | undefined, b: RetainedClip): RetainedClip {
  if (!a) return b;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

/**
 * Convert the React scene into cached texture-backed primitives. This renderer
 * performs no EGL calls: a platform may consume the frame, or Window can
 * continue through SoftwareRenderer unchanged.
 */
export class RetainedSceneRenderer
  implements RendererBackend<RetainedSceneFrame>
{
  readonly id = "retained-scene";
  private readonly solidPixels = new Map<number, Uint8Array>();
  private readonly rasterCache = new Map<string, RetainedRasterCache>();
  private readonly imageTextures = new WeakMap<
    Uint8Array,
    { pixels: Uint8Array; revision: number }
  >();
  private nextRevision = 1;
  private frame = 0;
  private previousLayers = new Map<string, RetainedLayerSnapshot>();
  private previousOrder: string[] = [];
  private previousWidth = 0;
  private previousHeight = 0;
  private previousClearColor = 0;

  private solid(color: number): Uint8Array {
    const key = color >>> 0;
    let pixels = this.solidPixels.get(key);
    if (pixels) return pixels;
    pixels = new Uint8Array(4);
    fillRect(new Uint32Array(pixels.buffer), 1, 1, 1, 0, 0, 1, 1, key);
    this.solidPixels.set(key, pixels);
    return pixels;
  }

  private cachedRaster(
    id: string,
    key: string,
    width: number,
    height: number,
    paint: (target: Uint32Array, pitch: number) => void,
  ): RetainedRasterCache {
    let cached = this.rasterCache.get(id);
    if (!cached || cached.key !== key) {
      const pixels = new Uint8Array(width * height * 4);
      paint(new Uint32Array(pixels.buffer), width);
      cached = {
        key,
        pixels,
        width,
        height,
        revision: this.nextRevision++,
        lastSeen: this.frame,
      };
      this.rasterCache.set(id, cached);
    }
    cached.lastSeen = this.frame;
    return cached;
  }

  private imageTexture(rgba: Uint8Array): {
    pixels: Uint8Array;
    revision: number;
  } {
    let cached = this.imageTextures.get(rgba);
    if (cached) return cached;
    const pixels = new Uint8Array(rgba.length);
    for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
      const alpha = rgba[offset + 3]!;
      pixels[offset] = Math.round((rgba[offset + 2]! * alpha) / 255);
      pixels[offset + 1] = Math.round((rgba[offset + 1]! * alpha) / 255);
      pixels[offset + 2] = Math.round((rgba[offset]! * alpha) / 255);
      pixels[offset + 3] = alpha;
    }
    cached = { pixels, revision: this.nextRevision++ };
    this.imageTextures.set(rgba, cached);
    return cached;
  }

  render(root: SceneNode, viewport: RenderViewport): RetainedSceneFrame {
    this.frame++;
    const layers: RetainedLayer[] = [];
    const visit = (
      node: SceneNode,
      parentX: number,
      parentY: number,
      inheritedOpacity: number,
      inheritedClip?: RetainedClip,
    ): void => {
      const x = parentX + node.x + resolveLiveNumber(node.translateX);
      const y = parentY + node.y + resolveLiveNumber(node.translateY);
      const opacity = inheritedOpacity * resolveLiveNumber(node.opacity, 1);
      if (opacity <= 0) return;
      const clip =
        node.kind === "group" && node.clip
          ? intersectClip(inheritedClip, {
              x,
              y,
              width: Math.max(0, node.width),
              height: Math.max(0, node.height),
            })
          : inheritedClip;
      if (clip && (clip.width <= 0 || clip.height <= 0)) return;

      if (node.kind === "rect" && node.width > 0 && node.height > 0) {
        const destination = { x, y, width: node.width, height: node.height };
        const fillAlpha = node.fill == null ? 0 : (node.fill >>> 24) & 0xff;
        const shadow = node.shadow
          ? {
              offsetX: node.shadow.offsetX ?? 0,
              offsetY: node.shadow.offsetY ?? 0,
              blurRadius: node.shadow.blurRadius,
              spread: node.shadow.spread,
              color: node.shadow.color,
            }
          : undefined;
        if (node.fill != null && fillAlpha > 0) {
          const color = node.fill >>> 0;
          layers.push({
            id: `${node.id}:fill`,
            pixels: this.solid(color),
            sourceWidth: 1,
            sourceHeight: 1,
            sourceStride: 4,
            revision: color,
            destination,
            clip,
            opacity,
            sampling: "nearest",
            cornerRadius: Math.max(0, node.radius ?? 0),
            dropShadow: shadow,
          });
        }
        const strokeWidth = Math.max(0, node.strokeWidth ?? 1);
        if (node.stroke != null && strokeWidth > 0) {
          const width = Math.max(1, Math.ceil(node.width));
          const height = Math.max(1, Math.ceil(node.height));
          const stroke = node.stroke >>> 0;
          const radius = Math.max(0, node.radius ?? 0);
          const cached = this.cachedRaster(
            `${node.id}:stroke`,
            `${width}:${height}:${radius}:${strokeWidth}:${stroke}`,
            width,
            height,
            (target, pitch) =>
              fillRoundedStroke(
                target,
                pitch,
                width,
                height,
                0,
                0,
                width,
                height,
                radius,
                strokeWidth,
                stroke,
              ),
          );
          layers.push({
            id: `${node.id}:stroke`,
            pixels: cached.pixels,
            sourceWidth: cached.width,
            sourceHeight: cached.height,
            sourceStride: cached.width * 4,
            revision: cached.revision,
            destination,
            clip,
            opacity,
            sampling: "linear",
            dropShadow: fillAlpha > 0 ? undefined : shadow,
          });
        }
      } else if (node.kind === "text" && node.text) {
        const style = textStyleOf(node);
        style.color = node.color ?? 0xffffffff;
        const pad = 2;
        const width = Math.max(1, Math.ceil(node.width) + pad * 2);
        const height = Math.max(1, Math.ceil(node.height) + pad * 2);
        const key = JSON.stringify({ text: node.text, style, width, height });
        const cached = this.cachedRaster(
          `${node.id}:text`,
          key,
          width,
          height,
          (target, pitch) => {
            const custom = getTextRenderer();
            if (custom) {
              custom.draw(
                target,
                pitch,
                width,
                height,
                pad,
                pad,
                node.text!,
                style,
              );
            } else {
              drawBitmapText(
                target,
                pitch,
                width,
                height,
                pad,
                pad,
                node.text!,
                style.color ?? 0xffffffff,
                node.scale ?? 1,
              );
            }
          },
        );
        layers.push({
          id: `${node.id}:text`,
          pixels: cached.pixels,
          sourceWidth: cached.width,
          sourceHeight: cached.height,
          sourceStride: cached.width * 4,
          revision: cached.revision,
          destination: {
            x: x - pad,
            y: y - pad,
            width: cached.width,
            height: cached.height,
          },
          clip,
          opacity,
          sampling: "linear",
        });
      } else if (
        node.kind === "image" &&
        node.imagePixels &&
        node.imageWidth &&
        node.imageHeight &&
        node.width > 0 &&
        node.height > 0
      ) {
        const texture = this.imageTexture(node.imagePixels);
        layers.push({
          id: `${node.id}:image`,
          pixels: texture.pixels,
          sourceWidth: node.imageWidth,
          sourceHeight: node.imageHeight,
          sourceStride: node.imageWidth * 4,
          revision: texture.revision,
          destination: { x, y, width: node.width, height: node.height },
          clip,
          opacity,
          sampling: "linear",
        });
      }

      for (const child of node.children) {
        visit(child, x, y, opacity, clip);
      }
    };
    visit(root, 0, 0, 1);

    if (this.frame % 120 === 0) {
      for (const [id, cached] of this.rasterCache) {
        if (this.frame - cached.lastSeen >= 120) this.rasterCache.delete(id);
      }
    }
    const clearColor = 0x00000000;
    const order = layers.map((layer) => layer.id);
    const forceFullDamage =
      viewport.width !== this.previousWidth ||
      viewport.height !== this.previousHeight ||
      clearColor !== this.previousClearColor ||
      order.length !== this.previousOrder.length ||
      order.some((id, index) => id !== this.previousOrder[index]);
    const nextLayers = new Map<string, RetainedLayerSnapshot>();
    const changedBounds: RetainedClip[] = [];
    for (const layer of layers) {
      const snapshot = {
        signature: retainedLayerSignature(layer),
        bounds: retainedLayerBounds(layer, viewport),
      };
      nextLayers.set(layer.id, snapshot);
      const previous = this.previousLayers.get(layer.id);
      if (!previous || previous.signature !== snapshot.signature) {
        if (previous) changedBounds.push(previous.bounds);
        changedBounds.push(snapshot.bounds);
      }
    }
    for (const [id, previous] of this.previousLayers) {
      if (!nextLayers.has(id)) changedBounds.push(previous.bounds);
    }
    const damage = forceFullDamage
      ? [{ x: 0, y: 0, width: viewport.width, height: viewport.height }]
      : coalesceDamage(changedBounds);
    this.previousLayers = nextLayers;
    this.previousOrder = order;
    this.previousWidth = viewport.width;
    this.previousHeight = viewport.height;
    this.previousClearColor = clearColor;
    return {
      width: viewport.width,
      height: viewport.height,
      clearColor,
      layers,
      damage,
    };
  }
}

const defaultSoftwareRenderer = new SoftwareRenderer();

/**
 * Backward-compatible convenience used by the compositor shell. Hit testing
 * remains scene-owned and is deliberately not part of RendererBackend.
 */
export function rasterize(
  root: SceneNode,
  fbW: number,
  fbH: number,
): { pixels: Uint8Array; hits: HitRegion[] } {
  const frame = defaultSoftwareRenderer.render(root, {
    width: fbW,
    height: fbH,
  });
  return { pixels: frame.pixels, hits: collectHits(root) };
}

function blitImage(
  fb: Uint32Array,
  pitchPx: number,
  fbW: number,
  fbH: number,
  x: number,
  y: number,
  width: number,
  height: number,
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  opacity = 1,
): void {
  const w = width | 0;
  const h = height | 0;
  if (w <= 0 || h <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return;
  const alpha = Math.max(0, Math.min(1, opacity));
  const x0 = Math.max(0, x | 0);
  const y0 = Math.max(0, y | 0);
  const x1 = Math.min(fbW, (x | 0) + w);
  const y1 = Math.min(fbH, (y | 0) + h);
  for (let py = y0; py < y1; py++) {
    const sy = Math.floor(((py - (y | 0)) * sourceHeight) / h);
    for (let px = x0; px < x1; px++) {
      const sx = Math.floor(((px - (x | 0)) * sourceWidth) / w);
      const si = (sy * sourceWidth + sx) * 4;
      if (si + 3 >= source.length) continue;
      blendRgba(
        fb,
        py * pitchPx + px,
        source[si]!,
        source[si + 1]!,
        source[si + 2]!,
        source[si + 3]!,
        alpha,
      );
    }
  }
}

function blitPixels(
  fb: Uint32Array,
  pitchPx: number,
  fbW: number,
  fbH: number,
  x: number,
  y: number,
  source: Uint32Array,
  sourcePitch: number,
  sourceW: number,
  sourceH: number,
  opacity = 1,
): void {
  const alpha = Math.max(0, Math.min(1, opacity));
  const x0 = Math.max(0, x | 0);
  const y0 = Math.max(0, y | 0);
  const x1 = Math.min(fbW, (x | 0) + sourceW);
  const y1 = Math.min(fbH, (y | 0) + sourceH);
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const src = source[(py - (y | 0)) * sourcePitch + px - (x | 0)]!;
      blendPremultiplied(
        fb,
        py * pitchPx + px,
        (src >>> 16) & 0xff,
        (src >>> 8) & 0xff,
        src & 0xff,
        (src >>> 24) & 0xff,
        alpha,
      );
    }
  }
}

function blendRgba(
  fb: Uint32Array,
  index: number,
  r: number,
  g: number,
  b: number,
  a: number,
  opacity: number,
): void {
  const alpha = Math.round(a * opacity);
  if (alpha === 0) return;
  if (alpha === 255) {
    fb[index] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
    return;
  }
  const dst = fb[index]!;
  const inv = 255 - alpha;
  const sr = Math.round((r * alpha) / 255);
  const sg = Math.round((g * alpha) / 255);
  const sb = Math.round((b * alpha) / 255);
  const dr = (dst >>> 16) & 0xff;
  const dg = (dst >>> 8) & 0xff;
  const db = dst & 0xff;
  const da = (dst >>> 24) & 0xff;
  const outA = alpha + Math.round((da * inv) / 255);
  const outR = sr + Math.round((dr * inv) / 255);
  const outG = sg + Math.round((dg * inv) / 255);
  const outB = sb + Math.round((db * inv) / 255);
  fb[index] =
    ((outA << 24) | (outR << 16) | (outG << 8) | outB) >>> 0;
}

function blendPremultiplied(
  fb: Uint32Array,
  index: number,
  r: number,
  g: number,
  b: number,
  a: number,
  opacity: number,
): void {
  const alpha = Math.round(a * opacity);
  if (alpha === 0) return;
  const sr = Math.round(r * opacity);
  const sg = Math.round(g * opacity);
  const sb = Math.round(b * opacity);
  if (alpha === 255) {
    fb[index] = (0xff000000 | (sr << 16) | (sg << 8) | sb) >>> 0;
    return;
  }
  const dst = fb[index]!;
  const inv = 255 - alpha;
  const dr = (dst >>> 16) & 0xff;
  const dg = (dst >>> 8) & 0xff;
  const db = dst & 0xff;
  const da = (dst >>> 24) & 0xff;
  const outA = alpha + Math.round((da * inv) / 255);
  const outR = sr + Math.round((dr * inv) / 255);
  const outG = sg + Math.round((dg * inv) / 255);
  const outB = sb + Math.round((db * inv) / 255);
  fb[index] =
    ((outA << 24) | (outR << 16) | (outG << 8) | outB) >>> 0;
}

function fillRect(
  fb: Uint32Array,
  pitchPx: number,
  fbW: number,
  fbH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  const a = (color >>> 24) & 0xff;
  if (a === 0) return;
  const x0 = Math.max(0, x | 0);
  const y0 = Math.max(0, y | 0);
  const x1 = Math.min(fbW, (x | 0) + (w | 0));
  const y1 = Math.min(fbH, (y | 0) + (h | 0));
  const c = color >>> 0;
  if (a === 255) {
    for (let py = y0; py < y1; py++) {
      const row = py * pitchPx;
      for (let px = x0; px < x1; px++) fb[row + px] = c;
    }
    return;
  }
  // Scene colors are straight ARGB. Preserve destination alpha and store the
  // resulting framebuffer pixel premultiplied so later compositor blending is
  // correct even when this rect is the first thing painted into a clear frame.
  const sr = (c >>> 16) & 0xff;
  const sg = (c >>> 8) & 0xff;
  const sb = c & 0xff;
  for (let py = y0; py < y1; py++) {
    const row = py * pitchPx;
    for (let px = x0; px < x1; px++) {
      blendRgba(fb, row + px, sr, sg, sb, a, 1);
    }
  }
}

function clampedRadius(w: number, h: number, radius: number): number {
  return Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
}

function insideRoundedRect(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): boolean {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  const r = clampedRadius(w, h, radius);
  if (r <= 0) return true;
  const cx = px < x + r ? x + r : px >= x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py >= y + h - r ? y + h - r : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function blendFillColor(fb: Uint32Array, index: number, color: number): void {
  const a = (color >>> 24) & 0xff;
  if (a === 0) return;
  const c = color >>> 0;
  if (a === 255) {
    fb[index] = c;
    return;
  }
  blendRgba(
    fb,
    index,
    (c >>> 16) & 0xff,
    (c >>> 8) & 0xff,
    c & 0xff,
    a,
    1,
  );
}

function blendCoverageColor(
  fb: Uint32Array,
  index: number,
  color: number,
  coverage: number,
): void {
  const clamped = Math.max(0, Math.min(1, coverage));
  if (clamped <= 0) return;
  if (clamped >= 1) {
    blendFillColor(fb, index, color);
    return;
  }
  const c = color >>> 0;
  blendRgba(
    fb,
    index,
    (c >>> 16) & 0xff,
    (c >>> 8) & 0xff,
    c & 0xff,
    (c >>> 24) & 0xff,
    clamped,
  );
}

/** One-pixel analytic coverage for the curved part of a rounded rectangle. */
function roundedRectCoverage(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): number {
  if (px < x || py < y || px >= x + w || py >= y + h) return 0;
  const r = clampedRadius(w, h, radius);
  if (r <= 0) return 1;
  // Most pixels lie in the horizontal or vertical body and need no sqrt.
  if (
    (px >= x + r && px < x + w - r) ||
    (py >= y + r && py < y + h - r)
  ) {
    return 1;
  }
  const cx = px < x + r ? x + r : x + w - r;
  const cy = py < y + r ? y + r : y + h - r;
  const distance = Math.hypot(px - cx, py - cy);
  return Math.max(0, Math.min(1, r + 0.5 - distance));
}

function roundedRectSignedDistance(
  px: number,
  py: number,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): number {
  const r = clampedRadius(width, height, radius);
  const halfW = width / 2;
  const halfH = height / 2;
  const qx = Math.abs(px - (x + halfW)) - Math.max(0, halfW - r);
  const qy = Math.abs(py - (y + halfH)) - Math.max(0, halfH - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Analytic blurred outer shadow. This keeps elevation backend-neutral while
 * avoiding a framebuffer-sized convolution in the software renderer.
 */
function fillRoundedBoxShadow(
  fb: Uint32Array,
  pitchPx: number,
  fbW: number,
  fbH: number,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  shadow: BoxShadow,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): void {
  const blur = Math.max(0, shadow.blurRadius);
  const spread = Math.max(0, shadow.spread ?? 0);
  const offsetX = shadow.offsetX ?? 0;
  const offsetY = shadow.offsetY ?? 0;
  const shadowX = x + offsetX - spread;
  const shadowY = y + offsetY - spread;
  const shadowWidth = width + spread * 2;
  const shadowHeight = height + spread * 2;
  const shadowRadius = radius + spread;
  const extent = Math.ceil(blur);
  const x0 = Math.max(clip?.x0 ?? 0, Math.floor(shadowX - extent));
  const y0 = Math.max(clip?.y0 ?? 0, Math.floor(shadowY - extent));
  const x1 = Math.min(clip?.x1 ?? fbW, Math.ceil(shadowX + shadowWidth + extent));
  const y1 = Math.min(clip?.y1 ?? fbH, Math.ceil(shadowY + shadowHeight + extent));
  const sigma = Math.max(0.5, blur / 3);
  const denominator = 2 * sigma * sigma;

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      // The opaque surface paints over this area immediately afterwards.
      if (roundedRectCoverage(px + 0.5, py + 0.5, x, y, width, height, radius) >= 1) {
        continue;
      }
      const distance = roundedRectSignedDistance(
        px + 0.5,
        py + 0.5,
        shadowX,
        shadowY,
        shadowWidth,
        shadowHeight,
        shadowRadius,
      );
      const coverage = distance <= 0
        ? 1
        : Math.exp(-(distance * distance) / denominator);
      if (coverage < 0.002) continue;
      blendCoverageColor(fb, py * pitchPx + px, shadow.color, coverage);
    }
  }
}

function fillRoundedRect(
  fb: Uint32Array,
  pitchPx: number,
  fbW: number,
  fbH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color: number,
): void {
  const x0 = Math.max(0, x | 0);
  const y0 = Math.max(0, y | 0);
  const x1 = Math.min(fbW, (x | 0) + (w | 0));
  const y1 = Math.min(fbH, (y | 0) + (h | 0));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const coverage = roundedRectCoverage(
        px + 0.5,
        py + 0.5,
        x,
        y,
        w,
        h,
        radius,
      );
      blendCoverageColor(fb, py * pitchPx + px, color, coverage);
    }
  }
}

function fillRoundedStroke(
  fb: Uint32Array,
  pitchPx: number,
  fbW: number,
  fbH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  strokeWidth: number,
  color: number,
): void {
  const x0 = Math.max(0, x | 0);
  const y0 = Math.max(0, y | 0);
  const x1 = Math.min(fbW, (x | 0) + (w | 0));
  const y1 = Math.min(fbH, (y | 0) + (h | 0));
  const innerX = x + strokeWidth;
  const innerY = y + strokeWidth;
  const innerW = w - strokeWidth * 2;
  const innerH = h - strokeWidth * 2;
  const innerRadius = Math.max(0, radius - strokeWidth);
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const sx = px + 0.5;
      const sy = py + 0.5;
      const outer = roundedRectCoverage(sx, sy, x, y, w, h, radius);
      const inner =
        innerW > 0 &&
        innerH > 0 &&
        roundedRectCoverage(
          sx,
          sy,
          innerX,
          innerY,
          innerW,
          innerH,
          innerRadius,
        );
      blendCoverageColor(
        fb,
        py * pitchPx + px,
        color,
        outer * (1 - Number(inner)),
      );
    }
  }
}

/**
 * Typed JSX host primitives. The casts are type-only: at runtime these remain
 * string host identities consumed directly by the custom reconciler.
 */
export const Rect = "rect" as unknown as FunctionComponent<RectProps>;
export const Text = "text" as unknown as FunctionComponent<TextProps>;
export const Group = "group" as unknown as FunctionComponent<GroupProps>;
export const Image = "image" as unknown as FunctionComponent<ImageProps>;

export function measureText(text: string, scale = 1): number {
  return measureNodeText(text, { scale }).width;
}

/** Measure text using the renderer and style that will actually paint it. */
export function measureTextBounds(
  text: string,
  style: TextDrawStyle = {},
): { width: number; height: number } {
  return measureNodeText(text, style);
}

export function drawText(
  fb: Uint32Array,
  pitchPx: number,
  fbW: number,
  fbH: number,
  x: number,
  y: number,
  text: string,
  color = 0xffffffff,
  scale = 1,
): void {
  const custom = getTextRenderer();
  if (custom) {
    custom.draw(fb, pitchPx, fbW, fbH, x, y, text, { color, scale });
    return;
  }
  drawBitmapText(fb, pitchPx, fbW, fbH, x, y, text, color, scale);
}

export { FONT_H, FONT_W } from "./font.js";
export {
  setTextRenderer,
  getTextRenderer,
  type TextRenderer,
  type TextDrawStyle,
} from "./text-renderer.js";
