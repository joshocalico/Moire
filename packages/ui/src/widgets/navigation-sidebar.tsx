import React, { type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { CollectionItem } from "./interaction.js";
import { Icon, type IconName } from "./icon.js";
import { IconButton } from "./icon-button.js";
import { ListItem } from "./list.js";
import { Label, Separator, Surface } from "./primitives.js";
import { ScrollArea } from "./scroll.js";
import { useWidgetTheme } from "../widget-theme.js";

export type NavigationSidebarItem = {
  id: string;
  label: string;
  subtitle?: string;
  icon?: IconName;
  disabled?: boolean;
  removable?: boolean;
};

export type NavigationSidebarSection = {
  id: string;
  label?: string;
  items: readonly NavigationSidebarItem[];
};

export type NavigationSidebarProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  sections: readonly NavigationSidebarSection[];
  selectedId?: string | null;
  editing?: boolean;
  onSelect?: (item: NavigationSidebarItem) => void;
  onRemove?: (item: NavigationSidebarItem) => void;
  onMove?: (item: NavigationSidebarItem, direction: -1 | 1) => void;
  header?: ReactNode;
  footer?: ReactNode;
};

const ROW_H = 40;
const HEADER_H = 26;
const SECTION_GAP = 8;

/** Configurable, sectioned navigation sidebar with optional edit controls. */
export function NavigationSidebar(props: NavigationSidebarProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const pad = theme.foundations.space.md;
  const editWidth = props.editing ? 82 : 0;
  const headerHeight = props.header ? 36 : 0;
  const footerHeight = props.footer ? 44 : 0;
  const contentHeight = props.sections.reduce<number>(
    (height, section) =>
      height +
      (section.label ? HEADER_H : 0) +
      section.items.length * ROW_H +
      SECTION_GAP,
    pad,
  );
  let cursorY = pad;

  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={pal.panel}
    >
      {props.header ? (
        <Group x={pad} y={4} width={props.width - pad * 2} height={headerHeight}>
          {props.header}
        </Group>
      ) : null}
      <ScrollArea
        x={0}
        y={headerHeight}
        width={props.width}
        height={Math.max(1, props.height - headerHeight - footerHeight)}
        contentHeight={Math.max(
          props.height - headerHeight - footerHeight,
          contentHeight,
        )}
      >
        {props.sections.map((section) => {
          const sectionStart = cursorY;
          if (section.label) cursorY += HEADER_H;
          const rows = section.items.map((item, index) => {
            const y = cursorY;
            cursorY += ROW_H;
            return (
              <Group
                key={item.id}
                x={pad / 2}
                y={y}
                width={props.width - pad}
                height={ROW_H}
              >
                <CollectionItem
                  width={props.width - pad}
                  height={ROW_H - 2}
                  focusId={`sidebar:${item.id}`}
                  disabled={item.disabled}
                  onPress={() => props.onSelect?.(item)}
                >
                  <ListItem
                    width={props.width - pad}
                    height={ROW_H - 2}
                    size="small"
                    title={item.label}
                    subtitle={item.subtitle}
                    selected={props.selectedId === item.id}
                    disabled={item.disabled}
                    interactive={false}
                    leading={
                      item.icon ? (
                        <Group width={26} height={26}>
                          <Rect
                            width={26}
                            height={26}
                            fill={props.selectedId === item.id
                              ? ((pal.accent & 0x00ffffff) | 0x22000000) >>> 0
                              : 0x00000000}
                            radius={7}
                          />
                          <Icon
                            x={4}
                            y={4}
                            name={item.icon}
                            size={18}
                            symbolic
                            color={item.disabled
                              ? pal.muted
                              : props.selectedId === item.id
                                ? pal.accent
                                : pal.text}
                          />
                        </Group>
                      ) : undefined
                    }
                  />
                </CollectionItem>
                {props.editing ? (
                  <Group
                    x={props.width - pad - editWidth}
                    y={5}
                    width={editWidth}
                    height={28}
                  >
                    <IconButton
                      x={0}
                      width={24}
                      height={24}
                      icon={<Icon name="chevron-up" size={12} symbolic />}
                      variant="ghost"
                      disabled={index === 0}
                      onPress={() => props.onMove?.(item, -1)}
                    />
                    <IconButton
                      x={26}
                      width={24}
                      height={24}
                      icon={<Icon name="chevron-down" size={12} symbolic />}
                      variant="ghost"
                      disabled={index === section.items.length - 1}
                      onPress={() => props.onMove?.(item, 1)}
                    />
                    {item.removable ? (
                      <IconButton
                        x={52}
                        width={24}
                        height={24}
                        icon={<Icon name="remove" size={12} color={pal.danger} symbolic />}
                        variant="ghost"
                        onPress={() => props.onRemove?.(item)}
                      />
                    ) : null}
                  </Group>
                ) : null}
              </Group>
            );
          });
          cursorY += SECTION_GAP;
          return (
            <Group
              key={section.id}
              x={0}
              y={sectionStart}
              width={props.width}
              height={cursorY - sectionStart}
            >
              {section.label ? (
                <Label
                  x={pad}
                  y={0}
                  text={section.label.toUpperCase()}
                  color={pal.accent}
                  fontSize={10}
                  fontWeight="medium"
                  width={props.width - pad * 2}
                  height={HEADER_H - 4}
                />
              ) : null}
              {rows.map((row) =>
                React.cloneElement(row, {
                  y: (row.props as { y: number }).y - sectionStart,
                }),
              )}
            </Group>
          );
        })}
      </ScrollArea>
      {props.footer ? (
        <Group
          x={pad}
          y={props.height - footerHeight}
          width={props.width - pad * 2}
          height={footerHeight}
        >
          <Separator width={props.width - pad * 2} />
          <Group y={8} width={props.width - pad * 2} height={footerHeight - 8}>
            {props.footer}
          </Group>
        </Group>
      ) : null}
    </Surface>
  );
}
