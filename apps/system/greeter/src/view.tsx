import React, { useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import {
  Backdrop,
  createSilkBackdrop,
  BrandMark,
  Button,
  Checkbox,
  Column,
  FocusScope,
  Icon,
  Label,
  OverlayHost,
  Popover,
  Row,
  ScrollColumn,
  Separator,
  Surface,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
  type BackdropMotion,
  type RetainedMotionAdmission,
} from "@moire/ui";
import { SessionContinuation, type ContinuationState } from "./controller";

export type GreeterAppProps = WindowSize & {
  /** The existing session identity supplied by its owner, never a login choice. */
  username: string;
  onContinue: () => Promise<void>;
  reducedMotion: boolean;
  /** Session owner supplies lifecycle visibility; false suspends input and clock updates. */
  active?: boolean;
  reducedMotionBusy?: boolean;
  reducedMotionStatus?: string;
  /** Persist the existing user profile preference through the session owner. */
  onReducedMotionChange?: (value: boolean) => void;
  now?: Date;
  backdrop?: ReactNode;
  backdropMotion?: BackdropMotion;
  backdropAdmission?: RetainedMotionAdmission;
};

function useClock(fixed: Date | undefined, active: boolean): Date {
  const [now, setNow] = useState(() => fixed ?? new Date());
  useEffect(() => {
    if (fixed || !active) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [fixed, active]);
  return fixed ?? now;
}

export function GreeterApp(props: GreeterAppProps): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette(),
    now = useClock(props.now, props.active !== false);
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
  const callback = useRef(props.onContinue);
  callback.current = props.onContinue;
  const mounted = useRef(true);
  const [state, setState] = useState<ContinuationState>({ kind: "ready" });
  const [continuation] = useState(
    () =>
      new SessionContinuation(
        () => callback.current(),
        (next) => {
          if (mounted.current) setState(next);
        },
      ),
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const narrow = props.width < 560 * ui;
  const margin = Math.min(80 * ui, Math.max(24 * ui, props.width * 0.063));
  const headerHeight = (narrow ? 174 : 170) * ui;
  const footerHeight = 80 * ui;
  const contentHeight = Math.max(0, props.height - headerHeight - footerHeight);
  const formWidth = Math.min(420 * ui, props.width - margin * 2);
  const formY = headerHeight + Math.max(0, (contentHeight - 260 * ui) * 0.4);
  const busy = state.kind === "starting" || state.kind === "complete";
  const accessibility = {
    x: props.width - margin - 146 * ui,
    y: props.height - footerHeight + 12 * ui,
    width: 146 * ui,
    height: 40 * ui,
  };
  const popoverWidth = Math.min(360 * ui, props.width - 24 * ui);
  const popoverHeight = 204 * ui;
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    now,
  );
  return (
    <Surface width={props.width} height={props.height} fill={pal.surface} clip>
      {props.backdrop ?? (
        <Backdrop
          width={props.width}
          height={props.height}
          source={silk}
          reducedMotion={props.reducedMotion}
          motion={props.backdropMotion}
          admission={props.backdropAdmission}
        />
      )}
      <FocusScope
        width={props.width}
        height={props.height}
        active={props.active !== false}
        trap={false}
      >
        <OverlayHost width={props.width} height={props.height}>
          <BrandMark x={margin} y={72 * ui} width={210 * ui} height={66 * ui} />
          {narrow ? (
            <Label
              x={margin}
              y={143 * ui}
              width={formWidth}
              height={32 * ui}
              text={time}
              fontSize={15}
            />
          ) : (
            <Row
              x={props.width - margin - 430 * ui}
              y={38 * ui}
              width={430 * ui}
              height={40 * ui}
              gap={18 * ui}
              align="center"
              justify="end"
            >
              <Label text={date} fontSize={13} color={pal.muted} />
              <Separator width={ui} height={28 * ui} color={pal.muted} />
              <Label text={time} fontSize={27} />
            </Row>
          )}
          <ScrollColumn
            x={margin}
            y={formY}
            width={formWidth}
            height={Math.max(0, props.height - footerHeight - formY)}
            gap={(narrow ? 14 : 18) * ui}
            smooth={false}
            fill={0x00000000}
          >
            <Label text={props.username} fontSize={narrow ? 28 : 32} fontWeight="medium" wrap />
            <Label
              text="Continue to your Moire desktop."
              fontSize={narrow ? 14 : 15}
              color={pal.muted}
              wrap
            />
            <Button
              width={formWidth}
              height={(narrow ? 48 : 56) * ui}
              label={
                state.kind === "error"
                  ? "Try again"
                  : state.kind === "starting"
                    ? "Starting session…"
                    : state.kind === "complete"
                      ? "Session ready"
                      : "Start session"
              }
              variant="primary"
              fontSize={16}
              autoFocus
              focusId="greeter:start"
              disabled={busy}
              trailingIcon={(style) => (
                <Icon name="forward" symbolic size={20 * ui} color={style.color} />
              )}
              onPress={() => {
                void continuation.start();
              }}
            />
            <Label
              text={state.kind === "error" ? state.message : "Moire session"}
              fontSize={12}
              color={state.kind === "error" ? pal.accent : pal.muted}
              wrap
            />
          </ScrollColumn>
          <Label
            x={margin}
            y={props.height - footerHeight + 20 * ui}
            width={Math.max(
              0,
              props.width - margin * 2 - (props.onReducedMotionChange ? 164 : 0) * ui,
            )}
            height={24 * ui}
            text={narrow ? "Tab to move" : "Tab to move · Enter to activate"}
            fontSize={12}
            color={pal.muted}
            verticalAlign="center"
          />
          {props.onReducedMotionChange && (
            <Button
              {...accessibility}
              label="Accessibility"
              variant="ghost"
              focusId="greeter:accessibility"
              onPress={() => setAccessibilityOpen(true)}
            />
          )}
          <Popover
            open={accessibilityOpen}
            viewportWidth={props.width}
            viewportHeight={props.height}
            width={popoverWidth}
            height={popoverHeight}
            anchor={accessibility}
            placement="top-end"
            modal
            onDismiss={() => setAccessibilityOpen(false)}
          >
            <Column width={popoverWidth} height={popoverHeight} padding={20 * ui} gap={16 * ui}>
              <Label text="Accessibility" fontSize={18} fontWeight="medium" />
              <Checkbox
                label="Reduce motion"
                checked={props.reducedMotion}
                disabled={props.reducedMotionBusy}
                width={popoverWidth - 40 * ui}
                height={36 * ui}
                autoFocus
                onChange={props.onReducedMotionChange}
              />
              <Label
                text={
                  props.reducedMotionStatus ||
                  "Saved for Moire apps. The welcome backdrop stays still until hardware rendering is verified."
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
