import { createElement, type ReactNode } from "react";
import { Group, Rect, Text, FONT_H } from "@moire/react-host";
import { themePalette } from "../theme.js";
import { Button } from "./button.js";
import { Icon, type IconName } from "./icon.js";
import { Pressable } from "./pressable.js";

function LayerSurface(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: number;
  children?: ReactNode;
}): ReactNode {
  return createElement(
    Group,
    props,
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill: props.fill,
    }),
    props.children,
  );
}

export type ContextMenuAction = {
  id: string;
  label: string;
  description?: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onPress: () => void;
};

export type ContextMenuProps = {
  viewportWidth: number;
  viewportHeight: number;
  x: number;
  y: number;
  title?: string;
  actions: ContextMenuAction[];
  onDismiss: () => void;
  width?: number;
};

export function ContextMenu(props: ContextMenuProps): ReactNode {
  const pal = themePalette();
  const width = props.width ?? 244;
  const rowH = 38;
  const titleH = props.title ? 34 : 8;
  const separators = props.actions.filter((action) => action.separatorBefore).length;
  const height = titleH + props.actions.length * rowH + separators * 9 + 8;
  const x = Math.max(8, Math.min(props.x, props.viewportWidth - width - 8));
  const y = Math.max(8, Math.min(props.y, props.viewportHeight - height - 8));
  let rowY = titleH;

  const rows: ReactNode[] = [];
  for (const action of props.actions) {
    if (action.separatorBefore) {
      rows.push(
        createElement(Rect, {
          key: `${action.id}:separator`,
          x: 10,
          y: rowY + 4,
          width: width - 20,
          height: 1,
          fill: pal.borderSubtle,
        }),
      );
      rowY += 9;
    }
    const yForRow = rowY;
    rows.push(
      createElement(
        Pressable,
        {
          key: action.id,
          x: 6,
          y: yForRow,
          width: width - 12,
          height: rowH,
          disabled: action.disabled,
          onPress: () => {
            if (action.disabled) return;
            props.onDismiss();
            action.onPress();
          },
        },
        action.icon
          ? createElement(Icon, {
              x: 10,
              y: 9,
              name: action.icon,
              size: 20,
              color: action.danger ? pal.danger : pal.text,
            })
          : null,
        createElement(Text, {
          x: action.icon ? 40 : 12,
          y: Math.floor((rowH - FONT_H) / 2),
          text: action.label,
          color: action.disabled
            ? pal.muted
            : action.danger
              ? pal.danger
              : pal.text,
          fontSize: 13,
          fontWeight: "medium",
        }),
      ),
    );
    rowY += rowH;
  }

  return createElement(
    Group,
    { x: 0, y: 0, width: props.viewportWidth, height: props.viewportHeight },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.viewportWidth,
      height: props.viewportHeight,
      fill: 0x01000000,
      onPress: props.onDismiss,
      onContextMenu: props.onDismiss,
    }),
    createElement(
      LayerSurface,
      { x: x + 3, y: y + 4, width, height, fill: pal.rimShade },
    ),
    createElement(
      LayerSurface,
      { x, y, width, height, fill: pal.panel },
      createElement(Rect, {
        x: 0,
        y: 0,
        width,
        height: 1,
        fill: pal.rimLight,
      }),
      props.title
        ? createElement(Text, {
            x: 16,
            y: 10,
            text: props.title,
            color: pal.muted,
            fontSize: 11,
            fontWeight: "medium",
          })
        : null,
      ...rows,
    ),
  );
}

export type OpenWithChoice = {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
};

export type OpenWithPickerProps = {
  viewportWidth: number;
  viewportHeight: number;
  fileName: string;
  mimeType: string;
  choices: OpenWithChoice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMakeDefault: (id: string) => void;
  onDismiss: () => void;
};

