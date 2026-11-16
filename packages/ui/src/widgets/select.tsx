/** Overlay-backed select and editable combo-box controls. */
import React, { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { useWidgetTheme, type ButtonSize } from "#ui/widget-theme";
import { Button } from "./button";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import { Vertical, registerIntrinsicSize } from "./layout";
import { MenuItem } from "./menu";
import { Popover } from "./overlay";
import { ScrollArea } from "./scroll";
import { ShortcutManager } from "./focus";
import { TextField } from "./text-field";

export type SelectOption = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type SelectProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Host-relative anchor override for controls nested in other layouts. */
  anchorX?: number;
  anchorY?: number;
  options: readonly SelectOption[];
  value?: string | null;
  placeholder?: string;
  size?: ButtonSize;
  disabled?: boolean;
  /** Stable focus identity for the menu button, so focus can return to it by name. */
  focusId?: string;
  maxMenuHeight?: number;
  onChange?: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
};

type OptionsPopoverProps = {
  open: boolean;
  trapFocus: boolean;
  viewportWidth: number;
  viewportHeight: number;
  anchor: { x: number; y: number; width: number; height: number };
  width: number;
  options: readonly SelectOption[];
  value?: string | null;
  maxHeight: number;
  onSelect: (id: string) => void;
  onDismiss: () => void;
};

/** Option focus lives inside the portal so each key updates its painted tree. */
function OptionsList(
  props: OptionsPopoverProps & { height: number; rowHeight: number },
): ReactNode {
  const { rowHeight, height } = props;
  const contentHeight = Math.max(1, props.options.length * rowHeight);
  const selectedIndex = props.options.findIndex(
    (option) => option.id === props.value && !option.disabled,
  );
  const firstEnabled = props.options.findIndex((option) => !option.disabled);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : firstEnabled);
  const [scrollY, setScrollY] = useState(0);
  useLayoutEffect(() => {
    if (props.open) setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled);
  }, [props.open, props.value]);
  useLayoutEffect(() => {
    if (!props.open || !props.trapFocus || activeIndex < 0) return;
    const top = activeIndex * rowHeight;
    const bottom = top + rowHeight;
    const viewportHeight = height - 8;
    setScrollY((current) =>
      top < current ? top : bottom > current + viewportHeight ? bottom - viewportHeight : current,
    );
  }, [props.open, props.trapFocus, activeIndex, rowHeight, height]);
  const move = (offset: -1 | 1) => {
    const enabled = props.options.flatMap((option, index) => (option.disabled ? [] : [index]));
    if (!enabled.length) return;
    const current = enabled.indexOf(activeIndex);
    const next = (current + offset + enabled.length) % enabled.length;
    setActiveIndex(enabled[next] ?? firstEnabled);
  };
  return (
    <ShortcutManager
      width={props.width}
      height={height}
      enabled={props.trapFocus}
      shortcuts={[
        { id: "next-option", key: "ArrowDown", allowRepeat: true, onInvoke: () => move(1) },
        { id: "previous-option", key: "ArrowUp", allowRepeat: true, onInvoke: () => move(-1) },
        { id: "first-option", key: "Home", onInvoke: () => setActiveIndex(firstEnabled) },
        {
          id: "last-option",
          key: "End",
          onInvoke: () =>
            setActiveIndex(
              props.options.reduce((last, option, index) => (option.disabled ? last : index), -1),
            ),
        },
      ]}
    >
      <ScrollArea
        x={4}
        y={4}
        width={props.width - 8}
        height={height - 8}
        contentHeight={contentHeight}
        scrollY={props.trapFocus ? scrollY : undefined}
        onScroll={setScrollY}
        smooth={!props.trapFocus}
      >
        <Vertical width={props.width - 8} height={contentHeight} gap={0}>
          {props.options.map((option, index) => (
            <MenuItem
              key={option.id}
              width={props.width - 8}
              height={rowHeight}
              label={option.label}
              description={option.description}
              selected={option.id === props.value}
              disabled={option.disabled}
              autoFocus={
                props.trapFocus
                  ? index === activeIndex
                  : option.id === props.value || (!props.value && index === 0)
              }
              onPress={() => props.onSelect(option.id)}
            />
          ))}
        </Vertical>
      </ScrollArea>
    </ShortcutManager>
  );
}

function OptionsPopover(props: OptionsPopoverProps): ReactNode {
  const rowHeight = useWidgetTheme().recipes.menu.medium.metrics.rowHeight;
  const contentHeight = Math.max(1, props.options.length * rowHeight);
  const height = Math.min(props.maxHeight, contentHeight + 8);
  return (
    <Popover
      open={props.open}
      viewportWidth={props.viewportWidth}
      viewportHeight={props.viewportHeight}
      anchor={props.anchor}
      width={props.width}
      height={height}
      trapFocus={props.trapFocus}
      onDismiss={props.onDismiss}
    >
      <OptionsList {...props} height={height} rowHeight={rowHeight} />
    </Popover>
  );
}

