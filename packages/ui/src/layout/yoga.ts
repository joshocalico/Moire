/**
 * Yoga layout helpers — OS-agnostic.
 */
import Yoga, {
  Align,
  BoxSizing,
  Direction,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  Wrap,
} from "yoga-layout";

/** CSS-like edge values accepted by Moire's public box model. */
export type Insets =
  | number
  | {
      horizontal?: number;
      vertical?: number;
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };

export type ResolvedInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export function resolveInsets(value?: Insets): ResolvedInsets {
  if (typeof value === "number") {
    return { top: value, right: value, bottom: value, left: value };
  }
  const horizontal = value?.horizontal ?? 0;
  const vertical = value?.vertical ?? 0;
  return {
    top: value?.top ?? vertical,
    right: value?.right ?? horizontal,
    bottom: value?.bottom ?? vertical,
    left: value?.left ?? horizontal,
  };
}

export type FlexChildSpec = {
  width?: number;
  height?: number;
  flexGrow?: number;
  flexShrink?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  alignSelf?: "start" | "center" | "end" | "stretch";
  margin?: Insets;
};

export type FlexContainerOpts = {
  direction: "row" | "column";
  width: number;
  height?: number;
  gap?: number;
  padding?: Insets;
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  align?: "start" | "center" | "end" | "stretch";
  wrap?: boolean;
};

export type FlexLayoutResult = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function mapJustify(j: FlexContainerOpts["justify"]): Justify {
  switch (j) {
    case "center":
      return Justify.Center;
    case "end":
      return Justify.FlexEnd;
    case "space-between":
      return Justify.SpaceBetween;
    case "space-around":
      return Justify.SpaceAround;
    default:
      return Justify.FlexStart;
  }
}

function applyEdges(
  value: Insets | undefined,
  apply: (edge: Edge, amount: number) => void,
): void {
  if (value == null) return;
  const edges = resolveInsets(value);
  apply(Edge.Top, edges.top);
  apply(Edge.Right, edges.right);
  apply(Edge.Bottom, edges.bottom);
  apply(Edge.Left, edges.left);
}

function mapAlign(a: FlexContainerOpts["align"]): Align {
  switch (a) {
    case "center":
      return Align.Center;
    case "end":
      return Align.FlexEnd;
    case "stretch":
      return Align.Stretch;
    default:
      return Align.FlexStart;
  }
}

/** Compute absolute child boxes for a flex container. */
export function layoutFlex(
  opts: FlexContainerOpts,
  children: FlexChildSpec[],
): { container: FlexLayoutResult; children: FlexLayoutResult[] } {
  const root = Yoga.Node.create();
  root.setBoxSizing(BoxSizing.BorderBox);
  root.setFlexDirection(
    opts.direction === "row" ? FlexDirection.Row : FlexDirection.Column,
  );
  root.setWidth(opts.width);
  if (opts.height != null) root.setHeight(opts.height);
  if (opts.gap != null) root.setGap(Gutter.All, opts.gap);
  applyEdges(opts.padding, (edge, amount) => root.setPadding(edge, amount));
  root.setJustifyContent(mapJustify(opts.justify));
  root.setAlignItems(mapAlign(opts.align ?? "stretch"));
  if (opts.wrap) root.setFlexWrap(Wrap.Wrap);

  const nodes: ReturnType<typeof Yoga.Node.create>[] = [];
  for (const c of children) {
    const n = Yoga.Node.create();
    n.setBoxSizing(BoxSizing.BorderBox);
    if (c.width != null) n.setWidth(c.width);
    if (c.height != null) n.setHeight(c.height);
    if (c.flexGrow != null) n.setFlexGrow(c.flexGrow);
    if (c.flexShrink != null) n.setFlexShrink(c.flexShrink);
    if (c.minWidth != null) n.setMinWidth(c.minWidth);
    if (c.minHeight != null) n.setMinHeight(c.minHeight);
    if (c.maxWidth != null) n.setMaxWidth(c.maxWidth);
    if (c.maxHeight != null) n.setMaxHeight(c.maxHeight);
    if (c.aspectRatio != null) n.setAspectRatio(c.aspectRatio);
    if (c.alignSelf != null) n.setAlignSelf(mapAlign(c.alignSelf));
    applyEdges(c.margin, (edge, amount) => n.setMargin(edge, amount));
    root.insertChild(n, nodes.length);
    nodes.push(n);
  }

  root.calculateLayout(opts.width, opts.height ?? undefined, Direction.LTR);

  const results = nodes.map((n) => ({
    x: n.getComputedLeft(),
    y: n.getComputedTop(),
    width: n.getComputedWidth(),
    height: n.getComputedHeight(),
  }));

  const container = {
    x: 0,
    y: 0,
    width: root.getComputedWidth(),
    height: root.getComputedHeight(),
  };

  root.freeRecursive();

  return { container, children: results };
}

export { Align, Direction, Edge, FlexDirection, Gutter, Justify, Wrap, Yoga };
