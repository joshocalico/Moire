import React, { useMemo, useState, type ReactNode } from "react";
import { Group, Image, Rect, measureTextBounds, type HitPointerEvent } from "@moire/react-host";
import { useWidgetTheme } from "../widget-theme.js";
import { Box, Horizontal, registerIntrinsicSize } from "./layout.js";
import { Surface, TextBlock } from "./primitives.js";

export type ChartPoint = {
  x: number | string;
  y: number;
  label?: string;
};

export type ChartSeries = {
  id: string;
  label?: string;
  color?: number;
  points: readonly ChartPoint[];
};

export type ChartHover = {
  series: ChartSeries;
  point: ChartPoint;
  seriesIndex: number;
  pointIndex: number;
};

export type CartesianChartProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  series: readonly ChartSeries[];
  showAxes?: boolean;
  showGrid?: boolean;
  showLegend?: boolean;
  interactive?: boolean;
  yMin?: number;
  yMax?: number;
  formatValue?: (value: number) => string;
  onHover?: (hover: ChartHover | null) => void;
};

export type LineChartProps = CartesianChartProps & {
  lineWidth?: number;
  showPoints?: boolean;
};

export type AreaChartProps = LineChartProps & {
  fillOpacity?: number;
};

export type BarChartProps = CartesianChartProps & {
  barRadius?: number;
};

export type ScatterChartProps = CartesianChartProps & {
  pointRadius?: number;
};

export type SparklineProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  values: readonly number[];
  color?: number;
  fill?: boolean;
  lineWidth?: number;
};

export type DonutDatum = {
  id: string;
  label: string;
  value: number;
  color?: number;
};

export type DonutChartProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  data: readonly DonutDatum[];
  innerRadius?: number;
  showLegend?: boolean;
  formatValue?: (value: number) => string;
};

export type RadialChartProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  value: number;
  max?: number;
  label?: string;
  color?: number;
  trackColor?: number;
  thickness?: number;
  formatValue?: (value: number, max: number) => string;
};

export type HeatmapCell = {
  row: string;
  column: string;
  value: number;
};

export type HeatmapChartProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  cells: readonly HeatmapCell[];
  min?: number;
  max?: number;
  lowColor?: number;
  highColor?: number;
  showLabels?: boolean;
  formatValue?: (value: number) => string;
};

type CartesianMode = "line" | "area" | "bar" | "stacked-bar" | "scatter";
type Rgba = readonly [number, number, number, number];

const EXTRA_COLORS = [
  0xff6f9bd1,
  0xff70b77e,
  0xffd3a84f,
  0xffb47cc7,
  0xffd7786c,
  0xff5eb8a7,
] as const;

function rgba(color: number, alphaMultiplier = 1): Rgba {
  return [
    (color >>> 16) & 0xff,
    (color >>> 8) & 0xff,
    color & 0xff,
    Math.round(((color >>> 24) & 0xff) * alphaMultiplier),
  ];
}

function mixColor(from: number, to: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const channel = (shift: number) => Math.round(
    ((from >>> shift) & 0xff) * (1 - t) + ((to >>> shift) & 0xff) * t,
  );
  return ((channel(24) << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)) >>> 0;
}

class RasterCanvas {
  readonly pixels: Uint8Array;

  constructor(readonly width: number, readonly height: number) {
    this.pixels = new Uint8Array(width * height * 4);
  }