export function OpenWithPicker(props: OpenWithPickerProps): ReactNode {
  const pal = themePalette();
  const width = Math.min(560, Math.max(420, props.viewportWidth - 64));
  const rowH = 56;
  const maxRows = Math.max(2, Math.floor((props.viewportHeight - 230) / rowH));
  const visible = props.choices.slice(0, Math.min(7, maxRows));
  const listH = Math.max(82, visible.length * rowH);
  const height = 118 + listH + 68;
  const x = Math.floor((props.viewportWidth - width) / 2);
  const y = Math.max(20, Math.floor((props.viewportHeight - height) / 2));
  const selected = props.selectedId;
  const canOpen = !!selected;

  return createElement(
    Group,
    { x: 0, y: 0, width: props.viewportWidth, height: props.viewportHeight },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.viewportWidth,
      height: props.viewportHeight,
      fill: pal.overlay,
      onPress: props.onDismiss,
      onContextMenu: props.onDismiss,
    }),
    createElement(LayerSurface, {
      x: x + 5,
      y: y + 6,
      width,
      height,
      fill: pal.rimShade,
    }),
    createElement(
      LayerSurface,
      { x, y, width, height, fill: pal.panel },
      createElement(Rect, {
        x: 0,
        y: 0,
        width,
        height: 3,
        fill: pal.accentLine,
      }),
      createElement(Icon, {
        x: 24,
        y: 24,
        name: "app",
        size: 48,
        color: pal.accent,
      }),
      createElement(Text, {
        x: 88,
        y: 25,
        text: `Open ${truncate(props.fileName, 34)} with…`,
        color: pal.text,
        fontSize: 18,
        fontWeight: "medium",
      }),
      createElement(Text, {
        x: 88,
        y: 54,
        text: props.mimeType,
        color: pal.muted,
        fontSize: 12,
      }),
      createElement(Text, {
        x: 24,
        y: 91,
        text: "COMPATIBLE APPLICATIONS",
        color: pal.accent,
        fontSize: 10,
        fontWeight: "medium",
      }),
      createElement(
        LayerSurface,
        {
          x: 20,
          y: 112,
          width: width - 40,
          height: listH,
          fill: pal.bg,
        },
        visible.length === 0
          ? createElement(Text, {
              x: 20,
              y: 28,
              text: "No application advertises support for this file type yet.",
              color: pal.muted,
              fontSize: 13,
            })
          : visible.map((choice, index) =>
              createElement(
                Pressable,
                {
                  key: choice.id,
                  x: 0,
                  y: index * rowH,
                  width: width - 40,
                  height: rowH,
                  fill: selected === choice.id ? pal.selection : 0x00000000,
                  onPress: () => props.onSelect(choice.id),
                  onDoublePress: () => props.onOpen(choice.id),
                },
                selected === choice.id
                  ? createElement(Rect, {
                      x: 0,
                      y: 0,
                      width: 3,
                      height: rowH,
                      fill: pal.accentLine,
                    })
                  : null,
                createElement(Icon, {
                  x: 14,
                  y: 14,
                  name: "app",
                  size: 28,
                  color: selected === choice.id ? pal.accent : pal.text,
                }),
                createElement(Text, {
                  x: 56,
                  y: choice.description ? 10 : 20,
                  text: choice.name,
                  color: pal.text,
                  fontSize: 14,
                  fontWeight: "medium",
                }),
                choice.description
                  ? createElement(Text, {
                      x: 56,
                      y: 31,
                      text: truncate(choice.description, 52),
                      color: pal.muted,
                      fontSize: 11,
                    })
                  : null,
                choice.isDefault
                  ? createElement(Text, {
                      x: width - 108,
                      y: 20,
                      text: "DEFAULT",
                      color: pal.accent,
                      fontSize: 10,
                      fontWeight: "medium",
                    })
                  : null,
              ),
            ),
      ),
      createElement(Rect, {
        x: 0,
        y: 112 + listH + 15,
        width,
        height: 1,
        fill: pal.borderSubtle,
      }),
      createElement(Button, {
        x: 20,
        y: 112 + listH + 28,
        width: 86,
        height: 34,
        label: "Cancel",
        variant: "ghost",
        onPress: props.onDismiss,
      }),
      createElement(Button, {
        x: width - 244,
        y: 112 + listH + 28,
        width: 126,
        height: 34,
        label: "Always Use",
        variant: "secondary",
        disabled: !canOpen,
        onPress: selected ? () => props.onMakeDefault(selected) : undefined,
      }),
      createElement(Button, {
        x: width - 108,
        y: 112 + listH + 28,
        width: 88,
        height: 34,
        label: "Open",
        variant: "primary",
        disabled: !canOpen,
        onPress: selected ? () => props.onOpen(selected) : undefined,
      }),
    ),
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
