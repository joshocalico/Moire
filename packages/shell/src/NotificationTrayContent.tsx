/** Measured notification content; the shell owns its independent tray and transport. */
import React, { useEffect, useRef, type ReactNode } from "react";
import { measureTextBounds, type HitRegion } from "@moire/react-host";
import {
  Box,
  Button,
  Column,
  ContentCard,
  Horizontal,
  Icon,
  IconButton,
  Pressable,
  ScrollColumn,
  TextBlock,
  applicationIcon,
  measureColumnContent,
  useWidgetTheme,
  measureWrappedText,
  resolveStatefulStyle,
  type WidgetTheme,
  type ScrollMetrics,
} from "@moire/ui";
import type {
  DesktopNotice,
  DesktopStatusSnapshot,
  DesktopStatusState,
} from "@moire/system-management/desktop-status";

export type NoticePresentation = Pick<
  DesktopNotice,
  "id" | "revision" | "appName" | "summary" | "body" | "closed"
> & {
  createdAt: number;
  closedAt: number | null;
  actions: readonly { key: string; label: string }[];
};
export type NotificationTrayStatus =
  | Exclude<DesktopStatusState, { kind: "ready" }>
  | (Omit<Extract<DesktopStatusState, { kind: "ready" }>, "snapshot"> & {
      snapshot: Omit<DesktopStatusSnapshot, "notices"> & { notices: readonly NoticePresentation[] };
    });
export type NoticeIdentity = Readonly<{ id: number; revision: number }>;
export type NotificationTrayContentProps = {
  width: number;
  height: number;
  state: NotificationTrayStatus;
  /** Actual wall clock supplied by the shell. No timer or readiness claim lives here. */
  now: number;
  view: "active" | "history";
  onViewChange(view: "active" | "history"): void;
  scrollY: number;
  onScroll(offset: number, metrics?: ScrollMetrics): void;
  busy: boolean;
  error: string;
  onClearAll(notices: readonly NoticeIdentity[]): void;
  onDismiss(id: number, revision: number): void;
  onInvokeAction(id: number, key: string, revision: number): void;
};

