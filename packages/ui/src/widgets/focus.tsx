/** Declarative focus boundaries and window-level keyboard commands. */
import React, { useId, type ReactNode } from "react";
import { Group, type HitKeyEvent } from "@moire/react-host";
import { useLayoutMetrics, type FlexItemProps } from "./layout";

export type FocusScopeProps = FlexItemProps & {
  id?: string;
  active?: boolean;
  trap?: boolean;
  onEscape?: () => void;
  children?: ReactNode;
};

/** Constrain traversal to a subtree while it is the active modal/flyout scope. */
export function FocusScope(props: FocusScopeProps): ReactNode {
  const generatedId = useId();
  const allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? 0;
  const height = props.height ?? allocated?.height ?? 0;
  const id = props.id ?? `focus-scope:${generatedId}`;
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width}
      height={height}
      focusScopeId={id}
      focusScopeTrap={props.trap !== false}
      focusScopeActive={props.active !== false}
      onGlobalKeyDown={
        props.onEscape
          ? (event) => {
              if (event.repeat || (event.key !== "Escape" && event.code !== 1)) return false;
              props.onEscape?.();
              return true;
            }
          : undefined
      }
    >
      {props.children}
    </Group>
  );
}

export type Shortcut = {
  id: string;
  key?: string;
  code?: number;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
  /** Match Ctrl on Linux/Windows or Meta on macOS-style keyboards. */
  platformModifier?: boolean;
  allowRepeat?: boolean;
  disabled?: boolean;
  /** Receives the key event, whose `targetBounds` locate the focused control (to anchor a menu). */
  onInvoke: (event: HitKeyEvent) => void;
};

export type ShortcutManagerProps = FlexItemProps & {
  shortcuts: readonly Shortcut[];
  /** Keys no shortcut matched, still ahead of the focused widget; return true to consume. */
  onKeyDown?: (event: HitKeyEvent) => boolean | void;
  enabled?: boolean;
  children?: ReactNode;
};

function matchesShortcut(shortcut: Shortcut, event: HitKeyEvent): boolean {
  if (shortcut.disabled || (!shortcut.allowRepeat && event.repeat)) return false;
  const keyMatches =
    shortcut.key == null || shortcut.key.toLocaleLowerCase() === event.key?.toLocaleLowerCase();
  const codeMatches = shortcut.code == null || shortcut.code === event.code;
  const modifierMatches = shortcut.platformModifier
    ? event.ctrlKey || event.metaKey
    : event.ctrlKey === (shortcut.ctrl ?? false) && event.metaKey === (shortcut.meta ?? false);
  return (
    keyMatches &&
    codeMatches &&
    modifierMatches &&
    event.shiftKey === (shortcut.shift ?? false) &&
    event.altKey === (shortcut.alt ?? false)
  );
}

/** Dispatch declarative commands before focused-widget keyboard handling. */
export function ShortcutManager(props: ShortcutManagerProps): ReactNode {
  const allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? 0;
  const height = props.height ?? allocated?.height ?? 0;
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width}
      height={height}
      onGlobalKeyDown={
        props.enabled === false
          ? undefined
          : (event) => {
              const shortcut = props.shortcuts.find((candidate) =>
                matchesShortcut(candidate, event),
              );
              if (!shortcut) return props.onKeyDown?.(event) === true;
              shortcut.onInvoke(event);
              return true;
            }
      }
    >
      {props.children}
    </Group>
  );
}