  blend(x: number, y: number, color: Rgba): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const offset = (py * this.width + px) * 4;
    const sourceAlpha = color[3] / 255;
    const destinationAlpha = this.pixels[offset + 3]! / 255;
    const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    if (outAlpha <= 0) return;
    this.pixels[offset] = Math.round((color[0] * sourceAlpha + this.pixels[offset]! * destinationAlpha * (1 - sourceAlpha)) / outAlpha);
    this.pixels[offset + 1] = Math.round((color[1] * sourceAlpha + this.pixels[offset + 1]! * destinationAlpha * (1 - sourceAlpha)) / outAlpha);
    this.pixels[offset + 2] = Math.round((color[2] * sourceAlpha + this.pixels[offset + 2]! * destinationAlpha * (1 - sourceAlpha)) / outAlpha);
    this.pixels[offset + 3] = Math.round(outAlpha * 255);
  }

  rect(x: number, y: number, width: number, height: number, color: Rgba, radius = 0): void {
    const left = Math.floor(x);
    const top = Math.floor(y);
    const right = Math.ceil(x + width);
    const bottom = Math.ceil(y + height);
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    for (let py = top; py < bottom; py++) {
      for (let px = left; px < right; px++) {
        if (r > 0) {
          const cx = px < x + r ? x + r : px > x + width - r ? x + width - r : px;
          const cy = py < y + r ? y + r : py > y + height - r ? y + height - r : py;
          if ((px - cx) ** 2 + (py - cy) ** 2 > r ** 2) continue;
        }
        this.blend(px, py, color);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Rgba, width = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.max(1, Math.hypot(dx, dy));
    const steps = Math.max(1, Math.ceil(length * 1.4));
    for (let step = 0; step <= steps; step++) {
      const amount = step / steps;
      this.circle(x0 + dx * amount, y0 + dy * amount, width / 2, color);
    }
  }

  circle(cx: number, cy: number, radius: number, color: Rgba): void {
    const r = Math.max(0.5, radius);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) this.blend(x, y, color);
      }
    }
  }

  polygon(points: readonly { x: number; y: number }[], color: Rgba): void {
    if (points.length < 3) return;
    const minY = Math.floor(Math.min(...points.map((point) => point.y)));
    const maxY = Math.ceil(Math.max(...points.map((point) => point.y)));
    for (let y = minY; y <= maxY; y++) {
      const intersections: number[] = [];
      for (let index = 0; index < points.length; index++) {
        const first = points[index]!;
        const second = points[(index + 1) % points.length]!;
        if ((first.y <= y && second.y > y) || (second.y <= y && first.y > y)) {
          intersections.push(first.x + ((y - first.y) * (second.x - first.x)) / (second.y - first.y));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        this.rect(intersections[index]!, y, intersections[index + 1]! - intersections[index]!, 1, color);
      }
    }
  }
}

function chartColors(accent: number): readonly number[] {
  return [accent, ...EXTRA_COLORS];
}

function finiteValues(series: readonly ChartSeries[]): number[] {
  return series.flatMap((entry) => entry.points.map((point) => point.y)).filter(Number.isFinite);
}

function categories(series: readonly ChartSeries[]): Array<number | string> {
  const seen = new Set<number | string>();
  const values: Array<number | string> = [];
  for (const entry of series) {
    for (const point of entry.points) {
      if (seen.has(point.x)) continue;
      seen.add(point.x);
      values.push(point.x);
    }
  }
  return values;
}

function shortNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (absolute > 0 && absolute < 1) return value.toFixed(2);
  return String(Math.round(value));
}

