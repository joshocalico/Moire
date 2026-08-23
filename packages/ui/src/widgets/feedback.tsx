import React, { useEffect, useState, type ReactNode } from "react";
import { Group, Rect, Text, measureTextBounds } from "@moire/react-host";
import { Icon, type IconName } from "./icon.js";
import { Surface } from "./primitives.js";
import { useWidgetTheme } from "../widget-theme.js";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type BadgeProps = {
  x?: number;
  y?: number;
  text: string;
  tone?: BadgeTone;
  height?: number;
};

function toneColor(tone: BadgeTone, pal: ReturnType<typeof useWidgetTheme>["foundations"]["palette"]): number {
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
      <Rect width={width} height={height} fill={toneColor(props.tone ?? "neutral", pal)} radius={height / 2} />
      <Text x={Math.floor((width - bounds.width) / 2)} y={Math.floor((height - bounds.height) / 2)} text={props.text} color={0xffffffff} fontSize={10} fontWeight="medium" />
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
};

export function Banner(props: BannerProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const height = props.height ?? 64;
  const accent = toneColor(props.tone ?? "accent", pal);
  return (
    <Surface x={props.x} y={props.y} width={props.width} height={height} fill={pal.surface} radius={pal.radiusMd} stroke={pal.borderSubtle} strokeWidth={1}>
      <Rect width={4} height={height} fill={accent} radius={2} />
      {props.icon ? <Icon x={14} y={Math.floor((height - 20) / 2)} name={props.icon} size={20} color={accent} /> : null}
      <Text x={props.icon ? 44 : 16} y={props.message ? 12 : 22} text={props.title} color={pal.text} fontSize={13} fontWeight="medium" />
      {props.message ? <Text x={props.icon ? 44 : 16} y={34} text={props.message} color={pal.muted} fontSize={11} /> : null}
      {props.action ? <Group x={props.width - 120} y={14} width={108} height={36}>{props.action}</Group> : null}
    </Surface>
  );
}

export type SpinnerProps = { x?: number; y?: number; size?: number; color?: number; active?: boolean };

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
        const alpha = 0x30 + (((index - phase + 8) % 8) * 0x18);
        const color = props.color ?? pal.accent;
        return <Rect key={index} x={size / 2 + Math.cos(angle) * radius - dot / 2} y={size / 2 + Math.sin(angle) * radius - dot / 2} width={dot} height={dot} fill={((Math.min(0xff, alpha) << 24) | (color & 0x00ffffff)) >>> 0} radius={dot / 2} />;
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
};

export function EmptyState(props: EmptyStateProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const centerX = props.width / 2;
  const contentY = Math.max(20, props.height / 2 - 70);
  const title = measureTextBounds(props.title, { fontSize: 15, fontWeight: "medium" });
  const message = props.message ? measureTextBounds(props.message, { fontSize: 11 }) : null;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {props.icon ? <Icon x={centerX - 24} y={contentY} name={props.icon} size={48} color={pal.muted} /> : null}
      <Text x={centerX - title.width / 2} y={contentY + 58} text={props.title} color={pal.text} fontSize={15} fontWeight="medium" />
      {props.message && message ? <Text x={centerX - message.width / 2} y={contentY + 84} text={props.message} color={pal.muted} fontSize={11} /> : null}
      {props.action ? <Group x={centerX - 70} y={contentY + 108} width={140} height={36}>{props.action}</Group> : null}
    </Group>
  );
}
