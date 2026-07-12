import type { ReactNode } from "react";
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

// Present at runtime in React 19; @types/react-reconciler may lag.
const NoEventPriority = 0;

export type SceneKind = "group" | "rect" | "text";

export type HitPressEvent = {
  /** Absolute position in the root framebuffer. */
  x: number;
  y: number;
  /** Position relative to the hit region's top-left. */
  localX: number;
  localY: number;
};

export type HitHandler = (ev: HitPressEvent) => void;

export type SceneNode = {
  kind: SceneKind;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: number;
  color?: number;
  text?: string;
  /** Integer pixel scale for bitmap glyphs (1 = default). */
  scale?: number;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  onPress?: HitHandler;
  children: SceneNode[];
  parent: SceneNode | null;
};

export type HitRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  onPress: HitHandler;
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
    color: props.color as number | undefined,
    text: props.text as string | undefined,
    scale: props.scale != null ? Number(props.scale) : undefined,
    fontSize: props.fontSize != null ? Number(props.fontSize) : undefined,
    fontWeight: props.fontWeight as string | undefined,
    fontFamily: props.fontFamily as string | undefined,
    onPress: props.onPress as HitHandler | undefined,
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
  if ("color" in props) node.color = props.color as number | undefined;
  if ("text" in props) node.text = props.text as string | undefined;
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
    const kind = (type === "rect" || type === "text" ? type : "group") as SceneKind;
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
  if (node.onPress && node.width > 0 && node.height > 0) {
    out.push({
      x,
      y,
      width: node.width,
      height: node.height,
      onPress: node.onPress,
    });
  }
  for (const c of node.children) collectHits(c, out);
  return out;
}

export function rasterize(
  root: SceneNode,
  fbW: number,
  fbH: number,
): { pixels: Uint8Array; hits: HitRegion[] } {
  const pixels = new Uint8Array(fbW * fbH * 4);
  const fb = new Uint32Array(pixels.buffer);
  const pitchPx = fbW;

  const paint = (node: SceneNode) => {
    const { x, y } = absPos(node);
    if (node.kind === "rect" && node.fill != null) {
      fillRect(fb, pitchPx, fbW, fbH, x, y, node.width, node.height, node.fill);
    } else if (node.kind === "text" && node.text) {
      const style = textStyleOf(node);
      style.color = node.color ?? 0xffffffff;
      const custom = getTextRenderer();
      if (custom) {
        custom.draw(fb, pitchPx, fbW, fbH, x, y, node.text, style);
      } else {
        drawBitmapText(
          fb,
          pitchPx,
          fbW,
          fbH,
          x,
          y,
          node.text,
          style.color,
          node.scale ?? 1,
        );
      }
    }
    for (const c of node.children) paint(c);
  };
  paint(root);
  return { pixels, hits: collectHits(root) };
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
  // Premul blend for translucent panels.
  const inv = 255 - a;
  const sr = (c >>> 16) & 0xff;
  const sg = (c >>> 8) & 0xff;
  const sb = c & 0xff;
  for (let py = y0; py < y1; py++) {
    const row = py * pitchPx;
    for (let px = x0; px < x1; px++) {
      const di = row + px;
      const dst = fb[di]!;
      const r = (sr + ((((dst >>> 16) & 0xff) * inv) / 255)) | 0;
      const g = (sg + ((((dst >>> 8) & 0xff) * inv) / 255)) | 0;
      const b = (sb + (((dst & 0xff) * inv) / 255)) | 0;
      fb[di] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
    }
  }
}

/** Host primitive components — used as reconciler element types. */
export const Rect = "rect";
export const Text = "text";
export const Group = "group";

export function measureText(text: string, scale = 1): number {
  return measureNodeText(text, { scale }).width;
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