export function notificationAge(timestamp: number, now: number): string {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return "";
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes === 0) return "Now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** Used by the wrapper before dispatching a focused action in the scrolling body. */
export function scrollNotificationControlIntoView(scrollY: number, hit: HitRegion): number {
  if (!hit.pointerClip) return scrollY;
  const top = hit.pointerClip.y,
    bottom = top + hit.pointerClip.height;
  if (hit.y < top) return Math.max(0, scrollY + hit.y - top);
  if (hit.y + hit.height > bottom) return scrollY + hit.y + hit.height - bottom;
  return scrollY;
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
function groupLabel(timestamp: number, now: number): string {
  if (sameDay(timestamp, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return sameDay(timestamp, yesterday.getTime()) ? "Yesterday" : "Earlier";
}

type Guard = (notice: NoticePresentation, key?: string) => void;
function parts(
  props: NotificationTrayContentProps,
  theme: WidgetTheme,
  invoke: Guard,
  clear: () => void,
  changeView: () => void,
) {
  const { palette: pal, space, type } = theme.foundations;
  const snapshot = props.state.kind === "ready" ? props.state.snapshot : null;
  const disabled = props.busy || !snapshot || snapshot.updating || !snapshot.notificationsAvailable;
  const active = snapshot?.notices.filter((notice) => !notice.closed) ?? [];
  const timestampOf = (notice: NoticePresentation) =>
    notice.closed ? (notice.closedAt ?? notice.createdAt) : notice.createdAt;
  const notices = (
    snapshot?.notices.filter((notice) => notice.closed === (props.view === "history")) ?? []
  ).sort((a, b) => timestampOf(b) - timestampOf(a));
  const contentWidth = Math.max(1, props.width - space.lg * 2);
  const iconSize = type.display.size + space.sm;
  const noticeTextWidth = Math.max(1, contentWidth - iconSize - space.md);
  const hasClear = props.view === "active" && active.length > 0;
  const badgeWidth =
    measureTextBounds(String(active.length), { fontSize: type.title.size }).width + space.sm * 2;
  const clearRecipe = theme.recipes.button.ghost.medium;
  const clearWidth =
    measureTextBounds("Clear all", clearRecipe.label.base).width + clearRecipe.metrics.paddingX * 2;
  const titleWidth = Math.max(
    1,
    contentWidth - (hasClear ? badgeWidth + clearWidth + space.sm * 2 : 0),
  );
  const text = (
    value: string,
    color = pal.text,
    size = type.body.size,
    weight: "regular" | "medium" | "bold" = "regular",
  ) => (
    <TextBlock
      text={value}
      color={color}
      fontSize={size}
      fontWeight={weight}
      wrap
      overflow="visible"
    />
  );
  const actionControl = (
    notice: NoticePresentation,
    action: NoticePresentation["actions"][number],
  ) => {
    const actionLabel = action.label.trim() ? action.label : "Activate action";
    const recipe = theme.recipes.button.ghost.medium;
    const label = resolveStatefulStyle(recipe.label, disabled ? "disabled" : "rest");
    const style = { fontSize: label.fontSize, fontWeight: label.fontWeight };
    const width = Math.min(
      noticeTextWidth,
      measureTextBounds(actionLabel, style).width + recipe.metrics.paddingX * 2,
    );
    const padding = { horizontal: recipe.metrics.paddingX, vertical: space.xs };
    const height = Math.max(
      recipe.metrics.height,
      measureWrappedText(actionLabel, Math.max(1, width - padding.horizontal * 2), style).height +
        padding.vertical * 2,
    );
    const root = resolveStatefulStyle(recipe.root, disabled ? "disabled" : "rest");
    return (
      <Box key={action.key} width={width} height={height}>
        <Pressable
          width={width}
          height={height}
          fill={root.fill}
          hoverFill={resolveStatefulStyle(recipe.root, "hover").fill}
          pressedFill={resolveStatefulStyle(recipe.root, "pressed").fill}
          radius={root.radius}
          stroke={root.stroke}
          strokeWidth={root.strokeWidth}
          disabled={disabled}
          focusable
          focusId={`notifications:action:${notice.id}:${notice.revision}:${action.key}`}
          onPress={() => invoke(notice, action.key)}
          onKeyDown={(event) => {
            if (
              !event.repeat &&
              !disabled &&
              (event.code === 28 || event.code === 57 || event.key === "Enter" || event.key === " ")
            )
              invoke(notice, action.key);
          }}
        >
          <Column width={width} height={height} padding={padding} gap={0} justify="center">
            <TextBlock text={actionLabel} color={label.color} {...style} wrap overflow="visible" />
          </Column>
        </Pressable>
      </Box>
    );
  };
  const header = (
    <Column
      width={props.width}
      padding={{ horizontal: space.lg, top: space.lg, bottom: space.md }}
      gap={space.sm}
    >
      <Horizontal gap={space.sm} align="center">
        <TextBlock
          width={titleWidth}
          text={props.view === "history" ? "Notification history" : "Notifications"}
          fontSize={type.display.size}
          fontWeight="medium"
          wrap
        />
        {props.view === "active" && active.length > 0 ? (
          <ContentCard
            width={badgeWidth}
            padding={{ horizontal: space.sm, vertical: space.xs }}
            radius={theme.foundations.radii.large}
            fill={pal.selection}
          >
            <TextBlock text={String(active.length)} fontSize={type.title.size} color={pal.text} />
          </ContentCard>
        ) : null}
        {props.view === "active" && active.length > 0 ? (
          <Button
            label="Clear all"
            width={clearWidth}
            variant="ghost"
            focusId="notifications:clear"
            disabled={disabled}
            onPress={clear}
          />
        ) : null}
      </Horizontal>
      {props.busy || snapshot?.updating
        ? text("Updating notifications…", pal.muted, type.caption.size)
        : null}
    </Column>
  );
  const entries: ReactNode[] = [];
  if (props.error)
    entries.push(
      <TextBlock
        key="error"
        text={props.error}
        color={pal.danger}
        fontSize={type.body.size}
        wrap
        overflow="visible"
      />,
    );
  if (props.state.kind !== "ready") entries.push(text(props.state.message, pal.muted));
  else if (!snapshot?.notificationsAvailable)
    entries.push(text("Notifications are unavailable.", pal.muted));
  else if (!notices.length)
    entries.push(
      <Column key="empty" gap={space.md} padding={{ vertical: space.xl }} align="center">
        <Box width={type.display.size * 2.5} height={type.display.size * 2.5}>
          <Icon
            symbolic
            name={props.view === "active" ? "bell-check" : "history"}
            size={type.display.size * 2.5}
            color={pal.accent}
          />
        </Box>
        <TextBlock
          width={contentWidth}
          text={props.view === "active" ? "You’re all caught up" : "No notification history"}
          fontSize={type.title.size}
          fontWeight="medium"
          horizontalAlign="center"
          wrap
        />
        <TextBlock
          width={contentWidth}
          text={
            props.view === "active"
              ? "New notifications will appear here"
              : "Closed notifications appear here during this session"
          }
          color={pal.muted}
          fontSize={type.body.size}
          horizontalAlign="center"
          wrap
        />
      </Column>,
    );
  let previousGroup = "";
  for (const notice of notices) {
    const timestamp = timestampOf(notice);
    const age = notificationAge(timestamp, props.now);
    const ageWidth = measureTextBounds(age, { fontSize: type.caption.size }).width;
    const appWidth = Math.max(
      1,
      noticeTextWidth -
        ageWidth -
        (notice.closed
          ? space.sm
          : theme.recipes.iconButton.ghost.small.metrics.size + space.sm * 2),
    );
    const group = groupLabel(timestamp, props.now);
    if (group !== previousGroup)
      entries.push(
        <TextBlock
          key={`group:${notice.id}:${notice.revision}`}
          text={group}
          color={pal.muted}
          fontSize={type.title.size}
        />,
      );
    previousGroup = group;
    entries.push(
      <ContentCard
        key={`${notice.closed ? "closed" : "active"}:${notice.id}:${notice.revision}`}
        padding={{ vertical: space.md }}
        gap={space.sm}
        fill={0x00000000}
      >
        <Horizontal gap={space.md} align="start">
          <Box width={iconSize} height={iconSize}>
            <Icon
              symbolic
              name={applicationIcon(notice.appName)}
              size={iconSize}
              color={pal.accent}
            />
          </Box>
          <Column width={noticeTextWidth} gap={space.sm}>
            <Horizontal align="center" gap={space.sm}>
              <TextBlock
                width={appWidth}
                text={notice.appName || "Application"}
                color={pal.muted}
                fontSize={type.body.size}
                wrap
              />
              <TextBlock
                text={age}
                width={ageWidth}
                color={pal.muted}
                fontSize={type.caption.size}
              />
              {!notice.closed ? (
                <IconButton
                  icon={(style) => <Icon name="close" {...style} />}
                  variant="ghost"
                  size="small"
                  tooltip="Dismiss notification"
                  focusId={`notifications:dismiss:${notice.id}:${notice.revision}`}
                  disabled={disabled}
                  onPress={() => invoke(notice)}
                />
              ) : null}
            </Horizontal>
            {notice.summary ? text(notice.summary, pal.text, type.title.size, "medium") : null}
            {notice.body ? text(notice.body, pal.muted) : null}
            {!notice.closed
              ? notice.actions.map((action) => (
                  <Horizontal key={action.key} align="center">
                    {actionControl(notice, action)}
                  </Horizontal>
                ))
              : null}
          </Column>
        </Horizontal>
        <Box height={theme.foundations.borders.hairline} width={contentWidth}>
          <ContentCard
            width={contentWidth}
            height={theme.foundations.borders.hairline}
            padding={0}
            radius={0}
            fill={pal.borderSubtle}
          />
        </Box>
      </ContentCard>,
    );
  }
  const body = (
    <Column width={props.width} padding={{ horizontal: space.lg }} gap={space.sm}>
      {entries}
    </Column>
  );
  const footer = (
    <Column
      width={props.width}
      padding={{ horizontal: space.lg, top: space.sm, bottom: space.md }}
      gap={space.sm}
    >
      <Box height={theme.foundations.borders.hairline} width={contentWidth}>
        <ContentCard
          width={contentWidth}
          height={theme.foundations.borders.hairline}
          padding={0}
          radius={0}
          fill={pal.borderSubtle}
        />
      </Box>
      <Button
        label={props.view === "active" ? "Notification history" : "Back to notifications"}
        variant="ghost"
        focusId="notifications:history"
        leadingIcon={(style) => (
          <Icon name={props.view === "active" ? "history" : "bell"} {...style} />
        )}
        trailingIcon={(style) => <Icon name="chevron-right" {...style} />}
        onPress={changeView}
      />
    </Column>
  );
  return { header, body, footer };
}

/** Identical intrinsic trees to the actual content; wrapper limits the viewport to available space. */
export function measureNotificationTrayContent(
  props: NotificationTrayContentProps,
  theme: WidgetTheme,
): { height: number; headerHeight: number; footerHeight: number; contentHeight: number } {
  const nodes = parts(
    props,
    theme,
    () => {},
    () => {},
    () => {},
  );
  return measureParts(props.width, theme, nodes);
}

function measureParts(width: number, theme: WidgetTheme, nodes: ReturnType<typeof parts>) {
  const measure = (children: ReactNode) =>
    measureColumnContent({ width, gap: 0, children }, theme).height;
  const headerHeight = measure(nodes.header),
    footerHeight = measure(nodes.footer),
    contentHeight = measure(nodes.body);
  return {
    height: headerHeight + footerHeight + contentHeight,
    headerHeight,
    footerHeight,
    contentHeight,
  };
}

export function NotificationTrayContent(props: NotificationTrayContentProps): ReactNode {
  const theme = useWidgetTheme();
  const latest = useRef(props);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  latest.current = props;
  const expectedOwner = props.state.kind === "ready" ? props.state.owner : null;
  const actionable = () => {
    const current = latest.current;
    return mounted.current &&
      !current.busy &&
      current.view === "active" &&
      current.state.kind === "ready" &&
      current.state.owner === expectedOwner &&
      !current.state.snapshot.updating &&
      current.state.snapshot.notificationsAvailable
      ? current
      : null;
  };
  const invoke: Guard = (notice, key) => {
    const current = actionable();
    if (!current || current.state.kind !== "ready") return;
    const live = current.state.snapshot.notices.find(
      (item) => !item.closed && item.id === notice.id && item.revision === notice.revision,
    );
    if (!live) return;
    if (key === undefined) current.onDismiss(live.id, live.revision);
    else if (live.actions.some((action) => action.key === key))
      current.onInvokeAction(live.id, key, live.revision);
  };
  const identities = Object.freeze(
    (props.state.kind === "ready"
      ? props.state.snapshot.notices.filter((notice) => !notice.closed)
      : []
    ).map(({ id, revision }) => Object.freeze({ id, revision })),
  );
  const clear = () => {
    const current = actionable();
    if (current && identities.length > 0) current.onClearAll(identities);
  };
  const nodes = parts(props, theme, invoke, clear, () =>
    latest.current.onViewChange(latest.current.view === "active" ? "history" : "active"),
  );
  const metrics = measureParts(props.width, theme, nodes);
  const viewport = Math.max(0, props.height - metrics.headerHeight - metrics.footerHeight);
  const quiet =
    props.state.kind === "ready" &&
    props.state.snapshot.notificationsAvailable &&
    !props.state.snapshot.notices.some((notice) => notice.closed === (props.view === "history"));
  return (
    <Column width={props.width} height={props.height} gap={0}>
      <Box width={props.width} height={metrics.headerHeight} flexShrink={0}>
        {nodes.header}
      </Box>
      <ScrollColumn
        width={props.width}
        height={viewport}
        // The shared popup owns the background and its outer frame.
        fill={0x00000000}
        smooth={false}
        scrollY={props.scrollY}
        onScroll={props.onScroll}
        keyboard={props.view === "history" ? { focusId: "notifications:history-body" } : undefined}
        gap={0}
      >
        {quiet && metrics.contentHeight < viewport ? (
          <Column width={props.width} height={viewport} justify="center" gap={0}>
            {nodes.body}
          </Column>
        ) : (
          nodes.body
        )}
      </ScrollColumn>
      <Box width={props.width} height={metrics.footerHeight} flexShrink={0}>
        {nodes.footer}
      </Box>
    </Column>
  );
}
