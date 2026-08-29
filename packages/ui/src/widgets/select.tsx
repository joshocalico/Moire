/** Overlay-backed select and editable combo-box controls. */
import React, { useMemo, useState, type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { useWidgetTheme, type ButtonSize } from "#ui/widget-theme";
import { Button } from "./button";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import { Vertical, registerIntrinsicSize } from "./layout";
import { MenuItem } from "./menu";
import { Popover } from "./overlay";
import { ScrollArea } from "./scroll";
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
  maxMenuHeight?: number;
  onChange?: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
};

function OptionsPopover(props: {
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
}): ReactNode {
  const theme = useWidgetTheme();
  const rowHeight = theme.recipes.menu.medium.metrics.rowHeight;
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
      <ScrollArea
        x={4}
        y={4}
        width={props.width - 8}
        height={height - 8}
        contentHeight={contentHeight}
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
              autoFocus={option.id === props.value || (!props.value && index === 0)}
              onPress={() => props.onSelect(option.id)}
            />
          ))}
        </Vertical>
      </ScrollArea>
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
