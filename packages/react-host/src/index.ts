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
  RenderViewport,
  SoftwareFrame,
} from "./renderer.js";

export type {
  RendererBackend,
  RenderFrame,
  RenderViewport,
  SoftwareFrame,
} from "./renderer.js";

// Present at runtime in React 19; @types/react-reconciler may lag.
const NoEventPriority = 0;

export type SceneKind = "group" | "rect" | "text" | "image";

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
};

export type HitKeyHandler = (ev: HitKeyEvent) => void;

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
};

export type GroupProps = HostPointerProps & {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  clip?: boolean;
  opacity?: number;
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
  opacity?: number;
};

export type SceneNode = {
  kind: SceneKind;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
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
    width: Number(props.width ?? 0),
    height: Number(props.height ?? 0),
    fill: props.fill as number | undefined,
    radius: props.radius != null ? Number(props.radius) : undefined,
    stroke: props.stroke as number | undefined,
    strokeWidth:
      props.strokeWidth != null ? Number(props.strokeWidth) : undefined,
    color: props.color as number | undefined,
    text: props.text as string | undefined,
    clip: props.clip as boolean | undefined,
    imagePixels: props.imagePixels as Uint8Array | undefined,
    imageWidth: props.imageWidth != null ? Number(props.imageWidth) : undefined,
    imageHeight: props.imageHeight != null ? Number(props.imageHeight) : undefined,
    opacity: props.opacity != null ? Number(props.opacity) : undefined,
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
    node.opacity = props.opacity != null ? Number(props.opacity) : undefined;
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
  resetAfterCommit: () => {},
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

export type ShellRoot = {
  container: SceneNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fiber: any;
};

export function createShellRoot(): ShellRoot {
  const container = makeNode("group", { x: 0, y: 0, width: 0, height: 0 });
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

function absPos(node: SceneNode): { x: number; y: number } {
  let x = node.x;
  let y = node.y;
  let p = node.parent;
  while (p) {
    x += p.x;
    y += p.y;
    p = p.parent;
  }
  return { x, y };
}

export function collectHits(node: SceneNode, out: HitRegion[] = []): HitRegion[] {
  const { x, y } = absPos(node);
  if (
    (node.onPress ||
      node.onPointerEnter ||
      node.onPointerLeave ||
      node.onPointerDown ||
      node.onPointerMove ||
      node.onPointerUp ||
      node.onContextMenu ||
      node.onWheel ||
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
      data: node.data,
      onDropHoverChange: node.onDropHoverChange,
    });
  }
  for (const c of node.children) collectHits(c, out);
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
): SoftwareFrame {
  const pixels = new Uint8Array(fbW * fbH * 4);
  const fb = new Uint32Array(pixels.buffer);
  const pitchPx = fbW;

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
        node.opacity,
      );
    }

    if (node.kind === "group" && node.clip) {
      const clipW = Math.max(0, node.width | 0);
      const clipH = Math.max(0, node.height | 0);
      if (clipW === 0 || clipH === 0) return;
      const layer = new Uint32Array(clipW * clipH);
      for (const c of node.children) {
        paint(c, layer, clipW, clipH, clipW, c.x, c.y);
      }
      blitPixels(
        target,
        targetPitch,
        targetW,
        targetH,
        x,
        y,
        layer,
        clipW,
        clipW,
        clipH,
        node.opacity,
      );
      return;
    }
    for (const c of node.children) {
      paint(c, target, targetW, targetH, targetPitch, x + c.x, y + c.y);
    }
  };
  paint(root, fb, fbW, fbH, pitchPx, root.x, root.y);
  return { pixels, width: fbW, height: fbH };
}

/** Deterministic CPU implementation of the backend-neutral scene renderer. */
export class SoftwareRenderer implements RendererBackend<SoftwareFrame> {
  readonly id = "software";

  render(root: SceneNode, viewport: RenderViewport): SoftwareFrame {
    return renderSoftwareFrame(root, viewport.width, viewport.height);
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
      if (insideRoundedRect(px + 0.5, py + 0.5, x, y, w, h, radius)) {
        blendFillColor(fb, py * pitchPx + px, color);
      }
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
      const outer = insideRoundedRect(sx, sy, x, y, w, h, radius);
      const inner =
        innerW > 0 &&
        innerH > 0 &&
        insideRoundedRect(
          sx,
          sy,
          innerX,
          innerY,
          innerW,
          innerH,
          innerRadius,
        );
      if (outer && !inner) blendFillColor(fb, py * pitchPx + px, color);
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
