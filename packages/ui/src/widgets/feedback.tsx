import React, { useEffect, useState, type ReactNode } from "react";
import { Group, Rect, measureTextBounds } from "@moire/react-host";
import { Icon, type IconName } from "./icon";
import { Surface, TextBlock } from "./primitives";
import { Align, Box, Center, Horizontal, Inset, Vertical, registerIntrinsicSize } from "./layout";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type BadgeProps = {
  x?: number;
  y?: number;
  text: string;
  tone?: BadgeTone;
  height?: number;
};

function toneColor(
  tone: BadgeTone,
  pal: ReturnType<typeof useWidgetTheme>["foundations"]["palette"],
): number {
  if (tone === "accent") return pal.accentLine;
  if (tone === "success") return 0xff4f9b70;
  if (tone === "warning") return 0xffb48738;
  if (tone === "danger") return pal.danger;
  return pal.surface;
}

export function Badge(props: BadgeProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const height = props.height ?? 22;
  const bounds = measureTextBounds(props.text, { fontSize: 10, fontWeight: "medium" });
  const width = Math.max(height, bounds.width + 14);
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
      <Rect
        width={width}
        height={height}
        fill={toneColor(props.tone ?? "neutral", pal)}
        radius={height / 2}
      />
      <TextBlock
        width={width}
        height={height}
        text={props.text}
        color={0xffffffff}
        fontSize={10}
        fontWeight="medium"
        horizontalAlign="center"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
    </Group>
  );
}

export type BannerProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  title: string;
  message?: string;
  tone?: BadgeTone;
  icon?: IconName;
  action?: ReactNode;
  /** Room for `action` (scaled); 140 by default, wider for a row of buttons. */
  actionWidth?: number;
};

/** The banner's height for these props, scaled. */
export function bannerHeight(props: Pick<BannerProps, "height" | "message">): number {
  return props.height ?? (props.message ? 70 : 56) * getUiScaleFactor();
}

export function Banner(props: BannerProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const height = bannerHeight(props);
  const accent = toneColor(props.tone ?? "accent", pal);
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={height}
      fill={pal.surface}
      radius={theme.foundations.radii.medium}
      stroke={pal.borderSubtle}
      strokeWidth={theme.foundations.borders.control}
      elevation="low"
    >
      <Rect width={4 * ui} height={height} fill={accent} radius={2 * ui} />
      <Inset
        width={props.width}
        height={height}
        padding={{ left: 14 * ui, right: 12 * ui, vertical: 10 * ui }}
      >
        <Horizontal gap={10 * ui} align="center">
          {props.icon ? (
            <Box width={20 * ui} height={20 * ui}>
              <Icon name={props.icon} size={20 * ui} color={accent} symbolic />
            </Box>
          ) : null}
          <Vertical flexGrow={1} gap={2 * ui} justify="center">
            <TextBlock
              height={18 * ui}
              text={props.title}
              color={pal.text}
              fontSize={13}
              fontWeight="medium"
              verticalAlign="center"
              overflow="ellipsis"
              maxLines={1}
            />
            {props.message ? (
              <TextBlock
                height={30 * ui}
                text={props.message}
                color={pal.muted}
                fontSize={11}
                wrap
                lineGap={2}
                verticalAlign="center"
                overflow="ellipsis"
                maxLines={2}
              />
            ) : null}
          </Vertical>
          {props.action ? (
            <Align width={props.actionWidth ?? 108 * ui} alignX="stretch" alignY="center">
              {props.action}
            </Align>
          ) : null}
        </Horizontal>
      </Inset>
    </Surface>
  );
}

export type SpinnerProps = {
  x?: number;
  y?: number;
  size?: number;
  color?: number;
  active?: boolean;
};

export function Spinner(props: SpinnerProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const [phase, setPhase] = useState(0);
  const size = props.size ?? 24;
  useEffect(() => {
    if (props.active === false) return;
    const timer = setInterval(() => setPhase((value) => (value + 1) % 8), 90);
    return () => clearInterval(timer);
  }, [props.active]);
  const dot = Math.max(2, Math.round(size / 7));
  const radius = (size - dot) / 2;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={size} height={size}>
      {Array.from({ length: 8 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 8 - Math.PI / 2;
        const alpha = 0x30 + ((index - phase + 8) % 8) * 0x18;
        const color = props.color ?? pal.accent;
        return (
          <Rect
            key={index}
            x={size / 2 + Math.cos(angle) * radius - dot / 2}
            y={size / 2 + Math.sin(angle) * radius - dot / 2}
            width={dot}
            height={dot}
            fill={((Math.min(0xff, alpha) << 24) | (color & 0x00ffffff)) >>> 0}
            radius={dot / 2}
          />
        );
      })}
    </Group>
  );
}

export type EmptyStateProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  title: string;
  message?: string;
  icon?: IconName;
  action?: ReactNode;
  /** Room for `action` (scaled); 140 by default, wider for a row of buttons. */
  actionWidth?: number;
};

export function EmptyState(props: EmptyStateProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const contentWidth = Math.max(1, Math.min(360 * ui, props.width - 32 * ui));
  const contentHeight =
    ((props.icon ? 56 : 0) + 24 + (props.message ? 44 : 0) + (props.action ? 46 : 0)) * ui;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      <Center width={props.width} height={props.height}>
        <Vertical width={contentWidth} height={contentHeight} gap={8 * ui} align="center">
          {props.icon ? (
            <Box width={48 * ui} height={48 * ui}>
              <Icon name={props.icon} size={48 * ui} color={pal.muted} symbolic />
            </Box>
          ) : null}
          <TextBlock
            width={contentWidth}
            height={24 * ui}
            text={props.title}
            color={pal.text}
            fontSize={15}
            fontWeight="medium"
            horizontalAlign="center"
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
          {props.message ? (
            <TextBlock
              width={contentWidth}
              height={36 * ui}
              text={props.message}
              color={pal.muted}
              fontSize={11}
              horizontalAlign="center"
              verticalAlign="center"
              wrap
              lineGap={3}
              overflow="ellipsis"
              maxLines={2}
            />
          ) : null}
          {props.action ? (
            <Box width={Math.min(contentWidth, props.actionWidth ?? 140 * ui)} height={36 * ui}>
              {props.action}
            </Box>
          ) : null}
        </Vertical>
      </Center>
    </Group>
  );
}

registerIntrinsicSize(Badge, (props) => {
  const height = props.height ?? 22;
  const bounds = measureTextBounds(props.text, { fontSize: 10, fontWeight: "medium" });
  return { width: Math.max(height, bounds.width + 14), height };
});

registerIntrinsicSize(Banner, (props) => ({ width: props.width, height: bannerHeight(props) }));

registerIntrinsicSize(Spinner, (props) => {
  const size = props.size ?? 24;
  return { width: size, height: size };
});

registerIntrinsicSize(EmptyState, (props) => ({
  width: props.width,
  height: props.height,
}));