export function Select(props: SelectProps): ReactNode {
  const theme = useWidgetTheme();
  const [open, setOpen] = useState(false);
  const [measuredAnchor, setMeasuredAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const height = props.height ?? theme.foundations.controlHeights[props.size ?? "medium"];
  const selected = props.options.find((option) => option.id === props.value);
  const setOpenState = (next: boolean) => {
    setOpen(next);
    props.onOpenChange?.(next);
  };
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height}>
      <Button
        width={props.width}
        height={height}
        size={props.size}
        label={selected?.label ?? props.placeholder ?? "Choose…"}
        disabled={props.disabled}
        focusId={props.focusId}
        trailingIcon={(style) => (
          <Icon
            name={open ? "chevron-up" : "chevron-down"}
            size={style.size}
            color={style.color}
            symbolic
          />
        )}
        onPress={(event) => {
          if (event) {
            setMeasuredAnchor({
              x: event.x - event.localX,
              y: event.y - event.localY,
            });
          }
          setOpenState(!open);
        }}
      />
      <OptionsPopover
        open={open}
        trapFocus
        viewportWidth={props.viewportWidth}
        viewportHeight={props.viewportHeight}
        anchor={{
          x: props.anchorX ?? measuredAnchor?.x ?? props.x ?? 0,
          y: props.anchorY ?? measuredAnchor?.y ?? props.y ?? 0,
          width: props.width,
          height,
        }}
        width={props.width}
        options={props.options}
        value={props.value}
        maxHeight={props.maxMenuHeight ?? 280}
        onSelect={(id) => {
          if (props.options.find((option) => option.id === id)?.disabled) return;
          props.onChange?.(id);
          setOpenState(false);
        }}
        onDismiss={() => setOpenState(false)}
      />
    </Group>
  );
}

export type ComboBoxProps = Omit<SelectProps, "value" | "onChange" | "placeholder"> & {
  value: string;
  selectedId?: string | null;
  placeholder?: string;
  onValueChange?: (value: string) => void;
  onSelect?: (id: string) => void;
};

export function ComboBox(props: ComboBoxProps): ReactNode {
  const theme = useWidgetTheme();
  const [open, setOpen] = useState(false);
  const [measuredAnchor, setMeasuredAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const height = props.height ?? theme.foundations.controlHeights[props.size ?? "medium"];
  const filtered = useMemo(() => {
    const query = props.value.trim().toLocaleLowerCase();
    if (!query) return props.options;
    return props.options.filter(
      (option) =>
        option.label.toLocaleLowerCase().includes(query) ||
        option.description?.toLocaleLowerCase().includes(query),
    );
  }, [props.options, props.value]);
  const setOpenState = (next: boolean) => {
    setOpen(next);
    props.onOpenChange?.(next);
  };
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height}>
      <TextField
        width={props.width}
        height={height}
        size={props.size}
        value={props.value}
        placeholder={props.placeholder ?? "Type to filter…"}
        disabled={props.disabled}
        onPress={(event) => {
          setMeasuredAnchor({
            x: event.x - event.localX,
            y: event.y - event.localY,
          });
          setOpenState(true);
        }}
        onChange={(value) => {
          props.onValueChange?.(value);
          setOpenState(true);
        }}
        onKeyDown={(event) => {
          if (event.targetBounds) {
            setMeasuredAnchor({
              x: event.targetBounds.x,
              y: event.targetBounds.y,
            });
          }
          return false;
        }}
        onFocusChange={(focused) => {
          if (focused) setOpenState(true);
        }}
        trailing={(style) => (
          <IconButton
            width={style.size}
            height={style.size}
            size="small"
            variant="ghost"
            icon={<Icon name={open ? "chevron-up" : "chevron-down"} size={style.size} symbolic />}
            onPress={() => setOpenState(!open)}
          />
        )}
      />
      <OptionsPopover
        open={open && filtered.length > 0}
        trapFocus={false}
        viewportWidth={props.viewportWidth}
        viewportHeight={props.viewportHeight}
        anchor={{
          x: props.anchorX ?? measuredAnchor?.x ?? props.x ?? 0,
          y: props.anchorY ?? measuredAnchor?.y ?? props.y ?? 0,
          width: props.width,
          height,
        }}
        width={props.width}
        options={filtered}
        value={props.selectedId}
        maxHeight={props.maxMenuHeight ?? 280}
        onSelect={(id) => {
          const option = props.options.find((candidate) => candidate.id === id);
          if (!option || option.disabled) return;
          props.onValueChange?.(option.label);
          props.onSelect?.(id);
          setOpenState(false);
        }}
        onDismiss={() => setOpenState(false)}
      />
    </Group>
  );
}

registerIntrinsicSize(Select, (props, theme) => ({
  width: props.width,
  height: props.height ?? theme.foundations.controlHeights[props.size ?? "medium"],
}));

registerIntrinsicSize(ComboBox, (props, theme) => ({
  width: props.width,
  height: props.height ?? theme.foundations.controlHeights[props.size ?? "medium"],
}));
