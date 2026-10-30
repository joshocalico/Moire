/** Presentation only. Stock greetd owns authentication and the native session. */
import React, { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Backdrop,
  BrandMark,
  Button,
  Checkbox,
  Column,
  FocusScope,
  Icon,
  Label,
  MenuItem,
  OverlayHost,
  Popover,
  Pressable,
  ScrollColumn,
  Surface,
  TextField,
  WidgetThemeProvider,
  getUiScaleFactor,
  useAnimatedValue,
  usePalette,
  useWidgetTheme,
  type WindowSize,
  type RetainedMotionAdmission,
} from "@moire/ui";
import { Group } from "@moire/react-host";
import type { AttemptId, PromptId, NativeGreeterController, NativeGreeterState } from "./types";
import type { LocalLoginUser, LocalUserProvider } from "./local-users";
import { useUserSelection } from "./user-selection";
import { nativeGreeterSilk } from "./silk";

export type NativeGreeterActions = Pick<NativeGreeterController, "begin" | "answer" | "cancel">;
export type NativeGreeterViewProps = WindowSize &
  Readonly<{
    state: NativeGreeterState;
    actions: NativeGreeterActions;
    sessionLabel?: string;
    now?: Date;
    admission?: RetainedMotionAdmission;
    reducedMotion?: boolean;
    onReducedMotionChange?: (value: boolean) => void;
    /** Trusted read-only provider. Omitted only by the preserved username-flow entry. */
    users?: LocalUserProvider;
    /** The compositor draws the backdrop scene beneath this (transparent) window. */
    compositorBackdrop?: boolean;
  }>;
type InputState = Extract<NativeGreeterState, { kind: "ready" | "prompt" }>;
function identity(state: NativeGreeterState): string {
  switch (state.kind) {
    case "ready":
      return `ready:${state.revision}`;
    case "prompt":
      return `${state.attemptId.value}:${state.promptId.value}:${state.style}`;
    case "authenticating":
    case "cancelling":
    case "launching":
      return `${state.kind}:${state.attemptId.value}`;
    case "launch-committed":
    case "unavailable":
      return state.kind;
  }
}
function message(state: NativeGreeterState): string {
  switch (state.kind) {
    case "ready":
      return state.message || "Enter your username to sign in.";
    case "prompt":
    case "unavailable":
      return state.message;
    case "authenticating":
      return "Waiting for authentication…";
    case "cancelling":
      return "Cancelling sign in…";
    case "launching":
      return "Starting your session…";
    case "launch-committed":
      return "Session launch accepted.";
  }
}

