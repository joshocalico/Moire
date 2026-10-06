/** Restricted source fixture; no account discovery, native authentication or user desktop. */
import React, { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Backdrop,
  BrandMark,
  Button,
  Checkbox,
  Column,
  FocusScope,
  Label,
  OverlayHost,
  Popover,
  ScrollColumn,
  Surface,
  TextField,
  createSilkBackdrop,
  getUiScaleFactor,
  usePalette,
  type RetainedMotionAdmission,
  type WindowSize,
} from "@moire/ui";
import type { LoginActions, LoginUiSnapshot } from "./types";

export type LoginFixtureViewProps = WindowSize &
  Readonly<{
    snapshot: LoginUiSnapshot;
    actions: LoginActions;
    now?: Date;
    backdropAdmission?: RetainedMotionAdmission;
  }>;

type LoginState = LoginUiSnapshot["state"];
type InputState = Extract<LoginState, { kind: "ready" | "prompt" }>;
function identity(snapshot: LoginUiSnapshot): string {
  const state = snapshot.state;
  const catalog = `${snapshot.selection.id}:${snapshot.selection.generation}`;
  if (!snapshot.active) return `inactive:${catalog}`;
  if (state.kind === "ready")
    return `${catalog}:ready:${state.greeter.id}:${state.greeter.generation}`;
  if (state.kind === "prompt")
    return `${catalog}:${state.selection.id}:${state.selection.generation}:${state.attemptId}:${state.prompt.id}:${state.prompt.style}:${state.account}`;
  if (state.kind === "authenticating")
    return `${catalog}:${state.kind}:${state.attemptId}:${state.selection.id}:${state.selection.generation}:${state.account}`;
  if (state.kind === "retiring-greeter" || state.kind === "starting-session")
    return `${catalog}:${state.kind}:${state.attemptId}`;
  return `${catalog}:${state.kind}`;
}
function stateMessage(state: LoginState): string {
  switch (state.kind) {
    case "ready":
      return state.message || "Enter a synthetic account to test the configured session.";
    case "prompt":
      return state.prompt.message;
    case "authenticating":
      return "Waiting for the fixture broker…";
    case "retiring-greeter":
      return "Closing the fixture greeter…";
    case "starting-session":
      return "Waiting for the fixture session…";
    case "running":
      return "Fixture session observed. This view does not establish an authenticated desktop.";
    case "stopping":
      return "Waiting for fixture cleanup…";
    case "blocked":
      return state.message;
    case "inactive":
      return "Login fixture is inactive.";
  }
}

