/**
 * The secure prompt, drawn by the compositor over its obscured wallpaper with no window beside
 * it: the system badge, what is asked and by whom, who signs, the answer as dots, and the
 * choices. Also the verification key's notice for when no request is open.
 *
 * Presentation only. The compositor owns the request and the answer; this sees the answer's
 * length and the check's state, and reports choices. Every sentence about the check is fixed
 * here: nothing from the helper or PAM is shown.
 */
import React, { type ReactNode } from "react";
import {
  Avatar,
  Button,
  Icon,
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
import type { SecurePromptAction, SecurePromptView } from "./types";

export type SecurePromptProps = Readonly<{
  width: number;
  height: number;
  view: SecurePromptView;
  /** "Use another administrator" was opened. */
  chooserOpen: boolean;
  detailsOpen: boolean;
  onChooser(open: boolean): void;
  onDetails(open: boolean): void;
  onAction(action: SecurePromptAction): void;
}>;

/** Focus ids, shared with the pointer dispatch and smokes. */
export const SECURE_PROMPT_FOCUS = {
  cancel: "secure-prompt:cancel",
  submit: "secure-prompt:submit",
  allow: "secure-prompt:allow",
  deny: "secure-prompt:deny",
  chooser: "secure-prompt:chooser",
  details: "secure-prompt:details",
  identity: (index: number) => `secure-prompt:identity:${index}`,
  previous: "secure-prompt:identity:previous",
  next: "secure-prompt:identity:next",
} as const;

export const SECURE_PROMPT_TEXT = {
  administrator: "An administrator's password is needed",
  another: "Use another administrator",
  wrong: "That password didn't work. Try again.",
  throttled: "Too many attempts. Try again in a minute.",
  unavailable: "The password can't be checked right now.",
  checking: "Checking…",
  capsLock: "Caps Lock is on",
  hint: "Press Super+Escape to check that this is a system request.",
  verified: "Verified: this request comes from the system.",
  notice: "No system password request is open",
} as const;

const CARD_WIDTH = 440;
const FIELD_HEIGHT = 44;
const DOT = 9;
const DOT_GAP = 7;
const ROW_HEIGHT = 36;
const BUTTON_HEIGHT = 36;
const DETAIL_HEIGHT = 20;
/**
 * How tightly the card is laid out (unscaled pixels), roomiest first. The last two replace the
 * list of administrators with a one-row stepper; the last also drops the hint.
 */
const DENSITIES = [
  { pad: 24, badge: 52, gap: 6, headlineLines: 4, stepper: false, footer: true },
  { pad: 18, badge: 40, gap: 5, headlineLines: 3, stepper: false, footer: true },
  { pad: 14, badge: 32, gap: 4, headlineLines: 2, stepper: true, footer: true },
  { pad: 12, badge: 28, gap: 3, headlineLines: 1, stepper: true, footer: false },
] as const;
const ENTRANCE_MS = 220;
const SHAKE_MS = 380;
const PULSE_MS = 700;

export function securePromptMessage(view: SecurePromptView): string {
  switch (view.phase) {
    case "checking":
      return SECURE_PROMPT_TEXT.checking;
    case "wrong":
      return SECURE_PROMPT_TEXT.wrong;
    case "throttled":
      return SECURE_PROMPT_TEXT.throttled;
    case "unavailable":
      return SECURE_PROMPT_TEXT.unavailable;
    default:
      return view.capsLock && view.kind === "password" ? SECURE_PROMPT_TEXT.capsLock : "";
  }
}

/** Advisory: the program the kernel says asked, and the window it came from. */
export function securePromptRequester(view: SecurePromptView): string {
  const requester = view.requester;
  if (!requester?.name) return "Requested by an unknown program";
  return (
    `Requested by ${requester.name}` +
    (requester.via ? `, from ${requester.via}` : "") +
    (requester.x11 ? " · runs under X11" : "")
  );
}

/** One dot per typed character, then the caret; the newest dots when they do not all fit. */
function AnswerField(props: { width: number; view: SecurePromptView }): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const { view } = props;
  const height = FIELD_HEIGHT * ui;
  const error =
    view.phase === "wrong" || view.phase === "unavailable" || view.phase === "throttled";
  const stroke = error
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
          y={(height - 20 * ui) / 2}
          width={Math.max(1, 2 * ui)}
          height={20 * ui}
          fill={palette.accent}
        />
      ) : null}
    </Surface>
  );
}