function CartesianChart(props: CartesianChartProps & {
  mode: CartesianMode;
  lineWidth?: number;
  showPoints?: boolean;
  fillOpacity?: number;
  barRadius?: number;
  pointRadius?: number;
}): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const showAxes = props.showAxes !== false;
  const showGrid = props.showGrid !== false;
  const showLegend = props.showLegend ?? props.series.length > 1;
  const interactive = props.interactive !== false;
  const legendHeight = showLegend ? 26 : 0;
  const left = showAxes ? 42 : 5;
  const right = 10;
  const top = 8 + legendHeight;
  const bottom = showAxes ? 25 : 5;
  const plotWidth = Math.max(1, props.width - left - right);
  const plotHeight = Math.max(1, props.height - top - bottom);
  const values = useMemo(() => finiteValues(props.series), [props.series]);
  const xValues = useMemo(() => categories(props.series), [props.series]);
  const stackedMax = props.mode === "stacked-bar"
    ? Math.max(0, ...xValues.map((x) => props.series.reduce((sum, entry) => sum + Math.max(0, entry.points.find((point) => point.x === x)?.y ?? 0), 0)))
    : null;
  const rawMin = values.length > 0 ? Math.min(...values) : 0;
  const rawMax = stackedMax ?? (values.length > 0 ? Math.max(...values) : 1);
  const includesZero = props.mode === "bar" || props.mode === "stacked-bar" || props.mode === "area";
  const domainMin = props.yMin ?? (includesZero ? Math.min(0, rawMin) : rawMin);
  const initialMax = props.yMax ?? (includesZero ? Math.max(0, rawMax) : rawMax);
  const domainMax = initialMax === domainMin ? domainMin + 1 : initialMax;
  const colors = useMemo(() => chartColors(pal.accent), [pal.accent]);
  const [hover, setHover] = useState<ChartHover | null>(null);
  const xIndex = new Map(xValues.map((value, index) => [value, index]));
  const usesCategoryBins = props.mode === "bar" || props.mode === "stacked-bar";
  const xPosition = (value: number | string): number => {
    const index = xIndex.get(value) ?? 0;
    if (usesCategoryBins) return left + ((index + 0.5) / Math.max(1, xValues.length)) * plotWidth;
    if (xValues.length <= 1) return left + plotWidth / 2;
    return left + (index / (xValues.length - 1)) * plotWidth;
  };
  const yPosition = (value: number): number => top + (1 - (value - domainMin) / (domainMax - domainMin)) * plotHeight;
  const imagePixels = useMemo(() => {
    const canvas = new RasterCanvas(props.width, props.height);
    if (showGrid) {
      for (let tick = 0; tick <= 4; tick++) {
        const y = top + (tick / 4) * plotHeight;
        canvas.line(left, y, left + plotWidth, y, rgba(pal.borderSubtle), 1);
      }
    }
    if (showAxes) {
      canvas.line(left, top, left, top + plotHeight, rgba(pal.border), 1);
      canvas.line(left, top + plotHeight, left + plotWidth, top + plotHeight, rgba(pal.border), 1);
    }
    const baseline = yPosition(Math.max(domainMin, Math.min(domainMax, 0)));
    props.series.forEach((entry, seriesIndex) => {
      const color = entry.color ?? colors[seriesIndex % colors.length]!;
      const points = entry.points
        .filter((point) => Number.isFinite(point.y))
        .map((point) => ({ x: xPosition(point.x), y: yPosition(point.y), point }));
      if (props.mode === "area" && points.length > 1) {
        canvas.polygon([
          { x: points[0]!.x, y: baseline },
          ...points,
          { x: points[points.length - 1]!.x, y: baseline },
        ], rgba(color, props.fillOpacity ?? 0.22));
      }
      if (props.mode === "line" || props.mode === "area") {
        for (let index = 1; index < points.length; index++) {
          canvas.line(points[index - 1]!.x, points[index - 1]!.y, points[index]!.x, points[index]!.y, rgba(color), props.lineWidth ?? 2);
        }
        if (props.showPoints !== false) {
          for (const point of points) canvas.circle(point.x, point.y, 3, rgba(color));
        }
      } else if (props.mode === "scatter") {
        for (const point of points) {
          canvas.circle(point.x, point.y, props.pointRadius ?? 4, rgba(color, 0.9));
        }
      }
    });
    if (props.mode === "bar" || props.mode === "stacked-bar") {
      const categoryWidth = plotWidth / Math.max(1, xValues.length);
      const groupWidth = categoryWidth * 0.7;
      xValues.forEach((xValue, categoryIndex) => {
        let stackValue = 0;
        props.series.forEach((entry, seriesIndex) => {
          const value = entry.points.find((point) => point.x === xValue)?.y ?? 0;
          const color = entry.color ?? colors[seriesIndex % colors.length]!;
          if (props.mode === "stacked-bar") {
            const start = yPosition(stackValue);
            stackValue += Math.max(0, value);
            const end = yPosition(stackValue);
            canvas.rect(left + categoryIndex * categoryWidth + (categoryWidth - groupWidth) / 2, end, groupWidth, Math.max(1, start - end), rgba(color), props.barRadius ?? 3);
          } else {
            const width = groupWidth / Math.max(1, props.series.length);
            const y = yPosition(value);
            canvas.rect(left + categoryIndex * categoryWidth + (categoryWidth - groupWidth) / 2 + seriesIndex * width, Math.min(y, baseline), Math.max(1, width - 2), Math.max(1, Math.abs(baseline - y)), rgba(color), props.barRadius ?? 3);
          }
        });
      });
    }
    return canvas.pixels;
  }, [colors, domainMax, domainMin, left, pal.border, pal.borderSubtle, plotHeight, plotWidth, props.barRadius, props.fillOpacity, props.height, props.lineWidth, props.mode, props.pointRadius, props.series, props.showPoints, props.width, showAxes, showGrid, top, xValues]);

  const handleMove = (event: HitPointerEvent) => {
    if (!interactive || xValues.length === 0) return;
    const ratio = Math.max(0, Math.min(1, (event.localX - left) / plotWidth));
    const pointIndex = Math.max(0, Math.min(
      xValues.length - 1,
      usesCategoryBins
        ? Math.floor(ratio * xValues.length)
        : Math.round(ratio * Math.max(0, xValues.length - 1)),
    ));
    const xValue = xValues[pointIndex]!;
    const candidates = props.series.flatMap((series, seriesIndex) => {
      const seriesPointIndex = series.points.findIndex((point) => point.x === xValue);
      const point = series.points[seriesPointIndex];
      return point ? [{ series, seriesIndex, point, pointIndex: seriesPointIndex }] : [];
    });
    const next = candidates.sort((a, b) => Math.abs(yPosition(a.point.y) - event.localY) - Math.abs(yPosition(b.point.y) - event.localY))[0] ?? null;
    setHover(next);
    props.onHover?.(next);
  };
  const clearHover = () => {
    setHover(null);
    props.onHover?.(null);
  };
  const format = props.formatValue ?? shortNumber;
  const hoverX = hover ? xPosition(hover.point.x) : 0;
  const hoverY = hover ? yPosition(hover.point.y) : 0;
  const tooltipWidth = 142;
  const tooltipX = Math.max(4, Math.min(props.width - tooltipWidth - 4, hoverX + 10));
  const labelIndexes = xValues.length <= 6
    ? xValues.map((_, index) => index)
    : [0, Math.round((xValues.length - 1) / 2), xValues.length - 1];

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height} clip>
      <Image width={props.width} height={props.height} imagePixels={imagePixels} imageWidth={props.width} imageHeight={props.height} />
      {showAxes ? [0, 1, 2, 3, 4].map((tick) => {
        const value = domainMax - (tick / 4) * (domainMax - domainMin);
        return <TextBlock key={`y:${tick}`} x={0} y={top + (tick / 4) * plotHeight - 7} width={left - 7} height={14} text={format(value)} color={pal.muted} fontSize={9} horizontalAlign="end" verticalAlign="center" overflow="ellipsis" maxLines={1} />;
      }) : null}
      {showAxes ? labelIndexes.map((index) => {
        const center = xPosition(xValues[index]!);
        return <TextBlock key={`x:${index}`} x={center - 36} y={top + plotHeight + 5} width={72} height={14} text={String(xValues[index])} color={pal.muted} fontSize={9} horizontalAlign="center" overflow="ellipsis" maxLines={1} />;
      }) : null}
      {showLegend ? <ChartLegend x={left} y={2} width={plotWidth} series={props.series} /> : null}
      {hover ? (
        <>
          <Rect x={hoverX} y={top} width={1} height={plotHeight} fill={(pal.accent & 0x00ffffff) | 0x66000000} />
          <Rect x={hoverX - 4} y={hoverY - 4} width={8} height={8} fill={hover.series.color ?? colors[hover.seriesIndex % colors.length]} radius={4} stroke={pal.text} strokeWidth={1} />
          <Surface x={tooltipX} y={Math.max(top + 4, hoverY - 50)} width={tooltipWidth} height={42} fill={pal.overlay} radius={7} stroke={pal.border} strokeWidth={1}>
            <TextBlock x={9} y={6} width={tooltipWidth - 18} height={14} text={hover.point.label ?? String(hover.point.x)} color={pal.text} fontSize={10} fontWeight="medium" overflow="ellipsis" maxLines={1} />
            <TextBlock x={9} y={22} width={tooltipWidth - 18} height={13} text={`${hover.series.label ?? hover.series.id}: ${format(hover.point.y)}`} color={pal.accent} fontSize={9} overflow="ellipsis" maxLines={1} />
          </Surface>
        </>
      ) : null}
      {interactive ? <Rect width={props.width} height={props.height} fill={0x00000000} onPointerMove={handleMove} onPointerLeave={clearHover} /> : null}
    </Group>
  );
}

