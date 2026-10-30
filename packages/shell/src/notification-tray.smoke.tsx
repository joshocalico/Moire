import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
/** Actual public Window + CPU content fixture; no native display or service-action claim. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  collectHits,
  createShellRoot,
  measureTextBounds,
  renderShell,
  type SceneNode,
} from "@moire/react-host";
import { THEME_FAMILIES } from "@moire/theme";
import {
  FocusScope,
  Surface,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type PlatformWindow,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import {
  NotificationTrayContent,
  measureNotificationTrayContent,
  notificationAge,
  scrollNotificationControlIntoView,
  type NotificationTrayContentProps,
  type NotificationTrayStatus,
  type NoticePresentation,
} from "./NotificationTrayContent";
import { bannerNotice } from "./QuickSettings";

await installUiFonts();
const now = new Date(2026, 9, 3, 14, 0).getTime();
const notices: NoticePresentation[] = [
  {
    id: 1,
    revision: 2,
    appName: "Files",
    summary: "Fixture transfer complete",
    body: "Fixture files copied into the private test folder",
    closed: false,
    createdAt: now - 120_000,
    closedAt: null,
    actions: [{ key: "open", label: "Open folder" }],
  },
  {
    id: 2,
    revision: 1,
    appName: "Calendar",
    summary: "Fixture design review",
    body: "Fixture event starts in six minutes",
    closed: false,
    createdAt: now,
    closedAt: null,
    actions: [],
  },
  {
    id: 3,
    revision: 4,
    appName: "Music",
    summary: "Fixture audio notice",
    body: "Fixture source message",
    closed: false,
    createdAt: now - 720_000,
    closedAt: null,
    actions: [{ key: "view", label: "View details" }],
  },
  {
    id: 4,
    revision: 1,
    appName: "Editor",
    summary: "Fixture closed notice",
    body: "Historical fixture data",
    closed: true,
    createdAt: now - 86_400_000,
    closedAt: now - 30_000,
    actions: [{ key: "never", label: "Must not render" }],
  },
];
function state(items = notices, owner = ":1.4"): NotificationTrayStatus {
  return {
    kind: "ready",
    owner,
    snapshot: {
      revision: 7,
      audio: { kind: "unavailable", message: "Fixture" },
      network: [],
      wifi: WIFI_UNAVAILABLE,
      bluetooth: BLUETOOTH_UNAVAILABLE,
      battery: BATTERY_UNAVAILABLE,
      capabilities: {
        audio: false,
        brightness: false,
        battery: false,
        bluetooth: false,
        power: false,
        notifications: true,
      },
      doNotDisturb: false,
      notificationsAvailable: true,
      updating: false,
      notices: items,
    },
  };
}
const descendants = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(descendants)];
function absolute(node: SceneNode) {
  let x = 0,
    y = 0;
  for (let current: SceneNode | null = node; current; current = current.parent) {
    x +=
      current.x +
      (typeof current.translateX === "number"
        ? current.translateX
        : (current.translateX?.get() ?? 0));
    y +=
      current.y +
      (typeof current.translateY === "number"
        ? current.translateY
        : (current.translateY?.get() ?? 0));
  }
  return { x, y };
}
const calls: unknown[][] = [];
let cases = 0;
try {
  assert.equal(notificationAge(now - 120_000, now), "2m");
  assert.equal(
    notificationAge(now + 120_000, now),
    "Now",
    "clock reversal cannot invent negative ages",
  );
  assert.equal(notificationAge(Number.NaN, now), "", "invalid clock is not an age claim");
  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5])
        for (const retained of [false, true]) {
          setUiScaleFactor(scale);
          const theme = createPersonalizedWidgetTheme(
            discoverPersonalization("linux", {
              themeFamily: family,
              colorScheme,
              reducedMotion: true,
            }),
          );
          const width = (scale === 1 ? 440 : 320) * scale,
            height = 600 * scale;
          let props: NotificationTrayContentProps = {
            width,
            height,
            state: state(),
            now,
            view: "active",
            busy: false,
            error: "",
            scrollY: 0,
            onScroll(value) {
              props = { ...props, scrollY: value };
            },
            onViewChange(view) {
              props = { ...props, view, scrollY: 0 };
            },
            onClearAll(pairs) {
              calls.push(["clear", pairs]);
              assert(Object.isFrozen(pairs) && pairs.every(Object.isFrozen));
            },
            onDismiss(id, revision) {
              calls.push(["dismiss", id, revision]);
            },
            onInvokeAction(id, key, revision) {
              calls.push(["action", id, key, revision]);
            },
          };
          const scene = createShellRoot();
          const element = () => (
            <WidgetThemeProvider theme={theme}>
              <Surface width={width} height={height} fill={theme.foundations.palette.panel}>
                <FocusScope id="notifications-test" width={width} height={height} trap>
                  <NotificationTrayContent {...props} />
                </FocusScope>
              </Surface>
            </WidgetThemeProvider>
          );
          const paint = () => {
            renderShell(scene, element());
            return collectHits(scene.container);
          };
          let hits = paint();
          const metrics = measureNotificationTrayContent(props, theme);
          assert(metrics.height > metrics.headerHeight + metrics.footerHeight);
          for (const node of descendants(scene.container).filter(
            (node) =>
              node.kind === "text" && ["Notifications", "3", "Clear all"].includes(node.text ?? ""),
          )) {
            const point = absolute(node),
              bounds = measureTextBounds(node.text!, {
                fontSize: node.fontSize,
                fontWeight: node.fontWeight,
                scale: node.scale,
              });
            assert(
              point.x >= 0 &&
                point.x + bounds.width <= width + 0.01 &&
                point.y >= 0 &&
                point.y + bounds.height <= metrics.headerHeight + 0.01,
              "full header/count glyph bounds precede the body viewport",
            );
          }
          const footer = hits.find((hit) => hit.focusId === "notifications:history")!;
          assert(
            footer.y >= 0 && footer.y + footer.height <= height + 0.01,
            "history is visible without scroll",
          );
          assert(hits.some((hit) => hit.focusId === "notifications:clear"));
          const text = descendants(scene.container)
            .filter((node) => node.kind === "text")
            .map((node) => node.text)
            .join("\n");
          assert(
            text.includes("Fixture transfer complete") &&
              text.includes("2m") &&
              text.includes("Today"),
          );
          assert(!text.includes("Fixture closed notice"));
          const backend = new HeadlessPlatform();
          await backend.connect();
          const window = new Window({
            title: "Notification content fixture",
            width,
            height,
            decorated: false,
          });
          window.setContent(element);
          window.mount(backend);
          await Promise.resolve();
          window.tick();
          window.tick();
          const native = backend.getWindows()[0]!;
          if (retained) {
            const transport: PlatformWindow = native;
            transport.presentScene = () => false;
          }
          const key = (code: number, value: string, shift = false) => {
            for (const type of ["down", "up"] as const)
              native.injectKey({
                type,
                code,
                key: value,
                modifiers: { shift, ctrl: false, alt: false, meta: false },
                timeMs: 1,
              });
            window.tick();
          };
          const click = (id: string) => {
            hits = paint();
            const hit = hits.find((item) => item.focusId === id)!;
            assert(hit, id);
            const x = hit.x + hit.width / 2,
              y = hit.y + hit.height / 2;
            for (const type of ["down", "up"] as const)
              native.injectPointer({ type, x, y, button: "left", timeMs: 1 });
            window.tick();
          };
          const start = calls.length;
          key(28, "Enter"); // focus trap starts at Clear all
          assert.deepEqual(calls[start], [
            "clear",
            [
              { id: 1, revision: 2 },
              { id: 2, revision: 1 },
              { id: 3, revision: 4 },
            ],
          ]);
          key(15, "Tab");
          const focused = native.lastFrame?.slice();
          assert(focused);
          key(57, " ");
          assert.deepEqual(calls[start + 1], ["dismiss", 2, 1]);
          key(15, "Tab");
          assert.notDeepEqual(
            native.lastFrame,
            focused,
            "actual Window traversal paints a different focused control",
          );
          key(28, "Enter");
          assert.deepEqual(calls[start + 2], ["dismiss", 1, 2]);
          key(15, "Tab");
          key(28, "Enter");
          assert.deepEqual(calls[start + 3], ["action", 1, "open", 2]);
          key(15, "Tab", true);
          key(28, "Enter");
          assert.deepEqual(
            calls[start + 4],
            ["dismiss", 1, 2],
            "Shift+Tab uses actual Window traversal",
          );
          let pointerStart = calls.length;
          click("notifications:dismiss:2:1");
          assert.deepEqual(calls[pointerStart], ["dismiss", 2, 1]);
          click("notifications:action:1:2:open");
          assert.deepEqual(calls[pointerStart + 1], ["action", 1, "open", 2]);
          click("notifications:history");
          assert.equal(props.view, "history");
          hits = paint();
          window.setContent(element);
          window.tick();
          assert(
            !hits.some(
              (hit) =>
                hit.focusId?.startsWith("notifications:action:") ||
                hit.focusId?.startsWith("notifications:dismiss:"),
            ),
          );
          assert(
            descendants(scene.container).some((node) => node.text === "Fixture closed notice"),
          );
          click("notifications:history");
          assert.equal(props.view, "active");
          window.setContent(element);
          window.tick();
          // Saved handlers cannot target replacement revisions or a restarted producer owner.
          hits = paint();
          const oldDismiss = hits.find((hit) => hit.focusId === "notifications:dismiss:1:2")!;
          const oldAction = hits.find((hit) => hit.focusId === "notifications:action:1:2:open")!;
          props = {
            ...props,
            state: state(notices.map((item) => (item.id === 1 ? { ...item, revision: 3 } : item))),
          };
          paint();
          let before = calls.length;
          oldDismiss.onPress?.({ x: 0, y: 0, localX: 0, localY: 0 });
          oldAction.onPress?.({ x: 0, y: 0, localX: 0, localY: 0 });
          assert.equal(calls.length, before);
          props = { ...props, state: state(notices, ":1.9") };
          paint();
          oldDismiss.onPress?.({ x: 0, y: 0, localX: 0, localY: 0 });
          assert.equal(calls.length, before);
          props = { ...props, state: state(), busy: true };
          hits = paint();
          assert(!hits.some((hit) => hit.focusable && hit.focusId === "notifications:clear"));
          const long = "Long fixture body ".repeat(190) + "VISIBLE_END_TOKEN";
          props = {
            ...props,
            state: state([{ ...notices[0]!, body: long }]),
            busy: false,
            scrollY: 0,
          };
          hits = paint();
          const longMetrics = measureNotificationTrayContent(props, theme);
          assert(
            longMetrics.contentHeight > height,
            "all long body lines are measured, not silently truncated",
          );
          assert(
            descendants(scene.container).some((node) => node.text?.includes("VISIBLE_END_TOKEN")),
          );
          window.setContent(element);
          window.tick();
          assert(native.lastFrame);
          // Earlier steps leave the pointer over the footer. Move it into the
          // body and settle that hover transition before measuring wheel paint.
          native.injectPointer({
            type: "move",
            x: width / 2,
            y: longMetrics.headerHeight + 60,
            timeMs: 1,
          });
          window.tick();
          // A motion that has settled has only published its last value: the widget re-renders
          // from it asynchronously and then invalidates the window. With slow frames that last
          // step is large enough to see, so pump until a whole turn passes with neither motion
          // nor an invalidation; only then is the frame below the final one.
          let invalidated = true;
          const stopWatching = window.onInvalidated(() => {
            invalidated = true;
          });
          for (
            let settle = 0;
            (invalidated || window.hasActiveAnimations()) && settle < 240;
            settle++
          ) {
            invalidated = false;
            await new Promise((resolve) => setTimeout(resolve, 16));
            window.tick();
          }
          stopWatching();
          assert(
            !invalidated && !window.hasActiveAnimations(),
            "pre-wheel pointer feedback settled and painted",
          );
          const wheelBefore = native.lastFrame!.slice();
          native.injectPointer({
            type: "wheel",
            x: width / 2,
            y: longMetrics.headerHeight + 60,
            deltaY: 128,
            timeMs: 1,
          });
          window.tick();
          assert(
            props.scrollY > 0,
            "actual public Window wheel reaches the controlled content offset",
          );
          const frameCrop = (frame: Uint8Array, y: number, h: number) =>
            frame.slice(Math.ceil(y) * width * 4, Math.floor(y + h) * width * 4);
          assert(native.lastFrame);
          const viewportHeight = height - longMetrics.headerHeight - longMetrics.footerHeight;
          assert.notDeepEqual(
            frameCrop(native.lastFrame, longMetrics.headerHeight, viewportHeight),
            frameCrop(wheelBefore, longMetrics.headerHeight, viewportHeight),
            "wheel produces different actual Window body pixels before reset",
          );
          assert.deepEqual(
            frameCrop(
              native.lastFrame,
              height - longMetrics.footerHeight,
              longMetrics.footerHeight,
            ),
            frameCrop(wheelBefore, height - longMetrics.footerHeight, longMetrics.footerHeight),
            "wheel does not move the fixed footer pixels",
          );
          props = {
            ...props,
            view: "history",
            scrollY: 0,
            state: state([{ ...notices[0]!, body: long, closed: true, closedAt: now }]),
          };
          window.setContent(element);
          window.tick();
          window.tick();
          native.injectPointer({
            type: "down",
            button: "left",
            x: width / 2,
            y: longMetrics.headerHeight + 60,
            timeMs: 2,
          });
          native.injectPointer({
            type: "up",
            button: "left",
            x: width / 2,
            y: longMetrics.headerHeight + 60,
            timeMs: 3,
          });
          window.tick();
          const historyBefore = native.lastFrame!.slice();
          const callsBeforeHistoryKeys = calls.length;
          key(109, "PageDown");
          window.tick();
          assert(
            props.scrollY > 0,
            "PageDown in focused passive history moves its controlled offset",
          );
          assert.notDeepEqual(
            native.lastFrame,
            historyBefore,
            "history keyboard scrolling repaints",
          );
          key(107, "End");
          window.tick();
          const historyMetrics = measureNotificationTrayContent(props, theme);
          assert.equal(
            props.scrollY,
            historyMetrics.contentHeight -
              (height - historyMetrics.headerHeight - historyMetrics.footerHeight),
          );
          key(28, "Enter");
          key(57, " ");
          assert.equal(
            calls.length,
            callsBeforeHistoryKeys,
            "passive reading keys never call an old producer",
          );
          key(15, "Tab");
          key(28, "Enter");
          window.tick();
          assert.equal(props.view, "active", "Tab reaches the stationary Back control");
          props = { ...props, state: state([{ ...notices[0]!, body: long }]), scrollY: 0 };
          hits = paint();
          const action = hits.find((hit) => hit.focusId === "notifications:action:1:2:open")!;
          props = { ...props, scrollY: scrollNotificationControlIntoView(0, action) };
          hits = paint();
          const shown = hits.find((hit) => hit.focusId === action.focusId)!;
          assert(
            shown.pointerClip &&
              shown.y >= shown.pointerClip.y - 0.01 &&
              shown.y + shown.height <= shown.pointerClip.y + shown.pointerClip.height + 0.01,
            "wrapper can reveal long-body action before dispatch",
          );
          const afterFooter = hits.find((hit) => hit.focusId === "notifications:history")!;
          assert.equal(afterFooter.y, footer.y, "footer does not move with body scroll");
          const label = "A complete producer action label ".repeat(5) + "ACTION_END_TOKEN";
          props = {
            ...props,
            scrollY: 0,
            state: state([
              { ...notices[0]!, body: "Short fixture", actions: [{ key: "long", label }] },
            ]),
          };
          hits = paint();
          const longAction = hits.find((hit) => hit.focusId === "notifications:action:1:2:long")!;
          assert(
            longAction.width <= width &&
              longAction.height > theme.recipes.button.ghost.medium.metrics.height,
          );
          assert(
            descendants(scene.container).some((node) => node.text?.includes("ACTION_END_TOKEN")),
            "long action labels wrap completely rather than becoming an ambiguous ellipsis",
          );
          for (const emptyLabel of ["", "   "]) {
            props = {
              ...props,
              state: state([
                {
                  ...notices[0]!,
                  body: "Fixture empty action label",
                  actions: [{ key: "producer:empty", label: emptyLabel }],
                },
              ]),
            };
            paint();
            assert(
              descendants(scene.container).some((node) => node.text === "Activate action"),
              "an empty producer label still has readable activation text",
            );
            window.setContent(element);
            window.tick();
            const emptyStart = calls.length;
            click("notifications:action:1:2:producer:empty");
            assert.deepEqual(
              calls[emptyStart],
              ["action", 1, "producer:empty", 2],
              "fallback display never substitutes a different producer key or revision",
            );
          }
          props = {
            ...props,
            state: state([
              {
                ...notices[0]!,
                appName: "Long producer application name ".repeat(8) + "APP_END_TOKEN",
              },
            ]),
            error: "Fixture operation error ".repeat(100) + "ERROR_END_TOKEN",
          };
          hits = paint();
          const longNameNodes = descendants(scene.container).filter((node) => node.kind === "text");
          const appEnd = longNameNodes.find((node) => node.text?.includes("APP_END_TOKEN"))!,
            summary = longNameNodes.find((node) => node.text === "Fixture transfer complete")!;
          assert(appEnd && summary);
          const appBottom =
            absolute(appEnd).y +
            measureTextBounds(appEnd.text!, {
              fontSize: appEnd.fontSize,
              fontWeight: appEnd.fontWeight,
            }).height;
          assert(
            absolute(summary).y >= appBottom,
            "long app name cannot paint over the notice title",
          );
          assert(
            longNameNodes.some((node) => node.text?.includes("ERROR_END_TOKEN")),
            "errors remain completely reachable in the scrolling body",
          );
          assert.equal(
            hits.find((hit) => hit.focusId === "notifications:history")!.y,
            footer.y,
            "long errors cannot displace the stationary history control",
          );
          props = { ...props, error: "" };
          props = { ...props, state: state([]), scrollY: 0 };
          paint();
          window.setContent(element);
          window.tick();
          assert(descendants(scene.container).some((node) => node.text === "You’re all caught up"));
          const directory = process.env.MOIRE_NOTIFICATION_CAPTURE_DIR;
          if (directory && family === "moire") {
            fs.mkdirSync(directory, { recursive: true });
            for (const [name, sample] of [
              ["empty", []],
              ["active", notices],
              ["long", [{ ...notices[0]!, body: long }]],
            ] as const) {
              props = { ...props, state: state([...sample]), scrollY: 0 };
              window.setContent(element);
              window.tick();
              assert(native.lastFrame);
              fs.writeFileSync(
                path.join(
                  directory,
                  `${name}-${colorScheme}-${scale}-${retained ? "retained" : "direct"}.bgra`,
                ),
                native.lastFrame,
              );
              fs.writeFileSync(
                path.join(
                  directory,
                  `${name}-${colorScheme}-${scale}-${retained ? "retained" : "direct"}.json`,
                ),
                JSON.stringify({
                  width,
                  height,
                  format: "BGRA",
                  scope: "Actual public Window CPU fixture; no native display/service actions",
                }),
              );
            }
          }
          props = { ...props, state: { kind: "error", message: "Fixture disconnected" } };
          hits = paint();
          assert(
            !hits.some(
              (hit) =>
                hit.focusId?.startsWith("notifications:dismiss:") ||
                hit.focusId === "notifications:clear",
            ),
          );
          before = calls.length;
          renderShell(scene, null);
          oldDismiss.onPress?.({ x: 0, y: 0, localX: 0, localY: 0 });
          assert.equal(calls.length, before, "unmounted content no longer issues actions");
          window.destroy();
          backend.disconnect();
          cases++;
        }
  console.log(
    `[notification-tray] ${cases} actual Window theme/scheme/scale cases: Enter/Space/Tab/ShiftTab, pointer history, immutable clear pairs, stale identity, passive history, measured complete body/reveal/stationary footer passed; native wrapper/actions pending`,
  );
} finally {
  setUiScaleFactor(1);
}

// The banner skips notices whose app turned banners off; they still wait in the tray.
{
  const quiet = { ...notices[1]!, banner: false };
  assert.equal(bannerNotice([quiet, notices[0]!])?.id, notices[0]!.id);
  assert.equal(bannerNotice([quiet]), null);
  assert.equal(bannerNotice([{ ...notices[0]!, closed: true }]), null);
  console.log("[notification-tray] banner skips banner-less and closed notices passed");
}
