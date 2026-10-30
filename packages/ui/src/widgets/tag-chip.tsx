/**
 * Tag chips: a tag with a colour dot and remove ×, an "Add tag" chip that turns into a field
 * while editing, and an outlined "+ label" suggestion chip that adds itself when pressed.
 */
import React, { type ReactNode } from "react";
import { Group, measureTextBounds, type HitKeyEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";
import { registerIntrinsicSize } from "./layout";
import { Pressable } from "./pressable";
import { Surface, TextBlock } from "./primitives";
import { TextField } from "./text-field";

export type TagChipVariant = "tag" | "add" | "suggestion";

export type TagChipProps = {
  x?: number;
  y?: number;
  label: string;
  /** The tag's colour, for its dot and tint; the theme accent when unset. */
  colour?: number;
  variant?: TagChipVariant;
  disabled?: boolean;
  focusId?: string;
  /** Caps the chip's width; the label ellipsizes to fit. */
  maxWidth?: number;
  onPress?(): void;
  /** Tag variant: shows the × button. */
  onRemove?(): void;
  /** Add variant: show a field in place of the chip. */
  editing?: boolean;
  draft?: string;
  onDraft?(value: string): void;
  onSubmit?(): void;
  onCancel?(): void;
  onFocusChange?(focused: boolean): void;
  placeholder?: string;
};

const CHIP_H = 26;
const TEXT_SIZE = 12;
const PAD_X = 10;
const DOT = 8;
const DOT_GAP = 6;
const REMOVE = 20;
const REMOVE_ICON = 14;
const REMOVE_PAD = 4;
const PLUS = 16;
const PLUS_X = 8;
const PLUS_GAP = 2;
const FIELD_W = 140;
const ROW_GAP = 6;
const CHIP_GAP = 6;
const TAG_TINT = 0.18;
const TAG_TINT_HOVER = 0.28;
const ADD_LABEL = "Add tag";

function chipText(label: string, variant: TagChipVariant): string {
  if (variant === "add") return label || ADD_LABEL;
  if (variant === "suggestion") return `+ ${label}`;
  return label;
}

/** Where the label starts and how much fixed room the chip adds around it, unscaled. */
function chipFrame(variant: TagChipVariant, removable: boolean): { lead: number; trail: number } {
  if (variant === "add") return { lead: PLUS_X + PLUS + PLUS_GAP, trail: PAD_X };
  if (variant === "suggestion") return { lead: PAD_X, trail: PAD_X };
  return {
    lead: PAD_X + DOT + DOT_GAP,
    trail: removable ? DOT_GAP + REMOVE + REMOVE_PAD : PAD_X,
  };
}

function labelWidth(text: string): number {
  return Math.ceil(measureTextBounds(text, { fontSize: TEXT_SIZE }).width);
}

/**
 * A chip's natural width, scaled. Pass the same `editing` the chip gets for an add chip showing
 * its field, and `removable: false` for a tag drawn without its × (no `onRemove`, or disabled).
 */
export function tagChipWidth(
  label: string,
  variant: TagChipVariant = "tag",
  editing = false,
  removable = true,
): number {
  const ui = getUiScaleFactor();
  if (variant === "add" && editing) return Math.round(FIELD_W * ui);
  const frame = chipFrame(variant, removable);
  return Math.ceil(labelWidth(chipText(label, variant)) + (frame.lead + frame.trail) * ui);
}

export function tagChipHeight(): number {
  return Math.round(CHIP_H * getUiScaleFactor());
}

function isActivate(event: HitKeyEvent): boolean {
  return (
    !event.repeat &&
    (event.code === 28 || event.code === 57 || event.key === "Enter" || event.key === " ")
  );
}

function isDelete(event: HitKeyEvent): boolean {
  return (
    !event.repeat &&
    (event.code === 14 || event.code === 111 || event.key === "Backspace" || event.key === "Delete")
  );
}

/** An icon of `size` centred in IconButton's slot, which is laid out for the theme's icon size. */
function slotIcon(name: IconName, size: number) {
  return (style: { size: number; color: number }) => (
    <Icon
      x={Math.round((style.size - size) / 2)}
      y={Math.round((style.size - size) / 2)}
      name={name}
      size={size}
      color={style.color}
      symbolic
    />
  );
}

export function TagChip(props: TagChipProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const variant = props.variant ?? "tag";
  const height = tagChipHeight();
  const x = props.x ?? 0;
  const y = props.y ?? 0;

  if (variant === "add" && props.editing) {
    const width = Math.min(tagChipWidth(props.label, "add", true), props.maxWidth ?? Infinity);
    return (
      <Group x={x} y={y} width={width} height={height}>
        <TextField
          width={width}
          height={height}
          size="small"
          value={props.draft ?? ""}
          placeholder={props.placeholder ?? "Tag name"}
          autoFocus
          focusId={props.focusId ? `${props.focusId}:field` : undefined}
          disabled={props.disabled}
          onChange={(value) => props.onDraft?.(value)}
          onSubmit={() => props.onSubmit?.()}
          onCancel={() => props.onCancel?.()}
          onFocusChange={props.onFocusChange}
        />
      </Group>
    );
  }

  const removable = variant === "tag" && !!props.onRemove && !props.disabled;
  const frame = chipFrame(variant, removable);
  const text = chipText(props.label, variant);
  const width = Math.min(
    tagChipWidth(props.label, variant, false, removable),
    props.maxWidth ?? Infinity,
  );
  const textX = Math.round(frame.lead * ui);
  const textWidth = Math.max(1, width - textX - Math.round(frame.trail * ui) + 1);
  const tint = props.colour ?? pal.accent;
  const outlined = variant !== "tag";
  const fill = outlined ? 0x00000000 : mixColor(pal.surface, tint, TAG_TINT);
  const hoverFill = outlined ? pal.hover : mixColor(pal.surface, tint, TAG_TINT_HOVER);
  const ink = props.disabled || outlined ? pal.muted : pal.text;
  const removeSize = Math.round(REMOVE * ui);
  const handleKey = (event: HitKeyEvent) => {
    if (props.disabled) return;
    if (isActivate(event)) props.onPress?.();
    else if (removable && isDelete(event)) props.onRemove?.();
  };
  return (
    <Group x={x} y={y} width={width} height={height}>
      <Pressable
        width={width}
        height={height}
        fill={fill}
        hoverFill={props.onPress && !props.disabled ? hoverFill : fill}
        pressedFill={props.onPress && !props.disabled ? pal.pressed : fill}
        disabledFill={fill}
        radius={height / 2}
        stroke={outlined ? pal.border : undefined}
        strokeWidth={outlined ? 1 : undefined}
        disabled={props.disabled}
        focusable={!!props.onPress || removable}
        focusId={props.focusId}
        onFocusChange={props.onFocusChange}
        onKeyDown={handleKey}
        onPress={props.onPress ? () => props.onPress?.() : undefined}
      />
      {variant === "tag" ? (
        <Surface
          x={Math.round(PAD_X * ui)}
          y={Math.round((height - DOT * ui) / 2)}
          width={Math.round(DOT * ui)}
          height={Math.round(DOT * ui)}
          radius={(DOT * ui) / 2}
          fill={tint}
        />
      ) : null}
      {variant === "add" ? (
        <Icon
          x={Math.round(PLUS_X * ui)}
          y={Math.round((height - PLUS * ui) / 2)}
          name="plus"
          size={Math.round(PLUS * ui)}
          color={pal.muted}
          symbolic
        />
      ) : null}
      <TextBlock
        x={textX}
        width={textWidth}
        height={height}
        text={text}
        color={ink}
        fontSize={TEXT_SIZE}
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {removable ? (
        <IconButton
          x={width - removeSize - Math.round(REMOVE_PAD * ui)}
          y={Math.round((height - removeSize) / 2)}
          width={removeSize}
          height={removeSize}
          variant="ghost"
          size="small"
          color={pal.muted}
          tooltip="Remove tag"
          focusId={props.focusId ? `${props.focusId}:remove` : undefined}
          icon={slotIcon("close", Math.round(REMOVE_ICON * ui))}
          onPress={() => props.onRemove?.()}
        />
      ) : null}
    </Group>
  );
}

registerIntrinsicSize(TagChip, (props) => ({
  width: Math.min(
    tagChipWidth(props.label, props.variant, props.editing, !!props.onRemove && !props.disabled),
    props.maxWidth ?? Infinity,
  ),
  height: tagChipHeight(),
}));

export type TagChipLayoutItem = {
  label: string;
  variant?: TagChipVariant;
  editing?: boolean;
  /** A tag without its ×; see `tagChipWidth`. */
  removable?: boolean;
};

/**
 * Wraps chips into rows `width` wide: chips keep their order, a row breaks before a chip that
 * doesn't fit, and a chip wider than the whole row is capped to it (pass that width on as the
 * chip's `maxWidth`). Rows are a chip's height plus 6px apart, scaled.
 */
export function layoutTagChips(
  items: readonly TagChipLayoutItem[],
  width: number,
  gap: number = CHIP_GAP * getUiScaleFactor(),
): { positions: Array<{ x: number; y: number; width: number }>; height: number } {
  const ui = getUiScaleFactor();
  const height = tagChipHeight();
  const pitch = height + Math.round(ROW_GAP * ui);
  const positions: Array<{ x: number; y: number; width: number }> = [];
  let x = 0;
  let y = 0;
  for (const item of items) {
    const chip = Math.min(
      width,
      tagChipWidth(item.label, item.variant, item.editing, item.removable ?? true),
    );
    if (x > 0 && x + chip > width) {
      x = 0;
      y += pitch;
    }
    positions.push({ x, y, width: chip });
    x += chip + gap;
  }
  return { positions, height: items.length ? y + height : 0 };
}