function NativeInput(props: {
  width: number;
  height: number;
  state: InputState;
  actions: NativeGreeterActions;
  isCurrent: () => boolean;
  onChangeUser?: () => void;
  passwordPrompt?: boolean;
}): ReactNode {
  const ui = getUiScaleFactor();
  const [draft, setDraft] = useState(""),
    [consumed, setConsumed] = useState(false);
  const [failed, setFailed] = useState(false);
  const privateDraft = useRef(""),
    live = useRef(true),
    sent = useRef(false),
    cancelled = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      privateDraft.current = "";
    };
  }, []);
  const enabled = () => live.current && props.isCurrent() && !sent.current;
  const invoke = (action: () => Promise<void>) => {
    sent.current = true;
    privateDraft.current = "";
    setDraft("");
    setConsumed(true);
    void action().catch(() => {
      if (!live.current || !props.isCurrent()) return;
      setFailed(true);
      if (props.state.kind === "ready") {
        sent.current = false;
        setConsumed(false);
      }
    });
  };
  const cancel = () => {
    if (!live.current || !props.isCurrent() || cancelled.current || props.state.kind !== "prompt")
      return;
    cancelled.current = true;
    const attemptId = props.state.attemptId;
    invoke(() => {
      if (props.onChangeUser) {
        props.onChangeUser();
        return Promise.resolve();
      }
      return props.actions.cancel(attemptId);
    });
  };
  const submit = () => {
    if (!enabled()) return;
    const value = privateDraft.current;
    const state = props.state;
    if (state.kind === "ready") {
      if (!value.trim()) return;
      invoke(() => props.actions.begin(value, state.revision));
    } else {
      const response = state.style === "info" || state.style === "error" ? null : value;
      invoke(() => props.actions.answer(state.attemptId, state.promptId, response));
    }
  };
  const prompt = props.state.kind === "prompt" ? props.state : null;
  const entry = !prompt || prompt.style === "visible" || prompt.style === "secret";
  return (
    <FocusScope
      width={props.width}
      height={props.height}
      trap={!!prompt && !props.onChangeUser}
      onEscape={cancel}
    >
      <Surface width={props.width} height={props.height} fill={0x00000000}>
        {prompt && (
          <Button
            x={props.onChangeUser ? (props.width - 144 * ui) / 2 : 0}
            y={(props.onChangeUser ? (entry ? 108 : 50) : entry ? 58 : 0) * ui}
            width={props.onChangeUser ? 144 * ui : (props.width - 12 * ui) / 2}
            height={(props.onChangeUser ? 34 : 42) * ui}
            variant={props.onChangeUser ? "ghost" : "secondary"}
            leadingIcon={
              props.onChangeUser
                ? (style) => <Icon name="back" size={style.size} color={style.color} symbolic />
                : undefined
            }
            label={props.onChangeUser ? "Change user" : "Cancel"}
            focusId="native:cancel"
            autoFocus={!props.onChangeUser}
            disabled={cancelled.current}
            onPress={cancel}
          />
        )}
        {entry && (
          <TextField
            key={`${consumed ? "held" : "editing"}:${failed ? "retry" : "initial"}`}
            width={props.width}
            height={46 * ui}
            value={draft}
            password={prompt?.style === "secret"}
            autoFocus={!prompt || !!props.onChangeUser}
            placeholder={
              prompt
                ? prompt.style === "secret"
                  ? props.onChangeUser
                    ? props.passwordPrompt
                      ? "Password"
                      : "Authentication response"
                    : "Secret response"
                  : "Visible response"
                : "Username"
            }
            disabled={consumed}
            onChange={(value) => {
              if (!enabled()) return;
              privateDraft.current = value;
              setDraft(value);
            }}
            onSubmit={submit}
            onCancel={cancel}
          />
        )}
        <Button
          x={prompt && !props.onChangeUser ? (props.width + 12 * ui) / 2 : 0}
          y={(entry ? 58 : 0) * ui}
          width={prompt && !props.onChangeUser ? (props.width - 12 * ui) / 2 : props.width}
          height={42 * ui}
          variant="primary"
          label={
            consumed
              ? "Waiting…"
              : prompt
                ? entry
                  ? props.onChangeUser
                    ? props.passwordPrompt
                      ? "Sign in"
                      : "Continue"
                    : "Send response"
                  : "Acknowledge"
                : "Sign in"
          }
          focusId={prompt ? "native:answer" : "native:begin"}
          disabled={consumed || (!prompt && !draft.trim())}
          onPress={submit}
        />
        {failed && (
          <Label
            x={0}
            y={(props.onChangeUser ? 152 : 112) * ui}
            width={props.width}
            text={
              props.state.kind === "ready"
                ? "Enter a valid username to try again."
                : "Sign-in request unavailable. Cancel or wait for a fresh prompt."
            }
            fontSize={12}
            wrap
          />
        )}
      </Surface>
    </FocusScope>
  );
}
function WaitingCancel(props: {
  width: number;
  state: Extract<NativeGreeterState, { kind: "authenticating" }>;
  actions: NativeGreeterActions;
  isCurrent: () => boolean;
}): ReactNode {
  const [consumed, setConsumed] = useState(false),
    sent = useRef(false),
    live = useRef(true);
  useLayoutEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const cancel = () => {
    if (!live.current || sent.current || !props.isCurrent()) return;
    sent.current = true;
    setConsumed(true);
    void props.actions.cancel(props.state.attemptId).catch(() => {});
  };
  return (
    <FocusScope width={props.width} height={48 * getUiScaleFactor()} onEscape={cancel}>
      <Button
        width={props.width}
        label="Cancel"
        focusId="native:cancel"
        autoFocus
        disabled={consumed}
        onPress={cancel}
      />
    </FocusScope>
  );
}