export function ChartLegend(props: {
  x?: number;
  y?: number;
  width: number;
  series: readonly Pick<ChartSeries, "id" | "label" | "color">[];
}): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const colors = chartColors(pal.accent);
  return (
    <Horizontal x={props.x} y={props.y} width={props.width} height={20} gap={12} align="center">
      {props.series.map((series, index) => (
        <Horizontal key={series.id} width={Math.min(props.width, measureTextBounds(series.label ?? series.id, { fontSize: 9 }).width + 17)} height={18} gap={5} align="center">
          <Box width={8} height={8}><Rect width={8} height={8} fill={series.color ?? colors[index % colors.length]} radius={2} /></Box>
          <TextBlock flexGrow={1} text={series.label ?? series.id} color={pal.muted} fontSize={9} overflow="ellipsis" maxLines={1} />
        </Horizontal>
      ))}
    </Horizontal>
  );
}

export function LineChart(props: LineChartProps): ReactNode {
  return <CartesianChart {...props} mode="line" />;
}

export function AreaChart(props: AreaChartProps): ReactNode {
  return <CartesianChart {...props} mode="area" />;
}

export function BarChart(props: BarChartProps): ReactNode {
  return <CartesianChart {...props} mode="bar" />;
}

export function StackedBarChart(props: BarChartProps): ReactNode {
  return <CartesianChart {...props} mode="stacked-bar" />;
}

