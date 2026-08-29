import React, { type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { CollectionItem } from "./interaction";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";
import { ListItem } from "./list";
import { Separator, Surface, TextBlock } from "./primitives";
import { ScrollArea } from "./scroll";
import {
  Align,
  Box,
  Horizontal,
  Inset,
  Measure,
  Stack,
  Vertical,
  registerIntrinsicSize,
} from "./layout";
import { useWidgetTheme } from "#ui/widget-theme";

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

type SidebarRowProps = {
  item: NavigationSidebarItem;
  index: number;
  itemCount: number;
  width: number;
  editing: boolean;
  selected: boolean;
  onSelect?: (item: NavigationSidebarItem) => void;
  onRemove?: (item: NavigationSidebarItem) => void;
  onMove?: (item: NavigationSidebarItem, direction: -1 | 1) => void;
};

function SidebarRow(props: SidebarRowProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  return (
    <Stack width={props.width} height={ROW_H} alignX="stretch" alignY="center">
      <CollectionItem
        width={props.width}
        height={ROW_H - 2}
        focusId={`sidebar:${props.item.id}`}
        disabled={props.item.disabled}
        onPress={() => props.onSelect?.(props.item)}
      >
        <ListItem
          width={props.width}
          height={ROW_H - 2}
          size="small"
          title={props.item.label}
          subtitle={props.item.subtitle}
          selected={props.selected}
          disabled={props.item.disabled}
          interactive={false}
          leading={
            props.item.icon ? (
              <Group width={26} height={26}>
                <Rect
                  width={26}
                  height={26}
                  fill={
                    props.selected ? ((pal.accent & 0x00ffffff) | 0x22000000) >>> 0 : 0x00000000
                  }
                  radius={7}
                />
                <Icon
                  x={4}
                  y={4}
                  name={props.item.icon}
                  size={18}
                  symbolic
                  color={props.item.disabled ? pal.muted : props.selected ? pal.accent : pal.text}
                />
              </Group>
            ) : undefined
          }
        />
      </CollectionItem>
      {props.editing ? (
        <Align alignX="end" alignY="center">
          <Horizontal width={76} height={24} gap={2} align="center">
            <IconButton
              width={24}
              height={24}
              icon={<Icon name="chevron-up" size={12} symbolic />}
              variant="ghost"
              disabled={props.index === 0}
              onPress={() => props.onMove?.(props.item, -1)}
            />
            <IconButton
              width={24}
              height={24}
              icon={<Icon name="chevron-down" size={12} symbolic />}
              variant="ghost"
              disabled={props.index === props.itemCount - 1}
              onPress={() => props.onMove?.(props.item, 1)}
            />
            {props.item.removable ? (
              <IconButton
                width={24}
                height={24}
                icon={<Icon name="remove" size={12} color={pal.danger} symbolic />}
                variant="ghost"
                onPress={() => props.onRemove?.(props.item)}
              />
            ) : (
              <Box width={24} height={24} />
            )}
          </Horizontal>
        </Align>
      ) : null}
    </Stack>
  );
}

registerIntrinsicSize(SidebarRow, (props) => ({
  width: props.width,
  height: ROW_H,
}));

/** Configurable, sectioned navigation sidebar with optional edit controls. */
export function NavigationSidebar(props: NavigationSidebarProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const pad = theme.foundations.space.md;
  const headerHeight = props.header ? 36 : 0;
  const footerHeight = props.footer ? 44 : 0;
  const contentHeight = props.sections.reduce<number>(
    (height, section) =>
      height + (section.label ? HEADER_H : 0) + section.items.length * ROW_H + SECTION_GAP,
    pad,
  );

  return (
    <Surface x={props.x} y={props.y} width={props.width} height={props.height} fill={pal.panel}>
      <Vertical width={props.width} height={props.height} gap={0}>
        {props.header ? (
          <Inset height={headerHeight} padding={{ top: 4, horizontal: pad }}>
            {props.header}
          </Inset>
        ) : null}
        <Measure flexGrow={1} minHeight={1}>
          {({ width, height }) => (
            <ScrollArea
              width={width}
              height={height}
              contentHeight={Math.max(height, contentHeight)}
            >
              <Vertical
                width={width}
                height={Math.max(height, contentHeight)}
                padding={{ top: pad, right: pad / 2, bottom: SECTION_GAP, left: pad / 2 }}
                gap={SECTION_GAP}
              >
                {props.sections.map((section) => (
                  <Vertical
                    key={section.id}
                    height={(section.label ? HEADER_H : 0) + section.items.length * ROW_H}
                    gap={0}
                  >
                    {section.label ? (
                      <Inset height={HEADER_H} padding={{ horizontal: pad / 2 }}>
                        <TextBlock
                          text={section.label.toUpperCase()}
                          color={pal.accent}
                          fontSize={10}
                          fontWeight="medium"
                          verticalAlign="center"
                          overflow="ellipsis"
                          maxLines={1}
                        />
                      </Inset>
                    ) : null}
                    {section.items.map((item, index) => (
                      <SidebarRow
                        key={item.id}
                        item={item}
                        index={index}
                        itemCount={section.items.length}
                        width={width - pad}
                        editing={Boolean(props.editing)}
                        selected={props.selectedId === item.id}
                        onSelect={props.onSelect}
                        onRemove={props.onRemove}
                        onMove={props.onMove}
                      />
                    ))}
                  </Vertical>
                ))}
              </Vertical>
            </ScrollArea>
          )}
        </Measure>
        {props.footer ? (
          <Inset height={footerHeight} padding={{ horizontal: pad }}>
            <Vertical gap={7}>
              <Measure height={1}>{({ width }) => <Separator width={width} />}</Measure>
              <Box flexGrow={1}>{props.footer}</Box>
            </Vertical>
          </Inset>
        ) : null}
      </Vertical>
    </Surface>
  );
}