/** Each identity gets a new private draft. An old mounted handler cannot target newer identities. */
function LoginInput(props: {
  width: number;
  height: number;
  state: InputState;
  snapshot: LoginUiSnapshot;
  actions: LoginActions;
  isCurrent: () => boolean;
}): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
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
  const clear = () => {
    privateDraft.current = "";
    setDraft("");
  };
  const invoke = (action: () => Promise<void>) => {
    sent.current = true;
    setConsumed(true);
    clear();
    void action().catch(() => {
      if (live.current && props.isCurrent()) {
        setFailed(true);
        if (props.state.kind === "ready") {
          sent.current = false;
          setConsumed(false);
        }
      }
    });
  };
  const cancel = () => {
    if (!live.current || !props.isCurrent() || cancelled.current || props.state.kind !== "prompt")
      return;
    cancelled.current = true;
    const attemptId = props.state.attemptId;
    invoke(() => props.actions.cancel(attemptId));
  };
  const submit = () => {
    if (!enabled()) return;
    const value = privateDraft.current;
    if (props.state.kind === "ready") {
      if (!value.trim()) return;
      const request = {
        greeter: props.state.greeter,
        account: value,
        sessionId: props.snapshot.selection.id,
        catalogGeneration: props.snapshot.selection.generation,
      };
      invoke(() => props.actions.begin(request));
    } else {
      const request = {
        attemptId: props.state.attemptId,
        promptId: props.state.prompt.id,
        response:
          props.state.prompt.style === "info" || props.state.prompt.style === "error"
            ? null
            : value,
      };
      invoke(() => props.actions.answer(request));
    }
  };
  const prompt = props.state.kind === "prompt" ? props.state.prompt : null;
  const entry = !prompt || prompt.style === "visible" || prompt.style === "secret";
  return (
    <FocusScope width={props.width} height={props.height} trap={!!prompt} onEscape={cancel}>
      <Surface width={props.width} height={props.height} fill={0x00000000}>
        {prompt && (
          <Button
            x={0}
            y={(entry ? 58 : 0) * ui}
            width={(props.width - 12 * ui) / 2}
            height={42 * ui}
            label="Cancel"
            focusId="login:cancel"
            autoFocus
            disabled={cancelled.current}
            onPress={cancel}
          />
        )}
        {entry && (
          <TextField
            key={`${consumed ? "held" : "editing"}:${failed ? "retry" : "initial"}`}
            x={0}
            y={0}
            width={props.width}
            height={46 * ui}
            value={draft}
            password={prompt?.style === "secret"}
            autoFocus={!prompt}
            placeholder={
              prompt
                ? prompt.style === "secret"
                  ? "Secret response"
                  : "Visible response"
                : "Synthetic account"
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
          x={prompt ? (props.width + 12 * ui) / 2 : 0}
          y={(entry ? 58 : 0) * ui}
          width={prompt ? (props.width - 12 * ui) / 2 : props.width}
          height={42 * ui}
          variant="primary"
          label={
            consumed ? "Waiting…" : prompt ? (entry ? "Send response" : "Acknowledge") : "Sign in"
          }
          focusId={prompt ? "login:answer" : "login:begin"}
          disabled={consumed || (!prompt && !draft.trim())}
          onPress={submit}
        />
        {failed && (
          <Label
            x={0}
            y={112 * ui}
            width={props.width}
            text={
              props.state.kind === "ready"
                ? "Fixture request failed. Enter the synthetic account to try again."
                : "Fixture request failed. Cancel or wait for a fresh attempt."
            }
            color={pal.muted}
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
  attemptId: Extract<LoginState, { kind: "authenticating" }>["attemptId"];
  actions: LoginActions;
  isCurrent: () => boolean;
}): ReactNode {
  const [consumed, setConsumed] = useState(false),
    sent = useRef(false);
  const live = useRef(true);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const cancel = () => {
    if (!live.current || sent.current || !props.isCurrent()) return;
    sent.current = true;
    setConsumed(true);
    void props.actions.cancel(props.attemptId).catch(() => {});
  };
  return (
    <FocusScope width={props.width} height={48 * getUiScaleFactor()} onEscape={cancel}>
      <Button
        width={props.width}
        label="Cancel"
        focusId="login:cancel"
        autoFocus
        disabled={consumed}
        onPress={cancel}
      />
    </FocusScope>
  );
}

export function LoginFixtureView(props: LoginFixtureViewProps): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
  const snapshot = props.snapshot,
    state = snapshot.state;
  const readyRevision = useRef({ state, number: 0 });
  if (state !== readyRevision.current.state) {
    readyRevision.current = { state, number: readyRevision.current.number + 1 };
  }
  const currentIdentity =
      identity(snapshot) +
      (state.kind === "ready" ? `:ready-revision:${readyRevision.current.number}` : ""),
    latestIdentity = useRef(currentIdentity);
  latestIdentity.current = currentIdentity;
  const [accessibilityIdentity, setAccessibilityIdentity] = useState<string | null>(null);
  useLayoutEffect(() => {
    setAccessibilityIdentity(null);
  }, [currentIdentity]);
  const silk = useMemo(
    () =>
      createSilkBackdrop({
        variant: "greeter",
        palette: {
          background: pal.bg,
          filament: pal.accent,
          highlight: pal.muted,
        },
      }),
    [pal.bg, pal.accent, pal.muted],
  );
  const narrow = props.width < 700 * ui;
  const margin = Math.min(80 * ui, Math.max(20 * ui, props.width * 0.063));
  const formWidth = Math.max(0, Math.min(440 * ui, props.width - margin * 2));
  const formY = (narrow ? 140 : 220) * ui;
  const footerHeight = 74 * ui;
  const inputHeight = 160 * ui;
  const matchingCatalog =
    state.kind !== "prompt" ||
    (state.selection.id === snapshot.selection.id &&
      state.selection.generation === snapshot.selection.generation);
  const inputState =
    snapshot.active && matchingCatalog && (state.kind === "ready" || state.kind === "prompt")
      ? state
      : null;
  const accessibility = {
    x: props.width - margin - 140 * ui,
    y: props.height - 58 * ui,
    width: 140 * ui,
    height: 40 * ui,
  };
  const popupWidth = Math.min(350 * ui, props.width - 24 * ui),
    popupHeight = 208 * ui;
  const now = props.now ?? new Date();
  return (
    <Surface width={props.width} height={props.height} fill={pal.surface} clip>
      <Backdrop
        width={props.width}
        height={props.height}
        source={silk}
        reducedMotion={!snapshot.active || snapshot.motion.reducedMotion}
        admission={props.backdropAdmission}
      />
      <FocusScope width={props.width} height={props.height} active={snapshot.active} trap={false}>
        <OverlayHost width={props.width} height={props.height}>
          <BrandMark x={margin} y={60 * ui} width={210 * ui} height={66 * ui} />
          {!narrow && (
            <Label
              x={props.width - margin - 240 * ui}
              y={65 * ui}
              width={240 * ui}
              height={40 * ui}
              text={new Intl.DateTimeFormat(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              }).format(now)}
              fontSize={27}
            />
          )}
          <ScrollColumn
            x={margin}
            y={formY}
            width={formWidth}
            height={Math.max(0, props.height - footerHeight - formY)}
            gap={10 * ui}
            smooth={false}
            fill={0x00000000}
          >
            <Label
              width={formWidth}
              text="Login fixture"
              fontSize={narrow ? 26 : 32}
              fontWeight="medium"
              wrap
            />
            <Label width={formWidth} text={snapshot.selection.label} fontSize={16} wrap />
            <Label
              width={formWidth}
              text={stateMessage(state)}
              fontSize={14}
              color={pal.muted}
              wrap
            />
            {snapshot.message && snapshot.message !== stateMessage(state) && (
              <Label
                width={formWidth}
                text={snapshot.message}
                fontSize={12}
                color={pal.muted}
                wrap
              />
            )}
            {inputState && (
              <Surface width={formWidth} height={inputHeight} fill={0x00000000}>
                <LoginInput
                  key={currentIdentity}
                  width={formWidth}
                  height={inputHeight}
                  state={inputState}
                  snapshot={snapshot}
                  actions={props.actions}
                  isCurrent={() => latestIdentity.current === currentIdentity}
                />
              </Surface>
            )}
            {snapshot.active && state.kind === "authenticating" && (
              <Surface width={formWidth} height={48 * ui} fill={0x00000000}>
                <WaitingCancel
                  key={currentIdentity}
                  width={formWidth}
                  attemptId={state.attemptId}
                  actions={props.actions}
                  isCurrent={() => latestIdentity.current === currentIdentity}
                />
              </Surface>
            )}
          </ScrollColumn>
          <Label
            x={margin}
            y={props.height - 54 * ui}
            width={Math.max(0, props.width - margin * 2 - 156 * ui)}
            height={36 * ui}
            text={
              narrow ? "Source CPU fixture" : "Source CPU fixture · Tab to move · Escape to cancel"
            }
            fontSize={11}
            color={pal.muted}
            wrap
          />
          {snapshot.active && state.kind !== "inactive" && (
            <Button
              {...accessibility}
              label="Accessibility"
              variant="ghost"
              focusId="login:accessibility"
              disabled={
                !snapshot.active ||
                state.kind === "retiring-greeter" ||
                state.kind === "starting-session" ||
                state.kind === "blocked" ||
                state.kind === "running" ||
                state.kind === "stopping"
              }
              onPress={() => setAccessibilityIdentity(currentIdentity)}
            />
          )}
          <Popover
            open={
              accessibilityIdentity === currentIdentity &&
              snapshot.active &&
              (state.kind === "ready" || state.kind === "prompt" || state.kind === "authenticating")
            }
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
                label="Reduce motion"
                checked={snapshot.motion.reducedMotion}
                disabled={snapshot.motion.status === "saving"}
                width={popupWidth - 40 * ui}
                height={36 * ui}
                autoFocus
                onChange={(value) => {
                  if (latestIdentity.current === currentIdentity)
                    void props.actions.saveReducedMotion(value).catch(() => {});
                }}
              />
              <Label
                width={popupWidth - 40 * ui}
                text={
                  snapshot.motion.status === "failed"
                    ? "Could not save. Try the preference again."
                    : snapshot.motion.status === "saving"
                      ? "Saving fixture preference…"
                      : snapshot.motion.status === "saved"
                        ? "Saved for this fixture."
                        : "Disposable fixture preference. CPU and unknown rendering stay still."
                }
                fontSize={12}
                color={pal.muted}
                wrap
              />
            </Column>
          </Popover>
        </OverlayHost>
      </FocusScope>
    </Surface>
  );
}