function AccountInitial(props: { user: LocalLoginUser; size: number }): ReactNode {
  const pal = usePalette();
  return (
    <Surface width={props.size} height={props.size} radius={props.size / 2} fill={pal.accent}>
      <Label
        width={props.size}
        height={props.size}
        text={Array.from(props.user.displayName)[0]?.toUpperCase() ?? ""}
        horizontalAlign="center"
        verticalAlign="center"
        fontSize={(props.size / getUiScaleFactor()) * 0.5}
        color={0xffffffff}
        fontWeight="medium"
      />
    </Surface>
  );
}

function AccountChoice(props: {
  user: LocalLoginUser;
  width: number;
  autoFocus: boolean;
  onPress: () => void;
}): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette(),
    theme = useWidgetTheme();
  const avatarTheme = useMemo(
    () => ({
      ...theme,
      recipes: {
        ...theme.recipes,
        button: {
          ...theme.recipes.button,
          ghost: {
            ...theme.recipes.button.ghost,
            medium: {
              ...theme.recipes.button.ghost.medium,
              root: {
                ...theme.recipes.button.ghost.medium.root,
                base: { ...theme.recipes.button.ghost.medium.root.base, radius: 52 * ui },
              },
            },
          },
        },
      },
    }),
    [theme, ui],
  );
  return (
    <Pressable
      width={props.width}
      height={164 * ui}
      fill={0}
      hoverFill={0}
      pressedFill={0}
      focusable={false}
      onPress={props.onPress}
    >
      <WidgetThemeProvider theme={avatarTheme}>
        <Surface x={(props.width - 104 * ui) / 2} width={104 * ui} height={104 * ui} fill={0}>
          <Button
            width={104 * ui}
            height={104 * ui}
            label=""
            variant="ghost"
            focusId={`native:user:${props.user.username}`}
            autoFocus={props.autoFocus}
            onPress={props.onPress}
          />
          <Surface x={10 * ui} y={10 * ui} width={84 * ui} height={84 * ui} fill={0}>
            <AccountInitial user={props.user} size={84 * ui} />
          </Surface>
        </Surface>
      </WidgetThemeProvider>
      <Label
        y={117 * ui}
        width={props.width}
        height={25 * ui}
        text={props.user.displayName}
        horizontalAlign="center"
        fontSize={17}
        fontWeight="medium"
      />
      <Label
        y={143 * ui}
        width={props.width}
        height={20 * ui}
        text={props.user.username}
        horizontalAlign="center"
        fontSize={12}
        color={pal.muted}
      />
    </Pressable>
  );
}

/** One installed fixed session, never a discovered or caller-supplied launch command. */
function FixedDesktopChoice(props: {
  width: number;
  viewportWidth: number;
  viewportHeight: number;
}): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette(),
    theme = useWidgetTheme();
  const transparentTheme = useMemo(
    () => ({
      ...theme,
      recipes: {
        ...theme.recipes,
        button: {
          ...theme.recipes.button,
          ghost: {
            ...theme.recipes.button.ghost,
            medium: {
              ...theme.recipes.button.ghost.medium,
              root: {
                ...theme.recipes.button.ghost.medium.root,
                states: {
                  ...theme.recipes.button.ghost.medium.root.states,
                  hover: { fill: 0 },
                  pressed: { fill: 0 },
                },
              },
            },
          },
        },
      },
    }),
    [theme],
  );
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const width = Math.min(170 * ui, props.width);
  return (
    <Surface width={props.width} height={34 * ui} fill={0}>
      <WidgetThemeProvider theme={transparentTheme}>
        <Button
          x={(props.width - width) / 2}
          width={width}
          height={34 * ui}
          label="Moire Wayland"
          variant="ghost"
          focusId="native:desktop"
          onPress={(event) => {
            if (event) setAnchor({ x: event.x - event.localX, y: event.y - event.localY });
            setOpen(!open);
          }}
          trailingIcon={(style) => (
            <Icon
              name={open ? "chevron-up" : "chevron-down"}
              size={style.size}
              color={style.color}
              symbolic
            />
          )}
        />
      </WidgetThemeProvider>
      <Popover
        open={open && anchor !== null}
        viewportWidth={props.viewportWidth}
        viewportHeight={props.viewportHeight}
        anchor={{ x: anchor?.x ?? 0, y: anchor?.y ?? 0, width, height: 34 * ui }}
        width={220 * ui}
        height={50 * ui}
        modal={false}
        onDismiss={() => setOpen(false)}
      >
        <MenuItem
          x={5 * ui}
          y={5 * ui}
          width={210 * ui}
          height={40 * ui}
          label="Moire Wayland"
          autoFocus
          leading={
            <Label width={18 * ui} height={22 * ui} text="✓" fontSize={17} color={pal.text} />
          }
          onPress={() => setOpen(false)}
        />
      </Popover>
    </Surface>
  );
}

