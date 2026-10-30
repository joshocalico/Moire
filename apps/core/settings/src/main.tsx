/**
 * Moire Settings: connects the session services, opens the window and renders the app.
 * `MOIRE_SETTINGS_PAGE=<page>[#<setting>]` opens a page; the old `MOIRE_SETTINGS_TAB` index is
 * still accepted.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { Application, Window, setUiScaleFactor } from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { SettingsApp } from "./app";
import { systemAppsBackend } from "./apps-state";
import { initialRoute } from "./catalog";
import { connectServices, copyWithWlCopy, launchDetached } from "./services";
import { readSystemInfo } from "./system-info";

export { SettingsApp, type SettingsAppProps } from "./app";

/** Default window size; the minimum is 640 × 520. */
const WIDTH = 980;
const HEIGHT = 680;

async function main() {
  const initial = loadSettings();
  setUiScaleFactor(initial.uiScale);
  const ui = initial.uiScale;
  const { services, disconnect } = await connectServices();
  const system = readSystemInfo();
  const apps = systemAppsBackend();
  const route = initialRoute(process.env);

  const app = new Application();
  const win = new Window({
    title: "Settings",
    appId: "org.moire.Settings",
    width: Math.round(WIDTH * ui),
    height: Math.round(HEIGHT * ui),
    resizable: true,
    // The app draws its own header and window controls.
    decorated: false,
  });
  win.setContent((size) => (
    <SettingsApp
      {...size}
      window={win}
      initial={initial}
      services={services}
      system={system}
      apps={apps}
      route={route}
      launch={launchDetached}
      copyText={copyWithWlCopy}
      onReducedMotionChange={(value) => app.setSessionReducedMotion(value)}
    />
  ));
  win.onClose(() => {
    disconnect();
    app.quit();
  });
  app.addWindow(win);
  await app.run();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((err) => {
    console.error("[settings]", err);
    process.exit(1);
  });