/** Who signs, when there is nothing to choose: their circle and full name. */
function IdentityLine(props: { y: number; width: number; name: string }): ReactNode {
  const ui = getUiScaleFactor();
  const avatar = 26;
  const gap = 8 * ui;
  const text = measureWrappedText(props.name, props.width, { fontSize: 14, fontWeight: "medium" });
  const nameWidth = Math.min(text.width + 2 * ui, props.width - avatar * ui - gap);
  const x = (props.width - (avatar * ui + gap + nameWidth)) / 2;
  return (
    <Surface y={props.y} width={props.width} height={ROW_HEIGHT * ui} fill={0}>
      <Avatar x={x} y={((ROW_HEIGHT - avatar) * ui) / 2} name={props.name} size={avatar} />
      <Label
        x={x + avatar * ui + gap}
        y={0}
        width={nameWidth}
        height={ROW_HEIGHT * ui}
        verticalAlign="center"
        text={props.name}
        fontSize={14}
        fontWeight="medium"
        overflow="ellipsis"
        maxLines={1}
      />
    </Surface>
  );
}

function identityColumns(count: number): number {
  return count > 4 ? 2 : 1;
}

function identityListHeight(count: number): number {
  return Math.ceil(count / identityColumns(count)) * ROW_HEIGHT * getUiScaleFactor();
}

