import { default as React, useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Rect, Text, measureTextBounds } from "@moire/react-host";
import { themePalette } from "#ui/theme";
import { getWidgetTheme, useWidgetTheme } from "#ui/widget-theme";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";
import { Pressable } from "./pressable";
import { MenuItem } from "./menu";
import { ScrollArea } from "./scroll";
import { SearchField } from "./search-field";
import { easeTo, useMotionValue } from "#ui/motion";

function LayerSurface(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: number;
  radius?: number;
  clip?: boolean;
  children?: ReactNode;
}): ReactNode {
  return (
    <Group {...props}>
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={props.height}
        fill={props.fill}
        radius={props.radius}
      />
      {props.children}
    </Group>
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
  /** Render as the contents of a native popup surface at local origin. */
  surface?: boolean;
};

export function contextMenuSurfaceSize(
  actions: readonly ContextMenuAction[],
  title?: string,
  width = 244,
): { width: number; height: number } {
  const recipe = getWidgetTheme().recipes.menu.medium;
  const separators = actions.filter((action) => action.separatorBefore).length;
  const menuHeight =
    (title ? recipe.metrics.headerHeight : recipe.metrics.surfacePadding) +
    actions.length * recipe.metrics.rowHeight +
    separators * recipe.metrics.separatorGap +
    recipe.metrics.surfacePadding;
  // Shadow extends 6px right/8px down; entrance settles upward by 5px.
  return { width: width + 6, height: menuHeight + 13 };
}

export function ContextMenu(props: ContextMenuProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const recipe = theme.recipes.menu.medium;
  const reveal = useMotionValue(0);
  const [closing, setClosing] = useState(false);
  const afterClose = useRef<(() => void) | null>(null);
  const finalized = useRef(false);
  const width = props.width ?? 244;
  const rowH = recipe.metrics.rowHeight;
  const titleH = props.title ? recipe.metrics.headerHeight : recipe.metrics.surfacePadding;
  const separators = props.actions.filter((action) => action.separatorBefore).length;
  const height =
    titleH +
    props.actions.length * rowH +
    separators * recipe.metrics.separatorGap +
    recipe.metrics.surfacePadding;
  const x = props.surface ? 0 : Math.max(8, Math.min(props.x, props.viewportWidth - width - 8));
  const y = props.surface ? 0 : Math.max(8, Math.min(props.y, props.viewportHeight - height - 8));
  const progress = Math.max(0, Math.min(1, reveal.get() / 100));
  const animatedY = y + Math.round((1 - progress) * 5);
  let rowY = titleH;

  useEffect(() => {
    easeTo(reveal, 100, 24);
  }, [reveal]);

  useEffect(() => {
    if (!closing || progress > 0.01 || finalized.current) return;
    finalized.current = true;
    const callback = afterClose.current;
    props.onDismiss();
    callback?.();
  }, [closing, progress, props]);

  const dismiss = (callback?: () => void) => {
    if (closing) return;
    afterClose.current = callback ?? null;
    setClosing(true);
    easeTo(reveal, 0, 28);
  };

  const rows: ReactNode[] = [];
  for (const action of props.actions) {
    if (action.separatorBefore) {
      rows.push(
        <Rect
          key={`${action.id}:separator`}
          x={recipe.metrics.paddingX}
          y={rowY + Math.floor(recipe.metrics.separatorGap / 2)}
          width={width - recipe.metrics.paddingX * 2}
          height={recipe.separator.height}
          fill={recipe.separator.fill}
        />,
      );
      rowY += recipe.metrics.separatorGap;
    }
    const yForRow = rowY;
    rows.push(
      <MenuItem
        key={action.id}
        x={recipe.metrics.itemInset}
        y={yForRow}
        width={width - recipe.metrics.itemInset * 2}
        height={rowH}
        label={action.label}
        description={action.description}
        leading={
          action.icon
            ? (style) => <Icon name={action.icon!} size={style.size} color={style.color} />
            : undefined
        }
        indicator
        danger={action.danger}
        disabled={action.disabled}
        onPress={() => {
          if (!action.disabled) dismiss(action.onPress);
        }}
      />,
    );
    rowY += rowH;
  }

  return (
    <Group x={0} y={0} width={props.viewportWidth} height={props.viewportHeight}>
      <Rect
        x={0}
        y={0}
        width={props.viewportWidth}
        height={props.viewportHeight}
        fill={0x01000000}
        onPress={() => dismiss()}
        onContextMenu={() => dismiss()}
      />
      <Group x={x} y={animatedY} width={width + 6} height={height + 8} clip opacity={progress}>
        <LayerSurface
          x={3}
          y={4}
          width={width}
          height={height}
          fill={recipe.shadow.fill}
          radius={recipe.shadow.radius}
        />
        <LayerSurface
          x={0}
          y={0}
          width={width}
          height={height}
          fill={recipe.surface.fill}
          radius={recipe.surface.radius}
        >
          <Rect x={0} y={0} width={width} height={1} fill={pal.rimLight} />
          {props.title ? (
            <Text
              x={16}
              y={10}
              text={props.title}
              color={recipe.header.color}
              fontSize={recipe.header.fontSize}
              fontWeight={recipe.header.fontWeight}
            />
          ) : null}
          {rows}
        </LayerSurface>
      </Group>
    </Group>
  );
}

export type OpenWithChoice = {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  recommended?: boolean;
  iconPath?: string;
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
  /** Portal choosers select an app but do not change MIME defaults directly. */
  allowMakeDefault?: boolean;
  /** Fill a dedicated client window instead of drawing a modal overlay card. */
  standalone?: boolean;
  /** Start an interactive move from the standalone title area. */
  onDrag?: () => void;
  onDismiss: () => void;
};

export function OpenWithPicker(props: OpenWithPickerProps): ReactNode {
  const pal = themePalette();
  const [query, setQuery] = useState("");
  const [scrollY, setScrollY] = useState(0);
  const width = props.standalone
    ? props.viewportWidth
    : Math.min(620, Math.max(460, props.viewportWidth - 48));
  const height = props.standalone
    ? props.viewportHeight
    : Math.min(600, Math.max(380, props.viewportHeight - 40));
  const x = props.standalone ? 0 : Math.floor((props.viewportWidth - width) / 2);
  const y = props.standalone ? 0 : Math.max(20, Math.floor((props.viewportHeight - height) / 2));
  const rowH = 56;
  const headingH = 28;
  const listTop = 136;
  const footerH = 72;
  const listH = Math.max(120, height - listTop - footerH);
  const footerY = listTop + listH;
  const normalizedQuery = query.trim().toLowerCase();
  const seenChoiceIds = new Set<string>();
  const uniqueChoices = props.choices.filter((choice) => {
    if (seenChoiceIds.has(choice.id)) return false;
    seenChoiceIds.add(choice.id);
    return true;
  });
  const filtered = uniqueChoices.filter((choice) => {
    if (!normalizedQuery) return true;
    return (
      choice.name.toLowerCase().includes(normalizedQuery) ||
      choice.description?.toLowerCase().includes(normalizedQuery)
    );
  });
  const recommended = filtered.filter((choice) => choice.recommended !== false);
  const other = filtered.filter((choice) => choice.recommended === false);
  const selectable = [...recommended, ...other];
  const selected = selectable.some((choice) => choice.id === props.selectedId)
    ? props.selectedId
    : (selectable[0]?.id ?? null);
  const selectedChoice = selectable.find((choice) => choice.id === selected);
  const canOpen = !!selectedChoice;

  let contentH = 0;
  const choiceY = new Map<string, number>();
  if (recommended.length > 0) {
    contentH += headingH;
    for (const choice of recommended) {
      choiceY.set(choice.id, contentH);
      contentH += rowH;
    }
  }
  if (other.length > 0) {
    contentH += headingH;
    for (const choice of other) {
      choiceY.set(choice.id, contentH);
      contentH += rowH;
    }
  }
  contentH = Math.max(listH, contentH);

  useEffect(() => {
    if (selected && selected !== props.selectedId) props.onSelect(selected);
  }, [props.onSelect, props.selectedId, selected]);

  useEffect(() => {
    setScrollY(0);
  }, [query]);

  const selectAt = (index: number) => {
    if (selectable.length === 0) return;
    const next = selectable[Math.max(0, Math.min(selectable.length - 1, index))];
    if (!next) return;
    props.onSelect(next.id);
    const top = choiceY.get(next.id) ?? 0;
    if (top < scrollY) setScrollY(top);
    else if (top + rowH > scrollY + listH) {
      setScrollY(top + rowH - listH);
    }
  };

  const moveSelection = (offset: -1 | 1) => {
    const current = selectable.findIndex((choice) => choice.id === selected);
    selectAt(current < 0 ? 0 : current + offset);
  };

  const titleLineH = measureTextBounds("Mg", {
    fontSize: 14,
    fontWeight: "medium",
  }).height;
  const descriptionLineH = measureTextBounds("Mg", { fontSize: 11 }).height;

  const renderChoice = (choice: OpenWithChoice, rowY: number) => {
    const hasDescription = !!choice.description;
    const textBlockH = hasDescription ? titleLineH + 2 + descriptionLineH : titleLineH;
    const titleY = Math.floor((rowH - textBlockH) / 2);
    return (
      <Pressable
        key={choice.id}
        x={0}
        y={rowY}
        width={width - 40}
        height={rowH}
        fill={selected === choice.id ? pal.selection : 0x00000000}
        indicatorColor={pal.accentLine}
        onPress={() => props.onSelect(choice.id)}
        onDoublePress={() => props.onOpen(choice.id)}
      >
        {selected === choice.id ? (
          <Rect x={0} y={0} width={3} height={rowH} fill={pal.accentLine} />
        ) : null}
        <Icon
          x={14}
          y={14}
          name="app"
          path={choice.iconPath}
          size={28}
          color={selected === choice.id ? pal.accent : pal.text}
        />
        <Text
          x={56}
          y={titleY}
          text={truncate(choice.name, 42)}
          color={pal.text}
          fontSize={14}
          fontWeight="medium"
        />
        {choice.description ? (
          <Text
            x={56}
            y={titleY + titleLineH + 2}
            text={truncate(choice.description, 58)}
            color={pal.muted}
            fontSize={11}
          />
        ) : null}
        {choice.isDefault ? (
          <LayerSurface
            x={width - 116}
            y={18}
            width={62}
            height={20}
            fill={pal.surface}
            radius={pal.radiusSm}
          >
            <Text x={10} y={5} text="DEFAULT" color={pal.accent} fontSize={9} fontWeight="medium" />
          </LayerSurface>
        ) : null}
      </Pressable>
    );
  };

  const listRows: ReactNode[] = [];
  let rowY = 0;
  const appendSection = (title: string, choices: OpenWithChoice[]) => {
    if (choices.length === 0) return;
    listRows.push(
      <Text
        key={`${title}:heading`}
        x={14}
        y={rowY + 9}
        text={title}
        color={pal.accent}
        fontSize={10}
        fontWeight="medium"
      />,
    );
    rowY += headingH;
    for (const choice of choices) {
      listRows.push(renderChoice(choice, rowY));
      rowY += rowH;
    }
  };
  appendSection("RECOMMENDED", recommended);
  appendSection("OTHER APPLICATIONS", other);

  return (
    <Group x={0} y={0} width={props.viewportWidth} height={props.viewportHeight}>
      {props.standalone ? (
        <Rect
          x={0}
          y={0}
          width={props.viewportWidth}
          height={props.viewportHeight}
          fill={0x01000000}
          onPointerDown={() => {}}
          onContextMenu={() => {}}
        />
      ) : null}
      {!props.standalone ? (
        <Rect
          x={0}
          y={0}
          width={props.viewportWidth}
          height={props.viewportHeight}
          fill={pal.overlay}
          onPress={props.onDismiss}
          onContextMenu={props.onDismiss}
        />
      ) : null}
      {!props.standalone ? (
        <LayerSurface
          x={x + 5}
          y={y + 6}
          width={width}
          height={height}
          fill={pal.rimShade}
          radius={pal.radiusMd}
        />
      ) : null}
      <LayerSurface
        x={x}
        y={y}
        width={width}
        height={height}
        fill={pal.panel}
        radius={pal.radiusMd}
        clip={props.standalone}
      >
        <Rect x={0} y={0} width={width} height={3} fill={pal.accentLine} />
        {props.standalone && props.onDrag ? (
          <Rect
            x={0}
            y={3}
            width={width}
            height={76}
            fill={0x01000000}
            onPointerDown={props.onDrag}
          />
        ) : null}
        <Icon x={24} y={22} name="app" size={48} color={pal.accent} />
        <Text
          x={88}
          y={22}
          text={`Open ${truncate(props.fileName, 34)} with…`}
          color={pal.text}
          fontSize={18}
          fontWeight="medium"
        />
        <Text x={88} y={51} text={props.mimeType} color={pal.muted} fontSize={12} />
        <SearchField
          x={20}
          y={88}
          width={width - 40}
          height={34}
          value={query}
          placeholder="Search applications"
          autoFocus
          onChange={setQuery}
          onCancel={props.onDismiss}
          onSubmit={() => {
            if (selected) props.onOpen(selected);
          }}
          onKeyDown={(event) => {
            if (event.code === 103) {
              moveSelection(-1);
              return true;
            }
            if (event.code === 108) {
              moveSelection(1);
              return true;
            }
            return false;
          }}
        />
        <LayerSurface
          x={20}
          y={listTop}
          width={width - 40}
          height={listH}
          fill={pal.bg}
          radius={pal.radiusSm}
        >
          {selectable.length === 0 ? (
            <Group x={20} y={24} width={width - 80} height={70}>
              <Text
                x={0}
                y={0}
                text={
                  query ? "No applications match this search." : "No applications are available."
                }
                color={pal.text}
                fontSize={14}
                fontWeight="medium"
              />
              <Text
                x={0}
                y={28}
                text={
                  query
                    ? "Try a broader application name."
                    : "Install an application and try again."
                }
                color={pal.muted}
                fontSize={12}
              />
            </Group>
          ) : (
            <ScrollArea
              width={width - 40}
              height={listH}
              contentHeight={contentH}
              scrollY={scrollY}
              onScroll={setScrollY}
            >
              {listRows}
            </ScrollArea>
          )}
        </LayerSurface>
        <Rect x={0} y={footerY} width={width} height={1} fill={pal.borderSubtle} />
        <Button
          x={20}
          y={footerY + 20}
          width={86}
          height={34}
          label="Cancel"
          variant="ghost"
          onPress={props.onDismiss}
        />
        {props.allowMakeDefault !== false ? (
          <Button
            x={width - 250}
            y={footerY + 20}
            width={132}
            height={34}
            label={selectedChoice?.isDefault ? "Default App" : "Set as Default"}
            variant="secondary"
            disabled={!canOpen || selectedChoice?.isDefault}
            onPress={selected ? () => props.onMakeDefault(selected) : undefined}
          />
        ) : null}
        <Button
          x={width - 108}
          y={footerY + 20}
          width={88}
          height={34}
          label="Open"
          variant="primary"
          disabled={!canOpen}
          onPress={selected ? () => props.onOpen(selected) : undefined}
        />
      </LayerSurface>
    </Group>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
