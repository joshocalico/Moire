import React, { useMemo, useRef, useState, type ReactNode } from "react";
import { Group, Rect, Text, type HitPointerEvent } from "@moire/react-host";
import { themePalette } from "../theme.js";

export type DisplayArrangementItem = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary?: boolean;
};

export type DisplayArrangementProps = {
  width: number;
  height: number;
  items: DisplayArrangementItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onChange?: (items: DisplayArrangementItem[]) => void;
};

/** Compact, draggable monitor map shared by Settings and future setup flows. */
export function DisplayArrangement(props: DisplayArrangementProps): ReactNode {
  const pal = themePalette();
  const [preview, setPreview] = useState<DisplayArrangementItem[] | null>(null);
  const items = preview ?? props.items;
  const drag = useRef<{
    id: string;
    pointerX: number;
    pointerY: number;
    itemX: number;
    itemY: number;
  } | null>(null);
  const padding = 18;
  const geometry = useMemo(() => {
    const right = Math.max(1, ...props.items.map((item) => item.x + item.width));
    const bottom = Math.max(1, ...props.items.map((item) => item.y + item.height));
    const scale = Math.min(
      (props.width - padding * 2) / right,
      (props.height - padding * 2) / bottom,
      0.12,
    );
    const contentW = right * scale;
    const contentH = bottom * scale;
    return {
      scale,
      originX: Math.round((props.width - contentW) / 2),
      originY: Math.round((props.height - contentH) / 2),
    };
  }, [props.items, props.width, props.height]);

  const move = (event: HitPointerEvent) => {
    const active = drag.current;
    if (!active) return;
    const x = Math.round(active.itemX + (event.x - active.pointerX) / geometry.scale);
    const y = Math.round(active.itemY + (event.y - active.pointerY) / geometry.scale);
    setPreview(items.map((item) => item.id === active.id ? { ...item, x, y } : item));
  };

  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    const next = preview ?? items;
    setPreview(null);
    props.onChange?.(next);
  };

  return (
    <Group width={props.width} height={props.height}>
      <Rect width={props.width} height={props.height} fill={pal.bg} radius={10} stroke={pal.border} strokeWidth={1} />
      {items.map((item, index) => {
        const x = geometry.originX + item.x * geometry.scale;
        const y = geometry.originY + item.y * geometry.scale;
        const width = Math.max(72, item.width * geometry.scale);
        const height = Math.max(48, item.height * geometry.scale);
        const selected = item.id === props.selectedId;
        return (
          <Group key={item.id} x={x} y={y} width={width} height={height}>
            <Rect
              width={width}
              height={height}
              fill={selected ? pal.selection : pal.surface}
              radius={8}
              stroke={selected ? pal.accent : pal.border}
              strokeWidth={selected ? 2 : 1}
              onPointerDown={(event) => {
                if (event.button && event.button !== "left") return;
                props.onSelect?.(item.id);
                drag.current = { id: item.id, pointerX: event.x, pointerY: event.y, itemX: item.x, itemY: item.y };
              }}
              onPointerMove={move}
              onPointerUp={finish}
            />
            <Text
              x={10}
              y={Math.max(8, Math.round(height / 2 - 8))}
              text={`${index + 1}  ${item.label}`}
              color={pal.text}
              fontSize={13}
              fontWeight="medium"
            />
            {item.primary ? (
              <Text x={10} y={height - 20} text="Primary" color={pal.accent} fontSize={10} fontWeight="medium" />
            ) : null}
          </Group>
        );
      })}
    </Group>
  );
}
