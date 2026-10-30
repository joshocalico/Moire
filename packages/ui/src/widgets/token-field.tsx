/** A search field holding filter tokens before its free text, with completions. */
import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  measureTextBounds,
  type HitKeyEvent,
  type SceneNode,
} from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { mixColor } from "#ui/theme-family-color";
import { resolveStatefulStyle, useWidgetTheme, type ButtonSize } from "#ui/widget-theme";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";
import { registerIntrinsicSize } from "./layout";
import { OverlayPortal, useOverlayHost } from "./overlay";
import { Pressable } from "./pressable";
import { Surface, TextBlock } from "./primitives";
import { TextField } from "./text-field";

export type TokenFieldToken = {
  id: string;
  label: string;
  /** Chip colour, mixed into the field's fill; the accent by default. */
  tint?: number;
};

export type TokenFieldCompletion = {
  id: string;
  label: string;
  detail?: string;
  icon?: IconName;
  tint?: number;
  /** Accepting appends this token and replaces the free text with `text` (empty by default). */
  token?: TokenFieldToken;
  /** Accepting sets the free text to this, e.g. to complete a word. */
  text?: string;
};

export type TokenFieldProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  size?: ButtonSize;
  tokens: readonly TokenFieldToken[];
  value: string;
  placeholder?: string;
  /** Offered in a list under the field while it has focus; Tab or Enter accepts. */
  completions?: readonly TokenFieldCompletion[];
  /** Quiet text at the trailing edge, e.g. a result count. */
  trailingText?: string;
  onChange?: (value: string) => void;
  onTokensChange?: (tokens: TokenFieldToken[]) => void;
  onAccept?: (completion: TokenFieldCompletion) => void;
  onSubmit?: (value: string, tokens: readonly TokenFieldToken[]) => void;
  /** Escape with no completion list open. */
  onEscape?: () => void;
  /**
   * Keys the completion list did not take, before the field's own handling (Backspace, Escape)
   * and the editor; return true to consume, e.g. arrows that move through results elsewhere.
   */
  onKeyDown?: (event: HitKeyEvent) => boolean | void;
  onFocusChange?: (focused: boolean) => void;
  focusId?: string;
  autoFocus?: boolean;
  disabled?: boolean;
};

const TOKEN_PAD_X = 8;
const TOKEN_CLOSE = 10;
const TOKEN_GAP = 6;
const TOKEN_SIZE = 12;
/** Room the typed text keeps beside the tokens before older tokens fold into "+N". */
const MIN_TEXT = 96;
const ROW_H = 32;
const MAX_ROWS = 6;

function fieldHeight(props: Pick<TokenFieldProps, "height" | "size">, recipeHeight: number) {
  return props.height ?? Math.round(recipeHeight * getUiScaleFactor());
}

function tokenWidth(label: string, ui: number): number {
  return Math.ceil(
    measureTextBounds(label, { fontSize: TOKEN_SIZE }).width +
      (TOKEN_PAD_X + TOKEN_GAP + TOKEN_CLOSE + TOKEN_PAD_X - 2) * ui,
  );
}

type TokenChipProps = {
  x: number;
  y: number;
  height: number;
  token: TokenFieldToken;
  fieldFill: number;
  onRemove?: () => void;
};

function TokenChip(props: TokenChipProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const width = tokenWidth(props.token.label, ui);
  const close = TOKEN_CLOSE * ui;
  const fill = mixColor(props.fieldFill, props.token.tint ?? pal.accent, 0.28);
  return (
    <Group x={props.x} y={props.y} width={width} height={props.height}>
      <Rect width={width} height={props.height} fill={fill} radius={6 * ui} />
      <TextBlock
        x={TOKEN_PAD_X * ui}
        width={Math.max(1, width - (TOKEN_PAD_X + TOKEN_GAP) * ui - close)}
        height={props.height}
        text={props.token.label}
        color={pal.text}
        fontSize={TOKEN_SIZE}
        verticalAlign="center"
        maxLines={1}
      />
      {props.onRemove ? (
        // Not a focus stop: Backspace removes tokens from the keyboard.
        <Pressable
          x={width - close - (TOKEN_PAD_X + 2) * ui}
          y={Math.round((props.height - close - 8 * ui) / 2)}
          width={close + 8 * ui}
          height={close + 8 * ui}
          radius={4 * ui}
          hoverFill={mixColor(fill, pal.text, 0.15)}
          focusable={false}
          onPress={props.onRemove}
        >
          <Icon x={4 * ui} y={4 * ui} name="close" size={close} color={pal.muted} symbolic />
        </Pressable>
      ) : null}
    </Group>
  );
}

