/** A grid of calculator keys; each key carries the model action it performs. */
import React, { type ReactNode } from "react";
import { Icon, Pressable, TextBlock, getUiScaleFactor, useWidgetTheme } from "@moire/ui";
import type { Box } from "#calculator/layout";
import type { CalculatorAction, KeyDefinition, KeyRole } from "#calculator/model";

const KEY_RADIUS = 14;
const ICON_SIZE = 18;

/** A translucent wash of a color, for tinted keys. */
const tint = (color: number, alpha: number) => (color & 0x00ffffff) | (alpha << 24);

export function KeyGrid(
  props: Box & {
    keys: readonly KeyDefinition[];
    columns: number;
    keyHeight: number;
    gap: number;
    onAction: (action: CalculatorAction) => void;
  },
): ReactNode {
  const keyWidth = Math.max(1, (props.width - props.gap * (props.columns - 1)) / props.columns);
  return (
    <>
      {props.keys.map((definition, index) => (
        <Key
          key={definition.focusId}
          x={props.x + (index % props.columns) * (keyWidth + props.gap)}
          y={props.y + Math.floor(index / props.columns) * (props.keyHeight + props.gap)}
          width={keyWidth}
          height={props.keyHeight}
          definition={definition}
          onPress={() => props.onAction(definition.action)}
        />
      ))}
    </>
  );
}

function Key(props: Box & { definition: KeyDefinition; onPress: () => void }): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const styles: Record<KeyRole, { fill: number; hover: number; color: number }> = {
    digit: { fill: pal.surface, hover: pal.hover, color: pal.text },
    function: {
      fill: tint(pal.text, 0x0c),
      hover: tint(pal.text, 0x1a),
      color: pal.text,
    },
    operator: {
      fill: tint(pal.accent, 0x24),
      hover: tint(pal.accent, 0x3a),
      color: pal.accent,
    },
    clear: {
      fill: tint(pal.danger, 0x1c),
      hover: tint(pal.danger, 0x30),
      color: pal.danger,
    },
    equals: {
      fill: pal.accent,
      hover: pal.accentLine,
      color: theme.recipes.button.primary.medium.label.base.color,
    },
  };
  const { role, label, icon, focusId } = props.definition;
  const iconSize = Math.round(ICON_SIZE * getUiScaleFactor());
  const style = styles[role];
  return (
    <Pressable
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      radius={Math.min(KEY_RADIUS * getUiScaleFactor(), props.height / 2)}
      fill={style.fill}
      hoverFill={style.hover}
      focusId={focusId}
      onPress={props.onPress}
    >
      {icon ? (
        <Icon
          x={(props.width - iconSize) / 2}
          y={(props.height - iconSize) / 2}
          name={icon}
          size={iconSize}
          color={style.color}
          symbolic
        />
      ) : (
        <TextBlock
          width={props.width}
          height={props.height}
          text={label}
          color={style.color}
          fontSize={role === "digit" ? 20 : role === "function" ? 15 : 18}
          fontWeight={role === "digit" ? "regular" : "medium"}
          horizontalAlign="center"
          verticalAlign="center"
          maxLines={1}
          overflow="ellipsis"
        />
      )}
    </Pressable>
  );
}