export function NativeGreeterView(props: NativeGreeterViewProps): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette(),
    state = props.state;
  const { selection, choose, changeUser, retry } = useUserSelection({
    state,
    actions: props.actions,
    provider: props.users,
  });
  const picked =
    selection.kind === "selected" || selection.kind === "checking" ? selection.user : null;
  const firstSecret = useRef<{ attemptId: AttemptId; promptId: PromptId } | null>(null);
  if (state.kind === "ready") firstSecret.current = null;
  else if (
    state.kind === "prompt" &&
    state.style === "secret" &&
    picked &&
    firstSecret.current?.attemptId !== state.attemptId
  )
    firstSecret.current = { attemptId: state.attemptId, promptId: state.promptId };
  const passwordPrompt =
    state.kind === "prompt" && firstSecret.current?.promptId === state.promptId;
  const currentIdentity = identity(state),
    latestIdentity = useRef(currentIdentity);
  latestIdentity.current = currentIdentity;
  const latestState = useRef(state);
  latestState.current = state;
  const [accessibilityIdentity, setAccessibilityIdentity] = useState<string | null>(null);
  const [highContrast, setHighContrast] = useState(false);
  useLayoutEffect(() => {
    setAccessibilityIdentity(null);
  }, [currentIdentity]);
  const silk = useMemo(
    () => nativeGreeterSilk({ bg: pal.bg, accent: pal.accent, muted: pal.muted }),
    [pal.bg, pal.accent, pal.muted],
  );
  // Over the compositor's scene the login rises in while the ribbon pours into the wave.
  const entering = props.compositorBackdrop === true && props.reducedMotion !== true;
  const entrance = useAnimatedValue(1, {
    initialValue: entering ? 0 : 1,
    duration: 1100,
    easing: "ease-out",
  });
  const entranceRise = {
    get: () => Math.round((1 - entrance.get()) * 14 * ui),
  };
  const narrow = props.width < 700 * ui;
  const margin = Math.min(80 * ui, Math.max(20 * ui, props.width * 0.063));
  const centered = !!props.users;
  const formWidth = Math.max(
    0,
    Math.min((centered ? (picked ? 320 : 520) : 440) * ui, props.width - margin * 2),
  );
  const formX = centered ? (props.width - formWidth) / 2 : margin;
  const formY = (centered ? (narrow ? 140 : picked ? 215 : 230) : narrow ? 140 : 220) * ui;
  const columns = Math.max(1, Math.min(3, Math.floor((formWidth + 48 * ui) / (204 * ui))));
  const interactive =
    state.kind === "ready" || state.kind === "prompt" || state.kind === "authenticating";
  const accessibility = {
    x: props.width - margin - 140 * ui,
    y: props.height - 58 * ui,
    width: 140 * ui,
    height: 40 * ui,
  };
  const popupWidth = Math.min(350 * ui, props.width - 24 * ui),
    popupHeight = (props.onReducedMotionChange ? 260 : 208) * ui;
  return (
    <Surface
      width={props.width}
      height={props.height}
      // Transparent over the compositor's scene; otherwise the greeter owns its ground.
      fill={props.compositorBackdrop ? 0x00000000 : pal.surface}
      clip
    >
      {!props.compositorBackdrop && (
        <Backdrop
          width={props.width}
          height={props.height}
          source={silk}
          motionStyle="wave"
          admission={props.admission}
          reducedMotion={props.reducedMotion ?? true}
        />
      )}
      <Group width={props.width} height={props.height} opacity={entrance} translateY={entranceRise}>
        <FocusScope width={props.width} height={props.height} active={interactive} trap={false}>
          <OverlayHost width={props.width} height={props.height}>
            <BrandMark
              x={centered ? (props.width - 112 * ui) / 2 : margin}
              y={(centered ? (narrow ? 70 : 128) : 60) * ui}
              width={(centered ? 112 : 210) * ui}
              height={(centered ? 36 : 66) * ui}
            />
            {!narrow && (
              <Label
                x={props.width - margin - (centered ? 140 : 240) * ui}
                y={(centered ? 40 : 65) * ui}
                width={(centered ? 140 : 240) * ui}
                height={(centered ? 28 : 40) * ui}
                horizontalAlign={centered ? "end" : "start"}
                text={new Intl.DateTimeFormat(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(props.now ?? new Date())}
                fontSize={centered ? 18 : 27}
                color={centered ? pal.muted : pal.text}
              />
            )}
            <ScrollColumn
              x={formX}
              y={formY}
              width={formWidth}
              height={Math.max(0, props.height - 74 * ui - formY)}
              gap={10 * ui}
              smooth={false}
              fill={0x00000000}
            >
              {centered && picked && (
                <Surface width={formWidth} height={76 * ui} fill={0}>
                  <Surface x={(formWidth - 76 * ui) / 2} width={76 * ui} height={76 * ui} fill={0}>
                    <AccountInitial user={picked} size={76 * ui} />
                  </Surface>
                </Surface>
              )}
              <Label
                width={formWidth}
                height={centered ? (picked ? 38 : 42) * ui : undefined}
                horizontalAlign={centered ? "center" : "start"}
                text={picked ? picked.displayName : props.users ? "Welcome to Moire" : "Sign in"}
                fontSize={centered ? (picked ? 27 : 28) : narrow ? 26 : 32}
                fontWeight="medium"
                wrap
              />
              {(!centered || picked) && (
                <Label
                  width={formWidth}
                  height={centered ? 22 * ui : undefined}
                  horizontalAlign={centered ? "center" : "start"}
                  text={
                    centered ? (picked?.username ?? "") : (props.sessionLabel ?? "Moire Wayland")
                  }
                  color={centered ? pal.muted : pal.text}
                  fontSize={centered ? 13 : 16}
                  wrap
                />
              )}
              {!(centered && passwordPrompt && state.kind === "prompt") && (
                <Label
                  width={formWidth}
                  horizontalAlign={centered ? "center" : "start"}
                  text={
                    selection.kind === "loading"
                      ? "Finding local users…"
                      : selection.kind === "checking"
                        ? "Checking account availability…"
                        : selection.kind === "changing"
                          ? "Cancelling sign in…"
                          : selection.kind === "unavailable"
                            ? "Local users are unavailable. Try again."
                            : selection.kind === "choosing"
                              ? selection.message ||
                                (state.kind === "ready" && state.message !== "Sign in"
                                  ? state.message
                                  : "") ||
                                (selection.users.length
                                  ? "Choose your account to sign in."
                                  : "No eligible local users are available.")
                              : picked && state.kind === "prompt" && state.style === "secret"
                                ? passwordPrompt
                                  ? `Enter your password for ${picked.username}.`
                                  : "Enter the additional authentication response."
                                : message(state)
                  }
                  fontSize={14}
                  color={highContrast ? pal.text : pal.muted}
                  wrap
                />
              )}
              {selection.kind === "choosing" &&
                Array.from({ length: Math.ceil(selection.users.length / columns) }, (_, row) => (
                  <Surface key={row} width={formWidth} height={164 * ui} fill={0}>
                    {selection.users
                      .slice(row * columns, (row + 1) * columns)
                      .map((user, index, users) => (
                        <Surface
                          key={user.username}
                          x={
                            (formWidth - (users.length * 156 + (users.length - 1) * 48) * ui) / 2 +
                            index * 204 * ui
                          }
                          width={156 * ui}
                          height={164 * ui}
                          fill={0}
                        >
                          <AccountChoice
                            user={user}
                            width={156 * ui}
                            autoFocus={row === 0 && index === 0}
                            onPress={() => choose(user)}
                          />
                        </Surface>
                      ))}
                  </Surface>
                ))}
              {selection.kind === "unavailable" && state.kind === "ready" && (
                <Button
                  width={formWidth}
                  label="Try again"
                  focusId="native:users-retry"
                  autoFocus
                  onPress={retry}
                />
              )}
              {(selection.kind === "legacy" || selection.kind === "selected") &&
                (state.kind === "ready" || state.kind === "prompt") && (
                  <Surface width={formWidth} height={(centered ? 146 : 160) * ui} fill={0x00000000}>
                    <NativeInput
                      key={currentIdentity}
                      width={formWidth}
                      height={(centered ? 146 : 160) * ui}
                      state={state}
                      actions={props.actions}
                      onChangeUser={selection.kind === "selected" ? changeUser : undefined}
                      passwordPrompt={passwordPrompt}
                      isCurrent={() =>
                        latestState.current === state && latestIdentity.current === currentIdentity
                      }
                    />
                  </Surface>
                )}
              {centered && interactive && (
                <FixedDesktopChoice
                  key={`desktop:${currentIdentity}`}
                  width={formWidth}
                  viewportWidth={props.width}
                  viewportHeight={props.height}
                />
              )}
              {(selection.kind === "legacy" || selection.kind === "selected") &&
                state.kind === "authenticating" && (
                  <WaitingCancel
                    key={currentIdentity}
                    width={formWidth}
                    state={state}
                    actions={props.actions}
                    isCurrent={() =>
                      latestState.current === state && latestIdentity.current === currentIdentity
                    }
                  />
                )}
            </ScrollColumn>
            <Label
              x={margin}
              y={props.height - 54 * ui}
              width={Math.max(0, props.width - margin * 2 - 156 * ui)}
              height={36 * ui}
              text={
                centered
                  ? (props.sessionLabel ?? "Moire Wayland")
                  : "Tab to move · Enter to submit · Escape to cancel"
              }
              fontSize={11}
              color={highContrast ? pal.text : pal.muted}
              wrap
            />
            {interactive && (
              <Button
                {...accessibility}
                label="Accessibility"
                variant="ghost"
                focusId="native:accessibility"
                onPress={() => setAccessibilityIdentity(currentIdentity)}
              />
            )}
            <Popover
              open={accessibilityIdentity === currentIdentity && interactive}
              viewportWidth={props.width}
              viewportHeight={props.height}
              width={popupWidth}
              height={popupHeight}
              anchor={accessibility}
              placement="top-end"
              modal
              onDismiss={() => setAccessibilityIdentity(null)}
            >
              <Column width={popupWidth} height={popupHeight} padding={20 * ui} gap={16 * ui}>
                <Label text="Accessibility" fontSize={18} fontWeight="medium" />
                <Checkbox
                  label="Stronger status text"
                  checked={highContrast}
                  width={popupWidth - 40 * ui}
                  height={36 * ui}
                  autoFocus
                  onChange={(value) => {
                    if (latestIdentity.current === currentIdentity) setHighContrast(value);
                  }}
                />
                {props.onReducedMotionChange && (
                  <Checkbox
                    label="Reduce motion"
                    checked={props.reducedMotion ?? true}
                    width={popupWidth - 40 * ui}
                    height={36 * ui}
                    onChange={(value) => {
                      if (latestIdentity.current === currentIdentity)
                        props.onReducedMotionChange?.(value);
                    }}
                  />
                )}
                <Label
                  width={popupWidth - 40 * ui}
                  text={
                    props.onReducedMotionChange
                      ? "These choices last only while this sign-in window is open."
                      : "Motion stays reduced. This choice lasts only while this sign-in window is open."
                  }
                  fontSize={12}
                  color={pal.muted}
                  wrap
                />
              </Column>
            </Popover>
          </OverlayHost>
        </FocusScope>
      </Group>
    </Surface>
  );
}