/** The administrators who may sign, by full name; two columns past four. */
function IdentityList(props: {
  y: number;
  width: number;
  view: SecurePromptView;
  onAction(action: SecurePromptAction): void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const theme = useWidgetTheme();
  const root = theme.recipes.button.ghost.medium.root;
  const { identities, selected } = props.view;
  const columns = identityColumns(identities.length);
  const gap = 8 * ui;
  const cell = (props.width - gap * (columns - 1)) / columns;
  const rowHeight = ROW_HEIGHT * ui;
  const avatar = 24;
  return (
    <Surface
      y={props.y}
      width={props.width}
      height={identityListHeight(identities.length)}
      fill={0}
    >
      {identities.map((identity, index) => {
        const chosen = index === selected;
        return (
          <Pressable
            key={identity.account}
            x={(index % columns) * (cell + gap)}
            y={Math.floor(index / columns) * rowHeight}
            width={cell}
            height={rowHeight - 4 * ui}
            radius={9 * ui}
            fill={chosen ? resolveStatefulStyle(root, "hover").fill : 0}
            hoverFill={resolveStatefulStyle(root, "hover").fill}
            pressedFill={resolveStatefulStyle(root, "pressed").fill}
            stroke={chosen ? palette.accent : undefined}
            strokeWidth={chosen ? Math.max(1, 1.5 * ui) : undefined}
            disabled={props.view.phase === "checking"}
            focusId={SECURE_PROMPT_FOCUS.identity(index)}
            onPress={() => props.onAction({ type: "identity", index })}
          >
            <Avatar
              x={8 * ui}
              y={(rowHeight - 4 * ui - avatar * ui) / 2}
              name={identity.displayName}
              size={avatar}
            />
            <Label
              x={(8 + avatar + 8) * ui}
              y={0}
              width={Math.max(0, cell - (8 + avatar + 8 + 8) * ui)}
              height={rowHeight - 4 * ui}
              verticalAlign="center"
              text={identity.displayName}
              fontSize={13}
              fontWeight={chosen ? "medium" : "regular"}
              overflow="ellipsis"
              maxLines={1}
            />
          </Pressable>
        );
      })}
    </Surface>
  );
}

/** Where the list does not fit: the chosen administrator between previous and next. */
function IdentityStepper(props: {
  y: number;
  width: number;
  view: SecurePromptView;
  onAction(action: SecurePromptAction): void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const theme = useWidgetTheme();
  const root = theme.recipes.button.ghost.medium.root;
  const { identities, selected, phase } = props.view;
  const button = 28 * ui;
  const step = (focusId: string, icon: "chevron-left" | "chevron-right", index: number) => (
    <Pressable
      x={icon === "chevron-left" ? 0 : props.width - button}
      y={(ROW_HEIGHT * ui - button) / 2}
      width={button}
      height={button}
      radius={button / 2}
      fill={0}
      hoverFill={resolveStatefulStyle(root, "hover").fill}
      pressedFill={resolveStatefulStyle(root, "pressed").fill}
      disabled={phase === "checking" || index < 0 || index >= identities.length}
      focusId={focusId}
      onPress={() => props.onAction({ type: "identity", index })}
    >
      <Surface
        x={(button - 16 * ui) / 2}
        y={(button - 16 * ui) / 2}
        width={16 * ui}
        height={16 * ui}
        fill={0}
      >
        <Icon name={icon} size={16 * ui} color={palette.muted} symbolic />
      </Surface>
    </Pressable>
  );
  return (
    <Surface y={props.y} width={props.width} height={ROW_HEIGHT * ui} fill={0}>
      {step(SECURE_PROMPT_FOCUS.previous, "chevron-left", selected - 1)}
      <Group
        x={button + 6 * ui}
        y={0}
        width={props.width - (button + 6 * ui) * 2}
        height={ROW_HEIGHT * ui}
      >
        <IdentityLine
          y={0}
          width={props.width - (button + 6 * ui) * 2}
          name={identities[selected]?.displayName ?? ""}
        />
      </Group>
      {step(SECURE_PROMPT_FOCUS.next, "chevron-right", selected + 1)}
    </Surface>
  );
}

/** A quiet text control: "Use another administrator", "Details". */
function QuietLink(props: {
  y: number;
  width: number;
  text: string;
  chevron?: "chevron-down" | "chevron-up";
  focusId: string;
  onPress(): void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const theme = useWidgetTheme();
  const root = theme.recipes.button.ghost.medium.root;
  const height = 28 * ui;
  const icon = props.chevron ? 14 * ui + 4 * ui : 0;
  const text = measureWrappedText(props.text, props.width, { fontSize: 13 }).width;
  const width = Math.min(props.width, text + icon + 24 * ui);
  return (
    <Pressable
      x={(props.width - width) / 2}
      y={props.y}
      width={width}
      height={height}
      radius={8 * ui}
      fill={0}
      hoverFill={resolveStatefulStyle(root, "hover").fill}
      pressedFill={resolveStatefulStyle(root, "pressed").fill}
      focusId={props.focusId}
      onPress={props.onPress}
    >
      <Label
        x={12 * ui}
        y={0}
        width={width - 24 * ui - icon}
        height={height}
        verticalAlign="center"
        text={props.text}
        fontSize={13}
        color={palette.muted}
        maxLines={1}
      />
      {props.chevron ? (
        <Surface
          x={width - 12 * ui - 14 * ui}
          y={(height - 14 * ui) / 2}
          width={14 * ui}
          height={14 * ui}
          fill={0}
        >
          <Icon name={props.chevron} size={14 * ui} color={palette.muted} symbolic />
        </Surface>
      ) : null}
    </Pressable>
  );
}

export function SecurePrompt(props: SecurePromptProps): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const theme = useWidgetTheme();
  const dialog = theme.recipes.dialog.medium.surface;
  const { view, width, height } = props;
  const reduced = view.reducedMotion;
  const entrance = useAnimatedValue(1, {
    initialValue: reduced ? 1 : 0,
    duration: reduced ? 0 : ENTRANCE_MS,
    easing: "ease-out",
  });
  // The field shakes once per rejected answer; reduce motion keeps it still (the colour says it).
  const shake = useAnimatedValue(view.failures, {
    initialValue: view.failures,
    duration: reduced ? 0 : SHAKE_MS,
    easing: "linear",
  });
  // The badge's ring flashes once per press of the verification key.
  const pulse = useAnimatedValue(view.verifications, {
    initialValue: view.verifications,
    duration: reduced ? 0 : PULSE_MS,
    easing: "ease-out",
  });
  const password = view.kind === "password";
  const margin = 16 * ui;
  const cardWidth = Math.max(0, Math.min(CARD_WIDTH * ui, width - margin * 2));
  const several = password && view.identities.length > 1;
  const listed = several && (view.needsAdministrator || props.chooserOpen);
  const signer = view.identities[view.selected]?.displayName ?? "";
  const title = view.headline || "Authentication is required";
  const requester = securePromptRequester(view);
  const message = securePromptMessage(view);
  const errorTone =
    view.phase === "wrong" || view.phase === "unavailable" || view.phase === "throttled";
  const details = props.detailsOpen ? view.details : [];
  const footer = view.pulsing ? SECURE_PROMPT_TEXT.verified : SECURE_PROMPT_TEXT.hint;

  /** The card laid out at one density. */
  const arrange = (density: (typeof DENSITIES)[number]) => {
    const pad = density.pad * ui;
    const gap = density.gap * ui;
    const inner = Math.max(0, cardWidth - pad * 2);
    const badge = density.badge * ui;
    const headline = measureWrappedText(title, inner, { fontSize: 17, fontWeight: "medium" });
    const headlineLines = Math.min(headline.lines.length, density.headlineLines);
    const headlineHeight = headlineLines * headline.lineHeight;
    const requesterText = measureWrappedText(requester, inner, { fontSize: 13 });
    const requesterLines = Math.min(requesterText.lines.length, density.headlineLines > 1 ? 2 : 1);
    const requesterHeight = requesterLines * requesterText.lineHeight;
    const footerText = measureWrappedText(footer, inner, { fontSize: 11 });
    const footerHeight = Math.min(2, footerText.lines.length) * footerText.lineHeight;
    const stepper = listed && density.stepper;
    let y = pad;
    const place = (h: number, after = 0) => {
      const at = y;
      y += h + after;
      return at;
    };
    const badgeY = place(badge, gap * 2);
    const headlineY = place(headlineHeight, gap);
    const requesterY = place(requesterHeight, gap * 2.5);
    const administratorY = password && view.needsAdministrator ? place(20 * ui, gap) : null;
    const identityY = !password
      ? null
      : listed && !stepper
        ? place(identityListHeight(view.identities.length), gap)
        : place(ROW_HEIGHT * ui, several && !listed ? 0 : gap);
    const chooserY = several && !listed ? place(28 * ui, gap) : null;
    const fieldY = password ? place(FIELD_HEIGHT * ui, gap) : null;
    const messageY = password ? place(18 * ui, gap * 2) : null;
    const buttonsY = place(BUTTON_HEIGHT * ui, gap);
    const detailsY = view.details.length ? place(28 * ui, details.length ? 0 : gap) : null;
    const detailRowsY = details.length ? place(details.length * DETAIL_HEIGHT * ui, gap) : null;
    const waitingY = view.waiting > 0 && density.footer ? place(18 * ui, gap / 2) : null;
    const footerY = density.footer ? place(footerHeight, gap) : null;
    return {
      pad,
      inner,
      badge,
      headlineLines,
      headlineHeight,
      requesterLines,
      requesterHeight,
      footerHeight,
      stepper,
      badgeY,
      headlineY,
      requesterY,
      administratorY,
      identityY,
      chooserY,
      fieldY,
      messageY,
      buttonsY,
      detailsY,
      detailRowsY,
      waitingY,
      footerY,
      cardHeight: y - gap + pad,
    };
  };
  // The roomiest density that fits the output; on a small or heavily scaled one the list of
  // administrators becomes a stepper and, last, the hint goes.
  const room = height - margin * 2;
  let layout = arrange(DENSITIES[0]);
  for (const density of DENSITIES) {
    layout = arrange(density);
    if (layout.cardHeight <= room) break;
  }
  const { pad, inner, badge, headlineLines, headlineHeight, requesterHeight, footerHeight } =
    layout;
  const { badgeY, headlineY, requesterY, administratorY, identityY, chooserY, fieldY } = layout;
  const { messageY, buttonsY, detailsY, detailRowsY, waitingY, footerY, cardHeight } = layout;
  const cardX = Math.round((width - cardWidth) / 2);
  const cardY = Math.round(Math.max(margin, (height - cardHeight) / 2));
  const buttonGap = 10 * ui;
  const buttonWidth = (inner - buttonGap) / 2;
  const labelWidth = Math.min(110 * ui, inner * 0.36);
  const ring = badge + 14 * ui;
  return (
    <Surface width={width} height={height} fill={0x00000000}>
      <Group
        width={width}
        height={height}
        opacity={entrance}
        translateY={{ get: () => Math.round((1 - entrance.get()) * 12 * ui) }}
      >
        <Surface
          x={cardX}
          y={cardY}
          width={cardWidth}
          height={cardHeight}
          radius={Math.max(dialog.radius ?? 0, 18 * ui)}
          fill={dialog.fill}
          stroke={dialog.stroke ?? palette.borderSubtle}
          strokeWidth={dialog.strokeWidth}
          elevation="high"
        >
          <Surface
            x={(cardWidth - ring) / 2}
            y={badgeY - (ring - badge) / 2}
            width={ring}
            height={ring}
            radius={ring / 2}
            fill={0}
            stroke={palette.accent}
            strokeWidth={Math.max(1, 2 * ui)}
            opacity={{
              get: () => {
                const progress = 1 - (view.verifications - pulse.get());
                const flash = progress > 0 && progress < 1 ? 1 - progress : 0;
                return Math.max(view.pulsing ? 1 : 0, flash);
              },
            }}
          />
          <Surface
            x={(cardWidth - badge) / 2}
            y={badgeY}
            width={badge}
            height={badge}
            radius={badge / 2}
            fill={palette.accent}
          >
            <Surface
              x={(badge - badge * 0.52) / 2}
              y={(badge - badge * 0.52) / 2}
              width={badge * 0.52}
              height={badge * 0.52}
              fill={0}
            >
              <Icon name="shield" size={badge * 0.52} color={0xffffffff} symbolic />
            </Surface>
          </Surface>
          <Label
            x={pad}
            y={headlineY}
            width={inner}
            height={headlineHeight}
            horizontalAlign="center"
            text={view.headline || "Authentication is required"}
            fontSize={17}
            fontWeight="medium"
            wrap
            maxLines={headlineLines}
            overflow="ellipsis"
          />
          <Label
            x={pad}
            y={requesterY}
            width={inner}
            height={requesterHeight}
            horizontalAlign="center"
            text={requester}
            fontSize={13}
            color={palette.muted}
            wrap
            maxLines={layout.requesterLines}
            overflow="ellipsis"
          />
          {administratorY !== null ? (
            <Label
              x={pad}
              y={administratorY}
              width={inner}
              height={20 * ui}
              horizontalAlign="center"
              verticalAlign="center"
              text={SECURE_PROMPT_TEXT.administrator}
              fontSize={13}
              fontWeight="medium"
              overflow="ellipsis"
              maxLines={1}
            />
          ) : null}
          {identityY !== null ? (
            <Group x={pad} y={0} width={inner} height={cardHeight}>
              {layout.stepper ? (
                <IdentityStepper
                  y={identityY}
                  width={inner}
                  view={view}
                  onAction={props.onAction}
                />
              ) : listed ? (
                <IdentityList y={identityY} width={inner} view={view} onAction={props.onAction} />
              ) : (
                <IdentityLine y={identityY} width={inner} name={signer} />
              )}
              {chooserY !== null ? (
                <QuietLink
                  y={chooserY}
                  width={inner}
                  text={SECURE_PROMPT_TEXT.another}
                  focusId={SECURE_PROMPT_FOCUS.chooser}
                  onPress={() => props.onChooser(true)}
                />
              ) : null}
            </Group>
          ) : null}
          {fieldY !== null ? (
            <Group
              x={pad}
              y={fieldY}
              width={inner}
              height={FIELD_HEIGHT * ui}
              translateX={{
                get: () => {
                  const progress = 1 - (view.failures - shake.get());
                  if (progress >= 1 || progress <= 0) return 0;
                  return Math.round(Math.sin(progress * Math.PI * 6) * (1 - progress) * 10 * ui);
                },
              }}
            >
              <AnswerField width={inner} view={view} />
            </Group>
          ) : null}
          {messageY !== null ? (
            <Label
              x={pad}
              y={messageY}
              width={inner}
              height={18 * ui}
              horizontalAlign="center"
              verticalAlign="center"
              text={message}
              fontSize={13}
              color={errorTone ? palette.danger : palette.muted}
              overflow="ellipsis"
              maxLines={1}
            />
          ) : null}
          <Button
            x={pad}
            y={buttonsY}
            width={buttonWidth}
            height={BUTTON_HEIGHT * ui}
            label={password ? "Cancel" : "Deny"}
            focusId={password ? SECURE_PROMPT_FOCUS.cancel : SECURE_PROMPT_FOCUS.deny}
            onPress={() => props.onAction({ type: password ? "cancel" : "deny" })}
          />
          <Button
            x={pad + buttonWidth + buttonGap}
            y={buttonsY}
            width={buttonWidth}
            height={BUTTON_HEIGHT * ui}
            label={password ? "Authenticate" : "Allow"}
            variant="primary"
            disabled={password && (view.length === 0 || view.phase === "checking")}
            focusId={password ? SECURE_PROMPT_FOCUS.submit : SECURE_PROMPT_FOCUS.allow}
            onPress={() => props.onAction({ type: password ? "submit" : "allow" })}
          />
          {detailsY !== null ? (
            <Group x={pad} y={0} width={inner} height={cardHeight}>
              <QuietLink
                y={detailsY}
                width={inner}
                text="Details"
                chevron={props.detailsOpen ? "chevron-up" : "chevron-down"}
                focusId={SECURE_PROMPT_FOCUS.details}
                onPress={() => props.onDetails(!props.detailsOpen)}
              />
              {detailRowsY !== null
                ? details.map((detail, index) => (
                    <Surface
                      key={index}
                      y={detailRowsY + index * DETAIL_HEIGHT * ui}
                      width={inner}
                      height={DETAIL_HEIGHT * ui}
                      fill={0}
                    >
                      <Label
                        width={labelWidth}
                        height={DETAIL_HEIGHT * ui}
                        verticalAlign="center"
                        text={detail.label}
                        fontSize={12}
                        color={palette.muted}
                        overflow="ellipsis"
                        maxLines={1}
                      />
                      <Label
                        x={labelWidth + 8 * ui}
                        width={Math.max(0, inner - labelWidth - 8 * ui)}
                        height={DETAIL_HEIGHT * ui}
                        verticalAlign="center"
                        text={detail.value}
                        fontSize={12}
                        overflow="ellipsis"
                        maxLines={1}
                      />
                    </Surface>
                  ))
                : null}
            </Group>
          ) : null}
          {waitingY !== null ? (
            <Label
              x={pad}
              y={waitingY}
              width={inner}
              height={18 * ui}
              horizontalAlign="center"
              verticalAlign="center"
              text={
                view.waiting === 1
                  ? "1 more request is waiting"
                  : `${view.waiting} more requests are waiting`
              }
              fontSize={12}
              color={palette.muted}
              maxLines={1}
            />
          ) : null}
          {footerY !== null ? (
            <Label
              x={pad}
              y={footerY}
              width={inner}
              height={footerHeight}
              horizontalAlign="center"
              text={footer}
              fontSize={11}
              fontWeight={view.pulsing ? "medium" : "regular"}
              color={view.pulsing ? palette.accent : palette.muted}
              wrap
              maxLines={2}
              overflow="ellipsis"
            />
          ) : null}
        </Surface>
      </Group>
    </Surface>
  );
}

/** The verification key's answer when nothing is asking. */
export function SecureNotice(props: { width: number; height: number }): ReactNode {
  const ui = getUiScaleFactor();
  const palette = usePalette();
  const theme = useWidgetTheme();
  const dialog = theme.recipes.dialog.medium.surface;
  const margin = 16 * ui;
  const icon = 22 * ui;
  const padX = 22 * ui;
  const gap = 12 * ui;
  const available = Math.max(0, props.width - margin * 2 - padX * 2 - icon - gap);
  const text = measureWrappedText(SECURE_PROMPT_TEXT.notice, available, {
    fontSize: 15,
    fontWeight: "medium",
  });
  const lines = Math.min(2, text.lines.length);
  const textHeight = lines * text.lineHeight;
  const cardWidth = padX * 2 + icon + gap + Math.min(available, text.width + 2 * ui);
  const cardHeight = Math.max(56 * ui, textHeight + 32 * ui);
  return (
    <Surface width={props.width} height={props.height} fill={0x00000000}>
      <Surface
        x={Math.round((props.width - cardWidth) / 2)}
        y={Math.round((props.height - cardHeight) / 2)}
        width={cardWidth}
        height={cardHeight}
        radius={Math.min(cardHeight / 2, 20 * ui)}
        fill={dialog.fill}
        stroke={dialog.stroke ?? palette.borderSubtle}
        strokeWidth={dialog.strokeWidth}
        elevation="high"
      >
        <Surface x={padX} y={(cardHeight - icon) / 2} width={icon} height={icon} fill={0}>
          <Icon name="shield" size={icon} color={palette.muted} symbolic />
        </Surface>
        <Label
          x={padX + icon + gap}
          y={(cardHeight - textHeight) / 2}
          width={cardWidth - padX * 2 - icon - gap}
          height={textHeight}
          text={SECURE_PROMPT_TEXT.notice}
          fontSize={15}
          fontWeight="medium"
          wrap
          maxLines={2}
          overflow="ellipsis"
        />
      </Surface>
    </Surface>
  );
}
