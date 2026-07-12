/**
 * Yoga layout helpers — OS-agnostic.
 */
import Yoga, {
  Align,
  Direction,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  Wrap,
} from "yoga-layout";

export type FlexChildSpec = {
  width?: number;
  height?: number;
  flexGrow?: number;
  flexShrink?: number;
  minWidth?: number;
  minHeight?: number;
  margin?: number;
};

export type FlexContainerOpts = {
  direction: "row" | "column";
  width: number;
  height?: number;
  gap?: number;
  padding?: number;
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
  root.setFlexDirection(
    opts.direction === "row" ? FlexDirection.Row : FlexDirection.Column,
  );
  root.setWidth(opts.width);
  if (opts.height != null) root.setHeight(opts.height);
  if (opts.gap != null) root.setGap(Gutter.All, opts.gap);
  if (opts.padding != null) root.setPadding(Edge.All, opts.padding);
  root.setJustifyContent(mapJustify(opts.justify));
  root.setAlignItems(mapAlign(opts.align ?? "stretch"));
  if (opts.wrap) root.setFlexWrap(Wrap.Wrap);

  const nodes: ReturnType<typeof Yoga.Node.create>[] = [];
  for (const c of children) {
    const n = Yoga.Node.create();
    if (c.width != null) n.setWidth(c.width);
    if (c.height != null) n.setHeight(c.height);
    if (c.flexGrow != null) n.setFlexGrow(c.flexGrow);
    if (c.flexShrink != null) n.setFlexShrink(c.flexShrink);
    if (c.minWidth != null) n.setMinWidth(c.minWidth);
    if (c.minHeight != null) n.setMinHeight(c.minHeight);
    if (c.margin != null) n.setMargin(Edge.All, c.margin);
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