export function ScatterChart(props: ScatterChartProps): ReactNode {
  return <CartesianChart {...props} mode="scatter" />;
}

export function Sparkline(props: SparklineProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const series = useMemo<ChartSeries[]>(() => [{
    id: "value",
    color: props.color ?? pal.accent,
    points: props.values.map((value, index) => ({ x: index, y: value })),
  }], [pal.accent, props.color, props.values]);
  return (
    <CartesianChart
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      series={series}
      mode={props.fill ? "area" : "line"}
      lineWidth={props.lineWidth ?? 2}
      showAxes={false}
      showGrid={false}
      showLegend={false}
      showPoints={false}
      interactive={false}
    />
  );
}

export function DonutChart(props: DonutChartProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const colors = useMemo(() => chartColors(pal.accent), [pal.accent]);
  const legendWidth = props.showLegend === false ? 0 : Math.min(180, Math.round(props.width * 0.42));
  const chartWidth = Math.max(1, props.width - legendWidth);
  const radius = Math.max(10, Math.min(chartWidth, props.height) / 2 - 8);
  const innerRadius = radius * Math.max(0, Math.min(0.9, props.innerRadius ?? 0.58));
  const centerX = chartWidth / 2;
  const centerY = props.height / 2;
  const total = props.data.reduce((sum, datum) => sum + Math.max(0, datum.value), 0);
  const imagePixels = useMemo(() => {
    const canvas = new RasterCanvas(props.width, props.height);
    const cumulative: number[] = [];
    let sum = 0;
    for (const datum of props.data) {
      sum += Math.max(0, datum.value);
      cumulative.push(sum);
    }
    for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y++) {
      for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x++) {
        const distance = Math.hypot(x - centerX, y - centerY);
        if (distance < innerRadius || distance > radius || total <= 0) continue;
        const angle = (Math.atan2(y - centerY, x - centerX) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
        const value = (angle / (Math.PI * 2)) * total;
        const index = cumulative.findIndex((end) => value <= end);
        canvas.blend(x, y, rgba(props.data[index]?.color ?? colors[index % colors.length] ?? pal.accent));
      }
    }
    return canvas.pixels;
  }, [centerX, centerY, colors, innerRadius, pal.accent, props.data, props.height, props.width, radius, total]);
  const format = props.formatValue ?? shortNumber;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      <Image width={props.width} height={props.height} imagePixels={imagePixels} imageWidth={props.width} imageHeight={props.height} />
      <TextBlock x={centerX - innerRadius} y={centerY - 10} width={innerRadius * 2} height={20} text={format(total)} color={pal.text} fontSize={16} fontWeight="bold" horizontalAlign="center" verticalAlign="center" overflow="ellipsis" maxLines={1} />
      {legendWidth > 0 ? (
        <Group x={chartWidth} width={legendWidth} height={props.height}>
          {props.data.map((datum, index) => (
            <Group key={datum.id} y={8 + index * 26} width={legendWidth} height={22}>
              <Rect x={2} y={7} width={8} height={8} fill={datum.color ?? colors[index % colors.length]} radius={2} />
              <TextBlock x={18} width={Math.max(1, legendWidth - 72)} height={22} text={datum.label} color={pal.muted} fontSize={9} verticalAlign="center" overflow="ellipsis" maxLines={1} />
              <TextBlock x={Math.max(1, legendWidth - 50)} width={48} height={22} text={format(datum.value)} color={pal.text} fontSize={9} horizontalAlign="end" verticalAlign="center" overflow="ellipsis" maxLines={1} />
            </Group>
          ))}
        </Group>
      ) : null}
    </Group>
  );
}

