/** Recipe-driven application dialog surface. */
import React, { type ReactNode } from "react";
import { useWidgetTheme, type ButtonSize } from "#ui/widget-theme";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import {
  Box,
  Horizontal,
  Inset,
  Vertical,
  measureColumnContent,
  registerIntrinsicSize,
} from "./layout";
import { Surface, TextBlock } from "./primitives";

export type DialogProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  title: string;
  size?: ButtonSize;
  children?: ReactNode;
  /** Persistent actions outside the scrolling body, composed with intrinsic layout/widgets. */
  footer?: ReactNode;
  onClose?: () => void;
};

const absorbPress = () => {};

export function Dialog(props: DialogProps): ReactNode {
  const theme = useWidgetTheme();
  const recipe = theme.recipes.dialog[props.size ?? "medium"];
  const hasFooter = props.footer !== undefined && props.footer !== null;
  const footerPadding = {
    top: theme.foundations.space.sm,
    right: recipe.metrics.bodyPaddingX,
    bottom: recipe.metrics.bodyPaddingBottom,
    left: recipe.metrics.bodyPaddingX,
  };
  // Inset is an allocation boundary rather than an intrinsic provider. Measure
  // the width-aware footer flow explicitly before reserving its fixed extent.
  const footerHeight = hasFooter
    ? measureColumnContent(
        { width: props.width, padding: footerPadding, gap: 0, children: props.footer },
        theme,
      ).height
    : 0;
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={recipe.surface.fill}
      radius={recipe.surface.radius}
      stroke={recipe.surface.stroke}
      strokeWidth={recipe.surface.strokeWidth}
      elevation="high"
      clip
      // A press on the dialog's own background (its text, a text field's margin) must not
      // fall through to the modal barrier below, which would dismiss the dialog.
      onPress={absorbPress}
    >
      <Vertical width={props.width} height={props.height} gap={0}>
        <Box width={props.width} height={recipe.metrics.titlebarHeight} flexShrink={0}>
          <Surface
            width={props.width}
            height={recipe.metrics.titlebarHeight}
            fill={recipe.titlebar.fill}
            radius={recipe.titlebar.radius}
          >
            <Inset
              width={props.width}
              height={recipe.metrics.titlebarHeight}
              padding={{ horizontal: recipe.metrics.titlePaddingX }}
            >
              <Horizontal gap={theme.foundations.space.sm} align="center">
                <TextBlock
                  flexGrow={1}
                  flexShrink={1}
                  text={props.title}
                  color={recipe.title.color}
                  fontSize={recipe.title.fontSize}
                  fontWeight={recipe.title.fontWeight}
                  verticalAlign="center"
                  overflow="ellipsis"
                  maxLines={1}
                />
                {props.onClose ? (
                  <IconButton
                    width={recipe.metrics.closeSize}
                    height={recipe.metrics.closeSize}
                    size={props.size}
                    variant="ghost"
                    icon={
                      <Icon
                        name="close"
                        size={recipe.closeIcon.size}
                        color={recipe.closeIcon.color}
                        symbolic
                      />
                    }
                    onPress={props.onClose}
                  />
                ) : (
                  <Box width={0} height={recipe.metrics.closeSize} />
                )}
              </Horizontal>
            </Inset>
          </Surface>
        </Box>
        <Inset
          flexGrow={1}
          minHeight={1}
          padding={{
            top: recipe.metrics.bodyPaddingTop,
            right: recipe.metrics.bodyPaddingX,
            bottom: hasFooter ? 0 : recipe.metrics.bodyPaddingBottom,
            left: recipe.metrics.bodyPaddingX,
          }}
        >
          {props.children}
        </Inset>
        {hasFooter ? (
          <Inset width={props.width} height={footerHeight} flexShrink={0} padding={footerPadding}>
            <Vertical gap={0}>{props.footer}</Vertical>
          </Inset>
        ) : null}
      </Vertical>
    </Surface>
  );
}

registerIntrinsicSize(Dialog, (props) => ({
  width: props.width,
  height: props.height,
}));
