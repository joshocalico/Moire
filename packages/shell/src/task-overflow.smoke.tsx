/** Actual Panel→public Window list route, including hidden minimized tasks and removal. */
import assert from "node:assert/strict";
import React from "react";
import { collectHits, createShellRoot, renderShell } from "@moire/react-host";
import { applyThemeFamily, getTheme, setTheme, THEME_FAMILIES } from "@moire/theme";
import {
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type PlatformWindow,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { Panel, panelStatusGeometry, type PanelAnchorBounds, type PanelProps } from "./Panel";
import { TaskOverflow, TASK_WINDOWS_SCOPE, measureTaskOverflow } from "./TaskOverflow";
import { desktopPopupGeometry } from "./QuickSettings";
import type { TaskWindowInfo } from "./ssd";

await installUiFonts();
const original = getTheme();
let cases = 0;
try {
  for (const family of THEME_FAMILIES)
    for (const dark of [true, false])
      for (const scale of [1, 1.5])
        for (const width of [320, 1280]) {
          setUiScaleFactor(scale);
          setTheme(applyThemeFamily(original, family, dark));
          const theme = createPersonalizedWidgetTheme(
            discoverPersonalization("linux", {
              themeFamily: family,
              colorScheme: dark ? "dark" : "light",
              accent: getTheme().tokens.accent,
              reducedMotion: true,
              fontScale: 1,
            }),
          );
          const height = 800;
          let tasks: TaskWindowInfo[] = Array.from({ length: 128 }, (_, index) => ({
            clientId: 1,
            surfaceId: index + 1,
            title: `Document ${index + 1}`,
            // Distinct applications: one window each crowds the panel (one app would group).
            appId: `moire.fixture${index + 1}`,
            focused: false,
            minimized: true,
          }));
          const captured: { anchor: PanelAnchorBounds | null; tasks: readonly TaskWindowInfo[] } = {
            anchor: null,
            tasks: [],
          };
          const activated: number[] = [];
          const activatedTitles: string[] = [];
          let open = false,
            dismissed = 0;
          const props = (): PanelProps => ({
            screenW: width,
            screenH: height,
            clock: "10:24 · 3 Oct",
            notificationCount: 128,
            tasks,
            onTaskPress: (task) => activated.push(task.surfaceId),
            onLauncherClick: () => {},
            onControlsClick: () => {},
            onNotificationsClick: () => {},
            onTaskOverflowClick: (anchor, hidden) => {
              captured.anchor = anchor;
              captured.tasks = hidden;
              open = true;
            },
          });
          const live = () =>
            tasks.filter((task) =>
              captured.tasks.some(
                (key) => key.clientId === task.clientId && key.surfaceId === task.surfaceId,
              ),
            );
          const element = () => (
            <WidgetThemeProvider theme={theme}>
              <Panel {...props()} />
              {captured.anchor ? (
                <TaskOverflow
                  open={open}
                  screenW={width}
                  screenH={height}
                  anchor={captured.anchor}
                  tasks={live()}
                  onTaskPress={(task) => {
                    activated.push(task.surfaceId);
                    activatedTitles.push(task.title);
                  }}
                  onDismiss={() => {
                    open = false;
                    dismissed++;
                  }}
                />
              ) : null}
            </WidgetThemeProvider>
          );
          const root = createShellRoot();
          renderShell(root, element());
          const geometry = panelStatusGeometry({ ...props(), taskCount: tasks.length });
          assert.ok(geometry.overflow, "compact/crowded tasks have an explicit overflow route");
          const hit = collectHits(root.container).find((hit) => hit.focusId === "panel:windows");
          assert.ok(hit);
          for (const field of ["x", "y", "width", "height"] as const)
            assert.equal(hit[field], geometry.overflow[field]);
          assert(
            hit.x >= geometry.panel.x + geometry.launcherX + geometry.launcherW &&
              hit.x + hit.width <= geometry.controls!.x,
          );
          const backend = new HeadlessPlatform();
          await backend.connect();
          const window = new Window({ title: "Task overflow", width, height, decorated: false });
          window.setContent(element);
          window.mount(backend);
          await Promise.resolve();
          const native = backend.getWindows()[0];
          assert.ok(native);
          if (width === 320) {
            const platform: PlatformWindow = native;
            platform.presentScene = () => false;
          }
          const key = (code: number, name: string, shift = false) => {
            for (const type of ["down", "up"] as const)
              native.injectKey({
                type,
                code,
                key: name,
                modifiers: { shift, ctrl: false, alt: false, meta: false },
                timeMs: 1,
              });
            window.tick();
          };
          try {
            window.tick();
            for (const type of ["down", "up"] as const)
              native.injectPointer({
                type,
                x: hit.x + hit.width / 2,
                y: hit.y + hit.height / 2,
                button: "left",
                timeMs: 1,
              });
            window.tick();
            window.tick();
            assert.equal(captured.tasks.length, tasks.length - geometry.visibleTaskCount);
            assert(captured.tasks.every((task) => task.minimized));
            assert.equal(captured.anchor!.x, geometry.overflow.x);
            assert(open);
            renderShell(root, element());
            assert(
              collectHits(root.container)
                .filter((hit) => hit.focusable && hit.focusScopeId === TASK_WINDOWS_SCOPE)
                .some((hit) => hit.focusId === `${TASK_WINDOWS_SCOPE}:list`),
            );
            key(107, "End");
            window.tick();
            key(28, "Enter");
            assert.equal(
              activated.at(-1),
              128,
              "last hidden minimized window is keyboard reachable",
            );
            const popupWidth = desktopPopupGeometry(width, height, captured.anchor!, 0).width;
            const metrics = measureTaskOverflow(popupWidth, live(), theme);
            const popup = desktopPopupGeometry(width, height, captured.anchor!, metrics.height);
            const last = {
              x: popup.x + metrics.padding,
              y: popup.y + popup.height - metrics.padding - metrics.rowHeight,
              width: popup.width - metrics.padding * 2,
              height: metrics.rowHeight,
            };
            assert(
              last.y >= popup.y + metrics.padding + metrics.headerHeight + metrics.gap,
              "last row fully fits actual list viewport after End",
            );
            // Update the live metadata, then activate via one pointer click (not a double-click requirement).
            tasks = tasks.map((task) =>
              task.surfaceId === 128 ? { ...task, title: "Renamed current document" } : task,
            );
            window.setContent(element);
            window.tick();
            for (const type of ["down", "up"] as const)
              native.injectPointer({
                type,
                x: last.x + last.width / 2,
                y: last.y + last.height / 2,
                button: "left",
                timeMs: 2,
              });
            window.tick();
            assert.equal(
              activated.length,
              2,
              "one pointer click invokes actual task action exactly once",
            );
            assert.equal(
              activated.at(-1),
              128,
              "End reveals the actual last row to native pointer hit testing",
            );
            assert.equal(
              activatedTitles.at(-1),
              "Renamed current document",
              "activation observes current live metadata",
            );
            tasks = tasks.filter((task) => task.surfaceId !== 128);
            window.setContent(element);
            window.tick();
            key(107, "End");
            key(28, "Enter");
            assert.equal(activated.at(-1), 127, "removed captured key cannot activate stale task");
            key(102, "Home");
            key(28, "Enter");
            assert.equal(
              activated.at(-1),
              captured.tasks[0]!.surfaceId,
              "Home returns to first hidden key",
            );
            key(1, "Escape");
            assert(!open);
            assert.equal(dismissed, 1);
            open = true;
            window.setContent(element);
            window.tick();
            key(15, "Tab");
            key(15, "Tab", true);
            key(1, "Escape");
            assert.equal(dismissed, 2, "Tab remains in popup scope; Escape closes");
            // The callback payload partitions all task keys without loss/duplicates.
            const visible = tasks.slice(0, geometry.visibleTaskCount).map((task) => task.surfaceId);
            const hidden = captured.tasks.map((task) => task.surfaceId);
            assert.equal(new Set([...visible, ...hidden]).size, 128);
            open = true;
            window.setContent(element);
            window.tick();
            for (const type of ["down", "up"] as const)
              native.injectPointer({ type, x: 0, y: 0, button: "left", timeMs: 3 });
            window.tick();
            assert.equal(dismissed, 3, "outside click dismisses the shared popup");
            open = true;
            tasks = [];
            window.setContent(element);
            window.tick();
            const activationCount = activated.length;
            key(107, "End");
            key(28, "Enter");
            assert.equal(
              activated.length,
              activationCount,
              "empty live task set cannot activate stale keys",
            );
            key(1, "Escape");
            assert.equal(dismissed, 4);
            cases++;
          } finally {
            window.destroy();
            await backend.disconnect();
            renderShell(root, null);
          }
        }
} finally {
  setUiScaleFactor(1);
  setTheme(original);
}
console.log(
  `Task overflow: ${cases} five-family public Window cases passed; hidden minimized keys/reveal/removal/click/keyboard; no native claim.`,
);