export function RadialChart(props: RadialChartProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const max = Math.max(0.0001, props.max ?? 1);
  const ratio = Math.max(0, Math.min(1, props.value / max));
  const radius = Math.max(8, Math.min(props.width, props.height) / 2 - 8);
  const thickness = Math.max(2, Math.min(radius, props.thickness ?? Math.max(6, radius * 0.18)));
  const centerX = props.width / 2;
  const centerY = props.height / 2;
  const imagePixels = useMemo(() => {
    const canvas = new RasterCanvas(props.width, props.height);
    const inner = radius - thickness;
    for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y++) {
      for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x++) {
        const distance = Math.hypot(x - centerX, y - centerY);
        if (distance < inner || distance > radius) continue;
        const angle = (Math.atan2(y - centerY, x - centerX) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
        canvas.blend(x, y, rgba(angle / (Math.PI * 2) <= ratio ? (props.color ?? pal.accent) : (props.trackColor ?? pal.border)));
      }
    }
    return canvas.pixels;
  }, [centerX, centerY, pal.accent, pal.border, props.color, props.height, props.trackColor, props.width, radius, ratio, thickness]);
  const valueText = props.formatValue?.(props.value, max) ?? `${Math.round(ratio * 100)}%`;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      <Image width={props.width} height={props.height} imagePixels={imagePixels} imageWidth={props.width} imageHeight={props.height} />
      <TextBlock x={centerX - radius + thickness} y={centerY - 14} width={(radius - thickness) * 2} height={20} text={valueText} color={pal.text} fontSize={16} fontWeight="bold" horizontalAlign="center" overflow="ellipsis" maxLines={1} />
      {props.label ? <TextBlock x={centerX - radius + thickness} y={centerY + 7} width={(radius - thickness) * 2} height={14} text={props.label} color={pal.muted} fontSize={9} horizontalAlign="center" overflow="ellipsis" maxLines={1} /> : null}
    </Group>
  );
}

