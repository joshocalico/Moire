/**
 * The lock screen, drawn by the compositor over its obscured wallpaper on one output. Styled like
 * the greeter: clock and date, the user's initial and name, a password field, then status and
 * power at the foot.
 *
 * Presentation only. The compositor owns the lock and the password; this sees its length and
 * the check's state, and reports the power menu's choices.
 */
import React, { type ReactNode } from "react";
import {
  Icon,
  IconButton,
  Label,
  Pressable,
  Surface,
  getUiScaleFactor,
  measureWrappedText,
  resolveStatefulStyle,
  useAnimatedValue,
  usePalette,
  useWidgetTheme,
} from "@moire/ui";
import { Group } from "@moire/react-host";
import type { LockScreenAction, LockScreenView } from "./types";

export type LockBattery = Readonly<{ percentage: number; charging: boolean }>;

export type LockScreenProps = Readonly<{
  width: number;
  height: number;
  view: LockScreenView;
  clock: string;
  date: string;
  battery: LockBattery | null;
  powerMenuOpen: boolean;
  onPowerMenu(open: boolean): void;
  onAction(action: LockScreenAction): void;
}>;

/** Focus ids, shared with the pointer dispatch and smokes. */
export const LOCK_FOCUS = {
  power: "lock:power",
  suspend: "lock:suspend",
  reboot: "lock:reboot",
  powerOff: "lock:power-off",
} as const;

const FIELD_HEIGHT = 46;
const FIELD_WIDTH = 320;
const DOT = 9;
const DOT_GAP = 7;
const FOOT_HEIGHT = 40;
const ENTRANCE_MS = 320;
const SHAKE_MS = 380;

function message(view: LockScreenView): string {
  switch (view.phase) {
    case "checking":
      return "Checking…";
    case "wrong":
      return "That password didn't work. Try again.";
    case "rate-limited": {
      const seconds = view.retryAtMs
        ? Math.max(1, Math.ceil((view.retryAtMs - Date.now()) / 1000))
        : 60;
      return seconds > 50
        ? "Too many attempts. Try again in a minute."
        : `Too many attempts. Try again in ${seconds} seconds.`;
    }
    case "unavailable":
      return "Your password can't be checked right now. Try again.";
    default:
      return view.length ? "Press Enter to unlock." : "Type your password to unlock.";
  }
}

function initialOf(view: LockScreenView): string {
  const source = view.user.name || view.user.username;
  return Array.from(source)[0]?.toUpperCase() ?? "";
}

/** One dot per typed character, then the caret; the newest dots when they do not all fit. */
function PasswordField(props: { width: number; view: LockScreenView }): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const { view } = props;
  const height = FIELD_HEIGHT * ui;
  const error = view.phase === "wrong" || view.phase === "unavailable";
  const stroke =
    error || view.phase === "rate-limited"
      ? palette.danger
      : view.phase === "checking"
        ? palette.muted
        : palette.accent;
  const iconSlot = 40 * ui;
  const inner = Math.max(0, props.width - iconSlot - 16 * ui);
  const capacity = Math.max(1, Math.floor((inner + DOT_GAP * ui) / ((DOT + DOT_GAP) * ui)));
  const dots = Math.min(view.length, capacity);
  const caret = view.phase !== "checking";
  return (
    <Surface
      width={props.width}
      height={height}
      radius={12 * ui}
      fill={palette.surface}
      stroke={stroke}
      strokeWidth={Math.max(1, 1.5 * ui)}
    >
      <Surface x={14 * ui} y={(height - 18 * ui) / 2} width={18 * ui} height={18 * ui} fill={0}>
        <Icon name="lock" size={18 * ui} color={palette.muted} symbolic />
      </Surface>
      {dots === 0 ? (
        <Label
          x={iconSlot + 4 * ui}
          y={0}
          width={inner}
          height={height}
          verticalAlign="center"
          text="Password"
          fontSize={14}
          color={palette.muted}
        />
      ) : (
        Array.from({ length: dots }, (_, index) => (
          <Surface
            key={index}
            x={iconSlot + index * (DOT + DOT_GAP) * ui}
            y={(height - DOT * ui) / 2}
            width={DOT * ui}
            height={DOT * ui}
            radius={(DOT * ui) / 2}
            fill={view.phase === "checking" ? palette.muted : palette.text}
          />
        ))
      )}
      {caret ? (
        <Surface
          x={iconSlot + (dots ? dots * (DOT + DOT_GAP) * ui - 2 * ui : 0)}
          y={(height - 22 * ui) / 2}
          width={Math.max(1, 2 * ui)}
          height={22 * ui}
          fill={palette.accent}
        />
      ) : null}
    </Surface>
  );
}

const CHIP_ICON = 18;
const CHIP_GAP = 6;

function chipWidth(text: string): number {
  const ui = getUiScaleFactor();
  return (CHIP_ICON + CHIP_GAP) * ui + measureWrappedText(text, 400 * ui, { fontSize: 13 }).width;
}