type CompletionListProps = {
  width: number;
  completions: readonly TokenFieldCompletion[];
  active: number;
  onActive: (index: number) => void;
  onHoverChange: (hovered: boolean) => void;
  onAccept: (completion: TokenFieldCompletion) => void;
};

function CompletionList(props: CompletionListProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const row = ROW_H * ui;
  const shown = props.completions.slice(0, MAX_ROWS);
  const height = shown.length * row + 8 * ui;
  return (
    <Surface
      width={props.width}
      height={height}
      fill={pal.overlay}
      radius={theme.foundations.radii.medium}
      stroke={pal.border}
      strokeWidth={theme.foundations.borders.control}
      elevation="medium"
    >
      {shown.map((completion, index) => (
        <Group
          key={completion.id}
          x={4 * ui}
          y={4 * ui + index * row}
          width={props.width - 8 * ui}
          height={row}
        >
          {/* Rows are not focus stops: focus stays in the field while arrows move the highlight. */}
          <Pressable
            width={props.width - 8 * ui}
            height={row}
            fill={index === props.active ? pal.selection : 0x00000000}
            hoverFill={index === props.active ? pal.selection : pal.hover}
            radius={theme.foundations.radii.small}
            focusable={false}
            onHoverChange={(hovered) => {
              props.onHoverChange(hovered);
              if (hovered) props.onActive(index);
            }}
            onPress={() => props.onAccept(completion)}
          />
          {completion.icon ? (
            <Icon
              x={10 * ui}
              y={Math.round((row - 16 * ui) / 2)}
              name={completion.icon}
              size={16 * ui}
              color={completion.tint ?? pal.muted}
              symbolic
            />
          ) : null}
          <TextBlock
            x={(completion.icon ? 34 : 10) * ui}
            width={Math.max(1, (props.width - 8 * ui) * 0.6 - (completion.icon ? 34 : 10) * ui)}
            height={row}
            text={completion.label}
            color={pal.text}
            fontSize={13}
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
          {completion.detail ? (
            <TextBlock
              x={(props.width - 8 * ui) * 0.6}
              width={(props.width - 8 * ui) * 0.4 - 10 * ui}
              height={row}
              text={completion.detail}
              color={pal.muted}
              fontSize={11}
              horizontalAlign="end"
              verticalAlign="center"
              overflow="ellipsis"
              maxLines={1}
            />
          ) : null}
        </Group>
      ))}
    </Surface>
  );
}

/**
 * Tokens render as chips before the typed text. Backspace in empty text removes the last token,
 * Up and Down move through the completions, Tab or Enter accepts one, and Escape closes the list
 * (or, with it closed, calls `onEscape`). Enter with no list submits.
 */
