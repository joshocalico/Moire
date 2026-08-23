/** Root overlay composition, anchored popovers, modal sheets, and toast chrome. */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Group, Rect } from "@moire/react-host";
import { requestActiveWindowRedraw } from "../window.js";
import { useTween } from "../motion.js";
import { useWidgetTheme } from "../widget-theme.js";
import { Button } from "./button.js";
import { FocusScope } from "./focus.js";
import { Horizontal, Inset, Spacer, Vertical } from "./layout.js";
import { Surface, TextBlock } from "./primitives.js";

type OverlayRender = () => ReactNode;
type OverlayController = {
  mount(id: string, render: OverlayRender): void;
  update(id: string): void;
  unmount(id: string): void;
};

const OverlayContext = createContext<OverlayController | null>(null);

export type OverlayHostProps = {
  width: number;
  height: number;
  children?: ReactNode;
};

/** Paint registered overlays after ordinary content so they remain topmost. */
export function OverlayHost(props: OverlayHostProps): ReactNode {
  const [entries, setEntries] = useState<ReadonlyMap<string, OverlayRender>>(
    () => new Map(),
  );
  const mount = useCallback((id: string, render: OverlayRender) => {
    setEntries((current) => {
      if (current.get(id) === render) return current;
      const next = new Map(current);
      next.set(id, render);
      return next;
    });
    requestActiveWindowRedraw();
  }, []);
  const unmount = useCallback((id: string) => {
    setEntries((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    requestActiveWindowRedraw();
  }, []);
  const update = useCallback((id: string) => {
    setEntries((current) => current.has(id) ? new Map(current) : current);
    requestActiveWindowRedraw();
  }, []);
  const controller = useMemo(
    () => ({ mount, update, unmount }),
    [mount, unmount, update],
  );
  return (
    <OverlayContext.Provider value={controller}>
      <Group width={props.width} height={props.height}>
        {props.children}
      </Group>
      <Group width={props.width} height={props.height}>
        {[...entries.entries()].map(([id, render]) => (
          <React.Fragment key={id}>{render()}</React.Fragment>
        ))}
      </Group>
    </OverlayContext.Provider>
  );
}

export type OverlayPortalProps = {
  children?: ReactNode;
};

/** Register content with the nearest OverlayHost top layer. */
export function OverlayPortal(props: OverlayPortalProps): ReactNode {
  const controller = useContext(OverlayContext);
  const id = useId();
  const latest = useRef(props.children);
  latest.current = props.children;
  useEffect(() => {
    if (!controller) return;
    const render = () => latest.current;
    controller.mount(id, render);
    return () => controller.unmount(id);
  }, [controller, id]);
  useEffect(() => {
    controller?.update(id);
  }, [controller, id, props.children]);
  return controller ? null : props.children;
}

export type ModalBarrierProps = {
  width: number;
  height: number;
  visible?: boolean;
  onDismiss?: () => void;
};

/** Pointer barrier and optional modal scrim. */
export function ModalBarrier(props: ModalBarrierProps): ReactNode {
  const theme = useWidgetTheme();
  const alpha = props.visible === false
    ? 0
    : Math.round(theme.foundations.opacity.scrim * 255);
  return (
    <Rect
      width={props.width}
      height={props.height}
      fill={((alpha << 24) | (theme.foundations.palette.bg & 0x00ffffff)) >>> 0}
      onPress={props.onDismiss}
      onContextMenu={props.onDismiss}
    />
  );
}

export type PopoverPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

export type PopoverProps = {
  open: boolean;
  viewportWidth: number;
  viewportHeight: number;
  anchor: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  placement?: PopoverPlacement;
  modal?: boolean;
  trapFocus?: boolean;
  dismissOnOutside?: boolean;
  onDismiss: () => void;
  children?: ReactNode;
};

function popoverPosition(props: PopoverProps): { x: number; y: number; fromY: number } {
  const gap = 7;
  const placement = props.placement ?? "bottom-start";
  const below = placement.startsWith("bottom");
  const end = placement.endsWith("end");
  const desiredX = end
    ? props.anchor.x + props.anchor.width - props.width
    : props.anchor.x;
  const desiredY = below
    ? props.anchor.y + props.anchor.height + gap
    : props.anchor.y - props.height - gap;
  return {
    x: Math.max(8, Math.min(desiredX, props.viewportWidth - props.width - 8)),
    y: Math.max(8, Math.min(desiredY, props.viewportHeight - props.height - 8)),
    fromY: below ? -6 : 6,
  };
}

/** Anchored overlay surface with focus trapping, dismissal, and entrance motion. */
export function Popover(props: PopoverProps): ReactNode {
  const theme = useWidgetTheme();
  const progress = useTween(props.open ? 1 : 0, {
    initialValue: 0,
    duration: props.open
      ? theme.foundations.motion.normalMs
      : theme.foundations.motion.fastMs,
    easing: "ease-out",
  });
  if (!props.open && progress <= 0.001) return null;
  const position = popoverPosition(props);
  return (
    <OverlayPortal>
      <Group width={props.viewportWidth} height={props.viewportHeight}>
        {props.dismissOnOutside !== false ? (
          <ModalBarrier
            width={props.viewportWidth}
            height={props.viewportHeight}
            visible={props.modal}
            onDismiss={props.onDismiss}
          />
        ) : null}
        <FocusScope
          x={position.x}
          y={position.y + Math.round(position.fromY * (1 - progress))}
          width={props.width}
          height={props.height}
          active={props.open}
          trap={props.trapFocus !== false}
          onEscape={props.onDismiss}
        >
          <Surface
            width={props.width}
            height={props.height}
            fill={theme.foundations.palette.overlay}
            radius={theme.foundations.radii.medium}
            stroke={theme.foundations.palette.border}
            strokeWidth={theme.foundations.borders.control}
            elevation="medium"
            opacity={progress}
            clip
          >
            {props.children}
          </Surface>
        </FocusScope>
      </Group>
    </OverlayPortal>
  );
}

export type SheetProps = {
  open: boolean;
  viewportWidth: number;
  viewportHeight: number;
  width?: number;
  height?: number;
  edge?: "right" | "bottom";
  title: string;
  onDismiss: () => void;
  children?: ReactNode;
};

/** Modal edge sheet for focused secondary workflows. */
export function Sheet(props: SheetProps): ReactNode {
  const theme = useWidgetTheme();
  const progress = useTween(props.open ? 1 : 0, {
    initialValue: 0,
    duration: theme.foundations.motion.slowMs,
    easing: "ease-out",
  });
  if (!props.open && progress <= 0.001) return null;
  const edge = props.edge ?? "right";
  const width = edge === "right" ? (props.width ?? Math.min(440, props.viewportWidth - 32)) : props.viewportWidth;
  const height = edge === "bottom" ? (props.height ?? Math.min(360, props.viewportHeight - 32)) : props.viewportHeight;
  const x = edge === "right" ? props.viewportWidth - width * progress : 0;
  const y = edge === "bottom" ? props.viewportHeight - height * progress : 0;
  return (
    <OverlayPortal>
      <Group width={props.viewportWidth} height={props.viewportHeight}>
        <ModalBarrier width={props.viewportWidth} height={props.viewportHeight} onDismiss={props.onDismiss} />
        <FocusScope x={x} y={y} width={width} height={height} active={props.open} onEscape={props.onDismiss}>
          <Surface
            width={width}
            height={height}
            fill={theme.foundations.palette.panel}
            radius={edge === "bottom" ? theme.foundations.radii.large : 0}
            elevation="high"
          >
            <Inset width={width} height={height} padding={theme.foundations.space.lg}>
              <Vertical gap={theme.foundations.space.md}>
                <Horizontal height={36} align="center">
                  <TextBlock flexGrow={1} text={props.title} fontSize={18} fontWeight="medium" verticalAlign="center" />
                  <Button width={84} size="small" variant="ghost" label="Close" onPress={props.onDismiss} />
                </Horizontal>
                <Vertical flexGrow={1}>{props.children}</Vertical>
              </Vertical>
            </Inset>
          </Surface>
        </FocusScope>
      </Group>
    </OverlayPortal>
  );
}

export type ConfirmationDialogProps = {
  open: boolean;
  viewportWidth: number;
  viewportHeight: number;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
};

export function ConfirmationDialog(props: ConfirmationDialogProps): ReactNode {
  const theme = useWidgetTheme();
  const width = Math.min(440, props.viewportWidth - 32);
  const height = 190;
  const progress = useTween(props.open ? 1 : 0, {
    initialValue: 0,
    duration: theme.foundations.motion.normalMs,
    easing: "ease-out",
  });
  if (!props.open && progress <= 0.001) return null;
  return (
    <OverlayPortal>
      <Group width={props.viewportWidth} height={props.viewportHeight}>
        <ModalBarrier width={props.viewportWidth} height={props.viewportHeight} onDismiss={props.onDismiss} />
        <FocusScope
          x={Math.round((props.viewportWidth - width) / 2)}
          y={Math.round((props.viewportHeight - height) / 2 + (1 - progress) * 10)}
          width={width}
          height={height}
          active={props.open}
          onEscape={props.onDismiss}
        >
          <Surface width={width} height={height} elevation="high" radius={theme.foundations.radii.large} opacity={progress}>
            <Inset width={width} height={height} padding={theme.foundations.space.lg}>
              <Vertical gap={theme.foundations.space.sm}>
                <TextBlock height={28} text={props.title} fontSize={17} fontWeight="medium" verticalAlign="center" />
                <TextBlock flexGrow={1} text={props.message} color={theme.foundations.palette.muted} fontSize={12} wrap lineGap={3} overflow="clip" />
                <Horizontal height={38} gap={8} align="center">
                  <Spacer />
                  <Button width={100} label={props.cancelLabel ?? "Cancel"} onPress={props.onDismiss} />
                  <Button
                    width={112}
                    label={props.confirmLabel ?? "Continue"}
                    variant={props.danger ? "danger" : "primary"}
                    autoFocus
                    onPress={props.onConfirm}
                  />
                </Horizontal>
              </Vertical>
            </Inset>
          </Surface>
        </FocusScope>
      </Group>
    </OverlayPortal>
  );
}

export type ToastItem = {
  id: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
};

type ToastCardProps = {
  item: ToastItem;
  width: number;
  onDismiss: (id: string) => void;
};

function ToastCard(props: ToastCardProps): ReactNode {
  const theme = useWidgetTheme();
  const { id, durationMs } = props.item;
  const dismissRef = useRef(props.onDismiss);
  dismissRef.current = props.onDismiss;
  useEffect(() => {
    const duration = durationMs ?? 5000;
    if (duration <= 0) return;
    const timer = setTimeout(() => dismissRef.current(id), duration);
    return () => clearTimeout(timer);
  }, [durationMs, id]);
  return (
    <Surface width={props.width} height={76} elevation="medium" radius={theme.foundations.radii.medium}>
      <Inset width={props.width} height={76} padding={{ vertical: 10, horizontal: 12 }}>
        <Horizontal gap={10} align="center">
          <Vertical flexGrow={1} gap={3} justify="center">
            <TextBlock height={18} text={props.item.title} fontSize={13} fontWeight="medium" overflow="ellipsis" maxLines={1} />
            {props.item.message ? <TextBlock height={16} text={props.item.message} fontSize={11} color={theme.foundations.palette.muted} overflow="ellipsis" maxLines={1} /> : null}
          </Vertical>
          {props.item.actionLabel ? (
            <Button width={84} size="small" variant="ghost" label={props.item.actionLabel} onPress={props.item.onAction} />
          ) : null}
          <Button width={64} size="small" variant="ghost" label="Hide" onPress={() => props.onDismiss(props.item.id)} />
        </Horizontal>
      </Inset>
    </Surface>
  );
}

export type ToastHostProps = {
  viewportWidth: number;
  viewportHeight: number;
  items: readonly ToastItem[];
  onDismiss: (id: string) => void;
  width?: number;
};

export function ToastHost(props: ToastHostProps): ReactNode {
  const width = props.width ?? Math.min(380, props.viewportWidth - 32);
  const height = props.items.length * 76 + Math.max(0, props.items.length - 1) * 10;
  if (props.items.length === 0) return null;
  return (
    <OverlayPortal>
      <Vertical
        x={props.viewportWidth - width - 16}
        y={16}
        width={width}
        height={height}
        gap={10}
      >
        {props.items.map((item) => (
          <ToastCard key={item.id} item={item} width={width} onDismiss={props.onDismiss} />
        ))}
      </Vertical>
    </OverlayPortal>
  );
}
