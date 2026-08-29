import React, { type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { Button } from "./button";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import { TextBlock } from "./primitives";
import { Horizontal } from "./layout";
import { useWidgetTheme, type ButtonSize } from "#ui/widget-theme";

export type PaginationProps = {
  x?: number;
  y?: number;
  /** Optional published layout width; controls remain intrinsically sized. */
  width?: number;
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  siblingCount?: number;
  showFirstLast?: boolean;
  size?: ButtonSize;
  disabled?: boolean;
};

type PageToken = number | "start-ellipsis" | "end-ellipsis";

function pageTokens(page: number, count: number, siblings: number): PageToken[] {
  if (count <= 1) return count === 1 ? [1] : [];
  const visible = siblings * 2 + 5;
  if (count <= visible) return Array.from({ length: count }, (_, index) => index + 1);
  const left = Math.max(2, page - siblings);
  const right = Math.min(count - 1, page + siblings);
  const tokens: PageToken[] = [1];
  if (left > 2) tokens.push("start-ellipsis");
  for (let value = left; value <= right; value++) tokens.push(value);
  if (right < count - 1) tokens.push("end-ellipsis");
  tokens.push(count);
  return tokens;
}

/** Compact, controlled pagination with condensed large ranges. */
export function Pagination(props: PaginationProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const count = Math.max(0, Math.floor(props.pageCount));
  const page = count === 0 ? 0 : Math.max(1, Math.min(count, Math.floor(props.page)));
  const siblings = Math.max(0, Math.min(3, Math.floor(props.siblingCount ?? 1)));
  const size = props.size ?? "medium";
  const metrics =
    size === "small"
      ? { height: 28, button: 28, gap: 4, fontSize: 11 }
      : size === "large"
        ? { height: 40, button: 40, gap: 7, fontSize: 14 }
        : { height: 34, button: 34, gap: 5, fontSize: 12 };
  const tokens = pageTokens(page, count, siblings);
  const edgeButtons = props.showFirstLast ? 4 : 2;
  const intrinsicWidth =
    (tokens.length + edgeButtons) * metrics.button +
    Math.max(0, tokens.length + edgeButtons - 1) * metrics.gap;
  const width = Math.max(props.width ?? 0, intrinsicWidth);
  const commit = (next: number) => {
    if (props.disabled || count === 0) return;
    props.onPageChange?.(Math.max(1, Math.min(count, next)));
  };
  const iconButton = (
    key: string,
    icon: "chevron-left" | "chevron-right",
    target: number,
    disabled: boolean,
    edge = false,
  ) => {
    const left = icon === "chevron-left";
    const node = (
      <IconButton
        key={key}
        width={metrics.button}
        height={metrics.height}
        size={size}
        variant="ghost"
        icon={
          edge ? (
            <Group width={14} height={14}>
              <Rect x={left ? 0 : 12} y={2} width={2} height={10} fill={pal.text} radius={1} />
              <Icon x={left ? 3 : 0} y={1} name={icon} size={12} symbolic />
            </Group>
          ) : (
            <Icon name={icon} size={14} symbolic />
          )
        }
        disabled={props.disabled || disabled}
        onPress={() => commit(target)}
      />
    );
    return node;
  };

  const children: ReactNode[] = [];
  if (props.showFirstLast) children.push(iconButton("first", "chevron-left", 1, page <= 1, true));
  children.push(iconButton("previous", "chevron-left", page - 1, page <= 1));
  for (const token of tokens) {
    if (typeof token === "number") {
      children.push(
        <Button
          key={token}
          width={metrics.button}
          height={metrics.height}
          size={size}
          label={String(token)}
          variant={token === page ? "primary" : "ghost"}
          disabled={props.disabled}
          onPress={() => commit(token)}
        />,
      );
    } else {
      children.push(
        <TextBlock
          key={token}
          width={metrics.button}
          height={metrics.height}
          text="…"
          color={pal.muted}
          fontSize={metrics.fontSize}
          horizontalAlign="center"
          verticalAlign="center"
        />,
      );
    }
  }
  children.push(iconButton("next", "chevron-right", page + 1, page >= count));
  if (props.showFirstLast)
    children.push(iconButton("last", "chevron-right", count, page >= count, true));

  return (
    <Horizontal
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width}
      height={metrics.height}
      gap={metrics.gap}
      align="center"
    >
      {children}
    </Horizontal>
  );
}