/** An icon and a short muted label, laid out absolutely so it never depends on flex sizing. */
function StatusChip(props: {
  x: number;
  y: number;
  icon: "keyboard" | "battery" | "power";
  text: string;
}): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const height = FOOT_HEIGHT * ui;
  const width = chipWidth(props.text);
  return (
    <Surface x={props.x} y={props.y} width={width} height={height} fill={0}>
      <Surface
        x={0}
        y={(height - CHIP_ICON * ui) / 2}
        width={CHIP_ICON * ui}
        height={CHIP_ICON * ui}
        fill={0}
      >
        <Icon name={props.icon} size={CHIP_ICON * ui} color={palette.muted} symbolic />
      </Surface>
      <Label
        x={(CHIP_ICON + CHIP_GAP) * ui}
        y={0}
        width={width - (CHIP_ICON + CHIP_GAP) * ui}
        height={height}
        verticalAlign="center"
        text={props.text}
        fontSize={13}
        color={palette.muted}
        maxLines={1}
      />
    </Surface>
  );
}

function PowerMenu(props: {
  x: number;
  y: number;
  width: number;
  view: LockScreenView;
  onAction(action: LockScreenAction): void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const theme = useWidgetTheme();
  const root = theme.recipes.button.ghost.medium.root;
  const rows: {
    id: string;
    action: LockScreenAction;
    icon: "moon" | "restart" | "power";
    label: string;
  }[] = [];
  if (props.view.power.suspend)
    rows.push({ id: LOCK_FOCUS.suspend, action: "suspend", icon: "moon", label: "Suspend" });
  if (props.view.power.reboot)
    rows.push({ id: LOCK_FOCUS.reboot, action: "reboot", icon: "restart", label: "Restart" });
  if (props.view.power.powerOff)
    rows.push({ id: LOCK_FOCUS.powerOff, action: "power-off", icon: "power", label: "Shut down" });
  const rowHeight = 40 * ui;
  const pad = 6 * ui;
  const height = rows.length * rowHeight + pad * 2;
  return (
    <Surface
      x={props.x}
      y={props.y - height}
      width={props.width}
      height={height}
      radius={12 * ui}
      fill={palette.surface}
      stroke={palette.borderSubtle}
      elevation="medium"
    >
      {rows.map((row, index) => (
        <Pressable
          key={row.id}
          x={pad}
          y={pad + index * rowHeight}
          width={props.width - pad * 2}
          height={rowHeight}
          radius={8 * ui}
          fill={0}
          hoverFill={resolveStatefulStyle(root, "hover").fill}
          pressedFill={resolveStatefulStyle(root, "pressed").fill}
          focusId={row.id}
          onPress={() => props.onAction(row.action)}
        >
          <Surface
            x={12 * ui}
            y={(rowHeight - 18 * ui) / 2}
            width={18 * ui}
            height={18 * ui}
            fill={0}
          >
            <Icon name={row.icon} size={18 * ui} color={palette.text} symbolic />
          </Surface>
          <Label
            x={40 * ui}
            y={0}
            width={props.width - pad * 2 - 52 * ui}
            height={rowHeight}
            verticalAlign="center"
            text={row.label}
            fontSize={13}
            maxLines={1}
          />
        </Pressable>
      ))}
    </Surface>
  );
}

export function LockScreen(props: LockScreenProps): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const { view, width, height } = props;
  const reduced = view.reducedMotion;
  const entrance = useAnimatedValue(1, {
    initialValue: reduced ? 1 : 0,
    duration: reduced ? 0 : ENTRANCE_MS,
    easing: "ease-out",
  });
  // The field shakes once per failed attempt; reduce motion keeps it still (the colour says it).
  const shake = useAnimatedValue(view.failures, {
    initialValue: view.failures,
    duration: reduced ? 0 : SHAKE_MS,
    easing: "linear",
  });
  const margin = Math.min(80 * ui, Math.max(20 * ui, width * 0.063));
  const compact = height < 560 * ui;
  const clockSize = compact ? 44 : 64;
  const clockHeight = (compact ? 54 : 78) * ui;
  const dateHeight = 24 * ui;
  const avatar = (compact ? 56 : 76) * ui;
  const nameHeight = 34 * ui;
  const fieldWidth = Math.max(0, Math.min(FIELD_WIDTH * ui, width - margin * 2));
  const fieldHeight = FIELD_HEIGHT * ui;
  const messageHeight = 20 * ui;
  const capsHeight = 20 * ui;
  const gapLarge = (compact ? 22 : 44) * ui;
  const gap = 10 * ui;
  const total =
    clockHeight +
    dateHeight +
    gapLarge +
    avatar +
    gap +
    nameHeight +
    gap +
    fieldHeight +
    gap +
    messageHeight +
    6 * ui +
    capsHeight;
  const footY = height - margin / 2 - FOOT_HEIGHT * ui;
  const top = Math.max(margin / 2, (footY - total) / 2);
  const cx = width / 2;
  let y = top;
  const place = (h: number, after = 0) => {
    const at = y;
    y += h + after;
    return at;
  };
  const clockY = place(clockHeight);
  const dateY = place(dateHeight, gapLarge);
  const avatarY = place(avatar, gap);
  const nameY = place(nameHeight, gap);
  const fieldY = place(fieldHeight, gap);
  const messageY = place(messageHeight, 6 * ui);
  const capsY = place(capsHeight);
  const errorTone =
    view.phase === "wrong" || view.phase === "unavailable" || view.phase === "rate-limited";
  const chips: ReactNode[] = [];
  let chipX = margin;
  const chip = (key: string, icon: "keyboard" | "battery" | "power", text: string) => {
    chips.push(<StatusChip key={key} x={chipX} y={footY} icon={icon} text={text} />);
    chipX += chipWidth(text) + 18 * ui;
  };
  if (props.battery)
    chip(
      "battery",
      props.battery.charging ? "power" : "battery",
      `${props.battery.percentage}%${props.battery.charging ? " · Charging" : ""}`,
    );
  if (view.layout) chip("layout", "keyboard", view.layout.label);
  const powerAvailable = view.power.suspend || view.power.reboot || view.power.powerOff;
  const powerX = width - margin - FOOT_HEIGHT * ui;
  const menuWidth = 180 * ui;
  return (
    <Surface width={width} height={height} fill={0x00000000}>
      <Group
        width={width}
        height={height}
        opacity={entrance}
        translateY={{ get: () => Math.round((1 - entrance.get()) * 16 * ui) }}
      >
        <Label
          x={0}
          y={clockY}
          width={width}
          height={clockHeight}
          horizontalAlign="center"
          verticalAlign="center"
          text={props.clock}
          fontSize={clockSize}
          fontWeight="medium"
        />
        <Label
          x={margin}
          y={dateY}
          width={Math.max(0, width - margin * 2)}
          height={dateHeight}
          horizontalAlign="center"
          text={props.date}
          fontSize={15}
          color={palette.muted}
          overflow="ellipsis"
          maxLines={1}
        />
        <Surface
          x={cx - avatar / 2}
          y={avatarY}
          width={avatar}
          height={avatar}
          radius={avatar / 2}
          fill={palette.accent}
        >
          <Label
            width={avatar}
            height={avatar}
            text={initialOf(view)}
            horizontalAlign="center"
            verticalAlign="center"
            fontSize={(avatar / ui) * 0.5}
            fontWeight="medium"
            color={0xffffffff}
          />
        </Surface>
        <Label
          x={margin}
          y={nameY}
          width={Math.max(0, width - margin * 2)}
          height={nameHeight}
          horizontalAlign="center"
          verticalAlign="center"
          text={view.user.name || view.user.username}
          fontSize={compact ? 22 : 24}
          fontWeight="medium"
          overflow="ellipsis"
          maxLines={1}
        />
        <Group
          x={cx - fieldWidth / 2}
          y={fieldY}
          width={fieldWidth}
          height={fieldHeight}
          translateX={{
            get: () => {
              const progress = 1 - (view.failures - shake.get());
              if (progress >= 1 || progress <= 0) return 0;
              return Math.round(Math.sin(progress * Math.PI * 6) * (1 - progress) * 10 * ui);
            },
          }}
        >
          <PasswordField width={fieldWidth} view={view} />
        </Group>
        <Label
          x={margin}
          y={messageY}
          width={Math.max(0, width - margin * 2)}
          height={messageHeight}
          horizontalAlign="center"
          text={message(view)}
          fontSize={13}
          color={errorTone ? palette.danger : palette.muted}
          overflow="ellipsis"
          maxLines={1}
        />
        {view.capsLock ? (
          <Label
            x={margin}
            y={capsY}
            width={Math.max(0, width - margin * 2)}
            height={capsHeight}
            horizontalAlign="center"
            text="Caps Lock is on"
            fontSize={12}
            fontWeight="medium"
            color={palette.text}
          />
        ) : null}
        {chips}
        {powerAvailable ? (
          <IconButton
            x={powerX}
            y={footY}
            width={FOOT_HEIGHT * ui}
            height={FOOT_HEIGHT * ui}
            variant="ghost"
            selected={props.powerMenuOpen}
            focusId={LOCK_FOCUS.power}
            tooltip={props.powerMenuOpen ? undefined : "Power"}
            tooltipPlacement="top"
            size="large"
            icon={(style) => <Icon name="power" size={style.size} color={style.color} />}
            onPress={() => props.onPowerMenu(!props.powerMenuOpen)}
          />
        ) : null}
        {powerAvailable && props.powerMenuOpen ? (
          <PowerMenu
            x={Math.max(margin, powerX + FOOT_HEIGHT * ui - menuWidth)}
            y={footY - 8 * ui}
            width={menuWidth}
            view={view}
            onAction={props.onAction}
          />
        ) : null}
      </Group>
    </Surface>
  );
}
