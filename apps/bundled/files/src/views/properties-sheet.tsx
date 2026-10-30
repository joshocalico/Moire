/**
 * Properties as a pane docked at the page's right edge: the page reflows into the room left of
 * it, so no row, date or hover action is hidden. When that room would be too narrow to read
 * (a 640px window), the pane covers the page instead, over a scrim that closes it.
 * It stays while the selection changes; Escape (outside a text field) or the button closes it.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  FocusScope,
  Icon,
  IconButton,
  ModalBarrier,
  Separator,
  Surface,
  TextBlock,
  getUiScaleFactor,
  useAnimatedValue,
  usePalette,
  useWidgetTheme,
} from "@moire/ui";

const WIDTH = 380;
/** The pane never takes more than this share of the page. */
const MAX_SHARE = 0.6;
/** Narrower than this, the page beside the pane could not show its rows: the pane covers it. */
const DOCK_MIN_PAGE = 420;
const HEADER = 52;
/** The pane slides in from this far right as it opens. */
const SLIDE = 48;
export const PROPERTIES_CLOSE_ID = "properties:close";

/** The pane's width in a page this wide. */
export function propertiesWidth(pageWidth: number): number {
  return Math.min(Math.round(WIDTH * getUiScaleFactor()), Math.round(pageWidth * MAX_SHARE));
}

export type PropertiesDock = {
  /** The pane's width, 0 when closed. */
  sheet: number;
  /** The width the page content lays out in. */
  content: number;
  /** Docked beside the page; otherwise it covers the page over a scrim. */
  docked: boolean;
};

/** How the page and the pane share `pageWidth`. */
export function propertiesDock(pageWidth: number, open: boolean): PropertiesDock {
  if (!open) return { sheet: 0, content: pageWidth, docked: false };
  const sheet = propertiesWidth(pageWidth);
  const docked = pageWidth - sheet >= Math.round(DOCK_MIN_PAGE * getUiScaleFactor());
  return { sheet, content: docked ? pageWidth - sheet : pageWidth, docked };
}

export function PropertiesSheet(props: {
  /** The page's full width; the pane sits at its right edge. */
  pageWidth: number;
  dock: PropertiesDock;
  height: number;
  onClose(): void;
  /** The inspector, given the room under the pane's title. */
  children: (size: { width: number; height: number }) => ReactNode;
}): ReactNode {
  const pal = usePalette();
  const motion = useWidgetTheme().foundations.motion;
  const ui = getUiScaleFactor();
  const { sheet: width, docked } = props.dock;
  const header = Math.round(HEADER * ui);
  const button = Math.round(32 * ui);
  // The slide is presentation only: it never re-renders the page or the inspector.
  const slide = useAnimatedValue(0, {
    initialValue: motion.normalMs ? Math.round(SLIDE * ui) : 0,
    duration: motion.normalMs,
    easing: "ease-out",
  });
  const pane = (
    <Surface
      x={props.pageWidth - width}
      width={width}
      height={props.height}
      fill={pal.panel}
      elevation={docked ? undefined : "medium"}
      translateX={slide}
    >
      <Separator width={1} height={props.height} />
      <TextBlock
        x={Math.round(16 * ui)}
        width={width - Math.round(64 * ui)}
        height={header}
        text="Properties"
        fontSize={16}
        fontWeight="medium"
        verticalAlign="center"
        maxLines={1}
      />
      <IconButton
        x={width - button - Math.round(10 * ui)}
        y={Math.round((header - button) / 2)}
        width={button}
        height={button}
        variant="ghost"
        focusId={PROPERTIES_CLOSE_ID}
        tooltip="Close · Escape"
        icon={(style) => (
          <Icon name="close" size={Math.round(16 * ui)} color={style.color} symbolic />
        )}
        onPress={props.onClose}
      />
      <Box x={1} y={header} width={width - 1} height={Math.max(1, props.height - header)}>
        {props.children({ width: width - 1, height: Math.max(1, props.height - header) })}
      </Box>
    </Surface>
  );
  if (docked) return pane;
  return (
    <>
      <ModalBarrier
        width={props.pageWidth}
        height={props.height}
        visible
        onDismiss={props.onClose}
      />
      <FocusScope width={props.pageWidth} height={props.height} onEscape={props.onClose}>
        {pane}
      </FocusScope>
    </>
  );
}