export function TokenField(props: TokenFieldProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const recipe = theme.recipes.textField[props.size ?? "medium"];
  const ui = getUiScaleFactor();
  const generatedId = useId();
  const host = useOverlayHost();
  const frame = useRef<SceneNode | null>(null);
  const [focused, setFocused] = useState(false);
  const [focusedOnce, setFocusedOnce] = useState(false);
  // Pressing a completion or a token's close button takes focus from the field; this returns it.
  const [refocus, setRefocus] = useState(false);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pointerInList, setPointerInList] = useState(false);
  const completions = props.completions ?? [];
  const completionKey = completions.map((completion) => completion.id).join("\u0000");
  useEffect(() => {
    setActive(0);
  }, [completionKey]);
  useEffect(() => {
    setDismissed(false);
  }, [props.value, props.tokens.length]);

  const height = fieldHeight(props, recipe.metrics.height);
  const states = [
    ...(focused ? (["focused"] as const) : []),
    ...(props.disabled ? (["disabled"] as const) : []),
  ];
  const root = resolveStatefulStyle(recipe.root, ...states);
  const icon = resolveStatefulStyle(recipe.leadingIcon, ...states);
  const padX = recipe.metrics.paddingX * ui;
  const iconSize = icon.size * ui;
  const tokenHeight = Math.min(28 * ui, height - 8 * ui);
  const tokenY = Math.round((height - tokenHeight) / 2);
  const gap = TOKEN_GAP * ui;

  const trailing = props.value.length > 0 || props.tokens.length > 0;
  const clearSize = Math.min(height - 8 * ui, 24 * ui);
  const trailingTextWidth = props.trailingText
    ? Math.ceil(measureTextBounds(props.trailingText, { fontSize: 11 }).width) + 12 * ui
    : 0;
  const trailingWidth = (trailing ? clearSize + 6 * ui : 0) + trailingTextWidth;

  // Keep the newest tokens; older ones fold into a "+N" chip when the text would get too narrow.
  const tokensStart = padX + iconSize + recipe.metrics.slotGap * ui;
  const budget = props.width - tokensStart - trailingWidth - padX - MIN_TEXT * ui;
  const widths = props.tokens.map((token) => tokenWidth(token.label, ui));
  const foldWidth = (count: number) =>
    count > 0
      ? Math.ceil(measureTextBounds(`+${count}`, { fontSize: TOKEN_SIZE }).width + 14 * ui)
      : 0;
  let hiddenCount = props.tokens.length;
  let used = 0;
  while (hiddenCount > 0) {
    const next = widths[hiddenCount - 1]! + gap;
    const fold = hiddenCount > 1 ? foldWidth(hiddenCount - 1) + gap : 0;
    if (used + next + fold > budget) break;
    hiddenCount--;
    used += next;
  }
  const foldLabel = `+${hiddenCount}`;
  let x = tokensStart;
  const placedTokens: { token: TokenFieldToken; x: number }[] = [];
  const foldX = x;
  if (hiddenCount) x += foldWidth(hiddenCount) + gap;
  for (let index = hiddenCount; index < props.tokens.length; index++) {
    placedTokens.push({ token: props.tokens[index]!, x });
    x += widths[index]! + gap;
  }
  // The editor insets its text by the recipe's (unscaled) padding; start that text at `x`.
  const textX = x - recipe.metrics.paddingX;
  const textWidth = Math.max(1, props.width - textX - trailingWidth - 4 * ui);

  const listOpen =
    !props.disabled && completions.length > 0 && !dismissed && (focused || pointerInList);

  const removeToken = (index: number) => {
    props.onTokensChange?.(props.tokens.filter((_, candidate) => candidate !== index));
  };
  const accept = (completion: TokenFieldCompletion) => {
    if (completion.token) {
      props.onTokensChange?.([...props.tokens, completion.token]);
      props.onChange?.(completion.text ?? "");
    } else if (completion.text !== undefined) props.onChange?.(completion.text);
    props.onAccept?.(completion);
    setPointerInList(false);
  };
  const handleKey = (event: HitKeyEvent): boolean => {
    if (listOpen) {
      const count = Math.min(MAX_ROWS, completions.length);
      if (event.code === 108 || event.key === "ArrowDown") {
        setActive((current) => (current + 1) % count);
        return true;
      }
      if (event.code === 103 || event.key === "ArrowUp") {
        setActive((current) => (current - 1 + count) % count);
        return true;
      }
      if (event.code === 15 || event.code === 28 || event.key === "Tab" || event.key === "Enter") {
        const completion = completions[Math.min(active, count - 1)];
        if (completion) accept(completion);
        return true;
      }
      if (event.code === 1 || event.key === "Escape") {
        setDismissed(true);
        return true;
      }
    }
    if (props.onKeyDown?.(event) === true) return true;
    if ((event.code === 14 || event.key === "Backspace") && props.value === "") {
      if (props.tokens.length > 0 && !props.disabled) removeToken(props.tokens.length - 1);
      return true;
    }
    if (event.code === 1 || event.key === "Escape") {
      props.onEscape?.();
      return true;
    }
    return false;
  };

  const located = host && frame.current ? host.locate(frame.current) : null;
  const list = listOpen ? (
    <CompletionList
      width={props.width}
      completions={completions}
      active={active}
      onActive={setActive}
      onHoverChange={setPointerInList}
      onAccept={(completion) => {
        accept(completion);
        setRefocus(true);
      }}
    />
  ) : null;

  return (
    <Group ref={frame} x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height}>
      <Rect
        width={props.width}
        height={height}
        fill={root.fill}
        radius={root.radius}
        stroke={root.stroke}
        strokeWidth={root.strokeWidth}
      />
      <Icon
        x={padX}
        y={Math.round((height - iconSize) / 2)}
        name="search"
        size={iconSize}
        color={icon.color}
        symbolic
      />
      {hiddenCount ? (
        <Group x={foldX} y={tokenY} width={foldWidth(hiddenCount)} height={tokenHeight}>
          <Rect
            width={foldWidth(hiddenCount)}
            height={tokenHeight}
            fill={mixColor(root.fill, pal.muted, 0.2)}
            radius={6 * ui}
          />
          <TextBlock
            width={foldWidth(hiddenCount)}
            height={tokenHeight}
            text={foldLabel}
            color={pal.muted}
            fontSize={TOKEN_SIZE}
            horizontalAlign="center"
            verticalAlign="center"
            maxLines={1}
          />
        </Group>
      ) : null}
      {placedTokens.map(({ token, x: tokenX }, index) => (
        <TokenChip
          key={token.id}
          x={tokenX}
          y={tokenY}
          height={tokenHeight}
          token={token}
          fieldFill={root.fill}
          onRemove={
            props.disabled
              ? undefined
              : () => {
                  removeToken(hiddenCount + index);
                  setRefocus(true);
                }
          }
        />
      ))}
      <TextField
        x={textX}
        width={textWidth}
        height={height}
        size={props.size}
        chromeless
        value={props.value}
        placeholder={props.tokens.length ? undefined : props.placeholder}
        disabled={props.disabled}
        focusId={props.focusId ?? `token-field:${generatedId}`}
        autoFocus={refocus || (!!props.autoFocus && !focusedOnce)}
        captureTab={listOpen}
        onFocusChange={(next) => {
          setFocused(next);
          if (next) {
            setFocusedOnce(true);
            setRefocus(false);
          }
          props.onFocusChange?.(next);
        }}
        onKeyDown={handleKey}
        onChange={props.onChange}
        onSubmit={(value) => props.onSubmit?.(value, props.tokens)}
      />
      {props.trailingText ? (
        <TextBlock
          x={props.width - padX - trailingWidth + 6 * ui}
          width={trailingTextWidth - 6 * ui}
          height={height}
          text={props.trailingText}
          color={pal.muted}
          fontSize={11}
          horizontalAlign="end"
          verticalAlign="center"
          maxLines={1}
        />
      ) : null}
      {trailing ? (
        <IconButton
          x={props.width - padX - clearSize + 4 * ui}
          y={Math.round((height - clearSize) / 2)}
          width={clearSize}
          height={clearSize}
          variant="ghost"
          size="small"
          tooltip="Clear search"
          disabled={props.disabled}
          // Not a focus stop; the press refocuses the text so typing continues there.
          focusable={false}
          icon={(style) => (
            <Icon name="close" size={Math.min(style.size, 14 * ui)} color={style.color} symbolic />
          )}
          onPress={() => {
            props.onTokensChange?.([]);
            props.onChange?.("");
            setRefocus(true);
          }}
        />
      ) : null}
      {list ? (
        located ? (
          <OverlayPortal>
            <Group x={located.x} y={located.y + height + 4 * ui} width={props.width} height={1}>
              {list}
            </Group>
          </OverlayPortal>
        ) : (
          <Group y={height + 4 * ui} width={props.width} height={1}>
            {list}
          </Group>
        )
      ) : null}
    </Group>
  );
}

registerIntrinsicSize(TokenField, (props, theme) => ({
  width: props.width,
  height: fieldHeight(props, theme.recipes.textField[props.size ?? "medium"].metrics.height),
}));