export function HeatmapChart(props: HeatmapChartProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const rows = [...new Set(props.cells.map((cell) => cell.row))];
  const columns = [...new Set(props.cells.map((cell) => cell.column))];
  const values = props.cells.map((cell) => cell.value).filter(Number.isFinite);
  const min = props.min ?? (values.length > 0 ? Math.min(...values) : 0);
  const inferredMax = props.max ?? (values.length > 0 ? Math.max(...values) : 1);
  const max = inferredMax === min ? min + 1 : inferredMax;
  const labelWidth = props.showLabels === false ? 2 : 48;
  const labelHeight = props.showLabels === false ? 2 : 20;
  const cellWidth = Math.max(1, (props.width - labelWidth - 4) / Math.max(1, columns.length));
  const cellHeight = Math.max(1, (props.height - labelHeight - 4) / Math.max(1, rows.length));
  const low = props.lowColor ?? pal.surface;
  const high = props.highColor ?? pal.accentLine;
  const [hovered, setHovered] = useState<HeatmapCell | null>(null);
  const format = props.formatValue ?? shortNumber;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height} clip>
      {props.showLabels !== false ? rows.map((row, index) => <TextBlock key={row} x={0} y={labelHeight + index * cellHeight} width={labelWidth - 6} height={cellHeight} text={row} color={pal.muted} fontSize={8} horizontalAlign="end" verticalAlign="center" overflow="ellipsis" maxLines={1} />) : null}
      {props.showLabels !== false ? columns.map((column, index) => <TextBlock key={column} x={labelWidth + index * cellWidth} y={0} width={cellWidth} height={labelHeight - 3} text={column} color={pal.muted} fontSize={8} horizontalAlign="center" verticalAlign="end" overflow="ellipsis" maxLines={1} />) : null}
      {props.cells.map((cell) => {
        const row = Math.max(0, rows.indexOf(cell.row));
        const column = Math.max(0, columns.indexOf(cell.column));
        const amount = (cell.value - min) / (max - min);
        return <Rect key={`${cell.row}:${cell.column}`} x={labelWidth + column * cellWidth + 1} y={labelHeight + row * cellHeight + 1} width={Math.max(1, cellWidth - 2)} height={Math.max(1, cellHeight - 2)} fill={mixColor(low, high, amount)} radius={3} onPointerEnter={() => setHovered(cell)} onPointerLeave={() => setHovered(null)} />;
      })}
      {hovered ? (
        <Surface x={Math.max(labelWidth, props.width - 132)} y={4} width={126} height={36} fill={pal.overlay} radius={7} stroke={pal.border} strokeWidth={1}>
          <TextBlock x={8} y={4} width={110} height={13} text={`${hovered.row} · ${hovered.column}`} color={pal.muted} fontSize={8} overflow="ellipsis" maxLines={1} />
          <TextBlock x={8} y={18} width={110} height={13} text={format(hovered.value)} color={pal.accent} fontSize={10} fontWeight="medium" overflow="ellipsis" maxLines={1} />
        </Surface>
      ) : null}
    </Group>
  );
}

for (const chart of [LineChart, AreaChart, BarChart, StackedBarChart, ScatterChart]) {
  registerIntrinsicSize(chart, (props) => ({ width: props.width, height: props.height }));
}
registerIntrinsicSize(Sparkline, (props) => ({ width: props.width, height: props.height }));
registerIntrinsicSize(DonutChart, (props) => ({ width: props.width, height: props.height }));
registerIntrinsicSize(RadialChart, (props) => ({ width: props.width, height: props.height }));
registerIntrinsicSize(HeatmapChart, (props) => ({ width: props.width, height: props.height }));
